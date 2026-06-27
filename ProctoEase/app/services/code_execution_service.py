"""
Code execution service — submits code to Judge0 and stores results.
Phase 6: Judge0 Code Execution.
"""

from __future__ import annotations

import logging
import uuid

import httpx
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import (
    Judge0Unavailable, SubmissionNotFound, ExamNotFound, Forbidden,
)
from app.models.code_submission import (
    CodeSubmission, SubmissionStatus, JUDGE0_STATUS_MAP,
)
from app.models.attempt import ExamAttempt
from app.models.user import UserRole
from app.schemas.code_submission import CodeSubmit

logger = logging.getLogger("proctoease.code")

# Timeout for Judge0 HTTP calls
_JUDGE0_TIMEOUT = 15.0


async def _judge0_post(path: str, json_body: dict) -> dict:
    """POST to Judge0 API. Raises Judge0Unavailable on failure."""
    url = f"{settings.JUDGE0_API_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=_JUDGE0_TIMEOUT) as client:
            resp = await client.post(url, json=json_body)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, httpx.ConnectError) as exc:
        logger.error("Judge0 POST %s failed: %s", path, exc)
        raise Judge0Unavailable()


async def _judge0_get(path: str) -> dict:
    """GET from Judge0 API. Raises Judge0Unavailable on failure."""
    url = f"{settings.JUDGE0_API_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=_JUDGE0_TIMEOUT) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, httpx.ConnectError) as exc:
        logger.error("Judge0 GET %s failed: %s", path, exc)
        raise Judge0Unavailable()


# ── Public API ───────────────────────────────────────────────────


async def submit_code(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
    payload: CodeSubmit,
) -> CodeSubmission:
    """Submit code to Judge0 and create a local record."""

    # Verify the attempt belongs to this tenant
    result = await db.execute(
        select(ExamAttempt).where(
            and_(
                ExamAttempt.id == attempt_id,
                ExamAttempt.tenant_id == tenant_id,
                ExamAttempt.is_active == True,  # noqa: E712
            )
        )
    )
    attempt = result.scalar_one_or_none()
    if attempt is None:
        raise ExamNotFound("Attempt not found")

    # Resolve language name from Judge0
    language_name = await _get_language_name(payload.language_id)

    # Submit to Judge0
    judge0_resp = await _judge0_post(
        "/submissions?base64_encoded=false&wait=false",
        {
            "source_code": payload.source_code,
            "language_id": payload.language_id,
            "stdin": payload.stdin or "",
        },
    )
    judge0_token = judge0_resp.get("token", "")

    # Store locally
    submission = CodeSubmission(
        attempt_id=attempt_id,
        question_id=payload.question_id,
        tenant_id=tenant_id,
        language_id=payload.language_id,
        language_name=language_name,
        source_code=payload.source_code,
        stdin=payload.stdin,
        status=SubmissionStatus.QUEUED.value,
        judge0_token=judge0_token,
    )
    db.add(submission)
    await db.flush()

    logger.info(
        "code_submitted submission_id=%s judge0_token=%s lang=%s",
        submission.id, judge0_token, language_name,
    )
    return submission


