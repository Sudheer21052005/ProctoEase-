import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.user import User, UserRole
from app.schemas.plagiarism import (
    PlagiarismTrigger, PlagiarismReportRead, PlagiarismSummaryRead,
)
from app.services import plagiarism_service

logger = logging.getLogger("proctoease.plagiarism")

router = APIRouter(prefix="/exams", tags=["Plagiarism"])


@router.post(
    "/{exam_id}/plagiarism",
    response_model=PlagiarismReportRead,
    status_code=status.HTTP_201_CREATED,
    summary="Trigger plagiarism analysis",
)
async def trigger_analysis(
    exam_id: uuid.UUID,
    payload: PlagiarismTrigger = PlagiarismTrigger(),
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Run plagiarism detection on all code submissions for an exam.
    Recruiter / Admin only.
    """
    try:
        return await plagiarism_service.trigger_analysis(
            db, exam_id, user.tenant_id, payload
        )
    except Exception as exc:
        logger.exception("Plagiarism trigger failed for exam %s: %s", exam_id, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Plagiarism analysis failed: {str(exc)}",
        )


@router.get(
    "/{exam_id}/plagiarism",
    response_model=list[PlagiarismSummaryRead],
    summary="List plagiarism reports",
)
async def list_reports(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all plagiarism reports for an exam (Recruiter / Admin)."""
    return await plagiarism_service.get_exam_reports(
        db, exam_id, user.tenant_id
    )


@router.get(
    "/plagiarism/{report_id}",
    response_model=PlagiarismReportRead,
    summary="Get plagiarism report",
)
async def get_report(
    report_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Get a detailed plagiarism report including all pair comparisons."""
    return await plagiarism_service.get_report(
        db, report_id, user.tenant_id
    )
