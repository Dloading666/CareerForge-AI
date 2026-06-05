from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.captcha import verify_captcha
from app.auth.email import get_mail_provider
from app.auth.models import (
    AdminLoginLog,
    AdminRefreshToken,
    AdminUser,
    StudentEmailCode,
    StudentLoginLog,
    StudentRefreshToken,
    StudentUser,
)
from app.auth.schemas import (
    AdminLoginRequest,
    StudentEmailCodeSendRequest,
    StudentLoginRequest,
    StudentRegisterRequest,
    StudentResetPasswordRequest,
)
from app.core.config import Settings, get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    hash_token,
    utcnow,
    verify_password,
)
from app.infra.db import get_db
from app.infra.redis_client import get_redis


@dataclass
class AuthIdentity:
    user_id: int
    role: str
    tenant_id: int


def normalize_email(email: str) -> str:
    return email.strip().lower()


def generate_email_code(settings: Settings) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(settings.email_code_length))


def build_profile(user, role: str):
    if role == "admin":
        return {
            "id": user.id,
            "role": role,
            "profile": {
                "display_name": user.display_name or user.username or user.email,
                "email": user.email,
                "avatar_url": getattr(user, "avatar_url", None),
            },
        }

    return {
        "id": user.id,
        "role": role,
        "profile": {
            "name": user.name or "同学",
            "email": user.email,
            "college": user.college,
            "major": user.major,
            "grade": user.grade,
            "avatar_url": getattr(user, "avatar_url", None),
        },
    }


def ensure_admin_bootstrap(db: Session) -> None:
    settings = get_settings()
    email = normalize_email(settings.admin_bootstrap_email)
    existing = db.scalar(
        select(AdminUser).where(
            (AdminUser.email == email) | (AdminUser.username == settings.admin_bootstrap_username)
        )
    )
    if existing:
        existing.username = settings.admin_bootstrap_username
        existing.email = email
        existing.password_hash = hash_password(settings.admin_bootstrap_password)
        existing.display_name = settings.admin_bootstrap_name
        existing.status = "active"
        db.commit()
        return

    admin = AdminUser(
        username=settings.admin_bootstrap_username,
        email=email,
        password_hash=hash_password(settings.admin_bootstrap_password),
        display_name=settings.admin_bootstrap_name,
        status="active",
    )
    db.add(admin)
    db.commit()


def issue_tokens(db: Session, *, user_id: int, role: str, tenant_id: int) -> dict:
    access = create_access_token(sub=str(user_id), role=role, tenant_id=tenant_id)
    refresh, expires_at = create_refresh_token(sub=str(user_id), role=role, tenant_id=tenant_id)
    token_hash_value = hash_token(refresh)

    if role == "admin":
        db.add(
            AdminRefreshToken(
                admin_id=user_id,
                token_hash=token_hash_value,
                expires_at=expires_at,
                revoked=False,
            )
        )
    else:
        db.add(
            StudentRefreshToken(
                student_id=user_id,
                token_hash=token_hash_value,
                expires_at=expires_at,
                revoked=False,
            )
        )
    db.commit()

    return {
        "access": access,
        "refresh": refresh,
    }


