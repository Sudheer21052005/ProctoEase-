"""
Exam-wide Summary Report PDF service (Phase F, polished presentation).

A recruiter-facing, exam-level summary PDF — distinct from the individual
Candidate Integrity Report. It is a pure RENDERER over the canonical
evaluation payload: ``get_exam_evaluation`` is called EXACTLY ONCE and every
statistic in the document is a deterministic Python aggregation over that
payload. Risk is never recomputed; the Phase B recommendation engine is never
re-derived; the Phase D recruiter decision is reported separately from the
system recommendation (and never changes it).

Presentation system (restrained, professional):
 - NAVY primary for headings, rules and score-distribution bars.
 - Semantic colors ONLY where they carry meaning: green = LOW / SHORTLISTED,
   amber = MEDIUM / HIGH / REVIEW, red = CRITICAL / REJECTED, gray =
   PENDING / neutral.
 - System Recommendation stays visually NEUTRAL (plain table, no fills) — it
   is automated decision support, never a human decision.
 - Recruiter Decision carries the semantic colors — it is the final human
   judgment.
"""

from __future__ import annotations

import uuid
from collections import Counter
from statistics import median
from typing import Any, Mapping

from app.services.exam_evaluation_service import get_exam_evaluation
from app.services.integrity_report_service import SECTION_MIN_SPACE, IntegrityReportPDF

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
BAR_MAX_WIDTH = 70.0   # mm of bar at the peak count
BAR_H = 5.0            # thicker, per the polish pass
LABEL_W = 52.0
COUNT_W = 16.0

# Restrained palette (RGB 0–255)
NAVY = (30, 58, 138)
NAVY_FILL = (219, 228, 246)
INK = (31, 41, 55)
MUTED = (107, 114, 128)
GREEN = (21, 128, 61)
GREEN_FILL = (209, 250, 229)
AMBER = (180, 83, 9)
AMBER_FILL = (254, 243, 199)
RED = (185, 28, 28)
RED_FILL = (254, 202, 202)
GRAY_FILL = (243, 244, 246)

