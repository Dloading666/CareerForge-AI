"""HTTP endpoints for background jobs (status polling + result download)."""
from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.jobs import (
    enqueue_resume_pdf,
    get_job_result_path,
    get_job_status,
)
from app.student.resume_router import _get_student_resume
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["jobs"])


@router.post("/student/resumes/{resume_id}/export-pdf", status_code=status.HTTP_202_ACCEPTED)
def enqueue_export_resume_pdf(
    resume_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """Enqueue a PDF render for the given resume. Returns 202 + job_id.

    Poll ``GET /api/v1/jobs/{job_id}`` until status is ``finished`` (or
    ``failed``). The result is served via the ``download_url`` returned in
    the status payload.
    """
    identity, _ = current
    # Verify the resume exists & belongs to this student before enqueuing,
    # so we don't burn a worker slot on a 404.
    _get_student_resume(db, identity.user_id, identity.tenant_id, resume_id)
    try:
        job_id = enqueue_resume_pdf(resume_id, identity.user_id, identity.tenant_id)
    except Exception as exc:  # Redis down, RQ misconfigured, etc.
        logger.exception("Failed to enqueue PDF export")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"导出服务暂时不可用: {exc}",
        ) from exc
    return ok({"job_id": job_id, "status": "queued"}, msg="accepted")


@router.get("/jobs/{job_id}")
def get_job(job_id: str, current=Depends(require_role("student"))):
    identity, _ = current
    info = get_job_status(job_id, expected_user_id=identity.user_id)
    if not info:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="任务不存在或已过期")
    return ok(info)


@router.get("/jobs/{job_id}/download")
def download_job_result(job_id: str, current=Depends(require_role("student"))):
    identity, _ = current
    path = get_job_result_path(job_id, expected_user_id=identity.user_id)
    if not path:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="结果尚未生成或已过期",
        )
    # Use the job id as filename (clean ASCII). Clients can rename on save.
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"resume-{job_id}.pdf",
    )
