"""
Request logging middleware.

Logs every HTTP request with:
- request_id (UUID4)
- method, path, status_code
- latency_ms
- tenant_id (if available)
"""

from __future__ import annotations

import logging
import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("proctoease.http")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Injects request_id and logs method / path / status / latency."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id

        start = time.perf_counter()
        response = await call_next(request)
        latency_ms = round((time.perf_counter() - start) * 1000, 1)

        tenant_id = getattr(request.state, "tenant_id", None)

        logger.info(
            "rid=%s %s %s → %s %.1fms tenant=%s",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            latency_ms,
            tenant_id or "-",
        )

        response.headers["X-Request-ID"] = request_id
        return response
