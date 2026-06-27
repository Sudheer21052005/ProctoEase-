"""
Tenant context middleware.
Extracts tenant_id from JWT and sets request.state.tenant_id
so get_db can configure RLS on the PostgreSQL session.
"""

from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.core.security import decode_token

# Paths that don't require tenant context
PUBLIC_PATHS = frozenset({
    "/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/v1/tenants",
    "/api/v1/tenants/",
    "/api/v1/auth/login",
    "/api/v1/auth/register",
})


class TenantMiddleware(BaseHTTPMiddleware):
    """
    Pre-route middleware that:
    1. Skips public paths.
    2. Reads the Authorization: Bearer header.
    3. Decodes the JWT to extract tenant_id.
    4. Sets request.state.tenant_id for get_db and downstream services.
    """

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        # Allow public paths and preflight through without tenant context
        if request.url.path in PUBLIC_PATHS or request.method == "OPTIONS":
            return await call_next(request)

        # Try to extract tenant from Bearer token
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header.removeprefix("Bearer ").strip()
            payload = decode_token(token)
            if payload and "tenant_id" in payload:
                request.state.tenant_id = uuid.UUID(payload["tenant_id"])

        # Let the request proceed — route-level dependencies
        # (get_current_user) handle 401 if no valid token
        return await call_next(request)
