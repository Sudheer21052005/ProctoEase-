"""
Integrity Report PDF generation service.
Generates a candidate integrity report for a single exam attempt.

Phase A presentation hardening (all changes are layout-only — every value,
timestamp, score and string rendered is byte-identical to the source data):
 - dynamic column widths derived from the printable width (epw)
 - multi-line cell wrapping via multi_cell with measured row heights
 - per-row page-break checks with repeated table headers (no split rows,
   no orphaned section titles: a heading whose first content item cannot fit
   moves to the next page together with that item)
 - zero truncation of question text, answers, descriptions or traces
 - bounded multi_cell boxes for stdout / stderr / compile output
 - aspect-preserving snapshots in a compact two-column evidence grid
   (each image <= ~80 mm wide / <= ~58 mm tall; a source frame is downsampled
   ONLY for the embedded copy when it carries more pixels than that size needs
   — the stored file is never modified), with styled callouts for missing or
   corrupt images
"""

from __future__ import annotations

import io
import logging
import math
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

# ── Layout constants (millimetres) ──────────────────────────────────────────
LINE_H = 5.0          # text line height in tables / key-value rows
CELL_PAD = 1.5        # vertical padding added to the tallest cell in a row
SECTION_TITLE_H = 10.0    # vertical space a section heading itself consumes
SECTION_MIN_SPACE = 26.0  # section title + ~2 body lines kept together
PX_TO_MM = 0.264583   # 96 dpi pixel → millimetre conversion

# ── Evidence-snapshot grid (compact two-column layout) ───────────────────────
SNAPSHOT_COLS = 2            # snapshots per row
SNAPSHOT_GUTTER = 8.0        # horizontal gap between the two columns (mm)
SNAPSHOT_LABEL_H = 6.0       # height of one "event - time" label line (mm)
SNAPSHOT_IMG_MAX_W = 80.0    # image display width cap (mm) — target 70–80
SNAPSHOT_IMG_MAX_H = 58.0    # image display height cap (mm) — target 55–60
SNAPSHOT_ROW_GAP = 6.0       # vertical gap between snapshot rows (mm)
SNAPSHOT_RENDER_DPI = 200    # print-quality ceiling for the temp downsampled copy
SNAPSHOT_JPEG_QUALITY = 85   # temp-copy JPEG quality (visually lossless; not aggressive)


