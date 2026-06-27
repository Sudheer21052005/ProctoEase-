"""
Code execution endpoints — submit, poll, list, languages.
Phase 6: Judge0 Code Execution.
Phase 10: Rate limit on code submission.
"""

import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.core.limiter import limiter
from app.models.user import User, UserRole
from app.schemas.code_submission import (
    CodeSubmit, CodeSubmissionRead, LanguageRead,
)
from app.services import code_execution_service

router = APIRouter(tags=["Code Execution"])


@router.post(
    "/attempts/{attempt_id}/code",
    response_model=CodeSubmissionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit code for execution",
)
@limiter.limit("20/minute")
async def submit_code(
    request: Request,
    attempt_id: uuid.UUID,
    payload: CodeSubmit,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit source code for sandboxed execution via Judge0.
    Candidate only — must own the attempt.

    **Rate limit**: 20 requests / minute per IP.
    """
    return await code_execution_service.submit_code(
        db, attempt_id, user.tenant_id, payload
    )


@router.get(
    "/code/languages",
    response_model=list[LanguageRead],
    summary="List available languages",
)
async def list_languages(
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
):
    """Fetch the list of available programming languages from Judge0."""
    return await code_execution_service.list_languages()


@router.get(
    "/code/{submission_id}",
    response_model=CodeSubmissionRead,
    summary="Get submission result",
)
async def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a code submission and its execution result.
    Automatically polls Judge0 if the result is still pending.
    """
    return await code_execution_service.poll_result_for_user(
        db, submission_id, user.id, user.role, user.tenant_id
    )


@router.get(
    "/attempts/{attempt_id}/code",
    response_model=list[CodeSubmissionRead],
    summary="List submissions for attempt",
)
async def list_submissions(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all code submissions for an exam attempt."""
    return await code_execution_service.list_submissions_for_user(
        db, attempt_id, user.id, user.role, user.tenant_id
    )
