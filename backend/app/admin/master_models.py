from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base


class MasterAgentConfig(Base):
    """主智能体 Harness 配置 — 每个 tenant 一行，upsert 模式。"""

    __tablename__ = "master_agent_config"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_master_agent_config_tenant"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    # ── Model 层（认知）────────────────────────────────────────────
    model_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    temperature: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    max_tokens: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # ── Harness 层（管控）──────────────────────────────────────────
    # Agent Loop 最大轮次，Harness 硬边界，防止 ReAct 死循环
    max_iterations: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    # 全局四态权限默认模式：auto | ask | strict
    permission_mode: Mapped[str] = mapped_column(String(16), default="ask", nullable=False)
    # 子智能体记忆独立隔离（对应 Claude Code AsyncLocalStorage 隔离思路）
    memory_isolation: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 向被调用子智能体透传主智能体当前模型选择
    model_passthrough: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 兜底策略：direct_answer | guide_message | error
    fallback_mode: Mapped[str] = mapped_column(String(32), default="direct_answer", nullable=False)
    fallback_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MasterRouteRule(Base):
    """主智能体工具注册表 — 每条规则向 Model 暴露一个命名的子智能体工具。

    设计原则（来自 Claude Code AgentTool）：
    - intent 字段 = 工具描述，Model 在 ReAct 循环中自主决定何时调用
    - 不是 if-else 路由匹配，而是 Model 自主选择的工具池条目
    - 子智能体结果通过 <task-notification> 格式回流主对话
    """

    __tablename__ = "master_route_rule"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    # Model 读取此描述来决定何时调用该子智能体工具
    intent: Mapped[str] = mapped_column(String(256), nullable=False)
    # 子智能体标识符，对应 AgentTool 的 subagent_type
    target_agent_key: Mapped[str] = mapped_column(String(64), nullable=False)
    target_agent_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # builtin | dify. 后续扩展其他 Agent 平台时只增加 provider adapter。
    target_provider: Mapped[str] = mapped_column(String(32), default="builtin", nullable=False)
    provider_config_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # isolated | passthrough | summary_only
    memory_strategy: Mapped[str] = mapped_column(String(32), default="isolated", nullable=False)
    # 工具池中的排列顺序，数字越大越靠前
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
