"""
RiskScore model — per-attempt composite risk score with event breakdown.
Phase 8: Risk Scoring Engine.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Float, ForeignKey, DateTime, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin


class RiskScore(Base, TenantMixin):
    """
    Composite risk score for an exam attempt.

    - overall_score: 0.0 (no risk) to 1.0 (maximum risk)
    - risk_level: low / medium / high / critical
    - breakdown: per-event-type weighted scores
    - event_counts: how many of each event type occurred
    """
    __tablename__ = "risk_scores"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"),
        nullable=False, index=True, unique=True,
    )
    overall_score: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0,
    )
    risk_level: Mapped[str] = mapped_column(
        String(20), nullable=False, default="low",
    )
    # {"tab_switch": 0.15, "no_face": 0.4, ...}
    breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # {"tab_switch": 3, "no_face": 2, ...}
    event_counts: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    total_events: Mapped[int] = mapped_column(Integer, default=0)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    attempt = relationship("ExamAttempt", backref="risk_score")
