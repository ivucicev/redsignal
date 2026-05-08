from __future__ import annotations

import asyncio
import base64
import json
import os
import queue
import re
import secrets
import sqlite3
import threading
import time
import uuid as _uuid_mod
from collections import deque
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

import requests as _http
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

app = FastAPI()


# ── Optional Basic Auth ─────────────────────────────────────────────────────
class _BasicAuth(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        _u = os.getenv("APP_USER", "").strip()
        _p = os.getenv("APP_PASSWORD", "").strip()
        if not _u or not _p or request.url.path == "/ws":
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Basic "):
            try:
                u, p = base64.b64decode(auth[6:]).decode().split(":", 1)
                if secrets.compare_digest(u, _u) and secrets.compare_digest(p, _p):
                    return await call_next(request)
            except Exception:
                pass
        return Response("Unauthorized", status_code=401,
                        headers={"WWW-Authenticate": 'Basic realm="RedSignal"'})

app.add_middleware(_BasicAuth)


# ── Database ─────────────────────────────────────────────────────────────────
DB_PATH = Path(os.getenv("DB_PATH", "redsignal.db"))

SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS credentials (
    id   TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS listeners (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL DEFAULT 'Listener',
    enabled              INTEGER NOT NULL DEFAULT 1,
    subreddits           TEXT NOT NULL DEFAULT 'all',
    webhook              TEXT NOT NULL DEFAULT '',
    whitelist            TEXT NOT NULL DEFAULT '[]',
    keywords             TEXT NOT NULL DEFAULT '[]',
    filters              TEXT NOT NULL DEFAULT '[]',
    negative_keywords    TEXT NOT NULL DEFAULT '[]',
    min_karma            INTEGER NOT NULL DEFAULT 0,
    min_account_age_days INTEGER NOT NULL DEFAULT 0,
    slack_webhook        TEXT NOT NULL DEFAULT '',
    telegram_bot_token   TEXT NOT NULL DEFAULT '',
    telegram_chat_id     TEXT NOT NULL DEFAULT '',
    schedule_enabled     INTEGER NOT NULL DEFAULT 0,
    schedule_timezone    TEXT NOT NULL DEFAULT 'UTC',
    schedule_days        TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]',
    schedule_start       INTEGER NOT NULL DEFAULT 0,
    schedule_end         INTEGER NOT NULL DEFAULT 24,
    reddit_credential_id TEXT,
    ai_credential_id     TEXT,
    sort_order           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hits (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    hit_id         TEXT NOT NULL,
    listener_id    TEXT,
    listener_name  TEXT,
    kind           TEXT,
    subreddit      TEXT,
    author         TEXT,
    match_text     TEXT,
    title          TEXT,
    url            TEXT,
    excerpt        TEXT,
    post_id        TEXT,
    ts             REAL,
    filter_passed  INTEGER,
    filter_results TEXT,
    status         TEXT NOT NULL DEFAULT 'new',
    reply_draft    TEXT,
    created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    UNIQUE(hit_id, listener_id)
);

CREATE TABLE IF NOT EXISTS webhook_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    listener_id   TEXT,
    listener_name TEXT,
    wtype         TEXT,
    url           TEXT,
    payload       TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    delivered_at  TEXT
);

CREATE TABLE IF NOT EXISTS system_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    level         TEXT NOT NULL DEFAULT 'info',
    source        TEXT NOT NULL DEFAULT 'system',
    listener_id   TEXT,
    listener_name TEXT,
    message       TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS hits_listener   ON hits(listener_id);
CREATE INDEX IF NOT EXISTS hits_ts         ON hits(ts DESC);
CREATE INDEX IF NOT EXISTS hits_sub        ON hits(subreddit);
CREATE INDEX IF NOT EXISTS syslog_ts       ON system_log(created_at DESC);
CREATE INDEX IF NOT EXISTS webhooklog_ts   ON webhook_log(created_at DESC);
"""


@contextmanager
def _db() -> Generator[sqlite3.Connection, None, None]:
    conn = sqlite3.connect(str(DB_PATH), timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with _db() as db:
        db.executescript(SCHEMA)


def migrate_schema() -> None:
    """Add columns introduced after initial release. Safe to run every startup."""
    cols = [
        ("hits",      "status         TEXT NOT NULL DEFAULT 'new'"),
        ("hits",      "reply_draft    TEXT"),
        ("listeners", "negative_keywords       TEXT NOT NULL DEFAULT '[]'"),
        ("listeners", "min_karma               INTEGER NOT NULL DEFAULT 0"),
        ("listeners", "min_account_age_days    INTEGER NOT NULL DEFAULT 0"),
        ("listeners", "slack_webhook           TEXT NOT NULL DEFAULT ''"),
        ("listeners", "telegram_bot_token      TEXT NOT NULL DEFAULT ''"),
        ("listeners", "telegram_chat_id        TEXT NOT NULL DEFAULT ''"),
        ("listeners", "schedule_enabled        INTEGER NOT NULL DEFAULT 0"),
        ("listeners", "schedule_timezone       TEXT NOT NULL DEFAULT 'UTC'"),
        ("listeners", "schedule_days           TEXT NOT NULL DEFAULT '[0,1,2,3,4,5,6]'"),
        ("listeners", "schedule_start          INTEGER NOT NULL DEFAULT 0"),
        ("listeners", "schedule_end            INTEGER NOT NULL DEFAULT 24"),
    ]
    with _db() as db:
        for table, col_def in cols:
            try:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass  # already exists


# ── Settings ──────────────────────────────────────────────────────────────────
def get_setting(key: str, default: str = "") -> str:
    with _db() as db:
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with _db() as db:
        db.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


# ── System log ────────────────────────────────────────────────────────────────
def db_log(level: str, source: str, message: str,
           listener_id: str | None = None, listener_name: str | None = None) -> None:
    try:
        with _db() as db:
            db.execute(
                "INSERT INTO system_log(level,source,listener_id,listener_name,message) VALUES(?,?,?,?,?)",
                (level, source, listener_id, listener_name, message[:2000]),
            )
    except Exception:
        pass


# ── Config ────────────────────────────────────────────────────────────────────
def _r_key(r: sqlite3.Row, key: str, default=None):
    """Safe row accessor for columns that may not exist on older DBs."""
    try:
        return r[key]
    except (IndexError, KeyError):
        return default


def load_config() -> dict:
    with _db() as db:
        creds = []
        for r in db.execute("SELECT id,type,name,data FROM credentials ORDER BY rowid"):
            c = {"id": r["id"], "type": r["type"], "name": r["name"]}
            c.update(json.loads(r["data"]))
            creds.append(c)

        listeners = []
        for r in db.execute("SELECT * FROM listeners ORDER BY sort_order, rowid"):
            listeners.append({
                "id":                   r["id"],
                "name":                 r["name"],
                "enabled":              bool(r["enabled"]),
                "subreddits":           r["subreddits"],
                "webhook":              r["webhook"],
                "whitelist":            json.loads(r["whitelist"]),
                "keywords":             json.loads(r["keywords"]),
                "filters":              json.loads(r["filters"]),
                "negative_keywords":    json.loads(_r_key(r, "negative_keywords") or "[]"),
                "min_karma":            int(_r_key(r, "min_karma") or 0),
                "min_account_age_days": int(_r_key(r, "min_account_age_days") or 0),
                "slack_webhook":        _r_key(r, "slack_webhook") or "",
                "telegram_bot_token":   _r_key(r, "telegram_bot_token") or "",
                "telegram_chat_id":     _r_key(r, "telegram_chat_id") or "",
                "schedule_enabled":     bool(_r_key(r, "schedule_enabled") or 0),
                "schedule_timezone":    _r_key(r, "schedule_timezone") or "UTC",
                "schedule_days":        json.loads(_r_key(r, "schedule_days") or "[0,1,2,3,4,5,6]"),
                "schedule_start":       int(_r_key(r, "schedule_start") or 0),
                "schedule_end":         int(_r_key(r, "schedule_end") or 24),
                "reddit_credential_id": r["reddit_credential_id"],
                "ai_credential_id":     r["ai_credential_id"],
            })

    return {
        "credentials":    creds,
        "listeners":      listeners,
        "product_context": get_setting("product_context"),
    }


def save_config(cfg: dict) -> None:
    with _db() as db:
        # credentials
        new_ids = {c["id"] for c in cfg.get("credentials", [])}
        old_ids = {r["id"] for r in db.execute("SELECT id FROM credentials")}
        for dead in old_ids - new_ids:
            db.execute("DELETE FROM credentials WHERE id=?", (dead,))
        for c in cfg.get("credentials", []):
            data = {k: v for k, v in c.items() if k not in ("id", "type", "name")}
            db.execute(
                "INSERT INTO credentials(id,type,name,data) VALUES(?,?,?,?) "
                "ON CONFLICT(id) DO UPDATE SET type=excluded.type,name=excluded.name,data=excluded.data",
                (c["id"], c["type"], c["name"], json.dumps(data)),
            )

        # listeners
        new_ids = {l["id"] for l in cfg.get("listeners", [])}
        old_ids = {r["id"] for r in db.execute("SELECT id FROM listeners")}
        for dead in old_ids - new_ids:
            db.execute("DELETE FROM listeners WHERE id=?", (dead,))
        for i, l in enumerate(cfg.get("listeners", [])):
            db.execute(
                """INSERT INTO listeners
                   (id,name,enabled,subreddits,webhook,whitelist,keywords,filters,
                    negative_keywords,min_karma,min_account_age_days,
                    slack_webhook,telegram_bot_token,telegram_chat_id,
                    schedule_enabled,schedule_timezone,schedule_days,schedule_start,schedule_end,
                    reddit_credential_id,ai_credential_id,sort_order)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     name=excluded.name,enabled=excluded.enabled,
                     subreddits=excluded.subreddits,webhook=excluded.webhook,
                     whitelist=excluded.whitelist,keywords=excluded.keywords,
                     filters=excluded.filters,negative_keywords=excluded.negative_keywords,
                     min_karma=excluded.min_karma,min_account_age_days=excluded.min_account_age_days,
                     slack_webhook=excluded.slack_webhook,
                     telegram_bot_token=excluded.telegram_bot_token,
                     telegram_chat_id=excluded.telegram_chat_id,
                     schedule_enabled=excluded.schedule_enabled,
                     schedule_timezone=excluded.schedule_timezone,
                     schedule_days=excluded.schedule_days,
                     schedule_start=excluded.schedule_start,
                     schedule_end=excluded.schedule_end,
                     reddit_credential_id=excluded.reddit_credential_id,
                     ai_credential_id=excluded.ai_credential_id,
                     sort_order=excluded.sort_order""",
                (l["id"], l["name"], 1 if l.get("enabled", True) else 0,
                 l.get("subreddits", "all"), l.get("webhook", ""),
                 json.dumps(l.get("whitelist", [])), json.dumps(l.get("keywords", [])),
                 json.dumps(l.get("filters", [])), json.dumps(l.get("negative_keywords", [])),
                 int(l.get("min_karma", 0) or 0), int(l.get("min_account_age_days", 0) or 0),
                 l.get("slack_webhook", ""), l.get("telegram_bot_token", ""), l.get("telegram_chat_id", ""),
                 1 if l.get("schedule_enabled") else 0,
                 l.get("schedule_timezone", "UTC"),
                 json.dumps(l.get("schedule_days", list(range(7)))),
                 int(l.get("schedule_start", 0)), int(l.get("schedule_end", 24)),
                 l.get("reddit_credential_id"), l.get("ai_credential_id"), i),
            )
        if "product_context" in cfg:
            set_setting("product_context", cfg["product_context"] or "")


def migrate_from_json() -> None:
    """One-time import of legacy config.json."""
    f = Path("config.json")
    if not f.exists():
        return
    try:
        raw = json.loads(f.read_text())
        if "keywords" in raw and "listeners" not in raw:
            raw["listeners"] = [{
                "id": str(_uuid_mod.uuid4()), "name": "Default", "enabled": True,
                "subreddits": raw.pop("subreddits", "all"), "webhook": raw.pop("webhook", ""),
                "whitelist":  raw.pop("whitelist", []),    "keywords": raw.pop("keywords", []),
                "filters":    raw.pop("filters", []),
            }]
        if ("client_id" in raw or "anthropic_key" in raw) and "credentials" not in raw:
            creds: list[dict] = []
            rc_id = ai_id = None
            if raw.get("client_id") or raw.get("client_secret"):
                rc_id = str(_uuid_mod.uuid4())
                creds.append({"id": rc_id, "name": "Default Reddit", "type": "reddit",
                               "client_id": raw.pop("client_id", ""),
                               "client_secret": raw.pop("client_secret", ""),
                               "user_agent": raw.pop("user_agent", "redsignal/1.0")})
            else:
                for k in ("client_id", "client_secret", "user_agent"): raw.pop(k, None)
            if raw.get("anthropic_key"):
                ai_id = str(_uuid_mod.uuid4())
                creds.append({"id": ai_id, "name": "Default Anthropic", "type": "anthropic",
                               "api_key": raw.pop("anthropic_key")})
            else:
                raw.pop("anthropic_key", None)
            raw["credentials"] = creds
            for lst in raw.get("listeners", []):
                if rc_id: lst.setdefault("reddit_credential_id", rc_id)
                if ai_id: lst.setdefault("ai_credential_id", ai_id)
        save_config(raw)
        f.rename("config.json.bak")
        db_log("info", "system", "Migrated config.json → redsignal.db")
    except Exception as exc:
        db_log("warn", "system", f"config.json migration warning: {exc}")


# ── Unified AI provider ───────────────────────────────────────────────────────
def _run_ai_prompt(prompt: str, credential: dict, max_tokens: int = 300) -> str:
    ctype = credential.get("type", "anthropic")

    if ctype == "anthropic":
        import anthropic  # type: ignore
        model  = credential.get("model") or "claude-haiku-4-5-20251001"
        client = anthropic.Anthropic(api_key=credential["api_key"])
        msg    = client.messages.create(model=model, max_tokens=max_tokens,
                                        messages=[{"role": "user", "content": prompt}])
        return msg.content[0].text.strip()

    if ctype in ("openai", "ollama"):
        from openai import OpenAI  # type: ignore
        if ctype == "ollama":
            base   = (credential.get("base_url") or "http://localhost:11434").rstrip("/")
            client = OpenAI(api_key="ollama", base_url=f"{base}/v1/")
            model  = credential.get("model") or "llama3.2"
        else:
            client = OpenAI(api_key=credential["api_key"])
            model  = credential.get("model") or "gpt-4o-mini"
        resp = client.chat.completions.create(model=model, max_tokens=max_tokens,
                                              messages=[{"role": "user", "content": prompt}])
        return resp.choices[0].message.content.strip()

    raise ValueError(f"Unknown credential type: {ctype}")


def _resolve_ai_cred(cfg: dict, credential_id: str | None) -> dict | None:
    if credential_id:
        return next((c for c in cfg.get("credentials", []) if c.get("id") == credential_id), None)
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if key:
        return {"type": "anthropic", "api_key": key}
    return None


# ── Webhook delivery with retry ───────────────────────────────────────────────
MAX_WEBHOOK_ATTEMPTS = 3


def _queue_and_deliver(url: str, payload: dict, listener_id: str, listener_name: str,
                       wtype: str) -> None:
    """Log webhook attempt and deliver immediately; retry loop handles retries."""
    try:
        with _db() as db:
            cur = db.execute(
                "INSERT INTO webhook_log(listener_id,listener_name,wtype,url,payload,status,attempts) "
                "VALUES(?,?,?,?,?,?,?)",
                (listener_id, listener_name, wtype, url, json.dumps(payload), "pending", 0),
            )
            log_id = cur.lastrowid
    except Exception:
        log_id = None

    try:
        r = _http.post(url, data=json.dumps(payload),
                       headers={"Content-Type": "application/json"}, timeout=8)
        r.raise_for_status()
        if log_id:
            with _db() as db:
                db.execute(
                    "UPDATE webhook_log SET status='success', attempts=1, "
                    "delivered_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (log_id,))
        db_log("info", "webhook", f"Delivered [{wtype}] to {url[:60]}", listener_id, listener_name)
    except Exception as exc:
        err = str(exc)[:500]
        if log_id:
            with _db() as db:
                db.execute(
                    "UPDATE webhook_log SET status='retrying', attempts=1, last_error=? WHERE id=?",
                    (err, log_id))
        db_log("warn", "webhook", f"[{wtype}] delivery failed (will retry): {err}",
               listener_id, listener_name)


async def _webhook_retry_loop() -> None:
    """Pick up failed webhooks and retry up to MAX_WEBHOOK_ATTEMPTS total."""
    while True:
        await asyncio.sleep(30)
        try:
            with _db() as db:
                rows = db.execute(
                    "SELECT * FROM webhook_log WHERE status='retrying' "
                    f"AND attempts < {MAX_WEBHOOK_ATTEMPTS} ORDER BY id LIMIT 20"
                ).fetchall()
            for r in rows:
                attempt = r["attempts"] + 1
                try:
                    resp = _http.post(r["url"],
                                      data=r["payload"],
                                      headers={"Content-Type": "application/json"},
                                      timeout=10)
                    resp.raise_for_status()
                    with _db() as db:
                        db.execute(
                            "UPDATE webhook_log SET status='success', attempts=?, "
                            "delivered_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?",
                            (attempt, r["id"]))
                    db_log("info", "webhook",
                           f"Retry {attempt} succeeded [{r['wtype']}]",
                           r["listener_id"], r["listener_name"])
                except Exception as exc:
                    err    = str(exc)[:500]
                    final  = attempt >= MAX_WEBHOOK_ATTEMPTS
                    status = "failed" if final else "retrying"
                    with _db() as db:
                        db.execute(
                            "UPDATE webhook_log SET status=?, attempts=?, last_error=? WHERE id=?",
                            (status, attempt, err, r["id"]))
                    if final:
                        db_log("error", "webhook",
                               f"Permanently failed after {attempt} attempts [{r['wtype']}]: {err}",
                               r["listener_id"], r["listener_name"])
        except Exception as exc:
            db_log("error", "system", f"Retry loop error: {exc}")


# ── Hit storage ───────────────────────────────────────────────────────────────
def db_save_hit(hit: dict) -> None:
    try:
        with _db() as db:
            db.execute(
                """INSERT OR IGNORE INTO hits
                   (hit_id,listener_id,listener_name,kind,subreddit,author,
                    match_text,title,url,excerpt,post_id,ts)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (hit["id"], hit.get("listener_id"), hit.get("listener_name"),
                 hit.get("kind"), hit.get("subreddit"), hit.get("author"),
                 hit.get("match"), hit.get("title"), hit.get("url"),
                 hit.get("excerpt"), hit.get("post_id"), hit.get("ts")),
            )
    except Exception as exc:
        db_log("error", "system", f"db_save_hit: {exc}")


