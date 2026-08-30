"""
Exam-wide candidate evaluation schemas (Phase B).

Response DTOs for the recruiter/admin endpoint that returns a compact,
per-candidate evaluation for every attempt in a single exam. Read-only;
no new tables. All values are derived from existing persisted ground truth
(attempts, answers JSON, questions, persisted RiskScore rows, proctoring
events) — see app/services/exam_evaluation_service.py.

The recommendation implements the authoritative "Deterministic Candidate
Recommendation Engine Specification" (nemetronsummary.md): a strict 7-rule
precedence cascade producing one of six recommendation codes. Score
benchmarks (50/60/75) and the severe-integrity definition come from that
specification — not from any per-exam field (the Exam model has no pass mark).
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RecommendationOut(BaseModel):
    """Deterministic, explainable system recommendation for one attempt."""
    code: str = Field(
        description=(
            "MANUAL_REVIEW | NOT_RECOMMENDED_ACADEMIC | NOT_RECOMMENDED_BOTH | "
            "INTEGRITY_REVIEW | SHORTLIST | STRONG_SHORTLIST"
        ),
    )
    label: str = Field(description="Human-readable recommendation label")
    reason: str = Field(
        description="Single factual sentence citing the score and integrity facts that produced the code",
    )


class CandidateEvaluation(BaseModel):
    """Compact evaluation for a single attempt in the exam."""
    # Identity
    attempt_id: uuid.UUID
    candidate_id: uuid.UUID
    candidate_name: str | None          # None if the user row is missing/inactive
    candidate_email: str | None

    # Attempt status & timing
    status: str                         # started | submitted | evaluated
    started_at: datetime | None
    submitted_at: datetime | None
    duration_minutes: float | None      # None until submitted

    # Score breakdown (None when the attempt has no graded answers yet)
    total_score: int | None
    max_score: int
    percentage: float | None            # total_score / max_score * 100
    objective_score: int | None         # mcq + multi_select + true_false
    objective_max_score: int
    coding_score: int | None            # code questions
    coding_max_score: int

    # Persisted risk (never recomputed here)
    risk_score: float | None            # RiskScore.overall_score, 0.0–1.0
    risk_level: str | None              # low | medium | high | critical
    risk_available: bool                # whether a persisted RiskScore exists

    # Violation severity counts (canonical catalog; excludes benign periodic_check)
    total_violations: int
    high_violations: int
    critical_violations: int

    # Severe-integrity gate used by the recommendation engine (spec §1):
    # persisted risk level high/critical OR >= 1 critical-severity event
    # (phone_detected / multiple_faces / suspicious_activity_burst).
    severe_integrity: bool

    # System recommendation (deterministic 7-rule engine)
    recommendation: RecommendationOut

    # ── Phase D: human recruiter decision (separate from the recommendation;
    # never overwrites it). NULL decision = never reviewed (UI renders
    # PENDING). Values: PENDING | SHORTLISTED | REVIEW | REJECTED.
    recruiter_decision: str | None = None
    recruiter_notes: str | None = None
    reviewed_by: uuid.UUID | None = None
    reviewed_at: datetime | None = None


class ExamEvaluationResponse(BaseModel):
    """Exam-wide evaluation envelope with one entry per attempt."""
    exam_id: uuid.UUID
    exam_title: str
    total_attempts: int
    max_score: int                      # sum of all question points
    objective_max_score: int
    coding_max_score: int

    # Authoritative score benchmarks used by the recommendation engine
    # (nemetronsummary.md §1). These are engine constants, NOT a per-exam
    # pass mark — the Exam schema has no passing-score field.
    passing_score_pct: float            # minimum passing cutoff (50.0)
    borderline_max_pct: float           # upper bound of the borderline band (60.0)
    excellence_score_pct: float         # merit / distinction benchmark (75.0)

    candidates: list[CandidateEvaluation]
