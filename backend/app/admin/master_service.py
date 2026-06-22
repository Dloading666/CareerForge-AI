from __future__ import annotations

from typing import Literal, Optional

from fastapi import HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.master_models import MasterAgentConfig, MasterRouteRule


# ── Pydantic Schemas ─────────────────────────────────────────────────


class MasterConfigResponse(BaseModel):
    id: int
    tenant_id: int
    model_id: Optional[int]
    system_prompt: Optional[str]
    temperature: Optional[float]
    max_tokens: Optional[int]
    max_iterations: int
    permission_mode: str
    memory_isolation: bool
    model_passthrough: bool
    fallback_mode: str
    fallback_message: Optional[str]
    model_config = {"from_attributes": True}


class MasterConfigUpdate(BaseModel):
    model_id: Optional[int] = None
    system_prompt: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=128000)
    max_iterations: Optional[int] = Field(default=None, ge=1, le=100)
    permission_mode: Optional[Literal["ask", "auto", "strict"]] = None
    memory_isolation: Optional[bool] = None
    model_passthrough: Optional[bool] = None
    fallback_mode: Optional[Literal["direct_answer", "guide_message", "error"]] = None
    fallback_message: Optional[str] = None


class RouteRuleResponse(BaseModel):
    id: int
    tenant_id: int
    intent: str
    target_agent_key: str
    target_agent_name: str
    target_provider: str
    provider_config_json: Optional[str]
    memory_strategy: str
    priority: int
    enabled: bool
    model_config = {"from_attributes": True}


class RouteRuleCreate(BaseModel):
    intent: str = Field(min_length=1, max_length=256)
    target_agent_key: str = Field(min_length=1, max_length=64)
    target_agent_name: str = Field(min_length=1, max_length=128)
    target_provider: Literal["builtin", "dify"] = "builtin"
    provider_config_json: Optional[str] = None
    memory_strategy: Literal["isolated", "passthrough", "summary_only"] = "isolated"
    priority: int = Field(default=0)
    enabled: bool = True


class RouteRuleUpdate(BaseModel):
    intent: Optional[str] = Field(default=None, min_length=1, max_length=256)
    target_agent_key: Optional[str] = Field(default=None, min_length=1, max_length=64)
    target_agent_name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    target_provider: Optional[Literal["builtin", "dify"]] = None
    provider_config_json: Optional[str] = None
    memory_strategy: Optional[Literal["isolated", "passthrough", "summary_only"]] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None


# ── 默认配置 ─────────────────────────────────────────────────────────

DEFAULT_SYSTEM_PROMPT = (
    "你是 CareerForge 的主智能体（Coordinator），负责理解学生的就业需求并调度合适的子智能体完成任务。\n\n"
    "你的工作方式（ReAct 范式）：\n"
    "1. Reason：分析学生意图，判断需要调用哪个子智能体工具\n"
    "2. Act：调用对应子智能体，传递清晰的任务描述\n"
    "3. Observe：接收子智能体返回的 <task-notification> 结果\n"
    "4. 重复或综合：继续调度或直接向学生输出最终回答\n\n"
    "原则：\n"
    "- 只做调度和综合，不替代子智能体执行专业任务\n"
    "- 子智能体记忆独立隔离，仅结果摘要回流主对话\n"
    "- 无合适子智能体时，直接以友好方式回答学生"
)

# ── Master Config Service ────────────────────────────────────────────


def get_or_create_master_config(db: Session, tenant_id: int = 0) -> MasterConfigResponse:
    row = db.scalar(
        select(MasterAgentConfig).where(MasterAgentConfig.tenant_id == tenant_id)
    )
    if row is None:
        row = MasterAgentConfig(
            tenant_id=tenant_id,
            system_prompt=DEFAULT_SYSTEM_PROMPT,
            max_iterations=10,
            permission_mode="ask",
            memory_isolation=True,
            model_passthrough=True,
            fallback_mode="direct_answer",
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return MasterConfigResponse.model_validate(row)


def update_master_config(
    db: Session, payload: MasterConfigUpdate, tenant_id: int = 0
) -> MasterConfigResponse:
    from app.admin.models import ModelConfig
    from app.student.agent_runtime import CHAT_CAPABLE_CAPABILITIES, TTS_CAPABLE_CAPABILITIES
    from fastapi import HTTPException, status
    data = payload.model_dump(exclude_unset=True)
    model_id = data.get("model_id")
    if model_id:
        model = db.get(ModelConfig, model_id)
        if not model:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所选模型不存在")
        if model.capability in TTS_CAPABLE_CAPABILITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="主智能体不可使用 TTS 模型")
        if model.capability not in CHAT_CAPABLE_CAPABILITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="主智能体仅可使用文本/多模态模型")
    row = db.scalar(
        select(MasterAgentConfig).where(MasterAgentConfig.tenant_id == tenant_id)
    )
    if row is None:
        row = MasterAgentConfig(tenant_id=tenant_id, system_prompt=DEFAULT_SYSTEM_PROMPT)
        db.add(row)

    for field, value in data.items():
        setattr(row, field, value)

    db.commit()
    db.refresh(row)
    return MasterConfigResponse.model_validate(row)


# ── Route Rules Service ──────────────────────────────────────────────


def list_routes(db: Session, tenant_id: int = 0) -> list[RouteRuleResponse]:
    rows = db.scalars(
        select(MasterRouteRule)
        .where(MasterRouteRule.tenant_id == tenant_id)
        .order_by(MasterRouteRule.priority.desc(), MasterRouteRule.id.asc())
    ).all()
    return [RouteRuleResponse.model_validate(r) for r in rows]


def create_route(
    db: Session, payload: RouteRuleCreate, tenant_id: int = 0
) -> RouteRuleResponse:
    row = MasterRouteRule(
        tenant_id=tenant_id,
        intent=payload.intent,
        target_agent_key=payload.target_agent_key,
        target_agent_name=payload.target_agent_name,
        target_provider=payload.target_provider,
        provider_config_json=payload.provider_config_json,
        memory_strategy=payload.memory_strategy,
        priority=payload.priority,
        enabled=payload.enabled,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return RouteRuleResponse.model_validate(row)


def _get_route_or_404(db: Session, route_id: int, tenant_id: int = 0) -> MasterRouteRule:
    row = db.scalar(
        select(MasterRouteRule).where(
            MasterRouteRule.id == route_id,
            MasterRouteRule.tenant_id == tenant_id,
        )
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="路由规则不存在")
    return row


def update_route(
    db: Session, route_id: int, payload: RouteRuleUpdate, tenant_id: int = 0
) -> RouteRuleResponse:
    row = _get_route_or_404(db, route_id, tenant_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return RouteRuleResponse.model_validate(row)


def delete_route(db: Session, route_id: int, tenant_id: int = 0) -> None:
    row = _get_route_or_404(db, route_id, tenant_id)
    db.delete(row)
    db.commit()