def db_update_filter(hit_id: str, listener_id: str | None, passed: bool, results: list) -> None:
    try:
        with _db() as db:
            if listener_id:
                db.execute(
                    "UPDATE hits SET filter_passed=?,filter_results=? WHERE hit_id=? AND listener_id=?",
                    (1 if passed else 0, json.dumps(results), hit_id, listener_id))
            else:
                db.execute(
                    "UPDATE hits SET filter_passed=?,filter_results=? WHERE hit_id=?",
                    (1 if passed else 0, json.dumps(results), hit_id))
    except Exception as exc:
        db_log("error", "system", f"db_update_filter: {exc}")


def _row_to_hit(r: sqlite3.Row) -> dict:
    fr = None
    if r["filter_passed"] is not None:
        fr = {"passed": bool(r["filter_passed"]),
              "results": json.loads(r["filter_results"]) if r["filter_results"] else []}
    keys = r.keys()
    return {
        "type":          "hit",
        "id":            r["hit_id"],
        "listener_id":   r["listener_id"],
        "listener_name": r["listener_name"],
        "kind":          r["kind"],
        "subreddit":     r["subreddit"],
        "author":        r["author"],
        "match":         r["match_text"],
        "title":         r["title"],
        "url":           r["url"],
        "excerpt":       r["excerpt"],
        "post_id":       r["post_id"],
        "ts":            r["ts"],
        "filter_result": fr,
        "status":        r["status"] if "status" in keys else "new",
        "reply_draft":   r["reply_draft"] if "reply_draft" in keys else None,
        "created_at":    r["created_at"],
    }


