"""Attempt schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field

from app.models.attempt import RecruiterDecision


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


# ── Phase D: human recruiter review & decision ──────────────────────────────


class RecruiterDecisionUpdate(BaseModel):
    """
    Request body for PUT /attempts/{attempt_id}/recruiter-decision.

    PUT semantics: the decision record is written as a whole — an omitted
    ``notes`` clears previously saved notes. Any value outside the four
    RecruiterDecision members fails validation with 422.
    """

    decision: RecruiterDecision
    notes: Annotated[str | None, Field(max_length=5000)] = None


class RecruiterDecisionRead(BaseModel):
    """Persisted decision state plus reviewer metadata."""

    attempt_id: uuid.UUID
    decision: str
    notes: str | None
    reviewed_by: uuid.UUID | None
    reviewed_by_email: str | None
    reviewed_at: datetime | None

    model_config = {"from_attributes": True}
