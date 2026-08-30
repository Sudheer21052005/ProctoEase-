"""
Exam-wide candidate evaluation service (Phase B).

Read-only aggregation returning a compact, per-candidate evaluation for every
active attempt in a single exam: identity, status/timing, score breakdown
(objective + coding), the persisted risk score/level, violation severity
counts, and a deterministic, explainable system recommendation.

Recommendation engine
----------------------
The recommendation implements the authoritative "Deterministic Candidate
Recommendation Engine Specification" (nemetronsummary.md § "Deterministic
Candidate Recommendation Engine Specification", PROMPT B): a strict, mutually
exclusive 7-rule precedence cascade producing exactly one of six codes —
MANUAL_REVIEW, NOT_RECOMMENDED_ACADEMIC, NOT_RECOMMENDED_BOTH, INTEGRITY_REVIEW,
SHORTLIST, STRONG_SHORTLIST. There is intentionally NO auto-"reject": a severe
integrity concern on a passing attempt yields INTEGRITY_REVIEW (human decides),
never an automated rejection.

Authoritative constants / definitions (all from the spec, NOT invented and NOT
from any per-exam field — the Exam model has no pass mark):
- PASSING_SCORE_PCT = 50.0, BORDERLINE_MAX_PCT = 60.0, EXCELLENCE_SCORE_PCT = 75.0
- Severe integrity  = risk level in {high, critical} OR >= 1 critical-severity
  event (phone_detected / multiple_faces / suspicious_activity_burst).
- High-severity event = ProctoringEvent.severity >= 3 OR event_type in
  {no_face, copy_paste, browser_devtools, unauthorized_object}.

Design / reuse notes
--------------------
- Risk is READ from persisted RiskScore rows via
  ``risk_engine.get_exam_risk_scores`` (one query for the whole exam). Risk is
  never (re)computed here — no writes, no duplication of the risk formulas or
  thresholds. The spec's own engine treats a missing RiskScore as "low"
  (``risk_score.risk_level if risk_score else "low"``), so no compute is needed.
  Attempts without a persisted score report ``risk_*`` as None in the payload
  while ``risk_available`` is False.
- Scores use the same ground truth as ``answer_service``: the
  ``ExamAttempt.answers`` JSON (``points_earned`` per question) scored against
  ``Question.points``. Questions are fetched once and shared across attempts.
- Violation severity COUNTS in the payload use the canonical catalog
  ``VIOLATION_GUIDELINES`` (low/medium/high/critical) and exclude the benign
  ``periodic_check`` (the only NON_GATING type). These are evidence; the
  recommendation's integrity gate uses the spec definition above.
- Every query is batched across attempts: the number of DB round trips is
  constant regardless of how many candidates attempted the exam (no N+1).
"""

from __future__ import annotations

import uuid
from collections import defaultdict

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.violation_guidelines import (
    VIOLATION_GUIDELINES,
    NON_GATING_VIOLATIONS,
)
from app.models.attempt import ExamAttempt
from app.models.proctoring_event import ProctoringEvent
from app.models.question import Question
from app.models.user import User
from app.services import risk_engine
from app.services.exam_service import get_exam

# Objective (auto-graded, non-code) question types.
OBJECTIVE_TYPES: tuple[str, ...] = ("mcq", "multi_select", "true_false")
CODE_TYPE: str = "code"

# Attempt statuses that represent a finished attempt.
FINISHED_STATUSES: tuple[str, ...] = ("submitted", "evaluated")

# ── Recommendation engine constants (authoritative — nemetronsummary.md §1) ──
PASSING_SCORE_PCT: float = 50.0        # minimum passing cutoff
BORDERLINE_MAX_PCT: float = 60.0       # upper bound of the borderline band [50, 60)
EXCELLENCE_SCORE_PCT: float = 75.0     # merit / distinction benchmark

# Critical-severity event types (drive the severe-integrity gate).
CRITICAL_EVENT_TYPES: frozenset[str] = frozenset(
    {"phone_detected", "multiple_faces", "suspicious_activity_burst"}
)
# High-severity event types (used only to exclude STRONG_SHORTLIST).
HIGH_EVENT_TYPES: frozenset[str] = frozenset(
    {"no_face", "copy_paste", "browser_devtools", "unauthorized_object"}
)
HIGH_SEVERITY_THRESHOLD: int = 3       # ProctoringEvent.severity: 1=low, 2=medium, 3=high