# ── Author quality cache ──────────────────────────────────────────────────────
_author_cache: dict[str, dict] = {}


def _passes_author_quality(author, min_karma: int, min_age_days: int) -> bool:
    if author is None:
        return False
    name  = str(author)
    now   = time.time()
    cached = _author_cache.get(name)
    if cached and now - cached["t"] < 3600:
        data = cached
    else:
        try:
            karma   = (getattr(author, "comment_karma", 0) or 0) + (getattr(author, "link_karma", 0) or 0)
            created = getattr(author, "created_utc", now)
            data    = {"karma": karma, "created": created, "t": now}
            _author_cache[name] = data
        except Exception:
            return True
    if min_karma > 0 and data["karma"] < min_karma:
        return False
    if min_age_days > 0 and (now - data["created"]) / 86400 < min_age_days:
        return False
    return True


# ── Schedule helper ───────────────────────────────────────────────────────────
def _in_schedule(listener: dict) -> bool:
    if not listener.get("schedule_enabled"):
        return True
    try:
        import zoneinfo, datetime  # type: ignore
        tz   = zoneinfo.ZoneInfo(listener.get("schedule_timezone") or "UTC")
        now  = datetime.datetime.now(tz)
        days = listener.get("schedule_days", list(range(7)))
        if now.weekday() not in days:
            return False
        start = int(listener.get("schedule_start", 0))
        end   = int(listener.get("schedule_end", 24))
        return start <= now.hour < end
    except Exception:
        return True  # bad timezone → don't block monitoring


