"""
Generate representative sample Integrity Report PDFs using purely synthetic,
in-memory data (no database writes) for manual visual inspection.

Usage (from ProctoEase/):
    & "C:\\Users\\Dell\\OneDrive\\Desktop\\ProctoEase Mini Project\\.venv\\Scripts\\python.exe" tests/generate_sample_integrity_pdfs.py

Outputs into tests/output/:
    sample_normal_report.pdf        - standard attempt (snapshot embedded)
    sample_long_text_multipage.pdf  - long MCQ/code text, multi-line traces,
                                      multi-page violation timeline
    sample_missing_snapshots.pdf    - missing + corrupt snapshot callouts
    sample_real_snapshot.pdf        - real `uploads/proctoring/periodic/...` path
                                      shape, snapshot embedded (regression proof)
    sample_evidence_grid.pdf        - 8 production-shape (320x240 JPEG) snapshots
                                      in the compact two-column evidence grid
"""

import asyncio
import io
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from PIL import Image as PILImage, ImageDraw
from PyPDF2 import PdfReader

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.models.attempt import ExamAttempt
from app.models.code_submission import CodeSubmission, SubmissionStatus
from app.models.exam import Exam
from app.models.proctoring_event import ProctoringEvent
from app.models.question import Question, QuestionType
from app.models.risk_score import RiskScore
from app.models.user import User, UserRole
from app.core.config import settings
from app.services import integrity_report_service

OUTPUT_DIR = Path(__file__).parent / "output"


def _pdf_has_image(pdf_bytes: bytes) -> bool:
    """True iff the PDF embeds at least one image XObject (an actual snapshot)."""
    reader = PdfReader(io.BytesIO(pdf_bytes))
    for page in reader.pages:
        res = page.get("/Resources")
        res = res.get_object() if res is not None else None
        xobjects = res.get("/XObject") if res else None
        if xobjects is None:
            continue
        for ref in xobjects.get_object().values():
            if ref.get_object().get("/Subtype") == "/Image":
                return True
    return False


def make_mock_result(scalar_one=None, scalars_all=None):
    mock = MagicMock()
    mock.scalar_one_or_none = MagicMock(return_value=scalar_one)
    mock.scalars = MagicMock(
        return_value=MagicMock(all=MagicMock(return_value=scalars_all or []))
    )
    return mock


