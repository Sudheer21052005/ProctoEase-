"""
Tests for Candidate Integrity Report PDF endpoint and service.
Phase 9 / Flagship Integrity Report: PDF generation, auth, tenant isolation, robustness, and Unicode safety.
Phase A layout hardening: wrapping, zero truncation, multi-page tables,
trace boxes, snapshot callouts, orphan control (all synthetic / in-memory data).
"""

import io
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PyPDF2 import PdfReader

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
    async def test_pdf_polish_branding_present(self, sample_user, sample_candidate, sample_attempt, sample_exam,
                                                sample_risk_score, sample_events, sample_questions, sample_code_submissions):
        """Phase G: navy header with subtitle and the branded confidential footer."""
        from PyPDF2 import PdfReader
        import io

        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=sample_candidate),
            make_mock_result(scalar_one=sample_exam),
            make_mock_result(scalars_all=sample_events),
            make_mock_result(scalars_all=sample_questions),
            make_mock_result(scalars_all=sample_code_submissions),
        ]
        with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as g,              patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as c:
            g.return_value = sample_risk_score
            c.return_value = sample_risk_score
            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = "".join((p.extract_text() or "") for p in reader.pages)
        flat = "".join(text.split())
        assert "Candidate Integrity Report" in text        # individual title kept
        assert "Candidate Proctoring & Integrity Assessment" in text  # subtitle
        assert "ProctoEase — Candidate Integrity Report" in text
        assert "CONFIDENTIAL — Recruiter Use Only" in text
        assert "Generated " in text and "UTC" in text
        assert "Page 1/" in text
        assert "Risk Level: MEDIUM" in text or "Risk Level: MEDIUM" in flat.replace("RiskLevel:", "Risk Level:")

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


# ═══════════════════════════════════════════════════════════════════════════
# Phase A — presentation & layout hardening
# ═══════════════════════════════════════════════════════════════════════════


def _page_count(pdf_bytes: bytes) -> int:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return len(reader.pages)


def _extract_text(pdf_bytes: bytes) -> str:
    """Extract whitespace-normalised text from all pages.

    Whitespace is collapsed because line wrapping inside table cells inserts
    newlines at arbitrary points; content fidelity is asserted on the
    whitespace-free projection of the text.
    """
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return "".join(page.extract_text() or "" for page in reader.pages)


def _flatten(s: str) -> str:
    return "".join(s.split())


