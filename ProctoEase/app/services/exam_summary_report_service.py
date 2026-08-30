"""
Exam-wide Summary Report PDF service (Phase F).

A recruiter-facing, exam-level summary PDF — distinct from the individual
Candidate Integrity Report. It is a pure RENDERER over the canonical
evaluation payload: ``get_exam_evaluation`` is called EXACTLY ONCE and every
statistic in the document is a deterministic Python aggregation over that
payload. Risk is never recomputed; the Phase B recommendation engine is never
re-derived; the Phase D recruiter decision is reported separately from the
system recommendation (and never changes it).

PDF presentation:
 - Portrait A4 via the hardened ``IntegrityReportPDF`` infrastructure
   (DejaVu Unicode fonts, wrapping tables, orphan-safe sections).
 - Score/risk/recommendation/decision distributions as horizontal bar rows
   drawn with plain fpdf2 rectangles (no new dependencies).
 - System Recommendation stays visually neutral (plain table); Recruiter
   Decision is reported in its own section with the authoritative disclaimer.
"""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import datetime, timezone
from statistics import median
from typing import Any, Mapping

from app.services.exam_evaluation_service import get_exam_evaluation
from app.services.integrity_report_service import IntegrityReportPDF

# ── Authoritative presentation constants ─────────────────────────────────────
SCORE_BANDS = [
    ("0–49%", 0.0, 49.999999),
    ("50–59%", 50.0, 59.999999),
    ("60–74%", 60.0, 74.999999),
    ("75–100%", 75.0, float("inf")),
]
RISK_LEVELS = ["low", "medium", "high", "critical"]
RECOMMENDATION_CODES = [
    "MANUAL_REVIEW",
    "NOT_RECOMMENDED_ACADEMIC",
    "NOT_RECOMMENDED_BOTH",
    "INTEGRITY_REVIEW",
    "SHORTLIST",
    "STRONG_SHORTLIST",
]
RECRUITER_DECISIONS = ["PENDING", "SHORTLISTED", "REVIEW", "REJECTED"]
DISCLAIMER = (
    "System recommendations are automated decision support; recruiter "
    "decisions are the final human judgment."
)
TOP_VIOLATION_TYPES = 10
BAR_MAX_WIDTH = 60.0  # mm of bar per full count


# ── Pure aggregation helpers (unit-testable, no I/O) ─────────────────────────


def completion_stats(candidates: list[dict]) -> dict[str, Any]:
    """Attempt counts + completion rate from candidate status values."""
    statuses = Counter(c.get("status") for c in candidates)
    total = len(candidates)
    completed = statuses.get("submitted", 0) + statuses.get("evaluated", 0)
    durations = [
        c.get("duration_minutes")
        for c in candidates
        if c.get("duration_minutes") is not None
    ]
    return {
        "total": total,
        "started": statuses.get("started", 0),
        "submitted": statuses.get("submitted", 0),
        "evaluated": statuses.get("evaluated", 0),
        "completion_rate_pct": round(completed / total * 100, 1) if total else 0.0,
        "avg_duration_minutes": (
            round(sum(durations) / len(durations), 1) if durations else None
        ),
    }


def score_stats(candidates: list[dict]) -> dict[str, Any]:
    """Graded/ungraded counts and avg/median/highest/lowest percentage."""
    percentages = [
        c.get("percentage") for c in candidates if c.get("percentage") is not None
    ]
    graded = len(percentages)
    return {
        "graded": graded,
        "not_graded": len(candidates) - graded,
        "avg_pct": round(sum(percentages) / graded, 1) if graded else None,
        "median_pct": round(float(median(percentages)), 1) if graded else None,
        "highest_pct": round(float(max(percentages)), 1) if graded else None,
        "lowest_pct": round(float(min(percentages)), 1) if graded else None,
    }


def score_band_counts(candidates: list[dict]) -> list[tuple[str, int]]:
    """Counts per authoritative band (boundaries mirror the Phase B
    benchmarks: pass 50 / borderline-max 60 / excellence 75)."""
    counts = [0] * len(SCORE_BANDS)
    for c in candidates:
        pct = c.get("percentage")
        if pct is None:
            continue
        for i, (_label, low, high) in enumerate(SCORE_BANDS):
            if low <= pct <= high:
                counts[i] += 1
                break
    return [(SCORE_BANDS[i][0], counts[i]) for i in range(len(SCORE_BANDS))]


