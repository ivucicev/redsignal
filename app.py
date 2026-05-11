from __future__ import annotations

import asyncio
import base64
import secrets
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from config import migrate_from_json
from db import db_log, init_db, migrate_schema
from hits import seed_hit_history
from routes import router
from webhooks import webhook_retry_loop
from ws import manager, queue_broadcaster

import os

app = FastAPI()


# ── Optional Basic Auth ───────────────────────────────────────────────────────
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
app.include_router(router)


@app.on_event("startup")
async def _startup() -> None:
    init_db()
    migrate_schema()
    migrate_from_json()
    seed_hit_history()
    asyncio.create_task(queue_broadcaster())
    asyncio.create_task(webhook_retry_loop())
    db_log("info", "system", "RedSignal started")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        manager.disconnect(ws)


Path("static").mkdir(exist_ok=True)
Path("static/assets").mkdir(exist_ok=True)
app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    return FileResponse("static/favicon.ico")


@app.get("/")
def index() -> FileResponse:
    return FileResponse("static/index.html")
