from __future__ import annotations

import asyncio
import queue

from fastapi import WebSocket

from hits import _hit_history, db_save_hit

_hit_queue: queue.Queue[dict] = queue.Queue()


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


manager = _Manager()


async def queue_broadcaster() -> None:
    loop = asyncio.get_event_loop()
    while True:
        try:
            item = _hit_queue.get_nowait()
            if item.get("type") == "hit":
                _hit_history.append(item)
                loop.run_in_executor(None, db_save_hit, item)
            await manager.broadcast(item)
        except queue.Empty:
            await asyncio.sleep(0.05)
        except Exception:
            await asyncio.sleep(0.1)