def risk_distribution(candidates: list[dict]) -> dict[str, int]:
    """Counts per persisted risk level + 'unavailable' (never recomputed)."""
    levels = Counter(
        (c.get("risk_level") or "").lower() if c.get("risk_available") else "unavailable"
        for c in candidates
    )
    out = {level: levels.get(level, 0) for level in RISK_LEVELS}
    out["unavailable"] = levels.get("unavailable", 0)
    return out


def severe_integrity_count(candidates: list[dict]) -> int:
    return sum(1 for c in candidates if c.get("severe_integrity"))


def recommendation_distribution(candidates: list[dict]) -> list[tuple[str, int]]:
    """Counts for all six engine codes (verbatim; unknown codes appended)."""
    counts = Counter(c.get("recommendation", {}).get("code") for c in candidates)
    rows = [(code, counts.get(code, 0)) for code in RECOMMENDATION_CODES]
    for extra_code, extra_count in counts.items():
        if extra_code not in RECOMMENDATION_CODES:
            rows.append((extra_code, extra_count))
    return rows


def recruiter_decision_distribution(candidates: list[dict]) -> list[tuple[str, int]]:
    """Counts per HUMAN decision; NULL decision = PENDING (same rule as Excel)."""
    counts = Counter(
        (c.get("recruiter_decision") or "PENDING") for c in candidates
    )
    rows = [(d, counts.get(d, 0)) for d in RECRUITER_DECISIONS]
    for extra, extra_count in counts.items():
        if extra not in RECRUITER_DECISIONS:
            rows.append((extra, extra_count))
    return rows


# ── PDF rendering ────────────────────────────────────────────────────────────


class _SummaryReportPDF(IntegrityReportPDF):
    """IntegrityReportPDF + horizontal distribution bar rows."""

    def distribution_bars(self, rows: list[tuple[str, int]], max_count: int | None = None):
        """Label | bar | count. Pure fpdf2 rects; wraps to a new page safely."""
        peak = max_count if max_count is not None else max((n for _, n in rows), default=0)
        bar_max = BAR_MAX_WIDTH if peak > 0 else 0.001
        for label, count in rows:
            self.ensure_space(8)
            self.set_font(self.default_font, "", 9)
            self.cell(52, 6, self.clean_text(label), align="L")
            x_after_label = self.get_x()
            bar_w = (count / peak) * bar_max if (peak and count) else 0.0
            self.set_fill_color(99, 102, 241)
            self.rect(x_after_label, self.get_y() + 1, bar_w, 4, style="F")
            self.set_x(self.l_margin + 52 + BAR_MAX_WIDTH + 4)
            self.cell(0, 6, self.clean_text(str(count)), align="L", new_x="LMARGIN", new_y="NEXT")


