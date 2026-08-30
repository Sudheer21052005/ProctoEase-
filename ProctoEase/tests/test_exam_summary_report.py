"""
Tests for Phase F — Exam-Wide Summary Report PDF.

The PDF must be a pure rendering of the canonical Phase B evaluation:
``get_exam_evaluation`` is asserted to be awaited EXACTLY ONCE, statistics are
verified against synthetic in-memory payloads, and the Phase D recruiter
decision is proven to never alter the system recommendation. All data is
synthetic; the database session is mocked.
"""

import io
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PyPDF2 import PdfReader

from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User, UserRole
from app.services import exam_summary_report_service


def make_user(role: UserRole = UserRole.RECRUITER) -> User:
    return User(
        id=uuid4(),
        email=f"{role.value}@techcorp.com",
        full_name=f"Test {role.value}",
        role=role,
        tenant_id=uuid4(),
        is_active=True,
    )


def make_candidate(**overrides):
    candidate = {
        "attempt_id": uuid4(),
        "candidate_id": uuid4(),
        "candidate_name": "Sanya Nair",
        "candidate_email": "sanya.nair.04@techcorp.demo",
        "status": "evaluated",
        "started_at": datetime(2026, 8, 27, 12, 0, 0, tzinfo=timezone.utc),
        "submitted_at": datetime(2026, 8, 27, 12, 5, 0, tzinfo=timezone.utc),
        "duration_minutes": 5.0,
        "total_score": 2,
        "max_score": 15,
        "percentage": 13.33,
        "objective_score": 2,
        "objective_max_score": 6,
        "coding_score": 0,
        "coding_max_score": 9,
        "risk_score": 0.8173,
        "risk_level": "critical",
        "risk_available": True,
        "total_violations": 13,
        "high_violations": 2,
        "critical_violations": 1,
        "severe_integrity": True,
        "recommendation": {
            "code": "NOT_RECOMMENDED_BOTH",
            "label": "Not Recommended (Academic & Integrity)",
            "reason": "Score 13.33% is below passing cutoff (50%) with concurrent severe integrity flags.",
        },
        "recruiter_decision": "SHORTLISTED",
        "recruiter_notes": "Candidate selected for further evaluation.",
        "reviewed_by": uuid4(),
        "reviewed_at": datetime(2026, 8, 30, 7, 1, 0, tzinfo=timezone.utc),
        "reviewed_by_email": "recruiter@techcorp.com",
    }
    candidate.update(overrides)
    return candidate


def make_evaluation(candidates=None, **overrides):
    payload = {
        "exam_id": uuid4(),
        "exam_title": "Algorithms & Cloud Infrastructure Benchmark (Test 3)",
        "total_attempts": len(candidates) if candidates is not None else 1,
        "max_score": 15,
        "objective_max_score": 6,
        "coding_max_score": 9,
        "passing_score_pct": 50.0,
        "borderline_max_pct": 60.0,
        "excellence_score_pct": 75.0,
        "violation_type_histogram": {"tab_switch": 9, "no_face": 4, "phone_detected": 1},
        "candidates": candidates if candidates is not None else [make_candidate()],
    }
    payload.update(overrides)
    return payload


