from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/student", tags=["student-event"])


# ---- Pydantic Schemas ----
class EventCreate(BaseModel):
    title: str
    description: Optional[str] = None
    event_date: date
    event_time: Optional[time] = None
    color: str = "#165dff"

class EventUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[date] = None
    event_time: Optional[time] = None
    color: Optional[str] = None

class EventOut(BaseModel):
    id: int
    title: str
    description: Optional[str]
    event_date: date
    event_time: Optional[time]
    color: str
    created_at: datetime

    class Config:
        from_attributes = True


# ---- Raw SQL helpers (avoid extra model file) ----
def _raw_events(db: Session, student_id: int, event_date: Optional[date] = None):
    sql = "SELECT id, title, description, event_date, event_time, color, created_at FROM student_event WHERE student_id = :sid"
    params = {"sid": student_id}
    if event_date:
        sql += " AND event_date = :ed"
        params["ed"] = event_date
    sql += " ORDER BY event_date ASC, event_time ASC"
    return db.execute(text(sql), params).mappings().all()


# ---- Endpoints ----
@router.get("/events")
def list_events(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    sql = "SELECT id, title, description, event_date, event_time, color, created_at FROM student_event WHERE student_id = :sid"
    params = {"sid": student.id}
    if date_from:
        sql += " AND event_date >= :df"
        params["df"] = date_from
    if date_to:
        sql += " AND event_date <= :dt"
        params["dt"] = date_to
    sql += " ORDER BY event_date ASC, event_time ASC"
    rows = db.execute(text(sql), params).mappings().all()
    return ok([dict(r) for r in rows])


@router.post("/events")
def create_event(
    payload: EventCreate,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    db.execute(
        text(
            "INSERT INTO student_event (student_id, title, description, event_date, event_time, color) "
            "VALUES (:sid, :title, :desc, :ed, :et, :color)"
        ),
        {
            "sid": student.id,
            "title": payload.title,
            "desc": payload.description,
            "ed": payload.event_date,
            "et": payload.event_time,
            "color": payload.color,
        },
    )
    db.commit()
    return ok(msg="created")


@router.put("/events/{event_id}")
def update_event(
    event_id: int,
    payload: EventUpdate,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    # verify ownership
    event = db.execute(
        text("SELECT id FROM student_event WHERE id = :eid AND student_id = :sid"),
        {"eid": event_id, "sid": student.id},
    ).first()
    if not event:
        raise HTTPException(404, "event not found")

    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return ok(msg="nothing to update")
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    updates["eid"] = event_id
    db.execute(text(f"UPDATE student_event SET {set_clause} WHERE id = :eid"), updates)
    db.commit()
    return ok(msg="updated")


@router.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    result = db.execute(
        text("DELETE FROM student_event WHERE id = :eid AND student_id = :sid"),
        {"eid": event_id, "sid": student.id},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "event not found")
    return ok(msg="deleted")
