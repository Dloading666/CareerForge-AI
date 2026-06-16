"""Interview API router.

所有路由挂在 /api/v1/student/interviews 下。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.auth.service import AuthIdentity, get_current_identity, require_role
from app.core.response import ok
from app.infra.db import get_db
from app.interview.exceptions import InterviewError, InterviewNotFoundError
from app.interview.schemas import (
    InterviewReportResponse,
    InterviewStartRequest,
    InterviewStartResponse,
    InterviewSubmitResponse,
    InterviewTurnRequest,
)
from app.interview import service

router = APIRouter(prefix="/student/interviews", tags=["student-interviews"])


# ── Exception handler ─────────────────────────────────────────────────────────


@router.exception_handler(InterviewError)
async def interview_error_handler(request, exc: InterviewError):  # noqa: ANN001
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.status_code, "msg": exc.detail, "data": None},
    )


# ── Interview CRUD ────────────────────────────────────────────────────────────


@router.post("", response_model=InterviewStartResponse)
def start_interview(
    body: InterviewStartRequest,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    result = service.start_interview(db, identity, body)
    return ok(result)


@router.get("")
def list_interviews(
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    return ok(service.list_interviews(db, identity))


@router.get("/knowledge/status")
def knowledge_status():
    return ok(service.knowledge_status())


@router.get("/{session_id}")
def get_interview(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    return ok(service.get_interview_detail(db, identity, session_id))


@router.get("/{session_id}/export")
def export_interview(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    """Export interview report as JSON."""
    report = service.export_interview_report(db, identity, session_id)
    return ok(report)


@router.post("/{session_id}/turns", response_model=InterviewSubmitResponse)
def submit_turn(
    session_id: int,
    body: InterviewTurnRequest,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    result = service.submit_turn(db, identity, session_id, body.answer)
    return ok(result)


@router.post("/{session_id}/report")
def generate_report(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    report = service.generate_report(db, identity, session_id)
    return ok({"report_id": report.id})


@router.post("/{session_id}/report/delete")
def delete_report(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    service.delete_report(db, identity, session_id)
    return ok({"deleted": True})


@router.get("/{session_id}/report", response_model=InterviewReportResponse)
def get_report(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    return ok(service.get_report(db, identity, session_id))


@router.post("/{session_id}/delete")
def delete_interview(
    session_id: int,
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    service.delete_interview(db, identity, session_id)
    return ok({"deleted": True})


# ── Resume extraction ─────────────────────────────────────────────────────────


@router.post("/resume/extract")
async def extract_resume(
    file: UploadFile = File(...),
):
    result = await service.extract_uploaded_resume(file)
    return ok(result)
