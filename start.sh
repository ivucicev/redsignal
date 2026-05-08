#!/bin/bash
# Local development only — for production use Docker instead:
#   cp .env.example .env   # then edit .env
#   docker compose up -d
cd "$(dirname "$0")"
[ -d ".venv" ] || python3 -m venv .venv
source .venv/bin/activate
pip install -q -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000 --reload
