from __future__ import annotations

from datetime import datetime, timezone

import sqlalchemy
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.admin.models import Announcement
from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/student", tags=["student-announcements"])


@router.get("/announcements")
def api_student_announcements(
    db: Session = Depends(get_db),
    _current=Depends(require_role("student")),
):
    now = datetime.now(timezone.utc)
    rows = db.scalars(
        sqlalchemy.select(Announcement)
        .where(
            Announcement.is_active == True,
            sqlalchemy.or_(
                Announcement.start_time == None,
                Announcement.start_time <= now,
            ),
            sqlalchemy.or_(
                Announcement.end_time == None,
                Announcement.end_time >= now,
            ),
        )
        .order_by(Announcement.priority.desc(), Announcement.created_at.desc())
    ).all()
    return ok([
        {
            "id": r.id,
            "title": r.title,
            "content": r.content,
            "announcement_type": r.announcement_type,
            "priority": r.priority,
            "start_time": r.start_time.isoformat() if r.start_time else None,
            "end_time": r.end_time.isoformat() if r.end_time else None,
            "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ])