async def poll_result(
    db: AsyncSession,
    submission_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> CodeSubmission:
    """Poll Judge0 for latest result and update the local record."""

    submission = await _get_submission(db, submission_id, tenant_id)

    # If already in a terminal state, no need to poll
    terminal = {
        SubmissionStatus.ACCEPTED.value,
        SubmissionStatus.WRONG_ANSWER.value,
        SubmissionStatus.RUNTIME_ERROR.value,
        SubmissionStatus.TIME_LIMIT_EXCEEDED.value,
        SubmissionStatus.MEMORY_LIMIT_EXCEEDED.value,
        SubmissionStatus.COMPILATION_ERROR.value,
    }
    if submission.status in terminal:
        return submission

    if not submission.judge0_token:
        return submission

    # Fetch from Judge0
    judge0_data = await _judge0_get(
        f"/submissions/{submission.judge0_token}?base64_encoded=false"
    )

    # Map Judge0 status
    j_status_id = judge0_data.get("status", {}).get("id", 0)
    new_status = JUDGE0_STATUS_MAP.get(j_status_id, SubmissionStatus.QUEUED)

    submission.status = new_status.value
    submission.stdout = judge0_data.get("stdout")
    submission.stderr = judge0_data.get("stderr")
    submission.compile_output = judge0_data.get("compile_output")
    submission.exit_code = judge0_data.get("exit_code")
    submission.time_sec = _safe_float(judge0_data.get("time"))
    submission.memory_kb = _safe_int(judge0_data.get("memory"))

    await db.flush()

    logger.info(
        "code_polled submission_id=%s status=%s time=%.3fs",
        submission.id, submission.status, submission.time_sec or 0,
    )
    return submission


async def poll_result_for_user(
    db: AsyncSession,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    role: UserRole,
    tenant_id: uuid.UUID,
) -> CodeSubmission:
    """Poll result with ownership guard for candidates."""
    submission = await _get_submission_for_user(db, submission_id, user_id, role, tenant_id)

    terminal = {
        SubmissionStatus.ACCEPTED.value,
        SubmissionStatus.WRONG_ANSWER.value,
        SubmissionStatus.RUNTIME_ERROR.value,
        SubmissionStatus.TIME_LIMIT_EXCEEDED.value,
        SubmissionStatus.MEMORY_LIMIT_EXCEEDED.value,
        SubmissionStatus.COMPILATION_ERROR.value,
    }
    if submission.status in terminal:
        return submission

    if not submission.judge0_token:
        return submission

    judge0_data = await _judge0_get(
        f"/submissions/{submission.judge0_token}?base64_encoded=false"
    )

    j_status_id = judge0_data.get("status", {}).get("id", 0)
    new_status = JUDGE0_STATUS_MAP.get(j_status_id, SubmissionStatus.QUEUED)

    submission.status = new_status.value
    submission.stdout = judge0_data.get("stdout")
    submission.stderr = judge0_data.get("stderr")
    submission.compile_output = judge0_data.get("compile_output")
    submission.exit_code = judge0_data.get("exit_code")
    submission.time_sec = _safe_float(judge0_data.get("time"))
    submission.memory_kb = _safe_int(judge0_data.get("memory"))

    await db.flush()
    return submission


async def get_submission(
    db: AsyncSession,
    submission_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> CodeSubmission:
    """Get a single submission by ID."""
    return await _get_submission(db, submission_id, tenant_id)


async def list_submissions(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[CodeSubmission]:
    """List all code submissions for a given attempt."""
    result = await db.execute(
        select(CodeSubmission)
        .where(
            and_(
                CodeSubmission.attempt_id == attempt_id,
                CodeSubmission.tenant_id == tenant_id,
            )
        )
        .order_by(CodeSubmission.created_at.desc())
    )
    return list(result.scalars().all())


async def list_submissions_for_user(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    user_id: uuid.UUID,
    role: UserRole,
    tenant_id: uuid.UUID,
) -> list[CodeSubmission]:
    """List submissions with ownership guard for candidates."""
    if role == UserRole.CANDIDATE:
        own_attempt = await db.execute(
            select(ExamAttempt).where(
                and_(
                    ExamAttempt.id == attempt_id,
                    ExamAttempt.candidate_id == user_id,
                    ExamAttempt.tenant_id == tenant_id,
                    ExamAttempt.is_active == True,  # noqa: E712
                )
            )
        )
        if own_attempt.scalar_one_or_none() is None:
            raise Forbidden("You are not allowed to view these code submissions")

    return await list_submissions(db, attempt_id, tenant_id)


async def list_languages() -> list[dict]:
    """Fetch available languages from Judge0."""
    data = await _judge0_get("/languages")
    return data if isinstance(data, list) else []


# ── Helpers ──────────────────────────────────────────────────────


async def _get_submission(
    db: AsyncSession,
    submission_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> CodeSubmission:
    result = await db.execute(
        select(CodeSubmission).where(
            and_(
                CodeSubmission.id == submission_id,
                CodeSubmission.tenant_id == tenant_id,
            )
        )
    )
    sub = result.scalar_one_or_none()
    if sub is None:
        raise SubmissionNotFound()
    return sub


async def _get_submission_for_user(
    db: AsyncSession,
    submission_id: uuid.UUID,
    user_id: uuid.UUID,
    role: UserRole,
    tenant_id: uuid.UUID,
) -> CodeSubmission:
    """Fetch submission and ensure candidate can only see own attempt submissions."""
    sub = await _get_submission(db, submission_id, tenant_id)

    if role == UserRole.CANDIDATE:
        own_attempt = await db.execute(
            select(ExamAttempt).where(
                and_(
                    ExamAttempt.id == sub.attempt_id,
                    ExamAttempt.candidate_id == user_id,
                    ExamAttempt.tenant_id == tenant_id,
                    ExamAttempt.is_active == True,  # noqa: E712
                )
            )
        )
        if own_attempt.scalar_one_or_none() is None:
            raise Forbidden("You are not allowed to view this submission")

    return sub


async def _get_language_name(language_id: int) -> str:
    """Best-effort language name lookup from Judge0."""
    try:
        data = await _judge0_get(f"/languages/{language_id}")
        return data.get("name", f"language_{language_id}")
    except Judge0Unavailable:
        return f"language_{language_id}"


def _safe_float(val) -> float | None:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _safe_int(val) -> int | None:
    if val is None:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None
