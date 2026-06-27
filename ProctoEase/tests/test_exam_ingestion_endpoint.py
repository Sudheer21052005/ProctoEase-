import json
import uuid
from datetime import datetime, timezone

import pytest
from starlette.requests import Request

from app.api.v1 import exams
from app.schemas.exam import ExamCreate
from app.schemas.exam_ingestion import ExamCreationMode
from app.schemas.question import QuestionCreate
from app.services.exam_ingestion_service import IngestionResult


class DummyUser:
    def __init__(self):
        self.id = uuid.uuid4()
        self.tenant_id = uuid.uuid4()


class DummyDb:
    pass


def _build_json_request(payload: dict) -> Request:
    body = json.dumps(payload).encode("utf-8")

    async def receive():
        return {"type": "http.request", "body": body, "more_body": False}

    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/exams/create",
        "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode("ascii")),
        ],
    }
    return Request(scope, receive)


@pytest.mark.asyncio
async def test_ingestion_endpoint_preview_only(monkeypatch):
    result = IngestionResult(
        mode=ExamCreationMode.JSON,
        exam=ExamCreate(
            title="Preview Exam",
            description="only preview",
            duration_minutes=60,
            is_published=False,
        ),
        questions=[
            QuestionCreate(
                question_text="What is React?",
                question_type="short_answer",
                options=None,
                correct_answer=None,
                points=2,
                order_index=0,
            )
        ],
    )

    monkeypatch.setattr(exams.exam_ingestion_service, "ingest_from_json_payload", lambda _p: result)

    request = _build_json_request(
        {
            "mode": "json",
            "preview_only": True,
            "payload": {
                "title": "Preview Exam",
                "duration_minutes": 60,
                "is_published": False,
                "questions": [
                    {
                        "type": "short_answer",
                        "question": "What is React?",
                        "points": 2,
                    }
                ],
            },
        }
    )

    response = await exams.create_exam_via_ingestion(request, DummyUser(), DummyDb())

    assert response.created is False
    assert response.exam is None
    assert response.preview.question_count == 1


@pytest.mark.asyncio
async def test_ingestion_endpoint_creates_exam(monkeypatch):
    result = IngestionResult(
        mode=ExamCreationMode.JSON,
        exam=ExamCreate(
            title="Created Exam",
            description="created from JSON",
            duration_minutes=90,
            is_published=True,
        ),
        questions=[
            QuestionCreate(
                question_text="2 + 2?",
                question_type="mcq",
                options=[{"label": "A", "text": "4"}, {"label": "B", "text": "5"}],
                correct_answer="A",
                points=1,
                order_index=0,
            )
        ],
    )

    class CreatedExam:
        id = uuid.uuid4()
        title = "Created Exam"
        description = "created from JSON"
        duration_minutes = 90
        is_published = True
        is_active = True
        created_by = uuid.uuid4()
        tenant_id = uuid.uuid4()
        created_at = datetime.now(timezone.utc)

    captured = {"questions": 0}

    async def fake_create_exam(db, payload, tenant_id, created_by):
        return CreatedExam()

    async def fake_create_question(db, exam_id, tenant_id, payload):
        captured["questions"] += 1

    monkeypatch.setattr(exams.exam_ingestion_service, "ingest_from_json_payload", lambda _p: result)
    monkeypatch.setattr(exams.exam_service, "create_exam", fake_create_exam)
    monkeypatch.setattr(exams.question_service, "create_question", fake_create_question)

    request = _build_json_request(
        {
            "mode": "json",
            "preview_only": False,
            "payload": {
                "title": "Created Exam",
                "duration_minutes": 90,
                "is_published": True,
                "questions": [
                    {
                        "type": "mcq",
                        "question": "2 + 2?",
                        "options": ["4", "5"],
                        "correct_answer": "A",
                        "points": 1,
                    }
                ],
            },
        }
    )

    response = await exams.create_exam_via_ingestion(request, DummyUser(), DummyDb())

    assert response.created is True
    assert response.exam is not None
    assert response.exam.title == "Created Exam"
    assert captured["questions"] == 1
