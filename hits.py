from __future__ import annotations

import json
import sqlite3
from collections import deque

from db import db_log, get_db

_hit_history: deque[dict] = deque(maxlen=500)


def seed_hit_history() -> None:
    with get_db() as db:
        rows = db.execute("SELECT * FROM hits ORDER BY ts DESC LIMIT 200").fetchall()
    for r in reversed(rows):
        _hit_history.append(row_to_hit(r))


def db_save_hit(hit: dict) -> None:
    try:
        with get_db() as db:
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
        with get_db() as db:
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


def row_to_hit(r: sqlite3.Row) -> dict:
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