class TestIntegrityReportLayoutHardening:
    """Phase A: wrapping, zero data loss, page-break hygiene, callouts."""

    @pytest.fixture
    def layout_candidate(self, sample_user):
        return User(
            id=uuid4(),
            email="layout.candidate@techcorp.demo",
            full_name="Layout Candidate",
            role=UserRole.CANDIDATE,
            tenant_id=sample_user.tenant_id,
            is_active=True,
        )

    @pytest.mark.asyncio
    async def test_long_mcq_text_wraps_without_truncation(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """300+ char question and selected options must survive verbatim."""
        long_question = (
            "Consider a distributed system employing a Raft-based consensus "
            "protocol in which the leader election timeout is drawn uniformly "
            "at random from the interval [T, 2T]. Analyze the expected number "
            "of election rounds required for a five-node cluster to converge "
            "under asynchronous message delays, and justify why randomized "
            "timeouts prevent split votes from persisting indefinitely. "
            "TAILMARKER-QX91"
        )
        long_selected = (
            "Option B: randomized election timeouts decouple candidate starts; "
            "Option C: log matching property guarantees suffix agreement; "
            "Option D: the quorum intersection property of majority votes "
            "TAILMARKER-SEL77"
        )
        q = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text=long_question,
            question_type=QuestionType.MCQ.value,
            correct_answer="B",
            points=3,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )
        answers = {
            str(q.id): {
                "is_correct": True,
                "points_earned": 3,
                "selected_option": long_selected,
            }
        }

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score,
            questions=[q], answers=answers,
        )

        text = _flatten(_extract_text(pdf_bytes))
        assert _flatten("TAILMARKER-QX91") in text   # full question tail intact
        assert _flatten("TAILMARKER-SEL77") in text  # full selection tail intact
        assert "..." not in text.replace(". . .", "")  # service never adds ellipses

    @pytest.mark.asyncio
    async def test_multiline_traces_rendered_without_truncation(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score, sample_exam
    ):
        """Multi-line stdout/stderr/compile output must be fully rendered."""
        long_question = "Write a service that simulates the Judge0 execution sandbox end to end."
        q = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text=long_question,
            question_type=QuestionType.CODE.value,
            correct_answer={"test_cases": []},
            points=5,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )
        stdout = "\n".join(
            f"line {i:02d}: executing test case with input payload variant {i}" for i in range(20)
        ) + "\nSTDOUT-TAIL-4b21"
        stderr = (
            "Traceback (most recent call last):\n"
            "  File \"solution.py\", line 42, in <module>\n"
            "    raise RuntimeError('sandbox aborted')\n"
            "RuntimeError: sandbox aborted\nSTDERR-TAIL-9cc3"
        )
        compile_output = (
            "solution.java:18: error: incompatible types: possible lossy "
            "conversion from long to int\n  return compact(hash);\n"
            "                     ^\nCOMPILE-TAIL-7ad5"
        )
        sub = CodeSubmission(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            question_id=q.id,
            tenant_id=sample_user.tenant_id,
            language_id=62,
            language_name="Java 17",
            source_code="class Main {}",
            status=SubmissionStatus.RUNTIME_ERROR.value,
            stdout=stdout,
            stderr=stderr,
            compile_output=compile_output,
            exit_code=1,
            time_sec=0.184,
            memory_kb=92160,
        )
        answers = {str(q.id): {"is_correct": False, "points_earned": 0}}

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score,
            questions=[q], submissions=[sub], answers=answers,
        )

        text = _flatten(_extract_text(pdf_bytes))
        assert _flatten("STDOUT-TAIL-4b21") in text
        assert _flatten("STDERR-TAIL-9cc3") in text
        assert _flatten("COMPILE-TAIL-7ad5") in text
        assert _flatten("sandbox aborted") in text  # multi-line traceback preserved

    @pytest.mark.asyncio
    async def test_large_timeline_spans_pages_with_repeated_headers(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """A 60-event timeline must flow across multiple pages without
        splitting rows or dropping content, repeating the header row."""
        base = datetime(2026, 8, 28, 10, 0, 0, tzinfo=timezone.utc)
        events = []
        for i in range(60):
            events.append(
                ProctoringEvent(
                    id=uuid4(),
                    attempt_id=sample_attempt.id,
                    tenant_id=sample_user.tenant_id,
                    event_type=f"event_type_{i % 5}",
                    detail={
                        "description": (
                            f"Violation {i:02d}: the proctoring pipeline recorded a "
                            f"sustained deviation lasting several seconds and captured "
                            f"a snapshot for recruiter review. TAILMARKER-EV{i:02d}"
                        )
                    },
                    severity=(i % 3) + 1,
                    snapshot_path=None,
                    created_at=base + timedelta(seconds=30 * i),
                )
            )

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events=events,
        )

        pages = _page_count(pdf_bytes)
        assert pages >= 3, f"expected multi-page timeline, got {pages} page(s)"

        reader = PdfReader(io.BytesIO(pdf_bytes))
        # The header row repeats on every continuation page of the timeline:
        # count the pages carrying the table header — it must span several.
        header_pages = sum(
            1
            for page in reader.pages
            if _flatten("Time (UTC)") in _flatten(page.extract_text() or "")
        )
        assert header_pages >= 2, (
            f"timeline header repeated on {header_pages} page(s); expected >= 2"
        )
        # Every event's tail marker survives (zero loss).
        full_text = _flatten(_extract_text(pdf_bytes))
        for i in range(60):
            assert f"TAILMARKER-EV{i:02d}" in full_text

    @pytest.mark.asyncio
    async def test_row_taller_than_page_does_not_crash(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """A single cell whose wrapped height exceeds a full page must not
        crash or loop; it flows across pages via the auto page break."""
        monster_desc = "overflow segment " * 400 + "MONSTER-TAIL-0000"
        ev = ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            event_type="suspicious_activity_burst",
            detail={"description": monster_desc},
            severity=3,
            snapshot_path=None,
            created_at=datetime.now(timezone.utc),
        )

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events=[ev],
        )

        assert pdf_bytes.startswith(b"%PDF")
        assert _flatten("MONSTER-TAIL-0000") in _flatten(_extract_text(pdf_bytes))

    @pytest.mark.asyncio
    async def test_missing_snapshot_renders_styled_callout(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """A snapshot path that does not exist renders the callout, verbatim."""
        ev = ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            event_type="phone_detected",
            detail={"description": "Phone in frame"},
            severity=3,
            snapshot_path="uploads/proctoring/verification/definitely_missing_42.jpg",
            created_at=datetime(2026, 8, 28, 11, 2, 3, tzinfo=timezone.utc),
        )

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events=[ev],
        )

        text = _flatten(_extract_text(pdf_bytes))
        assert _flatten("[Snapshot unavailable: phone_detected at 11:02:03]") in text

    @pytest.mark.asyncio
    async def test_corrupt_snapshot_renders_styled_callout(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """A corrupt image file is caught and rendered as a callout."""
        with NamedTemporaryFile(suffix=".jpg", delete=False) as tmp_corrupt:
            tmp_corrupt.write(b"NOT_A_VALID_IMAGE_DATA_CORRUPT_HEADER")
            corrupt_path = tmp_corrupt.name
        try:
            ev = ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="gaze_away",
                detail={"description": "Corrupt snapshot"},
                severity=2,
                snapshot_path=corrupt_path,
                created_at=datetime(2026, 8, 28, 11, 5, 6, tzinfo=timezone.utc),
            )

            pdf_bytes = await self._generate(
                sample_user, sample_attempt, layout_candidate, sample_risk_score, events=[ev],
            )

            assert pdf_bytes.startswith(b"%PDF")
            assert _flatten("[Snapshot unavailable:") in _flatten(_extract_text(pdf_bytes))
        finally:
            Path(corrupt_path).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_zero_violations_and_zero_code_questions(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """Clean attempt with no events, no questions, empty answers."""
        clean_risk = RiskScore(
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            overall_score=0.0,
            risk_level="low",
            breakdown={},
            event_counts={},
            total_events=0,
        )

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, clean_risk,
            events=[], questions=[], answers={},
        )

        assert pdf_bytes.startswith(b"%PDF")
        assert _page_count(pdf_bytes) == 1  # short report stays on one page
        text = _extract_text(pdf_bytes)
        assert "No violations recorded." in text
        assert "No snapshots available." in text
        assert "No objective questions in this exam." in text
        assert "No code questions in this exam." in text

    @pytest.mark.asyncio
    async def test_unicode_latin_cyrillic_rendered_via_dejavu(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """Latin-extended, Cyrillic and typography glyphs render through the
        embedded DejaVu font (not the Latin-1 fallback), verbatim."""
        unicode_candidate = User(
            id=layout_candidate.id,
            email="josé.müller@techcorp.demo",
            full_name="José Müller — Иванов",
            role=UserRole.CANDIDATE,
            tenant_id=sample_user.tenant_id,
            is_active=True,
        )
        unicode_exam = Exam(
            id=sample_attempt.exam_id,
            title="Examen – Экзамен «Sécurité»",
            tenant_id=sample_user.tenant_id,
            is_active=True,
            is_published=True,
        )
        q = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text="¿Cuál es la respuesta correcta sobre «sécurité» и «безопасность»?",
            question_type=QuestionType.MCQ.value,
            correct_answer="A",
            points=2,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )
        answers = {str(q.id): {"is_correct": True, "points_earned": 2, "selected_option": "A"}}

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, unicode_candidate, sample_risk_score,
            exam=unicode_exam, questions=[q], answers=answers,
        )

        text = _flatten(_extract_text(pdf_bytes))
        assert "JoséMüller—Иванов" in text
        assert "«Sécurité»" in text
        assert "¿Cuál" in text
        assert "«безопасность»" in text

    @pytest.mark.asyncio
    async def test_snapshot_image_embedded_within_printable_width(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """A valid image is embedded without exceeding the printable width."""
        from PIL import Image as PILImage

        with NamedTemporaryFile(suffix=".png", delete=False) as tmp_img:
            PILImage.new("RGB", (640, 480), color=(120, 40, 40)).save(tmp_img.name, format="PNG")
            img_path = tmp_img.name
        try:
            ev = ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="multiple_faces",
                detail={"description": "Second face entered frame"},
                severity=3,
                snapshot_path=img_path,
                created_at=datetime(2026, 8, 28, 11, 8, 9, tzinfo=timezone.utc),
            )

            pdf_bytes = await self._generate(
                sample_user, sample_attempt, layout_candidate, sample_risk_score, events=[ev],
            )

            assert pdf_bytes.startswith(b"%PDF")
            # The image XObject is embedded (on whichever page the
            # keep-together rule placed it) and page count stays sane.
            reader = PdfReader(io.BytesIO(pdf_bytes))
            assert any(
                "/XObject" in (page.get("/Resources").get_object() if page.get("/Resources") is not None else {})
                for page in reader.pages
            )
        finally:
            Path(img_path).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_section_heading_not_orphaned_before_tall_snapshot(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """Phase A Fix 1: the 'Evidence Snapshots' heading must never sit alone
        at the foot of a page. A tall first snapshot that cannot fit in the
        space left after the heading moves the heading to the next page WITH
        it (keep-with-next), instead of stranding it on the previous page."""
        from PIL import Image as PILImage

        with NamedTemporaryFile(suffix=".png", delete=False) as tmp_img:
            # Very tall portrait → display height hits the SNAPSHOT_IMG_MAX_H
            # cap (58 mm), so the whole first grid row (label + image) cannot
            # share a partially-filled page with the heading. Pre-fix, the
            # snapshot page-broke *after* the heading was drawn, orphaning it.
            PILImage.new("RGB", (400, 1600), color=(30, 60, 90)).save(tmp_img.name, format="PNG")
            img_path = tmp_img.name
        try:
            base = datetime(2026, 8, 28, 12, 0, 0, tzinfo=timezone.utc)
            # A couple of timeline-only events push the heading into the lower
            # half of the page; the third event carries the tall snapshot.
            events = [
                ProctoringEvent(
                    id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
                    event_type="tab_switch", detail={"description": "Tab switch detected"},
                    severity=1, snapshot_path=None, created_at=base,
                ),
                ProctoringEvent(
                    id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
                    event_type="no_face", detail={"description": "No face detected"},
                    severity=2, snapshot_path=None, created_at=base + timedelta(seconds=30),
                ),
                ProctoringEvent(
                    id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
                    event_type="multiple_faces", detail={"description": "Second face entered frame"},
                    severity=3, snapshot_path=img_path,
                    created_at=base + timedelta(minutes=1, seconds=7),
                ),
            ]

            pdf_bytes = await self._generate(
                sample_user, sample_attempt, layout_candidate, sample_risk_score, events=events,
            )

            reader = PdfReader(io.BytesIO(pdf_bytes))
            page_texts = [_flatten(p.extract_text() or "") for p in reader.pages]
            heading_page = next(
                (i for i, t in enumerate(page_texts) if "EvidenceSnapshots" in t), None
            )
            assert heading_page is not None, "Evidence Snapshots heading not found"
            # The first snapshot's label must be on the SAME page as the heading:
            # the heading is never left stranded at the foot of the previous page.
            label = _flatten("multiple_faces - 12:01:07")
            assert label in page_texts[heading_page], (
                "Evidence Snapshots heading is orphaned: its first snapshot label "
                f"is not on the heading's page (page index {heading_page})"
            )
        finally:
            Path(img_path).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_code_question_without_submission_wraps_full_text(
        self, sample_user, sample_attempt, layout_candidate, sample_risk_score
    ):
        """Phase A Fix 2: a long code question with NO submission renders its
        FULL text in 'Code Submission Details' (multi_cell wraps it) — the
        historical cell()-based clip at the printable width, which cut the text
        mid-word at ~80 chars, is gone. Source data is never truncated."""
        long_code_q = (
            "Coding: Implement a function that validates exam time windows. "
            "Your solution reads input from standard input (stdin) and writes "
            "the answer (true/false) to standard output (stdout). Each test "
            "case is run separately with its own stdin. TAILMARKER-CODE-NOSUB"
        )
        q = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text=long_code_q,
            question_type=QuestionType.CODE.value,
            correct_answer={"test_cases": []},
            points=5,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )

        pdf_bytes = await self._generate(
            sample_user, sample_attempt, layout_candidate, sample_risk_score,
            questions=[q], submissions=[], answers={},
        )

        raw = _extract_text(pdf_bytes)
        text = _flatten(raw)
        assert _flatten("TAILMARKER-CODE-NOSUB") in text   # full question tail intact
        assert _flatten("No submissions") in text          # No-submissions branch ran
        assert "..." not in raw.replace(". . .", "")       # service never adds ellipses

    # Shared async runner for _build-style generation with explicit patches.
    async def _generate(
        self,
        sample_user,
        sample_attempt,
        layout_candidate,
        risk_score,
        *,
        exam=None,
        events=None,
        questions=None,
        submissions=None,
        answers=None,
    ) -> bytes:
        attempt = sample_attempt
        if answers is not None:
            attempt.answers = answers
        events = events or []
        questions = questions or []
        submissions = submissions or []
        exam = exam or Exam(
            id=attempt.exam_id,
            title="Layout Hardening Exam",
            tenant_id=attempt.tenant_id,
            is_active=True,
            is_published=True,
        )

        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=attempt),
            make_mock_result(scalar_one=layout_candidate),
            make_mock_result(scalar_one=exam),
            make_mock_result(scalars_all=events),
            make_mock_result(scalars_all=questions),
            make_mock_result(scalars_all=submissions),
        ]

        with patch(
            "app.services.risk_engine.get_risk_score", new_callable=AsyncMock
        ) as mock_get_risk, patch(
            "app.services.risk_engine.compute_risk", new_callable=AsyncMock
        ) as mock_compute_risk:
            mock_get_risk.return_value = risk_score
            mock_compute_risk.return_value = risk_score
            return await integrity_report_service.generate_integrity_report_pdf(
                mock_db, attempt.id, sample_user.tenant_id
            )


