"""
FastAPI dependencies for authentication and authorisation.
Phase 4: Uses domain exceptions instead of raw HTTPException.
"""

from __future__ import annotations

import uuid

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.database import get_db
from app.core.security import decode_token
from app.core.exceptions import InvalidToken, Forbidden
from app.models.user import User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


async def get_current_user(
    request: Request,
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Validate access token and return the User ORM object."""
    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        raise InvalidToken()

    user_id = payload.get("sub")
    if user_id is None:
        raise InvalidToken()

    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    user = result.scalar_one_or_none()

    if user is None or not user.is_active:
        raise InvalidToken()

    # Ensure request.state has tenant_id for downstream use
    request.state.tenant_id = user.tenant_id
    return user


def require_role(*allowed: UserRole):
    """
    Returns a FastAPI dependency that enforces role-based access.

    Usage:
        @router.post("/exams")
        async def create_exam(user: User = Depends(require_role(UserRole.RECRUITER))):
            ...
    """

    async def _check(
        current_user: User = Depends(get_current_user),
    ) -> User:
        if current_user.role not in allowed:
            raise Forbidden()
        return current_user

    return _check
