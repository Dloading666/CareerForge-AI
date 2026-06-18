from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, UploadFile
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.auth.service import require_role
from app.core.response import ok
from app.infra.db import get_db
from app.interview.exceptions import InterviewError
from app.interview.schemas import InterviewStartRequest, InterviewTurnRequest
from app.interview.progress import get_progress, set_progress
from app.interview.run_events import (
    create_interview_run,
    assert_interview_run_owner,
    get_interview_events,
    is_interview_run_done,
    emit_interview_event,
    mark_interview_run_done,
)
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
    transcribe_voice_audio,
    transcribe_voice_audio_sync,
    voice_submit_turn,
    voice_submit_turn_sync,
    extract_uploaded_resume,
)

logger = logging.getLogger(__name__)

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


# ── Interview Run 事件流 ──────────────────────────────────────────────────────


@router.get("/runs/{run_id}/events")
async def get_run_events(
    run_id: str,
    after_seq: int = 0,
    current=Depends(require_role("student")),
):
    """SSE 端点：订阅 interview run 事件流。"""
    identity, _ = current
    try:
        assert_interview_run_owner(run_id, tenant_id=identity.tenant_id, student_id=identity.user_id)
    except KeyError:
        return Response(status_code=404, content="run not found")

    async def event_generator():
        cursor_seq = after_seq
        heartbeat_count = 0
        while True:
            events = get_interview_events(run_id, after_seq=cursor_seq)
            for evt in events:
                cursor_seq = int(evt.get("seq", cursor_seq))
                payload = dict(evt["data"])
                payload["seq"] = evt["seq"]
                yield f"event: {evt['event']}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if is_interview_run_done(run_id) and not events:
                yield f"event: done\ndata: {json.dumps({'seq': cursor_seq})}\n\n"
                break
            if events:
                heartbeat_count = 0
            else:
                heartbeat_count += 1
            if heartbeat_count >= 10:
                yield ": heartbeat\n\n"
                heartbeat_count = 0
            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _run_start_interview_background(
    run_id: str,
    identity_tuple: tuple,
    payload_dict: dict,
):
    """后台任务：执行 start_interview 并发射事件。"""
    from app.infra.db import SessionLocal
    from app.auth.service import AuthIdentity

    db = SessionLocal()
    try:
        identity = AuthIdentity(user_id=identity_tuple[0], tenant_id=identity_tuple[1], role=identity_tuple[2])
        payload = InterviewStartRequest(**payload_dict)
        try:
            result = start_interview(db, identity, payload, event_run_id=run_id)
            # start_interview 内部已发射 interview.started 和 done
        except Exception as exc:
            logger.exception("run_start_interview_background failed")
            emit_interview_event(run_id, "runtime.error", {"message": str(exc)})
            mark_interview_run_done(run_id)
    finally:
        db.close()


@router.post("/runs/start")
def start_interview_run(
    payload: InterviewStartRequest,
    background_tasks: BackgroundTasks,
    current=Depends(require_role("student")),
):
    """启动 interview run，返回 run_id，后台执行 start_interview。"""
    identity, _ = current
    run_id = create_interview_run(tenant_id=identity.tenant_id, student_id=identity.user_id)
    background_tasks.add_task(
        _run_start_interview_background,
        run_id,
        (identity.user_id, identity.tenant_id, identity.role),
        payload.model_dump(),
    )
    return ok({"run_id": run_id, "request_id": payload.request_id})


def _run_submit_turn_background(
    run_id: str,
    identity_tuple: tuple,
    session_id: int,
    answer: str,
    turn_id: int | None,
    request_id: str | None,
):
    """后台任务：执行 submit_turn 并发射事件。"""
    from app.infra.db import SessionLocal
    from app.auth.service import AuthIdentity

    db = SessionLocal()
    try:
        identity = AuthIdentity(user_id=identity_tuple[0], tenant_id=identity_tuple[1], role=identity_tuple[2])
        try:
            submit_turn(db, identity, session_id, answer, request_id=request_id, turn_id=turn_id, event_run_id=run_id)
        except Exception as exc:
            logger.exception("run_submit_turn_background failed")
            emit_interview_event(run_id, "runtime.error", {"message": str(exc)})
            mark_interview_run_done(run_id)
    finally:
        db.close()


