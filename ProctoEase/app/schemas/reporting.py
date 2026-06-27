"""
Reporting & analytics schemas — response DTOs for dashboard and exports.
Phase 9: Reporting & Analytics.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    """Generic paginated response wrapper."""
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int


# ── Tenant Dashboard ────────────────────────────────────────────


class RiskDistribution(BaseModel):
    """Count of attempts in each risk tier."""
    low: int = 0
    medium: int = 0
    high: int = 0
    critical: int = 0


class TenantDashboard(BaseModel):
    """Top-level tenant statistics."""
    total_exams: int
    published_exams: int
    total_attempts: int
    completed_attempts: int          # status = submitted or evaluated
    unique_candidates: int
    average_risk_score: float | None  # None if no risk scores computed
    risk_distribution: RiskDistribution
    total_proctoring_events: int
    total_code_submissions: int
    total_plagiarism_reports: int


# ── Per-Exam Analytics ──────────────────────────────────────────


class StatusBreakdown(BaseModel):
    """Attempt status counts for an exam."""
    started: int = 0
    submitted: int = 0
    evaluated: int = 0


class ExamAnalytics(BaseModel):
    """Aggregated analytics for a single exam."""
    exam_id: uuid.UUID
    exam_title: str
    total_attempts: int
    completion_rate: float             # (submitted + evaluated) / total
    avg_duration_minutes: float | None  # avg(submitted_at - started_at)
    avg_risk_score: float | None
    max_risk_score: float | None
    status_breakdown: StatusBreakdown
    total_proctoring_events: int
    total_code_submissions: int
    flagged_plagiarism_pairs: int


# ── Question Stats ──────────────────────────────────────────────


class QuestionStats(BaseModel):
    """Per-question statistics within an exam."""
    question_id: uuid.UUID
    question_text: str
    question_type: str
    total_submissions: int           # code submissions for this question
    accepted_submissions: int        # status = accepted
    success_rate: float              # accepted / total (0 if no submissions)
    avg_execution_time_sec: float | None


# ── Candidate Performance ──────────────────────────────────────


class AttemptSummary(BaseModel):
    """Enriched attempt data for candidate performance view."""
    attempt_id: uuid.UUID
    exam_id: uuid.UUID
    exam_title: str
    status: str
    started_at: datetime
    submitted_at: datetime | None
    duration_minutes: float | None
    risk_score: float | None
    risk_level: str | None
    proctoring_event_count: int
    code_submission_count: int


class CandidatePerformance(BaseModel):
    """Candidate performance summary across all exams."""
    candidate_id: uuid.UUID
    candidate_name: str
    candidate_email: str
    total_attempts: int
    completed_attempts: int
    average_risk_score: float | None
    attempts: list[AttemptSummary]
    # Pagination metadata for the attempts list
    page: int = 1
    page_size: int = 20
    pages: int = 1


# ── Export Meta ──────────────────────────────────────────────────


class ExportMeta(BaseModel):
    """Metadata returned alongside CSV download."""
    filename: str
    row_count: int
    generated_at: datetime
