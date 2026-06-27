"""
Rate limiter singleton — Redis-backed slowapi limiter.
Phase 10: Production Readiness.

Usage in route handlers:
    from app.core.limiter import limiter

    @router.post("/login")
    @limiter.limit("10/minute")
    async def login(request: Request, ...):
        ...

The `request: Request` parameter MUST be present in the handler
signature for slowapi to extract the client key.
"""

from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

from app.core.config import settings


def _get_limiter() -> Limiter:
    """
    Build the limiter.

    - When RATE_LIMIT_ENABLED=False (tests), uses in-memory storage
      so no Redis dependency is required.
    - In production, uses Redis so limits are shared across workers.
    """
    if not settings.RATE_LIMIT_ENABLED:
        # In-memory — safe for unit tests, NOT for multi-worker prod
        return Limiter(key_func=get_remote_address)

    return Limiter(
        key_func=get_remote_address,
        storage_uri=settings.REDIS_URL,
    )


limiter: Limiter = _get_limiter()
