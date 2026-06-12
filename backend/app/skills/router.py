from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.skills.schemas import SkillCreateRequest, SkillStatusRequest, SkillUpdateRequest
from app.skills.service import (
    create_skill,
    delete_skill,
    get_skill_or_404,
    list_skills,
    serialize_skill,
    set_skill_status,
    update_skill,
)

router = APIRouter(tags=["skills"])


@router.get("/admin/skills")
def admin_list_skills(
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    return ok([serialize_skill(skill) for skill in list_skills(db)])


@router.post("/admin/skills", status_code=201)
def admin_create_skill(
    payload: SkillCreateRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    identity, _ = current
    skill = create_skill(db, payload, admin_id=identity.user_id)
    data = serialize_skill(skill)
    return ok(data, msg=f"Skill「{data.get('name') or skill.id}」已创建")


@router.get("/admin/skills/{skill_id}")
def admin_get_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    return ok(serialize_skill(get_skill_or_404(db, skill_id)))


@router.put("/admin/skills/{skill_id}")
def admin_update_skill(
    skill_id: int,
    payload: SkillUpdateRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    skill = update_skill(db, skill_id, payload)
    data = serialize_skill(skill)
    return ok(data, msg=f"Skill「{data.get('name') or skill_id}」已更新")


@router.patch("/admin/skills/{skill_id}/status")
def admin_set_skill_status(
    skill_id: int,
    payload: SkillStatusRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    return ok(serialize_skill(set_skill_status(db, skill_id, payload.status)))


@router.delete("/admin/skills/{skill_id}")
def admin_delete_skill(
    skill_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    delete_skill(db, skill_id)
    return ok({"deleted": True})


@router.get("/skills/enabled")
def admin_list_enabled_skill_documents(
    db: Session = Depends(get_db),
    current=Depends(require_role("admin")),
):
    # 第一版只开放给管理员/未来编排服务读取，避免把原始 Skill 指令直接暴露给学生端。
    return ok([serialize_skill(skill) for skill in list_skills(db, include_disabled=False)])
