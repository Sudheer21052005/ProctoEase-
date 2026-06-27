"""
Global exception handlers — registered on the FastAPI app.

Translates domain exceptions into consistent JSON error responses:
  { "detail": "...", "error_code": "EXAM_NOT_FOUND" }
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.exceptions import AppException
from app.core.config import settings

logger = logging.getLogger("proctoease")


def register_error_handlers(app: FastAPI) -> None:
    """Attach all exception handlers to the app instance."""

    @app.exception_handler(AppException)
    async def app_exception_handler(_request: Request, exc: AppException) -> JSONResponse:
        """Handle all domain exceptions."""
        logger.warning(
            "domain_error error_code=%s detail=%s",
            exc.error_code,
            exc.detail,
        )
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "error_code": exc.error_code,
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Clean field-level validation errors."""
        errors = []
        for err in exc.errors():
            loc = " → ".join(str(l) for l in err.get("loc", []))
            errors.append({"field": loc, "message": err.get("msg", "")})

        return JSONResponse(
            status_code=422,
            content={
                "detail": "Validation error",
                "error_code": "VALIDATION_ERROR",
                "errors": errors,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        _request: Request, exc: Exception
    ) -> JSONResponse:
        """Catch-all — never expose tracebacks in production."""
        logger.exception("unhandled_error: %s", exc)

        detail = str(exc) if settings.DEBUG else "Internal server error"
        return JSONResponse(
            status_code=500,
            content={
                "detail": detail,
                "error_code": "INTERNAL_ERROR",
            },
        )
