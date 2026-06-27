"""Code submission schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class CodeSubmit(BaseModel):
    """Request body for submitting code to Judge0."""
    language_id: int = Field(..., ge=1, description="Judge0 language ID (e.g. 71 for Python 3)")
    source_code: str = Field(..., min_length=1, max_length=50_000, description="Source code to execute")
    stdin: str | None = Field(default=None, max_length=10_000, description="Standard input for the program")
    question_id: uuid.UUID | None = Field(default=None, description="Optional question ID this code answers")


class CodeSubmissionRead(BaseModel):
    """Full code submission response."""
    id: uuid.UUID
    attempt_id: uuid.UUID
    question_id: uuid.UUID | None
    language_id: int
    language_name: str
    source_code: str
    stdin: str | None
    stdout: str | None
    stderr: str | None
    compile_output: str | None
    status: str
    exit_code: int | None
    time_sec: float | None
    memory_kb: int | None
    created_at: datetime
    tenant_id: uuid.UUID

    model_config = {"from_attributes": True}


class LanguageRead(BaseModel):
    """Judge0 language info."""
    id: int
    name: str
