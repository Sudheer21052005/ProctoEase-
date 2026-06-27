"""Plagiarism report schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PlagiarismTrigger(BaseModel):
    """Request body to trigger plagiarism analysis for an exam."""
    threshold: float = Field(
        default=0.8, ge=0.0, le=1.0,
        description="Similarity threshold (0.0–1.0). Pairs above this are flagged.",
    )


class PlagiarismPairRead(BaseModel):
    """A single pairwise comparison result."""
    id: uuid.UUID
    submission_a_id: uuid.UUID
    submission_b_id: uuid.UUID
    candidate_a_id: uuid.UUID
    candidate_b_id: uuid.UUID
    similarity_score: float
    is_flagged: bool
    matching_tokens: int | None
    total_tokens_a: int | None
    total_tokens_b: int | None
    details: dict | None

    model_config = {"from_attributes": True}


class PlagiarismReportRead(BaseModel):
    """Full plagiarism report response."""
    id: uuid.UUID
    exam_id: uuid.UUID
    status: str
    total_pairs: int
    flagged_pairs: int
    threshold: float
    created_at: datetime
    completed_at: datetime | None
    tenant_id: uuid.UUID
    pairs: list[PlagiarismPairRead] = []

    model_config = {"from_attributes": True}


class PlagiarismSummaryRead(BaseModel):
    """Lightweight summary (without pair details)."""
    id: uuid.UUID
    exam_id: uuid.UUID
    status: str
    total_pairs: int
    flagged_pairs: int
    threshold: float
    created_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}
