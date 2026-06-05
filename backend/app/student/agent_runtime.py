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
from app.admin.models import ModelConfig
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
    return AgentAttachmentResponse.model_validate(attachment)


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
    session = get_session_or_404(db, identity, session_id)
    user_message = _save_message(db, session, "user", content.strip())
    attachments = _claim_message_attachments(db, identity, session, user_message, attachment_ids)
    yield dumps_event("message.saved", {"message_id": user_message.id})

    # Assemble tool pool once — shared across planning and prompt composition
    tool_pool = assemble_tool_pool(db, identity)

    observations: list[RuntimeObservation] = []
    async for event_name, payload, observation in _run_tool_planning(
        db, identity, session, user_message, attachments, tool_pool
    ):
        yield dumps_event(event_name, payload)
        if observation:
            observations.append(observation)

    model = _select_chat_model(db, identity.tenant_id, model_id)

    assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    if not model:
        error = "当前没有可用的聊天模型，请管理员在模型广场开启「对学生开放」。"
        assistant_message.content = error
        session.updated_at = utcnow()
        db.commit()
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": error})
        yield dumps_event("message.completed", {"message_id": assistant_message.id})
        yield dumps_event("done", {"session_id": session.id})
        return

    if not model.api_key_cipher:
        error = f"模型「{model.display_name}」未配置 API Key，请管理员在模型广场补全配置。"
        assistant_message.content = error
        session.updated_at = utcnow()
        db.commit()
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": error})
        yield dumps_event("message.completed", {"message_id": assistant_message.id})
        yield dumps_event("done", {"session_id": session.id})
        return

    prompt = _compose_prompt(db, identity, session, content, observations, reasoning_effort, model, attachments)
    full_content = ""

    async for chunk in _stream_llm_response(model, prompt, reasoning_effort):
        full_content += chunk
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": chunk})

    if not full_content:
        full_content = _fallback_answer(content, observations)
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
        ("/completion-messages", {"inputs": inputs, "query": task, "response_mode": "blocking", "user": user_key}),
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
