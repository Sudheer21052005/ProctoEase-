"""
Exam endpoints — RBAC-protected, tenant-scoped.
Phase 11: Added PATCH update endpoint.
"""

import uuid
import json

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.exceptions import BadRequest
from app.core.dependencies import get_current_user, require_role
from app.models.user import User, UserRole
from app.schemas.exam import ExamCreate, ExamRead, ExamUpdate
from app.schemas.exam_ingestion import (
    ExamCreateIngestionRequest,
    ExamCreateIngestionResponse,
    ExamCreationMode,
)
from app.services import exam_ingestion_service, exam_service, question_service

router = APIRouter(prefix="/exams", tags=["Exams"])


def _as_bool(value: str | bool | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return value.strip().lower() in {"1", "true", "yes", "on"}


@router.post(
    "/create",
    response_model=ExamCreateIngestionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create exam via manual/pdf/json ingestion",
)
async def create_exam_via_ingestion(
    request: Request,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Create exam from JSON payload or PDF upload, with optional preview mode."""
    content_type = (request.headers.get("content-type") or "").lower()
    preview_only = False

    if "application/json" in content_type:
        raw = await request.json()
        body = ExamCreateIngestionRequest.model_validate(raw)
        preview_only = body.preview_only

        if body.mode == ExamCreationMode.MANUAL:
            if body.payload is None:
                raise BadRequest("Manual mode requires payload")
            result = exam_ingestion_service.ingest_from_json_payload(
                body.payload.model_dump(mode="json")
            )
        elif body.mode == ExamCreationMode.JSON:
            if body.payload is None:
                raise BadRequest("JSON mode requires payload")
            result = exam_ingestion_service.ingest_from_json_payload(
                body.payload.model_dump(mode="json")
            )
        else:
            raise BadRequest("PDF mode requires multipart/form-data upload")
    elif "multipart/form-data" in content_type:
        form = await request.form()
        mode_value = str(form.get("mode") or "").lower().strip()
        payload_json = form.get("payload_json")
        file = form.get("file")
        if file is None:
            for _, value in form.multi_items():
                if hasattr(value, "read"):
                    file = value
                    break
        preview_only = _as_bool(form.get("preview_only"), default=False)

        try:
            mode = ExamCreationMode(mode_value)
        except ValueError as exc:
            raise BadRequest("mode must be one of: manual, pdf, json") from exc

        if mode == ExamCreationMode.PDF:
            if file is None or not hasattr(file, "read"):
                raise BadRequest("PDF mode requires a file upload")
            file_bytes = await file.read()
            result = exam_ingestion_service.ingest_from_pdf_bytes(
                file_bytes,
                content_type=getattr(file, "content_type", None),
            )
        elif mode in {ExamCreationMode.JSON, ExamCreationMode.MANUAL}:
            if not isinstance(payload_json, str):
                raise BadRequest("JSON/manual mode requires payload_json form field")
            try:
                payload_data = json.loads(payload_json)
            except json.JSONDecodeError as exc:
                raise BadRequest("payload_json is not valid JSON") from exc
            result = exam_ingestion_service.ingest_from_json_payload(payload_data)
        else:
            raise BadRequest("Unsupported ingestion mode")
    else:
        raise BadRequest("Unsupported content type. Use application/json or multipart/form-data")

    preview = result.to_preview()
    if preview_only:
        return ExamCreateIngestionResponse(
            created=False,
            mode=result.mode,
            exam=None,
            preview=preview,
        )

    exam = await exam_service.create_exam(
        db,
        result.exam,
        user.tenant_id,
        user.id,
    )

    for q in result.questions:
        await question_service.create_question(db, exam.id, user.tenant_id, q)

    return ExamCreateIngestionResponse(
        created=True,
        mode=result.mode,
        exam=ExamRead.model_validate(exam),
        preview=preview,
    )


@router.post("/", response_model=ExamRead, status_code=status.HTTP_201_CREATED, summary="Create exam")
async def create_exam(
    payload: ExamCreate,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """Create a new exam (Recruiter / Admin only)."""
    exam = await exam_service.create_exam(db, payload, user.tenant_id, user.id)
    return exam


@router.get("/", response_model=list[ExamRead], summary="List exams")
async def list_exams(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    List exams in the current tenant.
    Candidates see only published exams; Recruiters/Admins see all.
    """
    published_only = user.role == UserRole.CANDIDATE
    return await exam_service.list_exams(
        db, user.tenant_id, published_only=published_only
    )


@router.get("/{exam_id}", response_model=ExamRead, summary="Get exam by ID")
async def get_exam(
    exam_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single exam by ID (tenant-scoped)."""
    return await exam_service.get_exam(db, exam_id, user.tenant_id)


@router.patch("/{exam_id}", response_model=ExamRead, summary="Update exam")
async def update_exam(
    exam_id: uuid.UUID,
    payload: ExamUpdate,
    user: User = Depends(require_role(UserRole.RECRUITER, UserRole.ADMIN)),
    db: AsyncSession = Depends(get_db),
):
    """
    Partial update — send only the fields you want to change.
    Use this to toggle publish status, update title/description, etc.
    Recruiter / Admin only.
    """
    return await exam_service.update_exam(db, exam_id, user.tenant_id, payload)
