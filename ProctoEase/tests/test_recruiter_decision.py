"""
Tests for Phase D — human recruiter review & decision workflow.

Covers: decision creation/update for all four values, notes handling,
reviewer metadata, invalid decision (422), missing attempt, cross-tenant
access (404), endpoint authorization (candidate 403 / recruiter 200), and
the product rule that a recruiter decision never touches the system
recommendation. All database access is mocked (no live DB).
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.attempt import ExamAttempt, RecruiterDecision
from app.models.user import User, UserRole
from app.schemas.attempt import RecruiterDecisionUpdate
from app.schemas.exam_evaluation import CandidateEvaluation
from app.services import attempt_service


def make_user(role: UserRole = UserRole.RECRUITER) -> User:
    return User(
        id=uuid4(),
        email=f"{role.value}@techcorp.com",
        full_name=f"Test {role.value}",
        role=role,
        tenant_id=uuid4(),
        is_active=True,
    )


def make_attempt(tenant_id, **overrides) -> ExamAttempt:
    defaults = dict(
        id=uuid4(),
        exam_id=uuid4(),
        candidate_id=uuid4(),
        tenant_id=tenant_id,
        status="submitted",
        is_active=True,
        started_at=datetime(2026, 8, 29, 10, 0, 0, tzinfo=timezone.utc),
        submitted_at=datetime(2026, 8, 29, 11, 0, 0, tzinfo=timezone.utc),
        answers={},
    )
    defaults.update(overrides)
    return ExamAttempt(**defaults)


def make_mock_result(scalar_one=None):
    mock = MagicMock()
    mock.scalar_one_or_none = MagicMock(return_value=scalar_one)
    return mock


@pytest.fixture
def recruiter():
    return make_user(UserRole.RECRUITER)


@pytest.fixture
def admin():
    return make_user(UserRole.ADMIN)


# ── Service layer ────────────────────────────────────────────────────────


class TestSetRecruiterDecisionService:
    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "decision",
        [
            RecruiterDecision.PENDING,
            RecruiterDecision.SHORTLISTED,
            RecruiterDecision.REVIEW,
            RecruiterDecision.REJECTED,
        ],
    )
    async def test_all_four_decision_values_persist(self, recruiter, decision):
        attempt = make_attempt(recruiter.tenant_id)
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)

        result = await attempt_service.set_recruiter_decision(
            mock_db, attempt.id, recruiter.tenant_id, decision,
            "Reviewed integrity evidence and examination performance.", recruiter,
        )

        assert result.recruiter_decision == decision.value
        assert result.recruiter_notes == "Reviewed integrity evidence and examination performance."
        assert result.reviewed_by == recruiter.id
        assert result.reviewed_at is not None
        mock_db.flush.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_create_then_update_replaces_record_and_refreshes_metadata(self, recruiter, admin):
        attempt = make_attempt(
            recruiter.tenant_id,
            recruiter_decision="REVIEW",
            recruiter_notes="Initial look.",
            reviewed_by=admin.id,
            reviewed_at=datetime(2026, 8, 29, 9, 0, 0, tzinfo=timezone.utc),
        )
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)

        first = await attempt_service.set_recruiter_decision(
            mock_db, attempt.id, recruiter.tenant_id, RecruiterDecision.REVIEW,
            "Needs a closer look at the code submission.", recruiter,
        )
        assert first.recruiter_decision == "REVIEW"
        assert first.recruiter_notes == "Needs a closer look at the code submission."
        assert first.reviewed_by == recruiter.id

        updated_at = first.reviewed_at
        second = await attempt_service.set_recruiter_decision(
            mock_db, attempt.id, recruiter.tenant_id, RecruiterDecision.SHORTLISTED,
            "Strong technical performance after manual review.", recruiter,
        )
        assert second.recruiter_decision == "SHORTLISTED"
        assert second.recruiter_notes == "Strong technical performance after manual review."
        assert second.reviewed_by == recruiter.id
        assert second.reviewed_at >= updated_at  # refreshed on update

    @pytest.mark.asyncio
    async def test_notes_none_clears_existing_notes(self, recruiter):
        attempt = make_attempt(
            recruiter.tenant_id,
            recruiter_decision="REJECTED",
            recruiter_notes="Old rationale.",
        )
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)

        result = await attempt_service.set_recruiter_decision(
            mock_db, attempt.id, recruiter.tenant_id, RecruiterDecision.PENDING, None, recruiter,
        )
        assert result.recruiter_notes is None

    @pytest.mark.asyncio
    async def test_nonexistent_attempt_raises_attempt_not_found(self, recruiter):
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=None)

        with pytest.raises(Exception) as exc:
            await attempt_service.set_recruiter_decision(
                mock_db, uuid4(), recruiter.tenant_id, RecruiterDecision.SHORTLISTED, None, recruiter,
            )
        assert type(exc.value).__name__ == "AttemptNotFound"
        mock_db.flush.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_cross_tenant_access_is_not_found(self, recruiter):
        """An attempt from another tenant must be invisible (404 semantics)."""
        attempt = make_attempt(uuid4())  # different tenant
        mock_db = AsyncMock()
        # Real DB would filter by tenant_id; simulate by returning None.
        mock_db.execute.return_value = make_mock_result(scalar_one=None)

        with pytest.raises(Exception) as exc:
            await attempt_service.set_recruiter_decision(
                mock_db, attempt.id, recruiter.tenant_id, RecruiterDecision.SHORTLISTED, None, recruiter,
            )
        assert type(exc.value).__name__ == "AttemptNotFound"

    @pytest.mark.asyncio
    async def test_decision_does_not_touch_recommendation_inputs(self, recruiter):
        """The decision write must be limited to the four decision fields —
        status/answers (recommendation ground truth) remain untouched."""
        answers = {"q1": {"points_earned": 5}}
        attempt = make_attempt(recruiter.tenant_id, answers=answers, status="evaluated")
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)

        await attempt_service.set_recruiter_decision(
            mock_db, attempt.id, recruiter.tenant_id, RecruiterDecision.REJECTED,
            "Severe integrity findings confirmed manually.", recruiter,
        )

        assert attempt.status == "evaluated"          # untouched
        assert attempt.answers == answers             # untouched
        assert attempt.recruiter_decision == "REJECTED"


# ── Schema validation ────────────────────────────────────────────────────


class TestRecruiterDecisionSchemas:
    def test_valid_decisions_parse(self):
        for value in ("PENDING", "SHORTLISTED", "REVIEW", "REJECTED"):
            payload = RecruiterDecisionUpdate(decision=value, notes="n")
            assert payload.decision.value == value

    def test_invalid_decision_rejected_with_validation_error(self):
        with pytest.raises(ValidationError):
            RecruiterDecisionUpdate(decision="AUTO_REJECT")  # not a human decision
        with pytest.raises(ValidationError):
            RecruiterDecisionUpdate(decision="SHORTLIST")    # near-miss
        with pytest.raises(ValidationError):
            RecruiterDecisionUpdate(decision="shortlisted")  # case-sensitive

    def test_notes_over_5000_chars_rejected(self):
        with pytest.raises(ValidationError):
            RecruiterDecisionUpdate(decision="REVIEW", notes="x" * 5001)

    def test_evaluation_schema_carries_decision_fields(self):
        """Phase B evaluation payload exposes the decision separately from the
        recommendation — both fields coexist verbatim."""
        row = CandidateEvaluation(
            attempt_id=uuid4(),
            candidate_id=uuid4(),
            candidate_name="Sanya Nair",
            candidate_email="sanya@techcorp.demo",
            status="evaluated",
            started_at=None,
            submitted_at=None,
            duration_minutes=None,
            total_score=10,
            max_score=50,
            percentage=20.0,
            objective_score=10,
            objective_max_score=35,
            coding_score=0,
            coding_max_score=15,
            risk_score=0.9,
            risk_level="critical",
            risk_available=True,
            total_violations=4,
            high_violations=1,
            critical_violations=2,
            severe_integrity=True,
            recommendation={
                "code": "NOT_RECOMMENDED_BOTH",
                "label": "Not recommended",
                "reason": "Failing score with severe integrity findings.",
            },
            recruiter_decision="SHORTLISTED",  # human override of NOT_RECOMMENDED_BOTH is valid
            recruiter_notes="Recruiter has final authority.",
            reviewed_by=uuid4(),
            reviewed_at=datetime(2026, 8, 30, 12, 0, 0, tzinfo=timezone.utc),
        )
        assert row.recommendation.code == "NOT_RECOMMENDED_BOTH"
        assert row.recruiter_decision == "SHORTLISTED"  # both visible, distinct
        assert row.recruiter_decision != row.recommendation.code


# ── Endpoint / authorization ─────────────────────────────────────────────


class TestRecruiterDecisionEndpoint:
    def _override(self, user, mock_db):
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

    def test_recruiter_can_set_decision(self, recruiter):
        attempt = make_attempt(recruiter.tenant_id)
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)
        self._override(recruiter, mock_db)
        client = TestClient(app)
        try:
            resp = client.put(
                f"/api/v1/attempts/{attempt.id}/recruiter-decision",
                json={"decision": "SHORTLISTED", "notes": "Strong technical performance."},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["decision"] == "SHORTLISTED"
            assert body["notes"] == "Strong technical performance."
            assert body["reviewed_by"] == str(recruiter.id)
            assert body["reviewed_by_email"] == recruiter.email
            assert body["reviewed_at"] is not None
            assert body["attempt_id"] == str(attempt.id)
        finally:
            app.dependency_overrides.clear()

    def test_candidate_is_forbidden_403(self):
        candidate = make_user(UserRole.CANDIDATE)
        mock_db = AsyncMock()
        self._override(candidate, mock_db)
        client = TestClient(app)
        try:
            resp = client.put(
                f"/api/v1/attempts/{uuid4()}/recruiter-decision",
                json={"decision": "SHORTLISTED"},
            )
            assert resp.status_code == 403
            assert resp.json().get("error_code") == "FORBIDDEN"
        finally:
            app.dependency_overrides.clear()

    def test_nonexistent_attempt_is_404(self, recruiter):
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=None)
        self._override(recruiter, mock_db)
        client = TestClient(app)
        try:
            resp = client.put(
                f"/api/v1/attempts/{uuid4()}/recruiter-decision",
                json={"decision": "REVIEW", "notes": None},
            )
            assert resp.status_code == 404
        finally:
            app.dependency_overrides.clear()

    def test_invalid_decision_is_422(self, recruiter):
        attempt = make_attempt(recruiter.tenant_id)
        mock_db = AsyncMock()
        mock_db.execute.return_value = make_mock_result(scalar_one=attempt)
        self._override(recruiter, mock_db)
        client = TestClient(app)
        try:
            resp = client.put(
                f"/api/v1/attempts/{attempt.id}/recruiter-decision",
                json={"decision": "AUTO_ACCEPTED"},
            )
            assert resp.status_code == 422
        finally:
            app.dependency_overrides.clear()
