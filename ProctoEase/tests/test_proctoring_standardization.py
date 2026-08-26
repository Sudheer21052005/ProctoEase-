import re
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.v1 import proctoring
from app.config.violation_guidelines import (
    CANONICAL_VIOLATION_TYPES,
    DEFAULT_RISK_WEIGHTS,
    GATING_VIOLATION_TYPES,
    NON_GATING_VIOLATIONS,
    VIOLATION_GUIDELINES,
    counts_toward_gate,
)
from app.core.exceptions import BadRequest
from app.models.proctoring_event import ProctoringEvent
from app.schemas.proctoring import ViolationCount
from app.services import proctoring_service


class DummyUser:
    pass


def test_legacy_event_type_is_normalized():
    assert proctoring_service.normalize_event_type("keyboard_shortcut") == "keyboard_block"


def test_unknown_event_type_rejected():
    with pytest.raises(BadRequest):
        proctoring_service.normalize_event_type("definitely_unknown_event")


def test_guidelines_cover_all_canonical_types():
    assert set(CANONICAL_VIOLATION_TYPES).issubset(set(VIOLATION_GUIDELINES.keys()))

    for violation_type in CANONICAL_VIOLATION_TYPES:
        guideline = VIOLATION_GUIDELINES[violation_type]
        assert guideline["severity"] in {"low", "medium", "high", "critical"}
        assert guideline["description"]
        assert guideline["impact"]
        assert guideline["recommended_action"]


def test_default_risk_weights_cover_all_canonical_types():
    assert set(CANONICAL_VIOLATION_TYPES).issubset(set(DEFAULT_RISK_WEIGHTS.keys()))


@pytest.mark.asyncio
async def test_violation_guidelines_endpoint_returns_catalog():
    data = await proctoring.violation_guidelines(DummyUser())
    assert isinstance(data, dict)
    assert "tab_switch" in data
    assert data["tab_switch"]["severity"]


# ── Termination gate (max-violations) behaviour ──────────────────
#
# periodic_check fires every 75s during a normal attempt. It must be recorded
# and scored, but must NOT consume the candidate's violation budget, or a clean
# ~10-minute exam would auto-submit itself. See app/api/v1/proctoring.py — the
# WS ack sends gate_total as `violation_count`.


def _event(event_type: str, attempt_id, tenant_id, severity: int = 1) -> ProctoringEvent:
    return ProctoringEvent(
        attempt_id=attempt_id,
        tenant_id=tenant_id,
        event_type=event_type,
        severity=severity,
    )


async def _count_with_events(event_types: list[str]) -> dict:
    """Run count_violations against a stubbed event list (no DB required)."""
    attempt_id, tenant_id = uuid4(), uuid4()
    events = [_event(t, attempt_id, tenant_id) for t in event_types]
    with patch.object(
        proctoring_service, "list_events", new=AsyncMock(return_value=events)
    ):
        return await proctoring_service.count_violations(
            db=MagicMock(), attempt_id=attempt_id, tenant_id=tenant_id
        )


def test_periodic_check_is_the_only_non_gating_type():
    # Guard against silently widening the exemption. Adding a type here weakens
    # the security gate for real violations and must be a deliberate change.
    assert NON_GATING_VIOLATIONS == frozenset({"periodic_check"})


def test_counts_toward_gate_helper():
    assert counts_toward_gate("periodic_check") is False
    for violation_type in ("tab_switch", "phone_detected", "multiple_faces", "no_face"):
        assert counts_toward_gate(violation_type) is True


def test_gating_types_are_canonical_minus_exemptions():
    assert set(GATING_VIOLATION_TYPES) == set(CANONICAL_VIOLATION_TYPES) - NON_GATING_VIOLATIONS
    # Every genuinely suspicious type still gates.
    for violation_type in (
        "tab_switch", "fullscreen_exit", "copy_paste", "browser_devtools",
        "no_face", "multiple_faces", "phone_detected", "unauthorized_object",
        "gaze_away", "head_turned", "audio_anomaly", "bulk_paste_detected",
    ):
        assert violation_type in GATING_VIOLATION_TYPES


def test_periodic_check_still_scored_by_risk_engine():
    # Excluded from the gate, but NOT from risk scoring.
    assert DEFAULT_RISK_WEIGHTS["periodic_check"] > 0
    assert "periodic_check" in VIOLATION_GUIDELINES


@pytest.mark.asyncio
async def test_periodic_check_excluded_from_gate_total():
    # 10 benign periodic snapshots + 2 real violations.
    counts = await _count_with_events(["periodic_check"] * 10 + ["tab_switch", "copy_paste"])

    assert counts["total"] == 12          # history/reporting keeps everything
    assert counts["gate_total"] == 2      # only the real violations gate
    assert counts["by_type"]["periodic_check"] == 10


@pytest.mark.asyncio
async def test_periodic_checks_alone_never_reach_the_gate():
    # A long, completely clean attempt: 30 periodic checks, no misconduct.
    counts = await _count_with_events(["periodic_check"] * 30)

    assert counts["total"] == 30
    assert counts["gate_total"] == 0


@pytest.mark.asyncio
async def test_real_violations_all_count_toward_gate():
    real = [
        "tab_switch", "fullscreen_exit", "copy_paste", "no_face",
        "multiple_faces", "phone_detected", "unauthorized_object",
        "gaze_away", "head_turned", "browser_devtools",
    ]
    counts = await _count_with_events(real)

    # The gate is not weakened for genuine violations.
    assert counts["gate_total"] == len(real)
    assert counts["total"] == len(real)


@pytest.mark.asyncio
async def test_count_violations_reports_both_totals_for_empty_attempt():
    counts = await _count_with_events([])

    assert counts["total"] == 0
    assert counts["gate_total"] == 0
    assert counts["by_type"] == {}


@pytest.mark.asyncio
async def test_violation_count_schema_accepts_gate_total():
    counts = await _count_with_events(["periodic_check", "tab_switch"])
    model = ViolationCount(**counts)

    assert model.total == 2
    assert model.gate_total == 1


def test_frontend_catalog_mirrors_backend_catalog():
    """
    The frontend union previously drifted from the backend catalog (the store was
    missing gaze_away/head_turned/phone_detected/unauthorized_object), which the
    no-op `tsc --noEmit` command hid. Fail loudly if they diverge again.
    """
    catalog = (
        Path(__file__).resolve().parents[1]
        / "frontend" / "src" / "lib" / "proctoring.catalog.ts"
    )
    if not catalog.exists():
        pytest.skip("frontend catalog not present")

    source = catalog.read_text(encoding="utf-8")
    declared = set(re.findall(r'^\s*"([a-z_]+)",\s*$', source, re.MULTILINE))

    assert declared == set(CANONICAL_VIOLATION_TYPES), (
        "frontend/src/lib/proctoring.catalog.ts is out of sync with "
        "app/config/violation_guidelines.py: "
        f"backend-only={sorted(set(CANONICAL_VIOLATION_TYPES) - declared)}, "
        f"frontend-only={sorted(declared - set(CANONICAL_VIOLATION_TYPES))}"
    )
