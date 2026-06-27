"""
Async database engine, session factory, and get_db dependency.
Sets PostgreSQL session variable for RLS tenant isolation.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy import text
from starlette.requests import Request

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_recycle=settings.DB_POOL_RECYCLE,
    pool_timeout=settings.DB_POOL_TIMEOUT,
    pool_pre_ping=True,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db(request: Request) -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency that yields a tenant-scoped async session.

    1. Reads tenant_id from request.state (set by TenantMiddleware or auth).
    2. Sets the PostgreSQL session variable so RLS policies can filter rows.
    3. Yields the session, commits on success, rolls back on error.
    """
    tenant_id: uuid.UUID | None = getattr(request.state, "tenant_id", None)

    async with async_session_factory() as session:
        try:
            if tenant_id is not None:
                await session.execute(
                    text(f"SET app.current_tenant_id = '{tenant_id}'")
                )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
