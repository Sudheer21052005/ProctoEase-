"""Attempt schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class AttemptCreate(BaseModel):
    """Body is intentionally empty — exam_id comes from URL path."""
    verification_image_base64: str | None = None


class AttemptRead(BaseModel):
    id: uuid.UUID
    exam_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_email: str | None = None
    status: str
    is_active: bool
    started_at: datetime
    attempt_end_time: datetime | None
    submitted_at: datetime | None
    verification_image_url: str | None
    tenant_id: uuid.UUID

    model_config = {"from_attributes": True}