def record_student_login(
    db: Session,
    *,
    email: str,
    result: str,
    reason: Optional[str],
    student: Optional[StudentUser],
    ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    db.add(
        StudentLoginLog(
            student_id=student.id if student else None,
            account=student.account if student else email,
            email=email,
            ip=ip,
            ua=user_agent,
            result=result,
            reason=reason,
        )
    )
    db.commit()


def record_admin_login(
    db: Session,
    *,
    account: str,
    result: str,
    reason: Optional[str],
    admin: Optional[AdminUser],
    ip: Optional[str],
    user_agent: Optional[str],
) -> None:
    db.add(
        AdminLoginLog(
            admin_id=admin.id if admin else None,
            username=admin.username if admin else account,
            email=admin.email if admin else None,
            ip=ip,
            ua=user_agent,
            result=result,
            reason=reason,
        )
    )
    db.commit()


def login_rate_key(*, role: str, account: str, ip: Optional[str]) -> str:
    account_fingerprint = hash_token(f"{role}:{account.strip().lower()}")
    ip_fingerprint = hash_token(ip or "unknown")
    return f"auth:login_fail:{role}:{account_fingerprint}:{ip_fingerprint}"


def check_login_rate_limit(*, role: str, account: str, ip: Optional[str]) -> None:
    key = login_rate_key(role=role, account=account, ip=ip)
    lock_key = f"{key}:lock"
    try:
        client = get_redis()
        ttl = client.ttl(lock_key)
        if ttl and ttl > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"登录失败次数过多，请 {ttl} 秒后再试",
            )
    except HTTPException:
        raise
    except Exception:
        return


def record_login_failure(*, role: str, account: str, ip: Optional[str]) -> None:
    settings = get_settings()
    key = login_rate_key(role=role, account=account, ip=ip)
    lock_key = f"{key}:lock"
    try:
        client = get_redis()
        count = int(client.incr(key))
        if count == 1:
            client.expire(key, settings.login_fail_window_seconds)
        if count >= settings.login_fail_limit:
            client.setex(lock_key, settings.login_lock_seconds, "1")
            client.delete(key)
    except Exception:
        return


def clear_login_failures(*, role: str, account: str, ip: Optional[str]) -> None:
    key = login_rate_key(role=role, account=account, ip=ip)
    try:
        client = get_redis()
        client.delete(key, f"{key}:lock")
    except Exception:
        return


def send_student_email_code(db: Session, payload: StudentEmailCodeSendRequest) -> dict:
    settings = get_settings()
    provider = get_mail_provider(settings)
    email = normalize_email(payload.email)
    scene = payload.scene

    # 重置密码场景：先校验图形验证码，通过后才发送邮箱验证码
    if scene == "reset":
        if not verify_captcha(payload.captcha_id or "", payload.captcha_code or ""):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图形验证码错误或已失效")

    existing_user = db.scalar(select(StudentUser).where(StudentUser.email == email, StudentUser.is_deleted.is_(False)))
    if scene == "register" and existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册")

    # 对于 login / reset，邮箱未注册时静默返回，避免暴露邮箱是否存在
    if scene in ("login", "reset") and not existing_user:
        return {"cooldown_sec": settings.email_code_cooldown_seconds}

    record = db.scalar(select(StudentEmailCode).where(StudentEmailCode.email == email, StudentEmailCode.scene == scene))
    now = utcnow()

    if record and (now - record.last_sent_at).total_seconds() < settings.email_code_cooldown_seconds:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="验证码发送过于频繁，请稍后再试")

    code = generate_email_code(settings)
    code_hash = hash_token(code)
    expires_at = now + timedelta(minutes=settings.email_code_ttl_minutes)

    if record:
        record.code_hash = code_hash
        record.expires_at = expires_at
        record.consumed_at = None
        record.attempt_count = 0
        record.send_count += 1
        record.last_sent_at = now
    else:
        record = StudentEmailCode(
            email=email,
            scene=scene,
            code_hash=code_hash,
            expires_at=expires_at,
            consumed_at=None,
            send_count=1,
            attempt_count=0,
            last_sent_at=now,
        )
        db.add(record)

    db.commit()
    provider.send_code(email=email, scene=scene, code=code)

    data = {"cooldown_sec": settings.email_code_cooldown_seconds}
    if settings.is_development:
        data["debug_code"] = code
    return data


