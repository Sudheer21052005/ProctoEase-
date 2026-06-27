"""
Plagiarism detection service — AST-based token similarity analysis.
Phase 7: Plagiarism Detection.

Approach:
  1. Collect all code submissions for an exam
  2. Tokenize each submission (strip whitespace, comments, variable names)
  3. Compare every pair using token-level similarity (Jaccard + LCS ratio)
  4. Flag pairs exceeding the threshold
"""

from __future__ import annotations

import ast
import hashlib
import itertools
import logging
import re
import tokenize
import io
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.exceptions import ExamNotFound, PlagiarismReportNotFound
from app.models.code_submission import CodeSubmission, SubmissionStatus
from app.models.plagiarism_report import (
    PlagiarismReport, PlagiarismPair, ReportStatus,
)
from app.schemas.plagiarism import PlagiarismTrigger

logger = logging.getLogger("proctoease.plagiarism")


# ── Public API ───────────────────────────────────────────────────


async def trigger_analysis(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
    payload: PlagiarismTrigger,
) -> dict:
    """
    Trigger plagiarism analysis for all code submissions in an exam.
    Runs synchronously for MVP — would move to Celery for production.
    """

    # Collect all accepted submissions for this exam
    submissions = await _get_exam_submissions(db, exam_id, tenant_id)

    # Create report record
    report = PlagiarismReport(
        exam_id=exam_id,
        tenant_id=tenant_id,
        threshold=payload.threshold,
        status=ReportStatus.PROCESSING.value,
    )
    db.add(report)
    await db.flush()

    if len(submissions) < 2:
        report.status = ReportStatus.COMPLETED.value
        report.total_pairs = 0
        report.flagged_pairs = 0
        report.completed_at = datetime.now(timezone.utc)
        await db.flush()
        return _serialize_report(report, [])

    try:
        # Tokenize all submissions
        token_map: dict[uuid.UUID, list[str]] = {}
        for sub in submissions:
            token_map[sub.id] = _tokenize_code(sub.source_code)

        # Pairwise comparison
        pairs_created = 0
        pairs_flagged = 0

        pairs_list = []

        for sub_a, sub_b in itertools.combinations(submissions, 2):
            tokens_a = token_map.get(sub_a.id, [])
            tokens_b = token_map.get(sub_b.id, [])

            score, matching, total_a, total_b = _compute_similarity(
                tokens_a, tokens_b
            )

            flagged = score >= payload.threshold

            pair = PlagiarismPair(
                report_id=report.id,
                tenant_id=tenant_id,
                submission_a_id=sub_a.id,
                submission_b_id=sub_b.id,
                candidate_a_id=sub_a.attempt.candidate_id,
                candidate_b_id=sub_b.attempt.candidate_id,
                similarity_score=round(score, 4),
                is_flagged=flagged,
                matching_tokens=matching,
                total_tokens_a=total_a,
                total_tokens_b=total_b,
                details={
                    "method": "token_jaccard_lcs",
                    "language": sub_a.language_name,
                },
            )
            db.add(pair)
            pairs_list.append(pair)
            pairs_created += 1
            if flagged:
                pairs_flagged += 1

        report.total_pairs = pairs_created
        report.flagged_pairs = pairs_flagged
        report.status = ReportStatus.COMPLETED.value
        report.completed_at = datetime.now(timezone.utc)
        
        await db.flush()
        # Explicitly assign pairs AFTER flush to avoid SQLAlchemy clearing them and causing lazy-loading
        report.pairs = pairs_list

        logger.info(
            "plagiarism_analysis exam_id=%s pairs=%d flagged=%d",
            exam_id, pairs_created, pairs_flagged,
        )

    except Exception as exc:
        logger.exception("plagiarism_analysis_failed exam_id=%s: %s", exam_id, exc)
        report.status = ReportStatus.FAILED.value
        await db.flush()
        pairs_list = []

    return _serialize_report(report, pairs_list)