# The six deterministic recommendation codes produced by the cascade.
RECOMMENDATION_CODES: tuple[str, ...] = (
    "MANUAL_REVIEW",
    "NOT_RECOMMENDED_ACADEMIC",
    "NOT_RECOMMENDED_BOTH",
    "INTEGRITY_REVIEW",
    "SHORTLIST",
    "STRONG_SHORTLIST",
)


def _severity_of(event_type: str) -> str:
    """Canonical severity label (low/medium/high/critical) for an event type."""
    guideline = VIOLATION_GUIDELINES.get(event_type)
    return guideline["severity"] if guideline else "low"


def build_recommendation(
    *,
    status: str,
    submitted_at,
    score_pct: float,
    risk_level: str,
    risk_val: float,
    has_high_event: bool,
    has_critical_event: bool,
) -> dict:
    """
    Deterministic candidate recommendation (authoritative 7-rule cascade).

    Faithful implementation of ``evaluate_candidate_attempt`` from
    nemetronsummary.md §2: a strict, mutually exclusive ``if/elif/else`` order
    where the first matching rule wins. Pure function of persisted ground-truth
    inputs — identical inputs always yield identical output. Integrity is
    weighed before performance; a severe integrity concern on a passing attempt
    yields INTEGRITY_REVIEW (never an automated reject).

    Inputs (all from authoritative persisted sources):
    - ``status`` / ``submitted_at``: ExamAttempt fields.
    - ``score_pct``: total graded points / max points * 100 (0.0 if max is 0).
    - ``risk_level`` / ``risk_val``: persisted RiskScore (missing → "low"/0.0).
    - ``has_high_event`` / ``has_critical_event``: derived from active events.

    Returns ``{"code", "label", "reason", "severe_integrity"}``.
    """
    risk_level = (risk_level or "low").lower()
    is_severe_integrity = (risk_level in ("high", "critical")) or has_critical_event

    # RULE 1 — Unsubmitted / incomplete attempt.
    if status not in FINISHED_STATUSES or submitted_at is None:
        result = {
            "code": "MANUAL_REVIEW",
            "label": "Manual Review",
            "reason": (
                f"Attempt status is '{status}' (incomplete or unsubmitted). "
                "Manual review required."
            ),
        }

    # RULE 2 — Below passing cutoff AND severe integrity concern.
    elif score_pct < PASSING_SCORE_PCT and is_severe_integrity:
        result = {
            "code": "NOT_RECOMMENDED_BOTH",
            "label": "Not Recommended (Academic & Integrity)",
            "reason": (
                f"Score {score_pct:.1f}% is below passing cutoff ({PASSING_SCORE_PCT:.0f}%) "
                f"with concurrent severe integrity flags (Risk: {risk_level.upper()}, score {risk_val:.4f})."
            ),
        }

    # RULE 3 — Below passing cutoff, acceptable integrity.
    elif score_pct < PASSING_SCORE_PCT and not is_severe_integrity:
        result = {
            "code": "NOT_RECOMMENDED_ACADEMIC",
            "label": "Not Recommended (Academic)",
            "reason": (
                f"Score {score_pct:.1f}% did not reach passing cutoff ({PASSING_SCORE_PCT:.0f}%). "
                "Proctoring profile was acceptable."
            ),
        }

    # RULE 4 — Passing score BUT severe integrity concern → human review.
    elif score_pct >= PASSING_SCORE_PCT and is_severe_integrity:
        result = {
            "code": "INTEGRITY_REVIEW",
            "label": "Integrity Review",
            "reason": (
                f"Candidate achieved passing score ({score_pct:.1f}%), but attempt triggered severe integrity "
                f"violations (Risk: {risk_level.upper()}, score {risk_val:.4f}). Review Integrity PDF before shortlisting."
            ),
        }

    # RULE 5 — Excellent score, clean low-risk profile.
    elif (
        score_pct >= EXCELLENCE_SCORE_PCT
        and risk_level == "low"
        and not has_high_event
        and not has_critical_event
    ):
        result = {
            "code": "STRONG_SHORTLIST",
            "label": "Strong Shortlist",
            "reason": (
                f"Exemplary score of {score_pct:.1f}% (>= {EXCELLENCE_SCORE_PCT:.0f}%) with clean, "
                "low-risk proctoring profile."
            ),
        }

    # RULE 6 — Borderline passing score [50, 60).
    elif PASSING_SCORE_PCT <= score_pct < BORDERLINE_MAX_PCT:
        result = {
            "code": "MANUAL_REVIEW",
            "label": "Manual Review",
            "reason": (
                f"Borderline score ({score_pct:.1f}% in band [{PASSING_SCORE_PCT:.0f}%-{BORDERLINE_MAX_PCT:.0f}%)). "
                "Manual review recommended to assess fit."
            ),
        }

    # RULE 7 — Solid passing performance, acceptable profile.
    else:
        result = {
            "code": "SHORTLIST",
            "label": "Shortlist",
            "reason": f"Solid score of {score_pct:.1f}% with an acceptable proctoring profile.",
        }

    result["severe_integrity"] = is_severe_integrity
    return result