def verify_student_email_code(db: Session, *, email: str, scene: str, code: str) -> None:
    settings = get_settings()
    record = db.scalar(select(StudentEmailCode).where(StudentEmailCode.email == email, StudentEmailCode.scene == scene))
    now = utcnow()

    if not record or record.consumed_at is not None or record.expires_at < now:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="验证码错误或已失效")

    if record.attempt_count >= settings.email_code_max_attempts:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="验证码尝试次数过多，请重新获取")

    if record.code_hash != hash_token(code):
        record.attempt_count += 1
        db.commit()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="验证码错误或已失效")

    record.consumed_at = now
    db.commit()


def register_student(
    db: Session,
    payload: StudentRegisterRequest,
    *,
    ip: Optional[str],
    user_agent: Optional[str],
) -> dict:
    email = normalize_email(payload.email)
    verify_student_email_code(db, email=email, scene="register", code=payload.code)

    existing_user = db.scalar(select(StudentUser).where(StudentUser.email == email, StudentUser.is_deleted.is_(False)))
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="该邮箱已注册")

    student = StudentUser(
        account=email,
        email=email,
        password_hash=hash_password(payload.password),
        name="同学",
        email_verified_at=utcnow(),
        status="active",
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    student.last_login_at = utcnow()
    db.commit()
    tokens = issue_tokens(db, user_id=student.id, role="student", tenant_id=student.tenant_id)
    record_student_login(
        db,
        email=email,
        result="success",
        reason="register",
        student=student,
        ip=ip,
        user_agent=user_agent,
    )
    return {**tokens, "role": "student", "profile": build_profile(student, "student")["profile"]}


def reset_student_password(
    db: Session,
    payload: StudentResetPasswordRequest,
    *,
    ip: Optional[str],
    user_agent: Optional[str],
) -> dict:
    email = normalize_email(payload.email)
    verify_student_email_code(db, email=email, scene="reset", code=payload.code)

    student = db.scalar(
        select(StudentUser).where(StudentUser.email == email, StudentUser.is_deleted.is_(False))
    )
    if not student:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="该邮箱未注册")

    student.password_hash = hash_password(payload.password)
    if student.email_verified_at is None:
        student.email_verified_at = utcnow()

    # 重置密码后吊销该学生所有未失效的刷新令牌，强制重新登录
    tokens = db.scalars(
        select(StudentRefreshToken).where(
            StudentRefreshToken.student_id == student.id,
            StudentRefreshToken.revoked.is_(False),
        )
    ).all()
    for token in tokens:
        token.revoked = True
    db.commit()

    # 清除登录失败计数，避免重置后仍被锁定
    clear_login_failures(role="student", account=email, ip=ip)
    record_student_login(
        db,
        email=email,
        result="success",
        reason="reset_password",
        student=student,
        ip=ip,
        user_agent=user_agent,
    )
    return {"msg": "密码重置成功，请使用新密码登录"}


def login_student(
    db: Session,
    payload: StudentLoginRequest,
    *,
    ip: Optional[str],
    user_agent: Optional[str],
) -> dict:
    email = normalize_email(payload.email)
    check_login_rate_limit(role="student", account=email, ip=ip)
    student = db.scalar(select(StudentUser).where(StudentUser.email == email, StudentUser.is_deleted.is_(False)))
    if not student or not student.password_hash or not verify_password(payload.password, student.password_hash):
        record_login_failure(role="student", account=email, ip=ip)
        record_student_login(
            db,
            email=email,
            result="fail",
            reason="invalid_credentials",
            student=None,
            ip=ip,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="邮箱或密码错误")

    student.last_login_at = utcnow()
    if student.email_verified_at is None:
        student.email_verified_at = utcnow()
    db.commit()

    clear_login_failures(role="student", account=email, ip=ip)
    tokens = issue_tokens(db, user_id=student.id, role="student", tenant_id=student.tenant_id)
    record_student_login(
        db,
        email=email,
        result="success",
        reason="login",
        student=student,
        ip=ip,
        user_agent=user_agent,
    )
    return {**tokens, "role": "student", "profile": build_profile(student, "student")["profile"]}


