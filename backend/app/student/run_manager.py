from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.service import AuthIdentity
from app.core.security import utcnow
from app.infra.db import SessionLocal
from app.student.agent_runtime import _humanize_llm_error
from app.student.agent_models import (
    StudentAgentActivity,
    StudentAgentAttachment,
    StudentAgentMessage,
    StudentAgentRun,
    StudentAgentRunEvent,
    StudentAgentSession,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RunHandle — 跟踪单次运行的状态
# ---------------------------------------------------------------------------


@dataclass
class RunHandle:
    run_id: int
    tenant_id: int = 0
    task: Optional[asyncio.Task] = None          # type: ignore[type-arg]
    subscribers: set = field(default_factory=set)  # set[asyncio.Queue]
    last_seq: int = 0
    cancelled: bool = False
    _delta_buffer: list = field(default_factory=list)  # 缓冲的 delta 文本，定时合并落库
    _delta_last_db_flush_ms: int = 0  # 上次 flush 的 monotonic ms


# ---------------------------------------------------------------------------
# RunManager — 进程内单例
# ---------------------------------------------------------------------------


MAX_CONCURRENT_RUNS_PER_USER = 4  # 同用户最大并发 run 数（支持多会话并行）

class RunManager:
    """进程内单例：管理后台运行的 agent loop。

    每个 session 同时只允许 1 个 running run（并发护栏），
    每用户最多 MAX_CONCURRENT_RUNS_PER_USER 个并发 run（支持同类型多会话并行）。
    """

    def __init__(self) -> None:
        self._runs: dict[int, RunHandle] = {}          # run_id -> RunHandle
        self._session_locks: dict[int, int] = {}       # session_id -> run_id
        self._user_run_counts: dict[int, int] = {}     # user_id -> count

    # ── 公共接口 ──────────────────────────────────────────────────────────

    async def start_run(
        self,
        db: Session,
        identity: AuthIdentity,
        session_id: int,
        content: str,
        model_id: Optional[int],
        reasoning_effort: str,
        attachment_ids: list[int],
    ) -> int:
        """启动一次后台运行，返回 run_id。"""

        # 并发护栏：同 session 只允许 1 个 running run
        if session_id in self._session_locks:
            raise HTTPException(status_code=409, detail="当前会话已有运行中的任务")

        # 每用户最多 MAX_CONCURRENT_RUNS_PER_USER 个并发 run
        user_count = self._user_run_counts.get(identity.user_id, 0)
        if user_count >= MAX_CONCURRENT_RUNS_PER_USER:
            raise HTTPException(status_code=409, detail="您已有太多运行中的任务，请等待部分完成后再试")

        # 创建 run 记录
        run = StudentAgentRun(
            tenant_id=identity.tenant_id,
            student_id=identity.user_id,
            session_id=session_id,
            status="running",
        )
        db.add(run)
        db.commit()
        db.refresh(run)

        # 创建 RunHandle 并注册
        handle = RunHandle(run_id=run.id, tenant_id=identity.tenant_id, subscribers=set())
        self._runs[run.id] = handle
        self._session_locks[session_id] = run.id
        self._user_run_counts[identity.user_id] = user_count + 1

        # 启动后台 task（内部自建 DB session）
        handle.task = asyncio.create_task(
            self._run_detached(
                run.id,
                identity,
                session_id,
                content,
                model_id,
                reasoning_effort,
                attachment_ids,
            )
        )
        return run.id

    async def subscribe(self, run_id: int, after_seq: int = 0) -> AsyncIterator[str]:
        """订阅运行事件流。先注册 Queue 再回放 DB，避免竞态丢事件。"""
        requested_after_seq = after_seq
        handle = self._runs.get(run_id)
        if handle is None:
            # run 已不在内存：与在线分支同语义——delta 合并为全量 snapshot，
            # 绝不裸发 message.delta（前端是追加语义，裸发会在反复订阅时复读正文）
            db = SessionLocal()
            try:
                rows = list(
                    db.scalars(
                        select(StudentAgentRunEvent)
                        .where(StudentAgentRunEvent.run_id == run_id)
                        .order_by(StudentAgentRunEvent.seq.asc())
                    ).all()
                )
            finally:
                db.close()
            snap_content = ""
            snap_msg_id = None
            last_delta_seq = 0
            for row in rows:
                if row.event != "message.delta":
                    continue
                try:
                    d = json.loads(row.data_json)
                    snap_content += d.get("delta", "")
                    snap_msg_id = d.get("message_id") or snap_msg_id
                except Exception:
                    snap_content += row.data_json
                last_delta_seq = row.seq
            if snap_content:
                snap = {"message_id": snap_msg_id, "content": snap_content}
                yield f"event: message.snapshot\ndata: {json.dumps(snap, ensure_ascii=False)}\n\n"
                yield f":seq {last_delta_seq}\n\n"
                after_seq = max(after_seq, last_delta_seq)
            for row in rows:
                if row.event == "message.delta" or row.seq <= requested_after_seq:
                    continue
                yield f"event: {row.event}\ndata: {row.data_json}\n\n"
                yield f":seq {row.seq}\n\n"
                after_seq = max(after_seq, row.seq)
            return

        # P0-2 修复：先注册 Queue，再回放 DB，避免回放与实时之间的事件丢失
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        handle.subscribers.add(queue)
        # 注册后立刻把缓冲中未落库的 delta 强制刷盘：
        # 注册之前推送的 delta 新订阅者收不到，必须保证它们都进 DB、被全量 snapshot 覆盖；
        # 注册之后的 delta 走 Queue 实时收，两段无缝衔接
        self._flush_delta_buffer(run_id, handle.tenant_id, handle)

        try:
            # 1) 从 DB 回放（snapshot 全量化 + 非 delta 按 after_seq）
            db = SessionLocal()
            try:
                # 全量 delta → snapshot
                all_deltas = list(
                    db.scalars(
                        select(StudentAgentRunEvent)
                        .where(
                            StudentAgentRunEvent.run_id == run_id,
                            StudentAgentRunEvent.event == "message.delta",
                        )
                        .order_by(StudentAgentRunEvent.seq.asc())
                    ).all()
                )
                if all_deltas:
                    snap_content = ""
                    snap_msg_id = None
                    last_delta_seq = 0
                    for row in all_deltas:
                        try:
                            d = json.loads(row.data_json)
                            snap_content += d.get("delta", "")
                            snap_msg_id = d.get("message_id") or snap_msg_id
                        except Exception:
                            snap_content += row.data_json
                        last_delta_seq = row.seq
                    snap = {"message_id": snap_msg_id, "content": snap_content}
                    yield f"event: message.snapshot\ndata: {json.dumps(snap, ensure_ascii=False)}\n\n"
                    yield f":seq {last_delta_seq}\n\n"
                    after_seq = max(after_seq, last_delta_seq)

                # snapshot 只替代 delta 正文，不能让它的高 seq 吞掉更早的
                # activity 事件。非 delta 仍按客户端原始游标完整回放。
                non_delta = list(
                    db.scalars(
                        select(StudentAgentRunEvent)
                        .where(
                            StudentAgentRunEvent.run_id == run_id,
                            StudentAgentRunEvent.event != "message.delta",
                            StudentAgentRunEvent.seq > requested_after_seq,
                        )
                        .order_by(StudentAgentRunEvent.seq.asc())
                    ).all()
                )
                for row in non_delta:
                    yield f"event: {row.event}\ndata: {row.data_json}\n\n"
                    yield f":seq {row.seq}\n\n"
                    after_seq = max(after_seq, row.seq)
            finally:
                db.close()

            # 2) 消费实时事件（Queue 已在回放前注册，重叠事件由 seq 去重）
            while True:
                try:
                    seq, sse_data = await asyncio.wait_for(queue.get(), timeout=30.0)
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
                    continue

                # P1-3 修复：heartbeat 不递增 seq，需跳过去重判断
                is_heartbeat = sse_data.startswith("event: runtime.heartbeat")
                if not is_heartbeat and seq <= after_seq:
                    continue
                if not is_heartbeat:
                    after_seq = seq
                yield sse_data
                yield f":seq {seq}\n\n"

                if sse_data.startswith("event: done") or sse_data.startswith("event: error"):
                    return
        finally:
            handle.subscribers.discard(queue)

    async def cancel(self, run_id: int, identity: AuthIdentity) -> bool:
        """取消运行。返回 True 表示成功取消。"""
        handle = self._runs.get(run_id)
        if handle is None:
            return False

        # 验证所有权（通过 DB）
        db = SessionLocal()
        try:
            run = db.get(StudentAgentRun, run_id)
            if run is None or run.tenant_id != identity.tenant_id or run.student_id != identity.user_id:
                return False
            if run.status != "running":
                return False
        finally:
            db.close()

        handle.cancelled = True
        if handle.task and not handle.task.done():
            handle.task.cancel()

        # 标记 DB 状态
        db = SessionLocal()
        try:
            run = db.get(StudentAgentRun, run_id)
            if run and run.status == "running":
                run.status = "cancelled"
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
        finally:
            db.close()

        await self._emit_event(run_id, identity.tenant_id, "done", {"cancelled": True})
        self._cleanup(run_id, identity)
        return True

    def get_active_runs(self, identity: AuthIdentity) -> list[dict]:
        """获取当前用户所有 running 状态的 run（从 DB 查询，带租户+用户过滤）。"""
        db = SessionLocal()
        try:
            rows = list(db.scalars(
                select(StudentAgentRun).where(
                    StudentAgentRun.tenant_id == identity.tenant_id,
                    StudentAgentRun.student_id == identity.user_id,
                    StudentAgentRun.status == "running",
                )
            ).all())
            return [
                {
                    "run_id": row.id,
                    "session_id": row.session_id,
                    "status": row.status,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                }
                for row in rows
            ]
        finally:
            db.close()

    # ── 内部方法 ──────────────────────────────────────────────────────────

    async def _emit_event(self, run_id: int, tenant_id: int, event: str, data: dict) -> None:
        """双写：① 落事件表 ② 推给所有在线订阅者。

        - 心跳事件：仅实时推送，不落库。
        - message.delta：缓冲到 _delta_buffer，每 200ms 或非 delta 事件时批量落库。
        - 其他事件：立即落库。
        """
        handle = self._runs.get(run_id)
        if not handle:
            return

        now_ms = time.monotonic_ns() // 1_000_000

        # P1-4: delta 聚合落库 — 先推给订阅者（实时性），再缓冲落库
        if event == "runtime.heartbeat":
            # 心跳：仅实时推送
            sse_data = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            for q in list(handle.subscribers):
                try:
                    q.put_nowait((handle.last_seq, sse_data))
                except asyncio.QueueFull:
                    handle.subscribers.discard(q)
            return

        if event == "message.delta":
            # delta：立即推给订阅者，但缓冲落库
            handle.last_seq += 1
            seq = handle.last_seq
            sse_data = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
            for q in list(handle.subscribers):
                try:
                    q.put_nowait((seq, sse_data))
                except asyncio.QueueFull:
                    handle.subscribers.discard(q)
            # 缓冲 delta
            handle._delta_buffer.append(data.get("delta", ""))  # type: ignore[attr-defined]
            # 超过 200ms 则刷新
            if now_ms - getattr(handle, "_delta_last_db_flush_ms", 0) >= 200:
                self._flush_delta_buffer(run_id, tenant_id, handle)
            return

        # 非 delta 非心跳：先刷新缓冲的 delta，再写当前事件
        self._flush_delta_buffer(run_id, tenant_id, handle)

        handle.last_seq += 1
        seq = handle.last_seq
        db = SessionLocal()
        try:
            ev = StudentAgentRunEvent(
                tenant_id=tenant_id,
                run_id=run_id,
                seq=seq,
                event=event,
                data_json=json.dumps(data, ensure_ascii=False),
            )
            db.add(ev)
            db.commit()
        except Exception:
            logger.exception("_emit_event: 写事件表失败 run_id=%s seq=%s", run_id, seq)
        finally:
            db.close()

        sse_data = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
        for q in list(handle.subscribers):
            try:
                q.put_nowait((seq, sse_data))
            except asyncio.QueueFull:
                handle.subscribers.discard(q)

    def _flush_delta_buffer(self, run_id: int, tenant_id: int, handle: RunHandle) -> None:
        """将缓冲的 delta 合并为一条事件写入 DB。

        不再分配新 seq——复用本批最后一条 live delta 已占用的 handle.last_seq，
        保证 DB 与实时推送是同一条 seq 流，避免重连时同一文本以两个 seq 重放。
        """
        buf = handle._delta_buffer
        if not buf:
            return
        combined = "".join(buf)
        buf.clear()
        handle._delta_last_db_flush_ms = time.monotonic_ns() // 1_000_000  # type: ignore[attr-defined]
        # 复用当前 last_seq（本批最后一条 live delta 已占用的 seq）
        seq = handle.last_seq
        db = SessionLocal()
        try:
            ev = StudentAgentRunEvent(
                tenant_id=tenant_id,
                run_id=run_id,
                seq=seq,
                event="message.delta",
                data_json=json.dumps({"delta": combined}, ensure_ascii=False),
            )
            db.add(ev)
            db.commit()
        except Exception:
            logger.exception("_flush_delta_buffer: 写事件表失败 run_id=%s", seq)
        finally:
            db.close()

    async def _run_detached(
        self,
        run_id: int,
        identity: AuthIdentity,
        session_id: int,
        content: str,
        model_id: Optional[int],
        reasoning_effort: str,
        attachment_ids: list[int],
    ) -> None:
        """后台运行的 agent loop。内部自建 DB session，不复用请求的 db。"""

        # 延迟导入避免循环引用
        from app.admin.master_service import get_or_create_master_config
        from app.student.agent_runtime import (
            AUTO_ATTACHMENT_PROMPT,
            SessionEvidencePool,
            _build_initial_messages,
            _build_openai_tools,
            _claim_message_attachments,
            _compress_context,
            _configured_fallback_answer,
            _looks_like_jd,
            _select_chat_model,
            _assemble_tools,
            _silent_understand_images,
            _has_image_attachments,
            dumps_event,
            get_session_or_404,
            run_agent_loop,
            serialize_activity,
            _save_message,
        )

        db = SessionLocal()
        try:
            # ── 准备阶段 ──
            session = get_session_or_404(db, identity, session_id)
            user_message = _save_message(db, session, "user", content.strip())
            attachments = _claim_message_attachments(db, identity, session, user_message, attachment_ids)
            # 在构建模型上下文之前识别并持久化 JD。此前识别发生在
            # run_agent_loop 内部，导致本轮 system context 看不到刚粘贴的 JD，
            # 模型可能再次索要已经提供的岗位描述。
            detected_jd = user_message.content[:8000]
            if _looks_like_jd(user_message.content) and session.jd_text != detected_jd:
                session.jd_text = detected_jd
                db.commit()
                logger.info(
                    "run 前自动识别 JD 并写入 session=%s（%d 字）",
                    session.id,
                    len(session.jd_text),
                )
            if (
                (content.strip() == AUTO_ATTACHMENT_PROMPT or not content.strip())
                and attachments
                and all(a.content_type.startswith("image/") for a in attachments)
                and session.title in (AUTO_ATTACHMENT_PROMPT, "新对话")
            ):
                session.title = "图片分析"
                db.commit()

            await self._emit_event(run_id, identity.tenant_id, "message.saved", {"message_id": user_message.id})

            # 如果任务已取消，在此检查
            handle = self._runs.get(run_id)
            if handle and handle.cancelled:
                return

            model = _select_chat_model(db, identity.tenant_id, model_id)

            # ── 模型不可用 → 写一条错误消息 ──
            if model is None or not model.api_key_cipher:
                assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
                db.add(assistant_message)
                db.commit()
                db.refresh(assistant_message)
                if model is None:
                    error = "当前没有可用的聊天模型，请管理员在模型广场开启「对学生开放」。"
                else:
                    error = f"模型「{model.display_name}」未配置 API Key，请管理员在模型广场补全配置。"
                assistant_message.content = error
                session.updated_at = utcnow()
                db.commit()

                # 更新 run 的 assistant_message_id
                run = db.get(StudentAgentRun, run_id)
                if run:
                    run.assistant_message_id = assistant_message.id
                    db.commit()

                await self._emit_event(run_id, identity.tenant_id, "message.delta", {
                    "message_id": assistant_message.id, "delta": error,
                })
                await self._emit_event(run_id, identity.tenant_id, "message.completed", {
                    "message_id": assistant_message.id,
                })
                await self._emit_event(run_id, identity.tenant_id, "done", {"session_id": session.id})

                # 标记完成
                run = db.get(StudentAgentRun, run_id)
                if run:
                    run.status = "completed"
                    run.finished_at = datetime.now(timezone.utc)
                    db.commit()
                return

            # ── 构建 tools / messages ──
            config = get_or_create_master_config(db, identity.tenant_id)
            max_iterations = max(1, min(int(config.max_iterations or 8), 20))
            permission_mode = (config.permission_mode or "ask").lower()

            agent_type = getattr(session, "agent_type", "resume") or "resume"
            tool_defs = _assemble_tools(db, identity, agent_type)
            registry = {tool.name: tool for tool in tool_defs}
            openai_tools = _build_openai_tools(tool_defs)

            # D2: 上下文压缩 — 组装后估算 token，超阈值则压缩并重新组装
            async def _emit_compress_event(event: str, data: dict) -> None:
                await self._emit_event(run_id, identity.tenant_id, event, data)

            # 视觉静默预理解：学生发图时，后台调用视觉模型把图片描述作为隐藏
            # 上下文喂给主模型（无论主模型是否 multimodal）。整个过程不发射活动事件。
            image_descriptions: dict[int, str] = {}
            if _has_image_attachments(attachments):
                image_descriptions = await _silent_understand_images(db, identity, attachments)

            messages, _compressed = await _compress_context(
                db, identity, session, model, config,
                user_text=content, reasoning_effort=reasoning_effort,
                attachments=attachments, agent_type=agent_type,
                openai_tools=openai_tools,
                emit_event=_emit_compress_event,
                image_descriptions=image_descriptions,
            )

            # ── 创建 assistant 消息 ──
            assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
            db.add(assistant_message)
            db.commit()
            db.refresh(assistant_message)

            # 更新 run 的 assistant_message_id
            run = db.get(StudentAgentRun, run_id)
            if run:
                run.assistant_message_id = assistant_message.id
                db.commit()

            # ── 运行 agent loop ──
            full_content = ""
            run_metrics: dict[str, Any] = {}
            async for event_name, data in run_agent_loop(
                db, identity, session, user_message, assistant_message,
                model, messages, openai_tools, registry, attachments, reasoning_effort,
                max_iterations, permission_mode, config.temperature, config.max_tokens,
            ):
                # 检查取消
                handle = self._runs.get(run_id)
                if handle and handle.cancelled:
                    return

                if event_name == "message.delta":
                    full_content += str(data.get("delta", ""))
                elif event_name == "runtime.completed":
                    run_metrics = data

                await self._emit_event(run_id, identity.tenant_id, event_name, data)

            # ── 保存最终消息 ──
            if not full_content.strip():
                full_content = _configured_fallback_answer(config, content)
                await self._emit_event(run_id, identity.tenant_id, "message.delta", {
                    "message_id": assistant_message.id, "delta": full_content,
                })

            assistant_message.content = full_content
            assistant_message.model_name = str(
                run_metrics.get("model_name") or model.display_name or model.model_identifier
            )[:128]
            assistant_message.prompt_tokens = int(run_metrics.get("prompt_tokens") or 0) or None
            assistant_message.completion_tokens = int(run_metrics.get("completion_tokens") or 0) or None
            assistant_message.total_tokens = int(run_metrics.get("total_tokens") or 0) or None
            assistant_message.duration_ms = int(run_metrics.get("duration_ms") or 0) or None
            session.updated_at = utcnow()
            db.commit()

            await self._emit_event(run_id, identity.tenant_id, "message.completed", {
                "message_id": assistant_message.id,
            })
            await self._emit_event(run_id, identity.tenant_id, "done", {"session_id": session.id})

            # 标记完成
            run = db.get(StudentAgentRun, run_id)
            if run:
                run.status = "completed"
                run.finished_at = datetime.now(timezone.utc)
                db.commit()

            # D4: 观测日志 — 记录 run 级别的 token 消耗
            logger.info(
                "run_completed run_id=%s session_id=%s prompt_tokens=%s completion_tokens=%s total_tokens=%s duration_ms=%s",
                run_id,
                session.id,
                run_metrics.get("prompt_tokens", 0),
                run_metrics.get("completion_tokens", 0),
                run_metrics.get("total_tokens", 0),
                run_metrics.get("duration_ms", 0),
            )

        except asyncio.CancelledError:
            logger.info("_run_detached: task cancelled run_id=%s", run_id)
            # 标记取消
            run = db.get(StudentAgentRun, run_id) if run_id else None
            if run and run.status == "running":
                run.status = "cancelled"
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
            try:
                await self._emit_event(run_id, identity.tenant_id, "done", {"cancelled": True})
            except Exception:
                pass

        except Exception as exc:
            logger.exception("_run_detached: 运行失败 run_id=%s", run_id)
            # 标记失败
            run = db.get(StudentAgentRun, run_id)
            if run:
                run.status = "failed"
                run.error_text = str(exc)[:2000]
                run.finished_at = datetime.now(timezone.utc)
                db.commit()
            try:
                await self._emit_event(run_id, identity.tenant_id, "error", {"message": _humanize_llm_error(exc)})
            except Exception:
                pass

        finally:
            db.close()
            self._cleanup(run_id, identity)

    def _cleanup(self, run_id: int, identity: AuthIdentity) -> None:
        """清理并发护栏锁和运行计数。"""
        handle = self._runs.pop(run_id, None)
        if handle is None:
            return

        # 清理 session 锁
        for sid, rid in list(self._session_locks.items()):
            if rid == run_id:
                self._session_locks.pop(sid, None)
                break

        # 清理用户计数
        count = self._user_run_counts.get(identity.user_id, 0)
        if count <= 1:
            self._user_run_counts.pop(identity.user_id, None)
        else:
            self._user_run_counts[identity.user_id] = count - 1


# ── 模块级单例 ────────────────────────────────────────────────────────────────

run_manager = RunManager()
