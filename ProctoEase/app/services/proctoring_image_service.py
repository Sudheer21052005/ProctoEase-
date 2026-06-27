"""Image helpers for proctoring verification/snapshot storage."""

from __future__ import annotations

import base64
import binascii
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.core.exceptions import BadRequest

_DATA_URL_RE = re.compile(r"^data:(image/(jpeg|jpg|png));base64,(?P<data>.+)$", re.IGNORECASE)


def _safe_attempt_token(attempt_id: uuid.UUID) -> str:
    # UUID text is filesystem-safe and path traversal-safe when used as filename token.
    return str(attempt_id)


def decode_and_validate_image(data_url: str) -> tuple[bytes, str]:
    """Decode a base64 data URL and validate allowed format and size."""
    if not data_url:
        raise BadRequest("Image payload is required")

    match = _DATA_URL_RE.match(data_url.strip())
    if not match:
        raise BadRequest("Invalid image format. Use data URL with image/jpeg or image/png")

    mime = match.group(1).lower()
    encoded = match.group("data")

    try:
                raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
                raise BadRequest("Invalid base64 image payload") from exc

    if len(raw) > settings.PROCTORING_MAX_IMAGE_BYTES:
        raise BadRequest(f"Image exceeds size limit ({settings.PROCTORING_MAX_IMAGE_BYTES} bytes)")

    ext = "jpg" if "jpeg" in mime or "jpg" in mime else "png"
    return raw, ext


def persist_attempt_image(attempt_id: uuid.UUID, image_bytes: bytes, ext: str, category: str) -> str:
    """Persist image under uploads/proctoring/<category>/ and return relative path."""
    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%S%f")
    nonce = uuid.uuid4().hex[:8]
    filename = f"{_safe_attempt_token(attempt_id)}_{stamp}_{nonce}.{ext}"

    root = Path(settings.PROCTORING_UPLOAD_ROOT)
    target_dir = root / category
    target_dir.mkdir(parents=True, exist_ok=True)

    target_path = target_dir / filename
    target_path.write_bytes(image_bytes)

    # Always store DB path as relative uploads/proctoring/... for portability.
    return str((Path("uploads") / "proctoring" / category / filename).as_posix())


def save_from_data_url(attempt_id: uuid.UUID, data_url: str, category: str) -> str:
    """Decode + validate + persist an image in one call."""
    image_bytes, ext = decode_and_validate_image(data_url)
    return persist_attempt_image(attempt_id, image_bytes, ext, category)
