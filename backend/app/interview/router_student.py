from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.interview.schemas import InterviewStartRequest, InterviewTurnRequest
from app.interview.knowledge import reload_knowledge_index
from app.interview.service import (
    generate_report,
    get_interview_detail,
    knowledge_status,
    list_interviews,
    serialize_report,
    start_interview,
    submit_turn,
)

router = APIRouter(prefix="/student/interviews", tags=["student-interviews"])


@router.get("/knowledge/status")
def get_knowledge_status(current=Depends(require_role("student"))):
    return ok(knowledge_status())


@router.post("/knowledge/reload")
def reload_knowledge(current=Depends(require_role("student"))):
    return ok(reload_knowledge_index())


@router.post("")
def create_interview(
    payload: InterviewStartRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(start_interview(db, identity, payload), msg="created")


@router.get("")
def get_interviews(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(list_interviews(db, identity))


@router.get("/{session_id}")
def get_interview(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(get_interview_detail(db, identity, session_id))


@router.post("/{session_id}/turns")
def answer_turn(
    session_id: int,
    payload: InterviewTurnRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(submit_turn(db, identity, session_id, payload.answer))


@router.post("/{session_id}/finish")
def finish_interview(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    report = generate_report(db, identity, session_id)
    return ok(serialize_report(report))


@router.get("/{session_id}/report")
def get_report(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    report = generate_report(db, identity, session_id)
    return ok(serialize_report(report))
