"""Personal calendar event endpoints (per-student calendar).

All persistence uses the StudentEvent ORM model (see event_models.py). No raw
SQL remains in this router; ownership checks are encoded in the WHERE clauses.
"""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, update, delete
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.event_models import StudentEvent

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


# ---- Endpoints ----
@router.get("/events")
def list_events(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    stmt = select(StudentEvent).where(StudentEvent.student_id == student.id)
    if date_from:
        stmt = stmt.where(StudentEvent.event_date >= date_from)
    if date_to:
        stmt = stmt.where(StudentEvent.event_date <= date_to)
    stmt = stmt.order_by(StudentEvent.event_date.asc(), StudentEvent.event_time.asc())
    rows = db.scalars(stmt).all()
    return ok([EventOut.model_validate(r).model_dump(mode="json") for r in rows])


@router.post("/events")
def create_event(
    payload: EventCreate,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    event = StudentEvent(
        student_id=student.id,
        title=payload.title,
        description=payload.description,
        event_date=payload.event_date,
        event_time=payload.event_time,
        color=payload.color,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    return ok({"id": event.id}, msg="created")


@router.put("/events/{event_id}")
def update_event(
    event_id: int,
    payload: EventUpdate,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return ok(msg="nothing to update")
    stmt = (
        update(StudentEvent)
        .where(StudentEvent.id == event_id, StudentEvent.student_id == student.id)
        .values(**updates)
    )
    result = db.execute(stmt)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "event not found")
    return ok(msg="updated")


@router.delete("/events/{event_id}")
def delete_event(
    event_id: int,
    current=Depends(require_role("student")),
    db: Session = Depends(get_db),
):
    _, student = current
    stmt = delete(StudentEvent).where(
        StudentEvent.id == event_id, StudentEvent.student_id == student.id
    )
    result = db.execute(stmt)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "event not found")
    return ok(msg="deleted")