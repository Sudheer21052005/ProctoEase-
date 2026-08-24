"""Question schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class QuestionCreate(BaseModel):
    question_text: str = Field(..., min_length=3, max_length=5000)
    question_type: str = Field(
        default="mcq",
        description="mcq | multi_select | true_false | code",
    )
    options: list[dict[str, Any]] | None = Field(
        default=None,
        description='MCQ/MULTI_SELECT: [{"label": "A", "text": "Option text"}, ...]',
    )
    correct_answer: Any | None = Field(
        default=None,
        description='MCQ: "A", MULTI_SELECT: ["A","B"], TRUE_FALSE: true, CODE: {"test_cases": [...]}',
    )
    points: int = Field(default=1, ge=1, le=100)
    order_index: int = Field(default=0, ge=0)


class QuestionRead(BaseModel):
    id: uuid.UUID
    exam_id: uuid.UUID
    question_text: str
    question_type: str
    options: list[dict[str, Any]] | None
    correct_answer: Any | None
    points: int
    order_index: int
    is_active: bool
    tenant_id: uuid.UUID
    created_at: datetime

    model_config = {"from_attributes": True}


class QuestionReadCandidate(BaseModel):
    """Question view for candidates — hides correct_answer."""
    id: uuid.UUID
    exam_id: uuid.UUID
    question_text: str
    question_type: str
    options: list[dict[str, Any]] | None
    points: int
    order_index: int

    model_config = {"from_attributes": True}
