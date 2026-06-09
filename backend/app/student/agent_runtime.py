from __future__ import annotations

import base64
import json
import mimetypes
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.master_models import MasterRouteRule
from app.admin.master_service import DEFAULT_SYSTEM_PROMPT, get_or_create_master_config
from app.admin.model_service import decrypt_api_key
from app.admin.models import Agent, ModelConfig
from app.auth.models import StudentUser
from app.auth.service import AuthIdentity
from app.core.config import get_settings
from app.skills.service import list_skills, serialize_skill
from app.student.agent_models import (
    StudentAgentActivity,
    StudentAgentAttachment,
    StudentAgentMessage,
    StudentAgentSession,
)
from app.student.agent_schemas import AgentActivityResponse, AgentAttachmentResponse, AgentModelOptionResponse
from app.student.tool_validation import parse_tool_arguments


# ── Value objects ──────────────────────────────────────────────────────────────


@dataclass
class RuntimeObservation:
    kind: str
    name: str
    summary: str
    detail: dict[str, Any]


@dataclass
class ToolDefinition:
    name: str
    description: str
    source: str
    priority: int
    input_schema: dict[str, Any]
    metadata: dict[str, Any]


@dataclass
class PlannedToolCall:
    tool: ToolDefinition
    arguments: dict[str, Any]


# ── Constants ──────────────────────────────────────────────────────────────────

# Capabilities that can serve OpenAI-compatible chat completions for the master
# agent. The 模型广场 only tags models as "text" / "multimodal" (there is no
# "chat" option in the admin form), so the student side must accept those — plus
# "chat" for backward compatibility. Embedding / rerank models are excluded.
CHAT_CAPABLE_CAPABILITIES = ("text", "multimodal", "chat")
AUTO_ATTACHMENT_PROMPT = "请帮我分析上传的附件。"


# ── Utilities ──────────────────────────────────────────────────────────────────


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def dumps_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── Built-in tool definitions ──────────────────────────────────────────────────


BUILTIN_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="invoke_agent",
        description="调用主智能体工具注册表中的子智能体，可派发给面试官、简历优化、岗位匹配等团队成员。",
        source="builtin",
        priority=1000,
        input_schema={
            "type": "object",
            "properties": {"agent_key": {"type": "string"}, "task": {"type": "string"}},
            "required": ["agent_key", "task"],
        },
        metadata={"kind": "subagent"},
    ),
    ToolDefinition(
        name="query_student_profile",
        description="查询学生档案，包括姓名、邮箱、学院、专业、年级等基础背景。",
        source="builtin",
        priority=990,
        input_schema={"type": "object", "properties": {}, "required": []},
        metadata={"kind": "profile"},
    ),
    ToolDefinition(
        name="query_job_positions",
        description="搜索岗位库，用于岗位匹配、JD 查询和职位推荐。",
        source="builtin",
        priority=980,
        input_schema={
            "type": "object",
            "properties": {"keyword": {"type": "string"}, "company": {"type": "string"}, "role": {"type": "string"}},
            "required": [],
        },
        metadata={"kind": "job"},
    ),
    ToolDefinition(
        name="query_knowledge_base",
        description="检索就业政策、行业知识、公司简介等知识库内容。",
        source="builtin",
        priority=970,
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        metadata={"kind": "knowledge"},
    ),
    ToolDefinition(
        name="read_resume",
        description="读取或解析学生上传的简历文件。当前版本在未上传文件时返回材料缺口。",
        source="builtin",
        priority=960,
        input_schema={"type": "object", "properties": {"file_id": {"type": "string"}}, "required": []},
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="analyze_uploaded_file",
        description="分析学生上传的图片、Word、PDF、Excel、文本等附件，并把提取内容交给主智能体综合。",
        source="builtin",
        priority=955,
        input_schema={"type": "object", "properties": {"attachment_ids": {"type": "array"}}, "required": []},
        metadata={"kind": "file"},
    ),
    ToolDefinition(
        name="send_notification",
        description="发送邮件或站内通知，用于面试提醒、报告推送等需要学生确认的动作。",
        source="builtin",
        priority=950,
        input_schema={
            "type": "object",
            "properties": {"channel": {"type": "string"}, "content": {"type": "string"}},
            "required": ["content"],
        },
        metadata={"kind": "notification", "risk": "medium"},
    ),
    ToolDefinition(
        name="get_session_context",
        description="读取当前会话历史，用于 ReAct Observe 阶段回溯上下文。",
        source="builtin",
        priority=940,
        input_schema={"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []},
        metadata={"kind": "context"},
    ),
    ToolDefinition(
        name="export_resume_pdf",
        description=(
            "把优化后的简历内容生成一份可下载的 PDF 文件，并返回下载链接。"
            "仅在你已经基于学生的真实简历（通过 read_resume 读取）完成改写后调用；"
            "禁止凭空捏造经历来生成简历。"
        ),
        source="builtin",
        priority=965,
        input_schema={
            "type": "object",
            "properties": {
                "markdown": {"type": "string", "description": "完整的简历正文，Markdown 格式（标题用 #，要点用 -）。"},
                "filename": {"type": "string", "description": "文件名，可选，例如『张三-后端简历』。"},
            },
            "required": ["markdown"],
        },
        metadata={"kind": "resume", "risk": "low"},
    ),
]


# ── Tool pool assembly ─────────────────────────────────────────────────────────


def assemble_tool_pool(db: Session, identity: AuthIdentity) -> list[ToolDefinition]:
    pool: dict[str, ToolDefinition] = {}
    for tool in BUILTIN_TOOLS:
        pool[tool.name] = tool

    for skill in list_skills(db, include_disabled=False):
        data = serialize_skill(skill)
        name = _tool_safe_name(str(data["slug"]))
        if name in pool:
            continue
        pool[name] = ToolDefinition(
            name=name,
            description=str(data.get("description") or data.get("name") or "Skill 工具"),
            source="skill",
            priority=500,
            input_schema={
                "type": "object",
                "properties": {
                    "task": {"type": "string"},
                    "context": {"type": "string"},
                },
                "required": ["task"],
            },
            metadata=data,
        )

    for tool in _discover_mcp_tools(db, identity.tenant_id):
        if tool.name in pool:
            continue
        pool[tool.name] = tool

    return sorted(pool.values(), key=lambda item: (-item.priority, item.name))


def _tool_safe_name(value: str) -> str:
    clean = "".join(ch if ch.isalnum() else "_" for ch in value.lower()).strip("_")
    return clean or "skill_tool"


# ── Attachment handling ────────────────────────────────────────────────────────


def _is_allowed_attachment(ext: str, content_type: str) -> bool:
    allowed_ext = {
        "png", "jpg", "jpeg", "webp", "gif",
        "pdf", "docx", "doc", "xlsx", "xls",
        "csv", "txt", "md", "json",
    }
    if ext in allowed_ext:
        return True
    return content_type.startswith("image/")


def _extract_attachment_text(path: Path, content_type: str, ext: str) -> str:
    try:
        if ext == "pdf":
            return _extract_pdf_text(path)
        if ext == "docx":
            return _extract_docx_text(path)
        if ext in {"xlsx", "xls"}:
            return _extract_xlsx_text(path)
        if ext in {"csv", "txt", "md", "json"}:
            return path.read_text(encoding="utf-8", errors="ignore")[:12000]
        if content_type.startswith("image/"):
            return _extract_image_summary(path)
    except Exception as exc:
        return f"附件已保存，但自动解析失败：{str(exc)[:200]}"
    return "附件已保存，当前格式需要专用 Skill 或外部工具进一步解析。"


def _extract_pdf_text(path: Path) -> str:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    chunks: list[str] = []
    for index, page in enumerate(reader.pages[:12], start=1):
        text = (page.extract_text() or "").strip()
        if text:
            chunks.append(f"[PDF 第 {index} 页]\n{text}")
    return "\n\n".join(chunks)[:12000] or "PDF 未提取到可读文本，可能是扫描件。"


def _extract_docx_text(path: Path) -> str:
    from docx import Document

    doc = Document(str(path))
    chunks = [paragraph.text.strip() for paragraph in doc.paragraphs if paragraph.text.strip()]
    for table in doc.tables[:8]:
        for row in table.rows[:30]:
            values = [cell.text.strip().replace("\n", " ") for cell in row.cells]
            if any(values):
                chunks.append(" | ".join(values))
    return "\n".join(chunks)[:12000] or "Word 文档未提取到可读文本。"


def _extract_xlsx_text(path: Path) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(str(path), read_only=True, data_only=True)
    chunks: list[str] = []
    for sheet in workbook.worksheets[:5]:
        chunks.append(f"[Sheet: {sheet.title}]")
        for row in sheet.iter_rows(min_row=1, max_row=40, max_col=12, values_only=True):
            values = ["" if value is None else str(value).strip() for value in row]
            if any(values):
                chunks.append(" | ".join(values))
    return "\n".join(chunks)[:12000] or "Excel 文件未提取到可读内容。"


