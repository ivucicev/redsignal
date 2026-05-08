from __future__ import annotations

import asyncio
import json

import requests as _http

from db import db_log, get_db

MAX_WEBHOOK_ATTEMPTS = 3


def queue_and_deliver(url: str, payload: dict, listener_id: str, listener_name: str,
                      wtype: str) -> None:
    """Log webhook attempt and deliver immediately; retry loop handles retries."""
    try:
        with get_db() as db:
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
            with get_db() as db:
                db.execute(
                    "UPDATE webhook_log SET status='success', attempts=1, "
                    "delivered_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id=?", (log_id,))
        db_log("info", "webhook", f"Delivered [{wtype}] to {url[:60]}", listener_id, listener_name)
    except Exception as exc:
        err = str(exc)[:500]
        if log_id:
            with get_db() as db:
                db.execute(
                    "UPDATE webhook_log SET status='retrying', attempts=1, last_error=? WHERE id=?",
                    (err, log_id))
        db_log("warn", "webhook", f"[{wtype}] delivery failed (will retry): {err}",
               listener_id, listener_name)


async def webhook_retry_loop() -> None:
    """Pick up failed webhooks and retry up to MAX_WEBHOOK_ATTEMPTS total."""
    while True:
        await asyncio.sleep(30)
        try:
            with get_db() as db:
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
                    with get_db() as db:
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
                    with get_db() as db:
                        db.execute(
                            "UPDATE webhook_log SET status=?, attempts=?, last_error=? WHERE id=?",
                            (status, attempt, err, r["id"]))
                    if final:
                        db_log("error", "webhook",
                               f"Permanently failed after {attempt} attempts [{r['wtype']}]: {err}",
                               r["listener_id"], r["listener_name"])
        except Exception as exc:
            db_log("error", "system", f"Retry loop error: {exc}")