async def generate_exam_summary_report_pdf(
    db: Any,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> bytes:
    """
    Render the exam-wide summary PDF.

    Canonical source: ``get_exam_evaluation`` — awaited EXACTLY ONCE
    (tenant-scoped; raises ExamNotFound for a wrong/nonexistent tenant exam,
    surfaced as 404 by the API layer).
    """
    evaluation = await get_exam_evaluation(db, exam_id, tenant_id)
    return _render(evaluation)


def _render(evaluation: Mapping[str, Any]) -> bytes:
    candidates = evaluation.get("candidates") or []
    completion = completion_stats(candidates)
    scores = score_stats(candidates)
    bands = score_band_counts(candidates)
    risk = risk_distribution(candidates)
    severe = severe_integrity_count(candidates)
    recommendations = recommendation_distribution(candidates)
    decisions = recruiter_decision_distribution(candidates)
    histogram: list[tuple[str, int]] = list(
        (evaluation.get("violation_type_histogram") or {}).items()
    )[:TOP_VIOLATION_TYPES]

    pdf = _SummaryReportPDF()
    pdf.alias_nb_pages()
    pdf.set_auto_page_break(auto=True, margin=20)
    pdf.add_page()

    # ── 1. Exam Overview ─────────────────────────────────────────────────
    pdf.section_title("Exam Overview")
    pdf.key_value("Exam Title:", str(evaluation.get("exam_title") or "Unknown"))
    pdf.key_value("Exam ID:", str(evaluation.get("exam_id") or ""))
    pdf.key_value(
        "Generated At:",
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
    )
    pdf.key_value("Total Attempts:", str(completion["total"]))
    pdf.key_value("Passing Score:", f"{evaluation.get('passing_score_pct')}%")
    pdf.key_value("Borderline Maximum:", f"{evaluation.get('borderline_max_pct')}%")
    pdf.key_value("Excellence Score:", f"{evaluation.get('excellence_score_pct')}%")
    pdf.ln(3)

    # ── 2. Candidate & Completion Statistics ─────────────────────────────
    pdf.section_title("Candidate & Completion Statistics")
    pdf.key_value("Total Candidates:", str(completion["total"]))
    pdf.key_value("Started:", str(completion["started"]))
    pdf.key_value("Submitted:", str(completion["submitted"]))
    pdf.key_value("Evaluated:", str(completion["evaluated"]))
    pdf.key_value("Completion Rate:", f"{completion['completion_rate_pct']}%")
    pdf.key_value(
        "Average Duration:",
        (
            f"{completion['avg_duration_minutes']} minutes"
            if completion["avg_duration_minutes"] is not None
            else "N/A"
        ),
    )
    pdf.ln(3)

    # ── 3. Academic Performance Summary ──────────────────────────────────
    pdf.section_title("Academic Performance Summary")
    pdf.key_value("Graded Candidates:", str(scores["graded"]))
    pdf.key_value(
        "Average Percentage:",
        f"{scores['avg_pct']}%" if scores["avg_pct"] is not None else "N/A",
    )
    pdf.key_value(
        "Median Percentage:",
        f"{scores['median_pct']}%" if scores["median_pct"] is not None else "N/A",
    )
    pdf.key_value(
        "Highest Percentage:",
        f"{scores['highest_pct']}%" if scores["highest_pct"] is not None else "N/A",
    )
    pdf.key_value(
        "Lowest Percentage:",
        f"{scores['lowest_pct']}%" if scores["lowest_pct"] is not None else "N/A",
    )
    pdf.key_value("Not Graded:", str(scores["not_graded"]))
    pdf.ln(3)

    # ── 4. Score Distribution ────────────────────────────────────────────
    pdf.section_title("Score Distribution")
    pdf.distribution_bars(bands)
    pdf.ln(3)

    # ── 5. Proctoring / Risk Summary ─────────────────────────────────────
    pdf.section_title("Proctoring / Risk Summary")
    pdf.distribution_bars(
        [(level.upper(), risk[level]) for level in RISK_LEVELS]
        + [("RISK UNAVAILABLE", risk["unavailable"])]
    )
    pdf.key_value("Severe Integrity Flags:", str(severe))
    pdf.ln(3)

    # ── 6. Top Violation Types ───────────────────────────────────────────
    pdf.section_title("Top Violation Types")
    if histogram:
        pdf.add_table(
            ["Violation Type", "Count"],
            [[vtype, str(count)] for vtype, count in histogram],
            col_ratios=[70, 30],
            aligns=["L", "C"],
        )
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, pdf.clean_text("No violations recorded for this exam."), new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    # ── 7. System Recommendation Distribution ────────────────────────────
    pdf.section_title("System Recommendation Distribution")
    pdf.add_table(
        ["System Recommendation (automated)", "Count"],
        [[code, str(count)] for code, count in recommendations],
        col_ratios=[70, 30],
        aligns=["L", "C"],
    )

    # ── 8. Recruiter Decision Distribution ───────────────────────────────
    pdf.section_title("Recruiter Decision Distribution")
    pdf.add_table(
        ["Recruiter Decision (final human judgment)", "Count"],
        [[decision, str(count)] for decision, count in decisions],
        col_ratios=[70, 30],
        aligns=["L", "C"],
    )
    pdf.set_font(pdf.default_font, "I", 9)
    pdf.multi_cell(pdf.epw, 5, pdf.clean_text(DISCLAIMER), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ── 9. Compact Candidate Roster ──────────────────────────────────────
    pdf.section_title("Candidate Roster")
    if candidates:
        roster_rows = [
            [
                c.get("candidate_name") or "—",
                c.get("candidate_email") or "—",
                f"{c['percentage']}%" if c.get("percentage") is not None else "Not graded",
                (c.get("risk_level") or "N/A") if c.get("risk_available") else "N/A",
                c.get("recommendation", {}).get("code", ""),
                c.get("recruiter_decision") or "PENDING",
            ]
            for c in candidates
        ]
        pdf.add_table(
            ["Candidate Name", "Email", "Score %", "Risk", "System Recommendation", "Recruiter Decision"],
            roster_rows,
            col_ratios=[25, 35, 15, 15, 45, 20],
            aligns=["L", "L", "C", "C", "L", "C"],
        )
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, pdf.clean_text("No attempts recorded for this exam."), new_x="LMARGIN", new_y="NEXT")

    pdf_bytes = pdf.output()
    return bytes(pdf_bytes) if isinstance(pdf_bytes, bytearray) else pdf_bytes