# ── In-memory hit buffer ──────────────────────────────────────────────────────
_hit_history: deque[dict] = deque(maxlen=500)


def seed_hit_history() -> None:
    with _db() as db:
        rows = db.execute("SELECT * FROM hits ORDER BY ts DESC LIMIT 200").fetchall()
    for r in reversed(rows):
        _hit_history.append(_row_to_hit(r))


# ── WebSocket manager ─────────────────────────────────────────────────────────
class _Manager:
    def __init__(self) -> None:
        self._sockets: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._sockets.append(ws)
        for hit in _hit_history:
            try:
                await ws.send_json(hit)
            except Exception:
                break

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._sockets:
            self._sockets.remove(ws)

    async def broadcast(self, data: dict) -> None:
        dead: list[WebSocket] = []
        for ws in self._sockets:
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            if ws in self._sockets:
                self._sockets.remove(ws)


_manager  = _Manager()
_hit_queue: queue.Queue[dict] = queue.Queue()


async def _queue_broadcaster() -> None:
    loop = asyncio.get_event_loop()
    while True:
        try:
            item = _hit_queue.get_nowait()
            if item.get("type") == "hit":
                _hit_history.append(item)
                loop.run_in_executor(None, db_save_hit, item)
            await _manager.broadcast(item)
        except queue.Empty:
            await asyncio.sleep(0.05)
        except Exception:
            await asyncio.sleep(0.1)


# ── Monitor threads ───────────────────────────────────────────────────────────
_monitors:    dict[str, threading.Thread] = {}
_stop_events: dict[str, threading.Event]  = {}


def _run_listener(listener: dict, credentials: list[dict]) -> None:
    lid   = listener["id"]
    lname = listener.get("name", lid)

    def _err(msg: str) -> None:
        _hit_queue.put({"type": "error", "listener_id": lid, "listener_name": lname, "message": msg})
        db_log("error", "monitor", msg, lid, lname)

    def _status(msg: str) -> None:
        _hit_queue.put({"type": "status", "listener_id": lid, "listener_name": lname, "message": msg})
        db_log("info", "monitor", msg, lid, lname)

    reddit_cred = next(
        (c for c in credentials if c.get("id") == listener.get("reddit_credential_id")
         and c.get("type") == "reddit"), None)
    if not reddit_cred or not reddit_cred.get("client_id") or not reddit_cred.get("client_secret"):
        _err(f"[{lname}] No Reddit account assigned — edit listener and pick one from Vault")
        return

    try:
        import praw  # type: ignore
    except ImportError:
        _err("praw not installed — run: pip install praw")
        return

    kws = [k for k in listener.get("keywords", []) if k.strip()]
    if not kws:
        _err(f"[{lname}] No keywords configured")
        return

    try:
        pattern = re.compile(
            r"(?<![A-Za-z0-9])(?:" + "|".join(kws) + r")(?![A-Za-z0-9])",
            re.IGNORECASE)
    except re.error as exc:
        _err(f"[{lname}] Invalid regex: {exc}"); return

    neg_pattern: re.Pattern | None = None
    neg_kws = [k for k in listener.get("negative_keywords", []) if k.strip()]
    if neg_kws:
        try:
            neg_pattern = re.compile("|".join(neg_kws), re.IGNORECASE)
        except re.error as exc:
            _err(f"[{lname}] Invalid negative keyword regex: {exc}"); return

    try:
        reddit = praw.Reddit(
            client_id=reddit_cred["client_id"],
            client_secret=reddit_cred["client_secret"],
            user_agent=reddit_cred.get("user_agent") or "redsignal/1.0",
            check_for_async=False)
    except Exception as exc:
        _err(f"[{lname}] Reddit auth failed: {exc}"); return

    whitelist      = {s.strip().lower() for s in listener.get("whitelist", []) if s.strip()}
    subreddits_str = listener.get("subreddits") or "all"
    webhook        = (listener.get("webhook")           or "").strip()
    slack_url      = (listener.get("slack_webhook")     or "").strip()
    tg_token       = (listener.get("telegram_bot_token") or "").strip()
    tg_chat_id     = (listener.get("telegram_chat_id")  or "").strip()
    min_karma      = int(listener.get("min_karma", 0) or 0)
    min_age_days   = int(listener.get("min_account_age_days", 0) or 0)
    check_author   = min_karma > 0 or min_age_days > 0

    try:
        subs         = reddit.subreddit(subreddits_str)
        comments_gen = subs.stream.comments(skip_existing=True)
        posts_gen    = subs.stream.submissions(skip_existing=True)
    except Exception as exc:
        _err(f"[{lname}] Subreddit error: {exc}"); return

    stop       = _stop_events.get(lid, threading.Event())
    was_paused = False

    def _emit(kind: str, item, text: str, title: str, post_id: str) -> None:
        m = pattern.search(text or "")
        if not m:
            return
        if neg_pattern and neg_pattern.search(text or ""):
            return
        sub_name = str(item.subreddit)  # type: ignore[attr-defined]
        if whitelist and sub_name.lower() not in whitelist:
            return
        if check_author and not _passes_author_quality(
                getattr(item, "author", None), min_karma, min_age_days):
            return

        url     = f"https://reddit.com{item.permalink}" if hasattr(item, "permalink") else ""  # type: ignore
        excerpt = (text or "")[:300].replace("\n", " ")
        hit = {
            "type":          "hit",
            "listener_id":   lid,
            "listener_name": lname,
            "kind":          kind,
            "subreddit":     sub_name,
            "id":            item.id,  # type: ignore
            "author":        str(getattr(item, "author", "") or ""),
            "match":         m.group(0),
            "title":         title,
            "url":           url,
            "excerpt":       excerpt,
            "post_id":       post_id,
            "ts":            time.time(),
        }
        _hit_queue.put(hit)

        if webhook:
            _queue_and_deliver(webhook, hit, lid, lname, "generic")

        if slack_url:
            _queue_and_deliver(slack_url, {"blocks": [
                {"type": "header", "text": {"type": "plain_text",
                    "text": f"🔴 {lname} — r/{sub_name}"}},
                {"type": "section", "text": {"type": "mrkdwn",
                    "text": f"*{title or '(comment)'}*\nby u/{hit['author']}  ·  keyword: `{m.group(0)}`"}},
                {"type": "section", "text": {"type": "mrkdwn", "text": f"_{excerpt[:280]}_"}},
                {"type": "actions", "elements": [{"type": "button", "style": "primary",
                    "text": {"type": "plain_text", "text": "👀 View on Reddit"}, "url": url}]},
            ]}, lid, lname, "slack")

        if tg_token and tg_chat_id:
            icon = "📝" if kind == "post" else "💬"
            _queue_and_deliver(
                f"https://api.telegram.org/bot{tg_token}/sendMessage",
                {"chat_id": tg_chat_id, "parse_mode": "Markdown",
                 "disable_web_page_preview": True,
                 "text": (f"🔴 *{lname}* — r/{sub_name}\n\n"
                          f"{icon} *{title or '(comment)'}*\nby u/{hit['author']}\n\n"
                          f"Keyword: `{m.group(0)}`\n_{excerpt[:280]}_\n\n[Open]({url})")},
                lid, lname, "telegram")

    _status(f"[{lname}] Monitoring r/{subreddits_str}…")

    while not stop.is_set():
        # ── Schedule check ──
        if not _in_schedule(listener):
            if not was_paused:
                _status(f"[{lname}] Outside schedule window — pausing")
                was_paused = True
            time.sleep(60)
            continue
        if was_paused:
            _status(f"[{lname}] Entering schedule window — resuming")
            was_paused = False
            # Reinitialise streams to skip missed posts
            try:
                comments_gen = subs.stream.comments(skip_existing=True)
                posts_gen    = subs.stream.submissions(skip_existing=True)
            except Exception as exc:
                _err(f"[{lname}] Failed to reopen streams: {exc}")
                time.sleep(30)
                continue

        try:
            for _ in range(20):
                if stop.is_set(): return
                c = next(comments_gen)
                _emit("comment", c, getattr(c, "body", ""), getattr(c, "link_title", ""), c.submission.id)
            for _ in range(10):
                if stop.is_set(): return
                s = next(posts_gen)
                _emit("post", s, (s.title or "") + " " + (s.selftext or ""), s.title or "", s.id)
        except StopIteration:
            time.sleep(1)
        except Exception as exc:
            if not stop.is_set():
                _err(f"[{lname}] Stream error: {exc}")
                time.sleep(15)

    db_log("info", "monitor", f"[{lname}] Stopped", lid, lname)


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def _startup() -> None:
    init_db()
    migrate_schema()
    migrate_from_json()
    seed_hit_history()
    asyncio.create_task(_queue_broadcaster())
    asyncio.create_task(_webhook_retry_loop())
    db_log("info", "system", "RedSignal started")