@router.post("/{session_id}/turns/runs/submit")
def submit_turn_run(
    session_id: int,
    payload: InterviewTurnRequest,
    background_tasks: BackgroundTasks,
    current=Depends(require_role("student")),
):
    """提交回答 run，返回 run_id。"""
    identity, _ = current
    run_id = create_interview_run(tenant_id=identity.tenant_id, student_id=identity.user_id)
    emit_interview_event(run_id, "runtime.status", {"phase": "receive_answer", "label": "正在读取你的回答"})
    background_tasks.add_task(
        _run_submit_turn_background,
        run_id,
        (identity.user_id, identity.tenant_id, identity.role),
        session_id,
        payload.answer,
        payload.turn_id,
        payload.request_id,
    )
    return ok({"run_id": run_id})


def _run_voice_submit_background(
    run_id: str,
    identity_tuple: tuple,
    session_id: int,
    turn_id: int,
    audio_bytes: bytes,
    content_type: str,
    filename: str | None,
    request_id: str | None,
):
    """后台任务：执行 voice_submit_turn 并发射事件。

    使用同步方式调用 voice_submit_turn 的内部逻辑，避免 event loop 兼容风险。
    """
    from app.infra.db import SessionLocal
    from app.auth.service import AuthIdentity

    db = SessionLocal()
    try:
        identity = AuthIdentity(user_id=identity_tuple[0], tenant_id=identity_tuple[1], role=identity_tuple[2])
        try:
            emit_interview_event(run_id, "runtime.status", {"phase": "transcribe", "label": "正在转写语音"})
            transcript = transcribe_voice_audio_sync(
                db,
                identity,
                audio_bytes=audio_bytes,
                content_type=content_type,
                filename=filename,
            )
            emit_interview_event(run_id, "interview.voice.transcribed", {
                "turn_id": turn_id,
                "request_id": request_id,
                "transcript": {
                    "text": transcript["text"],
                    "language": transcript["language"],
                    "confidence": transcript["confidence"],
                    "audio_format": transcript.get("audio_format"),
                    "audio_size_bytes": transcript.get("audio_size_bytes"),
                },
            })
            mark_interview_run_done(run_id)
        except Exception as exc:
            logger.exception("run_voice_submit_background failed")
            emit_interview_event(run_id, "runtime.error", {"message": str(exc)})
            mark_interview_run_done(run_id)
    finally:
        db.close()


