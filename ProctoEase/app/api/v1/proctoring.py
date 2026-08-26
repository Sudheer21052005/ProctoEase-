"""
Proctoring WebSocket + REST event endpoints.

WebSocket: ws://.../api/v1/exams/{exam_id}/attempts/{attempt_id}/proctor
REST:      GET /api/v1/attempts/{attempt_id}/events
           GET /api/v1/attempts/{attempt_id}/events/count
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.core.security import decode_token
from app.models.user import User, UserRole
from app.schemas.reporting import PaginatedResponse
from app.schemas.proctoring import (
    ProctoringEventCreate,
    ProctoringEventRead,
    ViolationCount,
)
from app.services import proctoring_service

logger = logging.getLogger("proctoease.proctoring.ws")

router = APIRouter(tags=["Proctoring"])

PageDep = Annotated[int, Query(ge=1, description="Page number (1-indexed)")]
PageSizeDep = Annotated[int, Query(ge=1, le=200, description="Items per page (max 200)")]


@router.get(
    "/proctoring/violation-guidelines",
    summary="Get violation guidelines",
)
async def violation_guidelines(
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
):
    """Return canonical violation descriptions, severity, impact, and recommended actions."""
    return proctoring_service.get_violation_guidelines()


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


# ── WebSocket endpoint ──────────────────────────────────────────


@router.websocket("/exams/{exam_id}/attempts/{attempt_id}/proctor")
async def proctoring_ws(
    websocket: WebSocket,
    exam_id: uuid.UUID,
    attempt_id: uuid.UUID,
):
    """
    Real-time proctoring WebSocket.

    Authentication: pass token as query param ?token=<jwt>
    Client sends: {"type": "event", "event_type": "tab_switch", "detail": {...}, "severity": 1}
    Client sends: {"type": "heartbeat"}
    Server responds: {"type": "ack", "violation_count": N, "event_total": M}

    ``violation_count`` counts only gating violations (excludes periodic_check);
    ``event_total`` is every recorded event.
    """
    # Authenticate via query param
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return

    payload = decode_token(token)
    if payload is None or payload.get("type") != "access":
        await websocket.close(code=4001, reason="Invalid token")
        return

    tenant_id = uuid.UUID(payload["tenant_id"])

    await websocket.accept()
    logger.info("ws_connected attempt=%s exam=%s", attempt_id, exam_id)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "Invalid JSON"})
                continue

            msg_type = msg.get("type")

            if msg_type == "heartbeat":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "event":
                event_data = ProctoringEventCreate(
                    event_type=msg.get("event_type", "custom"),
                    detail=msg.get("detail"),
                    severity=msg.get("severity", 1),
                    timestamp=msg.get("timestamp"),
                    snapshot_base64=msg.get("snapshot_base64"),
                )

                # Get a DB session for this event
                from app.core.database import async_session_factory
                from sqlalchemy import text

                async with async_session_factory() as db:
                    try:
                        await db.execute(
                            text(f"SET app.current_tenant_id = '{tenant_id}'")
                        )
                        await proctoring_service.record_event(
                            db, attempt_id, tenant_id, event_data
                        )
                        count = await proctoring_service.count_violations(
                            db, attempt_id, tenant_id
                        )
                        await db.commit()

                        await websocket.send_json({
                            "type": "ack",
                            # gate_total, not total: benign periodic_check events
                            # must not push the client toward auto-submit.
                            "violation_count": count["gate_total"],
                            "event_total": count["total"],
                        })
                    except Exception as e:
                        await db.rollback()
                        logger.error("ws_event_error: %s", e)
                        await websocket.send_json({
                            "type": "error",
                            "message": "Failed to record event",
                        })
            else:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}",
                })

    except WebSocketDisconnect:
        logger.info("ws_disconnected attempt=%s", attempt_id)


# ── REST endpoints ──────────────────────────────────────────────


@router.get(
    "/attempts/{attempt_id}/events",
    response_model=list[ProctoringEventRead],
    summary="List proctoring events",
)
async def list_events(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all proctoring violation events for an attempt (Recruiter/Admin only)."""
    return await proctoring_service.list_events(db, attempt_id, user.tenant_id)


@router.get(
    "/attempts/{attempt_id}/events/paged",
    response_model=PaginatedResponse[ProctoringEventRead],
    summary="List proctoring events (paginated)",
)
async def list_events_paged(
    attempt_id: uuid.UUID,
    page: PageDep = 1,
    page_size: PageSizeDep = 50,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Paginated proctoring events for an attempt (Recruiter/Admin only)."""
    events = await proctoring_service.list_events(db, attempt_id, user.tenant_id)
    return _paginate(events, page, page_size)


@router.get(
    "/attempts/{attempt_id}/events/count",
    response_model=ViolationCount,
    summary="Count violations",
)
async def count_violations(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Get violation count and breakdown for an attempt."""
    return await proctoring_service.count_violations(
        db, attempt_id, user.tenant_id
    )
