"""
Code execution endpoints — submit, poll, list, languages, run (ephemeral).
Phase 6: Judge0 Code Execution.
Phase 10: Rate limit on code submission.
"""

import uuid

from fastapi import APIRouter, Depends, Request, status, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.core.limiter import limiter
from app.models.question import Question
from app.models.user import User, UserRole
from app.models.attempt import ExamAttempt
from app.schemas.code_submission import (
    CodeSubmit, CodeSubmissionRead, LanguageRead,
    CodeRunRequest, CodeRunResponse, CodeRunCaseResult,
)
from app.services import code_execution_service
from app.services.answer_service import _canonicalize_stdout_to_bool, _normalize_output

router = APIRouter(tags=["Code Execution"])


@router.post(
    "/attempts/{attempt_id}/code",
    response_model=CodeSubmissionRead,
    status_code=status.HTTP_201_CREATED,
    summary="Submit code for execution",
)
@limiter.limit("20/minute")
async def submit_code(
    request: Request,
    attempt_id: uuid.UUID,
    payload: CodeSubmit,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Submit source code for sandboxed execution via Judge0.
    Candidate only — must own the attempt.

    **Rate limit**: 20 requests / minute per IP.
    """
    return await code_execution_service.submit_code(
        db, attempt_id, user.tenant_id, payload
    )


@router.get(
    "/code/languages",
    response_model=list[LanguageRead],
    summary="List available languages",
)
async def list_languages(
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
):
    """Fetch the list of available programming languages from Judge0."""
    return await code_execution_service.list_languages()


@router.get(
    "/code/{submission_id}",
    response_model=CodeSubmissionRead,
    summary="Get submission result",
)
async def get_submission(
    submission_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a code submission and its execution result.
    Automatically polls Judge0 if the result is still pending.
    """
    return await code_execution_service.poll_result_for_user(
        db, submission_id, user.id, user.role, user.tenant_id
    )


@router.get(
    "/attempts/{attempt_id}/code",
    response_model=list[CodeSubmissionRead],
    summary="List submissions for attempt",
)
async def list_submissions(
    attempt_id: uuid.UUID,
    user: User = Depends(require_role(UserRole.CANDIDATE, UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """List all code submissions for an exam attempt."""
    return await code_execution_service.list_submissions_for_user(
        db, attempt_id, user.id, user.role, user.tenant_id
    )


@router.post(
    "/attempts/{attempt_id}/code/run",
    response_model=CodeRunResponse,
    summary="Run code against public test cases (ephemeral, no persistence)",
)
@limiter.limit("30/minute")
async def run_code_public(
    request: Request,
    attempt_id: uuid.UUID,
    payload: CodeRunRequest,
    user: User = Depends(require_role(UserRole.CANDIDATE)),
    db: AsyncSession = Depends(get_db),
):
    """
    Execute candidate's current code against the public sample test cases of a code question.
    Does NOT create a CodeSubmission and does NOT affect attempt score.
    Candidate must own the attempt; question must belong to the attempt's exam and be a code question.
    """
    # Verify attempt ownership and status
    attempt_res = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.candidate_id == user.id,
            ExamAttempt.tenant_id == user.tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt = attempt_res.scalar_one_or_none()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")

    # Verify question exists, is code type, belongs to same exam
    q_res = await db.execute(
        select(Question).where(
            Question.id == payload.question_id,
            Question.exam_id == attempt.exam_id,
            Question.tenant_id == user.tenant_id,
            Question.is_active == True,  # noqa: E712
        )
    )
    question = q_res.scalar_one_or_none()
    if not question or question.question_type != "code":
        raise HTTPException(status_code=400, detail="Invalid code question")

    # Extract public test cases
    test_cases = (question.correct_answer or {}).get("test_cases") or []
    public_cases = [tc for tc in test_cases if tc.get("is_public")]
    if not public_cases:
        return CodeRunResponse(cases=[])

    source_code = payload.source_code
    language_id = payload.language_id

    results = []
    for tc in public_cases:
        stdin = tc.get("input", "")
        expected = tc.get("expected")
        judge0_resp = await code_execution_service._execute_single_test_case(
            source_code, language_id, stdin
        )
        stdout = judge0_resp.get("stdout") or ""
        # Truncate like grading
        if len(stdout) > 10_000:
            stdout = stdout[:10_000]
        status_id = judge0_resp.get("status", {}).get("id", 0)
        stderr = judge0_resp.get("stderr") or ""
        compile_output = judge0_resp.get("compile_output") or ""

        # Map status_id to a human-readable string for display
        status_label_map = {
            3: "accepted",
            5: "time_limit_exceeded",
            6: "compilation_error",
        }
        if status_id == 3:
            status_label = "accepted"
        elif status_id == 5:
            status_label = "time_limit_exceeded"
        elif status_id == 6:
            status_label = "compilation_error"
        elif status_id >= 7:
            status_label = "runtime_error"
        else:
            status_label = str(status_id)

        # Determine pass using normalized comparison (same as grading)
        if status_id != 3:
            # Execution itself failed — not a pass
            passed = False
        elif isinstance(expected, bool):
            got = await _canonicalize_stdout_to_bool(stdout)
            passed = got == expected
        else:
            passed = _normalize_output(stdout) == _normalize_output(str(expected))

        # Combine diagnostics for display
        actual_display = stdout
        if compile_output:
            actual_display = f"[Compilation Error]\n{compile_output}"
        elif stderr:
            actual_display = f"[Runtime Error]\n{stderr}"
        elif not stdout and status_id != 3:
            actual_display = f"[{status_label.replace('_', ' ').title()}]"

        results.append(CodeRunCaseResult(
            input=stdin,
            expected=expected,
            actual=actual_display,
            passed=passed,
            status=status_label,
        ))

    return CodeRunResponse(cases=results)
