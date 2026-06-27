"""
Tenant service — business logic for tenant management.
Phase 4: Uses domain exceptions instead of raw HTTPException.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import DuplicateTenantSlug
from app.models.tenant import Tenant
from app.schemas.tenant import TenantCreate


async def create_tenant(db: AsyncSession, payload: TenantCreate) -> Tenant:
    """Create a new tenant. Raises DuplicateTenantSlug if slug already exists."""
    existing = await db.execute(
        select(Tenant).where(Tenant.slug == payload.slug)
    )
    if existing.scalar_one_or_none():
        raise DuplicateTenantSlug()

    tenant = Tenant(name=payload.name, slug=payload.slug)
    db.add(tenant)
    await db.flush()
    return tenant


async def get_tenant_by_slug(db: AsyncSession, slug: str) -> Tenant | None:
    """Lookup tenant by slug."""
    result = await db.execute(select(Tenant).where(Tenant.slug == slug))
    return result.scalar_one_or_none()
