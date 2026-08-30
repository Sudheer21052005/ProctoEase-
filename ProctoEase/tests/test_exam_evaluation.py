"""
Tests for Phase B — Exam-Wide Candidate Evaluation.

The recommendation is the authoritative "Deterministic Candidate Recommendation
Engine Specification" (nemetronsummary.md § "Deterministic Candidate
Recommendation Engine Specification"): a strict, mutually exclusive 7-rule
precedence cascade producing one of six codes — MANUAL_REVIEW,
NOT_RECOMMENDED_ACADEMIC, NOT_RECOMMENDED_BOTH, INTEGRITY_REVIEW, SHORTLIST,
STRONG_SHORTLIST. There is intentionally NO auto-"reject": a severe integrity
concern on a passing attempt yields INTEGRITY_REVIEW (a human decides).

Covers:
- build_recommendation: all 7 rules + boundaries, integrity-before-performance
  (critical event / high risk on a passing attempt -> INTEGRITY_REVIEW, never
  reject), the STRONG_SHORTLIST exclusions, and determinism.
- get_exam_evaluation: success, multiple candidates, incomplete attempts,
  missing risk data, violation severity counts (incl. non-gating exclusion) and
  the derived integrity flags, empty exams, tenant isolation, edge cases, and a
  batched-query (no N+1) guard.
- endpoint authorization (candidate -> 403), tenant isolation (-> 404), and
  success serialization.

All data is synthetic / in-memory; the DB session is mocked.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user, get_db
from app.core.exceptions import ExamNotFound
from app.main import app
from app.models.attempt import ExamAttempt
from app.models.exam import Exam
from app.models.question import Question, QuestionType
from app.models.risk_score import RiskScore
from app.models.user import User, UserRole
from app.services.exam_evaluation_service import (
    BORDERLINE_MAX_PCT,
    EXCELLENCE_SCORE_PCT,
    PASSING_SCORE_PCT,
    build_recommendation,
    get_exam_evaluation,
)

RISK_PATCH_TARGET = "app.services.risk_engine.get_exam_risk_scores"

SUBMITTED_AT = datetime(2026, 8, 20, 10, 30, 0, tzinfo=timezone.utc)


# ── Result mock helper ──────────────────────────────────────────────


def make_result(*, scalar_one=..., scalars_all=None, rows=None):
    """
    Build a mock SQLAlchemy Result supporting the three access shapes used by
    the service: ``.scalar_one_or_none()``, ``.scalars().all()``, and ``.all()``.
    """
    m = MagicMock()
    if scalar_one is not ...:
        m.scalar_one_or_none = MagicMock(return_value=scalar_one)
    m.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=scalars_all or [])))
    m.all = MagicMock(return_value=rows or [])
    return m


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture
def tenant_id():
    return uuid4()


@pytest.fixture
def recruiter(tenant_id):
    return User(
        id=uuid4(),
        email="recruiter@techcorp.com",
        full_name="Recruiter One",
        role=UserRole.RECRUITER,
        tenant_id=tenant_id,
        is_active=True,
    )


@pytest.fixture
def exam(tenant_id):
    return Exam(
        id=uuid4(),
        title="Backend Assessment",
        tenant_id=tenant_id,
        is_active=True,
        is_published=True,
    )


@pytest.fixture
def questions(exam, tenant_id):
    """One 2-point MCQ (objective) + one 8-point code question. max = 10."""
    q_mcq = Question(
        id=uuid4(),
        exam_id=exam.id,
        question_text="What is 2+2?",
        question_type=QuestionType.MCQ.value,
        correct_answer="A",
        points=2,
        order_index=0,
        tenant_id=tenant_id,
        is_active=True,
    )
    q_code = Question(
        id=uuid4(),
        exam_id=exam.id,
        question_text="Reverse a string",
        question_type=QuestionType.CODE.value,
        correct_answer={"test_cases": [{"input": "ab", "expected": "ba"}]},
        points=8,
        order_index=1,
        tenant_id=tenant_id,
        is_active=True,
    )
    return [q_mcq, q_code]


def _attempt(exam, tenant_id, candidate_id, *, status="submitted", answers=None,
             started_offset_min=0, submitted=True):
    started = datetime(2026, 8, 20, 10, 0, 0, tzinfo=timezone.utc) + timedelta(
        minutes=started_offset_min
    )
    submitted_at = started + timedelta(minutes=30) if submitted else None
    return ExamAttempt(
        id=uuid4(),
        exam_id=exam.id,
        candidate_id=candidate_id,
        tenant_id=tenant_id,
        status=status,
        is_active=True,
        started_at=started,
        submitted_at=submitted_at,
        answers=answers or {},
    )


def _graded_answers(questions, mcq_points, code_points):
    """answers JSON keyed by str(question_id) with points_earned set."""
    q_mcq, q_code = questions
    return {
        str(q_mcq.id): {"points_earned": mcq_points, "is_correct": mcq_points > 0},
        str(q_code.id): {"points_earned": code_points, "is_correct": code_points == q_code.points},
    }


# =====================================================================
# build_recommendation — deterministic 7-rule cascade unit tests
# =====================================================================


class TestBuildRecommendation:
    # A clean, submitted, solid pass (65%) -> SHORTLIST (rule 7). Override per test.
    BASE = dict(
        status="submitted",
        submitted_at=SUBMITTED_AT,
        score_pct=65.0,
        risk_level="low",
        risk_val=0.10,
        has_high_event=False,
        has_critical_event=False,
    )

    # ── RULE 1 — unsubmitted / incomplete ──
    def test_rule1_incomplete_status(self):
        rec = build_recommendation(**{**self.BASE, "status": "started", "submitted_at": None})
        assert rec["code"] == "MANUAL_REVIEW"
        assert rec["label"] == "Manual Review"
        assert "unsubmitted" in rec["reason"].lower()

    def test_rule1_submitted_status_but_missing_timestamp(self):
        # status looks finished but no submitted_at -> still incomplete.
        rec = build_recommendation(**{**self.BASE, "status": "submitted", "submitted_at": None})
        assert rec["code"] == "MANUAL_REVIEW"

    def test_rule1_precedes_score_and_integrity(self):
        # Even a perfect score with critical event: unsubmitted wins first.
        rec = build_recommendation(
            **{**self.BASE, "status": "started", "submitted_at": None,
               "score_pct": 100.0, "has_critical_event": True}
        )
        assert rec["code"] == "MANUAL_REVIEW"

    # ── RULE 2 — failing + severe integrity ──
    def test_rule2_failing_with_critical_event(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 30.0, "has_critical_event": True})
        assert rec["code"] == "NOT_RECOMMENDED_BOTH"
        assert rec["severe_integrity"] is True
        assert "50%" in rec["reason"]

    def test_rule2_failing_with_high_risk(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 30.0, "risk_level": "high",
                                      "risk_val": 0.80})
        assert rec["code"] == "NOT_RECOMMENDED_BOTH"
        assert rec["severe_integrity"] is True

    def test_rule2_failing_with_critical_risk(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 10.0, "risk_level": "critical",
                                      "risk_val": 0.95})
        assert rec["code"] == "NOT_RECOMMENDED_BOTH"

    # ── RULE 3 — failing + acceptable integrity ──
    def test_rule3_failing_clean(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 40.0})
        assert rec["code"] == "NOT_RECOMMENDED_ACADEMIC"
        assert rec["severe_integrity"] is False
        assert "passing cutoff" in rec["reason"].lower()

    def test_rule3_failing_with_medium_risk_still_academic(self):
        # medium risk is NOT severe -> academic-only rejection.
        rec = build_recommendation(**{**self.BASE, "score_pct": 40.0, "risk_level": "medium",
                                      "risk_val": 0.40, "has_high_event": True})
        assert rec["code"] == "NOT_RECOMMENDED_ACADEMIC"
        assert rec["severe_integrity"] is False

    # ── RULE 4 — passing + severe integrity -> INTEGRITY_REVIEW (never reject) ──
    def test_rule4_passing_with_critical_event_is_integrity_review(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 80.0, "has_critical_event": True})
        assert rec["code"] == "INTEGRITY_REVIEW"
        assert rec["label"] == "Integrity Review"
        assert rec["severe_integrity"] is True
        assert "review integrity pdf" in rec["reason"].lower()

    def test_rule4_passing_with_high_risk_is_integrity_review(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 80.0, "risk_level": "high",
                                      "risk_val": 0.78})
        assert rec["code"] == "INTEGRITY_REVIEW"

    def test_rule4_perfect_score_with_critical_event_still_integrity_review(self):
        # Integrity is weighed before excellence: 100% + critical event != STRONG_SHORTLIST.
        rec = build_recommendation(**{**self.BASE, "score_pct": 100.0, "has_critical_event": True})
        assert rec["code"] == "INTEGRITY_REVIEW"

    # ── RULE 5 — excellent score, clean low-risk -> STRONG_SHORTLIST ──
    def test_rule5_strong_shortlist(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 85.0})
        assert rec["code"] == "STRONG_SHORTLIST"
        assert rec["label"] == "Strong Shortlist"
        assert "exemplary" in rec["reason"].lower()

    def test_rule5_at_excellence_boundary(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 75.0})
        assert rec["code"] == "STRONG_SHORTLIST"

    def test_rule5_excluded_by_high_event(self):
        # 85% clean low-risk BUT a high-severity event -> downgraded to SHORTLIST,
        # not escalated to integrity review (a high event alone is not "severe").
        rec = build_recommendation(**{**self.BASE, "score_pct": 85.0, "has_high_event": True})
        assert rec["code"] == "SHORTLIST"
        assert rec["severe_integrity"] is False

    def test_rule5_excluded_by_medium_risk(self):
        # 85% with medium risk: not severe, but risk != low -> SHORTLIST, not STRONG.
        rec = build_recommendation(**{**self.BASE, "score_pct": 85.0, "risk_level": "medium",
                                      "risk_val": 0.40})
        assert rec["code"] == "SHORTLIST"

    # ── RULE 6 — borderline passing band [50, 60) ──
    def test_rule6_borderline_midband(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 55.0})
        assert rec["code"] == "MANUAL_REVIEW"
        assert "borderline" in rec["reason"].lower()

    def test_rule6_borderline_lower_bound_50(self):
        # 50.0% is passing (>= cutoff) but borderline.
        rec = build_recommendation(**{**self.BASE, "score_pct": 50.0})
        assert rec["code"] == "MANUAL_REVIEW"

    # ── RULE 7 — solid pass, acceptable profile ──
    def test_rule7_solid_shortlist(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 65.0})
        assert rec["code"] == "SHORTLIST"
        assert rec["label"] == "Shortlist"
        assert "solid" in rec["reason"].lower()

    def test_rule7_at_60_boundary(self):
        # 60.0% leaves the borderline band -> SHORTLIST.
        rec = build_recommendation(**{**self.BASE, "score_pct": 60.0})
        assert rec["code"] == "SHORTLIST"

    def test_rule7_just_below_excellence(self):
        rec = build_recommendation(**{**self.BASE, "score_pct": 74.0})
        assert rec["code"] == "SHORTLIST"

    # ── severe_integrity flag & determinism ──
    def test_severe_integrity_flag_true_on_critical_event(self):
        rec = build_recommendation(**{**self.BASE, "has_critical_event": True})
        assert rec["severe_integrity"] is True

    def test_severe_integrity_flag_false_when_clean(self):
        rec = build_recommendation(**self.BASE)
        assert rec["severe_integrity"] is False

    def test_deterministic_repeatable(self):
        args = {**self.BASE, "score_pct": 80.0, "risk_level": "high", "risk_val": 0.77}
        assert build_recommendation(**args) == build_recommendation(**args)


# =====================================================================
# get_exam_evaluation — service tests
# =====================================================================


@pytest.mark.asyncio
class TestGetExamEvaluation:
    async def _run(self, mock_db, exam_id, tenant_id, risk_scores):
        with patch(RISK_PATCH_TARGET, new=AsyncMock(return_value=risk_scores)):
            return await get_exam_evaluation(mock_db, exam_id, tenant_id)

    async def test_success_single_candidate(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id,
                       answers=_graded_answers(questions, 2, 6))   # 8/10 = 80%
        risk = RiskScore(
            attempt_id=att.id, tenant_id=tenant_id,
            overall_score=0.12, risk_level="low",
            breakdown={}, event_counts={}, total_events=0,
        )
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),          # get_exam
            make_result(scalars_all=[att]),        # attempts
            make_result(scalars_all=questions),    # questions
            make_result(rows=[(cand_id, "Alice Cand", "alice@x.demo")]),  # users
            make_result(rows=[]),                  # events (none)
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [risk])

        assert out["exam_id"] == exam.id
        assert out["exam_title"] == "Backend Assessment"
        assert out["total_attempts"] == 1
        assert out["max_score"] == 10
        assert out["objective_max_score"] == 2
        assert out["coding_max_score"] == 8
        # Authoritative benchmark constants (not a per-exam pass mark).
        assert out["passing_score_pct"] == PASSING_SCORE_PCT == 50.0
        assert out["borderline_max_pct"] == BORDERLINE_MAX_PCT == 60.0
        assert out["excellence_score_pct"] == EXCELLENCE_SCORE_PCT == 75.0

        c = out["candidates"][0]
        assert c["candidate_name"] == "Alice Cand"
        assert c["candidate_email"] == "alice@x.demo"
        assert c["status"] == "submitted"
        assert c["duration_minutes"] == 30.0
        assert c["objective_score"] == 2
        assert c["coding_score"] == 6
        assert c["total_score"] == 8
        assert c["percentage"] == 80.0
        assert c["risk_score"] == 0.12
        assert c["risk_level"] == "low"
        assert c["risk_available"] is True
        assert c["total_violations"] == 0
        assert c["high_violations"] == 0
        assert c["critical_violations"] == 0
        assert c["severe_integrity"] is False
        # 80% clean, low risk -> STRONG_SHORTLIST.
        assert c["recommendation"]["code"] == "STRONG_SHORTLIST"

    async def test_multiple_candidates_mapped_independently(self, exam, tenant_id, questions):
        c1, c2 = uuid4(), uuid4()
        a1 = _attempt(exam, tenant_id, c1, answers=_graded_answers(questions, 2, 8))   # 100%
        a2 = _attempt(exam, tenant_id, c2, answers=_graded_answers(questions, 0, 2),   # 20%
                      started_offset_min=5)
        r1 = RiskScore(attempt_id=a1.id, tenant_id=tenant_id, overall_score=0.1,
                       risk_level="low", breakdown={}, event_counts={}, total_events=0)
        # a2 has no risk score row.
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[a1, a2]),
            make_result(scalars_all=questions),
            make_result(rows=[(c1, "One", "one@x.demo"), (c2, "Two", "two@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [r1])
        by_attempt = {c["attempt_id"]: c for c in out["candidates"]}

        assert out["total_attempts"] == 2
        assert by_attempt[a1.id]["percentage"] == 100.0
        assert by_attempt[a1.id]["recommendation"]["code"] == "STRONG_SHORTLIST"
        assert by_attempt[a2.id]["percentage"] == 20.0
        assert by_attempt[a2.id]["risk_available"] is False
        # 20% clean (missing risk -> treated as low) -> academic-only rejection.
        assert by_attempt[a2.id]["recommendation"]["code"] == "NOT_RECOMMENDED_ACADEMIC"

    async def test_incomplete_attempt_has_none_scores(self, exam, tenant_id, questions):
        cand_id = uuid4()
        q_mcq, q_code = questions
        # In-progress: answers saved but ungraded (no points_earned).
        att = _attempt(
            exam, tenant_id, cand_id, status="started", submitted=False,
            answers={str(q_mcq.id): {"selected_option_ids": ["A"]}},
        )
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Prog Ress", "prog@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert c["status"] == "started"
        assert c["total_score"] is None
        assert c["objective_score"] is None
        assert c["coding_score"] is None
        assert c["percentage"] is None
        assert c["duration_minutes"] is None
        # Unsubmitted -> manual review (rule 1).
        assert c["recommendation"]["code"] == "MANUAL_REVIEW"

    async def test_missing_risk_data_defaults_low(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 8))  # 100%
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "No Risk", "norisk@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])  # no risk scores
        c = out["candidates"][0]
        assert c["risk_score"] is None
        assert c["risk_level"] is None
        assert c["risk_available"] is False
        assert c["severe_integrity"] is False
        # 100% clean, risk defaults to low -> STRONG_SHORTLIST.
        assert c["recommendation"]["code"] == "STRONG_SHORTLIST"

    async def test_critical_event_on_passing_attempt_is_integrity_review(self, exam, tenant_id, questions):
        """Centerpiece: a critical event + a passing score -> INTEGRITY_REVIEW (never reject).

        Also asserts violation severity counts and that non-gating events are excluded.
        Event rows are 4-tuples: (attempt_id, event_type, count, max_severity).
        """
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 8))  # 100%
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Viol Ator", "viol@x.demo")]),
            make_result(rows=[
                (att.id, "tab_switch", 1, 2),        # medium
                (att.id, "no_face", 2, 3),           # high (severity 3, high type)
                (att.id, "multiple_faces", 1, 3),    # critical event type
                (att.id, "periodic_check", 5, 1),    # non-gating -> excluded from counts
            ]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert c["total_violations"] == 4        # 1 + 2 + 1, periodic_check excluded
        assert c["high_violations"] == 2          # no_face x2 (canonical high)
        assert c["critical_violations"] == 1      # multiple_faces (canonical critical)
        assert c["severe_integrity"] is True      # critical event present
        # Passing score + severe integrity -> INTEGRITY_REVIEW, NOT reject.
        assert c["recommendation"]["code"] == "INTEGRITY_REVIEW"

    async def test_high_severity_event_downgrades_but_does_not_escalate(self, exam, tenant_id, questions):
        """A high (non-critical) event on a 100% low-risk attempt: SHORTLIST, not STRONG,
        and not INTEGRITY_REVIEW (a high event alone is not 'severe integrity')."""
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 8))  # 100%
        risk = RiskScore(attempt_id=att.id, tenant_id=tenant_id, overall_score=0.1,
                         risk_level="low", breakdown={}, event_counts={}, total_events=1)
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "High Event", "high@x.demo")]),
            make_result(rows=[(att.id, "no_face", 1, 3)]),   # high, non-critical
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [risk])
        c = out["candidates"][0]
        assert c["high_violations"] == 1
        assert c["critical_violations"] == 0
        assert c["severe_integrity"] is False
        assert c["recommendation"]["code"] == "SHORTLIST"

    async def test_high_risk_passing_is_integrity_review(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 8))  # 100%
        risk = RiskScore(attempt_id=att.id, tenant_id=tenant_id, overall_score=0.78,
                         risk_level="high", breakdown={}, event_counts={}, total_events=3)
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "High Risk", "hr@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [risk])
        c = out["candidates"][0]
        assert c["risk_level"] == "high"
        assert c["severe_integrity"] is True
        assert c["recommendation"]["code"] == "INTEGRITY_REVIEW"

    async def test_failing_with_high_risk_is_not_recommended_both(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 0, 2))  # 20%
        risk = RiskScore(attempt_id=att.id, tenant_id=tenant_id, overall_score=0.82,
                         risk_level="high", breakdown={}, event_counts={}, total_events=4)
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Low High", "lh@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [risk])
        c = out["candidates"][0]
        assert c["percentage"] == 20.0
        assert c["severe_integrity"] is True
        assert c["recommendation"]["code"] == "NOT_RECOMMENDED_BOTH"

    async def test_borderline_score_is_manual_review(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 3))  # 5/10 = 50%
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Border Line", "bl@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert c["percentage"] == 50.0
        assert c["severe_integrity"] is False
        # 50% is passing but in the borderline band [50, 60) -> MANUAL_REVIEW.
        assert c["recommendation"]["code"] == "MANUAL_REVIEW"

    async def test_empty_exam_returns_no_candidates(self, exam, tenant_id, questions):
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[]),          # no attempts
            make_result(scalars_all=questions),
        ])
        # get_exam_risk_scores must NOT be called for an empty exam.
        risk_mock = AsyncMock(return_value=[])
        with patch(RISK_PATCH_TARGET, new=risk_mock):
            out = await get_exam_evaluation(mock_db, exam.id, tenant_id)

        assert out["total_attempts"] == 0
        assert out["candidates"] == []
        assert out["max_score"] == 10
        # Benchmark constants present even on the empty path.
        assert out["passing_score_pct"] == 50.0
        assert out["borderline_max_pct"] == 60.0
        assert out["excellence_score_pct"] == 75.0
        assert mock_db.execute.await_count == 3   # exam + attempts + questions only
        risk_mock.assert_not_awaited()

    async def test_tenant_isolation_raises_exam_not_found(self, tenant_id):
        mock_db = AsyncMock()
        # get_exam finds nothing for this tenant.
        mock_db.execute = AsyncMock(return_value=make_result(scalar_one=None))
        with patch(RISK_PATCH_TARGET, new=AsyncMock(return_value=[])):
            with pytest.raises(ExamNotFound):
                await get_exam_evaluation(mock_db, uuid4(), tenant_id)

    async def test_no_questions_edge(self, exam, tenant_id):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id,
                       answers={str(uuid4()): {"points_earned": 5}})  # unknown qid
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=[]),          # no questions
            make_result(rows=[(cand_id, "Edge Case", "edge@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert out["max_score"] == 0
        assert c["total_score"] is None          # unknown qid skipped -> nothing graded
        assert c["percentage"] is None
        # max_score == 0 -> spec score_pct == 0.0; clean -> academic-only rejection.
        assert c["recommendation"]["code"] == "NOT_RECOMMENDED_ACADEMIC"

    async def test_unknown_question_id_in_answers_is_ignored(self, exam, tenant_id, questions):
        cand_id = uuid4()
        q_mcq, _ = questions
        answers = {
            str(q_mcq.id): {"points_earned": 2, "is_correct": True},
            str(uuid4()): {"points_earned": 99},   # not part of this exam
        }
        att = _attempt(exam, tenant_id, cand_id, answers=answers)
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Ign Ore", "ign@x.demo")]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert c["objective_score"] == 2         # only the real MCQ counts
        assert c["coding_score"] == 0
        assert c["total_score"] == 2             # 99 ignored

    async def test_missing_user_row_yields_null_identity(self, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 8))
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[]),                 # user row missing
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        c = out["candidates"][0]
        assert c["candidate_id"] == cand_id
        assert c["candidate_name"] is None
        assert c["candidate_email"] is None

    async def test_query_count_constant_regardless_of_attempts(self, exam, tenant_id, questions):
        """No N+1: three attempts still use exactly 5 db.execute calls."""
        cands = [uuid4(), uuid4(), uuid4()]
        atts = [
            _attempt(exam, tenant_id, cands[i],
                     answers=_graded_answers(questions, 2, 8), started_offset_min=i)
            for i in range(3)
        ]
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=atts),
            make_result(scalars_all=questions),
            make_result(rows=[(cands[i], f"C{i}", f"c{i}@x.demo") for i in range(3)]),
            make_result(rows=[]),
        ])

        out = await self._run(mock_db, exam.id, tenant_id, [])
        assert out["total_attempts"] == 3
        assert mock_db.execute.await_count == 5   # constant, independent of N


# =====================================================================
# Endpoint tests — auth, tenant isolation, success serialization
# =====================================================================


class TestEvaluationEndpoint:
    def test_forbidden_for_candidate(self, tenant_id):
        candidate = User(
            id=uuid4(), email="cand@x.demo", full_name="Cand",
            role=UserRole.CANDIDATE, tenant_id=tenant_id, is_active=True,
        )
        app.dependency_overrides[get_current_user] = lambda: candidate
        client = TestClient(app)
        try:
            resp = client.get(f"/api/v1/exams/{uuid4()}/evaluation")
            assert resp.status_code == 403
            assert resp.json().get("error_code") == "FORBIDDEN"
        finally:
            app.dependency_overrides.clear()

    def test_tenant_isolation_404(self, recruiter):
        mock_db = AsyncMock()
        # get_exam finds nothing -> ExamNotFound -> 404.
        mock_db.execute = AsyncMock(return_value=make_result(scalar_one=None))
        app.dependency_overrides[get_current_user] = lambda: recruiter
        app.dependency_overrides[get_db] = lambda: mock_db
        client = TestClient(app)
        try:
            resp = client.get(f"/api/v1/exams/{uuid4()}/evaluation")
            assert resp.status_code == 404
            assert resp.json().get("error_code") == "EXAM_NOT_FOUND"
        finally:
            app.dependency_overrides.clear()

    def test_success_serializes_full_payload(self, recruiter, exam, tenant_id, questions):
        cand_id = uuid4()
        att = _attempt(exam, tenant_id, cand_id, answers=_graded_answers(questions, 2, 6))  # 80%
        risk = RiskScore(
            attempt_id=att.id, tenant_id=tenant_id, overall_score=0.3,
            risk_level="medium", breakdown={}, event_counts={}, total_events=1,
        )
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[att]),
            make_result(scalars_all=questions),
            make_result(rows=[(cand_id, "Alice Cand", "alice@x.demo")]),
            make_result(rows=[(att.id, "tab_switch", 1, 2)]),   # medium, non-critical
        ])
        app.dependency_overrides[get_current_user] = lambda: recruiter
        app.dependency_overrides[get_db] = lambda: mock_db
        client = TestClient(app)
        try:
            with patch(RISK_PATCH_TARGET, new=AsyncMock(return_value=[risk])):
                resp = client.get(f"/api/v1/exams/{exam.id}/evaluation")
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["exam_title"] == "Backend Assessment"
            assert body["total_attempts"] == 1
            assert body["passing_score_pct"] == 50.0
            assert body["borderline_max_pct"] == 60.0
            assert body["excellence_score_pct"] == 75.0
            assert len(body["candidates"]) == 1
            c = body["candidates"][0]
            assert c["candidate_email"] == "alice@x.demo"
            assert c["percentage"] == 80.0
            assert c["risk_level"] == "medium"
            assert c["total_violations"] == 1
            assert c["severe_integrity"] is False
            # 80% with medium risk (not severe, not low) -> SHORTLIST.
            assert c["recommendation"]["code"] == "SHORTLIST"
            assert isinstance(c["recommendation"]["reason"], str)
            assert c["recommendation"]["label"] == "Shortlist"
        finally:
            app.dependency_overrides.clear()

    def test_success_empty_exam(self, recruiter, exam, tenant_id, questions):
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(side_effect=[
            make_result(scalar_one=exam),
            make_result(scalars_all=[]),
            make_result(scalars_all=questions),
        ])
        app.dependency_overrides[get_current_user] = lambda: recruiter
        app.dependency_overrides[get_db] = lambda: mock_db
        client = TestClient(app)
        try:
            with patch(RISK_PATCH_TARGET, new=AsyncMock(return_value=[])):
                resp = client.get(f"/api/v1/exams/{exam.id}/evaluation")
            assert resp.status_code == 200, resp.text
            body = resp.json()
            assert body["total_attempts"] == 0
            assert body["candidates"] == []
        finally:
            app.dependency_overrides.clear()
