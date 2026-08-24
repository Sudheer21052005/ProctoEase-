"""Exam ingestion service for manual/pdf/json creation modes."""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import Any

import pdfplumber
from pydantic import ValidationError

from app.core.exceptions import BadRequest
from app.schemas.exam import ExamCreate
from app.schemas.exam_ingestion import (
    ExamCreationMode,
    ExamIngestionPreview,
    IngestExamPayload,
    IngestionQuestionPreview,
)
from app.schemas.question import QuestionCreate

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_PDF_MIME_TYPES = {"application/pdf", "application/x-pdf"}
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")


@dataclass
class IngestionResult:
    mode: ExamCreationMode
    exam: ExamCreate
    questions: list[QuestionCreate]

    def to_preview(self) -> ExamIngestionPreview:
        return ExamIngestionPreview(
            title=self.exam.title,
            description=self.exam.description,
            duration_minutes=self.exam.duration_minutes,
            is_published=self.exam.is_published,
            question_count=len(self.questions),
            questions=[
                IngestionQuestionPreview(
                    question_text=q.question_text,
                    question_type=q.question_type,
                    points=q.points,
                    options_count=len(q.options or []),
                )
                for q in self.questions
            ],
        )


def ingest_from_json_payload(payload_data: dict[str, Any]) -> IngestionResult:
    """Validate and normalize JSON payload into exam/question DTOs."""
    try:
        payload = IngestExamPayload.model_validate(payload_data)
    except ValidationError as exc:
        raise BadRequest(f"Invalid JSON exam format: {exc}") from exc

    return _to_internal(ExamCreationMode.JSON, payload)


def ingest_from_pdf_bytes(
    file_bytes: bytes,
    *,
    content_type: str | None,
) -> IngestionResult:
    """Parse PDF text, validate extracted content, and normalize it."""
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise BadRequest("Uploaded file exceeds 5MB limit")

    if content_type and content_type.lower() not in ALLOWED_PDF_MIME_TYPES:
        raise BadRequest("Invalid file type. Only PDF uploads are allowed")

    raw_text = _extract_pdf_text(file_bytes)
    payload_dict = _parse_exam_text(raw_text)

    try:
        payload = IngestExamPayload.model_validate(payload_dict)
    except ValidationError as exc:
        raise BadRequest(f"Invalid PDF content format: {exc}") from exc

    return _to_internal(ExamCreationMode.PDF, payload)


def _to_internal(mode: ExamCreationMode, payload: IngestExamPayload) -> IngestionResult:
    exam_payload = ExamCreate(
        title=_sanitize(payload.title),
        description=_sanitize(payload.description) if payload.description else None,
        duration_minutes=payload.duration_minutes,
        is_published=payload.is_published,
    )

    questions: list[QuestionCreate] = []
    for idx, q in enumerate(payload.questions):
        options = _normalize_options(q.options, q.type)
        correct = _normalize_correct_answer(q)
        questions.append(
            QuestionCreate(
                question_text=_sanitize(q.question),
                question_type=q.type,
                options=options,
                correct_answer=correct,
                points=q.points,
                order_index=idx,
            )
        )

    return IngestionResult(mode=mode, exam=exam_payload, questions=questions)


def _normalize_options(options: list[str] | None, q_type: str) -> list[dict[str, str]] | None:
    if q_type in {"mcq", "multi_select"}:
        normalized: list[dict[str, str]] = []
        for i, text in enumerate(options or []):
            label = chr(ord("A") + i)
            normalized.append({"label": label, "text": _sanitize(text)})
        return normalized

    if q_type == "true_false":
        return [{"label": "A", "text": "True"}, {"label": "B", "text": "False"}]

    return None


def _normalize_correct_answer(question) -> Any:
    if question.type == "code":
        test_cases = [tc.model_dump() for tc in (question.test_cases or [])]
        if test_cases:
            return {"test_cases": test_cases}
        return None

    return question.correct_answer


