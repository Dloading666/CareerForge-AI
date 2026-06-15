from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.core.config import get_settings

router = APIRouter(prefix="/student", tags=["student-attachment"])

settings = get_settings()


class RenameRequest(BaseModel):
    original_name: str


@router.get("/attachments")
def list_my_attachments(
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    rows = db.execute(
        text(
            "SELECT id, original_name, content_type, file_ext, file_size, stored_path, status, created_at "
            "FROM student_agent_attachment WHERE student_id = :sid AND message_id IS NOT NULL "
            "ORDER BY created_at DESC LIMIT 50"
        ),
        {"sid": student.id},
    ).mappings().all()
    return ok([dict(r) for r in rows])


@router.post("/attachments/upload")
def upload_resume(
    file: UploadFile = File(...),
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    identity, student = current

    ext = Path(file.filename or "").suffix.lower()
    allowed = {".pdf", ".docx", ".doc"}
    if ext not in allowed:
        raise HTTPException(400, "简历仅支持 PDF / Word（.docx/.doc）格式")

    # Sync read of the underlying SpooledTemporaryFile. Function is sync because all
    # downstream IO (disk write, DB) is blocking — wrapping in async only starves the loop.
    content = file.file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(400, "文件不能超过 20MB")

    default_ctype = {
        ".pdf": "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
    }[ext]

    storage_dir = Path(settings.agent_upload_storage_dir) / str(identity.tenant_id) / str(identity.user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = storage_dir / stored_name
    stored_path.write_bytes(content)

    db.execute(
        text(
            "INSERT INTO student_agent_attachment "
            "(tenant_id, student_id, session_id, message_id, original_name, stored_path, content_type, file_ext, file_size, status) "
            "VALUES (:tid, :sid, 0, 0, :name, :path, :ctype, :ext, :size, 'ready')"
        ),
        {
            "tid": identity.tenant_id, "sid": student.id,
            "name": file.filename, "path": str(stored_path),
            "ctype": file.content_type or default_ctype,
            "ext": ext.lstrip("."), "size": len(content),
        },
    )
    db.commit()
    return ok(msg="上传成功")


@router.delete("/attachments/{attachment_id}")
def delete_attachment(
    attachment_id: int,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current

    row = db.execute(
        text("SELECT stored_path FROM student_agent_attachment WHERE id = :aid AND student_id = :sid"),
        {"aid": attachment_id, "sid": student.id},
    ).first()

    if not row:
        raise HTTPException(404, "文件不存在")

    stored_path = Path(row[0])
    if stored_path.exists():
        stored_path.unlink()

    db.execute(
        text("DELETE FROM student_agent_attachment WHERE id = :aid AND student_id = :sid"),
        {"aid": attachment_id, "sid": student.id},
    )
    db.commit()
    return ok(msg="已删除")
