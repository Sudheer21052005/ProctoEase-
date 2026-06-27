import pytest

from app.api.v1 import proctoring
from app.config.violation_guidelines import (
    CANONICAL_VIOLATION_TYPES,
    DEFAULT_RISK_WEIGHTS,
    VIOLATION_GUIDELINES,
)
from app.core.exceptions import BadRequest
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
