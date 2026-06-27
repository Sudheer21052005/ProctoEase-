"""
Proctoring service — record and query proctoring events.
"""

from __future__ import annotations

import asyncio
import logging
import uuid

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.violation_guidelines import CANONICAL_VIOLATION_TYPES, VIOLATION_GUIDELINES
from app.core.exceptions import BadRequest, NotFound
from app.models.proctoring_event import ProctoringEvent
from app.models.attempt import ExamAttempt
from app.schemas.proctoring import ProctoringEventCreate
from app.services import proctoring_image_service

logger = logging.getLogger("proctoease.proctoring")

riskUpdateTracker: dict[uuid.UUID, asyncio.Task] = {}

_LEGACY_EVENT_TYPE_MAP = {
    "keyboard_shortcut": "keyboard_block",
}


def normalize_event_type(event_type: str) -> str:
    """Normalize legacy aliases and enforce canonical event type names."""
    raw = (event_type or "").strip()
    mapped = _LEGACY_EVENT_TYPE_MAP.get(raw, raw)
    if mapped not in CANONICAL_VIOLATION_TYPES:
        raise BadRequest(f"Unknown violation event_type: {raw}")
    return mapped


def get_violation_guidelines() -> dict[str, dict[str, str]]:
    """Return static violation guideline metadata."""
    return VIOLATION_GUIDELINES


async def schedule_risk_compute(db: AsyncSession, attempt_id: uuid.UUID, tenant_id: uuid.UUID):
    if attempt_id in riskUpdateTracker:
        task = riskUpdateTracker[attempt_id]
        if not task.done():
            task.cancel()

    async def delayed_compute():
        try:
            await asyncio.sleep(2)
            from app.core.database import async_session_factory
            from app.services.risk_engine import compute_risk

            async with async_session_factory() as risk_db:
                await compute_risk(
                    db=risk_db,
                    attempt_id=attempt_id,
                    tenant_id=tenant_id,
                )
                await risk_db.commit()
        except asyncio.CancelledError:
            pass
        finally:
            current = riskUpdateTracker.get(attempt_id)
            if current is asyncio.current_task():
                riskUpdateTracker.pop(attempt_id, None)

    task = asyncio.create_task(delayed_compute())
    riskUpdateTracker[attempt_id] = task


async def record_event(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
    payload: ProctoringEventCreate,
) -> ProctoringEvent:
    """Store a proctoring violation event."""
    # Verify attempt exists and belongs to tenant
    result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    if result.scalar_one_or_none() is None:
        raise NotFound("Attempt not found")

    canonical_type = normalize_event_type(payload.event_type)

    detail = dict(payload.detail or {})
    if payload.timestamp is not None:
        detail.setdefault("client_timestamp", payload.timestamp.isoformat())

    normalized_severity = 1 if canonical_type == "periodic_check" else payload.severity

    snapshot_url: str | None = None
    if payload.snapshot_base64:
        try:
            category = "periodic" if canonical_type == "periodic_check" else "violations"
            snapshot_url = proctoring_image_service.save_from_data_url(
                attempt_id,
                payload.snapshot_base64,
                category,
            )
        except Exception as exc:  # non-fatal by design
            logger.warning("snapshot_save_failed attempt=%s type=%s error=%s", attempt_id, canonical_type, exc)

    event = ProctoringEvent(
        attempt_id=attempt_id,
        event_type=canonical_type,
        detail=detail or None,
        snapshot_path=snapshot_url,
        snapshot_url=snapshot_url,
        severity=normalized_severity,
        tenant_id=tenant_id,
    )
    db.add(event)
    await db.flush()

    await schedule_risk_compute(
        db=db,
        attempt_id=attempt_id,
        tenant_id=tenant_id,
    )

    logger.info(
        "proctoring_event attempt=%s type=%s severity=%d",
        attempt_id, canonical_type, normalized_severity,
    )
    return event


async def list_events(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[ProctoringEvent]:
    """List all proctoring events for an attempt."""
    result = await db.execute(
        select(ProctoringEvent).where(
            and_(
                ProctoringEvent.attempt_id == attempt_id,
                ProctoringEvent.tenant_id == tenant_id,
                ProctoringEvent.is_active == True,  # noqa: E712
            )
        ).order_by(ProctoringEvent.created_at.asc())
    )
    return list(result.scalars().all())


async def count_violations(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Return total violation count and breakdown by type."""
    events = await list_events(db, attempt_id, tenant_id)
    by_type: dict[str, int] = {}
    for evt in events:
        by_type[evt.event_type] = by_type.get(evt.event_type, 0) + 1
    return {
        "attempt_id": attempt_id,
        "total": len(events),
        "by_type": by_type,
    }
