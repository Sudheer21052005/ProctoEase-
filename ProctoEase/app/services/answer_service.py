"""
Answer service — save, retrieve, and auto-grade candidate answers.
Phase 11: Uses the ExamAttempt.answers JSON column (no new table).

Auto-grading logic:
- MCQ: compare selected_option_ids[0] with question.correct_answer
- multi_select: compare sorted sets
- true_false: compare selected_option_ids[0] with correct_answer
- code: graded asynchronously by Judge0 (not handled here)
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
from app.models.question import Question
from app.schemas.answer import AnswerSubmit, AnswerRead, AnswersResponse


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

    # Merge with existing answers
    existing: dict[str, Any] = attempt.answers or {}
    for ans in answers:
        existing[str(ans.question_id)] = {
            "question_id": str(ans.question_id),
            "selected_option_ids": ans.selected_option_ids,
            "text_answer": ans.text_answer,
        }

    attempt.answers = existing
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
    Auto-grade MCQ, multi_select, and true_false answers.
    Updates the answers JSON with is_correct and points_earned.
    Returns total score.

    Code questions are graded asynchronously by Judge0 and not handled here.
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

        ans_data["is_correct"] = is_correct
        ans_data["points_earned"] = points
        total_score += points

    attempt.answers = raw
    flag_modified(attempt, "answers")
    await db.flush()

    return total_score


# ── Internal helpers ────────────────────────────────────────────


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
