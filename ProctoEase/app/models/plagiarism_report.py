"""
PlagiarismReport model — stores pairwise similarity scores between submissions.
Phase 7: Plagiarism Detection.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    String, Float, Text, Integer, Boolean, ForeignKey, DateTime, JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin


class ReportStatus(str, enum.Enum):
    PENDING = "pending"        # Queued for analysis
    PROCESSING = "processing"  # Analysis in progress
    COMPLETED = "completed"    # Results available
    FAILED = "failed"          # Analysis failed


class PlagiarismReport(Base, TenantMixin):
    """
    Per-exam plagiarism analysis report.
    Contains aggregate results + links to individual pair comparisons.
    """
    __tablename__ = "plagiarism_reports"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ReportStatus.PENDING.value
    )
    total_pairs: Mapped[int] = mapped_column(Integer, default=0)
    flagged_pairs: Mapped[int] = mapped_column(Integer, default=0)
    threshold: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.8,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    exam = relationship("Exam", backref="plagiarism_reports")
    pairs = relationship(
        "PlagiarismPair", back_populates="report",
        cascade="all, delete-orphan", lazy="selectin",
    )


class PlagiarismPair(Base, TenantMixin):
    """
    A pairwise comparison between two code submissions.
    Stores the similarity score and matching details.
    """
    __tablename__ = "plagiarism_pairs"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    report_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("plagiarism_reports.id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    submission_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("code_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    submission_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("code_submissions.id", ondelete="CASCADE"),
        nullable=False,
    )
    candidate_a_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    candidate_b_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    similarity_score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0,
    )
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    matching_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens_a: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens_b: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # Relationships
    report = relationship("PlagiarismReport", back_populates="pairs")
    submission_a = relationship(
        "CodeSubmission", foreign_keys=[submission_a_id],
        backref="plagiarism_as_a",
    )
    submission_b = relationship(
        "CodeSubmission", foreign_keys=[submission_b_id],
        backref="plagiarism_as_b",
    )