# ── Config API ────────────────────────────────────────────────────────────────
@app.get("/api/config")
def api_get_config() -> dict:
    return load_config()


@app.post("/api/config")
def api_save_config(payload: dict) -> dict:
    cfg = load_config()
    cfg.update(payload)
    save_config(cfg)
    return {"ok": True}


# ── Monitor API ───────────────────────────────────────────────────────────────
@app.get("/api/listeners/status")
def api_listeners_status() -> dict:
    return {lid: t.is_alive() for lid, t in _monitors.items()}


def _start_listener(listener: dict, credentials: list[dict]) -> bool:
    lid = listener["id"]
    if lid in _monitors and _monitors[lid].is_alive():
        return False
    stop = threading.Event()
    _stop_events[lid] = stop
    t = threading.Thread(target=_run_listener, args=(listener, credentials),
                         daemon=True, name=f"rs-{lid[:8]}")
    _monitors[lid] = t
    t.start()
    return True


@app.post("/api/listeners/{listener_id}/start")
def api_start_listener(listener_id: str) -> dict:
    cfg = load_config()
    lst = next((l for l in cfg.get("listeners", []) if l["id"] == listener_id), None)
    if not lst:
        return {"ok": False, "message": "Listener not found"}
    _start_listener(lst, cfg.get("credentials", []))
    return {"ok": True}


@app.post("/api/listeners/{listener_id}/stop")
def api_stop_listener(listener_id: str) -> dict:
    if listener_id in _stop_events:
        _stop_events[listener_id].set()
    return {"ok": True}


@app.post("/api/monitor/start")
def api_start_all() -> dict:
    cfg   = load_config()
    creds = cfg.get("credentials", [])
    started = [l.get("name", l["id"])
               for l in cfg.get("listeners", [])
               if l.get("enabled", True) and _start_listener(l, creds)]
    return {"ok": True, "started": started}


@app.post("/api/monitor/stop")
def api_stop_all() -> dict:
    for ev in _stop_events.values():
        ev.set()
    return {"ok": True}