async def get_exam_evaluation(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """
    Build the exam-wide candidate evaluation for one exam.

    Tenant-scoped: raises ``ExamNotFound`` when the exam does not exist for this
    tenant. Uses a constant number of batched queries regardless of the attempt
    count (no N+1). Returns a dict matching ``ExamEvaluationResponse``.
    """
    # 1. Exam (tenant-scoped; raises ExamNotFound). ── query 1
    exam = await get_exam(db, exam_id, tenant_id)

    # 2. All active attempts for the exam. ── query 2
    attempts_result = await db.execute(
        select(ExamAttempt)
        .where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
        .order_by(ExamAttempt.started_at.desc())
    )
    attempts = list(attempts_result.scalars().all())

    # 3. Exam questions, fetched once and shared across all attempts. ── query 3
    questions_result = await db.execute(
        select(Question).where(
            Question.exam_id == exam_id,
            Question.tenant_id == tenant_id,
            Question.is_active == True,  # noqa: E712
        )
    )
    questions = list(questions_result.scalars().all())
    questions_by_id = {str(q.id): q for q in questions}

    objective_max = sum(q.points for q in questions if q.question_type in OBJECTIVE_TYPES)
    coding_max = sum(q.points for q in questions if q.question_type == CODE_TYPE)
    max_score = objective_max + coding_max

    def _envelope(candidates: list[dict]) -> dict:
        return {
            "exam_id": exam.id,
            "exam_title": exam.title,
            "total_attempts": len(candidates),
            "max_score": max_score,
            "objective_max_score": objective_max,
            "coding_max_score": coding_max,
            "passing_score_pct": PASSING_SCORE_PCT,
            "borderline_max_pct": BORDERLINE_MAX_PCT,
            "excellence_score_pct": EXCELLENCE_SCORE_PCT,
            "candidates": candidates,
        }

    # Empty exam (no attempts): return the envelope with an empty candidate list.
    if not attempts:
        return _envelope([])

    attempt_ids = [a.id for a in attempts]
    candidate_ids = [a.candidate_id for a in attempts]

    # 4. Candidate identities in one query. ── query 4
    users_result = await db.execute(
        select(User.id, User.full_name, User.email).where(
            User.id.in_(candidate_ids),
            User.tenant_id == tenant_id,
        )
    )
    users_by_id = {row[0]: (row[1], row[2]) for row in users_result.all()}

    # 5. Persisted risk scores for the whole exam in one query (reused helper). ── query 5
    #    Read-only: never recomputed here (no writes to RiskScore / risk_engine).
    risk_scores = await risk_engine.get_exam_risk_scores(db, exam_id, tenant_id)
    risk_by_attempt = {r.attempt_id: r for r in risk_scores}

    # 6. Violations grouped by (attempt, event_type) with count + max severity in one query. ── query 6
    events_result = await db.execute(
        select(
            ProctoringEvent.attempt_id,
            ProctoringEvent.event_type,
            func.count().label("count"),
            func.max(ProctoringEvent.severity).label("max_severity"),
        )
        .where(
            ProctoringEvent.attempt_id.in_(attempt_ids),
            ProctoringEvent.tenant_id == tenant_id,
            ProctoringEvent.is_active == True,  # noqa: E712
        )
        .group_by(ProctoringEvent.attempt_id, ProctoringEvent.event_type)
    )
    # attempt_id -> list of (event_type, count, max_severity)
    events_by_attempt: dict[uuid.UUID, list[tuple[str, int, int]]] = defaultdict(list)
    for attempt_id_val, event_type, count, max_severity in events_result.all():
        events_by_attempt[attempt_id_val].append(
            (event_type, count, max_severity if max_severity is not None else 1)
        )

    candidates: list[dict] = []
    for att in attempts:
        # ── Score breakdown from the answers JSON (same source as answer_service) ──
        raw_answers = att.answers or {}
        objective_score = 0
        coding_score = 0
        any_graded = False
        for qid, ans in raw_answers.items():
            question = questions_by_id.get(qid)
            if question is None or not isinstance(ans, dict):
                continue
            pts = ans.get("points_earned")
            if pts is None:
                continue
            any_graded = True
            if question.question_type in OBJECTIVE_TYPES:
                objective_score += pts
            elif question.question_type == CODE_TYPE:
                coding_score += pts

        total_score = objective_score + coding_score if any_graded else None
        percentage = (
            round(total_score / max_score * 100, 2)
            if (total_score is not None and max_score > 0)
            else None
        )
        # Score percentage fed to the deterministic engine (spec: 0.0 when max is 0;
        # ungraded points contribute 0). Always numeric so the cascade is total.
        eval_score_pct = (
            (objective_score + coding_score) / max_score * 100.0 if max_score > 0 else 0.0
        )

        # ── Duration ──
        duration_minutes = None
        if att.submitted_at and att.started_at:
            duration_minutes = round(
                (att.submitted_at - att.started_at).total_seconds() / 60.0, 2
            )

        # ── Persisted risk (never recomputed; missing → treated as low/0.0 by the engine) ──
        risk = risk_by_attempt.get(att.id)
        risk_score_val = risk.overall_score if risk else None
        risk_level_val = risk.risk_level if risk else None
        eval_risk_level = (risk_level_val or "low").lower()
        eval_risk_val = risk.overall_score if risk else 0.0

        # ── Violation evidence counts (canonical catalog; excl. non-gating) + integrity flags ──
        total_violations = 0
        high_violations = 0
        critical_violations = 0
        has_high_event = False
        has_critical_event = False
        for event_type, count, max_sev in events_by_attempt.get(att.id, []):
            # Integrity flags per the spec (scan all active events, incl. non-gating).
            if event_type in CRITICAL_EVENT_TYPES:
                has_critical_event = True
            if max_sev >= HIGH_SEVERITY_THRESHOLD or event_type in HIGH_EVENT_TYPES:
                has_high_event = True

            # Evidence counts exclude benign monitoring snapshots.
            if event_type in NON_GATING_VIOLATIONS:
                continue
            total_violations += count
            severity = _severity_of(event_type)
            if severity == "high":
                high_violations += count
            elif severity == "critical":
                critical_violations += count

        rec = build_recommendation(
            status=att.status,
            submitted_at=att.submitted_at,
            score_pct=eval_score_pct,
            risk_level=eval_risk_level,
            risk_val=eval_risk_val,
            has_high_event=has_high_event,
            has_critical_event=has_critical_event,
        )

        name, email = users_by_id.get(att.candidate_id, (None, None))
        candidates.append(
            {
                "attempt_id": att.id,
                "candidate_id": att.candidate_id,
                "candidate_name": name,
                "candidate_email": email,
                "status": att.status,
                "started_at": att.started_at,
                "submitted_at": att.submitted_at,
                "duration_minutes": duration_minutes,
                "total_score": total_score,
                "max_score": max_score,
                "percentage": percentage,
                "objective_score": objective_score if any_graded else None,
                "objective_max_score": objective_max,
                "coding_score": coding_score if any_graded else None,
                "coding_max_score": coding_max,
                "risk_score": risk_score_val,
                "risk_level": risk_level_val,
                "risk_available": risk is not None,
                "total_violations": total_violations,
                "high_violations": high_violations,
                "critical_violations": critical_violations,
                "severe_integrity": rec["severe_integrity"],
                "recommendation": {
                    "code": rec["code"],
                    "label": rec["label"],
                    "reason": rec["reason"],
                },
            }
        )

    return _envelope(candidates)