async def get_report(
    db: AsyncSession,
    report_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> dict:
    """Get a plagiarism report by ID."""
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(PlagiarismReport)
        .options(selectinload(PlagiarismReport.pairs))
        .execution_options(populate_existing=True)
        .where(
            and_(
                PlagiarismReport.id == report_id,
                PlagiarismReport.tenant_id == tenant_id,
            )
        )
    )
    report = result.scalar_one_or_none()
    if report is None:
        raise PlagiarismReportNotFound()
    return _serialize_report(report, report.pairs)


async def get_exam_reports(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[PlagiarismReport]:
    """List all plagiarism reports for an exam."""
    result = await db.execute(
        select(PlagiarismReport)
        .where(
            and_(
                PlagiarismReport.exam_id == exam_id,
                PlagiarismReport.tenant_id == tenant_id,
            )
        )
        .order_by(PlagiarismReport.created_at.desc())
    )
    return list(result.scalars().all())


# ── Token-based similarity engine ────────────────────────────────


def _tokenize_code(source_code: str) -> list[str]:
    """
    Tokenize source code, stripping:
    - Whitespace and comments
    - Variable / function names (replaced with generic tokens)
    - Import statements (boilerplate)

    This makes it harder to cheat by simply renaming variables.
    """
    # Try Python tokenizer first
    try:
        return _tokenize_python(source_code)
    except tokenize.TokenError:
        pass

    # Fallback: language-agnostic alphanumeric tokenization
    return _tokenize_generic(source_code)


def _serialize_report(report: PlagiarismReport, pairs: list[PlagiarismPair] | None = None) -> dict:
    """Serialize report and pairs into a plain dict for FastAPI response models."""
    pairs = pairs or []
    return {
        "id": report.id,
        "exam_id": report.exam_id,
        "status": report.status,
        "total_pairs": report.total_pairs,
        "flagged_pairs": report.flagged_pairs,
        "threshold": report.threshold,
        "created_at": report.created_at,
        "completed_at": report.completed_at,
        "tenant_id": report.tenant_id,
        "pairs": [
            {
                "id": p.id,
                "submission_a_id": p.submission_a_id,
                "submission_b_id": p.submission_b_id,
                "candidate_a_id": p.candidate_a_id,
                "candidate_b_id": p.candidate_b_id,
                "similarity_score": p.similarity_score,
                "is_flagged": p.is_flagged,
                "matching_tokens": p.matching_tokens,
                "total_tokens_a": p.total_tokens_a,
                "total_tokens_b": p.total_tokens_b,
                "details": p.details,
            }
            for p in pairs
        ],
    }


def _tokenize_python(source_code: str) -> list[str]:
    """Python-specific tokenization using the ast module."""
    tokens = []
    reader = io.StringIO(source_code)

    for tok in tokenize.generate_tokens(reader.readline):
        # Skip comments, whitespace, encoding, endmarker
        if tok.type in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE,
                        tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING,
                        tokenize.ENDMARKER):
            continue

        # Normalize identifiers (variable/function names → "ID")
        if tok.type == tokenize.NAME:
            # Keep Python keywords as-is (if, for, while, def, class, etc.)
            import keyword
            if keyword.iskeyword(tok.string):
                tokens.append(tok.string)
            else:
                tokens.append("ID")
        elif tok.type == tokenize.NUMBER:
            tokens.append("NUM")
        elif tok.type == tokenize.STRING:
            tokens.append("STR")
        else:
            tokens.append(tok.string)

    return tokens


