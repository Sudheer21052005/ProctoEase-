"""Tenant schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TenantCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    slug: str = Field(
        ..., min_length=2, max_length=100, pattern=r"^[a-z0-9\-]+$",
        description="URL-safe lowercase identifier, e.g. 'acme-corp'",
    )


class TenantRead(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}
