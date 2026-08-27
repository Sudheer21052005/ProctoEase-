"""
Tests for Candidate Integrity Report PDF endpoint and service.
Phase 9 / Flagship Integrity Report: PDF generation, auth, tenant isolation, robustness, and Unicode safety.
"""

from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user, get_db
from app.core.exceptions import AttemptNotFound, Forbidden
from app.main import app
from app.models.attempt import ExamAttempt
from app.models.code_submission import CodeSubmission, SubmissionStatus
from app.models.exam import Exam
from app.models.proctoring_event import ProctoringEvent
from app.models.question import Question, QuestionType
from app.models.risk_score import RiskScore
from app.models.user import User, UserRole
from app.services import integrity_report_service


@pytest.fixture
def sample_user():
    return User(
        id=uuid4(),
        email="recruiter@techcorp.com",
        full_name="Recruiter One",
        role=UserRole.RECRUITER,
        tenant_id=uuid4(),
        is_active=True,
    )


@pytest.fixture
def sample_candidate(sample_user):
    return User(
        id=uuid4(),
        email="candidate@techcorp.demo",
        full_name="Candidate One",
        role=UserRole.CANDIDATE,
        tenant_id=sample_user.tenant_id,
        is_active=True,
    )


@pytest.fixture
def sample_attempt(sample_user, sample_candidate):
    return ExamAttempt(
        id=uuid4(),
        exam_id=uuid4(),
        candidate_id=sample_candidate.id,
        tenant_id=sample_user.tenant_id,
        status="submitted",
        is_active=True,
        started_at=datetime.now(timezone.utc),
        submitted_at=datetime.now(timezone.utc),
        answers={},
    )


@pytest.fixture
def sample_exam(sample_attempt):
    return Exam(
        id=sample_attempt.exam_id,
        title="Test Exam",
        tenant_id=sample_attempt.tenant_id,
        is_active=True,
        is_published=True,
    )


@pytest.fixture
def sample_risk_score(sample_attempt):
    return RiskScore(
        attempt_id=sample_attempt.id,
        tenant_id=sample_attempt.tenant_id,
        overall_score=0.42,
        risk_level="medium",
        breakdown={"tab_switch": 0.1, "no_face": 0.32},
        event_counts={"tab_switch": 2, "no_face": 1},
        total_events=3,
    )


@pytest.fixture
def sample_events(sample_attempt):
    return [
        ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_attempt.tenant_id,
            event_type="tab_switch",
            detail={"description": "Tab switch detected"},
            severity=1,
            snapshot_path="uploads/proctoring/verification/abc123.jpg",
            created_at=datetime.now(timezone.utc),
        ),
        ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_attempt.tenant_id,
            event_type="no_face",
            detail={"description": "No face detected"},
            severity=2,
            snapshot_path=None,
            created_at=datetime.now(timezone.utc),
        ),
    ]


@pytest.fixture
def sample_questions(sample_attempt):
    q1 = Question(
        id=uuid4(),
        exam_id=sample_attempt.exam_id,
        question_text="What is 2+2?",
        question_type=QuestionType.MCQ.value,
        correct_answer="A",
        points=2,
        order_index=0,
        is_active=True,
        tenant_id=sample_attempt.tenant_id,
    )
    q2 = Question(
        id=uuid4(),
        exam_id=sample_attempt.exam_id,
        question_text="Implement a function",
        question_type=QuestionType.CODE.value,
        correct_answer={"test_cases": [{"input": "1", "expected": True}]},
        points=5,
        order_index=1,
        is_active=True,
        tenant_id=sample_attempt.tenant_id,
    )
    return [q1, q2]


@pytest.fixture
def sample_code_submissions(sample_attempt, sample_questions):
    return [
        CodeSubmission(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            question_id=sample_questions[1].id,
            tenant_id=sample_attempt.tenant_id,
            language_id=71,
            language_name="Python 3",
            source_code="def solve():\n    return True",
            status=SubmissionStatus.ACCEPTED.value,
            stdout="true\n",
            time_sec=0.05,
            memory_kb=1024,
        )
    ]


def make_mock_result(scalar_one=None, scalars_all=None):
    """Create a mock result for db.execute that accurately returns None or given objects."""
    mock = MagicMock()
    mock.scalar_one_or_none = MagicMock(return_value=scalar_one)
    if scalars_all is not None:
        mock.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=scalars_all)))
    else:
        mock.scalars = MagicMock(return_value=MagicMock(all=MagicMock(return_value=[])))
    return mock


