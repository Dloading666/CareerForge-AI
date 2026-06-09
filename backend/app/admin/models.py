"""妯″瀷骞垮満 + 绯荤粺璁剧疆 鈥?SQLAlchemy 妯″瀷"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

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
    capability: Mapped[str] = mapped_column(String(32), nullable=False, default="text")
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



class Announcement(TimestampMixin, Base):
    """公告"""
    __tablename__ = "announcements"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(256), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    announcement_type: Mapped[str] = mapped_column(String(16), nullable=False, default="info")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
class Agent(TimestampMixin, Base):
    __tablename__ = "agent"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False, default="other")
    icon_name: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, default="smart_toy")
    icon_color_from: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, default="#7C4DFF")
    icon_color_to: Mapped[Optional[str]] = mapped_column(String(16), nullable=True, default="#2962FF")
    model_config_id: Mapped[Optional[int]] = mapped_column(ForeignKey("model_config.id"), nullable=True)
    model_config: Mapped[Optional[ModelConfig]] = relationship("ModelConfig", lazy="joined")
    welcome_message: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    suggested_questions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prompt_variables: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    system_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    temperature: Mapped[float] = mapped_column(Float, nullable=False, default=0.7)
    max_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=4096)
    top_p: Mapped[float] = mapped_column(Float, nullable=False, default=0.9)
    frequency_penalty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    presence_penalty: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    memory_window: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    is_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    use_dify: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dify_api_key_cipher: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    dify_api_base_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
