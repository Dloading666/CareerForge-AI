from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok, error
from app.infra.db import get_db
from app.student.agent_runtime import (
    create_session,
    delete_session,
    get_history,
    list_available_models,
    list_sessions,
    serialize_activity,
    serialize_attachment,
    save_attachment,
    stream_master_reply,
)
from app.student.agent_schemas import (
    AgentHistoryResponse,
    AgentMessageRequest,
    AgentMessageResponse,
    AgentSessionCreate,
    AgentSessionResponse,
)

router = APIRouter(prefix="/student", tags=["student"])

AVATAR_DIR = Path("/app/data/avatars")
BANNER_DIR = Path("/app/data/banners")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_AVATAR_SIZE = 2 * 1024 * 1024
MAX_BANNER_SIZE = 5 * 1024 * 1024

class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    college: Optional[str] = None
    major: Optional[str] = None
    grade: Optional[str] = None
    phone: Optional[str] = None
    signature: Optional[str] = None


@router.get("/home")
def student_home(current=Depends(require_role("student"))):
    _, student = current
    return ok(
        {
            "welcome": f"你好，{student.name or '同学'}",
            "suggestions": [
                "帮我模拟一次面试",
                "看看我和某岗位的匹配度",
                "优化我的简历项目经历",
            ],
        }
    )


@router.post("/master/sessions", status_code=201)
def create_master_session(
    payload: AgentSessionCreate | None = None,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session = create_session(db, identity, payload.title if payload else None)
    return ok(AgentSessionResponse.model_validate(session).model_dump(mode="json"), msg="created")


@router.get("/master/sessions")
def list_master_sessions(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok([AgentSessionResponse.model_validate(item).model_dump(mode="json") for item in list_sessions(db, identity)])


@router.get("/master/models")
def list_master_models(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok([item.model_dump(mode="json") for item in list_available_models(db, identity)])


@router.delete("/master/sessions/{session_id}")
def delete_master_session(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    delete_session(db, identity, session_id)
    return ok({"id": session_id}, msg="deleted")


@router.get("/master/sessions/{session_id}/messages")
def get_master_history(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session, messages, activities, attachments = get_history(db, identity, session_id)
    data = AgentHistoryResponse(
        session=AgentSessionResponse.model_validate(session),
        messages=[AgentMessageResponse.model_validate(item) for item in messages],
        activities=[serialize_activity(item) for item in activities],
        attachments=[serialize_attachment(item) for item in attachments],
    )
    return ok(data.model_dump(mode="json"))


@router.post("/master/sessions/{session_id}/attachments", status_code=201)
async def upload_master_attachment(
    session_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    attachment = await save_attachment(db, identity, session_id, file)
    return ok(serialize_attachment(attachment).model_dump(mode="json"), msg="created")


@router.post("/master/sessions/{session_id}/messages/stream")
async def stream_master_message(
    session_id: int,
    payload: AgentMessageRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return StreamingResponse(
        stream_master_reply(
            db,
            identity,
            session_id,
            payload.content,
            payload.model_id,
            payload.reasoning_effort,
            payload.attachment_ids,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/profile")
def get_student_profile(current=Depends(require_role("student"))):
    _, student = current
    return ok({
        "id": student.id, "account": student.account, "email": student.email,
        "name": student.name, "gender": student.gender, "age": student.age,
        "college": student.college, "major": student.major, "grade": student.grade,
        "phone": student.phone, "avatar_url": student.avatar_url,
        "banner_url": student.banner_url, "signature": student.signature,
        "email_verified_at": student.email_verified_at.isoformat() if student.email_verified_at else None,
        "created_at": student.created_at.isoformat() if student.created_at else None,
    })


@router.put("/profile")
def update_student_profile(
    payload: ProfileUpdateRequest,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return ok(msg="no fields to update")
    for field, value in update_data.items():
        setattr(student, field, value)
    db.commit()
    db.refresh(student)
    return ok({
        "id": student.id, "name": student.name, "gender": student.gender,
        "age": student.age, "college": student.college, "major": student.major,
        "grade": student.grade, "phone": student.phone, "signature": student.signature,
    })


@router.post("/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return error("unsupported file type")
    content = await file.read()
    if len(content) > MAX_AVATAR_SIZE:
        return error("file too large, max 2MB")
    if student.avatar_url:
        old = AVATAR_DIR / Path(student.avatar_url).name
        if old.exists(): old.unlink()
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    (AVATAR_DIR / filename).write_bytes(content)
    student.avatar_url = f"/static/avatars/{filename}"
    db.commit()
    return ok({"avatar_url": student.avatar_url})


@router.post("/profile/banner")
async def upload_banner(
    file: UploadFile = File(...),
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        return error("unsupported file type")
    content = await file.read()
    if len(content) > MAX_BANNER_SIZE:
        return error("file too large, max 5MB")
    if student.banner_url:
        old = BANNER_DIR / Path(student.banner_url).name
        if old.exists(): old.unlink()
    BANNER_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4().hex}{ext}"
    (BANNER_DIR / filename).write_bytes(content)
    student.banner_url = f"/static/banners/{filename}"
    db.commit()
    return ok({"banner_url": student.banner_url})
