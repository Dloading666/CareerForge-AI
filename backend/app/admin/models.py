"""模型广场 + 系统设置 — SQLAlchemy 模型"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ModelConfig(TimestampMixin, Base):
    __tablename__ = "model_config"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(default=0, nullable=False)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    deploy_type: Mapped[str] = mapped_column(String(32), nullable=False, default="cloud")
    capability: Mapped[str] = mapped_column(String(32), nullable=False, default="chat")
    protocols: Mapped[str] = mapped_column(String(256), nullable=False, default="openai")
    base_url: Mapped[str] = mapped_column(String(512), nullable=False)
    api_key_cipher: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    model_identifier: Mapped[str] = mapped_column(String(256), nullable=False)
    dify_model_ref: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    context_length: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    default_temp: Mapped[Optional[float]] = mapped_column(Float, nullable=True, default=0.7)
    max_output: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=4096)
    timeout_sec: Mapped[Optional[int]] = mapped_column(Integer, nullable=True, default=30)
    open_to_student: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ModelTestLog(Base):
    __tablename__ = "model_test_log"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    model_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    latency_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class SystemConfig(Base):
    __tablename__ = "system_config"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(default=0, nullable=False)
    config_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    config_value: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
