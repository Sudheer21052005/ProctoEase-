"""
Risk scoring endpoints — compute and view risk scores.
Phase 8: Risk Scoring Engine.
"""

import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.models.user import User, UserRole
from app.schemas.risk_score import (
    RiskWeightsUpdate, RiskScoreRead, RiskSummaryRead,
)
from app.services import risk_engine

router = APIRouter(tags=["Risk Scoring"])


@router.post(
    "/attempts/{attempt_id}/risk",
    response_model=RiskScoreRead,
    status_code=status.HTTP_201_CREATED,
    summary="Compute risk score",
)
async def compute_risk_score(
    attempt_id: uuid.UUID,
    weights: RiskWeightsUpdate | None = None,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Compute (or recompute) the risk score for an exam attempt.
    Recruiter / Admin only.
    """
    return await risk_engine.compute_risk(
        db, attempt_id, user.tenant_id, weights
    )


@router.get(
    "/attempts/{attempt_id}/risk",
    response_model=RiskScoreRead | None,
    summary="Get risk score",
)
async def get_risk_score(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Get the risk score for an exam attempt (None if not yet computed)."""
    risk = await risk_engine.get_risk_score(
        db, attempt_id, user.tenant_id
    )
    if risk is None:
        risk = await risk_engine.compute_risk(
            db, attempt_id, user.tenant_id
        )
    return risk


@router.get(
    "/exams/{exam_id}/risk-scores",
    response_model=list[RiskSummaryRead],
    summary="List risk scores for exam",
)
async def list_exam_risk_scores(
    exam_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all risk scores for attempts in an exam, sorted by severity."""
    return await risk_engine.get_exam_risk_scores(
        db, exam_id, user.tenant_id
    )
