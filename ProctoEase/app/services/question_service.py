"""
Question service — CRUD for exam questions (tenant-scoped).
"""

from __future__ import annotations

import uuid

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExamNotFound, NotFound
from app.models.question import Question
from app.models.exam import Exam
from app.schemas.question import QuestionCreate


async def create_question(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
    payload: QuestionCreate,
) -> Question:
    """Add a question to an exam."""
    # Verify exam exists and belongs to tenant
    result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    if result.scalar_one_or_none() is None:
        raise ExamNotFound()

    question = Question(
        exam_id=exam_id,
        tenant_id=tenant_id,
        question_text=payload.question_text,
        question_type=payload.question_type,
        options=payload.options,
        correct_answer=payload.correct_answer,
        points=payload.points,
        order_index=payload.order_index,
    )
    db.add(question)
    await db.flush()
    return question


async def list_questions(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[Question]:
    """List all active questions for an exam, ordered by order_index."""
    result = await db.execute(
        select(Question).where(
            and_(
                Question.exam_id == exam_id,
                Question.tenant_id == tenant_id,
                Question.is_active == True,  # noqa: E712
            )
        ).order_by(Question.order_index.asc())
    )
    return list(result.scalars().all())


async def get_question(
    db: AsyncSession,
    question_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Question:
    """Get a single question by ID."""
    result = await db.execute(
        select(Question).where(
            Question.id == question_id,
            Question.tenant_id == tenant_id,
            Question.is_active == True,  # noqa: E712
        )
    )
    question = result.scalar_one_or_none()
    if question is None:
        raise NotFound("Question not found")
    return question


async def delete_question(
    db: AsyncSession,
    question_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> None:
    """Soft-delete a question."""
    question = await get_question(db, question_id, tenant_id)
    question.is_active = False
    await db.flush()
