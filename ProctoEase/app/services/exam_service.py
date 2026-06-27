"""
Exam service — CRUD operations (tenant-scoped).
Phase 4: Uses domain exceptions instead of raw HTTPException.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExamNotFound, BadRequest
from app.models.exam import Exam
from app.schemas.exam import ExamCreate


async def create_exam(
    db: AsyncSession,
    payload: ExamCreate,
    tenant_id: uuid.UUID,
    created_by: uuid.UUID,
) -> Exam:
    """Create a new exam under the given tenant."""
    if payload.start_time and payload.end_time and payload.start_time >= payload.end_time:
        raise BadRequest("Exam end_time must be after start_time")

    exam = Exam(
        title=payload.title,
        description=payload.description,
        duration_minutes=payload.duration_minutes,
        start_time=payload.start_time,
        end_time=payload.end_time,
        is_published=payload.is_published,
        tenant_id=tenant_id,
        created_by=created_by,
    )
    db.add(exam)
    await db.flush()
    return exam


async def list_exams(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    published_only: bool = False,
) -> list[Exam]:
    """
    List exams for a tenant.
    If published_only=True, filter to published + active exams (candidate view).
    """
    query = select(Exam).where(
        Exam.tenant_id == tenant_id,
        Exam.is_active == True,  # noqa: E712 — SQLAlchemy requires ==
    )
    if published_only:
        query = query.where(Exam.is_published == True)  # noqa: E712
    query = query.order_by(Exam.created_at.desc())

    result = await db.execute(query)
    return list(result.scalars().all())


async def get_exam(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Exam:
    """Get a single exam by ID within a tenant. Raises ExamNotFound if missing."""
    result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    exam = result.scalar_one_or_none()
    if exam is None:
        raise ExamNotFound()
    return exam


async def update_exam(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
    payload: "ExamUpdate",
) -> Exam:
    """Partial update — only apply fields that were explicitly set."""
    from app.schemas.exam import ExamUpdate  # avoid circular at module level

    exam = await get_exam(db, exam_id, tenant_id)
    update_data = payload.model_dump(exclude_unset=True)
    start_time = update_data.get("start_time", exam.start_time)
    end_time = update_data.get("end_time", exam.end_time)
    if start_time and end_time and start_time >= end_time:
        raise BadRequest("Exam end_time must be after start_time")
    for field, value in update_data.items():
        setattr(exam, field, value)
    await db.flush()
    return exam

