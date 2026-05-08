from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import requests as _http
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ai import resolve_ai_cred, run_ai_prompt
from config import load_config, save_config
from db import db_log, get_db, get_setting, set_setting
from hits import _hit_history, db_update_filter, row_to_hit
from monitor import (
    listener_statuses,
    start_listener,
    stop_all_listeners,
    stop_listener,
)
from webhooks import queue_and_deliver

router = APIRouter()


# ── Config ────────────────────────────────────────────────────────────────────
@router.get("/api/config")
def api_get_config() -> dict:
    return load_config()


@router.post("/api/config")
def api_save_config(payload: dict) -> dict:
    cfg = load_config()
    cfg.update(payload)
    save_config(cfg)
    return {"ok": True}


# ── Monitor ───────────────────────────────────────────────────────────────────
@router.get("/api/listeners/status")
def api_listeners_status() -> dict:
    return listener_statuses()


@router.post("/api/listeners/{listener_id}/start")
def api_start_listener(listener_id: str) -> dict:
    cfg = load_config()
    lst = next((l for l in cfg.get("listeners", []) if l["id"] == listener_id), None)
    if not lst:
        return {"ok": False, "message": "Listener not found"}
    start_listener(lst, cfg.get("credentials", []))
    return {"ok": True}


@router.post("/api/listeners/{listener_id}/stop")
def api_stop_listener(listener_id: str) -> dict:
    stop_listener(listener_id)
    return {"ok": True}


@router.post("/api/monitor/start")
def api_start_all() -> dict:
    cfg   = load_config()
    creds = cfg.get("credentials", [])
    started = [l.get("name", l["id"])
               for l in cfg.get("listeners", [])
               if l.get("enabled", True) and start_listener(l, creds)]
    return {"ok": True, "started": started}


@router.post("/api/monitor/stop")
def api_stop_all() -> dict:
    stop_all_listeners()
    return {"ok": True}


