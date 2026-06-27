"""User schemas — registration and read DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, description="Minimum 8 characters")
    full_name: str = Field(..., min_length=2, max_length=255)
    role: str = Field(
        default="candidate",
        pattern=r"^(admin|recruiter|candidate)$",
        description="One of: admin, recruiter, candidate",
    )
    tenant_slug: str = Field(
        ..., min_length=2, max_length=100,
        description="Slug of the tenant to register under",
    )


class UserRead(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    role: str
    is_active: bool
    tenant_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}
