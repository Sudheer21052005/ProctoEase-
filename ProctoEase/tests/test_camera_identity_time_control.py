import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.core.exceptions import BadRequest
from app.schemas.exam import ExamCreate, ExamUpdate
from app.services import answer_service, exam_service, proctoring_image_service, attempt_service


class DummyUser:
    def __init__(self):
        self.id = uuid.uuid4()
        self.tenant_id = uuid.uuid4()


class DummyDb:
    def add(self, _obj):
        return None

    async def execute(self, _query):
        class Result:
            @staticmethod
            def scalar_one_or_none():
                return None

        return Result()

    async def flush(self):
        return None


def _small_jpeg_data_url() -> str:
    # Minimal valid JPEG bytes with SOI/EOI markers
    payload = b"\xff\xd8\xff\xd9"
    import base64

    return "data:image/jpeg;base64," + base64.b64encode(payload).decode("ascii")


def test_snapshot_decode_and_validate_success():
    raw, ext = proctoring_image_service.decode_and_validate_image(_small_jpeg_data_url())
    assert ext == "jpg"
    assert raw.startswith(b"\xff\xd8")


def test_snapshot_decode_invalid_type_rejected():
    with pytest.raises(BadRequest):
        proctoring_image_service.decode_and_validate_image("data:image/gif;base64,R0lGODdh")


def test_snapshot_persist_storage(tmp_path, monkeypatch):
    monkeypatch.setattr(
        proctoring_image_service.settings,
        "PROCTORING_UPLOAD_ROOT",
        str(tmp_path / "uploads" / "proctoring"),
    )

    rel_path = proctoring_image_service.save_from_data_url(
        uuid.uuid4(),
        _small_jpeg_data_url(),
        "violations",
    )

    assert rel_path.startswith("uploads/proctoring/violations/")
    assert (tmp_path / rel_path).exists()


@pytest.mark.asyncio
async def test_start_attempt_requires_verification_image(monkeypatch):
    class ExamObj:
        is_published = True
        start_time = None
        end_time = None
        duration_minutes = 30

    async def fake_get_exam(db, exam_id, tenant_id):
        return ExamObj()

    monkeypatch.setattr(attempt_service, "get_exam", fake_get_exam)

    with pytest.raises(BadRequest) as exc:
        await attempt_service.create_attempt(
            DummyDb(),
            uuid.uuid4(),
            uuid.uuid4(),
            uuid.uuid4(),
            verification_image_base64=None,
        )

    assert "verification image is required" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_expired_attempt_blocks_answer_save_and_auto_submits(monkeypatch):
    class ExpiredAttempt:
        def __init__(self):
            self.status = "started"
            self.attempt_end_time = datetime.now(timezone.utc) - timedelta(seconds=5)
            self.submitted_at = None
            self.answers = {}

    expired = ExpiredAttempt()

    async def fake_get_own_attempt(db, attempt_id, candidate_id, tenant_id):
        return expired

    async def fake_auto_grade(db, attempt, tenant_id):
        return 0

    monkeypatch.setattr(answer_service, "_get_own_attempt", fake_get_own_attempt)
    monkeypatch.setattr(answer_service, "auto_grade", fake_auto_grade)

    with pytest.raises(BadRequest) as exc:
        await answer_service.save_answers(
            DummyDb(),
            uuid.uuid4(),
            uuid.uuid4(),
            uuid.uuid4(),
            [],
        )

    assert "duration expired" in str(exc.value).lower()
    assert expired.status == "submitted"
    assert expired.submitted_at is not None


@pytest.mark.asyncio
async def test_exam_create_rejects_invalid_time_window():
    start = datetime.now(timezone.utc)
    with pytest.raises(BadRequest):
        await exam_service.create_exam(
            DummyDb(),
            ExamCreate(
                title="Window test",
                duration_minutes=60,
                start_time=start,
                end_time=start - timedelta(minutes=1),
            ),
            uuid.uuid4(),
            uuid.uuid4(),
        )


@pytest.mark.asyncio
async def test_exam_update_rejects_invalid_time_window(monkeypatch):
    start = datetime.now(timezone.utc)

    class ExamObj:
        start_time = start
        end_time = start + timedelta(hours=1)

    async def fake_get_exam(db, exam_id, tenant_id):
        return ExamObj()

    monkeypatch.setattr(exam_service, "get_exam", fake_get_exam)

    with pytest.raises(BadRequest):
        await exam_service.update_exam(
            DummyDb(),
            uuid.uuid4(),
            uuid.uuid4(),
            ExamUpdate(start_time=start, end_time=start - timedelta(minutes=1)),
        )