class IntegrityReportPDF(FPDF):
    """Custom PDF class for integrity report with Unicode support."""

    def __init__(self):
        super().__init__()
        # Add Unicode fonts if present
        if DEJAVU_REGULAR.exists():
            self.add_font("DejaVu", "", str(DEJAVU_REGULAR))
            self.add_font("DejaVu", "B", str(DEJAVU_BOLD))
            self.add_font("DejaVu", "I", str(DEJAVU_OBLIQUE))
            self.add_font("DejaVu", "BI", str(DEJAVU_BOLD_OBLIQUE))
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

    # ── Page furniture ────────────────────────────────────────────────

    def header(self):
        self.set_font(self.default_font, "B", 14)
        self.cell(0, 10, self.clean_text("Candidate Integrity Report"), align="C", new_x="LMARGIN", new_y="NEXT")
        self.line(self.l_margin, self.get_y(), self.l_margin + self.epw, self.get_y())
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font(self.default_font, "I", 8)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    # ── Layout primitives ─────────────────────────────────────────────

    def ensure_space(self, needed_h: float):
        """Start a new page when `needed_h` mm no longer fit above the
        page-break trigger. Prevents orphaned headings and split rows."""
        if self.get_y() + needed_h > self.page_break_trigger:
            self.add_page()

    def _measure_lines(self, text: str, width: float) -> int:
        """Number of wrapped lines `text` occupies at `width` (>= 1)."""
        cleaned = self.clean_text(text)
        if not cleaned:
            return 1
        lines = self.multi_cell(width, LINE_H, cleaned, dry_run=True, output="LINES")
        return max(1, len(lines))

    def section_title(self, title: str, keep_with_next: float = 0.0):
        """Draw a shaded section heading, reserving space so it is never left
        alone at the foot of a page. Reserves at least SECTION_MIN_SPACE, or
        the heading block plus ``keep_with_next`` mm — the measured height of
        the first content item (e.g. a tall snapshot image) — when that is
        larger, so a heading whose first item cannot fit breaks to the next
        page together with that item instead of orphaning."""
        self.ensure_space(max(SECTION_MIN_SPACE, SECTION_TITLE_H + keep_with_next))
        self.set_font(self.default_font, "B", 12)
        self.set_fill_color(230, 230, 230)
        self.cell(0, 8, self.clean_text(title), fill=True, new_x="LMARGIN", new_y="NEXT")
        self.ln(2)

    def key_value(self, key: str, value: str):
        key_w = 60.0
        self.set_font(self.default_font, "B", 10)
        self.cell(key_w, LINE_H, self.clean_text(key))
        self.set_font(self.default_font, "", 10)
        # multi_cell: long exam titles / emails wrap instead of spilling
        self.multi_cell(self.epw - key_w, LINE_H, self.clean_text(value), new_x="LMARGIN", new_y="NEXT")

    def callout(self, text: str):
        """Bordered, tinted single-block notice (e.g. snapshot fallback)."""
        self.set_font(self.default_font, "I", 9)
        self.set_fill_color(245, 240, 240)
        self.set_draw_color(200, 180, 180)
        self.multi_cell(self.epw, LINE_H + 1, self.clean_text(text), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(0, 0, 0)

    def add_table(
        self,
        headers: list[str],
        rows: list[list[str]],
        col_ratios: list[float] | None = None,
        aligns: list[str] | None = None,
        cell_style: Any | None = None,
    ):
        """Wrapping table: widths derived from epw, row heights measured,
        page breaks between rows (never inside one), header repeated."""
        if not rows:
            self.set_font(self.default_font, "I", 10)
            self.cell(0, 6, self.clean_text("No data"), new_x="LMARGIN", new_y="NEXT")
            return

        n = len(headers)
        if col_ratios is None:
            col_ratios = [1.0] * n
        ratio_sum = float(sum(col_ratios)) or 1.0
        widths = [self.epw * (r / ratio_sum) for r in col_ratios]
        if aligns is None:
            aligns = ["L"] * n

        def render_header_row():
            self.set_font(self.default_font, "B", 9)
            self.set_fill_color(200, 200, 200)
            h_lines = max(self._measure_lines(h, widths[i]) for i, h in enumerate(headers))
            row_h = h_lines * LINE_H + CELL_PAD
            x0, y0 = self.get_x(), self.get_y()
            for i, header in enumerate(headers):
                self.multi_cell(widths[i], LINE_H, self.clean_text(header), border=1, fill=True, align="C", new_x="RIGHT", new_y="TOP")
            self.set_xy(x0, y0 + row_h)

        def render_row(row: list[str], fill: bool):
            self.set_font(self.default_font, "", 9)
            if fill:
                self.set_fill_color(245, 245, 245)
            else:
                self.set_fill_color(255, 255, 255)
            row_lines = max(self._measure_lines(str(cell), widths[i]) for i, cell in enumerate(row))
            row_h = row_lines * LINE_H + CELL_PAD
            # Whole-row page break; the header repeats on the new page so
            # no row is ever split across pages or left headerless.
            if self.get_y() + row_h > self.page_break_trigger:
                self.add_page()
                render_header_row()
            x0, y0 = self.get_x(), self.get_y()
            for i, cell in enumerate(row):
                self.multi_cell(widths[i], LINE_H, self.clean_text(str(cell)), border=1, fill=fill, align=aligns[i], new_x="RIGHT", new_y="TOP")
            # Optional per-cell styling hook (e.g. semantic fills in the
            # exam-wide summary roster). Default None: behaviour unchanged.
            if cell_style is not None:
                for i in range(len(row)):
                    cell_style(i, x0 + sum(widths[:i]), y0, widths[i], row_h, row)
            self.set_xy(x0, y0 + row_h)

        render_header_row()
        fill = False
        for row in rows:
            render_row(row, fill)
            fill = not fill
        self.ln(3)

    def _snapshot_display_dims(self, img_w_px: int, img_h_px: int, col_w: float) -> tuple[float, float]:
        """Aspect-preserved on-page size (mm) for a snapshot in a grid column.
        Width and height scale by the SAME factor — the image is never cropped
        or distorted. Never upscaled beyond the source's natural 96-dpi size,
        never wider than the column or ``SNAPSHOT_IMG_MAX_W``, never taller than
        ``SNAPSHOT_IMG_MAX_H``. Raises ValueError on a zero/negative dimension."""
        if img_w_px <= 0 or img_h_px <= 0:
            raise ValueError("image has zero dimension")
        aspect = img_h_px / img_w_px
        disp_w = min(SNAPSHOT_IMG_MAX_W, col_w, img_w_px * PX_TO_MM)
        disp_h = disp_w * aspect
        if disp_h > SNAPSHOT_IMG_MAX_H:
            disp_h = SNAPSHOT_IMG_MAX_H
            disp_w = disp_h / aspect
        return disp_w, disp_h

    def _prepare_snapshot_source(self, abs_path: Path, img_w_px: int, img_h_px: int, disp_w: float):
        """Return an fpdf2 image source for a snapshot, downsampling ONLY when
        the stored file carries more pixels than its on-page size needs at
        ``SNAPSHOT_RENDER_DPI``. The common production frame (320x240) is already
        small enough and is embedded verbatim (its path is returned unchanged);
        an oversized frame is resized with Lanczos into an in-memory copy and
        re-encoded in its SOURCE format (JPEG q=85 / optimized PNG). The stored
        file on disk is never modified — only this temporary representation is
        optimized, preserving enough resolution for evidence inspection."""
        target_px_w = max(1, math.ceil(disp_w / 25.4 * SNAPSHOT_RENDER_DPI))
        if img_w_px <= target_px_w:
            return str(abs_path)  # already <= what the display size needs: embed as-is
        target_px_h = max(1, round(img_h_px * target_px_w / img_w_px))
        with Image.open(abs_path) as img:
            fmt = (img.format or "").upper()
            resized = img.resize((target_px_w, target_px_h), Image.Resampling.LANCZOS)
            buf = io.BytesIO()
            if fmt == "PNG":
                resized.save(buf, format="PNG", optimize=True)
            elif fmt in ("JPEG", "JPG", "MPO"):
                resized.convert("RGB").save(buf, format="JPEG", quality=SNAPSHOT_JPEG_QUALITY, optimize=True)
            else:
                return str(abs_path)  # unfamiliar format: embed the original, never re-encode blindly
        buf.seek(0)
        return buf

    def _plan_snapshot_cell(self, event_type: str, time_str: str, abs_path: Path | None, col_w: float) -> dict:
        """Measure one grid cell WITHOUT drawing it, so a row's height is known
        before layout (page breaks fall between rows, never inside a cell). A
        readable image plans as label + aspect-fit image; a missing, escaping or
        unreadable reference plans as label + the styled 'unavailable' callout.
        Fonts are set to match rendering so wrapped line counts are accurate."""
        label = f"{event_type} - {time_str}"
        self.set_font(self.default_font, "B", 10)
        label_h = max(1, self._measure_lines(label, col_w)) * SNAPSHOT_LABEL_H
        dims = None
        px = None
        if abs_path is not None and abs_path.exists():
            try:
                with Image.open(abs_path) as img:
                    px = img.size
                dims = self._snapshot_display_dims(px[0], px[1], col_w)
            except Exception:
                dims = None
                px = None
        if dims is not None:
            kind = "image"
            content_h = dims[1]
        else:
            kind = "callout"
            callout = f"[Snapshot unavailable: {event_type} at {time_str}]"
            self.set_font(self.default_font, "I", 9)
            content_h = max(1, self._measure_lines(callout, col_w)) * (LINE_H + 1)
        return {
            "kind": kind, "label": label, "label_h": label_h,
            "content_h": content_h, "total_h": label_h + content_h,
            "abs_path": abs_path, "px": px, "dims": dims,
            "event_type": event_type, "time_str": time_str,
        }

    def _render_snapshot_cell(self, x: float, y: float, col_w: float, plan: dict) -> None:
        """Draw one planned cell at (x, y): the bold 'event - time' label, then
        the aspect-fit image (downsampled only if oversized) or the styled
        callout. A rare decode failure at embed time falls back to the callout;
        the row already reserved the (larger) image height, so nothing overlaps.
        Each cell is drawn fully before the next, so its text never interleaves
        with the adjacent column's."""
        self.set_xy(x, y)
        self.set_font(self.default_font, "B", 10)
        self.multi_cell(col_w, SNAPSHOT_LABEL_H, self.clean_text(plan["label"]), new_x="LMARGIN", new_y="NEXT")
        content_y = y + plan["label_h"]
        if plan["kind"] == "image":
            try:
                w, h = plan["px"]
                disp_w, disp_h = plan["dims"]
                source = self._prepare_snapshot_source(plan["abs_path"], w, h, disp_w)
                self.image(source, x=x, y=content_y, w=disp_w, h=disp_h)
                return
            except Exception as exc:
                logger.warning("Failed to embed snapshot %s: %s", plan["abs_path"], exc)
                # fall through to the callout (reserved image height >= callout height)
        self.set_xy(x, content_y)
        self.set_font(self.default_font, "I", 9)
        self.set_fill_color(245, 240, 240)
        self.set_draw_color(200, 180, 180)
        self.multi_cell(
            col_w, LINE_H + 1,
            self.clean_text(f"[Snapshot unavailable: {plan['event_type']} at {plan['time_str']}]"),
            border=1, fill=True, new_x="LMARGIN", new_y="NEXT",
        )
        self.set_draw_color(0, 0, 0)

    def add_snapshot_grid(self, items: list[tuple[str, str, Path | None]]) -> None:
        """Render every snapshot in a compact two-column grid, preserving order.
        Each image keeps its aspect ratio and its event/timestamp label; a whole
        row moves to the next page when it will not fit (rows never split, images
        never clip); missing / corrupt / escaping references render as styled
        callouts in their own cell. No snapshot is dropped, cropped or merged."""
        if not items:
            return
        col_w = (self.epw - SNAPSHOT_GUTTER) / SNAPSHOT_COLS
        col_x = [self.l_margin + c * (col_w + SNAPSHOT_GUTTER) for c in range(SNAPSHOT_COLS)]
        plans = [self._plan_snapshot_cell(et, ts, ap, col_w) for (et, ts, ap) in items]
        for i in range(0, len(plans), SNAPSHOT_COLS):
            row = plans[i:i + SNAPSHOT_COLS]
            row_h = max(p["total_h"] for p in row)
            if self.get_y() + row_h > self.page_break_trigger:
                self.add_page()
            y = self.get_y()
            for c, plan in enumerate(row):
                self._render_snapshot_cell(col_x[c], y, col_w, plan)
            self.set_xy(self.l_margin, y + row_h + SNAPSHOT_ROW_GAP)

    def first_snapshot_row_height(self, items: list[tuple[str, str, Path | None]]) -> float:
        """Height (mm) the first grid row will occupy, so 'Evidence Snapshots'
        can be kept with its first row and never orphaned at a page foot."""
        if not items:
            return 0.0
        col_w = (self.epw - SNAPSHOT_GUTTER) / SNAPSHOT_COLS
        first = [self._plan_snapshot_cell(et, ts, ap, col_w) for (et, ts, ap) in items[:SNAPSHOT_COLS]]
        return max(p["total_h"] for p in first)

    @staticmethod
    def resolve_snapshot_path(rel_path: str) -> Path | None:
        """Map a stored snapshot reference to the on-disk file the recruiter UI serves.

        ``proctoring_image_service.persist_attempt_image`` saves snapshots under
        ``<PROCTORING_UPLOAD_ROOT>/<category>/<file>`` and records the DB value as the
        relative POSIX string ``uploads/proctoring/<category>/<file>`` — the exact value
        the ``/uploads`` StaticFiles mount (app/main.py) serves to the Proctoring
        section. Re-root that stored value under the configured upload root so the PDF
        reads the *same* file, WITHOUT doubling the leading ``uploads/`` segment (the old
        ``.parent / rel_path`` produced ``uploads/uploads/proctoring/...`` → not found).

        Returns ``None`` — rendered as an "unavailable" callout by :meth:`_render_snapshot_cell`
        and reserved as a callout by :meth:`_plan_snapshot_cell` — when the reference
        is empty, or when a *relative* reference would resolve OUTSIDE the upload root
        (path-traversal defense-in-depth; the resolver never reads such a path). Absolute
        paths are returned as-is: production storage never emits them, so an absolute
        value only ever originates from trusted in-process test fixtures / synthetic
        samples, and must keep working.
        """
        raw = (rel_path or "").strip().replace("\\", "/")
        if not raw:
            return None

        candidate = Path(raw)
        if candidate.is_absolute():
            return candidate

        root = Path(settings.PROCTORING_UPLOAD_ROOT)          # e.g. "uploads/proctoring"
        prefix = root.as_posix().rstrip("/") + "/"            # "uploads/proctoring/"
        if raw.startswith(prefix):
            raw = raw[len(prefix):]                            # strip the stored root prefix
        target = root / raw                                   # re-root under the real root

        # Defense-in-depth: the resolved file must stay within the upload root.
        # Reject traversal (e.g. "uploads/proctoring/../../etc/passwd") as unavailable
        # *before* any filesystem access, so a malicious stored value cannot be read.
        try:
            root_resolved = root.resolve()
            resolved = target.resolve()
        except OSError:
            return None
        if resolved != root_resolved and root_resolved not in resolved.parents:
            logger.warning(
                "Snapshot reference escapes upload root; treating as unavailable: %r",
                rel_path,
            )
            return None
        return target

    def trace_block(self, label: str, content: str):
        """Bounded, wrapped text box for multi-line execution traces.
        No truncation: content wraps and flows across pages naturally."""
        # At least the label plus two content lines stay together.
        self.ensure_space(6 + 2 * LINE_H + CELL_PAD)
        self.set_font(self.default_font, "B", 10)
        self.cell(0, 6, self.clean_text(label), new_x="LMARGIN", new_y="NEXT")
        self.set_font(self.default_font, "", 9)
        self.set_fill_color(248, 248, 248)
        indent = 6.0
        x = self.l_margin + indent
        w = self.epw - indent
        self.set_x(x)
        self.multi_cell(w, LINE_H, self.clean_text(content), border=1, fill=True, new_x="LMARGIN", new_y="NEXT")


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
        pdf.multi_cell(pdf.epw, 6, pdf.clean_text(f"  {event_type}: {contribution:.4f} (count: {count})"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # ---- Violation Timeline ----
    pdf.section_title("Violation Timeline")
    if events:
        headers = ["Time (UTC)", "Type", "Severity", "Description"]
        rows = []
        for ev in events:
            time_str = ev.created_at.strftime("%H:%M:%S")
            desc = ev.detail.get("description", "") if ev.detail else ""
            rows.append([time_str, ev.event_type, str(ev.severity), desc])
        pdf.add_table(headers, rows, col_ratios=[30, 40, 20, 100], aligns=["L", "L", "C", "L"])
    else:
        pdf.set_font(pdf.default_font, "I", 10)
        pdf.cell(0, 6, "No violations recorded.", new_x="LMARGIN", new_y="NEXT")
        pdf.ln(3)

    # ---- Embedded Snapshots ----
    # Compact two-column evidence grid: every snapshot is kept (never dropped
    # or deduplicated), aspect-preserved, and paired with its event + timestamp.
    snapshot_events = [ev for ev in events if ev.snapshot_path]
    snapshot_items = [
        (ev.event_type, ev.created_at.strftime("%H:%M:%S"), pdf.resolve_snapshot_path(ev.snapshot_path))
        for ev in snapshot_events
    ]
    # Keep the heading with its first row: a tall first row otherwise triggers
    # its own page break *after* the heading is drawn, stranding the heading at
    # the foot of the previous page.
    pdf.section_title(
        "Evidence Snapshots",
        keep_with_next=pdf.first_snapshot_row_height(snapshot_items),
    )
    if snapshot_items:
        pdf.add_snapshot_grid(snapshot_items)
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
                    q.question_text,
                    q.question_type,
                    selected_str,
                    "Correct" if is_correct else "Incorrect" if is_correct is not None else "Ungraded",
                    f"{points}/{q.points}"
                ])
    if objective_rows:
        pdf.add_table(
            ["Question", "Type", "Selected", "Result", "Score"],
            objective_rows,
            col_ratios=[70, 25, 45, 25, 25],
            aligns=["L", "L", "L", "C", "C"],
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
                    q.question_text,
                    language,
                    "Passed" if is_correct else "Failed" if is_correct is not None else "Ungraded",
                    f"{points}/{q.points}"
                ])
    if code_rows:
        pdf.add_table(
            ["Question", "Language", "Result", "Score"],
            code_rows,
            col_ratios=[60, 30, 30, 30],
            aligns=["L", "L", "C", "C"],
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
                pdf.ensure_space(6 * 4)
                pdf.set_font(pdf.default_font, "B", 10)
                pdf.multi_cell(pdf.epw, 6, pdf.clean_text(f"{q.question_text} ({latest_sub.language_name})"), new_x="LMARGIN", new_y="NEXT")
                pdf.set_font(pdf.default_font, "", 10)
                pdf.cell(0, 6, pdf.clean_text(f"  Status: {latest_sub.status.replace('_', ' ').title()}"), new_x="LMARGIN", new_y="NEXT")
                if latest_sub.stdout:
                    pdf.trace_block("  Stdout:", latest_sub.stdout)
                if latest_sub.stderr:
                    pdf.trace_block("  Stderr:", latest_sub.stderr)
                if latest_sub.compile_output:
                    pdf.trace_block("  Compile output:", latest_sub.compile_output)
                pdf.cell(0, 6, pdf.clean_text(f"  Time: {latest_sub.time_sec:.3f}s  Memory: {latest_sub.memory_kb} KB"), new_x="LMARGIN", new_y="NEXT")
                pdf.ln(2)
            else:
                pdf.set_font(pdf.default_font, "I", 10)
                pdf.multi_cell(pdf.epw, 6, pdf.clean_text(f"{q.question_text}: No submissions"), new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    # Output PDF as bytes
    pdf_bytes = pdf.output()
    return bytes(pdf_bytes) if isinstance(pdf_bytes, bytearray) else pdf_bytes
