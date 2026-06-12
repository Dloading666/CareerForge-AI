from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.interview.schemas import InterviewStartRequest, InterviewTurnRequest
from app.interview.service import (
    delete_interview,
    delete_report,
    generate_report,
    get_interview_detail,
    knowledge_status,
    list_interviews,
    serialize_report,
    start_interview,
    submit_turn,
    extract_uploaded_resume,
)

router = APIRouter(prefix="/student/interviews", tags=["student-interviews"])


@router.get("/knowledge/status")
def get_knowledge_status(current=Depends(require_role("student"))):
    return ok(knowledge_status())


@router.post("/resume/extract")
async def extract_resume(
    file: UploadFile = File(...),
    current=Depends(require_role("student")),
):
    return ok(await extract_uploaded_resume(file))


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


@router.delete("/{session_id}")
def remove_interview(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    delete_interview(db, identity, session_id)
    return ok({"deleted": True})


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


@router.post("/{session_id}/report/regenerate")
def regenerate_report(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    delete_report(db, identity, session_id)
    report = generate_report(db, identity, session_id)
    return ok(serialize_report(report))
