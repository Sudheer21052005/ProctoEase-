"""
Tenant endpoints — public.
Phase 10: Rate limit on tenant creation.
"""

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.limiter import limiter
from app.schemas.tenant import TenantCreate, TenantRead
from app.services import tenant_service

router = APIRouter(prefix="/tenants", tags=["Tenants"])


@router.post("/", response_model=TenantRead, status_code=status.HTTP_201_CREATED, summary="Create tenant")
@limiter.limit("3/minute")
async def create_tenant(
    request: Request,
    payload: TenantCreate,
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new tenant (organisation).
    Public endpoint — no authentication required.

    **Rate limit**: 3 requests / minute per IP.
    """
    tenant = await tenant_service.create_tenant(db, payload)
    return tenant