# ── Hits ──────────────────────────────────────────────────────────────────────
@router.get("/api/hits")
def api_get_hits(listener_id: str = "", kind: str = "", subreddit: str = "",
                 q: str = "", status: str = "", limit: int = 50, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if listener_id: conds.append("listener_id=?");           params.append(listener_id)
    if kind:        conds.append("kind=?");                  params.append(kind)
    if subreddit:   conds.append("subreddit LIKE ?");        params.append(f"%{subreddit}%")
    if status:      conds.append("status=?");                params.append(status)
    if q:
        conds.append("(title LIKE ? OR excerpt LIKE ? OR match_text LIKE ? OR author LIKE ?)")
        params.extend([f"%{q}%"] * 4)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM hits {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM hits {where} ORDER BY ts DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {"hits": [row_to_hit(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.patch("/api/hits/{hit_id}/status")
def api_hit_status(hit_id: str, payload: dict) -> dict:
    status = payload.get("status", "new")
    lid    = payload.get("listener_id")
    with get_db() as db:
        if lid:
            db.execute("UPDATE hits SET status=? WHERE hit_id=? AND listener_id=?", (status, hit_id, lid))
        else:
            db.execute("UPDATE hits SET status=? WHERE hit_id=?", (status, hit_id))
    return {"ok": True}


@router.patch("/api/hits/{hit_id}/reply")
def api_hit_reply(hit_id: str, payload: dict) -> dict:
    reply = payload.get("reply", "")
    lid   = payload.get("listener_id")
    with get_db() as db:
        if lid:
            db.execute("UPDATE hits SET reply_draft=?,status='replied' WHERE hit_id=? AND listener_id=?",
                       (reply, hit_id, lid))
        else:
            db.execute("UPDATE hits SET reply_draft=?,status='replied' WHERE hit_id=?", (reply, hit_id))
    return {"ok": True}


@router.patch("/api/hits/{hit_id}")
def api_update_hit(hit_id: str, payload: dict) -> dict:
    db_update_filter(hit_id, payload.get("listener_id"), payload.get("passed", False), payload.get("results", []))
    return {"ok": True}


@router.delete("/api/hits")
def api_clear_hits() -> dict:
    with get_db() as db:
        db.execute("DELETE FROM hits")
    _hit_history.clear()
    return {"ok": True}


@router.get("/api/hits/stats")
def api_hits_stats() -> dict:
    with get_db() as db:
        total  = db.execute("SELECT COUNT(*) FROM hits").fetchone()[0]
        today  = db.execute("SELECT COUNT(*) FROM hits WHERE created_at >= date('now')").fetchone()[0]
        passed = db.execute("SELECT COUNT(*) FROM hits WHERE filter_passed=1").fetchone()[0]
        by_lst = db.execute("SELECT listener_name,COUNT(*) as cnt FROM hits GROUP BY listener_id ORDER BY cnt DESC LIMIT 10").fetchall()
        by_sub = db.execute("SELECT subreddit,COUNT(*) as cnt FROM hits GROUP BY subreddit ORDER BY cnt DESC LIMIT 10").fetchall()
    return {"total": total, "today": today, "passed": passed,
            "by_listener":  [{"name": r["listener_name"], "count": r["cnt"]} for r in by_lst],
            "by_subreddit": [{"subreddit": r["subreddit"], "count": r["cnt"]} for r in by_sub]}


@router.get("/api/hits/export")
def api_export_hits(listener_id: str = "", kind: str = "") -> StreamingResponse:
    conds: list[str] = []
    params: list     = []
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    if kind:        conds.append("kind=?");         params.append(kind)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with get_db() as db:
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


@router.post("/api/filter/test")
def api_filter_test(req: _FilterReq) -> dict:
    cfg  = load_config()
    cred = resolve_ai_cred(cfg, req.credential_id)
    if not cred:
        return {"error": "No AI key configured — add one in Vault"}

    results: list[dict] = []
    passed  = True

    for step in req.filters:
        if not step.get("enabled", True):
            results.append({"step": step.get("name", "?"), "skipped": True})
            continue
        try:
            response = run_ai_prompt(step["prompt"] + "\n\nContent:\n" + req.text, cred)
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


@router.post("/api/reply/draft")
def api_draft_reply(req: _DraftReq) -> dict:
    cfg  = load_config()
    cred = resolve_ai_cred(cfg, req.credential_id)
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
        return {"reply": run_ai_prompt(prompt, cred, max_tokens=400)}
    except Exception as exc:
        return {"error": str(exc)}


# ── Thread view ───────────────────────────────────────────────────────────────
@router.get("/api/reddit/thread")
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


# ── Notify ────────────────────────────────────────────────────────────────────
class _NotifyReq(BaseModel):
    listener_id:    str
    title:          str = ""
    url:            str = ""
    subreddit:      str = ""
    author:         str = ""
    match:          str = ""
    excerpt:        str = ""
    filter_results: list[dict] = []


@router.post("/api/notify")
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
        queue_and_deliver(slack_url, payload, req.listener_id, lst.get("name", ""), "slack-ai")
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
        queue_and_deliver(f"https://api.telegram.org/bot{tg_token}/sendMessage",
                          payload, req.listener_id, lst.get("name", ""), "telegram-ai")
        sent.append("telegram")

    return {"ok": True, "sent": sent}


# ── Health ────────────────────────────────────────────────────────────────────
@router.get("/api/health")
def api_health() -> dict:
    from monitor import _monitors
    now = time.time()
    with get_db() as db:
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
@router.get("/api/stats")
def api_stats(days: int = 30) -> dict:
    from datetime import datetime, timedelta, timezone
    ts_cond = f"ts >= strftime('%s','now','-{days} days')" if days > 0 else "1=1"
    with get_db() as db:
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

    h_map    = {r["hour"]: r["cnt"] for r in by_hour}
    d_map    = {r["dow"]:  r["cnt"] for r in by_dow}
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


# ── Logs ──────────────────────────────────────────────────────────────────────
@router.get("/api/logs/system")
def api_system_logs(level: str = "", source: str = "", listener_id: str = "",
                    limit: int = 100, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if level:       conds.append("level=?");       params.append(level)
    if source:      conds.append("source=?");      params.append(source)
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM system_log {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM system_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {
        "logs": [{"id": r["id"], "level": r["level"], "source": r["source"],
                  "listener_id": r["listener_id"], "listener_name": r["listener_name"],
                  "message": r["message"], "created_at": r["created_at"]} for r in rows],
        "total": total,
    }


@router.get("/api/logs/webhooks")
def api_webhook_logs(status: str = "", listener_id: str = "",
                     limit: int = 100, offset: int = 0) -> dict:
    conds: list[str] = []
    params: list     = []
    if status:      conds.append("status=?");      params.append(status)
    if listener_id: conds.append("listener_id=?"); params.append(listener_id)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    with get_db() as db:
        total = db.execute(f"SELECT COUNT(*) FROM webhook_log {where}", params).fetchone()[0]
        rows  = db.execute(f"SELECT * FROM webhook_log {where} ORDER BY id DESC LIMIT ? OFFSET ?",
                            params + [limit, offset]).fetchall()
    return {
        "logs": [{"id": r["id"], "listener_id": r["listener_id"], "listener_name": r["listener_name"],
                  "wtype": r["wtype"],
                  "url": (r["url"] or "")[:60] + "…" if len(r["url"] or "") > 60 else r["url"],
                  "status": r["status"], "attempts": r["attempts"], "last_error": r["last_error"],
                  "created_at": r["created_at"], "delivered_at": r["delivered_at"]} for r in rows],
        "total": total,
    }


@router.post("/api/logs/webhooks/{log_id}/retry")
def api_retry_webhook(log_id: int) -> dict:
    with get_db() as db:
        row = db.execute("SELECT * FROM webhook_log WHERE id=?", (log_id,)).fetchone()
    if not row:
        return {"ok": False, "error": "Not found"}
    try:
        r = _http.post(row["url"], data=row["payload"],
                       headers={"Content-Type": "application/json"}, timeout=10)
        r.raise_for_status()
        with get_db() as db:
            db.execute("UPDATE webhook_log SET status='success',attempts=attempts+1,"
                       "delivered_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (log_id,))
        db_log("info", "webhook", f"Manual retry succeeded [{row['wtype']}]",
               row["listener_id"], row["listener_name"])
        return {"ok": True}
    except Exception as exc:
        with get_db() as db:
            db.execute("UPDATE webhook_log SET attempts=attempts+1,last_error=? WHERE id=?",
                       (str(exc)[:500], log_id))
        return {"ok": False, "error": str(exc)}


# ── Settings ──────────────────────────────────────────────────────────────────
@router.get("/api/settings/{key}")
def api_get_setting(key: str) -> dict:
    return {"value": get_setting(key)}


@router.put("/api/settings/{key}")
def api_set_setting(key: str, payload: dict) -> dict:
    set_setting(key, payload.get("value", ""))
    return {"ok": True}


# ── File logs ─────────────────────────────────────────────────────────────────
@router.get("/api/logs")
def api_file_logs(lines: int = 200) -> dict:
    log_dir = Path(os.getenv("LOG_DIR", "logs"))
    def _tail(f: Path) -> list[str]:
        if not f.exists(): return []
        return f.read_text(errors="replace").splitlines()[-lines:]
    return {"available": (log_dir / "out.log").exists() or (log_dir / "err.log").exists(),
            "stdout": _tail(log_dir / "out.log"), "stderr": _tail(log_dir / "err.log")}
