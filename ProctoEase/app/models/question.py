"""
Question model — exam content (MCQ, multi-select, true/false, short answer).
Questions belong to an exam and are tenant-scoped.
"""

from __future__ import annotations

import enum
import uuid

from sqlalchemy import String, ForeignKey, Integer, Text, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin


class QuestionType(str, enum.Enum):
    MCQ          = "mcq"
    MULTI_SELECT = "multi_select"
    TRUE_FALSE   = "true_false"
    SHORT_ANSWER = "short_answer"
    CODE         = "code"


class Question(Base, TenantMixin, TimestampMixin):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    exam_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    question_text: Mapped[str] = mapped_column(Text, nullable=False)
    question_type: Mapped[str] = mapped_column(
        String(20), nullable=False, default=QuestionType.MCQ.value
    )
    # MCQ/MULTI_SELECT: [{"label": "A", "text": "Option 1"}, ...]
    options: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    # MCQ: "A", MULTI_SELECT: ["A","B"], TRUE_FALSE: true/false, SHORT: "answer text"
    correct_answer: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    points: Mapped[int] = mapped_column(Integer, default=1)
    order_index: Mapped[int] = mapped_column(Integer, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    # Relationships
    exam = relationship("Exam", backref="questions")
