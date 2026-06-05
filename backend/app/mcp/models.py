from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infra.db import Base


class McpService(Base):
    __tablename__ = "mcp_service"
    __table_args__ = (UniqueConstraint("slug", name="uq_mcp_service_slug"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(default=0, nullable=False)
    slug: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    category: Mapped[str] = mapped_column(String(64), default="通用", nullable=False)
    transport: Mapped[str] = mapped_column(String(32), default="Streamable HTTP", nullable=False)
    endpoint: Mapped[str] = mapped_column(String(512), nullable=False)
    auth_type: Mapped[str] = mapped_column(String(64), default="无鉴权", nullable=False)
    auth_config: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    owner: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    version: Mapped[str] = mapped_column(String(32), default="v1.0.0", nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="enabled", nullable=False, index=True)
    agent_ids_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    auto_disable_on_error: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    success_rate: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_admin_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    tools: Mapped[list["McpTool"]] = relationship(
        back_populates="service",
        cascade="all, delete-orphan",
        order_by="McpTool.id",
    )


class McpTool(Base):
    __tablename__ = "mcp_tool"
    __table_args__ = (UniqueConstraint("service_id", "name", name="uq_mcp_tool_service_name"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("mcp_service.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    risk: Mapped[str] = mapped_column(String(32), default="低风险", nullable=False)
    input_schema_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    service: Mapped[McpService] = relationship(back_populates="tools")


class McpCallLog(Base):
    __tablename__ = "mcp_call_log"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    service_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    service_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    agent_name: Mapped[str] = mapped_column(String(128), nullable=False)
    request_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    response_json: Mapped[str] = mapped_column(Text, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_by_admin_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
