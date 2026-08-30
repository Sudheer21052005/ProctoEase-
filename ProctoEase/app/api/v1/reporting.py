"""
Reporting & analytics endpoints — dashboards, analytics, and CSV exports.
Phase 9: Reporting & Analytics.
"""

import uuid
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.user import User, UserRole
from app.schemas.reporting import (
    TenantDashboard,
    ExamAnalytics,
    QuestionStats,
    CandidatePerformance,
    PaginatedResponse,
)
from app.schemas.exam_evaluation import ExamEvaluationResponse
from app.services import (
    reporting_service,
    integrity_report_service,
    exam_evaluation_service,
)

router = APIRouter(tags=["Reporting"])

# ── Reusable pagination query params ────────────────────────────

PageDep = Annotated[int, Query(ge=1, description="Page number (1-indexed)")]
PageSizeDep = Annotated[int, Query(ge=1, le=200, description="Items per page (max 200)")]


# ── Tenant Dashboard ────────────────────────────────────────────


@router.get(
    "/dashboard",
    response_model=TenantDashboard,
    summary="Tenant dashboard",
)
async def tenant_dashboard(
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get high-level statistics for the current tenant.
    Includes exam counts, attempt stats, risk distribution, and totals.
    Recruiter / Admin only.
    """
    return await reporting_service.get_tenant_dashboard(db, user.tenant_id)


# ── Per-Exam Analytics ──────────────────────────────────────────


@router.get(
    "/exams/{exam_id}/analytics",
    response_model=ExamAnalytics,
    summary="Exam analytics",
)
async def exam_analytics(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get detailed analytics for a specific exam.
    Includes completion rate, avg duration, risk stats, and event counts.
    Recruiter / Admin only.
    """
    return await reporting_service.get_exam_analytics(
        db, exam_id, user.tenant_id
    )


# ── Exam-Wide Candidate Evaluation ──────────────────────────────


@router.get(
    "/exams/{exam_id}/evaluation",
    response_model=ExamEvaluationResponse,
    summary="Exam-wide candidate evaluation",
)
async def exam_evaluation(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Compact per-candidate evaluation for every attempt in one exam.

    Each entry includes candidate identity, attempt status and timing, the
    score breakdown (objective + coding, with max and percentage), the
    persisted risk score/level, violation severity counts, and a deterministic
    system recommendation. Read-only; risk is never recomputed here.
    Recruiter / Admin only.
    """
    return await exam_evaluation_service.get_exam_evaluation(
        db, exam_id, user.tenant_id
    )



# ── Question Stats (paginated) ──────────────────────────────────


@router.get(
    "/exams/{exam_id}/question-stats",
    response_model=PaginatedResponse[QuestionStats],
    summary="Question-level statistics",
)
async def exam_question_stats(
    exam_id: uuid.UUID,
    page: PageDep = 1,
    page_size: PageSizeDep = 20,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get per-question statistics for an exam (paginated).
    Shows submission counts, success rates, and avg execution time.

    - **page**: page number, 1-indexed
    - **page_size**: items per page, max 200

    Recruiter / Admin only.
    """
    return await reporting_service.get_exam_question_stats(
        db, exam_id, user.tenant_id, page=page, page_size=page_size
    )


# ── Candidate Performance (attempts paginated) ─────────────────


@router.get(
    "/candidates/{candidate_id}/performance",
    response_model=CandidatePerformance,
    summary="Candidate performance",
)
async def candidate_performance(
    candidate_id: uuid.UUID,
    page: PageDep = 1,
    page_size: PageSizeDep = 20,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a candidate's performance summary across all exams.
    The **attempts** list is paginated; envelope fields (total_attempts,
    completed_attempts, average_risk_score) always reflect *all* attempts.

    - **page**: page of attempts to return
    - **page_size**: attempts per page, max 200

    Recruiter / Admin only.
    """
    data = await reporting_service.get_candidate_performance(
        db, candidate_id, user.tenant_id, page=page, page_size=page_size
    )
    # Attach pagination metadata as extra fields on the response
    response = {
        "candidate_id": data["candidate_id"],
        "candidate_name": data["candidate_name"],
        "candidate_email": data["candidate_email"],
        "total_attempts": data["total_attempts"],
        "completed_attempts": data["completed_attempts"],
        "average_risk_score": data["average_risk_score"],
        "attempts": data["attempts"],
        "page": data["_pagination"]["page"],
        "page_size": data["_pagination"]["page_size"],
        "pages": data["_pagination"]["pages"],
    }
    return response


# ── CSV Exports ─────────────────────────────────────────────────


@router.get(
    "/exams/{exam_id}/export/csv",
    summary="Export exam results as CSV",
)
async def export_exam_csv(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Download exam results as a CSV file.
    Contains candidate info, status, duration, risk score, and event counts.
    Recruiter / Admin only.
    """
    csv_content, row_count = await reporting_service.export_exam_results_csv(
        db, exam_id, user.tenant_id
    )

    filename = (
        f"exam_results_{exam_id}_"
        f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    )

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Row-Count": str(row_count),
        },
    )


@router.get(
    "/dashboard/export/csv",
    summary="Export tenant dashboard as CSV",
)
async def export_dashboard_csv(
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Download tenant-wide exam summary as a CSV file.
    One row per exam with attempt counts, risk scores, and event stats.
    Recruiter / Admin only.
    """
    csv_content, row_count = await reporting_service.export_tenant_dashboard_csv(
        db, user.tenant_id
    )

    filename = (
        f"tenant_dashboard_"
        f"{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.csv"
    )

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Row-Count": str(row_count),
        },
    )


# ── Integrity Report PDF ───────────────────────────────────────────


@router.get(
    "/attempts/{attempt_id}/integrity-report/pdf",
    summary="Download candidate integrity report as PDF",
)
async def download_integrity_report_pdf(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate and download a candidate integrity report PDF for a single exam attempt.
    Includes risk summary, violation timeline with snapshots, MCQ and code results.
    Recruiter / Admin only.
    """
    pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
        db, attempt_id, user.tenant_id
    )

    filename = f"integrity_report_{attempt_id}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.pdf"

    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
