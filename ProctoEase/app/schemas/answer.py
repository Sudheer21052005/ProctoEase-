"""Answer schemas — request / response DTOs for candidate answers."""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class AnswerSubmit(BaseModel):
    """A single answer for a question."""
    question_id: uuid.UUID
    selected_option_ids: list[str] | None = None  # MCQ / multi_select / true_false
    text_answer: str | None = None                 # short_answer


class BulkAnswerSubmit(BaseModel):
    """Batch answer submission."""
    answers: list[AnswerSubmit] = Field(..., min_length=1)


class AnswerRead(BaseModel):
    """Single answer in the response."""
    question_id: uuid.UUID
    selected_option_ids: list[str] | None = None
    text_answer: str | None = None
    is_correct: bool | None = None   # populated after auto-grade
    points_earned: int | None = None


class AnswersResponse(BaseModel):
    """Full answers response for an attempt."""
    attempt_id: uuid.UUID
    answers: list[AnswerRead]
    total_score: int | None = None
    max_score: int | None = None