def _extract_image_summary(path: Path) -> str:
    from PIL import Image

    with Image.open(path) as image:
        width, height = image.size
        mode = image.mode
    return f"图片附件已保存：{width}x{height}，色彩模式 {mode}。如所选模型支持视觉输入，将随请求一并传入。"


def _discover_mcp_tools(db: Session, tenant_id: int) -> list[ToolDefinition]:
    return [
        ToolDefinition(
            name="mcp__reserved__tool_discovery",
            description="MCP 工具发现占位，支持后续接入 stdio/SSE/Streamable HTTP MCP 服务。",
            source="mcp",
            priority=100,
            input_schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": []},
            metadata={"tenant_id": tenant_id, "status": "reserved"},
        )
    ]


# ── Session CRUD ───────────────────────────────────────────────────────────────


def create_session(db: Session, identity: AuthIdentity, title: Optional[str]) -> StudentAgentSession:
    session = StudentAgentSession(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=(title or "新对话").strip() or "新对话",
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def list_available_models(db: Session, identity: AuthIdentity) -> list[AgentModelOptionResponse]:
    rows = db.scalars(
        select(ModelConfig)
        .where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.capability.in_(CHAT_CAPABLE_CAPABILITIES),
            ModelConfig.status == "active",
        )
        .order_by(ModelConfig.id.asc())
    ).all()
    return [AgentModelOptionResponse.model_validate(row) for row in rows]


def serialize_attachment(attachment: StudentAgentAttachment) -> AgentAttachmentResponse:
    data = AgentAttachmentResponse.model_validate(attachment)
    data.download_url = _attachment_download_url(attachment.stored_path)
    return data


async def save_attachment(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    upload: UploadFile,
) -> StudentAgentAttachment:
    session = get_session_or_404(db, identity, session_id)
    settings = get_settings()
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件为空")
    if len(raw) > settings.agent_upload_max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="附件超过大小限制")

    original_name = Path(upload.filename or "attachment").name
    ext = Path(original_name).suffix.lower().lstrip(".")
    content_type = upload.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if not _is_allowed_attachment(ext, content_type):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="暂不支持该附件格式")

    storage_dir = Path(settings.agent_upload_storage_dir) / str(identity.tenant_id) / str(identity.user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{ext or 'bin'}"
    stored_path = storage_dir / stored_name
    stored_path.write_bytes(raw)

    extracted_text = _extract_attachment_text(stored_path, content_type, ext)
    row = StudentAgentAttachment(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        session_id=session.id,
        original_name=original_name,
        stored_path=str(stored_path),
        content_type=content_type,
        file_ext=ext,
        file_size=len(raw),
        extracted_text=extracted_text,
        status="ready",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_sessions(db: Session, identity: AuthIdentity) -> list[StudentAgentSession]:
    # 只返回「至少有一条消息」的会话，自动隐藏从未对话过的空会话
    has_message = (
        select(StudentAgentMessage.id)
        .where(StudentAgentMessage.session_id == StudentAgentSession.id)
        .exists()
    )
    return list(
        db.scalars(
            select(StudentAgentSession)
            .where(
                StudentAgentSession.tenant_id == identity.tenant_id,
                StudentAgentSession.student_id == identity.user_id,
                StudentAgentSession.status == "active",
                has_message,
            )
            .order_by(StudentAgentSession.updated_at.desc())
        ).all()
    )


def delete_session(db: Session, identity: AuthIdentity, session_id: int) -> None:
    session = get_session_or_404(db, identity, session_id)
    session.status = "deleted"
    session.updated_at = utcnow()
    db.commit()


def get_session_or_404(db: Session, identity: AuthIdentity, session_id: int) -> StudentAgentSession:
    session = db.scalar(
        select(StudentAgentSession).where(
            StudentAgentSession.id == session_id,
            StudentAgentSession.tenant_id == identity.tenant_id,
            StudentAgentSession.student_id == identity.user_id,
            StudentAgentSession.status == "active",
        )
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    return session


def get_history(db: Session, identity: AuthIdentity, session_id: int):
    session = get_session_or_404(db, identity, session_id)
    messages = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.asc())
        ).all()
    )
    activities = list(
        db.scalars(
            select(StudentAgentActivity)
            .where(StudentAgentActivity.session_id == session.id)
            .order_by(StudentAgentActivity.id.asc())
        ).all()
    )
    attachments = list(
        db.scalars(
            select(StudentAgentAttachment)
            .where(StudentAgentAttachment.session_id == session.id)
            .order_by(StudentAgentAttachment.id.asc())
        ).all()
    )
    return session, messages, activities, attachments


# ── DB helpers ─────────────────────────────────────────────────────────────────


def serialize_activity(activity: StudentAgentActivity) -> AgentActivityResponse:
    detail: dict[str, Any] = {}
    if activity.detail_json:
        try:
            detail = json.loads(activity.detail_json)
        except json.JSONDecodeError:
            detail = {}
    return AgentActivityResponse(
        id=activity.id,
        session_id=activity.session_id,
        message_id=activity.message_id,
        kind=activity.kind,
        name=activity.name,
        status=activity.status,
        summary=activity.summary,
        detail=detail,
        started_at=activity.started_at,
        completed_at=activity.completed_at,
    )


