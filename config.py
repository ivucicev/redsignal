from __future__ import annotations

import json
import uuid as _uuid_mod
from pathlib import Path

from db import db_log, get_db, get_setting, safe_col


def load_config() -> dict:
    with get_db() as db:
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
                "negative_keywords":    json.loads(safe_col(r, "negative_keywords") or "[]"),
                "min_karma":            int(safe_col(r, "min_karma") or 0),
                "min_account_age_days": int(safe_col(r, "min_account_age_days") or 0),
                "slack_webhook":        safe_col(r, "slack_webhook") or "",
                "telegram_bot_token":   safe_col(r, "telegram_bot_token") or "",
                "telegram_chat_id":     safe_col(r, "telegram_chat_id") or "",
                "schedule_enabled":     bool(safe_col(r, "schedule_enabled") or 0),
                "schedule_timezone":    safe_col(r, "schedule_timezone") or "UTC",
                "schedule_days":        json.loads(safe_col(r, "schedule_days") or "[0,1,2,3,4,5,6]"),
                "schedule_start":       int(safe_col(r, "schedule_start") or 0),
                "schedule_end":         int(safe_col(r, "schedule_end") or 24),
                "reddit_credential_id": r["reddit_credential_id"],
                "ai_credential_id":     r["ai_credential_id"],
            })

    return {
        "credentials":     creds,
        "listeners":       listeners,
        "product_context": get_setting("product_context"),
    }


def save_config(cfg: dict) -> None:
    with get_db() as db:
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
            db.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                ("product_context", cfg["product_context"] or ""),
            )


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
