"""中台 SSO token 登录。

流程：
1. 前端把中台登录后的 token 发到 `/api/v1/auth/sso/login`
2. 本服务用 token 调中台 `POST /sys/checkToken?token=xxx`（query 串）验证并拿到用户档案
3. 按 `result.username` 查本地学生；找不到则新建（`auth_source='sso'`，无密码）
4. 沿用现有 `issue_tokens` 签发 access/refresh，由前端跳到 /student

字段回填策略：仅原值为空时填。中台 `result.password` 永远不存、不返回。
"""
from __future__ import annotations

from typing import Any, Optional

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.models import StudentLoginLog, StudentUser
from app.auth.service import (
    build_profile,
    issue_tokens,
    normalize_email,
    record_student_login,
)
from app.core.config import Settings, get_settings
from app.core.security import utcnow


_SSO_PATH = "/sys/checkToken"


class InvalidSSOTokenError(Exception):
    """中台校验 token 失败（token 无效 / 过期 / 业务 success=false）。"""


class SSOUnavailableError(Exception):
    """中台不可达（超时 / 网络错误 / 5xx）。"""


async def fetch_zhongtai_user(token: str) -> dict[str, Any]:
    """调中台 checkToken，返回 `result` 字典。

    中台要求 token 通过 URL query 串传递（POST /sys/checkToken?token=xxx）。
    """
    settings: Settings = get_settings()
    base = settings.sso_base_url.rstrip("/")
    url = f"{base}{_SSO_PATH}"
    try:
        async with httpx.AsyncClient(timeout=settings.sso_timeout_seconds) as client:
            resp = await client.post(url, params={"token": token})
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        raise SSOUnavailableError(str(exc)) from exc

    if resp.status_code >= 500:
        raise SSOUnavailableError(f"中台返回 {resp.status_code}")

    try:
        payload = resp.json()
    except ValueError as exc:
        raise SSOUnavailableError("中台响应非 JSON") from exc

    if not isinstance(payload, dict):
        raise InvalidSSOTokenError("中台响应格式异常")

    if not payload.get("success"):
        raise InvalidSSOTokenError(payload.get("message") or "中台 token 无效")

    result = payload.get("result")
    if not isinstance(result, dict):
        raise InvalidSSOTokenError("中台响应缺少 result")

    # 防御性：忽略中台可能返回的密码字段，绝不外传
    result.pop("password", None)
    return result


async def sso_login(
    db: Session,
    *,
    token: str,
    ip: Optional[str],
    user_agent: Optional[str],
) -> dict:
    """用中台 token 登录或注册本地学生，返回与 `/auth/student/login` 一致的结构。"""
    settings = get_settings()
    source = (settings.sso_source or "qingzhu").strip() or "qingzhu"

    try:
        result = await fetch_zhongtai_user(token)
    except InvalidSSOTokenError:
        record_student_login(
            db,
            email="",
            result="fail",
            reason="sso_invalid_token",
            student=None,
            ip=ip,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="中台 token 无效或已过期")
    except SSOUnavailableError:
        record_student_login(
            db,
            email="",
            result="fail",
            reason="sso_unavailable",
            student=None,
            ip=ip,
            user_agent=user_agent,
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="中台暂不可用，请稍后再试",
        )

    username = (result.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="中台响应缺少 username")

    raw_email = (result.get("email") or "").strip()
    normalized_email = normalize_email(raw_email) if raw_email else ""
    realname = (result.get("realname") or "").strip() or None
    phone = (result.get("phone") or "").strip() or None
    avatar = (result.get("avatar") or "").strip() or None
    external_id = (result.get("id") or result.get("userId") or result.get("user_id"))
    if external_id is not None:
        external_id = str(external_id).strip() or None

    student: Optional[StudentUser] = db.scalar(
        select(StudentUser).where(
            StudentUser.external_username == username,
            StudentUser.is_deleted.is_(False),
        )
    )

    if student is None:
        # 新建：纯 SSO 用户，无密码。email/account 都可能与已有记录冲突，统一回退占位
        email_taken = False
        account_taken = False
        if normalized_email:
            email_taken = bool(
                db.scalar(
                    select(StudentUser.id).where(
                        StudentUser.email == normalized_email,
                        StudentUser.is_deleted.is_(False),
                    )
                )
            )
            account_taken = bool(
                db.scalar(
                    select(StudentUser.id).where(
                        StudentUser.account == normalized_email,
                        StudentUser.is_deleted.is_(False),
                    )
                )
            )
        placeholder_email = f"{username}@sso.local"
        if normalized_email and not email_taken:
            placeholder_email = normalized_email
        account = f"sso:{username}" if account_taken or not normalized_email else normalized_email
        student = StudentUser(
            tenant_id=0,
            account=account,
            email=placeholder_email,
            password_hash=None,
            name=realname or "同学",
            nickname=realname,
            phone=phone,
            avatar_url=avatar,
            status="active",
            email_verified_at=utcnow() if normalized_email else None,
            external_username=username,
            external_source=source,
            external_id=external_id,
            auth_source="sso",
        )
        db.add(student)
        db.commit()
        db.refresh(student)
        reason = "sso_register"
    else:
        # 关联：仅回填空字段，auth_source 保持原值（用户偏好方案 B）
        student.external_username = username
        if not student.external_source:
            student.external_source = source
        if external_id and not student.external_id:
            student.external_id = external_id
        if realname and not student.name:
            student.name = realname
        if realname and not student.nickname:
            student.nickname = realname
        if phone and not student.phone:
            student.phone = phone
        if avatar and not student.avatar_url:
            student.avatar_url = avatar
        db.commit()
        db.refresh(student)
        reason = "sso_login:external_username"

    student.last_login_at = utcnow()
    db.commit()
    db.refresh(student)

    tokens = issue_tokens(db, user_id=student.id, role="student", tenant_id=student.tenant_id)
    record_student_login(
        db,
        email=student.email,
        result="success",
        reason=reason,
        student=student,
        ip=ip,
        user_agent=user_agent,
    )
    return {
        **tokens,
        "role": "student",
        "profile": build_profile(student, "student")["profile"],
    }