"""
Risk scoring engine — computes composite risk from proctoring events.
Phase 8: Risk Scoring Engine.

Approach:
  1. Collect all proctoring events for an attempt
  2. Group by event_type and count occurrences
  3. Apply configurable weights per event type
  4. Each event type contributes: weight × diminishing_factor(count)
  5. Overall score = capped sum of all contributions (0.0–1.0)
  6. Risk level derived from score thresholds
"""

from __future__ import annotations

import logging
import math
import uuid
from collections import Counter
from datetime import datetime, timezone

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.violation_guidelines import DEFAULT_RISK_WEIGHTS
from app.core.exceptions import AttemptNotFound
from app.models.proctoring_event import ProctoringEvent
from app.models.risk_score import RiskScore
from app.schemas.risk_score import RiskWeightsUpdate

logger = logging.getLogger("proctoease.risk")


# ── Default Event Weights ─────────────────────────────────────────
# Centralized in app.config.violation_guidelines.DEFAULT_RISK_WEIGHTS.
DEFAULT_WEIGHTS: dict[str, float] = DEFAULT_RISK_WEIGHTS.copy()

# Risk level thresholds
RISK_THRESHOLDS = {
    "low":      0.25,
    "medium":   0.50,
    "high":     0.75,
    # above 0.75 → critical
}


# ── Public API ───────────────────────────────────────────────────


async def compute_risk(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
    weights: RiskWeightsUpdate | None = None,
) -> RiskScore:
    """
    Compute (or recompute) the risk score for an exam attempt.

    - Fetches all proctoring events for the attempt
    - Groups by type, applies weighted scoring with diminishing returns
    - Stores/updates the RiskScore record
    """

    # Get all events for this attempt
    result = await db.execute(
        select(ProctoringEvent).where(
            and_(
                ProctoringEvent.attempt_id == attempt_id,
                ProctoringEvent.tenant_id == tenant_id,
                ProctoringEvent.is_active == True,  # noqa: E712
            )
        )
    )
    events = list(result.scalars().all())

    # Build weight map (defaults + overrides)
    weight_map = DEFAULT_WEIGHTS.copy()
    if weights:
        weight_map.update(weights.model_dump())

    # Count events by type
    event_counts: dict[str, int] = Counter(e.event_type for e in events)
    total_events = len(events)
    print("[RISK INPUT]", dict(event_counts))

    # Compute per-type contribution with diminishing returns
    breakdown: dict[str, float] = {}
    raw_score = 0.0

    for event_type, count in event_counts.items():
        w = weight_map.get(event_type, 0.1)
        # Diminishing returns: log2(count + 1) caps repeated events
        # 1 event  → factor 1.0
        # 2 events → factor 1.58
        # 4 events → factor 2.32
        # 8 events → factor 3.17
        diminishing = math.log2(count + 1)
        contribution = w * diminishing
        breakdown[event_type] = round(contribution, 4)
        raw_score += contribution

    # Normalize to 0.0–1.0 using sigmoid-like capping
    # score = 1 − e^(−raw/2) ensures smooth saturation toward 1.0
    overall_score = round(1.0 - math.exp(-raw_score / 2.0), 4) if raw_score > 0 else 0.0
    print("[RISK OUTPUT]", overall_score)

    # Determine risk level
    risk_level = _classify_risk(overall_score)

    # Upsert RiskScore record (one per attempt)
    existing = await db.execute(
        select(RiskScore).where(
            and_(
                RiskScore.attempt_id == attempt_id,
                RiskScore.tenant_id == tenant_id,
            )
        )
    )
    risk_score = existing.scalar_one_or_none()

    if risk_score:
        risk_score.overall_score = overall_score
        risk_score.risk_level = risk_level
        risk_score.breakdown = breakdown
        risk_score.event_counts = dict(event_counts)
        risk_score.total_events = total_events
        risk_score.computed_at = datetime.now(timezone.utc)
    else:
        risk_score = RiskScore(
            attempt_id=attempt_id,
            tenant_id=tenant_id,
            overall_score=overall_score,
            risk_level=risk_level,
            breakdown=breakdown,
            event_counts=dict(event_counts),
            total_events=total_events,
        )
        db.add(risk_score)

    await db.flush()

    logger.info(
        "risk_computed attempt=%s score=%.4f level=%s events=%d",
        attempt_id, overall_score, risk_level, total_events,
    )

    return risk_score


async def get_risk_score(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> RiskScore | None:
    """Get existing risk score for an attempt (returns None if not computed yet)."""
    result = await db.execute(
        select(RiskScore).where(
            and_(
                RiskScore.attempt_id == attempt_id,
                RiskScore.tenant_id == tenant_id,
            )
        )
    )
    return result.scalar_one_or_none()


async def get_exam_risk_scores(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[RiskScore]:
    """Get all risk scores for attempts in an exam."""
    from app.models.attempt import ExamAttempt

    result = await db.execute(
        select(RiskScore)
        .join(ExamAttempt, RiskScore.attempt_id == ExamAttempt.id)
        .where(
            and_(
                ExamAttempt.exam_id == exam_id,
                RiskScore.tenant_id == tenant_id,
            )
        )
        .order_by(RiskScore.overall_score.desc())
    )
    return list(result.scalars().all())


# ── Internal helpers ─────────────────────────────────────────────


def _classify_risk(score: float) -> str:
    """Map numeric score to risk level label."""
    if score < RISK_THRESHOLDS["low"]:
        return "low"
    elif score < RISK_THRESHOLDS["medium"]:
        return "medium"
    elif score < RISK_THRESHOLDS["high"]:
        return "high"
    else:
        return "critical"
