"""
ProctoringEvent model — stores real-time proctoring violations.
Each event is tied to a specific exam attempt and tenant-scoped.
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import String, ForeignKey, DateTime, Boolean, Integer, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin


class EventType(str, enum.Enum):
    """Types of proctoring violations detected."""
    TAB_SWITCH      = "tab_switch"
    FULLSCREEN_EXIT = "fullscreen_exit"
    KEYBOARD_BLOCK  = "keyboard_block"
    COPY_PASTE      = "copy_paste"
    RIGHT_CLICK     = "right_click"
    INACTIVITY      = "inactivity"
    NO_FACE         = "no_face"
    MULTIPLE_FACES  = "multiple_faces"
    AUDIO_ANOMALY   = "audio_anomaly"
    BROWSER_DEVTOOLS = "browser_devtools"
    CUSTOM          = "custom"
    RAPID_TAB_SWITCHING = "rapid_tab_switching"
    SUSPICIOUS_ACTIVITY_BURST = "suspicious_activity_burst"
    BULK_PASTE_DETECTED = "bulk_paste_detected"
    IMPOSSIBLE_ANSWER_SPEED = "impossible_answer_speed"
    PERIODIC_CHECK = "periodic_check"
    FACE_INCONSISTENCY = "face_inconsistency"


# Keyboard shortcuts that are blocked and logged
BLOCKED_KEYS = [
    "Ctrl+C",       # Copy
    "Ctrl+V",       # Paste
    "Ctrl+X",       # Cut
    "Ctrl+A",       # Select all
    "Ctrl+S",       # Save
    "Ctrl+P",       # Print
    "Ctrl+Shift+I", # DevTools
    "Ctrl+Shift+J", # DevTools console
    "Ctrl+U",       # View source
    "F12",          # DevTools
    "PrintScreen",  # Screenshot
    "Alt+PrintScreen",  # Window screenshot
    "Win+PrintScreen",  # System screenshot
    "Win+Shift+S",      # Snipping tool
    "Ctrl+Shift+S",     # Screenshot (some browsers)
]


class ProctoringEvent(Base, TenantMixin):
    __tablename__ = "proctoring_events"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True, default=uuid.uuid4
    )
    attempt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("exam_attempts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(
        String(30), nullable=False, index=True
    )
    detail: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # For keyboard_block: {"key": "Ctrl+C", "action": "copy"}
    # For tab_switch: {"away_duration_ms": 1500}
    # For no_face / multiple_faces: {"face_count": 0}

    snapshot_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    severity: Mapped[int] = mapped_column(Integer, default=1)
    # 1=low, 2=medium, 3=high

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    attempt = relationship("ExamAttempt", backref="proctoring_events")