RISK_FILLS = {"low": GREEN_FILL, "medium": AMBER_FILL, "high": AMBER_FILL, "critical": RED_FILL}
RISK_BAR_COLORS = {
    "low": GREEN,
    "medium": AMBER,
    "high": (234, 88, 12),
    "critical": RED,
}
DECISION_FILLS = {
    "PENDING": GRAY_FILL,
    "SHORTLISTED": GREEN_FILL,
    "REVIEW": AMBER_FILL,
    "REJECTED": RED_FILL,
}


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
    """Exam-Wide Evaluation Summary.

    Page furniture (navy header/footer/section titles/stat blocks) is inherited
    from the shared IntegrityReportPDF base via the report_title attribute —
    one styling system for every ProctoEase report. Only the distribution
    bars are summary-specific."""

    report_title = "Exam-Wide Evaluation Summary"
    report_subtitle = None

    def distribution_bars(
        self,
        rows: list[tuple[str, int]],
        colors: list[Any] | None = None,
    ):
        """Label | bar | right-aligned count. Pure fpdf2 rects; page-safe."""
        peak = max((n for _, n in rows), default=0)
        scale = (BAR_MAX_WIDTH / peak) if peak > 0 else 0.0
        for idx, (label, count) in enumerate(rows):
            self.ensure_space(BAR_H + 3)
            self.set_font(self.default_font, "", 9)
            self.set_text_color(*INK)
            self.cell(LABEL_W, BAR_H + 1, self.clean_text(label), align="L")
            bar_color = colors[idx] if colors and colors[idx] is not None else NAVY
            self.set_fill_color(*bar_color)
            bar_w = count * scale
            if bar_w > 0:
                self.rect(self.l_margin + LABEL_W, self.get_y() + 0.5, bar_w, BAR_H, style="F")
            self.set_x(self.l_margin + LABEL_W + BAR_MAX_WIDTH + 4)
            self.set_font(self.default_font, "B", 9)
            self.cell(COUNT_W, BAR_H + 1, self.clean_text(str(count)), align="R", new_x="LMARGIN", new_y="NEXT")
        self.set_text_color(*INK)


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
    pdf.set_auto_page_break(auto=True, margin=24)
    pdf.add_page()

    # ── 1. Exam Overview ─────────────────────────────────────────────────
    pdf.section_title("Exam Overview")
    pdf.key_value("Exam Title:", str(evaluation.get("exam_title") or "Unknown"))
    pdf.key_value("Exam ID:", str(evaluation.get("exam_id") or ""))
    pdf.ln(1)
    pdf.stat_block(
        [
            ("Total Attempts", str(completion["total"])),
            ("Completion Rate", f"{completion['completion_rate_pct']}%"),
            (
                "Average Duration (start → submit)",
                (
                    f"{completion['avg_duration_minutes']} min"
                    if completion["avg_duration_minutes"] is not None
                    else "N/A"
                ),
            ),
            ("Passing Score", f"{evaluation.get('passing_score_pct')}%"),
            ("Borderline Maximum", f"{evaluation.get('borderline_max_pct')}%"),
            ("Excellence Score", f"{evaluation.get('excellence_score_pct')}%"),
        ]
    )
    pdf.ln(1)

    # ── 2. Candidate & Completion Statistics ─────────────────────────────
    pdf.section_title("Candidate & Completion Statistics")
    pdf.key_value("Total Candidates:", str(completion["total"]))
    pdf.key_value("Started:", str(completion["started"]))
    pdf.key_value("Submitted:", str(completion["submitted"]))
    pdf.key_value("Evaluated:", str(completion["evaluated"]))
    pdf.key_value("Completion Rate:", f"{completion['completion_rate_pct']}%")
    pdf.key_value(
        "Average Duration (start → submit):",
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
        + [("RISK UNAVAILABLE", risk["unavailable"])],
        colors=[RISK_BAR_COLORS[level] for level in RISK_LEVELS] + [None],
    )
    # Emphasised severe-integrity total (exact value preserved).
    pdf.ensure_space(8)
    pdf.set_font(pdf.default_font, "B", 10)
    pdf.set_text_color(*(RED if severe > 0 else INK))
    pdf.cell(0, 7, pdf.clean_text(f"Severe Integrity Flags: {severe}"), new_x="LMARGIN", new_y="NEXT")
    pdf.set_text_color(*INK)
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
    # Deliberately NEUTRAL: plain table, no semantic colors — these are
    # automated engine outputs, not human decisions.
    pdf.section_title("System Recommendation Distribution")
    pdf.add_table(
        ["System Recommendation (automated)", "Count"],
        [[code, str(count)] for code, count in recommendations],
        col_ratios=[70, 30],
        aligns=["L", "C"],
    )

    # ── 8. Recruiter Decision Distribution ───────────────────────────────
    # Semantic colors: the final HUMAN judgment.
    pdf.section_title("Recruiter Decision Distribution")
    pdf.add_table(
        ["Recruiter Decision (final human judgment)", "Count"],
        [[decision, str(count)] for decision, count in decisions],
        col_ratios=[70, 30],
        aligns=["L", "C"],
        cell_style=lambda i, x, y, w, h, row: (
            _fill_cell(pdf, x, y, w, h, DECISION_FILLS.get(row[0], GRAY_FILL))
            if i == 0
            else None
        ),
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
                (c.get("risk_level") or "—") if c.get("risk_available") else "N/A",
                c.get("recommendation", {}).get("code", ""),
                c.get("recruiter_decision") or "PENDING",
            ]
            for c in candidates
        ]

        def roster_cell_style(i, x, y, w, h, row):
            if i == 3:  # Risk
                fill = RISK_FILLS.get(row[3].lower())
            elif i == 5:  # Recruiter Decision
                fill = DECISION_FILLS.get(row[5], GRAY_FILL)
            else:
                return
            if fill:
                _fill_cell(pdf, x, y, w, h, fill)

        # Email column widened vs the first pass to reduce wrapping; the
        # hardened add_table still wraps/paginates/repeats headers.
        pdf.add_table(
            ["Candidate Name", "Email", "Score %", "Risk", "System Recommendation", "Recruiter Decision"],
            roster_rows,
            col_ratios=[20, 40, 12, 12, 45, 22],
            aligns=["L", "L", "C", "C", "L", "C"],
            cell_style=roster_cell_style,
        )
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, pdf.clean_text("No attempts recorded for this exam."), new_x="LMARGIN", new_y="NEXT")

    pdf_bytes = pdf.output()
    return bytes(pdf_bytes) if isinstance(pdf_bytes, bytearray) else pdf_bytes


def _fill_cell(pdf: _SummaryReportPDF, x: float, y: float, w: float, h: float, fill: tuple[int, int, int]):
    """Paint a translucent tint over an already-drawn table cell. Cells are
    rendered (text included) before the hook fires, so the tint MUST be
    semi-transparent — the cell text remains readable through it."""
    with pdf.local_context(fill_opacity=0.45):
        pdf.set_fill_color(*fill)
        pdf.rect(x, y, w, h, style="F")
