"""Schemas for exam creation via manual, PDF, and JSON ingestion modes."""

from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.exam import ExamRead


class ExamCreationMode(str, Enum):
    MANUAL = "manual"
    PDF = "pdf"
    JSON = "json"


class CodeTestCase(BaseModel):
    input: str = Field(default="", max_length=10_000)
    expected: str = Field(..., min_length=1, max_length=10_000)


class IngestQuestion(BaseModel):
    type: Literal["mcq", "multi_select", "true_false", "short_answer", "code"]
    question: str = Field(..., min_length=3, max_length=5_000)
    options: list[str] | None = None
    correct_answer: Any | None = None
    points: int = Field(default=1, ge=1, le=100)
    test_cases: list[CodeTestCase] | None = None

    @model_validator(mode="after")
    def validate_shape(self):
        if self.type in {"mcq", "multi_select"}:
            if not self.options or len(self.options) < 2:
                raise ValueError("options must have at least 2 items for mcq/multi_select")
            if self.correct_answer is None:
                raise ValueError("correct_answer is required for mcq/multi_select")

        if self.type == "true_false" and self.correct_answer is None:
            raise ValueError("correct_answer is required for true_false")

        if self.type == "code" and self.test_cases is not None and len(self.test_cases) == 0:
            raise ValueError("test_cases must contain at least one case when provided")

        return self


class IngestExamPayload(BaseModel):
    title: str = Field(..., min_length=3, max_length=500)
    description: str | None = Field(default=None, max_length=10_000)
    duration_minutes: int = Field(default=60, ge=5, le=480)
    is_published: bool = False
    questions: list[IngestQuestion] = Field(..., min_length=1)


class ExamCreateIngestionRequest(BaseModel):
    mode: ExamCreationMode
    payload: IngestExamPayload | None = None
    preview_only: bool = True


class IngestionQuestionPreview(BaseModel):
    question_text: str
    question_type: str
    points: int
    options_count: int = 0


class ExamIngestionPreview(BaseModel):
    title: str
    description: str | None
    duration_minutes: int
    is_published: bool
    question_count: int
    questions: list[IngestionQuestionPreview]


class ExamCreateIngestionResponse(BaseModel):
    created: bool
    mode: ExamCreationMode
    exam: ExamRead | None = None
    preview: ExamIngestionPreview
