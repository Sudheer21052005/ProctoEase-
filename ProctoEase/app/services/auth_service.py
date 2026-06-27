"""
Auth service — login and token refresh logic.
Phase 4: Uses domain exceptions instead of raw HTTPException.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.exceptions import InvalidCredentials, InvalidRefreshToken, UserInactive
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.services.user_service import get_user_by_email
from app.services.tenant_service import get_tenant_by_slug


async def login(db: AsyncSession, payload: LoginRequest) -> TokenResponse:
    """Authenticate user and return access + refresh tokens."""

    # Resolve tenant
    tenant = await get_tenant_by_slug(db, payload.tenant_slug)
    if tenant is None or not tenant.is_active:
        raise InvalidCredentials()

    # Lookup user
    user = await get_user_by_email(db, payload.email, tenant.id)
    if user is None or not user.is_active:
        raise InvalidCredentials()

    # Verify password
    if not verify_password(payload.password, user.hashed_password):
        raise InvalidCredentials()

    return TokenResponse(
        access_token=create_access_token(user.id, tenant.id, user.role),
        refresh_token=create_refresh_token(user.id, tenant.id),
    )


async def refresh(db: AsyncSession, payload: RefreshRequest) -> TokenResponse:
    """Validate refresh token and issue a new token pair."""
    token_payload = decode_token(payload.refresh_token)
    if token_payload is None or token_payload.get("type") != "refresh":
        raise InvalidRefreshToken()

    user_id = uuid.UUID(token_payload["sub"])
    tenant_id = uuid.UUID(token_payload["tenant_id"])

    # Verify user still exists and is active
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise UserInactive()

    return TokenResponse(
        access_token=create_access_token(user.id, tenant_id, user.role),
        refresh_token=create_refresh_token(user.id, tenant_id),
    )
