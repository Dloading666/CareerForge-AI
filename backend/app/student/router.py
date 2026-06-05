from __future__ import annotations

import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok, error
from app.infra.db import get_db

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
    return ok({
        "welcome": "welcome, %s" % (student.name or "student"),
        "suggestions": ["mock interview", "job match analysis", "resume optimization", "campus recruitment FAQ"],
    })


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
