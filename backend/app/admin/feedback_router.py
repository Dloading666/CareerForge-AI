from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/admin", tags=["admin-feedback"])


class FeedbackItem(BaseModel):
    id: int
    student_id: int
    student_name: str | None
    student_email: str | None
    description: str
    category: str
    screenshot_path: str | None
    created_at: str | None
    status: str



@router.get("/feedback/stats")
def feedback_stats(
    current=Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    open_row = db.execute(text("SELECT COUNT(*) AS cnt FROM user_feedback WHERE status = 'open'")).mappings().one()
    latest_row = db.execute(text("SELECT MAX(id) AS mid FROM user_feedback")).mappings().one()
    return ok({"open_count": open_row["cnt"], "latest_id": latest_row["mid"] or 0})

@router.get("/feedback")
def list_feedback(
    page: int = Query(1, ge=1),
    size: int = Query(20, ge=1, le=100),
    status: str | None = Query(None),
    current=Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    where = ""
    params = {}
    if status:
        where = " WHERE status = :status"
        params["status"] = status
    count_row = db.execute(text(f"SELECT COUNT(*) as cnt FROM user_feedback{where}"), params).mappings().one()
    total = count_row["cnt"]
    offset = (page - 1) * size
    rows = db.execute(
        text(f"SELECT * FROM user_feedback{where} ORDER BY created_at DESC LIMIT :limit OFFSET :offset"),
        {**params, "limit": size, "offset": offset},
    ).mappings().all()
    items = []
    for r in rows:
        items.append({
            "id": r["id"],
            "student_id": r["student_id"],
            "student_name": r["student_name"],
            "student_email": r["student_email"],
            "description": r["description"],
            "category": r["category"],
            "screenshot_path": r["screenshot_path"],
            "created_at": str(r["created_at"]) if r["created_at"] else None,
            "status": r["status"],
        })
    return ok({"list": items, "total": total, "page": page, "size": size})


@router.patch("/feedback/{feedback_id}")
def update_feedback_status(
    feedback_id: int,
    body: dict,
    current=Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    new_status = body.get("status", "resolved")
    db.execute(text("UPDATE user_feedback SET status = :status WHERE id = :id"), {"status": new_status, "id": feedback_id})
    db.commit()
    return ok(msg="?????")