def login_admin(
    db: Session,
    payload: AdminLoginRequest,
    *,
    ip: Optional[str],
    user_agent: Optional[str],
) -> dict:
    account = payload.account.strip()
    normalized_account = normalize_email(account)
    check_login_rate_limit(role="admin", account=normalized_account, ip=ip)
    admin = db.scalar(
        select(AdminUser).where(
            ((AdminUser.username == account) | (AdminUser.email == normalized_account)) & AdminUser.is_deleted.is_(False)
        )
    )
    if not admin or not verify_password(payload.password, admin.password_hash):
        record_login_failure(role="admin", account=normalized_account, ip=ip)
        record_admin_login(
            db,
            account=account,
            result="fail",
            reason="invalid_credentials",
            admin=admin,
            ip=ip,
            user_agent=user_agent,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号或密码错误")

    admin.last_login_at = utcnow()
    db.commit()
    clear_login_failures(role="admin", account=normalized_account, ip=ip)
    tokens = issue_tokens(db, user_id=admin.id, role="admin", tenant_id=admin.tenant_id)
    record_admin_login(
        db,
        account=account,
        result="success",
        reason="login",
        admin=admin,
        ip=ip,
        user_agent=user_agent,
    )
    return {**tokens, "role": "admin", "profile": build_profile(admin, "admin")["profile"]}


def refresh_access_token(db: Session, refresh_token: str) -> dict:
    payload = decode_token(refresh_token, expected_type="refresh")
    role = payload["role"]
    user_id = int(payload["sub"])
    tenant_id = int(payload["tenant_id"])
    token_hash_value = hash_token(refresh_token)
    now = utcnow()

    if role == "admin":
        record = db.scalar(
            select(AdminRefreshToken).where(
                AdminRefreshToken.admin_id == user_id,
                AdminRefreshToken.token_hash == token_hash_value,
            )
        )
    else:
        record = db.scalar(
            select(StudentRefreshToken).where(
                StudentRefreshToken.student_id == user_id,
                StudentRefreshToken.token_hash == token_hash_value,
            )
        )

    if not record or record.revoked or record.expires_at < now:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="刷新令牌无效或已过期")

    access = create_access_token(sub=str(user_id), role=role, tenant_id=tenant_id)
    return {"access": access}


def logout_refresh_token(db: Session, refresh_token: str) -> None:
    payload = decode_token(refresh_token, expected_type="refresh")
    role = payload["role"]
    user_id = int(payload["sub"])
    token_hash_value = hash_token(refresh_token)

    if role == "admin":
        record = db.scalar(
            select(AdminRefreshToken).where(
                AdminRefreshToken.admin_id == user_id,
                AdminRefreshToken.token_hash == token_hash_value,
            )
        )
    else:
        record = db.scalar(
            select(StudentRefreshToken).where(
                StudentRefreshToken.student_id == user_id,
                StudentRefreshToken.token_hash == token_hash_value,
            )
        )

    if record and not record.revoked:
        record.revoked = True
        db.commit()


def get_current_identity(
    authorization: str = Header(default=""),
) -> AuthIdentity:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少认证信息")

    token = authorization.split(" ", 1)[1].strip()
    payload = decode_token(token, expected_type="access")
    return AuthIdentity(
        user_id=int(payload["sub"]),
        role=payload["role"],
        tenant_id=int(payload["tenant_id"]),
    )


def get_current_user(
    identity: AuthIdentity = Depends(get_current_identity),
    db: Session = Depends(get_db),
):
    if identity.role == "admin":
        user = db.get(AdminUser, identity.user_id)
    else:
        user = db.get(StudentUser, identity.user_id)

    if not user or user.is_deleted:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="当前用户不存在")

    return identity, user


def require_role(expected_role: str):
    def dependency(current=Depends(get_current_user)):
        identity, user = current
        if identity.role != expected_role:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权访问该资源")
        return identity, user

    return dependency
