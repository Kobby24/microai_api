# MicroAI backend API: FastAPI + ML models.
# Affymetrix CEL preprocessing (R/affy MAS5) runs in a separate service (Dockerfile.cel);
# set MICROAI_CEL_SERVICE_URL / MICROAI_CEL_SERVICE_TOKEN to reach it.
# Build context: backend/   (docker build -t microai-backend backend)
FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    MALLOC_ARENA_MAX=2

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --uid 10001 appuser && chown -R appuser /app
USER appuser

ENV PORT=10000
EXPOSE 10000
# Render injects $PORT; models are loaded from ./models relative to /app.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