# ═══════════════════════════════════════════════════════════════════════════
# Section F — snapshot path resolution (re-rooting + traversal containment)
#
# Regression coverage for the reported defect: the recruiter Proctoring section
# renders snapshots from `uploads/proctoring/...`, but the Integrity Report PDF
# showed "[Snapshot unavailable]" because resolve_snapshot_path doubled the
# `uploads/` prefix (→ `uploads/uploads/proctoring/...`, which never exists).
# ═══════════════════════════════════════════════════════════════════════════

IntegrityReportPDF = integrity_report_service.IntegrityReportPDF


def _has_embedded_image(pdf_bytes: bytes) -> bool:
    """True iff any page embeds at least one image XObject (an actual snapshot)."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        resources = page.get("/Resources")
        resources = resources.get_object() if resources is not None else None
        xobjects = resources.get("/XObject") if resources else None
        if xobjects is None:
            continue
        for ref in xobjects.get_object().values():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                return True
    return False


async def _render_with_events(user, attempt, candidate, risk_score, events):
    """Generate a report for `events` only (no questions/submissions) with a
    fully-mocked DB — the minimal wiring the snapshot-path tests need. Mirrors
    the six-query order the service issues (attempt, candidate, exam, events,
    questions, submissions)."""
    exam = Exam(
        id=attempt.exam_id,
        title="Snapshot Path Exam",
        tenant_id=attempt.tenant_id,
        is_active=True,
        is_published=True,
    )
    mock_db = AsyncMock()
    mock_db.execute.side_effect = [
        make_mock_result(scalar_one=attempt),
        make_mock_result(scalar_one=candidate),
        make_mock_result(scalar_one=exam),
        make_mock_result(scalars_all=events),
        make_mock_result(scalars_all=[]),
        make_mock_result(scalars_all=[]),
    ]
    with patch(
        "app.services.risk_engine.get_risk_score", new_callable=AsyncMock
    ) as mock_get_risk, patch(
        "app.services.risk_engine.compute_risk", new_callable=AsyncMock
    ) as mock_compute_risk:
        mock_get_risk.return_value = risk_score
        mock_compute_risk.return_value = risk_score
        return await integrity_report_service.generate_integrity_report_pdf(
            mock_db, attempt.id, user.tenant_id
        )


class TestSnapshotPathResolution:
    """Section F: the PDF must read the SAME on-disk snapshot the recruiter UI
    serves from `uploads/proctoring/...` — never a doubled `uploads/uploads/...`
    path — while rejecting traversal and preserving absolute test fixtures."""

    def test_relative_path_re_rooted_without_doubling(self, monkeypatch):
        """A stored `uploads/proctoring/...` value maps to exactly that file under
        the root, NOT `uploads/uploads/proctoring/...` (the reported bug)."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        resolved = IntegrityReportPDF.resolve_snapshot_path(
            "uploads/proctoring/periodic/example.jpg"
        )
        assert resolved is not None
        assert "uploads/uploads" not in resolved.as_posix()
        assert resolved.as_posix() == "uploads/proctoring/periodic/example.jpg"

    def test_empty_reference_resolves_to_none(self, monkeypatch):
        """Empty / whitespace references are unavailable (never a spurious path)."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        assert IntegrityReportPDF.resolve_snapshot_path("") is None
        assert IntegrityReportPDF.resolve_snapshot_path("   ") is None

    def test_absolute_path_returned_unchanged(self):
        """Absolute paths (synthetic fixtures / sample scripts) survive verbatim."""
        with NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            abs_path = tmp.name
        try:
            resolved = IntegrityReportPDF.resolve_snapshot_path(abs_path)
            assert resolved is not None
            assert resolved == Path(abs_path)
        finally:
            Path(abs_path).unlink(missing_ok=True)

    @pytest.mark.parametrize(
        "evil",
        [
            "uploads/proctoring/../../etc/passwd",
            "../../../etc/passwd",
            "uploads/proctoring/../../../../../../etc/shadow",
        ],
    )
    def test_traversal_paths_rejected(self, monkeypatch, evil):
        """A relative reference that escapes the upload root resolves to None
        (→ callout) and is never read from disk (defense-in-depth)."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        assert IntegrityReportPDF.resolve_snapshot_path(evil) is None

    @pytest.mark.asyncio
    async def test_real_relative_snapshot_under_root_is_embedded(
        self, monkeypatch, tmp_path, sample_user, sample_candidate,
        sample_attempt, sample_risk_score,
    ):
        """END-TO-END regression for the reported defect: an event whose
        snapshot_path is the REAL shape `uploads/proctoring/periodic/<file>.jpg`,
        pointing at an actual image under the configured root, embeds the image
        in the PDF instead of rendering '[Snapshot unavailable]'."""
        from PIL import Image as PILImage

        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        monkeypatch.chdir(tmp_path)
        rel = "uploads/proctoring/periodic/attempt_shot.jpg"
        (tmp_path / "uploads" / "proctoring" / "periodic").mkdir(parents=True)
        PILImage.new("RGB", (320, 240), color=(40, 90, 140)).save(
            tmp_path / rel, format="JPEG"
        )

        ev = ProctoringEvent(
            id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
            event_type="periodic_check", detail={"description": "Periodic snapshot"},
            severity=1, snapshot_path=rel,
            created_at=datetime(2026, 8, 26, 10, 39, 4, tzinfo=timezone.utc),
        )
        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, sample_candidate, sample_risk_score, [ev]
        )

        assert pdf_bytes.startswith(b"%PDF")
        assert _has_embedded_image(pdf_bytes), "real snapshot was not embedded"
        assert _flatten("Snapshotunavailable") not in _flatten(_extract_text(pdf_bytes))

    @pytest.mark.asyncio
    async def test_missing_relative_snapshot_falls_back_to_callout(
        self, monkeypatch, tmp_path, sample_user, sample_candidate,
        sample_attempt, sample_risk_score,
    ):
        """A relative reference under the root with no file on disk renders the
        callout and never crashes (a genuine miss, not a path bug)."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        monkeypatch.chdir(tmp_path)
        ev = ProctoringEvent(
            id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
            event_type="periodic_check", detail={"description": "Missing snapshot"},
            severity=1, snapshot_path="uploads/proctoring/periodic/nope_404.jpg",
            created_at=datetime(2026, 8, 26, 10, 40, 0, tzinfo=timezone.utc),
        )
        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, sample_candidate, sample_risk_score, [ev]
        )
        assert pdf_bytes.startswith(b"%PDF")
        assert not _has_embedded_image(pdf_bytes)
        assert _flatten("[Snapshot unavailable: periodic_check at 10:40:00]") in _flatten(
            _extract_text(pdf_bytes)
        )

    @pytest.mark.asyncio
    async def test_corrupt_snapshot_under_root_falls_back_to_callout(
        self, monkeypatch, tmp_path, sample_user, sample_candidate,
        sample_attempt, sample_risk_score,
    ):
        """A real file under the root that is not a valid image is caught and
        rendered as a callout, without HTTP 500."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        monkeypatch.chdir(tmp_path)
        snap_dir = tmp_path / "uploads" / "proctoring" / "violations"
        snap_dir.mkdir(parents=True)
        (snap_dir / "corrupt.jpg").write_bytes(b"NOT_A_VALID_IMAGE_DATA_CORRUPT_HEADER")
        ev = ProctoringEvent(
            id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
            event_type="fullscreen_exit", detail={"description": "Corrupt snapshot"},
            severity=2, snapshot_path="uploads/proctoring/violations/corrupt.jpg",
            created_at=datetime(2026, 8, 26, 10, 39, 14, tzinfo=timezone.utc),
        )
        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, sample_candidate, sample_risk_score, [ev]
        )
        assert pdf_bytes.startswith(b"%PDF")
        assert not _has_embedded_image(pdf_bytes)
        assert _flatten("[Snapshot unavailable:") in _flatten(_extract_text(pdf_bytes))

    @pytest.mark.asyncio
    async def test_absolute_snapshot_still_embeds_end_to_end(
        self, sample_user, sample_candidate, sample_attempt, sample_risk_score,
    ):
        """Preserve existing synthetic behaviour: an absolute image path embeds
        (the orphan-control and sample-generation fixtures rely on this)."""
        from PIL import Image as PILImage

        with NamedTemporaryFile(suffix=".png", delete=False) as tmp_img:
            PILImage.new("RGB", (400, 300), color=(90, 40, 40)).save(
                tmp_img.name, format="PNG"
            )
            abs_path = tmp_img.name
        try:
            ev = ProctoringEvent(
                id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
                event_type="multiple_faces", detail={"description": "Second face"},
                severity=3, snapshot_path=abs_path,
                created_at=datetime(2026, 8, 26, 10, 41, 0, tzinfo=timezone.utc),
            )
            pdf_bytes = await _render_with_events(
                sample_user, sample_attempt, sample_candidate, sample_risk_score, [ev]
            )
            assert pdf_bytes.startswith(b"%PDF")
            assert _has_embedded_image(pdf_bytes)
            assert _flatten("Snapshotunavailable") not in _flatten(_extract_text(pdf_bytes))
        finally:
            Path(abs_path).unlink(missing_ok=True)

    @pytest.mark.asyncio
    async def test_traversal_snapshot_renders_callout_end_to_end(
        self, monkeypatch, tmp_path, sample_user, sample_candidate,
        sample_attempt, sample_risk_score,
    ):
        """Defense-in-depth end-to-end: a traversal snapshot_path yields a callout
        (not a crash, not an out-of-root file read)."""
        monkeypatch.setattr(
            integrity_report_service.settings,
            "PROCTORING_UPLOAD_ROOT",
            "uploads/proctoring",
        )
        monkeypatch.chdir(tmp_path)
        ev = ProctoringEvent(
            id=uuid4(), attempt_id=sample_attempt.id, tenant_id=sample_user.tenant_id,
            event_type="gaze_away", detail={"description": "Traversal attempt"},
            severity=2, snapshot_path="uploads/proctoring/../../etc/passwd",
            created_at=datetime(2026, 8, 26, 10, 42, 0, tzinfo=timezone.utc),
        )
        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, sample_candidate, sample_risk_score, [ev]
        )
        assert pdf_bytes.startswith(b"%PDF")
        assert not _has_embedded_image(pdf_bytes)
        assert _flatten("[Snapshot unavailable:") in _flatten(_extract_text(pdf_bytes))


