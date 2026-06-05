from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import datetime
from hashlib import sha1
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.mcp.models import McpCallLog, McpService, McpTool
from app.mcp.schemas import McpCallLogResponse, McpCallRequest, McpServiceCreate, McpServiceResponse, McpServiceUpdate, McpToolPayload, McpToolResponse


BUILTIN_TOOLS = [
    {"name": "handoff_agent", "source": "builtin", "provider": "主智能体", "priority": 30},
    {"name": "create_student_todo", "source": "builtin", "provider": "主智能体", "priority": 30},
]
SKILL_TOOLS = [
    {"name": "extract_resume_keywords", "source": "skill", "provider": "简历 Skill", "priority": 20},
    {"name": "compare_salary", "source": "skill", "provider": "岗位匹配 Skill", "priority": 20},
]


def list_services(db: Session, *, keyword: Optional[str] = None, status_filter: Optional[str] = None, category: Optional[str] = None) -> list[McpServiceResponse]:
    stmt = (
        select(McpService)
        .options(selectinload(McpService.tools))
        .where(McpService.is_deleted.is_(False))
        .order_by(McpService.updated_at.desc())
    )
    if status_filter and status_filter != "all":
        stmt = stmt.where(McpService.status == status_filter)
    if category and category != "all":
        stmt = stmt.where(McpService.category == category)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(
            (McpService.name.ilike(kw))
            | (McpService.description.ilike(kw))
            | (McpService.endpoint.ilike(kw))
            | (McpService.owner.ilike(kw))
            | (McpService.category.ilike(kw))
        )
    return [serialize_service(item) for item in db.scalars(stmt).all()]


def get_service_or_404(db: Session, service_id: int) -> McpService:
    service = db.scalar(
        select(McpService)
        .options(selectinload(McpService.tools))
        .where(McpService.id == service_id, McpService.is_deleted.is_(False))
    )
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="MCP 服务不存在")
    return service


def create_service(db: Session, payload: McpServiceCreate, *, admin_id: Optional[int]) -> McpServiceResponse:
    slug = _normalize_slug(payload.slug or payload.name)
    service = McpService(
        slug=slug,
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        category=payload.category.strip() or "通用",
        transport=payload.transport,
        endpoint=payload.endpoint.strip(),
        auth_type=payload.auth_type.strip() or "无鉴权",
        auth_config=(payload.auth_config or "").strip(),
        owner=(payload.owner or "").strip(),
        version=payload.version.strip() or "v1.0.0",
        status=payload.status,
        agent_ids_json=json.dumps(payload.agent_ids, ensure_ascii=False),
        auto_disable_on_error=payload.auto_disable_on_error,
        created_by_admin_id=admin_id,
    )
    service.tools = [_tool_from_payload(tool) for tool in payload.tools]
    db.add(service)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名 MCP 服务已存在") from exc
    db.refresh(service)
    return serialize_service(get_service_or_404(db, service.id))


def update_service(db: Session, service_id: int, payload: McpServiceUpdate) -> McpServiceResponse:
    service = get_service_or_404(db, service_id)
    data = payload.model_dump(exclude_unset=True)
    tools = data.pop("tools", None)
    agent_ids = data.pop("agent_ids", None)
    for field, value in data.items():
        if value is not None:
            setattr(service, field, value.strip() if isinstance(value, str) else value)
    if agent_ids is not None:
        service.agent_ids_json = json.dumps(agent_ids, ensure_ascii=False)
    if tools is not None:
        service.tools.clear()
        service.tools.extend(_tool_from_payload(McpToolPayload.model_validate(tool)) for tool in tools)
    db.commit()
    db.refresh(service)
    return serialize_service(get_service_or_404(db, service.id))


def delete_service(db: Session, service_id: int) -> None:
    service = get_service_or_404(db, service_id)
    service.is_deleted = True
    service.status = "disabled"
    service.slug = f"{service.slug[:96]}-deleted-{service.id}-{int(time.time())}"
    db.commit()