def _save_message(db: Session, session: StudentAgentSession, role: str, content: str) -> StudentAgentMessage:
    message = StudentAgentMessage(session_id=session.id, role=role, content=content)
    session.updated_at = utcnow()
    if role == "user" and session.title == "新对话":
        session.title = content.strip().replace("\n", " ")[:32] or "新对话"
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def _save_activity(
    db: Session,
    session: StudentAgentSession,
    message: StudentAgentMessage,
    *,
    kind: str,
    name: str,
    status_value: str,
    summary: str,
    detail: Optional[dict[str, Any]] = None,
) -> StudentAgentActivity:
    activity = StudentAgentActivity(
        session_id=session.id,
        message_id=message.id,
        kind=kind,
        name=name,
        status=status_value,
        summary=summary,
        detail_json=json.dumps(detail or {}, ensure_ascii=False),
        completed_at=utcnow() if status_value in {"completed", "failed"} else None,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def _complete_activity(
    db: Session,
    activity: StudentAgentActivity,
    *,
    status_value: str,
    summary: str,
    detail: dict[str, Any],
) -> StudentAgentActivity:
    activity.status = status_value
    activity.summary = summary
    activity.detail_json = json.dumps(detail, ensure_ascii=False)
    activity.completed_at = utcnow()
    db.commit()
    db.refresh(activity)
    return activity


# ── Main streaming entry point ─────────────────────────────────────────────────


async def stream_master_reply(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    content: str,
    model_id: Optional[int],
    reasoning_effort: str,
    attachment_ids: list[int],
) -> AsyncIterator[str]:
    """Agentic-loop entry point.

    Harness owns the loop: the model only proposes tool calls, the Harness
    validates / executes / audits them and feeds results back, until the model
    produces a final answer or `max_iterations` is reached. See the in-repo
    《Agent = Model + Harness 开发准则》— "Harness 提供信任".
    """
    session = get_session_or_404(db, identity, session_id)
    user_message = _save_message(db, session, "user", content.strip())
    attachments = _claim_message_attachments(db, identity, session, user_message, attachment_ids)
    if (
        content.strip() == AUTO_ATTACHMENT_PROMPT
        and attachments
        and all(attachment.content_type.startswith("image/") for attachment in attachments)
        and session.title == AUTO_ATTACHMENT_PROMPT
    ):
        session.title = "图片分析"
        db.commit()
    yield dumps_event("message.saved", {"message_id": user_message.id})

    model = _select_chat_model(db, identity.tenant_id, model_id)

    # ── Model availability guards (return a controlled assistant message) ──
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
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": error})
        yield dumps_event("message.completed", {"message_id": assistant_message.id})
        yield dumps_event("done", {"session_id": session.id})
        return

    config = get_or_create_master_config(db, identity.tenant_id)
    # Harness hard boundary — 尊重管理端配置的轮次，但保留一个安全上限防止失控。
    max_iterations = max(1, min(int(config.max_iterations or 8), 20))
    permission_mode = (config.permission_mode or "ask").lower()

    # Curated, safe tool registry. Only tools the Harness can honestly fulfil
    # are exposed — fabricating stubs are intentionally excluded.
    tool_defs = assemble_active_tools(db, identity)
    registry = {tool.name: tool for tool in tool_defs}
    openai_tools = _build_openai_tools(tool_defs)

    # Build initial messages BEFORE creating the empty assistant row, so the
    # history loader does not pick up a blank assistant turn.
    messages = _build_initial_messages(
        db, identity, session, content, reasoning_effort, model, attachments, config
    )

    assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    full_content = ""
    async for event_name, data in run_agent_loop(
        db, identity, session, user_message, assistant_message,
        model, messages, openai_tools, registry, attachments, reasoning_effort,
        max_iterations, permission_mode, config.temperature, config.max_tokens,
    ):
        if event_name == "message.delta":
            full_content += str(data.get("delta", ""))
        yield dumps_event(event_name, data)

    if not full_content.strip():
        full_content = _configured_fallback_answer(config, content)
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": full_content})

    assistant_message.content = full_content
    session.updated_at = utcnow()
    db.commit()
    yield dumps_event("message.completed", {"message_id": assistant_message.id})
    yield dumps_event("done", {"session_id": session.id})


def _claim_message_attachments(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    message: StudentAgentMessage,
    attachment_ids: list[int],
) -> list[StudentAgentAttachment]:
    if not attachment_ids:
        return []
    rows = list(
        db.scalars(
            select(StudentAgentAttachment).where(
                StudentAgentAttachment.id.in_(attachment_ids),
                StudentAgentAttachment.tenant_id == identity.tenant_id,
                StudentAgentAttachment.student_id == identity.user_id,
                StudentAgentAttachment.session_id == session.id,
            )
        ).all()
    )
    found = {row.id for row in rows}
    missing = [item for item in attachment_ids if item not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件不存在或不属于当前会话")
    for row in rows:
        row.message_id = message.id
    db.commit()
    return rows


# ── Tool planning ──────────────────────────────────────────────────────────────


async def _run_tool_planning(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    message: StudentAgentMessage,
    attachments: list[StudentAgentAttachment],
    tool_pool: list[ToolDefinition],
) -> AsyncIterator[tuple[str, dict[str, Any], Optional[RuntimeObservation]]]:
    text = message.content
    for planned in _plan_tool_calls(db, identity, session, text, tool_pool, attachments):
        activity_kind = planned.tool.metadata.get("kind") or planned.tool.source
        started = _save_activity(
            db,
            session,
            message,
            kind=str(activity_kind),
            name=planned.tool.name,
            status_value="started",
            summary=_tool_start_label(planned.tool, planned.arguments),
            detail={"source": planned.tool.source, "arguments": planned.arguments},
        )
        yield "activity.started", serialize_activity(started).model_dump(mode="json"), None

        result = await _execute_tool_call(db, identity, session, text, planned, attachments)
        completed = _complete_activity(
            db,
            started,
            status_value=result["status"],
            summary=result["summary"],
            detail=result,
        )
        event_name = "activity.completed" if result["status"] == "completed" else "activity.failed"
        yield event_name, serialize_activity(completed).model_dump(mode="json"), RuntimeObservation(
            kind=str(activity_kind),
            name=planned.tool.name,
            summary=result["summary"],
            detail=result,
        )


def _tool_start_label(tool: ToolDefinition, arguments: dict[str, Any]) -> str:
    """Human-readable 'in progress' label shown in the activity chip."""
    kind = tool.metadata.get("kind") or tool.source
    if kind == "profile":
        return "正在读取学生档案…"
    if kind == "resume":
        return "正在读取简历材料…"
    if kind == "file":
        return "正在解析上传附件…"
    if kind == "job":
        kw = str(arguments.get("keyword") or "")[:20]
        return f"正在检索岗位库{('：' + kw) if kw else '…'}"
    if kind == "knowledge":
        q = str(arguments.get("query") or "")[:20]
        return f"正在检索知识库{('：' + q) if q else '…'}"
    if kind == "context":
        return "正在回溯会话上下文…"
    if kind == "subagent":
        key = str(arguments.get("agent_key") or tool.name)
        return f"正在调用子智能体：{key}…"
    if kind == "notification":
        return "正在准备通知…"
    if tool.source == "skill":
        return f"正在调用 Skill：{tool.metadata.get('name') or tool.name}…"
    if tool.source == "mcp":
        return "正在探索 MCP 工具…"
    return f"正在执行 {tool.name}…"


def _plan_tool_calls(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    text: str,
    tool_pool: list[ToolDefinition],
    attachments: list[StudentAgentAttachment],
) -> list[PlannedToolCall]:
    by_name = {tool.name: tool for tool in tool_pool}
    calls: list[PlannedToolCall] = []
    lowered = text.lower()

    if session.summary or _message_count(db, session.id) > 1:
        calls.append(PlannedToolCall(by_name["get_session_context"], {"limit": 8}))

    if any(word in lowered for word in ["我", "我的", "背景", "专业", "简历", "岗位", "面试", "求职", "匹配"]):
        calls.append(PlannedToolCall(by_name["query_student_profile"], {}))

    if any(word in lowered for word in ["简历", "经历", "项目", "resume"]):
        calls.append(PlannedToolCall(by_name["read_resume"], {}))

    if attachments:
        calls.append(
            PlannedToolCall(
                by_name["analyze_uploaded_file"],
                {"attachment_ids": [attachment.id for attachment in attachments]},
            )
        )

    if any(word in lowered for word in ["岗位", "职位", "jd", "公司", "字节", "腾讯", "阿里", "后端", "前端"]):
        calls.append(PlannedToolCall(by_name["query_job_positions"], {"keyword": text[:80]}))

    if any(word in lowered for word in ["政策", "三方", "网申", "秋招", "春招", "行业", "公司简介"]):
        calls.append(PlannedToolCall(by_name["query_knowledge_base"], {"query": text[:120]}))

    skill_tool = _select_file_skill_tool(attachments, tool_pool) or _select_skill_tool(text, tool_pool)
    if skill_tool:
        calls.append(PlannedToolCall(skill_tool, {"task": text, "context": "学生端主智能体请求"}))

    route = _select_route(db, identity.tenant_id, text)
    if route:
        calls.append(PlannedToolCall(by_name["invoke_agent"], {"agent_key": route.target_agent_key, "task": text}))

    if _looks_like_mcp_need(text):
        mcp_tool = next((tool for tool in tool_pool if tool.source == "mcp"), None)
        if mcp_tool:
            calls.append(PlannedToolCall(mcp_tool, {"query": text[:120]}))

    unique: dict[str, PlannedToolCall] = {}
    for call in calls:
        unique.setdefault(call.tool.name, call)
    return list(unique.values())


def _message_count(db: Session, session_id: int) -> int:
    return len(
        list(
            db.scalars(
                select(StudentAgentMessage.id).where(StudentAgentMessage.session_id == session_id).limit(3)
            ).all()
        )
    )


def _select_skill_tool(text: str, tool_pool: list[ToolDefinition]) -> Optional[ToolDefinition]:
    skills = [tool for tool in tool_pool if tool.source == "skill"]
    if not skills:
        return None
    lowered = text.lower()
    keyword_groups = [
        ["简历", "经历", "项目", "resume"],
        ["面试", "自我介绍", "追问", "interview"],
        ["岗位", "jd", "匹配", "职位", "job"],
        ["测评", "mbti", "霍兰德", "职业路径", "规划"],
    ]
    for keywords in keyword_groups:
        if any(keyword.lower() in lowered for keyword in keywords):
            for tool in skills:
                haystack = f"{tool.name} {tool.description} {' '.join(tool.metadata.get('tags', []))}".lower()
                if any(keyword.lower() in haystack for keyword in keywords):
                    return tool
    return skills[0] if any(word in lowered for word in ["帮我", "分析", "优化", "生成", "规划"]) else None


def _select_file_skill_tool(
    attachments: list[StudentAgentAttachment],
    tool_pool: list[ToolDefinition],
) -> Optional[ToolDefinition]:
    if not attachments:
        return None
    skills = [tool for tool in tool_pool if tool.source == "skill"]
    if not skills:
        return None
    ext_text = " ".join(attachment.file_ext for attachment in attachments).lower()
    file_keywords: list[str] = []
    if any(ext in ext_text for ext in ["pdf", "doc", "docx"]):
        file_keywords.extend(["文档", "简历", "pdf", "word", "doc"])
    if any(ext in ext_text for ext in ["xls", "xlsx", "csv"]):
        file_keywords.extend(["表格", "excel", "xlsx", "数据"])
    if any(attachment.content_type.startswith("image/") for attachment in attachments):
        file_keywords.extend(["图片", "照片", "image", "视觉"])
    for tool in skills:
        haystack = f"{tool.name} {tool.description} {' '.join(tool.metadata.get('tags', []))}".lower()
        if any(keyword.lower() in haystack for keyword in file_keywords):
            return tool
    return None


# ── Tool execution ─────────────────────────────────────────────────────────────


async def _execute_tool_call(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_text: str,
    planned: PlannedToolCall,
    attachments: list[StudentAgentAttachment],
) -> dict[str, Any]:
    tool = planned.tool
    if tool.source == "skill":
        return _invoke_skill(tool, planned.arguments)
    if tool.source == "mcp":
        return _invoke_mcp_placeholder(tool)
    if tool.name == "invoke_agent":
        route = _select_route_by_key(db, identity.tenant_id, str(planned.arguments.get("agent_key") or ""))
        if not route:
            return {"status": "failed", "summary": "没有找到可调用的子智能体。", "tool": tool.name}
        result = await _call_subagent_provider(
            route, str(planned.arguments.get("task") or user_text), f"student-{identity.user_id}"
        )
        return {"tool": tool.name, "agent_key": route.target_agent_key, "agent_name": route.target_agent_name, **result}
    if tool.name == "query_student_profile":
        return _query_student_profile(db, identity)
    if tool.name == "query_job_positions":
        keyword = str(planned.arguments.get("keyword") or user_text)
        return {
            "status": "completed",
            "tool": tool.name,
            "summary": f"已检索岗位库：围绕「{keyword[:30]}」生成岗位匹配上下文（岗位库后端待接入真实数据源）。",
            "keyword": keyword,
        }
    if tool.name == "query_knowledge_base":
        query = str(planned.arguments.get("query") or user_text)
        return {
            "status": "completed",
            "tool": tool.name,
            "summary": f"已检索知识库：{query[:40]}（知识库 RAG adapter 已预留）。",
            "query": query,
        }
    if tool.name == "read_resume":
        if attachments:
            names = "、".join(attachment.original_name for attachment in attachments[:4])
            return {
                "status": "completed",
                "tool": tool.name,
                "summary": f"已读取本轮材料：{names}。",
            }
        return {
            "status": "completed",
            "tool": tool.name,
            "summary": "已检查简历材料：当前会话还没有上传简历文件，请学生补充材料。",
        }
    if tool.name == "analyze_uploaded_file":
        return _analyze_uploaded_files(attachments)
    if tool.name == "send_notification":
        return {
            "status": "failed",
            "tool": tool.name,
            "summary": "通知发送属于需要确认的动作，当前对话未获得学生确认，已跳过。",
        }
    if tool.name == "get_session_context":
        return _get_session_context(db, session, int(planned.arguments.get("limit") or 8))
    return {"status": "failed", "tool": tool.name, "summary": f"工具 {tool.name} 尚未实现 handler。"}


def _invoke_skill(tool: ToolDefinition, arguments: dict[str, Any]) -> dict[str, Any]:
    skill_name = str(tool.metadata.get("name") or tool.name)
    return {
        "status": "completed",
        "tool": tool.name,
        "skill_slug": tool.metadata.get("slug"),
        "summary": f"已调用 Skill：{skill_name}，处理「{str(arguments.get('task') or '')[:30]}」。",
        "skill_content": str(tool.metadata.get("content") or "")[:1600],
        "description": tool.description,
    }


def _analyze_uploaded_files(attachments: list[StudentAgentAttachment]) -> dict[str, Any]:
    if not attachments:
        return {
            "status": "failed",
            "tool": "analyze_uploaded_file",
            "summary": "本轮消息没有可分析的附件。",
        }
    file_summaries = []
    for attachment in attachments:
        text = (attachment.extracted_text or "").strip()
        excerpt = text[:700] if text else "未提取到文本内容"
        file_summaries.append(
            {
                "id": attachment.id,
                "name": attachment.original_name,
                "content_type": attachment.content_type,
                "file_ext": attachment.file_ext,
                "file_size": attachment.file_size,
                "excerpt": excerpt,
            }
        )
    names = "、".join(item["name"] for item in file_summaries)
    has_image = any(attachment.content_type.startswith("image/") for attachment in attachments)
    image_note = (
        " 图片已解析，如模型支持视觉输入将直传。"
        if has_image
        else ""
    )
    return {
        "status": "completed",
        "tool": "analyze_uploaded_file",
        "summary": f"已解析附件：{names}。{image_note}",
        "attachments": file_summaries,
    }


def _invoke_mcp_placeholder(tool: ToolDefinition) -> dict[str, Any]:
    return {
        "status": "completed",
        "tool": tool.name,
        "summary": "已探索 MCP 工具池（管理端接入具体 MCP 服务后动态发现）。",
        "adapter": "reserved",
        "supported_transports": ["stdio", "sse", "streamable_http"],
    }


def _select_route_by_key(db: Session, tenant_id: int, agent_key: str) -> Optional[MasterRouteRule]:
    return db.scalar(
        select(MasterRouteRule).where(
            MasterRouteRule.tenant_id == tenant_id,
            MasterRouteRule.enabled.is_(True),
            MasterRouteRule.target_agent_key == agent_key,
        )
    )


def _query_student_profile(db: Session, identity: AuthIdentity) -> dict[str, Any]:
    student = db.get(StudentUser, identity.user_id)
    if not student:
        return {"status": "failed", "tool": "query_student_profile", "summary": "没有找到学生档案。"}
    profile = {
        "name": student.name or "同学",
        "email": student.email,
        "college": student.college,
        "major": student.major,
        "grade": student.grade,
    }
    visible = "，".join(f"{k}={v}" for k, v in profile.items() if v)
    return {
        "status": "completed",
        "tool": "query_student_profile",
        "summary": f"已读取学生档案：{visible or '暂无详细背景'}。",
        "profile": profile,
    }


def _get_session_context(db: Session, session: StudentAgentSession, limit: int) -> dict[str, Any]:
    messages = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.desc())
            .limit(max(1, min(limit, 20)))
        ).all()
    )
    context = [{"role": item.role, "content": item.content[:500]} for item in reversed(messages)]
    return {
        "status": "completed",
        "tool": "get_session_context",
        "summary": f"已回溯 {len(context)} 条会话记录。",
        "messages": context,
    }


