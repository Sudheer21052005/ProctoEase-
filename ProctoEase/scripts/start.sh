#!/bin/sh
set -e

echo "[startup] Waiting for database..."
python - <<'PY'
import asyncio
import sys

from sqlalchemy import text

from app.core.database import async_session_factory


async def main() -> None:
    retries = 60
    for _ in range(retries):
        try:
            async with async_session_factory() as db:
                await db.execute(text("SELECT 1"))
            print("[startup] Database is ready")
            return
        except Exception:
            await asyncio.sleep(2)
    print("[startup] Database not reachable after retries", file=sys.stderr)
    raise SystemExit(1)


asyncio.run(main())
PY

echo "[startup] Running migrations..."
alembic upgrade head

echo "[startup] Auto seeding..."
python -m app.seeder.auto_seed

echo "[startup] Starting API..."
uvicorn app.main:app --host 0.0.0.0 --port 8000
