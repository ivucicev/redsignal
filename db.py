from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

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
def get_db() -> Generator[sqlite3.Connection, None, None]:
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
    with get_db() as db:
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
    with get_db() as db:
        for table, col_def in cols:
            try:
                db.execute(f"ALTER TABLE {table} ADD COLUMN {col_def}")
            except sqlite3.OperationalError:
                pass  # already exists


def db_log(level: str, source: str, message: str,
           listener_id: str | None = None, listener_name: str | None = None) -> None:
    try:
        with get_db() as db:
            db.execute(
                "INSERT INTO system_log(level,source,listener_id,listener_name,message) VALUES(?,?,?,?,?)",
                (level, source, listener_id, listener_name, message[:2000]),
            )
    except Exception:
        pass


def get_setting(key: str, default: str = "") -> str:
    with get_db() as db:
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key: str, value: str) -> None:
    with get_db() as db:
        db.execute("INSERT INTO settings(key,value) VALUES(?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def safe_col(r: sqlite3.Row, key: str, default=None):
    """Safe row accessor for columns that may not exist on older DBs."""
    try:
        return r[key]
    except (IndexError, KeyError):
        return default
