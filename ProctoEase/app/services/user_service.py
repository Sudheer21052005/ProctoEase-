"""
User service — registration and lookup.
Phase 4: Uses domain exceptions instead of raw HTTPException.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.core.exceptions import DuplicateEmail
from app.models.user import User, UserRole
from app.schemas.user import UserRegister


async def register_user(
    db: AsyncSession,
    payload: UserRegister,
    tenant_id: uuid.UUID,
) -> User:
    """Register a new user under the given tenant."""
    # Check if email already taken within this tenant
    existing = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.email == payload.email,
        )
    )
    if existing.scalar_one_or_none():
        raise DuplicateEmail()

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role=UserRole(payload.role),
        tenant_id=tenant_id,
    )
    db.add(user)
    await db.flush()
    return user


async def get_user_by_email(
    db: AsyncSession,
    email: str,
    tenant_id: uuid.UUID,
) -> User | None:
    """Lookup user by email within a tenant."""
    result = await db.execute(
        select(User).where(
            User.tenant_id == tenant_id,
            User.email == email,
        )
    )
    return result.scalar_one_or_none()
