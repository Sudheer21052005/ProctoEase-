"""
Attempt service — exam attempt management.
Phase 4: Uses domain exceptions instead of raw HTTPException.
Phase 11: Added submit_attempt, list_exam_attempts.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ExamNotPublished,
    ActiveAttemptExists,
    AttemptNotFound,
    AttemptAlreadySubmitted,
    BadRequest,
)
from app.models.attempt import ExamAttempt, AttemptStatus
from app.models.user import User
from app.services.exam_service import get_exam
from app.services import proctoring_image_service

logger = logging.getLogger("proctoease.attempts")


async def create_attempt(
    db: AsyncSession,
    exam_id: uuid.UUID,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
    verification_image_base64: str | None = None,
) -> ExamAttempt:
    """Start a new attempt for a candidate on a published exam."""

    # Verify exam exists, belongs to tenant, and is active
    exam = await get_exam(db, exam_id, tenant_id)
    if not exam.is_published:
        raise ExamNotPublished()

    now = datetime.now(timezone.utc)
    if exam.start_time and now < exam.start_time:
        raise BadRequest("Exam not started yet")
    if exam.end_time and now > exam.end_time:
        raise BadRequest("Exam expired")

    # Enforce: only one attempt per candidate per exam (any status)
    existing = await db.execute(
        select(ExamAttempt).where(
            and_(
                ExamAttempt.exam_id == exam_id,
                ExamAttempt.candidate_id == candidate_id,
                ExamAttempt.is_active == True,  # noqa: E712
            )
        )
    )
    if existing.scalar_one_or_none():
        raise ActiveAttemptExists()

    attempt_id = uuid.uuid4()
    if not verification_image_base64:
        raise BadRequest("Verification image is required before starting exam")

    verification_image_url = proctoring_image_service.save_from_data_url(
        attempt_id,
        verification_image_base64,
        "verification",
    )
    logger.info("verification_image_saved attempt=%s path=%s", attempt_id, verification_image_url)

    attempt_end_time = now + timedelta(minutes=exam.duration_minutes)
    if exam.end_time and attempt_end_time > exam.end_time:
        attempt_end_time = exam.end_time

    attempt = ExamAttempt(
        id=attempt_id,
        exam_id=exam_id,
        candidate_id=candidate_id,
        tenant_id=tenant_id,
        started_at=now,
        attempt_end_time=attempt_end_time,
        verification_image_url=verification_image_url,
    )
    db.add(attempt)
    await db.flush()
    return attempt


async def submit_attempt(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ExamAttempt:
    """
    Finalize an attempt — set status to submitted and run auto-grading.
    """
    result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.candidate_id == candidate_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise AttemptNotFound()
    if attempt.status != AttemptStatus.STARTED.value:
        raise AttemptAlreadySubmitted()

    now = datetime.now(timezone.utc)
    if attempt.attempt_end_time and now > attempt.attempt_end_time:
        from app.services.answer_service import auto_grade
        await auto_grade(db, attempt, tenant_id)
        attempt.status = AttemptStatus.SUBMITTED.value
        attempt.submitted_at = now
        await db.flush()
        return attempt

    # Auto-grade before marking as submitted
    from app.services.answer_service import auto_grade
    await auto_grade(db, attempt, tenant_id)

    attempt.status = AttemptStatus.SUBMITTED.value
    attempt.submitted_at = now
    await db.flush()
    return attempt


async def list_my_attempts(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[ExamAttempt]:
    """List all active attempts for a candidate within a tenant."""
    result = await db.execute(
        select(ExamAttempt).where(
            and_(
                ExamAttempt.candidate_id == candidate_id,
                ExamAttempt.tenant_id == tenant_id,
                ExamAttempt.is_active == True,  # noqa: E712
            )
        ).order_by(ExamAttempt.started_at.desc())
    )
    return list(result.scalars().all())


async def list_exam_attempts(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[ExamAttempt]:
    """List all attempts for an exam (recruiter/admin view)."""
    # Verify exam exists
    await get_exam(db, exam_id, tenant_id)

    result = await db.execute(
        select(ExamAttempt).where(
            and_(
                ExamAttempt.exam_id == exam_id,
                ExamAttempt.tenant_id == tenant_id,
                ExamAttempt.is_active == True,  # noqa: E712
            )
        ).order_by(ExamAttempt.started_at.desc())
    )
    attempts = list(result.scalars().all())
    if not attempts:
        return attempts

    candidate_ids = [a.candidate_id for a in attempts]
    users_result = await db.execute(
        select(User.id, User.email).where(
            and_(
                User.id.in_(candidate_ids),
                User.tenant_id == tenant_id,
            )
        )
    )
    email_by_id = {row[0]: row[1] for row in users_result.all()}

    for attempt in attempts:
        setattr(attempt, "candidate_email", email_by_id.get(attempt.candidate_id))

    return attempts