class TestIntegrityReportPDF:
    """Test suite for the integrity report PDF generation service and endpoint."""

    @pytest.mark.asyncio
    async def test_download_integrity_report_pdf_success(
        self, sample_user, sample_candidate, sample_attempt, sample_exam, sample_risk_score,
        sample_events, sample_questions, sample_code_submissions
    ):
        """Test successful PDF generation for a valid attempt."""
        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=sample_candidate),
            make_mock_result(scalar_one=sample_exam),
            make_mock_result(scalars_all=sample_events),
            make_mock_result(scalars_all=sample_questions),
            make_mock_result(scalars_all=sample_code_submissions),
        ]

        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
             patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
            mock_get_risk.return_value = None
            mock_compute_risk.return_value = sample_risk_score

            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        assert pdf_bytes is not None
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_download_integrity_report_pdf_attempt_not_found(self):
        """Test AttemptNotFound is raised when attempt does not exist."""
        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=make_mock_result(scalar_one=None))

        with pytest.raises(AttemptNotFound):
            await integrity_report_service.generate_integrity_report_pdf(
                mock_db, uuid4(), uuid4()
            )

    @pytest.mark.asyncio
    async def test_service_tenant_isolation(self, sample_attempt):
        """Test that requesting an attempt with a mismatched tenant_id raises AttemptNotFound."""
        mock_db = AsyncMock()
        different_tenant_id = uuid4()

        # Database query with mismatched tenant_id will return None
        async def mock_execute(stmt):
            # If query filters by tenant_id, mismatched tenant returns None
            return make_mock_result(scalar_one=None)

        mock_db.execute = AsyncMock(side_effect=mock_execute)

        with pytest.raises(AttemptNotFound):
            await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, different_tenant_id
            )

    def test_endpoint_candidate_rejected_403(self, sample_candidate):
        """Test endpoint-level auth: candidates are forbidden from downloading integrity reports."""
        app.dependency_overrides[get_current_user] = lambda: sample_candidate
        client = TestClient(app)
        try:
            resp = client.get(f"/api/v1/attempts/{uuid4()}/integrity-report/pdf")
            assert resp.status_code == 403
            assert resp.json().get("error_code") == "FORBIDDEN"
        finally:
            app.dependency_overrides.clear()

    def test_endpoint_tenant_isolation_404(self, sample_user):
        """Test endpoint-level tenant isolation: recruiter from Tenant B accessing Tenant A attempt gets 404."""
        recruiter_b = User(
            id=uuid4(),
            email="recruiter@tenantb.com",
            full_name="Recruiter Tenant B",
            role=UserRole.RECRUITER,
            tenant_id=uuid4(),  # Tenant B
            is_active=True,
        )

        mock_db = AsyncMock()
        mock_db.execute = AsyncMock(return_value=make_mock_result(scalar_one=None))

        app.dependency_overrides[get_current_user] = lambda: recruiter_b
        app.dependency_overrides[get_db] = lambda: mock_db
        client = TestClient(app)
        try:
            resp = client.get(f"/api/v1/attempts/{uuid4()}/integrity-report/pdf")
            assert resp.status_code == 404
            assert resp.json().get("error_code") == "ATTEMPT_NOT_FOUND"
        finally:
            app.dependency_overrides.clear()

    def test_endpoint_success_200(
        self, sample_user, sample_candidate, sample_attempt, sample_exam, sample_risk_score,
        sample_events, sample_questions, sample_code_submissions
    ):
        """Test endpoint returns 200 OK with application/pdf and Content-Disposition headers for authorized recruiter."""
        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=sample_candidate),
            make_mock_result(scalar_one=sample_exam),
            make_mock_result(scalars_all=sample_events),
            make_mock_result(scalars_all=sample_questions),
            make_mock_result(scalars_all=sample_code_submissions),
        ]

        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
             patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
            mock_get_risk.return_value = sample_risk_score
            mock_compute_risk.return_value = sample_risk_score

            app.dependency_overrides[get_current_user] = lambda: sample_user
            app.dependency_overrides[get_db] = lambda: mock_db
            client = TestClient(app)
            try:
                resp = client.get(f"/api/v1/attempts/{sample_attempt.id}/integrity-report/pdf")
                assert resp.status_code == 200
                assert resp.headers["content-type"] == "application/pdf"
                assert "attachment; filename=" in resp.headers.get("content-disposition", "")
                assert resp.headers.get("content-disposition", "").endswith('.pdf"')
                assert resp.content.startswith(b"%PDF")
                assert len(resp.content) > 1000
            finally:
                app.dependency_overrides.clear()

    @pytest.mark.asyncio
    async def test_pdf_robustness_missing_snapshot(
        self, sample_user, sample_candidate, sample_attempt, sample_exam,
        sample_risk_score, sample_events, sample_questions
    ):
        """Test that a missing snapshot file path does not crash PDF generation."""
        mock_db = AsyncMock()
        sample_events[0].snapshot_path = "uploads/proctoring/verification/nonexistent_file_999.jpg"

        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=sample_candidate),
            make_mock_result(scalar_one=sample_exam),
            make_mock_result(scalars_all=sample_events),
            make_mock_result(scalars_all=sample_questions),
            make_mock_result(scalars_all=[]),
        ]

        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
             patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
            mock_get_risk.return_value = None
            mock_compute_risk.return_value = sample_risk_score

            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        assert pdf_bytes is not None
        assert len(pdf_bytes) > 1000
        assert pdf_bytes.startswith(b"%PDF")

    @pytest.mark.asyncio
    async def test_pdf_robustness_corrupt_snapshot(
        self, sample_user, sample_candidate, sample_attempt, sample_exam,
        sample_risk_score, sample_questions
    ):
        """Test that a corrupt/unreadable image file on disk is caught, logged, and skipped without HTTP 500."""
        with NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_corrupt:
            tmp_corrupt.write(b"NOT_A_VALID_IMAGE_DATA_CORRUPT_HEADER")
            corrupt_path = tmp_corrupt.name

        try:
            corrupt_event = ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="no_face",
                detail={"description": "Corrupt image test"},
                severity=2,
                snapshot_path=corrupt_path,
                created_at=datetime.now(timezone.utc),
            )

            mock_db = AsyncMock()
            mock_db.execute.side_effect = [
                make_mock_result(scalar_one=sample_attempt),
                make_mock_result(scalar_one=sample_candidate),
                make_mock_result(scalar_one=sample_exam),
                make_mock_result(scalars_all=[corrupt_event]),
                make_mock_result(scalars_all=sample_questions),
                make_mock_result(scalars_all=[]),
            ]

            with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
                 patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
                mock_get_risk.return_value = sample_risk_score
                mock_compute_risk.return_value = sample_risk_score

                pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                    mock_db, sample_attempt.id, sample_user.tenant_id
                )

            assert pdf_bytes.startswith(b"%PDF")
            assert len(pdf_bytes) > 1000
        finally:
            Path(corrupt_path).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_pdf_unicode_safe_generation(
        self, sample_user, sample_attempt, sample_risk_score
    ):
        """Test that non-ASCII and Unicode content (accents, Japanese, Hindi, smart dashes) do not crash PDF generation."""
        unicode_candidate = User(
            id=sample_attempt.candidate_id,
            email="jose.muller@techcorp.demo",
            full_name="José Müller",
            role=UserRole.CANDIDATE,
            tenant_id=sample_user.tenant_id,
            is_active=True,
        )
        unicode_exam = Exam(
            id=sample_attempt.exam_id,
            title="Candidato – 技術試験",
            tenant_id=sample_user.tenant_id,
            is_active=True,
            is_published=True,
        )
        unicode_question = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text="¿Cuál es la respuesta correcta? / प्रश्न",
            question_type=QuestionType.MCQ.value,
            correct_answer="A",
            points=2,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )

        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=unicode_candidate),
            make_mock_result(scalar_one=unicode_exam),
            make_mock_result(scalars_all=[]),
            make_mock_result(scalars_all=[unicode_question]),
            make_mock_result(scalars_all=[]),
        ]

        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
             patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
            mock_get_risk.return_value = sample_risk_score
            mock_compute_risk.return_value = sample_risk_score

            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        assert pdf_bytes.startswith(b"%PDF")
        assert len(pdf_bytes) > 1000

    @pytest.mark.asyncio
    async def test_pdf_content_sanity(
        self, sample_user, sample_candidate, sample_attempt, sample_exam,
        sample_risk_score, sample_events, sample_questions, sample_code_submissions
    ):
        """Test that generated PDF is a valid PDF with expected non-trivial structure."""
        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=sample_candidate),
            make_mock_result(scalar_one=sample_exam),
            make_mock_result(scalars_all=sample_events),
            make_mock_result(scalars_all=sample_questions),
            make_mock_result(scalars_all=sample_code_submissions),
        ]

        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as mock_get_risk, \
             patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as mock_compute_risk:
            mock_get_risk.return_value = None
            mock_compute_risk.return_value = sample_risk_score

            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        assert pdf_bytes.startswith(b"%PDF")
        assert len(pdf_bytes) > 1000  # non-trivial size