FROM python:3.12-slim AS base
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Install deps first (layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Production stage ──
FROM base AS production

# Non-root user
RUN adduser --disabled-password --gecos "" appuser

COPY ./app ./app
COPY alembic.ini .
COPY ./alembic ./alembic
COPY ./scripts ./scripts

RUN chmod +x scripts/start.sh

# Switch to non-root
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["sh", "scripts/start.sh"]
