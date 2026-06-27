"""
Central API router — aggregates all v1 sub-routers under /api/v1.
Phase 9: tenants + auth + exams + attempts + proctoring + questions + code + plagiarism + risk + reporting.
"""

from fastapi import APIRouter

from app.api.v1.tenants import router as tenants_router
from app.api.v1.auth import router as auth_router
from app.api.v1.exams import router as exams_router
from app.api.v1.attempts import router as attempts_router
from app.api.v1.proctoring import router as proctoring_router
from app.api.v1.questions import router as questions_router
from app.api.v1.code import router as code_router
from app.api.v1.plagiarism import router as plagiarism_router
from app.api.v1.risk import router as risk_router
from app.api.v1.reporting import router as reporting_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(tenants_router)
api_router.include_router(auth_router)
api_router.include_router(exams_router)
api_router.include_router(attempts_router)
api_router.include_router(proctoring_router)
api_router.include_router(questions_router)
api_router.include_router(code_router)
api_router.include_router(plagiarism_router)
api_router.include_router(risk_router)
api_router.include_router(reporting_router)

