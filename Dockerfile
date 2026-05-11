FROM python:3.11-slim

WORKDIR /app

# Install deps first (separate layer = faster rebuilds)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app
COPY *.py .

# static/ contains the pre-built frontend (run `npm run build` in frontend/ before docker build)
COPY static/ static/

# Persistent data lives in /app/data (mapped as a volume)
RUN mkdir -p data logs

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
