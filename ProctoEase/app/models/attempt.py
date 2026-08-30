"""
ExamAttempt model — created by Candidates.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, ForeignKey, DateTime, JSON, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin


class AttemptStatus(str, enum.Enum):
    STARTED = "started"
    SUBMITTED = "submitted"
    EVALUATED = "evaluated"


class RecruiterDecision(str, enum.Enum):
    """
    Final HUMAN decision of a recruiter/admin after reviewing evidence.

    Deliberately distinct from the Phase B system recommendation (deterministic
    engine codes such as MANUAL_REVIEW / SHORTLIST): the recommendation is
    automated decision support and is NEVER overwritten by a decision. The
    recruiter has final authority and may override it in either direction
    (e.g. recommendation INTEGRITY_REVIEW -> decision REJECTED, or
    NOT_RECOMMENDED_BOTH -> SHORTLISTED).
    """

    PENDING = "PENDING"
    SHORTLISTED = "SHORTLISTED"
    REVIEW = "REVIEW"
    REJECTED = "REJECTED"


class ExamAttempt(Base, TenantMixin):
    __tablename__ = "exam_attempts"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AttemptStatus.STARTED.value
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    attempt_end_time: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    verification_image_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    answers: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # ── Phase D: human recruiter review & decision ──
    # All nullable: NULL decision = never reviewed (the UI renders it as
    # PENDING). The system recommendation is derived at read time from
    # persisted ground truth and is deliberately NOT a column here — a
    # recruiter decision must never overwrite it.
    recruiter_decision: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )
    recruiter_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        # SET NULL: removing a reviewer user must not delete the attempt or
        # the decision record itself.
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    exam = relationship("Exam", back_populates="attempts")
    candidate = relationship("User", backref="attempts", foreign_keys=[candidate_id])