@router.post("/{session_id}/turns/voice/run")
async def voice_submit_turn_run(
    session_id: int,
    file: UploadFile = File(..., description="音频文件"),
    turn_id: int = Form(..., description="当前问题 ID"),
    request_id: str | None = Form(default=None, description="幂等请求 ID"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current=Depends(require_role("student")),
):
    """语音回答 run，返回 run_id。"""
    identity, _ = current
    run_id = create_interview_run(tenant_id=identity.tenant_id, student_id=identity.user_id)
    audio_bytes = await file.read()
    content_type = file.content_type or "audio/webm"
    background_tasks.add_task(
        _run_voice_submit_background,
        run_id,
        (identity.user_id, identity.tenant_id, identity.role),
        session_id,
        turn_id,
        audio_bytes,
        content_type,
        file.filename,
        request_id,
    )
    return ok({"run_id": run_id})


@router.post("/{session_id}/turns/voice/transcribe")
async def transcribe_voice_turn(
    session_id: int,
    file: UploadFile = File(..., description="闊抽鏂囦欢"),
    turn_id: int = Form(..., description="褰撳墠闂 ID"),
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """只转写语音，不提交答案。前端展示文本并等待用户确认。"""
    identity, _ = current
    transcript = await transcribe_voice_audio(db, identity, audio_file=file)
    return ok({
        "turn_id": turn_id,
        "transcript": {
            "text": transcript["text"],
            "language": transcript["language"],
            "confidence": transcript["confidence"],
            "audio_format": transcript.get("audio_format"),
            "audio_size_bytes": transcript.get("audio_size_bytes"),
        },
    })


def _run_report_background(
    run_id: str,
    identity_tuple: tuple,
    session_id: int,
):
    """后台任务：执行 generate_report 并发射事件。"""
    from app.infra.db import SessionLocal
    from app.auth.service import AuthIdentity

    db = SessionLocal()
    try:
        identity = AuthIdentity(user_id=identity_tuple[0], tenant_id=identity_tuple[1], role=identity_tuple[2])
        try:
            report = generate_report(db, identity, session_id, event_run_id=run_id)
            # generate_report 内部已发射 interview.report.created 和 done
        except Exception as exc:
            logger.exception("run_report_background failed")
            emit_interview_event(run_id, "runtime.error", {"message": str(exc)})
            mark_interview_run_done(run_id)
    finally:
        db.close()


@router.post("/{session_id}/report/run")
def generate_report_run(
    session_id: int,
    background_tasks: BackgroundTasks,
    current=Depends(require_role("student")),
):
    """报告生成 run，返回 run_id。"""
    identity, _ = current
    run_id = create_interview_run(tenant_id=identity.tenant_id, student_id=identity.user_id)
    emit_interview_event(run_id, "runtime.status", {"phase": "collect_turns", "label": "正在整理面试记录"})
    background_tasks.add_task(
        _run_report_background,
        run_id,
        (identity.user_id, identity.tenant_id, identity.role),
        session_id,
    )
    return ok({"run_id": run_id})


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
    try:
        return ok(get_report(db, identity, session_id))
    except InterviewError as exc:
        if exc.status_code == 404 and "报告不存在" in str(exc.detail):
            return ok({
                "exists": False,
                "status": "not_generated",
                "message": "报告尚未生成，请点击生成报告",
            })
        raise


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


# 鈹€鈹€ Interview Report Analysis 面试报告智能分析 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€


@router.get("/analysis/latest")
def get_latest_analysis(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """获取当前学生的最新分析结果（含雷达 + 知识分布 + 顶部统计）"""
    from app.interview.analysis_service import get_latest_analysis_payload
    identity, _ = current
    return ok(get_latest_analysis_payload(db, identity))


@router.get("/analysis/summary")
def get_analysis_summary(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """顶部 4 张统计卡：评价分率/通过次数/提问次数/掌握技能数"""
    from app.interview.analysis_service import get_summary_stats
    identity, _ = current
    return ok(get_summary_stats(db, identity))


@router.post("/analysis/regenerate")
def regenerate_analysis(
    db: Session = Depends(get_db),
    current=Depends(require_role("student")),
):
    """手动重新生成分析（同步执行，约 5-15s）"""
    from app.interview.analysis_service import analyze_user_reports
    identity, _ = current
    payload = analyze_user_reports(db, identity, trigger_type="manual")
    return ok(payload)


def _run_auto_analysis_background(identity_tuple):
    """后台执行分析（不阻塞前端 SSE 收尾路径）"""
    from app.infra.db import SessionLocal
    from app.auth.service import AuthIdentity
    from app.interview.analysis_service import trigger_auto_analysis

    db = SessionLocal()
    try:
        identity = AuthIdentity(
            user_id=identity_tuple[0],
            tenant_id=identity_tuple[1],
            role=identity_tuple[2],
        )
        trigger_auto_analysis(db, identity)
    except Exception:
        logger.exception("run_auto_analysis_background failed")
    finally:
        db.close()


def schedule_auto_analysis(background_tasks, identity):
    """在报告生成完成后由调用方触发：把分析任务塞进 FastAPI BackgroundTasks"""
    background_tasks.add_task(
        _run_auto_analysis_background,
        (identity.user_id, identity.tenant_id, identity.role),
    )
