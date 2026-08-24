"""Exam schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ExamCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=500)
    description: str | None = None
    duration_minutes: int = Field(default=60, ge=5, le=480)
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_published: bool = False


class ExamRead(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    duration_minutes: int
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_published: bool
    is_active: bool
    created_by: uuid.UUID
    tenant_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class ExamUpdate(BaseModel):
    """Partial update — only send fields you want to change."""
    title: str | None = Field(default=None, min_length=3, max_length=500)
    description: str | None = None
    duration_minutes: int | None = Field(default=None, ge=5, le=480)
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_published: bool | None = None

