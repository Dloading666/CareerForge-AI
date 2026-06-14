from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.interview.schemas import InterviewStartRequest, InterviewTurnRequest
from app.interview.progress import get_progress, set_progress
from app.interview.service import (
    delete_interview,
    delete_report,
    export_interview_report,
    generate_report,
    get_interview_detail,
    get_report,
    get_turn_tts_text,
    knowledge_status,
    list_interviews,
    serialize_report,
    start_interview,
    submit_turn,
    voice_submit_turn,
    extract_uploaded_resume,
)

router = APIRouter(prefix="/student/interviews", tags=["student-interviews"])


# ── Interview CRUD ────────────────────────────────────────────────────────────


@router.get("/knowledge/status")
def get_knowledge_status(current=Depends(require_role("student"))):
    return ok(knowledge_status())


# P0-5: 学生端已移除 knowledge reload，需要时由管理员通过 admin 路由操作


@router.get("/progress/{request_id}")
def get_interview_progress(
    request_id: str,
    current=Depends(require_role("student")),
):
    progress = get_progress(request_id)
    if not progress:
        return ok({
            "stage": "unknown",
            "status": "pending",
            "message": "等待任务开始",
            "done": False,
            "error": None,
        })
    return ok(progress)


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
    try:
        return ok(start_interview(db, identity, payload), msg="created")
    except Exception as exc:
        set_progress(payload.request_id, stage="error", status="error", message="创建面试失败", done=True, error=str(exc))
        raise


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


@router.get("/{session_id}/export")
def export_interview(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """Export full interview report as JSON."""
    identity, _ = current
    return ok(export_interview_report(db, identity, session_id))


@router.post("/{session_id}/turns")
def answer_turn(
    session_id: int,
    payload: InterviewTurnRequest,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(submit_turn(
        db, identity, session_id, payload.answer,
        request_id=payload.request_id,
        turn_id=payload.turn_id,
    ))


# ── 语音面试接口（标准 multipart/form-data）────────────────────────────────────


@router.post("/{session_id}/turns/voice")
async def voice_answer_turn(
    session_id: int,
    file: UploadFile = File(..., description="音频文件 (webm/wav/mp3/ogg)"),
    turn_id: int = Form(..., description="当前问题 ID"),
    request_id: str | None = Form(default=None, description="幂等请求 ID"),
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """语音面试回答（标准接口）。

    接收 multipart/form-data 音频文件，转写后直接调用 submit_turn。
    返回转写文本 + 面试结果（与文字模式完全相同的管线）。
    """
    identity, _ = current
    return ok(await voice_submit_turn(
        db, identity, session_id,
        turn_id=turn_id,
        audio_file=file,
        request_id=request_id,
    ))


@router.get("/{session_id}/turns/{turn_id}/voice/reply")
def get_voice_reply(
    session_id: int,
    turn_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """获取面试官问题的文本（供前端 TTS 朗读）。

    只读取数据库中已有的 turn.question，不重新生成。
    前端使用浏览器 SpeechSynthesis 或服务端 TTS 将其转为语音。
    """
    identity, _ = current
    return ok(get_turn_tts_text(db, identity, session_id, turn_id))


# ── 报告接口 ─────────────────────────────────────────────────────────────────


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
def get_report_endpoint(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    return ok(get_report(db, identity, session_id))


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


@router.post("/{session_id}/report/delete")
def delete_report_endpoint(
    session_id: int,
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    identity, _ = current
    delete_report(db, identity, session_id)
    return ok({"deleted": True})
