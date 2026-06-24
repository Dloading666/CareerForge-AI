from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base


class VisionModelConfig(Base):
    """视觉模型配置 — 每个 tenant 一行，upsert 模式。

    供学生对话里的 understand_image 工具调用：当主模型不支持图片输入时，
    用这里配置的视觉模型理解图片内容。配置在管理端「视觉配置」页填写。
    """

    __tablename__ = "vision_model_config"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_vision_model_config_tenant"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)

    # 总开关：关闭后 understand_image 工具不会调用视觉模型
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # 接口协议：openai（/chat/completions）| anthropic（/v1/messages）
    protocol: Mapped[str] = mapped_column(String(16), default="openai", nullable=False)
    # 视觉模型的接口地址，如 https://api.openai.com/v1
    base_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    # 模型标识符，如 gpt-4o / claude-3-5-sonnet-20241022
    model_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # Fernet 加密后的 API Key（从不存明文）
    api_key_cipher: Mapped[Optional[str]] = mapped_column(String(1024), nullable=True)
    # 视觉描述输出 token 上限（与各模型 max_output 取小）
    max_tokens: Mapped[int] = mapped_column(Integer, default=1024, nullable=False)

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