def _select_route(db: Session, tenant_id: int, text: str) -> Optional[MasterRouteRule]:
    routes = list(
        db.scalars(
            select(MasterRouteRule)
            .where(MasterRouteRule.tenant_id == tenant_id, MasterRouteRule.enabled.is_(True))
            .order_by(MasterRouteRule.priority.desc(), MasterRouteRule.id.asc())
        ).all()
    )
    if not routes:
        return None
    lowered = text.lower()
    for route in routes:
        haystack = f"{route.intent} {route.target_agent_name} {route.target_agent_key}".lower()
        if any(token in haystack for token in _query_tokens(lowered)):
            return route
    return routes[0] if any(word in lowered for word in ["面试", "岗位", "简历", "jd", "求职"]) else None


def _query_tokens(text: str) -> list[str]:
    tokens = ["面试", "岗位", "职位", "匹配", "简历", "项目", "jd", "求职", "三方", "网申", "interview", "resume", "job"]
    return [token for token in tokens if token in text]


def _looks_like_mcp_need(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in ["查询", "搜索", "日历", "宣讲", "岗位数据", "实时", "mcp", "网申", "公司信息"])


async def _call_subagent_provider(route: MasterRouteRule, task: str, user_key: str) -> dict[str, Any]:
    if route.target_provider == "dify":
        return await _call_dify_subagent(route, task, user_key)
    return {
        "status": "completed",
        "provider": "builtin",
        "summary": f"已运行子智能体「{route.target_agent_name}」，建议围绕「{task[:30]}」继续拆解目标。",
    }


async def _call_dify_subagent(route: MasterRouteRule, task: str, user_key: str) -> dict[str, Any]:
    try:
        config = json.loads(route.provider_config_json or "{}")
    except json.JSONDecodeError:
        config = {}
    base_url = str(config.get("api_base_url") or config.get("base_url") or "").rstrip("/")
    api_key = str(config.get("api_key") or "")
    if not base_url or not api_key:
        return {
            "status": "failed",
            "provider": "dify",
            "summary": f"Dify sub-agent [{route.target_agent_name}] missing api_base_url/api_key",
        }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    inputs = config.get("inputs") or {}
    
    # Try multiple endpoints to support different Dify app modes
    endpoints = [
        ("/chat-messages", {"inputs": inputs, "query": task, "response_mode": "blocking", "user": user_key}),
        ("/completion-messages", {"inputs": inputs, "response_mode": "blocking", "user": user_key}),
        ("/workflows/run", {"inputs": inputs, "response_mode": "blocking", "user": user_key}),
    ]
    if config.get("conversation_id"):
        for _, body in endpoints:
            body["conversation_id"] = config["conversation_id"]
    
    last_error = ""
    async with httpx.AsyncClient(timeout=httpx.Timeout(float(config.get("timeout_sec", 45)))) as client:
        for path, body in endpoints:
            try:
                response = await client.post(f"{base_url}{path}", headers=headers, json=body)
                if response.status_code == 200:
                    data = response.json()
                    answer = str(data.get("answer") or data.get("data", {}).get("answer") or data.get("data", {}).get("outputs", {}).get("text", "") or "").strip()
                    return {
                        "status": "completed",
                        "provider": "dify",
                        "summary": answer[:500] or f"Dify sub-agent [{route.target_agent_name}] completed (no text returned)",
                        "conversation_id": data.get("conversation_id"),
                        "message_id": data.get("message_id"),
                    }
                elif response.status_code == 401:
                    return {"status": "failed", "provider": "dify", "summary": f"Dify sub-agent [{route.target_agent_name}] invalid API Secret (401)"}
                else:
                    try:
                        detail = response.json()
                        last_error = detail.get("message", "") or str(detail)[:100]
                    except Exception:
                        last_error = f"HTTP {response.status_code}"
            except Exception as exc:
                last_error = str(exc)[:100]
    
    return {
        "status": "failed",
        "provider": "dify",
        "summary": f"Dify sub-agent [{route.target_agent_name}] failed: {last_error}",
    }