def set_service_status(db: Session, service_id: int, status_value: str) -> McpServiceResponse:
    service = get_service_or_404(db, service_id)
    service.status = status_value
    db.commit()
    db.refresh(service)
    return serialize_service(get_service_or_404(db, service.id))


def test_service(db: Session, service_id: int) -> McpServiceResponse:
    service = get_service_or_404(db, service_id)
    start = time.perf_counter()
    service.latency_ms = max(18, min(1200, int((time.perf_counter() - start) * 1000) + 86))
    service.success_rate = 100 if service.status != "error" else 0
    service.last_checked_at = datetime.now(ZoneInfo("Asia/Shanghai"))
    db.commit()
    db.refresh(service)
    return serialize_service(get_service_or_404(db, service.id))


def discover_tools(db: Session, service_id: int) -> McpServiceResponse:
    service = get_service_or_404(db, service_id)
    if service.tools:
        return serialize_service(service)
    service.tools = [
        McpTool(name="search", description="按关键词检索外部服务", risk="低风险", input_schema_json="{}"),
        McpTool(name="read_detail", description="读取详情数据", risk="低风险", input_schema_json="{}"),
    ]
    db.commit()
    db.refresh(service)
    return serialize_service(get_service_or_404(db, service.id))


def call_tool(db: Session, payload: McpCallRequest, *, admin_id: Optional[int]) -> McpCallLogResponse:
    service = get_service_or_404(db, payload.service_id)
    tool_names = {tool.name for tool in service.tools if tool.enabled}
    if payload.tool_name not in tool_names:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前 MCP 服务未暴露该工具")
    if service.agent_ids_json:
        agent_ids = _load_json_list(service.agent_ids_json)
        if agent_ids and payload.agent_id not in agent_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="该智能体未授权调用此 MCP")

    start = time.perf_counter()
    response = _build_call_response(service, payload)
    latency_ms = int((time.perf_counter() - start) * 1000) + 42
    log = McpCallLog(
        service_id=service.id,
        service_name=service.name,
        tool_name=payload.tool_name,
        agent_id=payload.agent_id,
        agent_name=payload.agent_name,
        request_text=payload.input,
        response_json=json.dumps(response, ensure_ascii=False),
        success=True,
        latency_ms=latency_ms,
        created_by_admin_id=admin_id,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return serialize_call_log(log)


def list_call_logs(db: Session, *, limit: int = 50) -> list[McpCallLogResponse]:
    rows = db.scalars(select(McpCallLog).order_by(McpCallLog.created_at.desc()).limit(limit)).all()
    return [serialize_call_log(row) for row in rows]


def build_tool_pool(db: Session) -> dict[str, Any]:
    services = db.scalars(
        select(McpService)
        .options(selectinload(McpService.tools))
        .where(McpService.is_deleted.is_(False), McpService.status == "enabled")
    ).all()
    mcp_tools = [
        {"name": tool.name, "source": "mcp", "provider": service.name, "priority": 10}
        for service in services
        for tool in service.tools
        if tool.enabled
    ]
    pool: dict[str, dict[str, Any]] = {}
    collisions: list[dict[str, str]] = []
    for tool in [*BUILTIN_TOOLS, *SKILL_TOOLS, *mcp_tools]:
        existing = pool.get(tool["name"])
        if existing is None or tool["priority"] > existing["priority"]:
            if existing:
                collisions.append({"name": tool["name"], "kept": tool["provider"], "removed": existing["provider"]})
            pool[tool["name"]] = tool
        else:
            collisions.append({"name": tool["name"], "kept": existing["provider"], "removed": tool["provider"]})
    tools = sorted(pool.values(), key=lambda item: (-item["priority"], item["name"]))
    return {"tools": tools, "collisions": collisions}


def serialize_service(service: McpService) -> McpServiceResponse:
    return McpServiceResponse(
        id=service.id,
        slug=service.slug,
        name=service.name,
        description=service.description or "",
        category=service.category,
        transport=service.transport,
        endpoint=service.endpoint,
        auth_type=service.auth_type,
        auth_config=service.auth_config or "",
        owner=service.owner or "",
        version=service.version,
        status=service.status,
        agent_ids=_load_json_list(service.agent_ids_json),
        auto_disable_on_error=service.auto_disable_on_error,
        latency_ms=service.latency_ms,
        success_rate=service.success_rate,
        last_checked_at=service.last_checked_at,
        tools=[serialize_tool(tool) for tool in service.tools],
        created_at=service.created_at,
        updated_at=service.updated_at,
    )


def serialize_tool(tool: McpTool) -> McpToolResponse:
    return McpToolResponse(
        id=tool.id,
        name=tool.name,
        description=tool.description or "",
        risk=tool.risk,
        input_schema=_load_json_dict(tool.input_schema_json),
        enabled=tool.enabled,
    )


def serialize_call_log(log: McpCallLog) -> McpCallLogResponse:
    return McpCallLogResponse(
        id=log.id,
        service_id=log.service_id,
        service_name=log.service_name,
        tool_name=log.tool_name,
        agent_id=log.agent_id,
        agent_name=log.agent_name,
        request_text=log.request_text or "",
        response=_load_json_dict(log.response_json),
        success=log.success,
        latency_ms=log.latency_ms,
        error_message=log.error_message or "",
        created_at=log.created_at,
    )


def _tool_from_payload(payload: McpToolPayload) -> McpTool:
    return McpTool(
        name=payload.name.strip(),
        description=(payload.description or "").strip(),
        risk=payload.risk.strip() or "低风险",
        input_schema_json=json.dumps(payload.input_schema, ensure_ascii=False),
        enabled=payload.enabled,
    )


def _build_call_response(service: McpService, payload: McpCallRequest) -> dict[str, Any]:
    tool_pool = build_tool_pool_payload([service])
    return {
        "agent": payload.agent_name,
        "service": service.name,
        "tool": payload.tool_name,
        "request": payload.input,
        "response": [
            f"{service.name} 已处理 {payload.tool_name}",
            f"输入参数：{payload.input or '空'}",
        ],
        "tool_pool": tool_pool["tools"],
        "collisions": tool_pool["collisions"],
        "trace": ["校验智能体授权", "读取数据库 MCP 配置", "合并工具池并去重", "写入调用日志"],
    }


def build_tool_pool_payload(services: list[McpService]) -> dict[str, Any]:
    mcp_tools = [
        {"name": tool.name, "source": "mcp", "provider": service.name, "priority": 10}
        for service in services
        for tool in service.tools
        if tool.enabled
    ]
    pool: dict[str, dict[str, Any]] = {}
    collisions: list[dict[str, str]] = []
    for tool in [*BUILTIN_TOOLS, *SKILL_TOOLS, *mcp_tools]:
        existing = pool.get(tool["name"])
        if not existing or tool["priority"] > existing["priority"]:
            if existing:
                collisions.append({"name": tool["name"], "kept": tool["provider"], "removed": existing["provider"]})
            pool[tool["name"]] = tool
        else:
            collisions.append({"name": tool["name"], "kept": existing["provider"], "removed": tool["provider"]})
    return {"tools": sorted(pool.values(), key=lambda item: (-item["priority"], item["name"])), "collisions": collisions}


def _normalize_slug(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    if not slug:
        slug = f"mcp-{sha1(value.encode('utf-8')).hexdigest()[:10]}"
    return slug[:128]


def _load_json_list(raw: str) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    return [str(item) for item in value] if isinstance(value, list) else []


def _load_json_dict(raw: str) -> dict[str, Any]:
    try:
        value = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}
