"""
Integrity Report PDF generation service.
Generates a candidate integrity report for a single exam attempt.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fpdf import FPDF
from PIL import Image
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import AttemptNotFound
from app.models.attempt import ExamAttempt
from app.models.code_submission import CodeSubmission
from app.models.exam import Exam
from app.models.proctoring_event import ProctoringEvent
from app.models.question import Question
from app.models.risk_score import RiskScore
from app.models.user import User
from app.services import risk_engine

logger = logging.getLogger("proctoease.integrity_report")

# Unicode font support for fpdf2
FONT_DIR = Path(__file__).parent.parent.parent / "fonts"
DEJAVU_REGULAR = FONT_DIR / "DejaVuSans.ttf"
DEJAVU_BOLD = FONT_DIR / "DejaVuSans-Bold.ttf"
DEJAVU_OBLIQUE = FONT_DIR / "DejaVuSans-Oblique.ttf"
DEJAVU_BOLD_OBLIQUE = FONT_DIR / "DejaVuSans-BoldOblique.ttf"


class IntegrityReportPDF(FPDF):
    """Custom PDF class for integrity report with Unicode support."""

    def __init__(self):
        super().__init__()
        # Add Unicode fonts if present
        if DEJAVU_REGULAR.exists():
            self.add_font("DejaVu", "", str(DEJAVU_REGULAR), uni=True)
            self.add_font("DejaVu", "B", str(DEJAVU_BOLD), uni=True)
            self.add_font("DejaVu", "I", str(DEJAVU_OBLIQUE), uni=True)
            self.add_font("DejaVu", "BI", str(DEJAVU_BOLD_OBLIQUE), uni=True)
            self.default_font = "DejaVu"
        else:
            # Built-in font (Latin-1)
            self.default_font = "helvetica"

    def clean_text(self, text: Any) -> str:
        """Sanitize text to avoid encoding crashes on built-in fonts."""
        if text is None:
            return ""
        s = str(text)
        if self.default_font == "helvetica":
            replacements = {
                "\u2013": "-",
                "\u2014": "--",
                "\u2018": "'",
                "\u2019": "'",
                "\u201c": '"',
                "\u201d": '"',
                "\u2022": "*",
                "\u2026": "...",
                "\u00a0": " ",
            }
            for k, v in replacements.items():
                s = s.replace(k, v)
            s = s.encode("latin-1", "replace").decode("latin-1")
        return s

    def header(self):
        self.set_font(self.default_font, "B", 14)
        self.cell(0, 10, self.clean_text("Candidate Integrity Report"), align="C", new_x="LMARGIN", new_y="NEXT")
        self.line(10, self.get_y(), 200, self.get_y())
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font(self.default_font, "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    def section_title(self, title: str):
        self.set_font(self.default_font, "B", 12)
        self.set_fill_color(230, 230, 230)
        self.cell(0, 8, self.clean_text(title), fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def key_value(self, key: str, value: str):
        self.set_font(self.default_font, "B", 10)
        self.cell(60, 6, self.clean_text(key))
        self.set_font(self.default_font, "", 10)
        self.cell(0, 6, self.clean_text(value), new_x="LMARGIN", new_y="NEXT")

    def add_table(self, headers: list[str], rows: list[list[str]], col_widths: list[float] | None = None):
        if not rows:
            self.set_font(self.default_font, "I", 10)
            self.cell(0, 6, self.clean_text("No data"), new_x="LMARGIN", new_y="NEXT")
            return

        if col_widths is None:
            col_widths = [190 / len(headers)] * len(headers)

        # Header
        self.set_font(self.default_font, "B", 9)
        self.set_fill_color(200, 200, 200)
        for i, header in enumerate(headers):
            self.cell(col_widths[i], 7, self.clean_text(header), border=1, fill=True, align="C")
        self.ln()

        # Rows
        self.set_font(self.default_font, "", 9)
        fill = False
        for row in rows:
            if fill:
                self.set_fill_color(245, 245, 245)
            else:
                self.set_fill_color(255, 255, 255)
            for i, cell in enumerate(row):
                self.cell(col_widths[i], 6, self.clean_text(str(cell)), border=1, fill=fill, align="L")
            self.ln()
            fill = not fill
        self.ln(3)


async def generate_integrity_report_pdf(
    db: AsyncSession,
    attempt_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> bytes:
    """
    Generate the integrity report PDF for a single exam attempt.
    Returns the PDF as bytes.
    """

    # 1. Fetch attempt with tenant scoping
    attempt_result = await db.execute(
        select(ExamAttempt).where(
            ExamAttempt.id == attempt_id,
            ExamAttempt.tenant_id == tenant_id,
            ExamAttempt.is_active == True,  # noqa: E712
        )
    )
    attempt = attempt_result.scalar_one_or_none()
    if attempt is None:
        raise AttemptNotFound()

    # 2. Fetch candidate and exam
    user_result = await db.execute(
        select(User).where(
            User.id == attempt.candidate_id,
            User.tenant_id == tenant_id,
            User.is_active == True,  # noqa: E712
        )
    )
    candidate = user_result.scalar_one_or_none()

    exam_result = await db.execute(
        select(Exam).where(
            Exam.id == attempt.exam_id,
            Exam.tenant_id == tenant_id,
            Exam.is_active == True,  # noqa: E712
        )
    )
    exam = exam_result.scalar_one_or_none()

    # 3. Get risk score (compute if not exists)
    risk_score = await risk_engine.get_risk_score(db, attempt_id, tenant_id)
    if risk_score is None:
        risk_score = await risk_engine.compute_risk(db, attempt_id, tenant_id)

    # 4. Get proctoring events for this attempt
    events_result = await db.execute(
        select(ProctoringEvent).where(
            ProctoringEvent.attempt_id == attempt_id,
            ProctoringEvent.tenant_id == tenant_id,
            ProctoringEvent.is_active == True,  # noqa: E712
        ).order_by(ProctoringEvent.created_at)
    )
    events = list(events_result.scalars().all())

    # 5. Get questions for the exam
    questions_result = await db.execute(
        select(Question).where(
            Question.exam_id == attempt.exam_id,
            Question.tenant_id == tenant_id,
            Question.is_active == True,  # noqa: E712
        ).order_by(Question.order_index)
    )
    questions = list(questions_result.scalars().all())

    # 6. Get code submissions for this attempt
    code_subs_result = await db.execute(
        select(CodeSubmission).where(
            CodeSubmission.attempt_id == attempt_id,
            CodeSubmission.tenant_id == tenant_id,
        ).order_by(CodeSubmission.created_at.desc())
    )
    code_submissions = list(code_subs_result.scalars().all())

    # 7. Build PDF
    pdf = IntegrityReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ---- Header Information ----
    pdf.section_title("Attempt Information")
    pdf.key_value("Attempt ID:", str(attempt.id))
    pdf.key_value("Exam:", exam.title if exam else "Unknown")
    pdf.key_value("Candidate:", f"{candidate.full_name if candidate else 'Unknown'} ({candidate.email if candidate else 'Unknown'})")
    pdf.key_value("Submitted At:", attempt.submitted_at.strftime("%Y-%m-%d %H:%M:%S UTC") if attempt.submitted_at else "Not submitted")
    pdf.key_value("Duration:", f"{(attempt.submitted_at - attempt.started_at).total_seconds() / 60:.1f} minutes" if attempt.submitted_at and attempt.started_at else "N/A")
    pdf.key_value("Tenant:", str(tenant_id))
    pdf.ln(3)

    # ---- Risk Summary ----
    pdf.section_title("Risk Summary")
    pdf.key_value("Overall Score:", f"{risk_score.overall_score:.4f}")
    pdf.key_value("Risk Level:", risk_score.risk_level.upper())
    pdf.key_value("Total Events:", str(risk_score.total_events))
    pdf.ln(2)
    pdf.set_font(pdf.default_font, "B", 10)
    pdf.cell(0, 6, "Breakdown by Event Type:", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font(pdf.default_font, "", 10)
    for event_type, contribution in risk_score.breakdown.items():
        count = risk_score.event_counts.get(event_type, 0)
        pdf.cell(0, 6, pdf.clean_text(f"  {event_type}: {contribution:.4f} (count: {count})"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---- Violation Timeline ----
    pdf.section_title("Violation Timeline")
    if events:
        headers = ["Time (UTC)", "Type", "Severity", "Description"]
        rows = []
        for ev in events:
            time_str = ev.created_at.strftime("%H:%M:%S")
            desc = ev.detail.get("description", "") if ev.detail else ""
            rows.append([time_str, ev.event_type, str(ev.severity), desc[:80]])
        pdf.add_table(headers, rows, col_widths=[30, 40, 20, 100])
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, "No violations recorded.", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    # ---- Embedded Snapshots ----
    pdf.section_title("Evidence Snapshots")
    snapshot_events = [ev for ev in events if ev.snapshot_path]
    if snapshot_events:
        for ev in snapshot_events:
            # Resolve snapshot path
            rel_path = ev.snapshot_path
            if rel_path.startswith("uploads/"):
                abs_path = Path(settings.PROCTORING_UPLOAD_ROOT).parent / rel_path
            else:
                abs_path = Path(settings.PROCTORING_UPLOAD_ROOT) / rel_path

            if abs_path.exists():
                try:
                    # Open image and check size
                    with Image.open(abs_path) as img:
                        img_width, img_height = img.size
                        # Scale to fit page width (max 180mm)
                        max_width = 180
                        aspect = img_height / img_width if img_width > 0 else 1.0
                        display_width = min(max_width, img_width * 0.264583)  # px to mm (96 dpi)
                        display_height = display_width * aspect

                        pdf.set_font(pdf.default_font, "B", 10)
                        pdf.cell(0, 6, pdf.clean_text(f"{ev.event_type} - {ev.created_at.strftime('%H:%M:%S')}"), new_x="LMARGIN", new_y="NEXT")
                        pdf.image(str(abs_path), x=pdf.get_x(), y=pdf.get_y(), w=display_width, h=display_height)
                        pdf.ln(display_height + 5)
                except Exception as exc:
                    logger.warning(f"Failed to embed snapshot {abs_path}: {exc}")
                    pdf.set_font(pdf.default_font, "I", 9)
                    pdf.cell(0, 6, pdf.clean_text(f"[Snapshot unavailable: {ev.event_type} at {ev.created_at.strftime('%H:%M:%S')}]"), new_x="LMARGIN", new_y="NEXT")
            else:
                pdf.set_font(pdf.default_font, "I", 9)
                pdf.cell(0, 6, pdf.clean_text(f"[Snapshot missing: {ev.event_type} at {ev.created_at.strftime('%H:%M:%S')}]"), new_x="LMARGIN", new_y="NEXT")
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, "No snapshots available.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---- MCQ / Objective Results ----
    pdf.section_title("Objective Question Results (MCQ / Multi-select / True-False)")
    # Get answers from attempt.answers JSON
    raw_answers = attempt.answers or {}
    objective_rows = []
    for q in questions:
        if q.question_type in ("mcq", "multi_select", "true_false"):
            ans_data = raw_answers.get(str(q.id))
            if ans_data:
                is_correct = ans_data.get("is_correct")
                points = ans_data.get("points_earned", 0)
                selected = ans_data.get("selected_option_ids") or ans_data.get("selected_options") or ans_data.get("selected_option")
                selected_str = ", ".join(selected) if isinstance(selected, list) else (selected or "")
                objective_rows.append([
                    q.question_text[:60],
                    q.question_type,
                    selected_str,
                    "Correct" if is_correct else "Incorrect" if is_correct is not None else "Ungraded",
                    f"{points}/{q.points}"
                ])
    if objective_rows:
        pdf.add_table(
            ["Question", "Type", "Selected", "Result", "Score"],
            objective_rows,
            col_widths=[60, 20, 40, 30, 20]
        )
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, "No objective questions in this exam.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---- Code Question Results ----
    pdf.section_title("Code Question Results")
    code_rows = []
    for q in questions:
        if q.question_type == "code":
            ans_data = raw_answers.get(str(q.id))
            if ans_data:
                is_correct = ans_data.get("is_correct")
                points = ans_data.get("points_earned", 0)
                # Find latest submission for this question
                latest_sub = next((s for s in code_submissions if s.question_id == q.id), None)
                language = latest_sub.language_name if latest_sub else "Unknown"
                code_rows.append([
                    q.question_text[:60],
                    language,
                    "Passed" if is_correct else "Failed" if is_correct is not None else "Ungraded",
                    f"{points}/{q.points}"
                ])
    if code_rows:
        pdf.add_table(
            ["Question", "Language", "Result", "Score"],
            code_rows,
            col_widths=[60, 30, 30, 30]
        )
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, "No code questions in this exam.", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---- Code Submission Details (per question) ----
    # Note: individual per-test-case assertions are not stored in DB (migration-free design).
    # We display the authoritative execution status and runtime metrics for each code question.
    pdf.section_title("Code Submission Details")
    for q in questions:
        if q.question_type == "code":
            latest_sub = next((s for s in code_submissions if s.question_id == q.id), None)
            if latest_sub:
                pdf.set_font(pdf.default_font, "B", 10)
                pdf.cell(0, 6, pdf.clean_text(f"{q.question_text[:80]} ({latest_sub.language_name})"), new_x="LMARGIN", new_y="NEXT")
                pdf.set_font(pdf.default_font, "", 10)
                pdf.cell(0, 6, pdf.clean_text(f"  Status: {latest_sub.status.replace('_', ' ').title()}"), new_x="LMARGIN", new_y="NEXT")
                if latest_sub.stdout:
                    stdout = latest_sub.stdout[:200] + ("..." if len(latest_sub.stdout) > 200 else "")
                    pdf.cell(0, 6, pdf.clean_text(f"  Stdout: {stdout}"), new_x="LMARGIN", new_y="NEXT")
                if latest_sub.stderr:
                    stderr = latest_sub.stderr[:200] + ("..." if len(latest_sub.stderr) > 200 else "")
                    pdf.cell(0, 6, pdf.clean_text(f"  Stderr: {stderr}"), new_x="LMARGIN", new_y="NEXT")
                if latest_sub.compile_output:
                    compile_out = latest_sub.compile_output[:200] + ("..." if len(latest_sub.compile_output) > 200 else "")
                    pdf.cell(0, 6, pdf.clean_text(f"  Compile: {compile_out}"), new_x="LMARGIN", new_y="NEXT")
                pdf.cell(0, 6, pdf.clean_text(f"  Time: {latest_sub.time_sec:.3f}s  Memory: {latest_sub.memory_kb} KB"), new_x="LMARGIN", new_y="NEXT")
                pdf.ln(2)
            else:
                pdf.set_font(pdf.default_font, "I", 10)
                pdf.cell(0, 6, pdf.clean_text(f"{q.question_text[:80]}: No submissions"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Output PDF as bytes
    pdf_bytes = pdf.output()
    return bytes(pdf_bytes) if isinstance(pdf_bytes, bytearray) else pdf_bytes