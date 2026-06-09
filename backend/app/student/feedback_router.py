from __future__ import annotations

import uuid
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok, error
from app.infra.db import get_db

router = APIRouter(prefix="/student", tags=["student-feedback"])

FEEDBACK_DIR = Path("/app/data/feedbacks")
FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)


@router.post("/feedback")
async def submit_feedback(
    description: str = Form(..., description="Bug description"),
    category: str = Form(default="bug", description="Feedback category"),
    screenshot: UploadFile | None = File(default=None),
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    img_path = None
    if screenshot and screenshot.filename:
        ext = Path(screenshot.filename).suffix or ".png"
        filename = f"{uuid.uuid4().hex}{ext}"
        img_path = f"/app/data/feedbacks/{filename}"
        content = await screenshot.read()
        with open(img_path, "wb") as f:
            f.write(content)
        img_path = f"feedbacks/{filename}"
    db.execute(
        text(
            "INSERT INTO user_feedback (student_id, student_name, student_email, description, category, screenshot_path, created_at) "
            "VALUES (:sid, :sname, :semail, :desc, :cat, :img, :now)"
        ),
        {
            "sid": student.id,
            "sname": student.name or student.account,
            "semail": student.email or "",
            "desc": description,
            "cat": category,
            "img": img_path,
            "now": datetime.now(timezone.utc),
        },
    )
    db.commit()
    return ok(msg="??????????")
