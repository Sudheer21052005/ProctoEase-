"""
Domain exception hierarchy for ProctoEase.

Services raise these instead of raw HTTPException. The global error handler
in error_handlers.py translates them into consistent JSON responses.
"""

from __future__ import annotations


class AppException(Exception):
    """Base for all domain exceptions."""

    status_code: int = 500
    error_code: str = "INTERNAL_ERROR"
    detail: str = "An unexpected error occurred"

    def __init__(self, detail: str | None = None):
        self.detail = detail or self.__class__.detail
        super().__init__(self.detail)


# ── 400 Bad Request ──────────────────────────────────────────────


class BadRequest(AppException):
    status_code = 400
    error_code = "BAD_REQUEST"
    detail = "Bad request"


class ExamNotPublished(BadRequest):
    error_code = "EXAM_NOT_PUBLISHED"
    detail = "Exam is not published yet"


# ── 401 Unauthorized ─────────────────────────────────────────────


class Unauthorized(AppException):
    status_code = 401
    error_code = "UNAUTHORIZED"
    detail = "Authentication required"


class InvalidCredentials(Unauthorized):
    error_code = "INVALID_CREDENTIALS"
    detail = "Invalid credentials"


class InvalidToken(Unauthorized):
    error_code = "INVALID_TOKEN"
    detail = "Could not validate credentials"


class InvalidRefreshToken(Unauthorized):
    error_code = "INVALID_REFRESH_TOKEN"
    detail = "Invalid refresh token"


class UserInactive(Unauthorized):
    error_code = "USER_INACTIVE"
    detail = "User account is no longer active"


# ── 403 Forbidden ────────────────────────────────────────────────


class Forbidden(AppException):
    status_code = 403
    error_code = "FORBIDDEN"
    detail = "Insufficient permissions"


# ── 404 Not Found ────────────────────────────────────────────────


class NotFound(AppException):
    status_code = 404
    error_code = "NOT_FOUND"
    detail = "Resource not found"


class TenantNotFound(NotFound):
    error_code = "TENANT_NOT_FOUND"
    detail = "Tenant not found"


class ExamNotFound(NotFound):
    error_code = "EXAM_NOT_FOUND"
    detail = "Exam not found"


class UserNotFound(NotFound):
    error_code = "USER_NOT_FOUND"
    detail = "User not found"


# ── 409 Conflict ─────────────────────────────────────────────────


class Conflict(AppException):
    status_code = 409
    error_code = "CONFLICT"
    detail = "Resource conflict"


class DuplicateEmail(Conflict):
    error_code = "DUPLICATE_EMAIL"
    detail = "A user with this email already exists in this tenant"


class DuplicateTenantSlug(Conflict):
    error_code = "DUPLICATE_TENANT_SLUG"
    detail = "A tenant with this slug already exists"


class ActiveAttemptExists(Conflict):
    error_code = "ACTIVE_ATTEMPT_EXISTS"
    detail = "You already have an active attempt for this exam"


# ── 503 Service Unavailable ──────────────────────────────────────


class ServiceUnavailable(AppException):
    status_code = 503
    error_code = "SERVICE_UNAVAILABLE"
    detail = "External service is unavailable"


class Judge0Unavailable(ServiceUnavailable):
    error_code = "JUDGE0_UNAVAILABLE"
    detail = "Code execution service (Judge0) is unavailable"


# ── Phase 6 additions ───────────────────────────────────────────


class SubmissionNotFound(NotFound):
    error_code = "SUBMISSION_NOT_FOUND"
    detail = "Code submission not found"


class LanguageNotAllowed(BadRequest):
    error_code = "LANGUAGE_NOT_ALLOWED"
    detail = "This programming language is not allowed for this exam"


class AttemptNotFound(NotFound):
    error_code = "ATTEMPT_NOT_FOUND"
    detail = "Exam attempt not found"


class PlagiarismReportNotFound(NotFound):
    error_code = "PLAGIARISM_REPORT_NOT_FOUND"
    detail = "Plagiarism report not found"


# ── Phase 11 additions ──────────────────────────────────────────


class AttemptAlreadySubmitted(BadRequest):
    error_code = "ATTEMPT_ALREADY_SUBMITTED"
    detail = "This attempt has already been submitted"


class AttemptNotStarted(BadRequest):
    error_code = "ATTEMPT_NOT_STARTED"
    detail = "This attempt is not in a started state"