def _extract_pdf_text(file_bytes: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            pages = [(page.extract_text() or "") for page in pdf.pages]
        text = "\n".join(pages)
    except Exception as exc:
        raise BadRequest(f"Invalid PDF. Unable to parse content: {exc}") from exc

    text = _sanitize_multiline(text)
    if not text.strip():
        raise BadRequest("Invalid PDF. No readable text content found")
    return text


def _parse_exam_text(text: str) -> dict[str, Any]:
    """Heuristic parser for template-like PDF text.

    Expected markers (case-insensitive):
      Title: ...
      Description: ...
      Duration: 60
      Q1:
      Type: mcq|multi_select|true_false|code
      Question: ...
      Options:
      A) ...
      B) ...
      Correct: A
      Points: 2
      Test Cases:
      - input: ...
        expected: ...
    """
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    title = "Imported Exam"
    description = None
    duration = 60

    for line in lines:
        lower = line.lower()
        if lower.startswith("title:"):
            title = _sanitize(line.split(":", 1)[1].strip())
        elif lower.startswith("description:"):
            description = _sanitize(line.split(":", 1)[1].strip())
        elif lower.startswith("duration:"):
            found = re.search(r"\d+", line)
            if found:
                duration = int(found.group(0))

    question_starts = [i for i, ln in enumerate(lines) if re.match(r"^q(?:uestion)?\s*\d+[:.-]?$", ln, flags=re.IGNORECASE)]
    if not question_starts:
        question_starts = [i for i, ln in enumerate(lines) if ln.lower().startswith("question:")]

    if not question_starts:
        raise BadRequest("Invalid PDF format: no question blocks were detected")

    blocks: list[list[str]] = []
    for idx, start in enumerate(question_starts):
        end = question_starts[idx + 1] if idx + 1 < len(question_starts) else len(lines)
        blocks.append(lines[start:end])

    parsed_questions: list[dict[str, Any]] = []
    errors: list[str] = []

    for i, block in enumerate(blocks, start=1):
        parsed, err = _parse_question_block(block)
        if err:
            errors.append(f"Q{i}: {err}")
            continue
        parsed_questions.append(parsed)

    if errors:
        raise BadRequest(
            "PDF parsing failed. Partial parsing is rejected. "
            + "; ".join(errors)
        )

    return {
        "title": title,
        "description": description,
        "duration_minutes": duration,
        "is_published": False,
        "questions": parsed_questions,
    }


def _parse_question_block(lines: list[str]) -> tuple[dict[str, Any] | None, str | None]:
    q_type = "mcq"
    question_text = ""
    points = 1
    options: list[str] = []
    correct_answer: Any = None
    test_cases: list[dict[str, str]] = []

    in_options = False
    in_tests = False

    for line in lines:
        lower = line.lower()

        if re.match(r"^q(?:uestion)?\s*\d+[:.-]?$", line, flags=re.IGNORECASE):
            continue

        if lower.startswith("type:"):
            q_type = _sanitize(line.split(":", 1)[1].strip().lower())
            in_options = False
            in_tests = False
            continue

        if lower.startswith("question:"):
            question_text = _sanitize(line.split(":", 1)[1].strip())
            in_options = False
            in_tests = False
            continue

        if lower.startswith("options:"):
            in_options = True
            in_tests = False
            continue

        if lower.startswith("test cases:"):
            in_tests = True
            in_options = False
            continue

        if lower.startswith("correct:"):
            raw = line.split(":", 1)[1].strip()
            correct_answer = _coerce_answer(raw, q_type)
            in_options = False
            in_tests = False
            continue

        if lower.startswith("points:"):
            found = re.search(r"\d+", line)
            if found:
                points = int(found.group(0))
            in_options = False
            in_tests = False
            continue

        if in_options:
            match = re.match(r"^(?:[A-Z][).:-]\s*)?(.+)$", line)
            if match:
                options.append(_sanitize(match.group(1)))
            continue

        if in_tests and lower.startswith("- input:"):
            inp = _sanitize(line.split(":", 1)[1].strip())
            test_cases.append({"input": inp, "expected": ""})
            continue

        if in_tests and lower.startswith("expected:"):
            if not test_cases:
                return None, "expected value found before input"
            test_cases[-1]["expected"] = _sanitize(line.split(":", 1)[1].strip())
            continue

    if q_type not in {"mcq", "multi_select", "true_false", "code"}:
        return None, f"unsupported question type '{q_type}'"

    if len(question_text) < 3:
        return None, "missing or invalid question text"

    question: dict[str, Any] = {
        "type": q_type,
        "question": question_text,
        "points": points,
    }

    if q_type in {"mcq", "multi_select"}:
        if len(options) < 2:
            return None, "mcq/multi_select requires at least 2 options"
        if correct_answer is None:
            return None, "mcq/multi_select requires a correct answer"
        question["options"] = options
        question["correct_answer"] = correct_answer
    elif q_type == "true_false":
        if correct_answer is None:
            return None, "true_false requires a correct answer"
        question["correct_answer"] = bool(correct_answer)
    elif q_type == "code":
        if test_cases:
            missing_expected = [tc for tc in test_cases if not tc.get("expected")]
            if missing_expected:
                return None, "all code test cases must include expected output"
            question["test_cases"] = test_cases

    return question, None


def _coerce_answer(raw: str, q_type: str) -> Any:
    clean = _sanitize(raw)
    if q_type == "multi_select":
        parts = [p.strip().upper() for p in re.split(r"[,;]", clean) if p.strip()]
        return parts
    if q_type == "true_false":
        return clean.lower() in {"true", "t", "1", "yes"}
    return clean


def _sanitize(value: str | None) -> str:
    if not value:
        return ""
    cleaned = _CONTROL_CHARS.sub(" ", value)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:10_000]


def _sanitize_multiline(value: str | None) -> str:
    if not value:
        return ""

    cleaned = _CONTROL_CHARS.sub(" ", value)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in cleaned.split("\n")]
    lines = [ln for ln in lines if ln]
    return "\n".join(lines)[:10_000]