def _select_chat_model(db: Session, tenant_id: int, requested_model_id: Optional[int]) -> Optional[ModelConfig]:
    if requested_model_id:
        model = db.get(ModelConfig, requested_model_id)
        if (
            model
            and model.tenant_id == tenant_id
            and not model.is_deleted
            and model.open_to_student
            and model.capability in CHAT_CAPABLE_CAPABILITIES
            and model.status == "active"
        ):
            return model
        return None

    config = get_or_create_master_config(db, tenant_id)
    if config.model_id:
        model = db.get(ModelConfig, config.model_id)
        if (
            model
            and model.tenant_id == tenant_id
            and not model.is_deleted
            and model.open_to_student
            and model.capability in CHAT_CAPABLE_CAPABILITIES
            and model.status == "active"
        ):
            return model
    return db.scalar(
        select(ModelConfig)
        .where(
            ModelConfig.tenant_id == tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.capability.in_(CHAT_CAPABLE_CAPABILITIES),
            ModelConfig.status == "active",
        )
        .order_by(ModelConfig.id.asc())
    )


# ── LLM streaming ─────────────────────────────────────────────────────────────


async def _stream_llm_response(
    model: ModelConfig,
    messages: list[dict[str, Any]],
    reasoning_effort: str,
) -> AsyncIterator[str]:
    """Stream tokens from an OpenAI-compatible chat/completions endpoint."""
    try:
        api_key = decrypt_api_key(model.api_key_cipher or "")
        payload: dict[str, Any] = {
            "model": model.model_identifier,
            "messages": messages,
            "temperature": model.default_temp if model.default_temp is not None else 0.7,
            "max_tokens": model.max_output or 4096,
            "stream": True,
        }
        if _supports_reasoning_effort(model):
            payload["reasoning_effort"] = "high" if reasoning_effort == "xhigh" else reasoning_effort

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=model.timeout_sec or 60, write=30, pool=5)
        ) as client:
            async with client.stream(
                "POST",
                f"{model.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                        delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                        if delta:
                            yield delta
                    except (json.JSONDecodeError, KeyError, IndexError):
                        continue
    except Exception:
        return


# ── Prompt composition ────────────────────────────────────────────────────────


def _compose_prompt(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_text: str,
    observations: list[RuntimeObservation],
    reasoning_effort: str,
    model: ModelConfig,
    attachments: list[StudentAgentAttachment],
) -> list[dict[str, Any]]:
    config = get_or_create_master_config(db, identity.tenant_id)
    system_prompt = (config.system_prompt or DEFAULT_SYSTEM_PROMPT).strip()
    effort_text = _effort_instruction(reasoning_effort)

    system_content = (
        system_prompt
        + "\n\n## 回答规范\n"
        "- 工具调用已由 Harness 完成，你直接综合结果给出最终回答。\n"
        "- 使用 Markdown 格式（标题、加粗、列表、代码块），让回答清晰可读。\n"
        "- 先给结论，再给可执行步骤，简洁有力。\n"
        "- 禁止输出工具调用 JSON、thoughts 字段或任何内部推理链。\n"
        f"- 推理强度：{effort_text}"
    )

    messages: list[dict[str, Any]] = [{"role": "system", "content": system_content}]

    # Load historical conversation as proper multi-turn pairs (excluding current user msg)
    history_rows = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.asc())
            .limit(24)
        ).all()
    )
    for msg in history_rows[:-1]:
        if msg.role not in ("user", "assistant"):
            continue
        content = msg.content
        if len(content) > 4000:
            content = content[:4000] + "\n…[已截断]"
        messages.append({"role": msg.role, "content": content})

    inline_images = _has_image_attachments(attachments) and _supports_image_input(model)

    # Build current user turn with tool observations appended
    parts: list[str] = [user_text]
    if observations:
        obs_lines = "\n".join(f"- **{o.name}**: {o.summary}" for o in observations)
        parts.append(f"\n---\n**工具执行摘要**\n{obs_lines}")
    if attachments:
        parts.append(f"\n---\n**附件内容**\n{_attachment_prompt_text(attachments, inline_images)}")
    current_text = "\n".join(parts)

    if inline_images:
        image_parts = _attachment_image_parts(attachments)
        messages.append({
            "role": "user",
            "content": [{"type": "text", "text": current_text}, *image_parts],
        })
    else:
        messages.append({"role": "user", "content": current_text})

    return messages


def _effort_instruction(reasoning_effort: str) -> str:
    labels = {
        "low": "低。快速响应，给出简洁可执行建议。",
        "medium": "中。平衡速度和质量，覆盖关键依据与下一步。",
        "high": "高。充分分析，补齐风险和细节。",
        "xhigh": "超高。系统拆解、多角度验证，给出完整行动计划。",
    }
    return labels.get(reasoning_effort, labels["medium"])


def _attachment_prompt_text(
    attachments: list[StudentAgentAttachment],
    inline_images: bool = False,
) -> str:
    if not attachments:
        return "无附件。"
    chunks: list[str] = []
    for attachment in attachments:
        is_image = attachment.content_type.startswith("image/")
        if is_image and inline_images:
            # The raw image is attached inline to this same message — tell the
            # model to look at it directly instead of relying on metadata.
            body = "（图片已随本条消息一并传入，请直接观察图片内容进行分析，不要回答“只能看到元数据”。）"
        else:
            extracted = (attachment.extracted_text or "").strip()[:3000]
            body = f"提取内容:\n{extracted or '未提取到文本内容。'}"
        chunks.append(
            "\n".join(
                [
                    f"附件 {attachment.id}: {attachment.original_name}",
                    f"类型: {attachment.content_type}, 大小: {attachment.file_size} bytes",
                    body,
                ]
            )
        )
    return "\n\n".join(chunks)


def _attachment_image_parts(attachments: list[StudentAgentAttachment]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    for attachment in attachments:
        if not attachment.content_type.startswith("image/"):
            continue
        if attachment.file_size > 8_000_000:
            continue
        path = Path(attachment.stored_path)
        if not path.exists():
            continue
        data_url = f"data:{attachment.content_type};base64,{base64.b64encode(path.read_bytes()).decode('ascii')}"
        parts.append({"type": "image_url", "image_url": {"url": data_url}})
    return parts[:4]


def _has_image_attachments(attachments: list[StudentAgentAttachment]) -> bool:
    return any(attachment.content_type.startswith("image/") for attachment in attachments)


def _supports_reasoning_effort(model: ModelConfig) -> bool:
    haystack = f"{model.provider} {model.model_identifier} {model.protocols}".lower()
    return any(token in haystack for token in ["openai", "o1", "o3", "o4", "gpt-5"])


def _supports_image_input(model: ModelConfig) -> bool:
    """Assume chat models are multimodal and pass images through by default.

    A keyword allowlist is too fragile — new/custom multimodal model names
    (e.g. mimo-v2.5) get silently dropped. Instead we attempt image passthrough
    for every chat model and only skip it for modalities that obviously cannot
    handle images (embedding / rerank / speech). If a genuinely text-only chat
    model rejects the request, the stream degrades to the text fallback answer.
    """
    haystack = f"{model.provider} {model.model_identifier} {model.protocols} {model.capability}".lower()
    non_visual_markers = [
        "embedding", "embed", "rerank", "reranker",
        "whisper", "tts", "speech", "audio", "voice",
        "moderation", "guard",
    ]
    return not any(token in haystack for token in non_visual_markers)


def _fallback_answer(user_text: str, observations: list[RuntimeObservation]) -> str:
    done = [item.summary for item in observations]
    prefix = "\n".join(f"- {item}" for item in done) if done else "- 已记录你的需求。"
    return (
        "我已整理好以下上下文：\n\n"
        f"{prefix}\n\n"
        "接下来你可以继续描述需求，例如上传简历、告诉我目标岗位，"
        "我会调用合适的 Skill 或子智能体进一步处理，并把结果汇总给你。"
    )


def _configured_fallback_answer(config: Any, user_text: str) -> str:
    mode = str(getattr(config, "fallback_mode", "") or "direct_answer").lower()
    custom_message = str(getattr(config, "fallback_message", "") or "").strip()
    if mode == "guide_message":
        return custom_message or (
            "这次我没能完成处理。你可以补充目标岗位、简历或具体问题后重试，"
            "我会重新选择合适的工具继续处理。"
        )
    if mode == "error":
        return custom_message or "主智能体暂时无法完成本次请求，请稍后重试。"
    return _fallback_answer(user_text, [])


# ══════════════════════════════════════════════════════════════════════════════
# Agentic Loop（Model + Harness）—— Model 只提议工具，Harness 负责执行/校验/审计
# ══════════════════════════════════════════════════════════════════════════════

# 仅暴露 Harness 能够「诚实兑现」的工具。会编造结果的占位工具（岗位库 / 知识库 /
# 子智能体 / MCP）在内核稳定前一律不进工具池——对应准则「禁止编造经营结果」。
ACTIVE_BUILTIN_TOOL_NAMES = (
    "query_student_profile",
    "read_resume",
    "analyze_uploaded_file",
    "get_session_context",
    "export_resume_pdf",
)


def assemble_active_tools(db: Session, identity: AuthIdentity) -> list[ToolDefinition]:
    """组装工具池：内置工具白名单 + 已启用的 Skill + 已启用的子智能体（每条路由一个工具）。"""
    pool: dict[str, ToolDefinition] = {}
    by_name = {tool.name: tool for tool in BUILTIN_TOOLS}
    for name in ACTIVE_BUILTIN_TOOL_NAMES:
        tool = by_name.get(name)
        if tool:
            pool[name] = tool

    for skill in list_skills(db, include_disabled=False):
        data = serialize_skill(skill)
        name = "skill__" + _tool_safe_name(str(data["slug"]))
        if name in pool:
            continue
        pool[name] = ToolDefinition(
            name=name,
            description=str(data.get("description") or data.get("name") or "Skill 工具"),
            source="skill",
            priority=500,
            input_schema={
                "type": "object",
                "properties": {"task": {"type": "string", "description": "交给该 Skill 处理的具体任务。"}},
                "required": ["task"],
            },
            metadata=data,
        )

    for tool in _assemble_subagent_tools(db, identity):
        if tool.name not in pool:
            pool[tool.name] = tool

    return sorted(pool.values(), key=lambda item: (-item.priority, item.name))


def _assemble_subagent_tools(db: Session, identity: AuthIdentity) -> list[ToolDefinition]:
    """把每条启用的 MasterRouteRule 暴露成一个命名子智能体工具——`intent` 即工具描述，
    模型在循环中自主决定何时派发。只暴露能真实执行的（builtin 跑平台智能体、dify 调 Dify）。"""
    routes = list(
        db.scalars(
            select(MasterRouteRule)
            .where(MasterRouteRule.tenant_id == identity.tenant_id, MasterRouteRule.enabled.is_(True))
            .order_by(MasterRouteRule.priority.desc(), MasterRouteRule.id.asc())
        ).all()
    )
    tools: list[ToolDefinition] = []
    for route in routes:
        name = "subagent__" + _tool_safe_name(route.target_agent_key)
        intent = (route.intent or route.target_agent_name or "子智能体").strip()
        tools.append(
            ToolDefinition(
                name=name,
                description=f"{intent}（子智能体：{route.target_agent_name}）",
                source="subagent",
                priority=800,
                input_schema={
                    "type": "object",
                    "properties": {
                        "task": {
                            "type": "string",
                            "description": "交给该子智能体的完整任务，需自带必要上下文（如简历正文、岗位 JD），子智能体看不到主对话历史。",
                        }
                    },
                    "required": ["task"],
                },
                metadata={
                    "kind": "subagent",
                    "route_id": route.id,
                    "agent_key": route.target_agent_key,
                    "agent_name": route.target_agent_name,
                    "provider": route.target_provider,
                },
            )
        )
    return tools


def _build_openai_tools(tool_defs: list[ToolDefinition]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": (tool.description or "")[:1024],
                "parameters": tool.input_schema or {"type": "object", "properties": {}},
            },
        }
        for tool in tool_defs
    ]


