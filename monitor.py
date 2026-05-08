from __future__ import annotations

import re
import threading
import time

from db import db_log
from webhooks import queue_and_deliver
from ws import _hit_queue

_monitors:    dict[str, threading.Thread] = {}
_stop_events: dict[str, threading.Event]  = {}

_author_cache: dict[str, dict] = {}


def _passes_author_quality(author, min_karma: int, min_age_days: int) -> bool:
    if author is None:
        return False
    name   = str(author)
    now    = time.time()
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
    webhook        = (listener.get("webhook")            or "").strip()
    slack_url      = (listener.get("slack_webhook")      or "").strip()
    tg_token       = (listener.get("telegram_bot_token") or "").strip()
    tg_chat_id     = (listener.get("telegram_chat_id")   or "").strip()
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
            queue_and_deliver(webhook, hit, lid, lname, "generic")

        if slack_url:
            queue_and_deliver(slack_url, {"blocks": [
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
            queue_and_deliver(
                f"https://api.telegram.org/bot{tg_token}/sendMessage",
                {"chat_id": tg_chat_id, "parse_mode": "Markdown",
                 "disable_web_page_preview": True,
                 "text": (f"🔴 *{lname}* — r/{sub_name}\n\n"
                          f"{icon} *{title or '(comment)'}*\nby u/{hit['author']}\n\n"
                          f"Keyword: `{m.group(0)}`\n_{excerpt[:280]}_\n\n[Open]({url})")},
                lid, lname, "telegram")

    _status(f"[{lname}] Monitoring r/{subreddits_str}…")

    while not stop.is_set():
        if not _in_schedule(listener):
            if not was_paused:
                _status(f"[{lname}] Outside schedule window — pausing")
                was_paused = True
            time.sleep(60)
            continue
        if was_paused:
            _status(f"[{lname}] Entering schedule window — resuming")
            was_paused = False
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


def start_listener(listener: dict, credentials: list[dict]) -> bool:
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


def stop_listener(listener_id: str) -> None:
    if listener_id in _stop_events:
        _stop_events[listener_id].set()


def stop_all_listeners() -> None:
    for ev in _stop_events.values():
        ev.set()


def listener_statuses() -> dict[str, bool]:
    return {lid: t.is_alive() for lid, t in _monitors.items()}
