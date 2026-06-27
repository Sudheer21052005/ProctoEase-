"""
Reporting service — aggregation queries for dashboards and exports.
Phase 9: Reporting & Analytics. Includes pagination helpers.

All functions are read-only; no new tables required.
Data is aggregated from Phase 1–8 tables via SQLAlchemy func.*.
"""

from __future__ import annotations

import csv
import io
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, func, and_, case, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attempt import ExamAttempt
from app.models.code_submission import CodeSubmission
from app.models.exam import Exam
from app.models.plagiarism_report import PlagiarismReport, PlagiarismPair
from app.models.proctoring_event import ProctoringEvent
from app.models.question import Question
from app.models.risk_score import RiskScore
from app.models.user import User
from app.core.exceptions import ExamNotFound, UserNotFound


# ── Pagination helper ───────────────────────────────────────────


def paginate(items: list, page: int, page_size: int) -> dict:
    """
    Slice a list into a page and return pagination metadata.

    Args:
        items:     Full result list (already fetched / ordered).
        page:      1-indexed page number.
        page_size: Number of items per page (clamped to 1–200).

    Returns a dict compatible with PaginatedResponse.
    """
    page_size = max(1, min(page_size, 200))
    page = max(1, page)
    total = len(items)
    pages = max(1, -(-total // page_size))  # ceiling division
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": items[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": pages,
    }

logger = logging.getLogger("proctoease.reporting")


# ── Tenant Dashboard ────────────────────────────────────────────


async def get_tenant_dashboard(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> dict:
    """Aggregate tenant-wide statistics."""

    # Exam counts
    exam_q = await db.execute(
        select(
            func.count(Exam.id).label("total"),
            func.count(case((Exam.is_published == True, 1))).label("published"),  # noqa: E712
        ).where(
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    exam_row = exam_q.one()

    # Attempt counts
    attempt_q = await db.execute(
        select(
            func.count(ExamAttempt.id).label("total"),
            func.count(
                case((ExamAttempt.status.in_(["submitted", "evaluated"]), 1))
            ).label("completed"),
            func.count(func.distinct(ExamAttempt.candidate_id)).label("unique_candidates"),
        ).where(
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt_row = attempt_q.one()

    # Risk score aggregates
    risk_q = await db.execute(
        select(
            func.avg(RiskScore.overall_score).label("avg_risk"),
            func.count(case((RiskScore.risk_level == "low", 1))).label("low"),
            func.count(case((RiskScore.risk_level == "medium", 1))).label("medium"),
            func.count(case((RiskScore.risk_level == "high", 1))).label("high"),
            func.count(case((RiskScore.risk_level == "critical", 1))).label("critical"),
        ).where(RiskScore.tenant_id == tenant_id)
    )
    risk_row = risk_q.one()

    # Proctoring event count
    proctor_q = await db.execute(
        select(func.count(ProctoringEvent.id)).where(
            ProctoringEvent.tenant_id == tenant_id,
            ProctoringEvent.is_active == True,  # noqa: E712
        )
    )
    proctor_count = proctor_q.scalar() or 0

    # Code submission count
    code_q = await db.execute(
        select(func.count(CodeSubmission.id)).where(
            CodeSubmission.tenant_id == tenant_id,
        )
    )
    code_count = code_q.scalar() or 0

    # Plagiarism report count
    plag_q = await db.execute(
        select(func.count(PlagiarismReport.id)).where(
            PlagiarismReport.tenant_id == tenant_id,
        )
    )
    plag_count = plag_q.scalar() or 0

    avg_risk = round(float(risk_row.avg_risk), 4) if risk_row.avg_risk else None

    return {
        "total_exams": exam_row.total,
        "published_exams": exam_row.published,
        "total_attempts": attempt_row.total,
        "completed_attempts": attempt_row.completed,
        "unique_candidates": attempt_row.unique_candidates,
        "average_risk_score": avg_risk,
        "risk_distribution": {
            "low": risk_row.low,
            "medium": risk_row.medium,
            "high": risk_row.high,
            "critical": risk_row.critical,
        },
        "total_proctoring_events": proctor_count,
        "total_code_submissions": code_count,
        "total_plagiarism_reports": plag_count,
    }


# ── Per-Exam Analytics ──────────────────────────────────────────


async def get_exam_analytics(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Compute analytics for a single exam."""

    # Verify exam exists
    exam_result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    exam = exam_result.scalar_one_or_none()
    if exam is None:
        raise ExamNotFound()

    # Attempt aggregates
    attempt_q = await db.execute(
        select(
            func.count(ExamAttempt.id).label("total"),
            func.count(case((ExamAttempt.status == "started", 1))).label("started"),
            func.count(case((ExamAttempt.status == "submitted", 1))).label("submitted"),
            func.count(case((ExamAttempt.status == "evaluated", 1))).label("evaluated"),
        ).where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt_row = attempt_q.one()

    total = attempt_row.total
    completed = attempt_row.submitted + attempt_row.evaluated
    completion_rate = round(completed / total, 4) if total > 0 else 0.0

    # Average duration (only for submitted/evaluated attempts)
    dur_q = await db.execute(
        select(
            func.avg(
                extract("epoch", ExamAttempt.submitted_at - ExamAttempt.started_at) / 60.0
            )
        ).where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.submitted_at.isnot(None),
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    avg_dur = dur_q.scalar()
    avg_duration = round(float(avg_dur), 2) if avg_dur else None

    # Risk scores for this exam's attempts
    risk_q = await db.execute(
        select(
            func.avg(RiskScore.overall_score).label("avg_risk"),
            func.max(RiskScore.overall_score).label("max_risk"),
        )
        .join(ExamAttempt, RiskScore.attempt_id == ExamAttempt.id)
        .where(
            ExamAttempt.exam_id == exam_id,
            RiskScore.tenant_id == tenant_id,
        )
    )
    risk_row = risk_q.one()
    avg_risk = round(float(risk_row.avg_risk), 4) if risk_row.avg_risk else None
    max_risk = round(float(risk_row.max_risk), 4) if risk_row.max_risk else None

    # Proctoring events for this exam
    proctor_q = await db.execute(
        select(func.count(ProctoringEvent.id))
        .join(ExamAttempt, ProctoringEvent.attempt_id == ExamAttempt.id)
        .where(
            ExamAttempt.exam_id == exam_id,
            ProctoringEvent.tenant_id == tenant_id,
            ProctoringEvent.is_active == True,  # noqa: E712
        )
    )
    proctor_count = proctor_q.scalar() or 0

    # Code submissions for this exam
    code_q = await db.execute(
        select(func.count(CodeSubmission.id))
        .join(ExamAttempt, CodeSubmission.attempt_id == ExamAttempt.id)
        .where(
            ExamAttempt.exam_id == exam_id,
            CodeSubmission.tenant_id == tenant_id,
        )
    )
    code_count = code_q.scalar() or 0

    # Flagged plagiarism pairs
    plag_q = await db.execute(
        select(func.count(PlagiarismPair.id))
        .join(PlagiarismReport, PlagiarismPair.report_id == PlagiarismReport.id)
        .where(
            PlagiarismReport.exam_id == exam_id,
            PlagiarismPair.is_flagged == True,  # noqa: E712
            PlagiarismPair.tenant_id == tenant_id,
        )
    )
    plag_count = plag_q.scalar() or 0

    return {
        "exam_id": exam.id,
        "exam_title": exam.title,
        "total_attempts": total,
        "completion_rate": completion_rate,
        "avg_duration_minutes": avg_duration,
        "avg_risk_score": avg_risk,
        "max_risk_score": max_risk,
        "status_breakdown": {
            "started": attempt_row.started,
            "submitted": attempt_row.submitted,
            "evaluated": attempt_row.evaluated,
        },
        "total_proctoring_events": proctor_count,
        "total_code_submissions": code_count,
        "flagged_plagiarism_pairs": plag_count,
    }


# ── Question Stats ──────────────────────────────────────────────


async def get_exam_question_stats(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Per-question statistics for an exam."""

    # Verify exam
    exam_result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    if exam_result.scalar_one_or_none() is None:
        raise ExamNotFound()

    # Get all questions for the exam
    q_result = await db.execute(
        select(Question).where(
            Question.exam_id == exam_id,
            Question.tenant_id == tenant_id,
            Question.is_active == True,  # noqa: E712
        ).order_by(Question.order_index)
    )
    questions = list(q_result.scalars().all())

    # Preload attempt answers once so objective question stats (MCQ/true_false/etc.)
    # are based on saved candidate responses, not code_submissions.
    attempt_result = await db.execute(
        select(ExamAttempt.answers).where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
            ExamAttempt.answers.isnot(None),
        )
    )
    attempt_answers = [row[0] or {} for row in attempt_result.all()]

    objective_stats: dict[str, dict[str, int]] = {}
    for raw in attempt_answers:
        if not isinstance(raw, dict):
            continue

        for qid, ans_data in raw.items():
            if not isinstance(ans_data, dict):
                continue

            selected = (
                ans_data.get("selected_option_ids")
                or ans_data.get("selected_options")
                or ans_data.get("selected_option")
            )
            text_answer = ans_data.get("text_answer")

            has_submission = False
            if isinstance(selected, list):
                has_submission = len(selected) > 0
            elif isinstance(selected, str):
                has_submission = selected.strip() != ""
            elif selected is not None:
                has_submission = True

            if not has_submission and isinstance(text_answer, str):
                has_submission = text_answer.strip() != ""
            elif not has_submission and text_answer is not None:
                has_submission = True

            if not has_submission:
                continue

            bucket = objective_stats.setdefault(str(qid), {"total": 0, "accepted": 0})
            bucket["total"] += 1
            if ans_data.get("is_correct") is True:
                bucket["accepted"] += 1

    stats = []
    for q in questions:
        if q.question_type == "code":
            # Code questions use Judge0 submission history.
            sub_q = await db.execute(
                select(
                    func.count(CodeSubmission.id).label("total"),
                    func.count(case((CodeSubmission.status == "accepted", 1))).label("accepted"),
                    func.avg(CodeSubmission.time_sec).label("avg_time"),
                ).where(
                    CodeSubmission.question_id == q.id,
                    CodeSubmission.tenant_id == tenant_id,
                )
            )
            sub_row = sub_q.one()
            total = sub_row.total
            accepted = sub_row.accepted
            success_rate = round(accepted / total, 4) if total > 0 else 0.0
            avg_time = round(float(sub_row.avg_time), 4) if sub_row.avg_time else None
        else:
            # Objective/short-answer questions derive submission counts from attempt.answers JSON.
            bucket = objective_stats.get(str(q.id), {"total": 0, "accepted": 0})
            total = bucket["total"]
            accepted = bucket["accepted"]
            success_rate = round(accepted / total, 4) if total > 0 else 0.0
            avg_time = None

        stats.append({
            "question_id": q.id,
            "question_text": q.question_text,
            "question_type": q.question_type,
            "total_submissions": total,
            "accepted_submissions": accepted,
            "success_rate": success_rate,
            "avg_execution_time_sec": avg_time,
        })

    return paginate(stats, page, page_size)


# ── Candidate Performance ──────────────────────────────────────


async def get_candidate_performance(
    db: AsyncSession,
    candidate_id: uuid.UUID,
    tenant_id: uuid.UUID,
    *,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Candidate performance summary with enriched attempt data."""

    # Verify candidate exists
    user_result = await db.execute(
        select(User).where(
            User.id == candidate_id,
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
        )
    )
    user = user_result.scalar_one_or_none()
    if user is None:
        raise UserNotFound()

    # Get all attempts
    attempt_result = await db.execute(
        select(ExamAttempt)
        .where(
            ExamAttempt.candidate_id == candidate_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
        .order_by(ExamAttempt.started_at.desc())
    )
    attempts = list(attempt_result.scalars().all())

    attempt_summaries = []
    risk_scores_list = []

    for att in attempts:
        # Get exam title
        exam_r = await db.execute(select(Exam.title).where(Exam.id == att.exam_id))
        exam_title = exam_r.scalar() or "Unknown"

        # Duration
        duration = None
        if att.submitted_at and att.started_at:
            delta = att.submitted_at - att.started_at
            duration = round(delta.total_seconds() / 60.0, 2)

        # Risk score
        risk_r = await db.execute(
            select(RiskScore).where(
                RiskScore.attempt_id == att.id,
                RiskScore.tenant_id == tenant_id,
            )
        )
        risk = risk_r.scalar_one_or_none()
        r_score = risk.overall_score if risk else None
        r_level = risk.risk_level if risk else None
        if r_score is not None:
            risk_scores_list.append(r_score)

        # Proctoring event count
        pe_r = await db.execute(
            select(func.count(ProctoringEvent.id)).where(
                ProctoringEvent.attempt_id == att.id,
                ProctoringEvent.tenant_id == tenant_id,
                ProctoringEvent.is_active == True,  # noqa: E712
            )
        )
        pe_count = pe_r.scalar() or 0

        # Code submission count
        cs_r = await db.execute(
            select(func.count(CodeSubmission.id)).where(
                CodeSubmission.attempt_id == att.id,
                CodeSubmission.tenant_id == tenant_id,
            )
        )
        cs_count = cs_r.scalar() or 0

        attempt_summaries.append({
            "attempt_id": att.id,
            "exam_id": att.exam_id,
            "exam_title": exam_title,
            "status": att.status,
            "started_at": att.started_at,
            "submitted_at": att.submitted_at,
            "duration_minutes": duration,
            "risk_score": r_score,
            "risk_level": r_level,
            "proctoring_event_count": pe_count,
            "code_submission_count": cs_count,
        })

    completed = sum(
        1 for a in attempts if a.status in ("submitted", "evaluated")
    )
    avg_risk = (
        round(sum(risk_scores_list) / len(risk_scores_list), 4)
        if risk_scores_list
        else None
    )

    paginated_attempts = paginate(attempt_summaries, page, page_size)

    return {
        "candidate_id": user.id,
        "candidate_name": user.full_name,
        "candidate_email": user.email,
        "total_attempts": len(attempts),
        "completed_attempts": completed,
        "average_risk_score": avg_risk,
        # Paginated slice — callers read from "attempts" key
        "attempts": paginated_attempts["items"],
        # Expose pagination metadata at top level for the API layer
        "_pagination": paginated_attempts,
    }


# ── CSV Exports ─────────────────────────────────────────────────


async def export_exam_results_csv(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> tuple[str, int]:
    """
    Build an in-memory CSV of exam results.
    Returns (csv_string, row_count).
    """

    # Verify exam
    exam_result = await db.execute(
        select(Exam).where(
            Exam.id == exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    exam = exam_result.scalar_one_or_none()
    if exam is None:
        raise ExamNotFound()

    # Get all attempts with user info
    attempt_result = await db.execute(
        select(ExamAttempt, User.full_name, User.email)
        .join(User, ExamAttempt.candidate_id == User.id)
        .where(
            ExamAttempt.exam_id == exam_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
        .order_by(ExamAttempt.started_at)
    )
    rows = attempt_result.all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Candidate Name", "Email", "Status",
        "Started At", "Submitted At", "Duration (min)",
        "Risk Score", "Risk Level", "Proctoring Events",
        "Code Submissions",
    ])

    row_count = 0
    for att, name, email in rows:
        # Duration
        duration = ""
        if att.submitted_at and att.started_at:
            delta = att.submitted_at - att.started_at
            duration = round(delta.total_seconds() / 60.0, 2)

        # Risk score
        risk_r = await db.execute(
            select(RiskScore).where(
                RiskScore.attempt_id == att.id,
                RiskScore.tenant_id == tenant_id,
            )
        )
        risk = risk_r.scalar_one_or_none()

        # Proctoring events
        pe_r = await db.execute(
            select(func.count(ProctoringEvent.id)).where(
                ProctoringEvent.attempt_id == att.id,
                ProctoringEvent.tenant_id == tenant_id,
                ProctoringEvent.is_active == True,  # noqa: E712
            )
        )
        pe_count = pe_r.scalar() or 0

        # Code submissions
        cs_r = await db.execute(
            select(func.count(CodeSubmission.id)).where(
                CodeSubmission.attempt_id == att.id,
                CodeSubmission.tenant_id == tenant_id,
            )
        )
        cs_count = cs_r.scalar() or 0

        writer.writerow([
            name,
            email,
            att.status,
            att.started_at.isoformat() if att.started_at else "",
            att.submitted_at.isoformat() if att.submitted_at else "",
            duration,
            risk.overall_score if risk else "",
            risk.risk_level if risk else "",
            pe_count,
            cs_count,
        ])
        row_count += 1

    csv_string = output.getvalue()
    output.close()

    logger.info(
        "csv_export exam=%s rows=%d tenant=%s",
        exam_id, row_count, tenant_id,
    )
    return csv_string, row_count


async def export_tenant_dashboard_csv(
    db: AsyncSession,
    tenant_id: uuid.UUID,
) -> tuple[str, int]:
    """
    Build an in-memory CSV of all exams with summary stats.
    Returns (csv_string, row_count).
    """

    # Get all exams
    exam_result = await db.execute(
        select(Exam).where(
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        ).order_by(Exam.created_at.desc())
    )
    exams = list(exam_result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Exam Title", "Published", "Total Attempts",
        "Completed", "Avg Risk Score", "Proctoring Events",
        "Code Submissions", "Flagged Pairs",
    ])

    row_count = 0
    for exam in exams:
        # Attempt count
        att_q = await db.execute(
            select(
                func.count(ExamAttempt.id).label("total"),
                func.count(
                    case((ExamAttempt.status.in_(["submitted", "evaluated"]), 1))
                ).label("completed"),
            ).where(
                ExamAttempt.exam_id == exam.id,
                ExamAttempt.tenant_id == tenant_id,
                ExamAttempt.is_active == True,  # noqa: E712
            )
        )
        att_row = att_q.one()

        # Avg risk
        risk_q = await db.execute(
            select(func.avg(RiskScore.overall_score))
            .join(ExamAttempt, RiskScore.attempt_id == ExamAttempt.id)
            .where(
                ExamAttempt.exam_id == exam.id,
                RiskScore.tenant_id == tenant_id,
            )
        )
        avg_risk = risk_q.scalar()
        avg_risk_str = round(float(avg_risk), 4) if avg_risk else ""

        # Proctoring events
        pe_q = await db.execute(
            select(func.count(ProctoringEvent.id))
            .join(ExamAttempt, ProctoringEvent.attempt_id == ExamAttempt.id)
            .where(
                ExamAttempt.exam_id == exam.id,
                ProctoringEvent.tenant_id == tenant_id,
                ProctoringEvent.is_active == True,  # noqa: E712
            )
        )
        pe_count = pe_q.scalar() or 0

        # Code submissions
        cs_q = await db.execute(
            select(func.count(CodeSubmission.id))
            .join(ExamAttempt, CodeSubmission.attempt_id == ExamAttempt.id)
            .where(
                ExamAttempt.exam_id == exam.id,
                CodeSubmission.tenant_id == tenant_id,
            )
        )
        cs_count = cs_q.scalar() or 0

        # Flagged pairs
        plag_q = await db.execute(
            select(func.count(PlagiarismPair.id))
            .join(PlagiarismReport, PlagiarismPair.report_id == PlagiarismReport.id)
            .where(
                PlagiarismReport.exam_id == exam.id,
                PlagiarismPair.is_flagged == True,  # noqa: E712
                PlagiarismPair.tenant_id == tenant_id,
            )
        )
        plag_count = plag_q.scalar() or 0

        writer.writerow([
            exam.title,
            "Yes" if exam.is_published else "No",
            att_row.total,
            att_row.completed,
            avg_risk_str,
            pe_count,
            cs_count,
            plag_count,
        ])
        row_count += 1

    csv_string = output.getvalue()
    output.close()

    logger.info(
        "csv_tenant_export rows=%d tenant=%s",
        row_count, tenant_id,
    )
    return csv_string, row_count