def _harness_system_prompt(config: Any, reasoning_effort: str) -> str:
    persona = (getattr(config, "system_prompt", None) or DEFAULT_SYSTEM_PROMPT).strip()
    effort = _effort_instruction(reasoning_effort)
    rules = (
        "\n\n## 运行机制（Harness 管控，必须遵守）\n"
        "- 你只负责理解需求、规划步骤、选择工具、综合结果；工具的执行、校验与权限由 Harness 负责，你无需也不能自行控制循环。\n"
        "- 工具纪律：只能调用系统提供给你的工具，并严格按其参数 schema 传参；不要臆测不存在的能力，也不要伪造任何工具的返回结果。\n"
        "- 反幻觉铁律：禁止编造学生的简历内容、经历、项目、岗位、公司或任何数据。没有依据时如实说明，并向学生索取材料。\n"
        "- 简历相关：在给出任何简历修改建议或生成简历之前，必须先调用 read_resume 读取学生的真实简历；"
        "若 read_resume 返回没有简历，请直接告知并引导学生到『个人中心—我的简历』上传，绝不虚构内容。\n"
        "- 生成可下载简历：当学生需要『修改好的 / 可下载的简历』时，先基于真实简历完成改写，再调用 "
        "export_resume_pdf（传入完整的 Markdown 简历正文）生成 PDF，然后把工具返回的 download_url 以 "
        "Markdown 链接形式给学生，例如：[点击下载优化后的简历](下载链接)。\n"
        "- 输出规范：使用 Markdown，先结论后步骤；不要输出工具调用的原始 JSON、tool_call 或隐藏推理过程。\n"
        f"- 推理强度：{effort}"
    )
    return persona + rules


def _build_initial_messages(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_text: str,
    reasoning_effort: str,
    model: ModelConfig,
    attachments: list[StudentAgentAttachment],
    config: Any,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _harness_system_prompt(config, reasoning_effort)}
    ]

    # 取最近 24 条（desc 后反转为 asc），最后一条即本轮 user 消息，丢弃避免重复。
    history_rows = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.desc())
            .limit(24)
        ).all()
    )
    history_rows.reverse()
    for msg in history_rows[:-1]:
        if msg.role not in ("user", "assistant"):
            continue
        text = msg.content
        if len(text) > 4000:
            text = text[:4000] + "\n…[已截断]"
        messages.append({"role": msg.role, "content": text})

    inline_images = _has_image_attachments(attachments) and _supports_image_input(model)
    parts = [user_text]
    if attachments:
        parts.append("\n---\n**本轮附件**\n" + _attachment_prompt_text(attachments, inline_images))
    current_text = "\n".join(parts)

    if inline_images:
        messages.append(
            {"role": "user", "content": [{"type": "text", "text": current_text}, *_attachment_image_parts(attachments)]}
        )
    else:
        messages.append({"role": "user", "content": current_text})
    return messages


async def run_agent_loop(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_message: StudentAgentMessage,
    assistant_message: StudentAgentMessage,
    model: ModelConfig,
    messages: list[dict[str, Any]],
    openai_tools: list[dict[str, Any]],
    registry: dict[str, ToolDefinition],
    attachments: list[StudentAgentAttachment],
    reasoning_effort: str,
    max_iterations: int,
    permission_mode: str = "ask",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The harness-owned ReAct loop. Yields (sse_event_name, data) tuples."""
    assistant_id = assistant_message.id

    for iteration in range(max_iterations):
        turn_content = ""
        turn_tool_calls: list[dict[str, Any]] = []
        turn_error = False

        async for kind, value in _stream_llm_turn(
            model, messages, openai_tools, reasoning_effort, temperature, max_tokens
        ):
            if kind == "delta":
                yield "message.delta", {"message_id": assistant_id, "delta": value}
            elif kind == "error":
                turn_error = True
            elif kind == "final":
                turn_content = value.get("content") or ""
                turn_tool_calls = value.get("tool_calls") or []

        # 模型不支持 tools（请求报错）→ 降级：去掉 tools 再要一次纯文本回答。
        if turn_error and not turn_tool_calls:
            async for kind, value in _stream_llm_turn(
                model, messages, [], reasoning_effort, temperature, max_tokens
            ):
                if kind == "delta":
                    yield "message.delta", {"message_id": assistant_id, "delta": value}
            return

        if not turn_tool_calls:
            return  # 最终回答已流式输出完毕

        # 规范每个 tool_call 的 id，保证 assistant 消息与 tool 结果一一对应。
        for i, tc in enumerate(turn_tool_calls):
            if not tc.get("id"):
                tc["id"] = f"call_{iteration}_{i}"

        messages.append(
            {
                "role": "assistant",
                "content": turn_content or "",
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc.get("name") or "", "arguments": tc.get("arguments") or "{}"},
                    }
                    for tc in turn_tool_calls
                ],
            }
        )

        for tc in turn_tool_calls:
            name = tc.get("name") or ""
            call_id = tc["id"]
            td = registry.get(name)
            args, argument_errors = parse_tool_arguments(
                tc.get("arguments"),
                td.input_schema if td else None,
            )
            activity_kind = (td.metadata.get("kind") if td else None) or (td.source if td else None) or "context"
            start_label = (
                f"工具「{name}」参数校验失败"
                if argument_errors
                else (_tool_start_label(td, args) if td else f"正在处理未知工具 {name}…")
            )

            # 四态权限裁决（Harness 管控）：未通过则不执行，回结构化结果让模型转而向学生说明。
            decision, deny_reason = _permission_decision(permission_mode, name, td)

            started = _save_activity(
                db, session, user_message,
                kind=str(activity_kind), name=name or "unknown",
                status_value="started",
                summary=deny_reason if decision != "allow" else start_label,
                detail={
                    "iteration": iteration + 1,
                    "tool_call_id": call_id,
                    "arguments": args,
                    "argument_errors": argument_errors,
                    "permission_mode": permission_mode,
                    "decision": decision,
                },
            )
            yield "activity.started", serialize_activity(started).model_dump(mode="json")

            if argument_errors:
                result = {
                    "status": "failed",
                    "tool": name,
                    "summary": "；".join(argument_errors),
                    "error_code": "invalid_tool_arguments",
                }
            elif decision == "allow":
                result = await _dispatch_tool(
                    db, identity, session, assistant_message, user_message.content, attachments, name, args, td
                )
            else:
                result = {"status": "failed", "tool": name, "summary": deny_reason, "permission": decision}
            result_detail = {
                **result,
                "iteration": iteration + 1,
                "tool_call_id": call_id,
                "arguments": args,
            }
            completed = _complete_activity(
                db, started,
                status_value=result.get("status", "completed"),
                summary=result.get("summary", ""),
                detail=result_detail,
            )
            event_name = "activity.completed" if result.get("status") == "completed" else "activity.failed"
            yield event_name, serialize_activity(completed).model_dump(mode="json")

            # 生成了可下载文件时，额外推一个事件供前端做下载入口（前端忽略也无害）。
            if result.get("download_url"):
                yield "attachment.created", {
                    "message_id": assistant_id,
                    "download_url": result["download_url"],
                    "filename": result.get("filename"),
                    "attachment_id": result.get("attachment_id"),
                }

            messages.append({"role": "tool", "tool_call_id": call_id, "content": _tool_result_for_model(result)})

    # 触顶 max_iterations —— 强制一次无工具的收尾回答，避免无限循环。
    async for kind, value in _stream_llm_turn(
        model, messages, [], reasoning_effort, temperature, max_tokens
    ):
        if kind == "delta":
            yield "message.delta", {"message_id": assistant_id, "delta": value}


async def _stream_llm_turn(
    model: ModelConfig,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    reasoning_effort: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Single streaming turn. Yields ("delta", text) / ("error", msg) / ("final", dict)."""
    try:
        api_key = decrypt_api_key(model.api_key_cipher or "")
        payload: dict[str, Any] = {
            "model": model.model_identifier,
            "messages": messages,
            "temperature": temperature if temperature is not None else (
                model.default_temp if model.default_temp is not None else 0.7
            ),
            "max_tokens": max_tokens if max_tokens is not None else (model.max_output or 4096),
            "stream": True,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if _supports_reasoning_effort(model):
            payload["reasoning_effort"] = "high" if reasoning_effort == "xhigh" else reasoning_effort

        tool_calls_acc: dict[int, dict[str, str]] = {}
        content_acc = ""
        finish: Optional[str] = None

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=model.timeout_sec or 60, write=30, pool=5)
        ) as client:
            async with client.stream(
                "POST",
                f"{model.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choice = (obj.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        content_acc += piece
                        yield "delta", piece
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0) or 0
                        slot = tool_calls_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
    except Exception as exc:  # noqa: BLE001 — surfaced to caller for graceful fallback
        yield "error", str(exc)[:200]
        return

    ordered = [tool_calls_acc[key] for key in sorted(tool_calls_acc.keys())]
    yield "final", {"content": content_acc, "tool_calls": ordered, "finish_reason": finish}


