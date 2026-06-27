"""
CodeSubmission model — stores candidate code submissions and Judge0 results.
Phase 6: Judge0 Code Execution.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    String, Text, Integer, Float, Boolean, ForeignKey, DateTime,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin


class SubmissionStatus(str, enum.Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    ACCEPTED = "accepted"
    WRONG_ANSWER = "wrong_answer"
    RUNTIME_ERROR = "runtime_error"
    TIME_LIMIT_EXCEEDED = "time_limit_exceeded"
    MEMORY_LIMIT_EXCEEDED = "memory_limit_exceeded"
    COMPILATION_ERROR = "compilation_error"


# Judge0 status_id → our SubmissionStatus mapping
JUDGE0_STATUS_MAP = {
    1: SubmissionStatus.QUEUED,
    2: SubmissionStatus.PROCESSING,
    3: SubmissionStatus.ACCEPTED,
    4: SubmissionStatus.WRONG_ANSWER,
    5: SubmissionStatus.TIME_LIMIT_EXCEEDED,
    6: SubmissionStatus.COMPILATION_ERROR,
    7: SubmissionStatus.MEMORY_LIMIT_EXCEEDED,  # MLE not standard Judge0 — mapped as runtime
    8: SubmissionStatus.RUNTIME_ERROR,           # SIGXFSZ
    9: SubmissionStatus.RUNTIME_ERROR,           # SIGFPE
    10: SubmissionStatus.RUNTIME_ERROR,          # SIGABRT
    11: SubmissionStatus.RUNTIME_ERROR,          # NZEC
    12: SubmissionStatus.RUNTIME_ERROR,          # Other
    13: SubmissionStatus.RUNTIME_ERROR,          # Internal error
    14: SubmissionStatus.RUNTIME_ERROR,          # Exec format error
}


class CodeSubmission(Base, TenantMixin):
    __tablename__ = "code_submissions"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("questions.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )

    # Code details
    language_id: Mapped[int] = mapped_column(Integer, nullable=False)
    language_name: Mapped[str] = mapped_column(String(50), nullable=False)
    source_code: Mapped[str] = mapped_column(Text, nullable=False)
    stdin: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Execution results (populated after Judge0 returns)
    stdout: Mapped[str | None] = mapped_column(Text, nullable=True)
    stderr: Mapped[str | None] = mapped_column(Text, nullable=True)
    compile_output: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default=SubmissionStatus.QUEUED.value
    )
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    time_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_kb: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # Judge0 tracking
    judge0_token: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    attempt = relationship("ExamAttempt", backref="code_submissions")
    question = relationship("Question", backref="code_submissions")