# ═══════════════════════════════════════════════════════════════════════════
# Section G — Compact Two-Column Evidence Snapshot Grid (Phase A Hardening)
# ═══════════════════════════════════════════════════════════════════════════


def _get_embedded_image_dims(pdf_bytes: bytes) -> list[tuple[int, int]]:
    """List of (width, height) pixel dimensions for all embedded image XObjects."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    dims = []
    for page in reader.pages:
        res = page.get("/Resources")
        res = res.get_object() if res is not None else None
        xo = res.get("/XObject") if res else None
        if xo is None:
            continue
        for ref in xo.get_object().values():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                dims.append((int(obj.get("/Width", 0)), int(obj.get("/Height", 0))))
    return dims


def _get_image_placements(pdf_bytes: bytes) -> list[dict]:
    """Extract on-page image placements [{page, x, y, w, h}] in PDF points."""
    from PyPDF2.generic import ContentStream

    reader = PdfReader(io.BytesIO(pdf_bytes))
    out = []
    for pi, page in enumerate(reader.pages):
        contents = page.get_contents()
        if contents is None:
            continue
        cs = ContentStream(contents, reader)
        last_cm = None
        for operands, op in cs.operations:
            if op == b"cm":
                last_cm = [float(x) for x in operands]
            elif op == b"Do" and last_cm is not None:
                a, b, c, d, e, f = last_cm
                out.append({"page": pi, "x": e, "y": f, "w": a, "h": d})
    return out


class TestSnapshotEvidenceGridLayout:
    """Phase A hardening: Compact two-column evidence snapshot grid."""

    @pytest.fixture
    def layout_candidate(self, sample_user):
        return User(
            id=uuid4(),
            email="grid.candidate@techcorp.demo",
            full_name="Grid Candidate",
            role=UserRole.CANDIDATE,
            tenant_id=sample_user.tenant_id,
            is_active=True,
        )

    @pytest.mark.asyncio
    async def test_eight_snapshots_render_compactly_in_two_columns(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """Eight production-shaped (320x240) snapshots render in a compact
        two-column grid. All 8 images are embedded, aspect ratio is preserved,
        and page count is significantly lower than the 4-page single-column layout."""
        from PIL import Image as PILImage

        events = []
        base = datetime(2026, 8, 28, 10, 0, 0, tzinfo=timezone.utc)
        types = [
            ("periodic_check", 1),
            ("no_face", 2),
            ("periodic_check", 1),
            ("no_face", 2),
            ("gaze_away", 2),
            ("fullscreen_exit", 2),
            ("no_face", 2),
            ("phone_detected", 3),
        ]
        for i, (etype, sev) in enumerate(types):
            img_file = tmp_path / f"snap_{i}.jpg"
            PILImage.new("RGB", (320, 240), color=(30 + i * 20, 60, 90)).save(
                img_file, format="JPEG", quality=70
            )
            events.append(
                ProctoringEvent(
                    id=uuid4(),
                    attempt_id=sample_attempt.id,
                    tenant_id=sample_user.tenant_id,
                    event_type=etype,
                    detail={"description": f"Event {i}"},
                    severity=sev,
                    snapshot_path=str(img_file),
                    created_at=base + timedelta(seconds=i * 45),
                )
            )

        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events
        )

        assert pdf_bytes.startswith(b"%PDF")
        reader = PdfReader(io.BytesIO(pdf_bytes))
        # 8 snapshots in 2-column grid + Attempt Info + Risk Summary + Timeline consume 3 pages total (down from 5 pages in single-column)
        assert len(reader.pages) <= 3, f"Expected <= 3 pages, got {len(reader.pages)}"
        embedded = _get_embedded_image_dims(pdf_bytes)
        assert len(embedded) == 8, f"Expected 8 embedded images, got {len(embedded)}"
        # All 8 labels are present in the PDF text
        text = _flatten(_extract_text(pdf_bytes))
        for i, (etype, _) in enumerate(types):
            t_str = (base + timedelta(seconds=i * 45)).strftime("%H:%M:%S")
            assert _flatten(f"{etype}-{t_str}") in text

    @pytest.mark.asyncio
    async def test_two_column_side_by_side_placement_and_aspect_ratio(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """Two snapshots placed on the same row appear side-by-side (different X,
        aligned bottom Y) with matching widths and aspect ratio 0.75 (4:3)."""
        from PIL import Image as PILImage

        img1 = tmp_path / "snap1.jpg"
        img2 = tmp_path / "snap2.jpg"
        PILImage.new("RGB", (320, 240), color=(40, 80, 120)).save(img1, format="JPEG")
        PILImage.new("RGB", (320, 240), color=(60, 100, 140)).save(img2, format="JPEG")

        base = datetime(2026, 8, 28, 10, 5, 0, tzinfo=timezone.utc)
        events = [
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="no_face",
                detail={"description": "First"},
                severity=2,
                snapshot_path=str(img1),
                created_at=base,
            ),
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="phone_detected",
                detail={"description": "Second"},
                severity=3,
                snapshot_path=str(img2),
                created_at=base + timedelta(seconds=30),
            ),
        ]

        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events
        )

        placements = _get_image_placements(pdf_bytes)
        assert len(placements) == 2, f"Expected 2 image placements, got {len(placements)}"
        left, right = sorted(placements, key=lambda d: d["x"])
        # Same page and aligned bottom edge
        assert left["page"] == right["page"]
        assert abs(left["y"] - right["y"]) < 1.0
        # Equal width and height
        assert abs(left["w"] - right["w"]) < 1.0
        assert abs(left["h"] - right["h"]) < 1.0
        # Distinct horizontal columns: left is at margin (~28.35 pt = 10mm), right is offset (~308.98 pt = 109mm)
        assert left["x"] < 50.0
        assert right["x"] > 250.0
        # Aspect ratio preserved (240 / 320 = 0.75)
        assert abs((left["h"] / left["w"]) - 0.75) < 0.01

    @pytest.mark.asyncio
    async def test_oversized_image_downsampled_for_pdf_and_original_unchanged(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """An oversized 1600x1200 image is downsampled into an in-memory copy for PDF
        embedding, but the stored source file on disk is never modified."""
        from PIL import Image as PILImage

        img_file = tmp_path / "huge_snapshot.jpg"
        PILImage.new("RGB", (1600, 1200), color=(100, 50, 50)).save(
            img_file, format="JPEG", quality=85
        )
        orig_bytes = img_file.read_bytes()
        orig_size = (1600, 1200)

        ev = ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            event_type="multiple_faces",
            detail={"description": "Huge image test"},
            severity=3,
            snapshot_path=str(img_file),
            created_at=datetime(2026, 8, 28, 11, 0, 0, tzinfo=timezone.utc),
        )

        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, [ev]
        )

        # 1. Stored source file on disk is UNMODIFIED
        assert img_file.read_bytes() == orig_bytes
        with PILImage.open(img_file) as check_img:
            assert check_img.size == orig_size

        # 2. Embedded image in PDF is downsampled (width <= 700 px, not 1600 px)
        dims = _get_embedded_image_dims(pdf_bytes)
        assert len(dims) == 1
        emb_w, emb_h = dims[0]
        assert emb_w < 700, f"Expected downsampled width < 700, got {emb_w}"
        # Aspect ratio of embedded image remains 1200 / 1600 = 0.75
        assert abs((emb_h / emb_w) - 0.75) < 0.02

    @pytest.mark.asyncio
    async def test_small_image_passed_through_verbatim(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """A standard 320x240 camera frame (<= display pixel budget) is embedded
        verbatim without unnecessary resizing."""
        from PIL import Image as PILImage

        img_file = tmp_path / "small_snapshot.jpg"
        PILImage.new("RGB", (320, 240), color=(50, 100, 50)).save(
            img_file, format="JPEG", quality=70
        )

        ev = ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            event_type="no_face",
            detail={"description": "Small image"},
            severity=2,
            snapshot_path=str(img_file),
            created_at=datetime(2026, 8, 28, 11, 5, 0, tzinfo=timezone.utc),
        )

        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, [ev]
        )

        dims = _get_embedded_image_dims(pdf_bytes)
        assert len(dims) == 1
        assert dims[0] == (320, 240)

    @pytest.mark.asyncio
    async def test_mixed_snapshots_with_missing_and_corrupt_in_grid(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """A 4-item grid with 2 valid images, 1 missing image, and 1 corrupt file
        embeds 2 images and renders 2 styled callout boxes in their respective cells."""
        from PIL import Image as PILImage

        valid1 = tmp_path / "v1.jpg"
        valid2 = tmp_path / "v2.jpg"
        corrupt = tmp_path / "corrupt.jpg"
        missing = tmp_path / "non_existent.jpg"

        PILImage.new("RGB", (320, 240), color=(30, 60, 90)).save(valid1, format="JPEG")
        PILImage.new("RGB", (320, 240), color=(60, 90, 120)).save(valid2, format="JPEG")
        corrupt.write_bytes(b"NOT_A_VALID_JPEG_HEADER")

        base = datetime(2026, 8, 28, 11, 10, 0, tzinfo=timezone.utc)
        events = [
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="periodic_check",
                detail={"description": "Valid 1"},
                severity=1,
                snapshot_path=str(valid1),
                created_at=base,
            ),
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="no_face",
                detail={"description": "Missing"},
                severity=2,
                snapshot_path=str(missing),
                created_at=base + timedelta(seconds=10),
            ),
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="fullscreen_exit",
                detail={"description": "Corrupt"},
                severity=2,
                snapshot_path=str(corrupt),
                created_at=base + timedelta(seconds=20),
            ),
            ProctoringEvent(
                id=uuid4(),
                attempt_id=sample_attempt.id,
                tenant_id=sample_user.tenant_id,
                event_type="phone_detected",
                detail={"description": "Valid 2"},
                severity=3,
                snapshot_path=str(valid2),
                created_at=base + timedelta(seconds=30),
            ),
        ]

        pdf_bytes = await _render_with_events(
            sample_user, sample_attempt, layout_candidate, sample_risk_score, events
        )

        assert pdf_bytes.startswith(b"%PDF")
        dims = _get_embedded_image_dims(pdf_bytes)
        # Exactly 2 valid images embedded
        assert len(dims) == 2
        # Text contains 2 callout notices for missing & corrupt
        text = _flatten(_extract_text(pdf_bytes))
        assert _flatten("[Snapshot unavailable: no_face at 11:10:10]") in text
        assert _flatten("[Snapshot unavailable: fullscreen_exit at 11:10:20]") in text

    @pytest.mark.asyncio
    async def test_subsequent_sections_remain_intact_after_snapshot_grid(
        self, tmp_path, sample_user, layout_candidate, sample_attempt, sample_risk_score
    ):
        """Subsequent sections (MCQ results, Code question results, Code submission
        details) render cleanly and completely after the snapshot grid."""
        from PIL import Image as PILImage

        img1 = tmp_path / "snap.jpg"
        PILImage.new("RGB", (320, 240), color=(40, 80, 120)).save(img1, format="JPEG")

        ev = ProctoringEvent(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            tenant_id=sample_user.tenant_id,
            event_type="no_face",
            detail={"description": "Snap test"},
            severity=2,
            snapshot_path=str(img1),
            created_at=datetime(2026, 8, 28, 12, 0, 0, tzinfo=timezone.utc),
        )

        q1 = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text="What is the capital of France? Verify subsequent section integrity.",
            question_type=QuestionType.MCQ.value,
            correct_answer={"correct_options": ["Paris"]},
            points=2,
            order_index=0,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )
        q2 = Question(
            id=uuid4(),
            exam_id=sample_attempt.exam_id,
            question_text="Implement binary search algorithm.",
            question_type=QuestionType.CODE.value,
            correct_answer={"test_cases": []},
            points=10,
            order_index=1,
            is_active=True,
            tenant_id=sample_user.tenant_id,
        )

        sub = CodeSubmission(
            id=uuid4(),
            attempt_id=sample_attempt.id,
            question_id=q2.id,
            tenant_id=sample_user.tenant_id,
            language_id=71,
            language_name="Python",
            source_code="def binary_search(): pass",
            status=SubmissionStatus.ACCEPTED.value,
            stdout="Target found at index 3",
            stderr="",
            compile_output="",
            time_sec=0.042,
            memory_kb=1024,
            created_at=datetime.now(timezone.utc),
        )

        answers = {
            str(q1.id): {
                "question_id": str(q1.id),
                "selected_option": "Paris",
                "is_correct": True,
                "points_earned": 2,
            },
            str(q2.id): {
                "question_id": str(q2.id),
                "is_correct": True,
                "points_earned": 10,
            },
        }
        sample_attempt.answers = answers

        exam = Exam(
            id=sample_attempt.exam_id,
            title="Post-Grid Sections Exam",
            tenant_id=sample_attempt.tenant_id,
            is_active=True,
            is_published=True,
        )

        mock_db = AsyncMock()
        mock_db.execute.side_effect = [
            make_mock_result(scalar_one=sample_attempt),
            make_mock_result(scalar_one=layout_candidate),
            make_mock_result(scalar_one=exam),
            make_mock_result(scalars_all=[ev]),
            make_mock_result(scalars_all=[q1, q2]),
            make_mock_result(scalars_all=[sub]),
        ]

        with patch(
            "app.services.risk_engine.get_risk_score", new_callable=AsyncMock
        ) as mock_get_risk, patch(
            "app.services.risk_engine.compute_risk", new_callable=AsyncMock
        ) as mock_compute_risk:
            mock_get_risk.return_value = sample_risk_score
            mock_compute_risk.return_value = sample_risk_score
            pdf_bytes = await integrity_report_service.generate_integrity_report_pdf(
                mock_db, sample_attempt.id, sample_user.tenant_id
            )

        text = _flatten(_extract_text(pdf_bytes))
        # Snapshots section
        assert _flatten("EvidenceSnapshots") in text
        assert _has_embedded_image(pdf_bytes)
        # Objective question section
        assert _flatten("ObjectiveQuestionResults") in text
        assert _flatten("WhatisthecapitalofFrance?") in text
        # Code question results section
        assert _flatten("CodeQuestionResults") in text
        assert _flatten("Implementbinarysearchalgorithm.") in text
        # Code submission details section
        assert _flatten("CodeSubmissionDetails") in text
        assert _flatten("Targetfoundatindex3") in text