# ── Hits API ──────────────────────────────────────────────────────────────────
@app.get("/api/hits")
def api_get_hits(listener_id: str = "", kind: str = "", subreddit: str = "",
                 q: str = "", limit: int = 50, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if listener_id: conds.append("listener_id=?");           params.append(listener_id)
    if kind:        conds.append("kind=?");                  params.append(kind)
    if subreddit:   conds.append("subreddit LIKE ?");        params.append(f"%{subreddit}%")
    if q:
        conds.append("(title LIKE ? OR excerpt LIKE ? OR match_text LIKE ? OR author LIKE ?)")
        params.extend([f"%{q}%"] * 4)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with _db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM hits {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM hits {where} ORDER BY ts DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {"hits": [_row_to_hit(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@app.patch("/api/hits/{hit_id}/status")
def api_hit_status(hit_id: str, payload: dict) -> dict:
    status = payload.get("status", "new")
    lid    = payload.get("listener_id")
    with _db() as db:
        if lid:
            db.execute("UPDATE hits SET status=? WHERE hit_id=? AND listener_id=?", (status, hit_id, lid))
        else:
            db.execute("UPDATE hits SET status=? WHERE hit_id=?", (status, hit_id))
    return {"ok": True}


@app.patch("/api/hits/{hit_id}/reply")
def api_hit_reply(hit_id: str, payload: dict) -> dict:
    reply = payload.get("reply", "")
    lid   = payload.get("listener_id")
    with _db() as db:
        if lid:
            db.execute("UPDATE hits SET reply_draft=?,status='replied' WHERE hit_id=? AND listener_id=?",
                       (reply, hit_id, lid))
        else:
            db.execute("UPDATE hits SET reply_draft=?,status='replied' WHERE hit_id=?", (reply, hit_id))
    return {"ok": True}


@app.patch("/api/hits/{hit_id}")
def api_update_hit(hit_id: str, payload: dict) -> dict:
    db_update_filter(hit_id, payload.get("listener_id"), payload.get("passed", False), payload.get("results", []))
    return {"ok": True}


@app.delete("/api/hits")
def api_clear_hits() -> dict:
    with _db() as db:
        db.execute("DELETE FROM hits")
    _hit_history.clear()
    return {"ok": True}


@app.get("/api/hits/stats")
def api_hits_stats() -> dict:
    with _db() as db:
        total   = db.execute("SELECT COUNT(*) FROM hits").fetchone()[0]
        today   = db.execute("SELECT COUNT(*) FROM hits WHERE created_at >= date('now')").fetchone()[0]
        passed  = db.execute("SELECT COUNT(*) FROM hits WHERE filter_passed=1").fetchone()[0]
        by_lst  = db.execute("SELECT listener_name,COUNT(*) as cnt FROM hits GROUP BY listener_id ORDER BY cnt DESC LIMIT 10").fetchall()
        by_sub  = db.execute("SELECT subreddit,COUNT(*) as cnt FROM hits GROUP BY subreddit ORDER BY cnt DESC LIMIT 10").fetchall()
    return {"total": total, "today": today, "passed": passed,
            "by_listener": [{"name": r["listener_name"], "count": r["cnt"]} for r in by_lst],
            "by_subreddit": [{"subreddit": r["subreddit"], "count": r["cnt"]} for r in by_sub]}


@app.get("/api/hits/export")
def api_export_hits(listener_id: str = "", kind: str = "") -> StreamingResponse:
    conds: list[str] = []
    params: list     = []
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    if kind:        conds.append("kind=?");         params.append(kind)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with _db() as db:
        rows = db.execute(f"SELECT * FROM hits {where} ORDER BY ts DESC", params).fetchall()

    def _gen():
        yield "ts,listener,kind,subreddit,author,match,title,url,excerpt,filter_passed,status\n"
        for r in rows:
            def q(v): return '"' + str(v or "").replace('"', '""') + '"'
            fp = "" if r["filter_passed"] is None else ("yes" if r["filter_passed"] else "no")
            yield ",".join([q(r["created_at"]), q(r["listener_name"]), q(r["kind"]),
                            q(r["subreddit"]), q(r["author"]), q(r["match_text"]),
                            q(r["title"]), q(r["url"]), q(r["excerpt"]), q(fp),
                            q(r["status"] if "status" in r.keys() else "new")]) + "\n"

    return StreamingResponse(_gen(), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=redsignal_hits.csv"})


# ── AI filter ─────────────────────────────────────────────────────────────────
class _FilterReq(BaseModel):
    text:          str
    filters:       list[dict]
    credential_id: str | None = None
    hit_id:        str | None = None
    listener_id:   str | None = None


@app.post("/api/filter/test")
def api_filter_test(req: _FilterReq) -> dict:
    cfg  = load_config()
    cred = _resolve_ai_cred(cfg, req.credential_id)
    if not cred:
        return {"error": "No AI key configured — add one in Vault"}

    results: list[dict] = []
    passed  = True

    for step in req.filters:
        if not step.get("enabled", True):
            results.append({"step": step.get("name", "?"), "skipped": True})
            continue
        try:
            response = _run_ai_prompt(step["prompt"] + "\n\nContent:\n" + req.text, cred)
            is_pass  = not re.search(r"\bno\b|\breject\b|\bfalse\b|\birrelevant\b", response, re.IGNORECASE)
            results.append({"step": step.get("name", "?"), "response": response, "passed": is_pass})
            if not is_pass:
                passed = False; break
        except Exception as exc:
            db_log("error", "filter", str(exc), req.listener_id)
            results.append({"step": step.get("name", "?"), "error": str(exc), "passed": False})
            passed = False; break

    if req.hit_id:
        db_update_filter(req.hit_id, req.listener_id, passed, results)

    return {"results": results, "passed": passed}


# ── Reply drafting ────────────────────────────────────────────────────────────
class _DraftReq(BaseModel):
    title:           str = ""
    excerpt:         str = ""
    subreddit:       str = ""
    product_context: str = ""
    tone:            str = "helpful"
    credential_id:   str | None = None


@app.post("/api/reply/draft")
def api_draft_reply(req: _DraftReq) -> dict:
    cfg  = load_config()
    cred = _resolve_ai_cred(cfg, req.credential_id)
    if not cred:
        return {"error": "No AI key configured — add one in Vault"}

    tones = {
        "helpful":      "Be genuinely helpful. Add real value before mentioning your product.",
        "casual":       "Write like a regular Redditor. Conversational, not corporate.",
        "professional": "Professional but warm. Not stiff or salesy.",
        "direct":       "Get to the point. Concise and confident.",
    }
    prompt = (f"Write a Reddit reply. Rules:\n- Sound like a real person, not a marketer\n"
              f"- If product context is relevant weave it in naturally — never force it\n"
              f"- 2-4 sentences max\n- Do NOT start with 'Great question!' or 'As someone who...'\n"
              f"- Tone: {tones.get(req.tone, tones['helpful'])}\n\n"
              f"Your product/context:\n{req.product_context or '(none)'}\n\n"
              f"Post from r/{req.subreddit}:\nTitle: {req.title}\nContent: {req.excerpt}\n\n"
              f"Write only the reply. No preamble.")
    try:
        return {"reply": _run_ai_prompt(prompt, cred, max_tokens=400)}
    except Exception as exc:
        return {"error": str(exc)}


# ── Thread view ───────────────────────────────────────────────────────────────
@app.get("/api/reddit/thread")
def api_reddit_thread(post_id: str, listener_id: str = "") -> dict:
    cfg         = load_config()
    reddit_cred = None
    if listener_id:
        lst = next((l for l in cfg.get("listeners", []) if l["id"] == listener_id), None)
        if lst:
            reddit_cred = next((c for c in cfg.get("credentials", [])
                                if c.get("id") == lst.get("reddit_credential_id")), None)
    if not reddit_cred:
        reddit_cred = next((c for c in cfg.get("credentials", []) if c.get("type") == "reddit"), None)
    if not reddit_cred or not reddit_cred.get("client_id"):
        return {"error": "No Reddit credentials available"}
    try:
        import praw  # type: ignore
        reddit = praw.Reddit(client_id=reddit_cred["client_id"],
                             client_secret=reddit_cred["client_secret"],
                             user_agent=reddit_cred.get("user_agent") or "redsignal/1.0",
                             check_for_async=False)
        sub = reddit.submission(id=post_id)
        sub.comments.replace_more(limit=0)
        comments = [{"id": c.id, "author": str(c.author or "[deleted]"),
                     "body": c.body[:800], "score": c.score}
                    for c in list(sub.comments)[:20]]
        return {"post_id": post_id, "title": sub.title,
                "selftext": sub.selftext[:3000] if sub.selftext else "",
                "author": str(sub.author or "[deleted]"), "subreddit": str(sub.subreddit),
                "score": sub.score, "num_comments": sub.num_comments,
                "url": f"https://reddit.com{sub.permalink}", "comments": comments}
    except Exception as exc:
        return {"error": str(exc)}


# ── Notify endpoint ───────────────────────────────────────────────────────────
class _NotifyReq(BaseModel):
    listener_id:    str
    title:          str = ""
    url:            str = ""
    subreddit:      str = ""
    author:         str = ""
    match:          str = ""
    excerpt:        str = ""
    filter_results: list[dict] = []


@app.post("/api/notify")
def api_notify(req: _NotifyReq) -> dict:
    cfg = load_config()
    lst = next((l for l in cfg.get("listeners", []) if l["id"] == req.listener_id), None)
    if not lst:
        return {"ok": False, "error": "Listener not found"}

    slack_url  = (lst.get("slack_webhook")      or "").strip()
    tg_token   = (lst.get("telegram_bot_token") or "").strip()
    tg_chat_id = (lst.get("telegram_chat_id")   or "").strip()
    sent: list[str] = []

    steps = "  ·  ".join(
        f"{'✅' if r.get('passed') else '❌'} {r['step']}"
        for r in req.filter_results if not r.get("skipped"))

    if slack_url:
        payload = {"blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": f"✅ Lead passed filter — r/{req.subreddit}"}},
            {"type": "section", "text": {"type": "mrkdwn",
                "text": f"*{req.title or '(comment)'}*\nby u/{req.author}  ·  keyword: `{req.match}`"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": f"_{req.excerpt[:280]}_"}},
            *([ {"type": "context", "elements": [{"type": "mrkdwn", "text": steps}]} ] if steps else []),
            {"type": "actions", "elements": [{"type": "button", "style": "primary",
                "text": {"type": "plain_text", "text": "👀 View on Reddit"}, "url": req.url}]},
        ]}
        _queue_and_deliver(slack_url, payload, req.listener_id, lst.get("name",""), "slack-ai")
        sent.append("slack")

    if tg_token and tg_chat_id:
        step_lines = "\n".join(f"{'✅' if r.get('passed') else '❌'} {r['step']}: {r.get('response','')[:60]}"
                                for r in req.filter_results if not r.get("skipped"))
        payload = {
            "chat_id": tg_chat_id, "parse_mode": "Markdown", "disable_web_page_preview": False,
            "text": (f"✅ *Lead passed filter — r/{req.subreddit}*\n\n"
                     f"*{req.title or '(comment)'}*\nby u/{req.author}\n\n"
                     f"Keyword: `{req.match}`\n_{req.excerpt[:280]}_"
                     + (f"\n\n{step_lines}" if step_lines else "")
                     + f"\n\n[Open on Reddit]({req.url})")
        }
        _queue_and_deliver(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                           payload, req.listener_id, lst.get("name",""), "telegram-ai")
        sent.append("telegram")

    return {"ok": True, "sent": sent}


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/api/health")
def api_health() -> dict:
    now = time.time()
    with _db() as db:
        rows = db.execute(
            "SELECT listener_id,listener_name,MAX(ts) as last_ts,"
            "SUM(CASE WHEN ts >= ? THEN 1 ELSE 0 END) as cnt_5m "
            "FROM hits GROUP BY listener_id", (now - 300,)).fetchall()
    stats: list[dict] = []
    seen:  set[str]   = set()
    for r in rows:
        lid = r["listener_id"] or ""
        seen.add(lid)
        stats.append({"listener_id": lid, "name": r["listener_name"] or lid[:8] or "?",
                       "running": lid in _monitors and _monitors[lid].is_alive(),
                       "last_ts": r["last_ts"], "per_min": round((r["cnt_5m"] or 0) / 5, 1)})
    cfg = load_config()
    for l in cfg.get("listeners", []):
        if l["id"] not in seen and l["id"] in _monitors and _monitors[l["id"]].is_alive():
            stats.append({"listener_id": l["id"], "name": l["name"],
                           "running": True, "last_ts": None, "per_min": 0.0})
    return {"listeners": stats, "now": now}


# ── Stats ─────────────────────────────────────────────────────────────────────
@app.get("/api/stats")
def api_stats(days: int = 30) -> dict:
    from datetime import datetime, timedelta, timezone
    ts_cond = f"ts >= strftime('%s','now','-{days} days')" if days > 0 else "1=1"
    with _db() as db:
        ov = db.execute(f"""SELECT COUNT(*) as total,
            SUM(CASE WHEN kind='post' THEN 1 ELSE 0 END) as posts,
            SUM(CASE WHEN kind='comment' THEN 1 ELSE 0 END) as comments,
            SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed,
            SUM(CASE WHEN filter_passed IS NOT NULL THEN 1 ELSE 0 END) as filtered,
            COUNT(DISTINCT subreddit) as unique_subs,
            COUNT(DISTINCT author) as unique_authors FROM hits WHERE {ts_cond}""").fetchone()
        tl_rows = db.execute(
            f"SELECT date(datetime(ts,'unixepoch')) as day,COUNT(*) as total,"
            f"SUM(CASE WHEN kind='post' THEN 1 ELSE 0 END) as posts,"
            f"SUM(CASE WHEN kind='comment' THEN 1 ELSE 0 END) as comments,"
            f"SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed "
            f"FROM hits WHERE {ts_cond} GROUP BY day ORDER BY day").fetchall()
        by_sub  = db.execute(f"SELECT subreddit,COUNT(*) as cnt,SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed FROM hits WHERE {ts_cond} AND subreddit IS NOT NULL AND subreddit != '' GROUP BY subreddit ORDER BY cnt DESC LIMIT 15").fetchall()
        by_kw   = db.execute(f"SELECT LOWER(match_text) as kw,COUNT(*) as cnt FROM hits WHERE {ts_cond} AND match_text IS NOT NULL AND match_text != '' GROUP BY LOWER(match_text) ORDER BY cnt DESC LIMIT 15").fetchall()
        by_lst  = db.execute(f"SELECT COALESCE(listener_name,'Unknown') as name,COUNT(*) as cnt,SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed,SUM(CASE WHEN filter_passed=0 THEN 1 ELSE 0 END) as rejected FROM hits WHERE {ts_cond} GROUP BY listener_id ORDER BY cnt DESC").fetchall()
        by_hour = db.execute(f"SELECT CAST(strftime('%H',datetime(ts,'unixepoch')) AS INTEGER) as hour,COUNT(*) as cnt FROM hits WHERE {ts_cond} GROUP BY hour ORDER BY hour").fetchall()
        by_dow  = db.execute(f"SELECT CAST(strftime('%w',datetime(ts,'unixepoch')) AS INTEGER) as dow,COUNT(*) as cnt FROM hits WHERE {ts_cond} GROUP BY dow ORDER BY dow").fetchall()
        by_month = db.execute("SELECT strftime('%Y-%m',datetime(ts,'unixepoch')) as month,COUNT(*) as total,SUM(CASE WHEN kind='post' THEN 1 ELSE 0 END) as posts,SUM(CASE WHEN kind='comment' THEN 1 ELSE 0 END) as comments,SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed FROM hits GROUP BY month ORDER BY month DESC LIMIT 24").fetchall()
        top_auth = db.execute(f"SELECT author,COUNT(*) as cnt,SUM(CASE WHEN kind='post' THEN 1 ELSE 0 END) as posts,SUM(CASE WHEN kind='comment' THEN 1 ELSE 0 END) as comments,SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END) as passed FROM hits WHERE {ts_cond} AND author IS NOT NULL AND author NOT IN ('','None','[deleted]') GROUP BY author ORDER BY cnt DESC LIMIT 10").fetchall()
        sub_pass = db.execute(f"SELECT subreddit,COUNT(*) as cnt,ROUND(100.0*SUM(CASE WHEN filter_passed=1 THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN filter_passed IS NOT NULL THEN 1 ELSE 0 END),0),1) as rate FROM hits WHERE {ts_cond} AND subreddit IS NOT NULL AND filter_passed IS NOT NULL GROUP BY subreddit HAVING cnt >= 3 ORDER BY rate DESC LIMIT 10").fetchall()

    tl_map   = {r["day"]: dict(r) for r in tl_rows}
    timeline = []
    if days > 0:
        start = datetime.now(timezone.utc) - timedelta(days=days - 1)
        for i in range(days):
            d = (start + timedelta(days=i)).strftime("%Y-%m-%d")
            timeline.append(tl_map.get(d, {"day": d, "total": 0, "posts": 0, "comments": 0, "passed": 0}))
    else:
        timeline = [dict(r) for r in tl_rows]

    h_map = {r["hour"]: r["cnt"] for r in by_hour}
    d_map = {r["dow"]:  r["cnt"] for r in by_dow}
    total    = ov["total"] or 0
    filtered = ov["filtered"] or 0
    passed_n = ov["passed"] or 0

    return {
        "overview": {"total": total, "posts": ov["posts"] or 0, "comments": ov["comments"] or 0,
                     "passed": passed_n, "filtered": filtered,
                     "pass_rate": round(passed_n / filtered * 100, 1) if filtered > 0 else None,
                     "unique_subs": ov["unique_subs"] or 0, "unique_authors": ov["unique_authors"] or 0},
        "timeline":     timeline,
        "by_subreddit": [{"name": r["subreddit"], "count": r["cnt"], "passed": r["passed"] or 0} for r in by_sub],
        "by_keyword":   [{"keyword": r["kw"], "count": r["cnt"]} for r in by_kw],
        "by_listener":  [{"name": r["name"], "count": r["cnt"], "passed": r["passed"] or 0, "rejected": r["rejected"] or 0} for r in by_lst],
        "by_hour":      [{"hour": h, "count": h_map.get(h, 0)} for h in range(24)],
        "by_dow":       [{"dow": d, "count": d_map.get(d, 0)} for d in range(7)],
        "by_month":     [{"month": r["month"], "total": r["total"], "posts": r["posts"] or 0, "comments": r["comments"] or 0, "passed": r["passed"] or 0} for r in by_month],
        "top_authors":  [{"author": r["author"], "count": r["cnt"], "posts": r["posts"] or 0, "comments": r["comments"] or 0, "passed": r["passed"] or 0} for r in top_auth],
        "sub_pass":     [{"name": r["subreddit"], "rate": r["rate"], "count": r["cnt"]} for r in sub_pass],
    }


# ── Logs API ──────────────────────────────────────────────────────────────────
@app.get("/api/logs/system")
def api_system_logs(level: str = "", source: str = "", listener_id: str = "",
                    limit: int = 100, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if level:       conds.append("level=?");       params.append(level)
    if source:      conds.append("source=?");      params.append(source)
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with _db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM system_log {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM system_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {
        "logs": [{"id": r["id"], "level": r["level"], "source": r["source"],
                  "listener_id": r["listener_id"], "listener_name": r["listener_name"],
                  "message": r["message"], "created_at": r["created_at"]} for r in rows],
        "total": total,
    }


@app.get("/api/logs/webhooks")
def api_webhook_logs(status: str = "", listener_id: str = "",
                     limit: int = 100, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if status:      conds.append("status=?");      params.append(status)
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with _db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM webhook_log {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM webhook_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {
        "logs": [{"id": r["id"], "listener_id": r["listener_id"], "listener_name": r["listener_name"],
                  "wtype": r["wtype"], "url": (r["url"] or "")[:60] + "…" if len(r["url"] or "") > 60 else r["url"],
                  "status": r["status"], "attempts": r["attempts"], "last_error": r["last_error"],
                  "created_at": r["created_at"], "delivered_at": r["delivered_at"]} for r in rows],
        "total": total,
    }


@app.post("/api/logs/webhooks/{log_id}/retry")
def api_retry_webhook(log_id: int) -> dict:
    with _db() as db:
        row = db.execute("SELECT * FROM webhook_log WHERE id=?", (log_id,)).fetchone()
    if not row:
        return {"ok": False, "error": "Not found"}
    try:
        r = _http.post(row["url"], data=row["payload"],
                       headers={"Content-Type": "application/json"}, timeout=10)
        r.raise_for_status()
        with _db() as db:
            db.execute("UPDATE webhook_log SET status='success',attempts=attempts+1,"
                       "delivered_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (log_id,))
        db_log("info", "webhook", f"Manual retry succeeded [{row['wtype']}]",
               row["listener_id"], row["listener_name"])
        return {"ok": True}
    except Exception as exc:
        with _db() as db:
            db.execute("UPDATE webhook_log SET attempts=attempts+1,last_error=? WHERE id=?",
                       (str(exc)[:500], log_id))
        return {"ok": False, "error": str(exc)}


# ── Settings API ──────────────────────────────────────────────────────────────
@app.get("/api/settings/{key}")
def api_get_setting(key: str) -> dict:
    return {"value": get_setting(key)}


@app.put("/api/settings/{key}")
def api_set_setting(key: str, payload: dict) -> dict:
    set_setting(key, payload.get("value", ""))
    return {"ok": True}


# ── Logs (file-based, for Docker service mode) ────────────────────────────────
@app.get("/api/logs")
def api_file_logs(lines: int = 200) -> dict:
    log_dir  = Path(os.getenv("LOG_DIR", "logs"))
    def _tail(f: Path) -> list[str]:
        if not f.exists(): return []
        return f.read_text(errors="replace").splitlines()[-lines:]
    return {"available": (log_dir / "out.log").exists() or (log_dir / "err.log").exists(),
            "stdout": _tail(log_dir / "out.log"), "stderr": _tail(log_dir / "err.log")}


# ── WebSocket ─────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await _manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        _manager.disconnect(ws)


# ── Static ────────────────────────────────────────────────────────────────────
Path("static").mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")
