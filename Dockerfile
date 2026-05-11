# ── Frontend build stage ──────────────────────────────────────────────────────
FROM node:22-slim AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Backend ───────────────────────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install deps first (separate layer = faster rebuilds)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY *.py .
COPY --from=frontend /frontend/../static/ static/

# Persistent data lives in /app/data (mapped as a volume)
RUN mkdir -p data static logs

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
