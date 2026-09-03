"""
Answer service — save, retrieve, and auto-grade candidate answers.
Phase 11: Uses the ExamAttempt.answers JSON column (no new table).

Auto-grading logic:
- MCQ: compare selected_option_ids[0] with question.correct_answer
- multi_select: compare sorted sets
- true_false: compare selected_option_ids[0] with correct_answer
- code: graded synchronously via Judge0 during submit_attempt

Grading contract:
  ExamAttempt.answers[qid]["text_answer"] is the authoritative final source code.
  CodeSubmission records are created/updated to persist diagnostics.
  Judge0 status codes are mapped accurately (never masking runtime errors as wrong_answer).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.core.exceptions import AttemptNotFound, AttemptAlreadySubmitted, BadRequest
from app.models.attempt import ExamAttempt
from app.models.code_submission import CodeSubmission, SubmissionStatus
from app.models.question import Question
from app.schemas.answer import AnswerSubmit, AnswerRead, AnswersResponse
from app.services import code_execution_service


async def save_answers(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
    answers: list[AnswerSubmit],
) -> dict:
    """
    Upsert answers into the ExamAttempt.answers JSON column.
    Merges with any previously saved answers (auto-save friendly).
    """
    attempt = await _get_own_attempt(db, attempt_id, candidate_id, tenant_id)

    if attempt.status != "started":
        raise AttemptAlreadySubmitted()

    now = datetime.now(timezone.utc)
    if attempt.attempt_end_time and now > attempt.attempt_end_time:
        attempt.status = "submitted"
        attempt.submitted_at = now
        await auto_grade(db, attempt, tenant_id)
        await db.flush()
        raise BadRequest("Attempt duration expired")

    # Merge with existing answers (preserve existing grading fields on upsert)
    existing: dict[str, Any] = attempt.answers or {}
    for ans in answers:
        qid = str(ans.question_id)
        current = existing.get(qid, {})
        update: dict[str, Any] = {
            "question_id": qid,
            "selected_option_ids": ans.selected_option_ids,
            "text_answer": ans.text_answer,
        }
        # Persist language_id for coding questions if provided
        if ans.language_id is not None:
            update["language_id"] = ans.language_id
        elif current.get("language_id") is not None:
            update["language_id"] = current["language_id"]
        # Preserve grading fields from a prior auto-grade run
        for field in ("is_correct", "points_earned"):
            if current.get(field) is not None:
                update[field] = current[field]
        existing[qid] = update

    attempt.answers = existing
    flag_modified(attempt, "answers")
    await db.flush()

    return {"saved": len(answers), "total": len(existing)}


async def get_answers(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> AnswersResponse:
    """Retrieve saved answers for an attempt (with grading results if available)."""
    result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise AttemptNotFound()

    return await _build_answers_response(db, attempt, tenant_id)


async def get_answers_for_candidate(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> AnswersResponse:
    """Retrieve answers for a candidate-owned attempt only."""
    attempt = await _get_own_attempt(db, attempt_id, candidate_id, tenant_id)

    return await _build_answers_response(db, attempt, tenant_id)


async def _build_answers_response(
    db: AsyncSession,
    attempt: ExamAttempt,
    tenant_id: uuid.UUID,
) -> AnswersResponse:
    """Build a normalized answers response for an attempt."""

    raw: dict[str, Any] = attempt.answers or {}
    answer_list = [
        AnswerRead(
            question_id=uuid.UUID(v["question_id"]),
            selected_option_ids=v.get("selected_option_ids"),
            text_answer=v.get("text_answer"),
            is_correct=v.get("is_correct"),
            points_earned=v.get("points_earned"),
        )
        for v in raw.values()
    ]

    total_score = None
    max_score = None
    if any(a.points_earned is not None for a in answer_list):
        total_score = sum(a.points_earned or 0 for a in answer_list)
        # Fetch max_score from questions
        q_result = await db.execute(
            select(Question).where(
                Question.exam_id == attempt.exam_id,
                Question.tenant_id == tenant_id,
                Question.is_active == True,  # noqa: E712
            )
        )
        questions = list(q_result.scalars().all())
        max_score = sum(q.points for q in questions)

    return AnswersResponse(
        attempt_id=attempt.id,
        answers=answer_list,
        total_score=total_score,
        max_score=max_score,
    )


async def auto_grade(
    db: AsyncSession,
    attempt: ExamAttempt,
    tenant_id: uuid.UUID,
) -> int:
    """
    Auto-grade MCQ, multi_select, true_false, and code answers.
    Updates the answers JSON with is_correct and points_earned.
    Returns total score.
    """
    raw: dict[str, Any] = attempt.answers or {}
    if not raw:
        return 0

    # Load questions for this exam
    q_result = await db.execute(
        select(Question).where(
            Question.exam_id == attempt.exam_id,
            Question.tenant_id == tenant_id,
            Question.is_active == True,  # noqa: E712
        )
    )
    questions = {str(q.id): q for q in q_result.scalars().all()}

    total_score = 0

    for qid, ans_data in raw.items():
        question = questions.get(qid)
        if question is None:
            continue

        correct_answer = question.correct_answer
        q_type = question.question_type
        selected = (
            ans_data.get("selected_option_ids")
            or ans_data.get("selected_options")
            or ans_data.get("selected_option")
            or []
        )
        if isinstance(selected, str):
            selected = [selected]

        is_correct = None
        points = 0

        if q_type == "mcq":
            # correct_answer is typically "A" or a string label
            if correct_answer is not None and len(selected) == 1:
                expected = str(correct_answer).upper().strip('"')
                actual = str(selected[0]).upper().strip('"')
                is_correct = actual == expected
                points = question.points if is_correct else 0

        elif q_type == "true_false":
            if correct_answer is not None and len(selected) == 1:
                # Handle both "A"/"B" style and "true"/"false" style
                expected = str(correct_answer).upper().strip('"')
                actual = str(selected[0]).upper().strip('"')
                is_correct = actual == expected
                points = question.points if is_correct else 0

        elif q_type == "multi_select":
            if correct_answer is not None:
                # correct_answer is a list like ["A", "B"]
                expected = sorted(str(c) for c in correct_answer)
                actual = sorted(str(s) for s in selected)
                is_correct = expected == actual
                points = question.points if is_correct else 0

        elif q_type == "code":
            # Grade code question using seeded test cases
            is_correct, points = await grade_code_question(db, attempt, question, tenant_id)

        ans_data["is_correct"] = is_correct
        ans_data["points_earned"] = points
        total_score += points

    attempt.answers = raw
    flag_modified(attempt, "answers")
    await db.flush()

    return total_score


# ── Internal helpers ────────────────────────────────────────────


def _normalize_output(text: str | None) -> str:
    """
    Normalize code execution output for robust comparison.

    - Converts CRLF (\r\n) and bare CR (\r) to LF (\n).
    - Strips trailing whitespace from every line.
    - Strips outer leading/trailing whitespace from the result.

    This ensures outputs like "30\r\n" and "30\n" and "30  " all compare equal.
    """
    if not text:
        return ""
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.split("\n")]
    return "\n".join(lines).strip()


async def _canonicalize_stdout_to_bool(stdout: str) -> bool | None:
    """Convert trimmed, lowercased stdout to bool if it looks like a boolean."""
    val = stdout.strip().lower()
    if val in {"true", "1", "yes", "t"}:
        return True
    if val in {"false", "0", "no", "f"}:
        return False
    return None


async def grade_code_question(
    db: AsyncSession,
    attempt: ExamAttempt,
    question: Question,
    tenant_id: uuid.UUID,
) -> tuple[bool | None, int]:
    """
    Grade a single code question for an attempt using seeded test_cases.

    Authoritative code source priority:
      1. ExamAttempt.answers[qid]["text_answer"]  (the final submitted code)
      2. latest CodeSubmission.source_code         (fallback for backwards compat)
      3. Neither present -> return (None, 0)

    Judge0 status mapping (no exceptions become "wrong_answer"):
      id 3  -> accepted execution (compare stdout with expected)
      id 5  -> time_limit_exceeded (stop, record failure)
      id 6  -> compilation_error   (stop, preserve compile_output)
      id>=7 -> runtime_error        (stop, preserve stderr)
      stdout differs -> wrong_answer

    Returns (is_correct, points_earned). Updates CodeSubmission and attempt.answers.
    """
    correct_answer = question.correct_answer or {}
    test_cases = correct_answer.get("test_cases") or []
    if not test_cases:
        return None, 0

    # ── 1. Resolve authoritative source code ─────────────────────
    raw_answers: dict[str, Any] = attempt.answers or {}
    ans_key = str(question.id)
    ans_entry: dict[str, Any] = raw_answers.get(ans_key) or {}

    source_code: str | None = ans_entry.get("text_answer") or None

    # Fetch latest CodeSubmission (needed for persistence record)
    subs_result = await db.execute(
        select(CodeSubmission)
        .where(
            CodeSubmission.attempt_id == attempt.id,
            CodeSubmission.question_id == question.id,
            CodeSubmission.tenant_id == tenant_id,
        )
        .order_by(CodeSubmission.created_at.desc())
    )
    latest_sub = subs_result.scalars().first()

    # Fallback: if answers has no code, try old code submission record
    if not source_code and latest_sub:
        source_code = latest_sub.source_code or None

    if not source_code:
        # Nothing to grade
        return None, 0

    # ── 2. Resolve language_id ────────────────────────────────────
    language_id: int = (
        ans_entry.get("language_id")
        or (latest_sub.language_id if latest_sub else None)
        or 71  # default Python 3.8.1
    )

    # ── 3. Guarantee a CodeSubmission record exists ───────────────
    if latest_sub is None:
        # Create a fresh submission record to hold final diagnostics
        from app.services.code_execution_service import _get_language_name
        try:
            language_name = await _get_language_name(language_id)
        except Exception:
            language_name = f"language_{language_id}"
        latest_sub = CodeSubmission(
            attempt_id=attempt.id,
            question_id=question.id,
            tenant_id=tenant_id,
            language_id=language_id,
            language_name=language_name,
            source_code=source_code,
            status=SubmissionStatus.QUEUED.value,
        )
        db.add(latest_sub)
        await db.flush()  # assign PK
    else:
        # Always update source_code to the authoritative final version
        latest_sub.source_code = source_code
        latest_sub.language_id = language_id

    # ── 4. Execute each test case ─────────────────────────────────
    total_cases = len(test_cases)
    passed = 0

    # Track aggregate diagnostics from the run
    overall_status = SubmissionStatus.ACCEPTED.value  # optimistic
    last_stdout: str | None = None
    last_stderr: str | None = None
    last_compile_output: str | None = None
    last_time: float | None = None
    last_memory: int | None = None
    last_exit: int | None = None

    for tc in test_cases:
        stdin = tc.get("input", "")
        expected = tc.get("expected")

        resp = await code_execution_service._execute_single_test_case(
            source_code, language_id, stdin
        )

        status_id: int = resp.get("status", {}).get("id", 0)
        stdout_raw: str | None = resp.get("stdout")
        stderr_raw: str | None = resp.get("stderr")
        compile_raw: str | None = resp.get("compile_output")

        # Capture execution metrics from the last test case run
        last_stdout = stdout_raw
        last_stderr = stderr_raw
        last_compile_output = compile_raw
        last_time = _safe_float(resp.get("time"))
        last_memory = _safe_int(resp.get("memory"))
        last_exit = resp.get("exit_code")

        if status_id == 6:
            # Compilation Error — stop immediately, no partial credit
            overall_status = SubmissionStatus.COMPILATION_ERROR.value
            break

        if status_id == 5:
            # Time Limit Exceeded
            overall_status = SubmissionStatus.TIME_LIMIT_EXCEEDED.value
            break

        if status_id >= 7 or (status_id not in (0, 1, 2, 3)):
            # Runtime Error (NZEC, SIGFPE, etc.)
            overall_status = SubmissionStatus.RUNTIME_ERROR.value
            break

        if status_id == 3:
            # Execution accepted — compare output
            stdout_trunc = (stdout_raw or "")
            if len(stdout_trunc) > 10_000:
                stdout_trunc = stdout_trunc[:10_000]

            if isinstance(expected, bool):
                got = await _canonicalize_stdout_to_bool(stdout_trunc)
                case_passed = (got == expected)
            else:
                case_passed = (
                    _normalize_output(stdout_trunc)
                    == _normalize_output(str(expected))
                )

            if case_passed:
                passed += 1
            else:
                # Mark as wrong_answer unless a more critical status already set
                if overall_status == SubmissionStatus.ACCEPTED.value:
                    overall_status = SubmissionStatus.WRONG_ANSWER.value
        # status 0/1/2 are non-terminal; treat as runtime error
        elif status_id in (0, 1, 2):
            overall_status = SubmissionStatus.RUNTIME_ERROR.value
            break

    # ── 5. Compute final score and status ────────────────────────
    points_earned = round(question.points * passed / total_cases) if total_cases else 0
    is_correct = (passed == total_cases) and total_cases > 0

    if is_correct:
        overall_status = SubmissionStatus.ACCEPTED.value

    # ── 6. Persist diagnostics on the CodeSubmission record ───────
    latest_sub.source_code = source_code
    latest_sub.status = overall_status
    latest_sub.stdout = last_stdout
    latest_sub.stderr = last_stderr
    latest_sub.compile_output = last_compile_output
    latest_sub.time_sec = last_time
    latest_sub.memory_kb = last_memory
    latest_sub.exit_code = last_exit

    # ── 7. Update attempt answers JSON ───────────────────────────
    raw_answers[ans_key] = {
        **ans_entry,
        "question_id": ans_key,
        "text_answer": source_code,
        "language_id": language_id,
        "is_correct": is_correct,
        "points_earned": points_earned,
    }
    attempt.answers = raw_answers
    flag_modified(attempt, "answers")

    await db.flush()
    return is_correct, points_earned


def _safe_float(val: Any) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val: Any) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


async def _get_own_attempt(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ExamAttempt:
    """Get an attempt that belongs to the given candidate."""
    result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.candidate_id == candidate_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise AttemptNotFound()
    return attempt