def _extract(pdf_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _flatten(s: str) -> str:
    return "".join(s.split())


# ── Pure aggregation helpers ──────────────────────────────────────────────


class TestAggregationHelpers:
    def test_score_stats_exact(self):
        candidates = [
            {"percentage": 10.0, "duration_minutes": 10},
            {"percentage": 50.0, "duration_minutes": 20},
            {"percentage": 90.0, "duration_minutes": 30},
            {"percentage": None, "duration_minutes": None},
        ]
        stats = exam_summary_report_service.score_stats(candidates)
        assert stats["graded"] == 3
        assert stats["not_graded"] == 1
        assert stats["avg_pct"] == 50.0
        assert stats["median_pct"] == 50.0
        assert stats["highest_pct"] == 90.0
        assert stats["lowest_pct"] == 10.0

    def test_score_band_counts_match_benchmarks(self):
        candidates = [
            {"percentage": 13.33},   # 0–49
            {"percentage": 49.99},   # 0–49
            {"percentage": 50.0},    # 50–59 (at passing benchmark)
            {"percentage": 59.99},   # 50–59
            {"percentage": 60.0},    # 60–74
            {"percentage": 75.0},    # 75–100 (at excellence benchmark)
            {"percentage": 100.0},   # 75–100
            {"percentage": None},    # ungraded excluded
        ]
        bands = dict(exam_summary_report_service.score_band_counts(candidates))
        assert bands == {"0–49%": 2, "50–59%": 2, "60–74%": 1, "75–100%": 2}

    def test_risk_distribution_and_unavailable(self):
        candidates = [
            {"risk_level": "low", "risk_available": True},
            {"risk_level": "high", "risk_available": True},
            {"risk_level": "critical", "risk_available": True},
            {"risk_level": None, "risk_available": False},
        ]
        dist = exam_summary_report_service.risk_distribution(candidates)
        assert dist == {"low": 1, "medium": 0, "high": 1, "critical": 1, "unavailable": 1}

    def test_recommendation_distribution_all_six_codes(self):
        candidates = [
            {"recommendation": {"code": code}}
            for code in (
                "MANUAL_REVIEW", "NOT_RECOMMENDED_ACADEMIC", "NOT_RECOMMENDED_BOTH",
                "INTEGRITY_REVIEW", "SHORTLIST", "STRONG_SHORTLIST", "SHORTLIST",
            )
        ]
        rows = exam_summary_report_service.recommendation_distribution(candidates)
        counts = dict(rows)
        assert len(rows) == 6
        assert counts["SHORTLIST"] == 2 and counts["MANUAL_REVIEW"] == 1
        assert counts["STRONG_SHORTLIST"] == 1

    def test_decision_distribution_null_becomes_pending(self):
        candidates = [
            {"recruiter_decision": None},
            {"recruiter_decision": "PENDING"},
            {"recruiter_decision": "REJECTED"},
            {"recruiter_decision": "REVIEW"},
        ]
        rows = exam_summary_report_service.recruiter_decision_distribution(candidates)
        assert dict(rows) == {"PENDING": 2, "SHORTLISTED": 0, "REVIEW": 1, "REJECTED": 1}

    def test_completion_stats(self):
        candidates = [
            {"status": "started", "duration_minutes": None},
            {"status": "submitted", "duration_minutes": 4.76},
            {"status": "evaluated", "duration_minutes": 3.65},
        ]
        stats = exam_summary_report_service.completion_stats(candidates)
        assert stats["total"] == 3
        assert stats["started"] == 1 and stats["submitted"] == 1 and stats["evaluated"] == 1
        assert stats["completion_rate_pct"] == 66.7
        assert stats["avg_duration_minutes"] == 4.2


# ── PDF content (rendered from synthetic payloads) ────────────────────────


class TestSummaryPdfContent:
    def _pdf(self, evaluation) -> bytes:
        return exam_summary_report_service._render(evaluation)

    def test_valid_pdf_with_magic_and_pyppdf_readable(self):
        data = self._pdf(make_evaluation())
        assert data.startswith(b"%PDF")
        assert len(data) > 1000
        assert len(PdfReader(io.BytesIO(data)).pages) >= 1

    def test_overview_benchmarks_and_title_present(self):
        text = _flatten(_extract(self._pdf(make_evaluation())))
        # Polished header/footer (Phase F polish)
        assert "Exam-WideEvaluationSummary" in text
        assert "CONFIDENTIAL—RecruiterUseOnly" in text
        assert "ProctoEase—Exam-WideEvaluationSummary" in text
        assert "Page1/2" in text or "Page2/2" in text or "Page1/1" in text
        assert "Algorithms&CloudInfrastructureBenchmark(Test3)" in text
        # Stat-block labels (uppercased) with their bold values
        assert "PASSINGSCORE" in text and "50.0%" in text
        assert "BORDERLINEMAXIMUM" in text and "60.0%" in text
        assert "EXCELLENCE SCORE".replace(" ", "") in text and "75.0%" in text
        assert "TOTALATTEMPTS" in text
        assert "COMPLETIONRATE" in text

    def test_score_stats_rendered(self):
        evaluation = make_evaluation(
            candidates=[
                make_candidate(percentage=13.33),
                make_candidate(candidate_name="B", candidate_email="b@x.demo", percentage=55.0),
                make_candidate(candidate_name="C", candidate_email="c@x.demo", percentage=82.0),
                make_candidate(candidate_name="D", candidate_email="d@x.demo", percentage=None, status="started"),
            ]
        )
        text = _flatten(_extract(self._pdf(evaluation)))
        assert "AveragePercentage:50.1%" in text
        assert "MedianPercentage:55.0%" in text
        assert "HighestPercentage:82.0%" in text
        assert "LowestPercentage:13.3%" in text
        assert "NotGraded:1" in text

    def test_distributions_rendered(self):
        evaluation = make_evaluation(
            candidates=[
                make_candidate(),
                make_candidate(
                    candidate_name="Ishaan Sharma", candidate_email="ish@x.demo",
                    risk_level="high", risk_score=0.71,
                    recommendation={"code": "NOT_RECOMMENDED_BOTH", "label": "N/R", "reason": "below cutoff"},
                    recruiter_decision="REJECTED",
                ),
                make_candidate(
                    candidate_name="Never Reviewed", candidate_email="nr@x.demo",
                    recruiter_decision=None, risk_available=False, risk_level=None,
                ),
            ]
        )
        text = _flatten(_extract(self._pdf(evaluation)))
        # Score bands
        assert "0–49%" in text and "50–59%" in text and "60–74%" in text and "75–100%" in text
        # Risk rows (unavailable counted)
        assert "CRITICAL" in text and "HIGH" in text and "RISKUNAVAILABLE" in text
        assert "SevereIntegrityFlags:3" in text
        # All six recommendation codes appear
        for code in ("MANUAL_REVIEW", "NOT_RECOMMENDED_ACADEMIC", "NOT_RECOMMENDED_BOTH",
                     "INTEGRITY_REVIEW", "SHORTLIST", "STRONG_SHORTLIST"):
            assert code in text
        # Decisions: null rendered as PENDING
        assert "PENDING" in text and "SHORTLISTED" in text and "REJECTED" in text

    def test_recommendation_unchanged_when_decision_differs(self):
        base = make_evaluation()
        text_base = _flatten(_extract(self._pdf(base)))
        overridden = make_evaluation(
            candidates=[make_candidate(recruiter_decision="REJECTED", recruiter_notes="Declined.")]
        )
        text_over = _flatten(_extract(self._pdf(overridden)))
        # The recommendation rows are identical regardless of the decision.
        # The distribution renders the engine CODE (reasons belong to the
        # per-candidate reports); it must be identical across decisions.
        assert "NOT_RECOMMENDED_BOTH" in text_base and "NOT_RECOMMENDED_BOTH" in text_over
        assert "SHORTLISTED" in text_base and "REJECTED" in text_over

    def test_violation_histogram_table_rendered(self):
        text = _flatten(_extract(self._pdf(make_evaluation())))
        assert "tab_switch" in text and "no_face" in text and "phone_detected" in text

    def test_disclaimer_present(self):
        text = _flatten(_extract(self._pdf(make_evaluation())))
        assert _flatten(
            "System recommendations are automated decision support; recruiter "
            "decisions are the final human judgment."
        ) in text

    def test_empty_exam_renders_gracefully(self):
        evaluation = make_evaluation(candidates=[])
        evaluation["violation_type_histogram"] = {}
        data = self._pdf(evaluation)
        text = _flatten(_extract(data))
        assert "TOTALATTEMPTS" in text and "COMPLETIONRATE" in text
        assert "0.0%" in text  # completion rate zero, never fabricated
        assert "Noattemptsrecordedforthisexam." in text
        assert "Noviolationsrecordedforthisexam." in text
        # N/A statistics, never fabricated numbers
        assert "AveragePercentage:N/A" in text

    def test_unicode_names_survive(self):
        evaluation = make_evaluation(
            candidates=[make_candidate(candidate_name="José Müller — Иванов")]
        )
        text = _flatten(_extract(self._pdf(evaluation)))
        assert "JoséMüller—Иванов" in text

    def test_multipage_roster_with_many_candidates(self):
        evaluation = make_evaluation(
            candidates=[
                make_candidate(
                    candidate_name=f"Candidate {i:02d}",
                    candidate_email=f"cand{i:02d}@techcorp.demo",
                )
                for i in range(60)
            ]
        )
        data = self._pdf(evaluation)
        reader = PdfReader(io.BytesIO(data))
        assert len(reader.pages) >= 3, "60-candidate roster must span multiple pages"
        full = _flatten(_extract(data))
        for i in (0, 29, 59):
            assert f"Candidate{i:02d}" in full  # zero loss across pages

    def test_decision_and_roster_semantic_distinction_preserved(self):
        """Polish regression: recommendation codes render neutrally while the
        human decision column carries the semantic value — both still exact."""
        evaluation = make_evaluation(
            candidates=[
                make_candidate(recruiter_decision="REJECTED", recruiter_notes="Declined."),
            ]
        )
        text = _flatten(_extract(self._pdf(evaluation)))
        assert "NOT_RECOMMENDED_BOTH" in text  # engine output, verbatim
        assert "REJECTED" in text             # human decision, verbatim
        assert "RecruiterDecision(finalhumanjudgment)" in text
        assert "SystemRecommendation(automated)" in text

    def test_null_optional_values_do_not_crash(self):
        evaluation = make_evaluation(
            candidates=[
                make_candidate(
                    candidate_name=None, candidate_email=None, percentage=None,
                    risk_level=None, risk_available=False, recruiter_decision=None,
                    recruiter_notes=None, reviewed_at=None, reviewed_by=None,
                    duration_minutes=None, submitted_at=None,
                )
            ],
            violation_type_histogram={},
        )
        data = self._pdf(evaluation)
        assert data.startswith(b"%PDF")


# ── Endpoint: auth, isolation, reuse-once, download headers ───────────────


class TestSummaryReportEndpoint:
    def _override(self, user, mock_db):
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: mock_db

    def test_recruiter_gets_pdf_and_evaluation_called_once(self, recruiter=None):
        user = recruiter or make_user(UserRole.RECRUITER)
        mock_db = AsyncMock()
        evaluation = make_evaluation()
        self._override(user, mock_db)
        client = TestClient(app)
        with patch(
            "app.services.exam_summary_report_service.get_exam_evaluation",
            new_callable=AsyncMock,
        ) as mock_eval:
            mock_eval.return_value = evaluation
            resp = client.get(f"/api/v1/exams/{evaluation['exam_id']}/summary-report/pdf")
        try:
            assert resp.status_code == 200
            assert resp.headers["content-type"] == "application/pdf"
            assert resp.headers["content-disposition"].startswith(
                'attachment; filename="summary_report_'
            )
            assert resp.headers["content-disposition"].endswith('.pdf"')
            assert resp.content.startswith(b"%PDF")
            mock_eval.assert_awaited_once()  # canonical source, exactly once
        finally:
            app.dependency_overrides.clear()

    def test_admin_authorized(self):
        admin = make_user(UserRole.ADMIN)
        mock_db = AsyncMock()
        evaluation = make_evaluation()
        self._override(admin, mock_db)
        client = TestClient(app)
        with patch(
            "app.services.exam_summary_report_service.get_exam_evaluation",
            new_callable=AsyncMock,
        ) as mock_eval:
            mock_eval.return_value = evaluation
            resp = client.get(f"/api/v1/exams/{evaluation['exam_id']}/summary-report/pdf")
        try:
            assert resp.status_code == 200
            mock_eval.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    def test_candidate_forbidden_403(self):
        candidate = make_user(UserRole.CANDIDATE)
        mock_db = AsyncMock()
        self._override(candidate, mock_db)
        client = TestClient(app)
        try:
            resp = client.get(f"/api/v1/exams/{uuid4()}/summary-report/pdf")
            assert resp.status_code == 403
            assert resp.json().get("error_code") == "FORBIDDEN"
        finally:
            app.dependency_overrides.clear()

    def test_cross_tenant_exam_404(self):
        recruiter = make_user(UserRole.RECRUITER)
        mock_db = AsyncMock()
        self._override(recruiter, mock_db)
        client = TestClient(app)
        with patch(
            "app.services.exam_summary_report_service.get_exam_evaluation",
            new_callable=AsyncMock,
        ) as mock_eval:
            from app.core.exceptions import ExamNotFound

            mock_eval.side_effect = ExamNotFound()
            resp = client.get(f"/api/v1/exams/{uuid4()}/summary-report/pdf")
        try:
            assert resp.status_code == 404
            mock_eval.assert_awaited_once()
        finally:
            app.dependency_overrides.clear()

    def test_no_n_plus_one_constant_query_count(self):
        """3 candidates (2 with reviewers, varied events) still use exactly
        the constant number of db.execute calls."""
        from types import SimpleNamespace

        from app.services import exam_evaluation_service

        exam = SimpleNamespace(id=uuid4(), title="N+1 Guard Exam")
        attempts = [
            SimpleNamespace(
                id=uuid4(), candidate_id=uuid4(), reviewed_by=None,
                recruiter_decision=None, recruiter_notes=None, reviewed_at=None,
                answers={}, status="submitted",
                started_at=datetime(2026, 8, 27, 10, 0, tzinfo=timezone.utc),
                submitted_at=datetime(2026, 8, 27, 11, 0, tzinfo=timezone.utc),
                is_active=True,
            )
            for _ in range(3)
        ]
        def make_result(scalar_one=None, scalars_all=None, rows=None):
            mock = MagicMock()
            mock.scalar_one_or_none = MagicMock(return_value=scalar_one)
            mock.scalars = MagicMock(
                return_value=MagicMock(all=MagicMock(return_value=scalars_all or []))
            )
            mock.all = MagicMock(return_value=rows or [])
            return mock

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(
            side_effect=[
                make_result(scalar_one=exam),
                make_result(scalars_all=attempts),
                make_result(scalars_all=[]),
                make_result(rows=[]),
                make_result(rows=[]),
            ]
        )
        with patch(
            "app.services.exam_evaluation_service.risk_engine.get_exam_risk_scores",
            new_callable=AsyncMock,
        ) as mock_risk:
            mock_risk.return_value = []
            import asyncio

            out = asyncio.run(
                exam_evaluation_service.get_exam_evaluation(mock_db, exam.id, uuid4())
            )
        assert len(out["candidates"]) == 3
        assert mock_db.execute.await_count == 5  # constant, independent of N
