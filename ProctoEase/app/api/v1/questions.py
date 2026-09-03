"""
Question endpoints — CRUD for exam questions (Recruiter/Admin + Candidate read).
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role, get_current_user
from app.models.user import User, UserRole
from app.schemas.question import QuestionCreate, QuestionRead, QuestionReadCandidate
from app.services import question_service

router = APIRouter(tags=["Questions"])


@router.post(
    "/exams/{exam_id}/questions",
    response_model=QuestionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Add question to exam",
)
async def create_question(
    exam_id: uuid.UUID,
    payload: QuestionCreate,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Add a question to an exam (Recruiter/Admin only)."""
    return await question_service.create_question(
        db, exam_id, user.tenant_id, payload
    )


@router.get(
    "/exams/{exam_id}/questions",
    summary="List exam questions",
)
async def list_questions(
    exam_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List questions for an exam.
    - Recruiters/Admins see full details including correct_answer.
    - Candidates see questions without correct_answer; for code questions, public test cases are included.
    """
    questions = await question_service.list_questions(
        db, exam_id, user.tenant_id
    )
    if user.role == UserRole.CANDIDATE:
        result = []
        for q in questions:
            data = QuestionReadCandidate.model_validate(q).model_dump()
            if q.question_type == "code" and q.correct_answer:
                test_cases = q.correct_answer.get("test_cases") or []
                has_public = any(tc.get("is_public") for tc in test_cases)
                if not has_public and test_cases:
                    public_cases = [
                        {"input": test_cases[0].get("input"), "expected": test_cases[0].get("expected")}
                    ]
                else:
                    public_cases = [
                        {"input": tc.get("input"), "expected": tc.get("expected")}
                        for tc in test_cases if tc.get("is_public")
                    ]
                data["public_test_cases"] = public_cases
            result.append(QuestionReadCandidate(**data))
        return result
    return [QuestionRead.model_validate(q) for q in questions]


@router.get(
    "/questions/{question_id}",
    response_model=QuestionRead,
    summary="Get question by ID",
)
async def get_question(
    question_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Get a single question by ID (Recruiter/Admin only)."""
    return await question_service.get_question(
        db, question_id, user.tenant_id
    )


@router.delete(
    "/questions/{question_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete question",
)
async def delete_question(
    question_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete a question (Recruiter/Admin only)."""
    await question_service.delete_question(
        db, question_id, user.tenant_id
    )
