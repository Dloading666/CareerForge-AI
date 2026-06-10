from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status as http_status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok, error
from app.infra.db import get_db
from app.student.agent_runtime import (
    create_session,
    delete_session,
    get_history,
    get_session_or_404,
    list_available_models,
    list_sessions,
    serialize_activity,
    serialize_attachment,
    save_attachment,
    stream_master_reply,
)
from app.student.run_manager import run_manager
from app.admin.model_service import get_all_config
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

JOB_SEARCH_STATUS_VALUES = {
    "unemployed",
    "employed",
    "considering",
    "not_looking",
}


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    gender: Optional[str] = None
    age: Optional[int] = None
    birth_date: Optional[str] = Field(default=None, max_length=16)
    college: Optional[str] = None
    major: Optional[str] = None
    grade: Optional[str] = None
    phone: Optional[str] = None
    signature: Optional[str] = None
    personal_advantages: Optional[str] = None
    job_search_status: Optional[str] = Field(default=None, max_length=32)
    expected_position: Optional[str] = Field(default=None, max_length=128)
    expected_salary: Optional[str] = Field(default=None, max_length=64)
    expected_location: Optional[str] = Field(default=None, max_length=128)


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
    agent_type = (payload.agent_type if payload else None) or "resume"
    session = create_session(db, identity, payload.title if payload else None, agent_type=agent_type)
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


# ── 后台运行 API（Phase 2）─────────────────────────────────────────────────


class RunStartRequest(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    model_id: Optional[int] = None
    reasoning_effort: str = Field(default="medium", max_length=16)
    attachment_ids: list[int] = Field(default_factory=list, max_length=12)


@router.post("/master/sessions/{session_id}/runs", status_code=202)
async def start_run(
    session_id: int,
    payload: RunStartRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """启动一次后台智能体运行。立即返回 run_id，不等待完成。"""
    identity, _ = current
    # P2: 先校验 session 属主，防止锁住别人的 session
    get_session_or_404(db, identity, session_id)
    try:
        run_id = await run_manager.start_run(
            db, identity, session_id,
            payload.content, payload.model_id, payload.reasoning_effort,
            payload.attachment_ids,
        )
    except Exception as e:
        if hasattr(e, "status_code"):
            raise
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)[:200])
    return ok({"run_id": run_id}, msg="运行已启动")


@router.get("/master/runs/{run_id}/events")
async def subscribe_run_events(
    run_id: int,
    after_seq: int = 0,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """订阅运行事件流（SSE）。连接断开不影响运行。"""
    identity, _ = current
    # 权限校验：验证 run 属于当前用户
    from app.student.agent_models import StudentAgentRun
    run = db.scalar(
        select(StudentAgentRun).where(
            StudentAgentRun.id == run_id,
            StudentAgentRun.tenant_id == identity.tenant_id,
            StudentAgentRun.student_id == identity.user_id,
        )
    )
    if not run:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="运行不存在或无权限")
    return StreamingResponse(
        run_manager.subscribe(run_id, after_seq),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/master/runs/{run_id}/cancel")
async def cancel_run(
    run_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """取消运行中的任务。"""
    identity, _ = current
    # 权限校验
    from app.student.agent_models import StudentAgentRun
    run = db.scalar(
        select(StudentAgentRun).where(
            StudentAgentRun.id == run_id,
            StudentAgentRun.tenant_id == identity.tenant_id,
            StudentAgentRun.student_id == identity.user_id,
        )
    )
    if not run:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="运行不存在或无权限")
    success = await run_manager.cancel(run_id, identity)
    if not success:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="运行不存在或已完成")
    return ok(msg="运行已取消")


@router.get("/master/runs/active")
async def get_active_runs(
    current=Depends(require_role("student")),
):
    """获取当前用户所有运行中的任务。"""
    identity, _ = current
    runs = run_manager.get_active_runs(identity)
    return ok(runs)


def _serialize_profile(student) -> dict:
    return {
        "id": student.id,
        "account": student.account,
        "email": student.email,
        "name": student.name,
        "gender": student.gender,
        "age": student.age,
        "birth_date": student.birth_date or "",
        "college": student.college,
        "major": student.major,
        "grade": student.grade,
        "phone": student.phone,
        "avatar_url": student.avatar_url,
        "banner_url": student.banner_url,
        "signature": student.signature,
        "personal_advantages": student.personal_advantages,
        "job_search_status": student.job_search_status,
        "expected_position": student.expected_position,
        "expected_salary": student.expected_salary,
        "expected_location": student.expected_location,
        "email_verified_at": student.email_verified_at.isoformat() if student.email_verified_at else None,
        "created_at": student.created_at.isoformat() if student.created_at else None,
    }


@router.get("/profile")
def get_student_profile(current=Depends(require_role("student"))):
    _, student = current
    return ok(_serialize_profile(student))


@router.put("/profile")
def update_student_profile(
    payload: ProfileUpdateRequest,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    update_data = payload.model_dump(exclude_unset=True)
    if "job_search_status" in update_data:
        value = update_data["job_search_status"]
        if value is not None and value not in JOB_SEARCH_STATUS_VALUES:
            return error("job_search_status 取值不合法")
    if not update_data:
        return ok(_serialize_profile(student), msg="no fields to update")
    for field, value in update_data.items():
        if value is None:
            continue
        if not hasattr(student, field):
            return error(f"不支持的字段：{field}")
        setattr(student, field, value)
    db.commit()
    db.refresh(student)
    return ok(_serialize_profile(student))


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


@router.get("/announcement")
def student_announcement(db: Session = Depends(get_db)):
    config = get_all_config(db)
    enabled = config.get("announcement_enabled", "false") == "true"
    announcement = config.get("announcement", "") if enabled else ""
    return ok({"announcement": announcement, "enabled": enabled})