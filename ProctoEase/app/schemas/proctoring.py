"""Proctoring schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config.violation_guidelines import CANONICAL_VIOLATION_TYPES

ViolationType = Literal[
    "tab_switch",
    "fullscreen_exit",
    "keyboard_block",
    "copy_paste",
    "right_click",
    "browser_devtools",
    "inactivity",
    "multiple_faces",
    "no_face",
    "audio_anomaly",
    "custom",
    "rapid_tab_switching",
    "suspicious_activity_burst",
    "bulk_paste_detected",
    "impossible_answer_speed",
    "periodic_check",
    "face_inconsistency",
    "keyboard_shortcut",
    "gaze_away",
    "head_turned",
    "phone_detected",
    "unauthorized_object",
]


class ProctoringEventCreate(BaseModel):
    """Incoming proctoring event from client (via WebSocket or REST)."""
    event_type: ViolationType = Field(
        ...,
        description=f"Violation type. Allowed values: {', '.join(CANONICAL_VIOLATION_TYPES)}",
    )
    detail: dict[str, Any] | None = Field(
        default=None,
        description="Extra context. keyboard_block: {'key': 'Ctrl+C', 'action': 'copy'}. tab_switch: {'away_duration_ms': 1500}.",
    )
    severity: int = Field(
        default=1,
        ge=1,
        le=3,
        description="1=low, 2=medium, 3=high",
    )
    timestamp: datetime | None = Field(
        default=None,
        description="Client-side event timestamp (ISO-8601).",
    )
    snapshot_base64: str | None = Field(
        default=None,
        description="Optional data URL snapshot image (jpeg/png).",
    )


class ProctoringEventRead(BaseModel):
    id: uuid.UUID
    attempt_id: uuid.UUID
    event_type: str
    detail: dict[str, Any] | None
    snapshot_path: str | None
    snapshot_url: str | None
    severity: int
    is_active: bool
    created_at: datetime
    tenant_id: uuid.UUID

    model_config = {"from_attributes": True}


class ViolationCount(BaseModel):
    """Summary violation count for an attempt."""
    attempt_id: uuid.UUID
    total: int
    gate_total: int = Field(
        default=0,
        description=(
            "Events counting toward the exam-termination threshold "
            "(excludes benign types such as periodic_check)."
        ),
    )
    by_type: dict[str, int]


class WebSocketIncoming(BaseModel):
    """Schema for messages received via the proctoring WebSocket."""
    type: str = Field(..., description="'event' | 'heartbeat'")
    event_type: str | None = None
    detail: dict[str, Any] | None = None
    severity: int = 1


class WebSocketOutgoing(BaseModel):
    """Schema for messages sent back via WebSocket."""
    type: str  # "ack" | "error" | "pong"
    violation_count: int | None = None
    message: str | None = None
