"""
Attempt endpoints — Candidate + Recruiter, tenant-scoped.
Phase 10: Rate limit on attempt creation.
Phase 11: Submit endpoint, answer management, recruiter attempt listing.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.core.limiter import limiter
from app.models.attempt import ExamAttempt
from app.models.user import User, UserRole
from app.schemas.attempt import (
    AttemptRead,
    AttemptCreate,
    RecruiterDecisionRead,
    RecruiterDecisionUpdate,
)
from app.schemas.answer import BulkAnswerSubmit, AnswersResponse
from app.schemas.reporting import PaginatedResponse
from app.services import attempt_service, answer_service

router = APIRouter(tags=["Attempts"])

PageDep = Annotated[int, Query(ge=1, description="Page number (1-indexed)")]
PageSizeDep = Annotated[int, Query(ge=1, le=200, description="Items per page (max 200)")]


def _paginate(items: list, page: int, page_size: int) -> dict:
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    total = len(items)
    pages = max(1, -(-total // page_size))
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": items[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }


# ── Candidate: Start attempt ────────────────────────────────────


@router.post(
    "/exams/{exam_id}/attempts",
    response_model=AttemptRead,
    status_code=status.HTTP_201_CREATED,
    summary="Start exam attempt",
)
@limiter.limit("5/minute")
async def start_attempt(
    request: Request,
    exam_id: uuid.UUID,
    payload: AttemptCreate | None = None,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Start a new exam attempt (Candidate only).
    One attempt per candidate per exam.

    **Rate limit**: 5 requests / minute per IP.
    """
    return await attempt_service.create_attempt(
        db,
        exam_id,
        user.id,
        user.tenant_id,
        verification_image_base64=(payload.verification_image_base64 if payload else None),
    )


# ── Candidate: Submit attempt ───────────────────────────────────


@router.patch(
    "/attempts/{attempt_id}/submit",
    response_model=AttemptRead,
    summary="Submit exam attempt",
)
async def submit_attempt(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize an attempt — auto-grades MCQ answers and marks as submitted.
    Cannot be undone.
    """
    return await attempt_service.submit_attempt(
        db, attempt_id, user.id, user.tenant_id
    )


# ── Candidate: Save answers ────────────────────────────────────


@router.post(
    "/attempts/{attempt_id}/answers",
    summary="Save answers (auto-save friendly)",
    status_code=status.HTTP_200_OK,
)
async def save_answers(
    attempt_id: uuid.UUID,
    payload: BulkAnswerSubmit,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk upsert answers for an in-progress attempt.
    Call this periodically for auto-save, and once more before submitting.
    Merges with previously saved answers.
    """
    return await answer_service.save_answers(
        db, attempt_id, user.id, user.tenant_id, payload.answers
    )


# ── Read answers ────────────────────────────────────────────────


@router.get(
    "/attempts/{attempt_id}/answers",
    response_model=AnswersResponse,
    summary="Get saved answers",
)
async def get_answers(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve all saved answers for an attempt.
    Includes grading results (is_correct, points_earned) after submission.
    """
    if user.role == UserRole.CANDIDATE:
        return await answer_service.get_answers_for_candidate(
            db, attempt_id, user.id, user.tenant_id
        )

    return await answer_service.get_answers(db, attempt_id, user.tenant_id)


# ── Candidate: List my attempts ─────────────────────────────────


@router.get("/attempts/me", response_model=list[AttemptRead], summary="List my attempts")
async def list_my_attempts(
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """List the current candidate's own attempts."""
    return await attempt_service.list_my_attempts(db, user.id, user.tenant_id)


# ── Recruiter: List attempts for exam ───────────────────────────


@router.get(
    "/exams/{exam_id}/attempts",
    response_model=list[AttemptRead],
    summary="List attempts for exam",
)
async def list_exam_attempts(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all candidate attempts for an exam (Recruiter/Admin only)."""
    return await attempt_service.list_exam_attempts(
        db, exam_id, user.tenant_id
    )


@router.get(
    "/exams/{exam_id}/attempts/paged",
    response_model=PaginatedResponse[AttemptRead],
    summary="List attempts for exam (paginated)",
)
async def list_exam_attempts_paged(
    exam_id: uuid.UUID,
    page: PageDep = 1,
    page_size: PageSizeDep = 20,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Paginated attempts for an exam (Recruiter/Admin only)."""
    attempts = await attempt_service.list_exam_attempts(db, exam_id, user.tenant_id)
    return _paginate(attempts, page, page_size)


# ── Recruiter: Set final human decision (Phase D) ───────────────


@router.put(
    "/attempts/{attempt_id}/recruiter-decision",
    response_model=RecruiterDecisionRead,
    summary="Set recruiter decision",
)
async def set_recruiter_decision(
    attempt_id: uuid.UUID,
    payload: RecruiterDecisionUpdate,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Persist the recruiter's FINAL HUMAN decision (PENDING / SHORTLISTED /
    REVIEW / REJECTED) plus evidence notes for one attempt.

    This is the authoritative human judgment and is stored separately from
    the automated system recommendation, which it never overwrites.
    Recruiter/Admin only; strictly tenant-scoped.
    """
    attempt = await attempt_service.set_recruiter_decision(
        db,
        attempt_id,
        user.tenant_id,
        payload.decision,
        payload.notes,
        reviewer=user,
    )
    return RecruiterDecisionRead(
        attempt_id=attempt.id,
        decision=attempt.recruiter_decision,
        notes=attempt.recruiter_notes,
        reviewed_by=attempt.reviewed_by,
        reviewed_by_email=user.email,
        reviewed_at=attempt.reviewed_at,
    )


@router.post(
    "/attempts/admin/regrade-all",
    summary="Regrade all submitted attempts",
)
async def regrade_all_attempts(
    user: User = Depends(require_role(UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Regrade all submitted attempts that have answers."""
    result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.status == "submitted",
            ExamAttempt.tenant_id == user.tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempts = result.scalars().all()

    regraded = 0
    for attempt in attempts:
        if attempt.answers:
            await answer_service.auto_grade(db, attempt, user.tenant_id)
            regraded += 1

    await db.commit()
    return {"regraded": regraded}
