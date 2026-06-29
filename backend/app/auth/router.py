from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Header, Request, UploadFile
import os, uuid, shutil
from sqlalchemy.orm import Session

from app.infra.client_ip import trusted_client_ip

from app.auth.schemas import (
    AdminLoginRequest,
    LogoutRequest,
    RefreshRequest,
    SSOLoginRequest,
    StudentEmailCodeSendRequest,
    StudentLoginRequest,
    StudentRegisterRequest,
    StudentResetPasswordRequest,
    UnifiedLoginRequest,
)
from app.auth.service import (
    get_current_user,
    login_admin,
    login_student,
    login_unified,
    logout_refresh_token,
    refresh_access_token,
    register_student,
    reset_student_password,
    send_student_email_code,
)
from app.auth.sso import sso_login
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/captcha")
def get_captcha():
    from app.auth.captcha import generate_captcha

    return ok(generate_captcha())


@router.post("/student/email/send-code")
def student_send_code(
    payload: StudentEmailCodeSendRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
):
    data = send_student_email_code(db, payload, ip=trusted_client_ip(request, x_forwarded_for))
    return ok(data)


@router.post("/login")
def unified_login(
    payload: UnifiedLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = login_unified(db, payload, ip=trusted_client_ip(request, x_forwarded_for), user_agent=user_agent)
    return ok(data)


@router.post("/student/register")
def student_register(
    payload: StudentRegisterRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = register_student(db, payload, ip=trusted_client_ip(request, x_forwarded_for), user_agent=user_agent)
    return ok(data)


@router.post("/student/reset-password")
def student_reset_password(
    payload: StudentResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = reset_student_password(db, payload, ip=trusted_client_ip(request, x_forwarded_for), user_agent=user_agent)
    return ok(data)


@router.post("/student/login")
def student_login(
    payload: StudentLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = login_student(db, payload, ip=trusted_client_ip(request, x_forwarded_for), user_agent=user_agent)
    return ok(data)


@router.post("/admin/login")
def admin_login(
    payload: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = login_admin(db, payload, ip=trusted_client_ip(request, x_forwarded_for), user_agent=user_agent)
    return ok(data)


@router.post("/sso/login")
async def sso_token_login(
    payload: SSOLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = await sso_login(
        db,
        token=payload.token,
        ip=trusted_client_ip(request, x_forwarded_for),
        user_agent=user_agent,
    )
    return ok(data)


@router.post("/refresh")
def refresh_token(payload: RefreshRequest, db: Session = Depends(get_db)):
    data = refresh_access_token(db, payload.refresh)
    return ok(data)


@router.post("/logout")
def logout(payload: LogoutRequest, db: Session = Depends(get_db)):
    logout_refresh_token(db, payload.refresh)
    return ok({})


@router.patch("/me")
def update_my_profile(payload: dict, db: Session = Depends(get_db), current=Depends(get_current_user)):
    identity, user = current
    for key in ("display_name",):
        if key in payload and payload[key]:
            setattr(user, key, payload[key])
    db.commit(); db.refresh(user)
    return ok({"msg": "ok"})

@router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), db: Session = Depends(get_db), current=Depends(get_current_user)):
    identity, user = current
    ext = os.path.splitext(file.filename or ".png")[1] or ".png"
    filename = f"{uuid.uuid4().hex}{ext}"
    upload_dir = os.path.join("data", "avatars")
    os.makedirs(upload_dir, exist_ok=True)
    filepath = os.path.join(upload_dir, filename)
    with open(filepath, "wb") as f:
        shutil.copyfileobj(file.file, f)
    user.avatar_url = f"/static/avatars/{filename}"
    db.commit(); db.refresh(user)
    return ok({"avatar_url": user.avatar_url})

@router.get("/me")
def current_me(current=Depends(get_current_user)):
    identity, user = current
    role = identity.role
    profile = {
        "id": user.id,
        "role": role,
        "profile": {
            "email": user.email,
            "display_name": getattr(user, "display_name", None),
            "name": getattr(user, "name", None),
            "nickname": getattr(user, "nickname", None),
            "college": getattr(user, "college", None),
            "major": getattr(user, "major", None),
            "grade": getattr(user, "grade", None),
            "avatar_url": getattr(user, "avatar_url", None),
        },
    }
    return ok(profile)
