"""
ProctoEase — FastAPI application factory.
Phase 10: Production Readiness — rate limiting, Prometheus metrics, expanded health checks.
"""

from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from sqlalchemy import text

from app.core.config import settings
from app.core.database import engine
from app.core.error_handlers import register_error_handlers
from app.core.limiter import limiter
from app.core.logging import setup_logging
from app.api.router import api_router
from app.middleware.tenant import TenantMiddleware
from app.middleware.logging import RequestLoggingMiddleware

# ── OpenAPI tag metadata ──
OPENAPI_TAGS = [
    {"name": "Health", "description": "Liveness and readiness probes"},
    {"name": "Tenants", "description": "Organisation (tenant) management"},
    {"name": "Auth", "description": "Authentication — login, register, refresh, profile"},
    {"name": "Exams", "description": "Exam CRUD — create, list, and retrieve exams"},
    {"name": "Attempts", "description": "Exam attempts — start and track candidate sessions"},
    {"name": "Proctoring", "description": "Real-time proctoring — WebSocket events, violations"},
    {"name": "Questions", "description": "Exam question CRUD — MCQ, multi-select, true/false, short answer"},
    {"name": "Code Execution", "description": "Sandboxed code submission and execution via Judge0"},
    {"name": "Plagiarism", "description": "Code plagiarism detection — AST-based similarity analysis"},
    {"name": "Risk Scoring", "description": "Composite risk scores from proctoring events"},
    {"name": "Reporting", "description": "Analytics dashboards, performance reports, and CSV exports"},
    {"name": "Answers", "description": "Candidate answer management — save, retrieve, auto-grade"},
]


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    setup_logging()
    async with engine.begin() as conn:
        await conn.execute(text("SELECT 1"))
    yield
    await engine.dispose()


app = FastAPI(
    title="ProctoEase",
    description="Multi-tenant AI-assisted online examination platform",
    version="1.1.0",
    lifespan=lifespan,
    openapi_tags=OPENAPI_TAGS,
)

# ── Rate limiting ──
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Prometheus metrics ──
Instrumentator(
    should_group_status_codes=True,
    should_ignore_untemplated=True,
    excluded_handlers=["/metrics", "/health"],
).instrument(app).expose(app, tags=["Health"])

# ── Error handlers ──
register_error_handlers(app)

# ── Middleware (order matters: last added = first executed) ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SlowAPIMiddleware)
app.add_middleware(TenantMiddleware)
app.add_middleware(RequestLoggingMiddleware)

# ── Routers ──
app.include_router(api_router)

# ── Local uploads (proctoring snapshots) ──
uploads_root = Path(settings.PROCTORING_UPLOAD_ROOT).parent
uploads_root.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_root)), name="uploads")


# ── Health: Liveness ──────────────────────────────────────────


@app.get("/health", tags=["Health"], summary="Liveness probe")
async def health_live():
    """
    Liveness probe — returns immediately if the process is alive.
    Use this for container restart decisions.
    """
    return {"status": "ok", "service": "proctoease", "version": "1.1.0"}


# ── Health: Readiness ─────────────────────────────────────────


@app.get("/health/ready", tags=["Health"], summary="Readiness probe")
async def health_ready():
    """
    Readiness probe — checks connectivity of all downstream dependencies.
    Returns per-component status so orchestrators know exactly what's failing.

    HTTP 200 when all checks pass; HTTP 503 if any dependency is down.
    """
    checks: dict[str, str] = {}
    overall = "healthy"

    # DB check
    try:
        async with engine.begin() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc}"
        overall = "degraded"

    # Redis check
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.REDIS_URL, socket_connect_timeout=2)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc}"
        overall = "degraded"

    # Judge0 check
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{settings.JUDGE0_API_URL}/languages")
            resp.raise_for_status()
        checks["judge0"] = "ok"
    except Exception as exc:
        checks["judge0"] = f"error: {exc}"
        overall = "degraded"

    status_code = 200 if overall == "healthy" else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": overall, "checks": checks},
    )
