"""
Auth endpoints — register, login, refresh, me.
Phase 4: Uses domain exceptions, OpenAPI summaries.
Phase 10: Rate limits on login and register.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.core.exceptions import TenantNotFound
from app.core.limiter import limiter
from app.models.user import User
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.schemas.user import UserRegister, UserRead
from app.services import auth_service, tenant_service, user_service

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post(
    "/register",
    response_model=UserRead,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user",
)
@limiter.limit("5/minute")
async def register(
    request: Request,
    payload: UserRegister,
    db: AsyncSession = Depends(get_db),
):
    """
    Register a new user under an existing tenant.
    Tenant is resolved via `tenant_slug` in the request body.

    **Rate limit**: 5 requests / minute per IP.
    """
    # Block admin self-registration — admin accounts must be created by existing admins
    ALLOWED_REGISTRATION_ROLES = {"candidate", "recruiter"}
    if payload.role and payload.role.lower() not in ALLOWED_REGISTRATION_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Self-registration is only allowed for candidate and recruiter roles.",
        )
    tenant = await tenant_service.get_tenant_by_slug(db, payload.tenant_slug)
    if tenant is None or not tenant.is_active:
        raise TenantNotFound()
    user = await user_service.register_user(db, payload, tenant.id)
    return user


@router.post("/login", response_model=TokenResponse, summary="Login")
@limiter.limit("10/minute")
async def login(
    request: Request,
    payload: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Authenticate and receive access + refresh tokens.

    **Rate limit**: 10 requests / minute per IP.
    """
    return await auth_service.login(db, payload)


@router.post("/refresh", response_model=TokenResponse, summary="Refresh tokens")
async def refresh_token(
    payload: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Exchange a refresh token for a new token pair."""
    return await auth_service.refresh(db, payload)


@router.get("/me", response_model=UserRead, summary="Get current user")
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """Return the current authenticated user's profile."""
    return current_user
