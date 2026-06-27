"""Risk score schemas — request / response DTOs."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RiskWeightsUpdate(BaseModel):
    """Request body to override default event weights."""
    tab_switch: float = Field(default=0.3, ge=0.0, le=1.0)
    fullscreen_exit: float = Field(default=0.3, ge=0.0, le=1.0)
    keyboard_block: float = Field(default=0.25, ge=0.0, le=1.0)
    copy_paste: float = Field(default=0.4, ge=0.0, le=1.0)
    right_click: float = Field(default=0.2, ge=0.0, le=1.0)
    browser_devtools: float = Field(default=0.6, ge=0.0, le=1.0)
    inactivity: float = Field(default=0.2, ge=0.0, le=1.0)
    no_face: float = Field(default=0.6, ge=0.0, le=1.0)
    multiple_faces: float = Field(default=0.8, ge=0.0, le=1.0)
    audio_anomaly: float = Field(default=0.4, ge=0.0, le=1.0)
    custom: float = Field(default=0.1, ge=0.0, le=1.0)
    rapid_tab_switching: float = Field(default=0.5, ge=0.0, le=1.0)
    suspicious_activity_burst: float = Field(default=0.6, ge=0.0, le=1.0)
    bulk_paste_detected: float = Field(default=0.5, ge=0.0, le=1.0)
    impossible_answer_speed: float = Field(default=0.4, ge=0.0, le=1.0)
    face_inconsistency: float = Field(default=0.5, ge=0.0, le=1.0)
    periodic_check: float = Field(default=0.05, ge=0.0, le=1.0)


class RiskScoreRead(BaseModel):
    """Full risk score response."""
    id: uuid.UUID
    attempt_id: uuid.UUID
    tenant_id: uuid.UUID
    overall_score: float
    risk_level: str
    breakdown: dict | None
    event_counts: dict | None
    total_events: int
    computed_at: datetime

    model_config = {"from_attributes": True}


class RiskSummaryRead(BaseModel):
    """Lightweight risk summary for lists."""
    attempt_id: uuid.UUID
    overall_score: float
    risk_level: str
    total_events: int
    computed_at: datetime

    model_config = {"from_attributes": True}
