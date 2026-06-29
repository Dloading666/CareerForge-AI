from __future__ import annotations

import json
import logging
import uuid
from datetime import date
from pathlib import Path
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status as http_status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import change_student_email, require_role
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
from app.student.agent_models import StudentAgentSession
from app.student.resume_models import StudentResume
from app.student.profile_details_models import (
    StudentEducation,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
logger = logging.getLogger(__name__)

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


def _normalize_month(value: str | None) -> str:
    if not value:
        return ""
    text = value.strip()
    match = re.match(r"^(\d{4})[.\-/年。．](\d{1,2})", text)
    if not match:
        return text
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def _parse_birth_month(value: str | None) -> date | None:
    text = _normalize_month(value)
    if not text:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}", text):
        raise ValueError("birth_date 格式应为 YYYY-MM")
    year, month = text.split("-")
    return date(int(year), int(month), 1)


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    nickname: Optional[str] = Field(default=None, max_length=64)
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
    active_resume_id = (payload.active_resume_id if payload else None) or None
    session = create_session(db, identity, payload.title if payload else None, agent_type=agent_type, active_resume_id=active_resume_id)
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
async def delete_master_session(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    # 防御性兜底：前端不可信（用户可能直接调 API 或前端崩溃），删除会话前
    # 先取消该 session 正在跑的后台 run，避免会话已删但 AI 继续改简历。
    active_runs = run_manager.get_active_runs(identity)
    for run in active_runs:
        if run.get("session_id") == session_id:
            run_id = run.get("run_id")
            if run_id is not None:
                try:
                    await run_manager.cancel(run_id, identity)
                except Exception:
                    # 单个 run 取消失败不阻塞删除
                    pass
    delete_session(db, identity, session_id)
    return ok({"id": session_id}, msg="deleted")


class SessionPatchRequest(BaseModel):
    active_resume_id: Optional[int] = None


@router.patch("/master/sessions/{session_id}")
def patch_master_session(
    session_id: int,
    payload: SessionPatchRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session = db.scalar(
        select(StudentAgentSession).where(
            StudentAgentSession.id == session_id,
            StudentAgentSession.student_id == identity.user_id,
            StudentAgentSession.tenant_id == identity.tenant_id,
        )
    )
    if not session:
        return error("会话不存在或无权限", code=404)
    if "active_resume_id" in payload.model_fields_set:
        if payload.active_resume_id is not None:
            # 校验简历归属
            resume = db.scalar(
                select(StudentResume).where(
                    StudentResume.id == payload.active_resume_id,
                    StudentResume.student_id == identity.user_id,
                    StudentResume.tenant_id == identity.tenant_id,
                )
            )
            if not resume:
                return error("简历不存在或无权限", code=404)
            session.active_resume_id = payload.active_resume_id
        else:
            # 显式传 null 解除绑定
            session.active_resume_id = None
    db.commit()
    db.refresh(session)
    return ok(AgentSessionResponse.model_validate(session).model_dump(mode="json"))


@router.put("/master/sessions/{session_id}/memory")
def update_session_memory(
    session_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session = db.scalar(
        select(StudentAgentSession).where(
            StudentAgentSession.id == session_id,
            StudentAgentSession.student_id == identity.user_id,
            StudentAgentSession.tenant_id == identity.tenant_id,
        )
    )
    if not session:
        return error("会话不存在或无权限", code=404)
    import json
    # 校验结构：constraints/facts/preferences 必须是数组
    raw_prefs = payload.get("preferences") or []
    if isinstance(raw_prefs, dict):
        # 兼容旧格式 {key: true} → [key, ...]
        raw_prefs = list(raw_prefs.keys())
    clean = {
        "constraints": [str(c)[:200] for c in (payload.get("constraints") or [])][:20],
        "facts": [str(f)[:200] for f in (payload.get("facts") or [])][:20],
        "preferences": [str(p)[:200] for p in raw_prefs][:20],
    }
    session.memory_json = json.dumps(clean, ensure_ascii=False)
    db.commit()
    return ok({"memory": clean})


# ── Profile proposals ─────────────────────────────────────────────────────


@router.get("/profile/proposals")
def list_proposals(
    status_filter: str = "pending",
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    from app.student.proposal_models import StudentProfileProposal
    query = select(StudentProfileProposal).where(
        StudentProfileProposal.tenant_id == identity.tenant_id,
        StudentProfileProposal.student_id == identity.user_id,
    )
    if status_filter:
        query = query.where(StudentProfileProposal.status == status_filter)
    proposals = list(db.scalars(query.order_by(StudentProfileProposal.id.desc()).limit(50)).all())
    return ok([
        {
            "id": p.id,
            "section": p.section,
            "payload": json.loads(p.payload_json or "{}"),
            "status": p.status,
            "session_id": p.session_id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in proposals
    ])


class ProposalActionRequest(BaseModel):
    pass


@router.post("/profile/proposals/{proposal_id}/accept")
def accept_proposal(
    proposal_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    from app.student.proposal_models import StudentProfileProposal
    proposal = db.scalar(
        select(StudentProfileProposal).where(
            StudentProfileProposal.id == proposal_id,
            StudentProfileProposal.tenant_id == identity.tenant_id,
            StudentProfileProposal.student_id == identity.user_id,
            StudentProfileProposal.status == "pending",
        )
    )
    if not proposal:
        return error("提案不存在或已处理", code=404)

    payload = json.loads(proposal.payload_json or "{}")
    section = proposal.section

    # 写入对应的档案明细表
    try:
        if section == "work":
            from app.student.profile_details_models import StudentWorkExperience
            row = StudentWorkExperience(
                tenant_id=identity.tenant_id, student_id=identity.user_id,
                company=payload.get("company", ""),
                position=payload.get("position", ""),
                start_date=payload.get("start_date", ""),
                end_date=payload.get("end_date", ""),
                description=payload.get("description", ""),
            )
            db.add(row)
        elif section == "project":
            from app.student.profile_details_models import StudentProject
            row = StudentProject(
                tenant_id=identity.tenant_id, student_id=identity.user_id,
                name=payload.get("name", ""),
                role=payload.get("role", ""),
                start_date=payload.get("start_date", ""),
                end_date=payload.get("end_date", ""),
                description=payload.get("description", ""),
                link=payload.get("link", ""),
            )
            db.add(row)
        elif section == "skill":
            from app.student.profile_details_models import StudentSkill
            raw_level = payload.get("level")
            level_int = None
            if raw_level is not None:
                try:
                    level_int = int(raw_level)
                except (ValueError, TypeError):
                    level_int = None
            row = StudentSkill(
                tenant_id=identity.tenant_id, student_id=identity.user_id,
                name=payload.get("name", ""),
                level=level_int,
                description=payload.get("description", ""),
            )
            db.add(row)
        elif section == "honor":
            from app.student.profile_details_models import StudentHonor
            row = StudentHonor(
                tenant_id=identity.tenant_id, student_id=identity.user_id,
                title=payload.get("title") or payload.get("name", ""),
                level=payload.get("level", ""),
                award_date=payload.get("award_date") or payload.get("date", ""),
                description=payload.get("description", ""),
            )
            db.add(row)
        elif section == "cert":
            from app.student.profile_details_models import StudentCertification
            row = StudentCertification(
                tenant_id=identity.tenant_id, student_id=identity.user_id,
                name=payload.get("name", ""),
                issuer=payload.get("issuer", ""),
                issue_date=payload.get("issue_date") or payload.get("date", ""),
                expire_date=payload.get("expire_date", ""),
                description=payload.get("description", ""),
            )
            db.add(row)
        else:
            return error(f"不支持的 section: {section}", code=400)
    except Exception as exc:
        return error(f"保存失败: {exc}", code=500)

    proposal.status = "accepted"
    db.commit()
    return ok({"id": proposal.id, "status": "accepted"}, msg="已保存到个人档案")


@router.post("/profile/proposals/{proposal_id}/dismiss")
def dismiss_proposal(
    proposal_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    from app.student.proposal_models import StudentProfileProposal
    proposal = db.scalar(
        select(StudentProfileProposal).where(
            StudentProfileProposal.id == proposal_id,
            StudentProfileProposal.tenant_id == identity.tenant_id,
            StudentProfileProposal.student_id == identity.user_id,
            StudentProfileProposal.status == "pending",
        )
    )
    if not proposal:
        return error("提案不存在或已处理", code=404)
    proposal.status = "dismissed"
    db.commit()
    return ok({"id": proposal.id, "status": "dismissed"})


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
    if not payload.content.strip() and not payload.attachment_ids:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="请输入内容或上传附件。")
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
    content: str = Field(default="", max_length=12000)
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
    if not payload.content.strip() and not payload.attachment_ids:
        raise HTTPException(status_code=http_status.HTTP_400_BAD_REQUEST, detail="请输入内容或上传附件。")
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
    age = student.age
    if student.birth_date:
        try:
            born = _parse_birth_month(student.birth_date)
            today = date.today()
            if born:
                age = today.year - born.year - (today.month < born.month)
        except ValueError:
            pass
    return {
        "id": student.id,
        "account": student.account,
        "email": student.email,
        "name": student.name,
        "nickname": student.nickname,
        "gender": student.gender,
        "age": age,
        "birth_date": student.birth_date or "",
        "college": student.college,
        "major": student.major,
        "grade": student.grade,
        "phone": student.phone,
        "avatar_url": student.avatar_url,
        "resume_avatar_url": student.resume_avatar_url,
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


@router.get("/profile/completeness")
def get_profile_completeness(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """档案完整度：5 项判定 + has_resume。"""
    identity, student = current
    items = {
        "basic": bool((student.name or "").strip()),
        "education": db.scalar(
            select(
                select(StudentEducation.id)
                .where(
                    StudentEducation.student_id == identity.user_id,
                    StudentEducation.tenant_id == identity.tenant_id,
                )
                .exists()
            )
        ) or False,
        "experience_or_project": (
            db.scalar(
                select(
                    select(StudentWorkExperience.id)
                    .where(
                        StudentWorkExperience.student_id == identity.user_id,
                        StudentWorkExperience.tenant_id == identity.tenant_id,
                    )
                    .exists()
                )
            ) or
            db.scalar(
                select(
                    select(StudentProject.id)
                    .where(
                        StudentProject.student_id == identity.user_id,
                        StudentProject.tenant_id == identity.tenant_id,
                    )
                    .exists()
                )
            ) or False
        ),
        "skills": db.scalar(
            select(
                select(StudentSkill.id)
                .where(
                    StudentSkill.student_id == identity.user_id,
                    StudentSkill.tenant_id == identity.tenant_id,
                )
                .exists()
            )
        ) or False,
        "advantages": bool((student.personal_advantages or "").strip()),
    }
    has_resume = db.scalar(
        select(
            select(StudentResume.id)
            .where(
                StudentResume.student_id == identity.user_id,
                StudentResume.tenant_id == identity.tenant_id,
            )
            .exists()
        )
    ) or False
    completed = sum(1 for v in items.values() if v)
    score = int(completed / len(items) * 100)
    missing = [k for k, v in items.items() if not v]
    return ok({"score": score, "missing": missing, "items": items, "has_resume": has_resume})


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
    if "nickname" in update_data:
        nickname = (update_data["nickname"] or "").strip()
        if len(nickname) > 64:
            return error("昵称长度不能超过 64 个字符")
        update_data["nickname"] = nickname or None
    if "birth_date" in update_data:
        birth_date = _normalize_month(update_data["birth_date"] or "")
        update_data["birth_date"] = birth_date or None
        if birth_date:
            try:
                _parse_birth_month(birth_date)
            except ValueError:
                return error("birth_date 格式应为 YYYY-MM")
    if not update_data:
        return ok(_serialize_profile(student), msg="no fields to update")
    for field, value in update_data.items():
        if not hasattr(student, field):
            return error(f"不支持的字段：{field}")
        setattr(student, field, value)
    if "birth_date" in update_data:
        birth_date = update_data["birth_date"] or ""
        if birth_date:
            born = _parse_birth_month(birth_date)
            today = date.today()
            student.age = today.year - born.year - (today.month < born.month) if born else None
        else:
            student.age = None
    db.commit()
    db.refresh(student)
    return ok(_serialize_profile(student))


class StudentChangeEmailPayload(BaseModel):
    new_email: str = Field(max_length=255)
    code: str = Field(min_length=4, max_length=8)


@router.put("/profile/email")
def change_student_email_endpoint(
    payload: StudentChangeEmailPayload,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    from app.auth.schemas import StudentChangeEmailRequest
    req = StudentChangeEmailRequest(new_email=payload.new_email, code=payload.code)
    data = change_student_email(db, student=student, payload=req)
    return ok({**data, **_serialize_profile(student)})


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


def _propagate_resume_avatar(db: Session, *, student_id: int, tenant_id: int,
                              old_url: Optional[str], new_url: str) -> int:
    """When the user updates their resume avatar, also rewrite any of their existing
    resumes whose `basic.photo` was the previous avatar URL. This keeps the rendered
    resume in sync with the current avatar and avoids stale 404s in the browser console
    for users who uploaded a new avatar after creating a resume.

    Only resumes whose photo exactly equals the old URL are touched — per-resume
    customizations (the user can set a different photo in the editor) are preserved.
    Returns the number of resumes updated.
    """
    if not old_url or old_url == new_url:
        return 0
    rows = db.execute(
        select(StudentResume).where(
            StudentResume.tenant_id == tenant_id,
            StudentResume.student_id == student_id,
        )
    ).scalars().all()
    updated = 0
    for r in rows:
        try:
            data = json.loads(r.data_json or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        basic = data.get("basic") or {}
        if isinstance(basic, dict) and basic.get("photo") == old_url:
            basic["photo"] = new_url
            r.data_json = json.dumps(data, ensure_ascii=False)
            updated += 1
    if updated:
        logger.info(
            "propagated new resume avatar to %d existing resume(s) for student %d",
            updated, student_id,
        )
    return updated


@router.post("/profile/resume-avatar")
async def upload_resume_avatar(
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
    old_url = student.resume_avatar_url
    if old_url:
        old = AVATAR_DIR / Path(old_url).name
        if old.exists():
            old.unlink()
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"resume-{uuid.uuid4().hex}{ext}"
    (AVATAR_DIR / filename).write_bytes(content)
    student.resume_avatar_url = f"/static/avatars/{filename}"
    # Rewrite basic.photo on any existing resume that was using the old avatar URL,
    # so old resumes do not keep requesting a 404 file from the browser.
    _propagate_resume_avatar(
        db,
        student_id=student.id,
        tenant_id=student.tenant_id,
        old_url=old_url,
        new_url=student.resume_avatar_url,
    )
    db.commit()
    return ok({"resume_avatar_url": student.resume_avatar_url})


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
