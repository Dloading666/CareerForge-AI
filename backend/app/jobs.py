"""Background job system for long-running tasks (PDF export etc.).

Architecture:
  - FastAPI enqueues jobs into RQ (Redis-backed).
  - A separate ``worker`` process (rq worker) consumes the queue.
  - Job state (status, meta, result) is queried via ``GET /api/v1/jobs/{id}``.
  - For large binary results (PDF bytes), the worker writes to disk and the
    HTTP layer serves the file via a short-lived download endpoint.

Failure modes:
  - RQ/Redis unavailable: ``enqueue_*`` raises; the HTTP layer surfaces 503.
  - Worker not running: jobs stay in ``queued`` state until the worker starts.
    Clients should poll with a timeout (~5 min for PDF export).
"""
from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import redis
from rq import Queue
from rq.exceptions import NoSuchJobError as NoSuchJob
from rq.job import Job, JobStatus

from app.core.config import get_settings

logger = logging.getLogger(__name__)


EXPORT_DIR = Path(os.getenv("EXPORT_DIR", "/app/data/exports"))
EXPORT_DIR.mkdir(parents=True, exist_ok=True)


_redis: Optional[redis.Redis] = None
_queue: Optional[Queue] = None


def get_redis() -> redis.Redis:
    """Return a process-wide Redis connection (created on first use)."""
    global _redis
    if _redis is None:
        _redis = redis.from_url(get_settings().redis_url)
    return _redis


def get_queue() -> Queue:
    """Return the PDF-export job queue. Queue name is used by the worker
    (``rq worker pdf_jobs``) to know which jobs to consume."""
    global _queue
    if _queue is None:
        _queue = Queue("pdf_jobs", connection=get_redis())
    return _queue


def generate_resume_pdf_job(resume_id: int, user_id: int, tenant_id: int) -> str:
    """Worker entry point. Renders the resume to PDF and writes the bytes to
    ``EXPORT_DIR/{job_id}.pdf``. Returns the absolute file path on success.
    Raises on failure; RQ records the traceback and marks the job failed.
    """
    from rq import get_current_job

    from app.infra.db import SessionLocal
    from app.student.resume_router import _get_student_resume, _render_resume_pdf

    job = get_current_job()
    job_id = job.id if job else f"adhoc-{int(time.time() * 1000)}"

    def _progress(phase: str, p: float) -> None:
        if not job:
            return
        job.meta["phase"] = phase
        job.meta["progress"] = p
        job.save_meta()

    _progress("loading", 0.1)

    db = SessionLocal()
    try:
        row = _get_student_resume(db, user_id, tenant_id, resume_id)
        _progress("rendering", 0.3)

        pdf_bytes = _render_resume_pdf(row)
        _progress("writing", 0.85)

        out_path = EXPORT_DIR / f"{job_id}.pdf"
        out_path.write_bytes(pdf_bytes)
        _progress("done", 1.0)
        logger.info("PDF export job %s -> %s (%d bytes)", job_id, out_path, len(pdf_bytes))
        return str(out_path)
    finally:
        db.close()


def enqueue_resume_pdf(resume_id: int, user_id: int, tenant_id: int) -> str:
    """Enqueue a PDF export job. Returns the RQ job id."""
    q = get_queue()
    job = q.enqueue(
        generate_resume_pdf_job,
        resume_id,
        user_id,
        tenant_id,
        job_timeout=300,    # 5 min hard timeout
        result_ttl=3600,    # keep result for 1 hour
        failure_ttl=3600,
    )
    return job.id


def get_job_status(job_id: str, *, expected_user_id: int | None = None) -> Optional[dict[str, Any]]:
    """Return a JSON-friendly status snapshot, or None if the job is gone.

    若传入 expected_user_id，会校验 job 归属：不属于该用户的 job 一律当作
    不存在（返回 None），避免越权查询他人简历导出任务。
    generate_resume_pdf_job 的参数顺序为 (resume_id, user_id, tenant_id)。
    """
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJob:
        return None

    if expected_user_id is not None:
        args = job.args or ()
        job_user_id = args[1] if len(args) >= 2 else None  # 参数顺序: resume_id, user_id, tenant_id
        if job_user_id is not None and job_user_id != expected_user_id:
            return None  # 不属于该用户，当作不存在

    status = job.get_status()
    payload: dict[str, Any] = {
        "job_id": job.id,
        "status": status,            # queued | started | finished | failed | deferred
        "phase": job.meta.get("phase"),
        "progress": job.meta.get("progress"),
    }
    if status == JobStatus.FINISHED:
        payload["result_path"] = job.result
        payload["download_url"] = f"/api/v1/jobs/{job.id}/download"
    if status == JobStatus.FAILED:
        payload["error"] = str(job.exc_info)[:500] if job.exc_info else None
    return payload


def get_job_result_path(job_id: str, *, expected_user_id: int | None = None) -> Optional[Path]:
    """Return the on-disk result path for a finished job, or None if missing.

    若传入 expected_user_id，会校验 job 归属：不属于该用户的 job 一律当作
    不存在（返回 None），避免越权下载他人简历 PDF。
    """
    try:
        job = Job.fetch(job_id, connection=get_redis())
    except NoSuchJob:
        return None
    if expected_user_id is not None:
        args = job.args or ()
        job_user_id = args[1] if len(args) >= 2 else None  # 参数顺序: resume_id, user_id, tenant_id
        if job_user_id is not None and job_user_id != expected_user_id:
            return None  # 不属于该用户，当作不存在
    if job.get_status() != JobStatus.FINISHED:
        return None
    result = job.result
    if not result:
        return None
    p = Path(result)
    return p if p.exists() else None