# ── Harness tool dispatch ───────────────────────────────────────────────────────


async def _dispatch_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    assistant_message: StudentAgentMessage,
    user_text: str,
    attachments: list[StudentAgentAttachment],
    name: str,
    args: dict[str, Any],
    td: Optional[ToolDefinition],
) -> dict[str, Any]:
    # 未知工具：返回结构化错误让模型自我纠正，而不是崩溃。
    if td is None:
        return {"status": "failed", "tool": name, "summary": f"未知工具「{name}」，已忽略。请只调用系统提供的工具。"}
    if td.metadata.get("kind") == "subagent":
        return await _dispatch_subagent(db, identity, td, args)
    if td.source == "skill":
        return _invoke_skill(td, args)
    if name == "query_student_profile":
        return _query_student_profile(db, identity)
    if name == "read_resume":
        return _read_resume_tool(db, identity, session, attachments)
    if name == "analyze_uploaded_file":
        return _analyze_uploaded_files(attachments)
    if name == "get_session_context":
        return _get_session_context(db, session, int(args.get("limit") or 8))
    if name == "export_resume_pdf":
        return _export_resume_pdf_tool(db, identity, session, assistant_message, args)
    return {"status": "failed", "tool": name, "summary": f"工具 {name} 暂未接入执行器。"}


def _tool_result_for_model(result: dict[str, Any]) -> str:
    try:
        text = json.dumps(result, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(result)
    return text[:6000]


# ── 四态权限裁决（allow / ask / deny）────────────────────────────────────────────


def _permission_decision(mode: str, name: str, td: Optional[ToolDefinition]) -> tuple[str, str]:
    """根据主智能体配置的 permission_mode 与工具风险等级裁决是否执行。

    返回 (decision, reason)，decision ∈ {"allow", "ask", "deny"}。
    - auto：除被 deny 标记外，一律放行；
    - ask（默认）：低风险放行，需确认的高风险动作暂缓（当前工具池无此类，预留给投递/发信等）；
    - strict：仅放行平台内置安全工具，Skill 与子智能体一律拒绝。
    未知工具交给 _dispatch_tool 返回结构化错误，这里直接放行。
    """
    if td is None:
        return "allow", ""

    risk_raw = str(td.metadata.get("risk", "")).lower()
    if risk_raw in ("deny", "high", "critical"):
        risk = "deny"
    elif risk_raw in ("confirm", "ask", "medium"):
        risk = "confirm"
    else:
        risk = "allow"

    strict_ok = td.source == "builtin"  # 仅平台内置工具进入 strict 白名单

    if risk == "deny":
        return "deny", f"工具「{name}」已被 Harness 禁用，拒绝执行。"
    if mode == "strict" and not strict_ok:
        return (
            "deny",
            f"当前为 strict 权限模式，仅允许平台内置安全工具，已拒绝调用「{name}」。"
            "请改用内置工具，或如实告知学生该能力当前不可用。",
        )
    if mode == "ask" and risk == "confirm":
        return (
            "ask",
            f"工具「{name}」属于需要学生确认的操作，当前未获确认，已暂缓。"
            "请先向学生说明将要执行的动作并征得同意。",
        )
    return "allow", ""


# ── 子智能体派发（Coordinator → sub-agent）───────────────────────────────────────


async def _dispatch_subagent(
    db: Session, identity: AuthIdentity, td: ToolDefinition, args: dict[str, Any]
) -> dict[str, Any]:
    route_id = td.metadata.get("route_id")
    route = db.get(MasterRouteRule, route_id) if route_id else None
    if not route or not route.enabled or route.tenant_id != identity.tenant_id:
        return {"status": "failed", "tool": td.name, "summary": f"子智能体「{td.metadata.get('agent_name')}」已不可用。"}

    task = str(args.get("task") or "").strip()
    if not task:
        return {"status": "failed", "tool": td.name, "summary": "调用子智能体需要提供 task（要交办的完整任务）。"}

    if route.target_provider == "dify":
        result = await _call_dify_subagent(route, task, f"student-{identity.user_id}")
    else:
        result = await _run_builtin_subagent(db, route, task)
    result.setdefault("tool", td.name)
    result.setdefault("agent_name", route.target_agent_name)
    return result


def _resolve_builtin_agent(db: Session, key: str) -> Optional[Agent]:
    """把路由的 target_agent_key 解析到平台 Agent。兼容三种写法：
    数字 id、category（如 interview）、或语义别名（matching→岗位匹配、resume→简历优化）。"""
    key = (key or "").strip()
    if not key:
        return None
    if key.isdigit():
        agent = db.get(Agent, int(key))
        return agent if agent and not agent.is_deleted else None
    agent = db.scalar(
        select(Agent).where(Agent.category == key, Agent.is_deleted.is_(False)).order_by(Agent.id.asc())
    )
    if agent:
        return agent
    aliases = {
        "interview": ["面试"],
        "matching": ["匹配", "岗位"],
        "resume": ["简历"],
        "career": ["测评", "规划", "职业"],
    }
    for keyword in aliases.get(key.lower(), [key]):
        agent = db.scalar(
            select(Agent).where(Agent.name.ilike(f"%{keyword}%"), Agent.is_deleted.is_(False)).order_by(Agent.id.asc())
        )
        if agent:
            return agent
    return None


async def _run_builtin_subagent(db: Session, route: MasterRouteRule, task: str) -> dict[str, Any]:
    """真实执行平台内置子智能体：在独立上下文里用该智能体的 system prompt + 模型跑一轮，
    只把结果摘要回流主对话（不再返回编造的占位摘要）。"""
    agent = _resolve_builtin_agent(db, route.target_agent_key)
    if not agent or not agent.is_enabled:
        return {"status": "failed", "provider": "builtin", "summary": f"子智能体「{route.target_agent_name}」不存在或已停用。"}
    if agent.use_dify:
        return {
            "status": "failed",
            "provider": "builtin",
            "summary": f"子智能体「{agent.name}」配置为 Dify 应用，请在路由里改用 Dify provider 接入。",
        }

    model = db.get(ModelConfig, agent.model_config_id) if agent.model_config_id else None
    if not model or model.is_deleted or not model.api_key_cipher:
        return {"status": "failed", "provider": "builtin", "summary": f"子智能体「{agent.name}」未配置可用模型。"}

    system_prompt = (agent.system_prompt or f"你是{agent.name}。").strip()
    reply = await _oneshot_llm(
        model, system_prompt, task,
        temperature=agent.temperature, max_tokens=agent.max_tokens,
    )
    if not reply:
        return {"status": "failed", "provider": "builtin", "summary": f"子智能体「{agent.name}」未返回结果。"}
    return {
        "status": "completed",
        "provider": "builtin",
        "agent_name": agent.name,
        "summary": reply[:1800],
    }


async def _oneshot_llm(
    model: ModelConfig,
    system_prompt: str,
    user_text: str,
    *,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> str:
    """非流式单轮调用 OpenAI 兼容 /chat/completions，返回正文。失败返回空串。"""
    try:
        api_key = decrypt_api_key(model.api_key_cipher or "")
        payload = {
            "model": model.model_identifier,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_text},
            ],
            "temperature": temperature if temperature is not None else (model.default_temp if model.default_temp is not None else 0.7),
            "max_tokens": max_tokens or model.max_output or 2048,
            "stream": False,
        }
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=model.timeout_sec or 60, write=30, pool=5)
        ) as client:
            response = await client.post(
                f"{model.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            return str((data.get("choices") or [{}])[0].get("message", {}).get("content") or "").strip()
    except Exception:
        return ""


# ── Resume tools ────────────────────────────────────────────────────────────────


def _ensure_attachment_text(db: Session, attachment: StudentAgentAttachment) -> str:
    """Lazily extract & persist text for an attachment that has none."""
    existing = (attachment.extracted_text or "").strip()
    if existing:
        return existing
    path = Path(attachment.stored_path)
    if not path.exists():
        return ""
    try:
        if attachment.file_ext == "pdf":
            text = _extract_pdf_text(path)
        else:
            text = _extract_attachment_text(path, attachment.content_type, attachment.file_ext)
    except Exception:
        return ""
    if text and text.strip():
        attachment.extracted_text = text
        try:
            db.commit()
        except Exception:
            db.rollback()
        return text
    return ""


def _read_resume_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    attachments: list[StudentAgentAttachment],
) -> dict[str, Any]:
    """Read the student's resume — this turn's uploads first, then the one stored
    in 个人中心 (profile-level attachments with session_id/message_id == 0)."""
    resumes: list[dict[str, Any]] = []
    seen: set[int] = set()

    for att in attachments:
        seen.add(att.id)
        text = _ensure_attachment_text(db, att)
        if text:
            resumes.append({"source": "本轮上传", "name": att.original_name, "excerpt": text[:3000]})

    rows = list(
        db.scalars(
            select(StudentAgentAttachment)
            .where(
                StudentAgentAttachment.tenant_id == identity.tenant_id,
                StudentAgentAttachment.student_id == identity.user_id,
                StudentAgentAttachment.file_ext == "pdf",
            )
            .order_by(StudentAgentAttachment.created_at.desc())
            .limit(3)
        ).all()
    )
    for row in rows:
        if row.id in seen:
            continue
        text = _ensure_attachment_text(db, row)
        if text:
            resumes.append({"source": "个人中心", "name": row.original_name, "excerpt": text[:3000]})

    if not resumes:
        return {
            "status": "completed",
            "tool": "read_resume",
            "summary": "未找到简历：学生还没有在『个人中心—我的简历』上传，本轮也没有上传简历文件。",
            "resumes": [],
        }
    names = "、".join(item["name"] for item in resumes[:4])
    return {"status": "completed", "tool": "read_resume", "summary": f"已读取简历：{names}", "resumes": resumes[:4]}


