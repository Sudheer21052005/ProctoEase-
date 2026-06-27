import pytest

from app.core.exceptions import BadRequest
from app.services import exam_ingestion_service


def test_ingest_json_payload_success():
    payload = {
        "title": "Imported Exam",
        "description": "JSON import",
        "duration_minutes": 75,
        "is_published": False,
        "questions": [
            {
                "type": "mcq",
                "question": "What is 2 + 2?",
                "options": ["1", "2", "4", "5"],
                "correct_answer": "C",
                "points": 2,
            },
            {
                "type": "code",
                "question": "Write add(a,b)",
                "points": 5,
                "test_cases": [{"input": "1 2", "expected": "3"}],
            },
        ],
    }

    result = exam_ingestion_service.ingest_from_json_payload(payload)

    assert result.exam.title == "Imported Exam"
    assert len(result.questions) == 2
    assert result.questions[0].question_type == "mcq"
    assert result.questions[1].question_type == "code"


def test_ingest_json_payload_invalid_shape_raises_bad_request():
    payload = {
        "title": "Broken Exam",
        "duration_minutes": 60,
        "is_published": False,
        "questions": [
            {
                "type": "mcq",
                "question": "Missing options and answer",
                "points": 1,
            }
        ],
    }

    with pytest.raises(BadRequest) as exc:
        exam_ingestion_service.ingest_from_json_payload(payload)

    assert "Invalid JSON exam format" in str(exc.value)


def test_ingest_pdf_bytes_success_with_monkeypatched_extractor(monkeypatch):
    pdf_text = """
    Title: PDF Imported Exam
    Description: Parsed from PDF
    Duration: 45

    Q1:
    Type: mcq
    Question: Which hook stores local state in React?
    Options:
    A) useEffect
    B) useState
    C) useMemo
    D) useRef
    Correct: B
    Points: 2

    Q2:
    Type: code
    Question: Write a function that returns sum of two numbers.
    Test Cases:
    - input: 1 2
    expected: 3
    - input: 5 7
    expected: 12
    Points: 5
    """

    monkeypatch.setattr(exam_ingestion_service, "_extract_pdf_text", lambda _b: pdf_text)

    result = exam_ingestion_service.ingest_from_pdf_bytes(
        b"%PDF-1.4 fake",
        content_type="application/pdf",
    )

    assert result.exam.title == "PDF Imported Exam"
    assert len(result.questions) == 2
    assert result.questions[1].question_type == "code"


def test_ingest_pdf_rejects_partial_parsing(monkeypatch):
    pdf_text = """
    Title: Partial PDF Exam

    Q1:
    Type: mcq
    Question: Valid question?
    Options:
    A) Yes
    B) No
    Correct: A

    Q2:
    Type: mcq
    Question: Broken question without correct answer
    Options:
    A) One
    B) Two
    """

    monkeypatch.setattr(exam_ingestion_service, "_extract_pdf_text", lambda _b: pdf_text)

    with pytest.raises(BadRequest) as exc:
        exam_ingestion_service.ingest_from_pdf_bytes(
            b"%PDF-1.4 fake",
            content_type="application/pdf",
        )

    assert "Partial parsing is rejected" in str(exc.value)