def _tokenize_generic(source_code: str) -> list[str]:
    """
    Language-agnostic tokenization.
    Splits on whitespace/punctuation, normalizes identifiers to 'ID'.
    """
    # Remove single-line comments (// and #)
    code = re.sub(r'(//|#).*$', '', source_code, flags=re.MULTILINE)
    # Remove multi-line comments (/* ... */)
    code = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)

    # Common keywords across languages
    keywords = {
        'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
        'continue', 'return', 'def', 'class', 'function', 'var', 'let',
        'const', 'int', 'float', 'double', 'string', 'bool', 'void',
        'public', 'private', 'static', 'import', 'from', 'include',
        'try', 'catch', 'finally', 'throw', 'new', 'delete', 'null',
        'true', 'false', 'and', 'or', 'not', 'in', 'is', 'print',
    }

    tokens = []
    for word in re.findall(r'[a-zA-Z_]\w*|[^\s\w]|\d+', code):
        if word in keywords:
            tokens.append(word)
        elif word.isdigit():
            tokens.append("NUM")
        elif re.match(r'^[a-zA-Z_]', word):
            tokens.append("ID")
        else:
            tokens.append(word)

    return tokens


def _compute_similarity(
    tokens_a: list[str],
    tokens_b: list[str],
) -> tuple[float, int, int, int]:
    """
    Compute similarity between two token lists using a combined metric:
    - Jaccard similarity (set overlap)
    - LCS ratio (longest common subsequence / max length)

    Returns: (score, matching_tokens, total_a, total_b)
    """
    if not tokens_a or not tokens_b:
        return 0.0, 0, len(tokens_a), len(tokens_b)

    # Jaccard similarity (on token n-grams for better accuracy)
    ngram_size = 3
    ngrams_a = _make_ngrams(tokens_a, ngram_size)
    ngrams_b = _make_ngrams(tokens_b, ngram_size)

    if not ngrams_a or not ngrams_b:
        # Fall back to simple token comparison if too short
        set_a, set_b = set(tokens_a), set(tokens_b)
        intersection = len(set_a & set_b)
        union = len(set_a | set_b)
        jaccard = intersection / union if union > 0 else 0.0
        return jaccard, intersection, len(tokens_a), len(tokens_b)

    set_a = set(ngrams_a)
    set_b = set(ngrams_b)
    intersection = len(set_a & set_b)
    union = len(set_a | set_b)

    jaccard = intersection / union if union > 0 else 0.0

    # LCS ratio (approximate using hashed subsequences for performance)
    lcs_len = _lcs_length(tokens_a, tokens_b)
    max_len = max(len(tokens_a), len(tokens_b))
    lcs_ratio = lcs_len / max_len if max_len > 0 else 0.0

    # Combined score: weighted average
    score = 0.4 * jaccard + 0.6 * lcs_ratio
    matching = int(intersection)

    return score, matching, len(tokens_a), len(tokens_b)


def _make_ngrams(tokens: list[str], n: int) -> list[str]:
    """Create n-gram fingerprints from token list."""
    if len(tokens) < n:
        return []
    return [" ".join(tokens[i : i + n]) for i in range(len(tokens) - n + 1)]


def _lcs_length(a: list[str], b: list[str]) -> int:
    """
    Longest Common Subsequence length.
    Uses optimized O(n*m) DP, but capped at 500 tokens for performance.
    """
    MAX_TOKENS = 500
    a = a[:MAX_TOKENS]
    b = b[:MAX_TOKENS]

    m, n = len(a), len(b)
    # Space-optimized: only keep two rows
    prev = [0] * (n + 1)
    curr = [0] * (n + 1)

    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                curr[j] = prev[j - 1] + 1
            else:
                curr[j] = max(prev[j], curr[j - 1])
        prev, curr = curr, [0] * (n + 1)

    return prev[n]


# ── Helpers ──────────────────────────────────────────────────────


async def _get_exam_submissions(
    db: AsyncSession,
    exam_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[CodeSubmission]:
    """Get all accepted code submissions for an exam (across all attempts)."""
    from app.models.attempt import ExamAttempt

    result = await db.execute(
        select(CodeSubmission)
        .options(joinedload(CodeSubmission.attempt))
        .join(ExamAttempt, CodeSubmission.attempt_id == ExamAttempt.id)
        .where(
            and_(
                ExamAttempt.exam_id == exam_id,
                CodeSubmission.tenant_id == tenant_id,
                CodeSubmission.status == SubmissionStatus.ACCEPTED.value,
            )
        )
    )
    return list(result.unique().scalars().all())