def _safe_pdf_filename(name: str) -> str:
    base = Path(name.strip()).name or "优化简历"
    if base.lower().endswith(".pdf"):
        base = base[:-4]
    base = "".join(ch for ch in base if ch not in '\\/:*?"<>|').strip() or "优化简历"
    return f"{base[:60]}.pdf"


def _attachment_download_url(stored_path: Path | str) -> str:
    s = str(stored_path).replace("\\", "/")
    marker = "agent_uploads/"
    idx = s.find(marker)
    return "/data/" + (s[idx:] if idx >= 0 else Path(s).name)


def _export_resume_pdf_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    assistant_message: StudentAgentMessage,
    args: dict[str, Any],
) -> dict[str, Any]:
    markdown = str(args.get("markdown") or args.get("content") or "").strip()
    if not markdown:
        return {"status": "failed", "tool": "export_resume_pdf", "summary": "导出失败：未提供简历正文（markdown）。"}

    filename = _safe_pdf_filename(str(args.get("filename") or "优化简历"))
    settings = get_settings()
    storage_dir = Path(settings.agent_upload_storage_dir) / str(identity.tenant_id) / str(identity.user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    stored_path = storage_dir / f"{uuid.uuid4().hex}.pdf"

    try:
        _render_resume_pdf(markdown, stored_path, title=Path(filename).stem)
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed", "tool": "export_resume_pdf", "summary": f"PDF 生成失败：{str(exc)[:160]}"}

    size = stored_path.stat().st_size if stored_path.exists() else 0
    row = StudentAgentAttachment(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        session_id=session.id,
        message_id=assistant_message.id,
        original_name=filename,
        stored_path=str(stored_path),
        content_type="application/pdf",
        file_ext="pdf",
        file_size=size,
        extracted_text=markdown[:8000],
        status="ready",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    download_url = _attachment_download_url(stored_path)
    return {
        "status": "completed",
        "tool": "export_resume_pdf",
        "summary": f"已生成简历 PDF：{filename}",
        "filename": filename,
        "download_url": download_url,
        "attachment_id": row.id,
    }


def _pdf_inline(text: str) -> str:
    """Escape for reportlab Paragraph and convert minimal Markdown inline marks."""
    import re

    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    safe = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", safe)
    safe = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", safe)
    return safe


# 候选 CJK 字体（按优先级）。Docker 镜像装了 fonts-noto-cjk；macOS 本地开发用系统字体。
# .ttc 需要 subfontIndex。优先嵌入真实字形，保证任意查看器都能正确渲染中文。
_CJK_FONT_CANDIDATES: tuple[tuple[str, int], ...] = (
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/System/Library/Fonts/STHeiti Light.ttc", 0),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),
)


def _register_cjk_font() -> str:
    """Embed a real CJK font when available (renders everywhere); fall back to the
    non-embedded STSong-Light CID font, and finally to Helvetica."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_name = "ResumeCJK"
    if font_name in pdfmetrics.getRegisteredFontNames():
        return font_name
    for path, subfont_index in _CJK_FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, path, subfontIndex=subfont_index))
            return font_name
        except Exception:
            continue
    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light"
    except Exception:
        return "Helvetica"


def _render_resume_pdf(markdown_text: str, out_path: Path, title: str = "个人简历") -> None:
    """Render a Markdown-ish resume into a PDF with an embedded CJK font."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Paragraph, SimpleDocTemplate, Spacer

    font_name = _register_cjk_font()

    body = ParagraphStyle("body", fontName=font_name, fontSize=10.5, leading=16, spaceAfter=4)
    h1 = ParagraphStyle("h1", fontName=font_name, fontSize=18, leading=24, spaceBefore=2, spaceAfter=8)
    h2 = ParagraphStyle(
        "h2", fontName=font_name, fontSize=13, leading=18, spaceBefore=10, spaceAfter=4,
        textColor=colors.HexColor("#1565C0"),
    )
    h3 = ParagraphStyle("h3", fontName=font_name, fontSize=11.5, leading=16, spaceBefore=6, spaceAfter=2)
    bullet = ParagraphStyle("bullet", fontName=font_name, fontSize=10.5, leading=16, leftIndent=12, spaceAfter=2)

    flow: list[Any] = []
    for raw in markdown_text.splitlines():
        stripped = raw.strip()
        if not stripped:
            flow.append(Spacer(1, 4))
            continue
        if stripped in ("---", "***", "___"):
            flow.append(HRFlowable(width="100%", thickness=0.6, color=colors.HexColor("#BBBBBB"), spaceBefore=4, spaceAfter=6))
        elif stripped.startswith("### "):
            flow.append(Paragraph(_pdf_inline(stripped[4:]), h3))
        elif stripped.startswith("## "):
            flow.append(Paragraph(_pdf_inline(stripped[3:]), h2))
        elif stripped.startswith("# "):
            flow.append(Paragraph(_pdf_inline(stripped[2:]), h1))
        elif stripped[:2] in ("- ", "* ") or stripped.startswith("• "):
            flow.append(Paragraph("• " + _pdf_inline(stripped[2:].strip()), bullet))
        else:
            flow.append(Paragraph(_pdf_inline(stripped), body))

    if not flow:
        flow.append(Paragraph(_pdf_inline(title), h1))

    doc = SimpleDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm, title=title,
    )
    doc.build(flow)
