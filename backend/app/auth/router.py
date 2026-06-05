from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, File, Header, UploadFile
import os, uuid, shutil
from sqlalchemy.orm import Session

from app.auth.schemas import (
    AdminLoginRequest,
    LogoutRequest,
    RefreshRequest,
    StudentEmailCodeSendRequest,
    StudentLoginRequest,
    StudentRegisterRequest,
)
from app.auth.service import (
    get_current_user,
    login_admin,
    login_student,
    logout_refresh_token,
    refresh_access_token,
    register_student,
    send_student_email_code,
)
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/student/email/send-code")
def student_send_code(payload: StudentEmailCodeSendRequest, db: Session = Depends(get_db)):
    data = send_student_email_code(db, payload)
    return ok(data)


@router.post("/student/register")
def student_register(
    payload: StudentRegisterRequest,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = register_student(db, payload, ip=x_forwarded_for, user_agent=user_agent)
    return ok(data)


@router.post("/student/login")
def student_login(
    payload: StudentLoginRequest,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = login_student(db, payload, ip=x_forwarded_for, user_agent=user_agent)
    return ok(data)


@router.post("/admin/login")
def admin_login(
    payload: AdminLoginRequest,
    db: Session = Depends(get_db),
    x_forwarded_for: Optional[str] = Header(default=None),
    user_agent: Optional[str] = Header(default=None),
):
    data = login_admin(db, payload, ip=x_forwarded_for, user_agent=user_agent)
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
    user.avatar_url = f"/data/avatars/{filename}"
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
            "college": getattr(user, "college", None),
            "major": getattr(user, "major", None),
            "grade": getattr(user, "grade", None),
            "avatar_url": getattr(user, "avatar_url", None),
        },
    }
    return ok(profile)
