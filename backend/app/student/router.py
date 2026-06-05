from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.student.agent_runtime import (
    create_session,
    get_history,
    list_available_models,
    list_sessions,
    serialize_activity,
    serialize_attachment,
    save_attachment,
    stream_master_reply,
)
from app.student.agent_schemas import (
    AgentHistoryResponse,
    AgentMessageRequest,
    AgentMessageResponse,
    AgentSessionCreate,
    AgentSessionResponse,
)

router = APIRouter(prefix="/student", tags=["student"])


@router.get("/home")
def student_home(current=Depends(require_role("student"))):
    _, student = current
    return ok(
        {
            "welcome": f"你好，{student.name or '同学'}",
            "suggestions": [
                "帮我模拟一次面试",
                "看看我和某岗位的匹配度",
                "优化我的简历项目经历",
            ],
        }
    )


@router.post("/master/sessions", status_code=201)
def create_master_session(
    payload: AgentSessionCreate | None = None,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session = create_session(db, identity, payload.title if payload else None)
    return ok(AgentSessionResponse.model_validate(session).model_dump(mode="json"), msg="created")


@router.get("/master/sessions")
def list_master_sessions(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok([AgentSessionResponse.model_validate(item).model_dump(mode="json") for item in list_sessions(db, identity)])


@router.get("/master/models")
def list_master_models(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok([item.model_dump(mode="json") for item in list_available_models(db, identity)])


@router.get("/master/sessions/{session_id}/messages")
def get_master_history(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    session, messages, activities, attachments = get_history(db, identity, session_id)
    data = AgentHistoryResponse(
        session=AgentSessionResponse.model_validate(session),
        messages=[AgentMessageResponse.model_validate(item) for item in messages],
        activities=[serialize_activity(item) for item in activities],
        attachments=[serialize_attachment(item) for item in attachments],
    )
    return ok(data.model_dump(mode="json"))


@router.post("/master/sessions/{session_id}/attachments", status_code=201)
async def upload_master_attachment(
    session_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    attachment = await save_attachment(db, identity, session_id, file)
    return ok(serialize_attachment(attachment).model_dump(mode="json"), msg="created")


@router.post("/master/sessions/{session_id}/messages/stream")
async def stream_master_message(
    session_id: int,
    payload: AgentMessageRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return StreamingResponse(
        stream_master_reply(
            db,
            identity,
            session_id,
            payload.content,
            payload.model_id,
            payload.reasoning_effort,
            payload.attachment_ids,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