def make_synthetic_snapshot(label: str, size=(640, 480)) -> str:
    """Draw a fake webcam frame with Pillow; returns absolute path."""
    img = PILImage.new("RGB", size, color=(24, 26, 32))
    draw = ImageDraw.Draw(img)
    draw.rectangle([8, 8, size[0] - 8, size[1] - 8], outline=(90, 110, 140), width=3)
    draw.text((24, 20), f"SYNTHETIC SNAPSHOT - {label}", fill=(230, 230, 230))
    draw.text((24, 44), "ProctoEase visual-test artifact (no real data)", fill=(150, 160, 180))
    draw.ellipse([size[0] // 2 - 60, size[1] // 2 - 80, size[0] // 2 + 60, size[1] // 2 + 40],
                 outline=(200, 200, 200), width=4)
    draw.ellipse([size[0] // 2 - 26, size[1] // 2 - 20, size[0] // 2 + 26, size[1] // 2 + 90],
                 outline=(200, 200, 200), width=4)
    tmp = NamedTemporaryFile(suffix=".png", delete=False)
    tmp.close()
    img.save(tmp.name, format="PNG")
    return tmp.name


async def build_pdf(*, title, events, questions, submissions, answers, risk, candidate_name):
    tenant_id = uuid4()
    recruiter = User(id=uuid4(), email="recruiter@techcorp.demo", full_name="Recruiter One",
                     role=UserRole.RECRUITER, tenant_id=tenant_id, is_active=True)
    candidate = User(id=uuid4(), email=f"{candidate_name.replace(' ', '.').lower()}@techcorp.demo",
                     full_name=candidate_name, role=UserRole.CANDIDATE, tenant_id=tenant_id, is_active=True)
    attempt = ExamAttempt(id=uuid4(), exam_id=uuid4(), candidate_id=candidate.id, tenant_id=tenant_id,
                          status="submitted", is_active=True,
                          started_at=datetime(2026, 8, 29, 10, 0, 0, tzinfo=timezone.utc),
                          submitted_at=datetime(2026, 8, 29, 11, 12, 0, tzinfo=timezone.utc),
                          answers=answers)
    exam = Exam(id=attempt.exam_id, title=title, tenant_id=tenant_id, is_active=True, is_published=True)

    mock_db = AsyncMock()
    mock_db.execute.side_effect = [
        make_mock_result(scalar_one=attempt),
        make_mock_result(scalar_one=candidate),
        make_mock_result(scalar_one=exam),
        make_mock_result(scalars_all=events),
        make_mock_result(scalars_all=questions),
        make_mock_result(scalars_all=submissions),
    ]
    with patch("app.services.risk_engine.get_risk_score", new_callable=AsyncMock) as g, \
         patch("app.services.risk_engine.compute_risk", new_callable=AsyncMock) as c:
        g.return_value = risk
        c.return_value = risk
        return await integrity_report_service.generate_integrity_report_pdf(
            mock_db, attempt.id, tenant_id
        )


def ev(attempt_id, tenant_id, etype, desc, severity, minutes, snapshot=None, base=None):
    return ProctoringEvent(
        id=uuid4(), attempt_id=attempt_id, tenant_id=tenant_id, event_type=etype,
        detail={"description": desc}, severity=severity, snapshot_path=snapshot,
        created_at=(base or datetime(2026, 8, 29, 10, 0, 0, tzinfo=timezone.utc)) + timedelta(minutes=minutes),
    )


def sample_normal() -> Path:
    snap = make_synthetic_snapshot("tab_switch 10:14")
    mcq = Question(id=uuid4(), exam_id=uuid4(), question_text="Which data structure gives O(1) amortized append?",
                   question_type=QuestionType.MCQ.value, correct_answer="A", points=2, order_index=0,
                   is_active=True, tenant_id=uuid4())
    code = Question(id=uuid4(), exam_id=uuid4(), question_text="Implement two-stack queue dequeue.",
                    question_type=QuestionType.CODE.value, correct_answer={"test_cases": []}, points=5,
                    order_index=1, is_active=True, tenant_id=uuid4())
    for q in (mcq, code):
        q.exam_id = mcq.exam_id
    sub = CodeSubmission(id=uuid4(), attempt_id=uuid4(), question_id=code.id, tenant_id=uuid4(),
                         language_id=71, language_name="Python 3", source_code="class Queue: ...",
                         status=SubmissionStatus.ACCEPTED.value, stdout="5/5 test cases passed\n",
                         time_sec=0.042, memory_kb=8960)
    events = [
        ev(mcq.exam_id, mcq.tenant_id, "tab_switch", "Tab or window switch detected", 1, 14, snapshot=snap),
        ev(mcq.exam_id, mcq.tenant_id, "no_face", "No face detected for 2.3 seconds", 2, 26),
        ev(mcq.exam_id, mcq.tenant_id, "fullscreen_exit", "Exited fullscreen mode", 2, 41),
    ]
    sub.attempt_id = events[0].attempt_id
    sub.tenant_id = events[0].tenant_id
    for q in (mcq, code):
        q.tenant_id = events[0].tenant_id
    answers = {
        str(mcq.id): {"is_correct": True, "points_earned": 2, "selected_option": "Dynamic array (amortized)"},
        str(code.id): {"is_correct": True, "points_earned": 5},
    }
    risk = RiskScore(attempt_id=events[0].attempt_id, tenant_id=events[0].tenant_id,
                     overall_score=0.1842, risk_level="low",
                     breakdown={"tab_switch": 0.1, "no_face": 0.06, "fullscreen_exit": 0.024},
                     event_counts={"tab_switch": 1, "no_face": 1, "fullscreen_exit": 1}, total_events=3)
    pdf = asyncio.run(build_pdf(title="Senior Backend Engineer - Screen I", events=events,
                                questions=[mcq, code], submissions=[sub], answers=answers, risk=risk,
                                candidate_name="Aisha Verma"))
    out = OUTPUT_DIR / "sample_normal_report.pdf"
    out.write_bytes(pdf)
    Path(snap).unlink(missing_ok=True)
    return out


def sample_long_text() -> Path:
    tenant_id = uuid4()
    attempt_id = uuid4()
    long_q = Question(
        id=uuid4(), exam_id=uuid4(), tenant_id=tenant_id,
        question_text=(
            "Consider a distributed system employing a Raft-based consensus protocol in which the "
            "leader election timeout is drawn uniformly at random from the interval [T, 2T]. Analyze "
            "the expected number of election rounds required for a five-node cluster to converge under "
            "asynchronous message delays, and justify why randomized timeouts prevent split votes from "
            "persisting indefinitely. Then contrast this with a deterministic failure detector and "
            "explain the trade-off between detection latency and false-positive rate in wide-area "
            "deployments with heterogeneous RTTs."
        ),
        question_type=QuestionType.MCQ.value, correct_answer="B", points=4, order_index=0, is_active=True)
    code_q = Question(
        id=uuid4(), exam_id=uuid4(), tenant_id=tenant_id,
        question_text=(
            "Implement a rate limiter supporting both token-bucket and sliding-window-log policies. "
            "The API must expose allow(key, now) and penalise bursty consumers; discuss the memory "
            "profile of each policy for one million active keys and how you would shard the counters."
        ),
        question_type=QuestionType.CODE.value, correct_answer={"test_cases": []}, points=10,
        order_index=1, is_active=True)
    sub = CodeSubmission(
        id=uuid4(), attempt_id=attempt_id, question_id=code_q.id, tenant_id=tenant_id,
        language_id=62, language_name="Java 17",
        source_code="class RateLimiter { /* candidate solution */ }",
        status=SubmissionStatus.RUNTIME_ERROR.value,
        stdout="\n".join(f"case {i:02d}: allow(key_{i}) -> true, remaining={49 - i}" for i in range(18))
               + "\nfinal case: allow(key_burst) -> FALSE, remaining=0",
        stderr="Traceback (most recent call last):\n"
               "  File \"RateLimiter.java\", line 88, in allow\n"
               "    java.lang.ArithmeticException: divide by zero in sliding window cleanup\n"
               "    at RateLimiter.cleanup(RateLimiter.java:112)\n"
               "Execution aborted after 3 of 10 test cases.",
        compile_output="RateLimiter.java:31: warning: [unchecked] unchecked call to put(K,V) as a "
                       "member of the raw type HashMap\n  buckets.put(key, window);\n                      ^",
        exit_code=1, time_sec=0.317, memory_kb=104448)
    events = [
        ev(attempt_id, tenant_id, "gaze_away",
           "Sustained head-pitch deviation for 4.1 seconds while the MCQ section was on screen; "
           "snapshot captured for review.", 2, 8),
        ev(attempt_id, tenant_id, "phone_detected",
           "COCO-SSD classified a hand-held object as 'cell phone' (score 0.79) for two consecutive "
           "ticks; recruiter snapshot attached.", 3, 17),
        ev(attempt_id, tenant_id, "multiple_faces",
           "A second face entered the frame and remained visible for 1.8 seconds before the candidate "
           "asked the intruder to leave.", 3, 33),
    ]
    events += [
        ev(attempt_id, tenant_id, f"event_type_{i % 6}",
           f"Violation {i:02d}: the proctoring pipeline recorded a sustained deviation lasting several "
           f"seconds and captured a snapshot for recruiter review (auto-generated stress entry).",
           (i % 3) + 1, 40 + i, base=datetime(2026, 8, 29, 10, 0, 0, tzinfo=timezone.utc))
        for i in range(57)
    ]
    answers = {
        str(long_q.id): {"is_correct": True, "points_earned": 4,
                         "selected_option": "Randomized timeouts decouple candidate start times; the "
                                            "expected rounds to converge stay bounded even under "
                                            "asynchronous delays because the probability that two "
                                            "candidates remain split for k consecutive rounds decays "
                                            "geometrically with the randomization width."},
        str(code_q.id): {"is_correct": False, "points_earned": 4},
    }
    risk = RiskScore(attempt_id=attempt_id, tenant_id=tenant_id, overall_score=0.7311, risk_level="high",
                     breakdown={"phone_detected": 0.9, "multiple_faces": 0.8, "gaze_away": 0.3},
                     event_counts={"phone_detected": 1, "multiple_faces": 1, "gaze_away": 57},
                     total_events=60)
    pdf = asyncio.run(build_pdf(title="Staff Platform Engineer - Distributed Systems Deep Dive",
                                events=events, questions=[long_q, code_q], submissions=[sub],
                                answers=answers, risk=risk, candidate_name="Dmitri Petrov"))
    out = OUTPUT_DIR / "sample_long_text_multipage.pdf"
    out.write_bytes(pdf)
    return out


def sample_missing_snapshots() -> Path:
    tenant_id = uuid4()
    attempt_id = uuid4()
    with NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(b"CORRUPT-BYTES-NOT-AN-IMAGE")
        corrupt_path = tmp.name
    events = [
        ev(attempt_id, tenant_id, "tab_switch", "Tab switch detected while on question 3", 1, 9,
           snapshot="uploads/proctoring/verification/does_not_exist_1.jpg"),
        ev(attempt_id, tenant_id, "gaze_away", "Head-pitch deviation sustained 4.2 s", 2, 21,
           snapshot=corrupt_path),
        ev(attempt_id, tenant_id, "no_face", "No face detected for 3.1 seconds", 2, 34),
        ev(attempt_id, tenant_id, "multiple_faces", "Second person briefly visible behind candidate", 3, 47),
    ]
    risk = RiskScore(attempt_id=attempt_id, tenant_id=tenant_id, overall_score=0.4102, risk_level="medium",
                     breakdown={"tab_switch": 0.1, "gaze_away": 0.15, "no_face": 0.06, "multiple_faces": 0.1},
                     event_counts={"tab_switch": 1, "gaze_away": 1, "no_face": 1, "multiple_faces": 1},
                     total_events=4)
    pdf = asyncio.run(build_pdf(title="Frontend Engineer - React Screening", events=events,
                                questions=[], submissions=[], answers={}, risk=risk,
                                candidate_name="Renée O'Connell"))
    out = OUTPUT_DIR / "sample_missing_snapshots.pdf"
    out.write_bytes(pdf)
    Path(corrupt_path).unlink(missing_ok=True)
    return out


def sample_real_snapshot() -> Path:
    """Real-shape snapshot embedding proof: an event whose snapshot_path is the
    exact DB shape `uploads/proctoring/periodic/<file>.jpg`, pointing at an actual
    image under PROCTORING_UPLOAD_ROOT. Proves the PDF embeds the SAME file the
    recruiter UI serves, instead of the '[Snapshot unavailable]' callout the old
    doubled-prefix resolver produced. Runs inside a throwaway working dir so the
    repository stays clean."""
    prev_cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            tenant_id = uuid4()
            attempt_id = uuid4()
            periodic_dir = Path(settings.PROCTORING_UPLOAD_ROOT) / "periodic"
            periodic_dir.mkdir(parents=True, exist_ok=True)
            filename = f"e2e_{attempt_id}_{uuid4().hex[:8]}.jpg"
            rel = (Path("uploads") / "proctoring" / "periodic" / filename).as_posix()
            frame = make_synthetic_snapshot("periodic_check 10:39:04", size=(640, 480))
            PILImage.open(frame).convert("RGB").save(periodic_dir / filename, format="JPEG")
            Path(frame).unlink(missing_ok=True)
            events = [
                ev(attempt_id, tenant_id, "periodic_check",
                   "Periodic liveness snapshot captured for recruiter review", 1, 39, snapshot=rel),
                ev(attempt_id, tenant_id, "fullscreen_exit", "Exited fullscreen mode briefly", 2, 40),
            ]
            risk = RiskScore(attempt_id=attempt_id, tenant_id=tenant_id, overall_score=0.2201,
                             risk_level="low", breakdown={"fullscreen_exit": 0.22},
                             event_counts={"periodic_check": 1, "fullscreen_exit": 1}, total_events=2)
            pdf = asyncio.run(build_pdf(title="Backend Engineer - Real Snapshot Path Proof",
                                        events=events, questions=[], submissions=[], answers={},
                                        risk=risk, candidate_name="Sana Iqbal"))
        finally:
            os.chdir(prev_cwd)
    out = OUTPUT_DIR / "sample_real_snapshot.pdf"
    out.write_bytes(pdf)
    print(f"  real-shape snapshot embedded: {_pdf_has_image(pdf)}")
    return out


def sample_evidence_grid() -> Path:
    """Eight production-shape snapshots (320x240 JPEG, quality 0.7 — the exact
    dimensions/format the browser capture stores) referenced by their real
    `uploads/proctoring/<category>/<file>` DB paths, to exercise the compact
    two-column evidence grid end-to-end and provide a before/after artifact for
    page-count and file-size comparison. Runs inside a throwaway working dir so
    the repository stays clean."""
    prev_cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            tenant_id = uuid4()
            attempt_id = uuid4()
            root = Path(settings.PROCTORING_UPLOAD_ROOT)
            plan = [
                ("periodic", "periodic_check", "Periodic liveness snapshot captured", 1),
                ("violations", "no_face", "No face detected for 2.4 seconds", 2),
                ("periodic", "periodic_check", "Periodic liveness snapshot captured", 1),
                ("violations", "no_face", "No face detected for 3.1 seconds", 2),
                ("violations", "gaze_away", "Sustained head-pitch deviation 4.0 s", 2),
                ("violations", "fullscreen_exit", "Exited fullscreen mode", 2),
                ("violations", "no_face", "No face detected for 2.0 seconds", 2),
                ("violations", "phone_detected", "Hand-held object classified as phone", 3),
            ]
            events = []
            for i, (category, etype, desc, sev) in enumerate(plan):
                cat_dir = root / category
                cat_dir.mkdir(parents=True, exist_ok=True)
                filename = f"{attempt_id}_{uuid4().hex[:8]}.jpg"
                frame = make_synthetic_snapshot(f"{etype} #{i}", size=(320, 240))
                # Save at production shape/quality (320x240 JPEG, q=70).
                PILImage.open(frame).convert("RGB").save(
                    cat_dir / filename, format="JPEG", quality=70
                )
                Path(frame).unlink(missing_ok=True)
                rel = (Path("uploads") / "proctoring" / category / filename).as_posix()
                events.append(ev(attempt_id, tenant_id, etype, desc, sev, 5 + i * 3, snapshot=rel))
            risk = RiskScore(
                attempt_id=attempt_id, tenant_id=tenant_id, overall_score=0.5573,
                risk_level="medium",
                breakdown={"no_face": 0.3, "phone_detected": 0.2, "gaze_away": 0.05},
                event_counts={"periodic_check": 2, "no_face": 3, "gaze_away": 1,
                              "fullscreen_exit": 1, "phone_detected": 1},
                total_events=8,
            )
            pdf = asyncio.run(build_pdf(title="Backend Engineer - Evidence Grid Layout",
                                        events=events, questions=[], submissions=[], answers={},
                                        risk=risk, candidate_name="Grace Okafor"))
        finally:
            os.chdir(prev_cwd)
    out = OUTPUT_DIR / "sample_evidence_grid.pdf"
    out.write_bytes(pdf)
    reader = PdfReader(io.BytesIO(pdf))
    print(f"  evidence grid: {len(reader.pages)} pages, {len(pdf):,} bytes, "
          f"images embedded: {sum(1 for _ in _iter_image_xobjects(reader))}")
    return out


def _iter_image_xobjects(reader):
    for page in reader.pages:
        res = page.get("/Resources")
        res = res.get_object() if res is not None else None
        xo = res.get("/XObject") if res else None
        if xo is None:
            continue
        for ref in xo.get_object().values():
            obj = ref.get_object()
            if obj.get("/Subtype") == "/Image":
                yield obj


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for path in (sample_normal(), sample_long_text(), sample_missing_snapshots(),
                 sample_real_snapshot(), sample_evidence_grid()):
        print(f"wrote {path.resolve()}  ({path.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
