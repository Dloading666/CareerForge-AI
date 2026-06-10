"""模型广场 + 系统设置 — Pydantic Schemas"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ModelListQuery(BaseModel):
    capability: Optional[str] = None
    status: Optional[str] = None
    open_to_student: Optional[bool] = None
    keyword: Optional[str] = None
    page: int = Field(default=1, ge=1)
    size: int = Field(default=20, ge=1, le=100)


class ModelCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=128)
    provider: str = Field(min_length=1, max_length=64)
    deploy_type: str = Field(default="cloud", max_length=32)
    capability: str = Field(default="chat", max_length=32)
    protocols: str = Field(default="openai", max_length=256)
    base_url: str = Field(min_length=1, max_length=512)
    api_key: Optional[str] = Field(default=None, max_length=512)
    model_identifier: str = Field(min_length=1, max_length=256)
    dify_model_ref: Optional[str] = Field(default=None, max_length=128)
    context_length: Optional[int] = None
    default_temp: Optional[float] = 0.7
    max_output: Optional[int] = 4096
    timeout_sec: Optional[int] = 30
    open_to_student: bool = False


class ModelUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    provider: Optional[str] = Field(default=None, min_length=1, max_length=64)
    deploy_type: Optional[str] = Field(default=None, max_length=32)
    capability: Optional[str] = Field(default=None, max_length=32)
    protocols: Optional[str] = Field(default=None, max_length=256)
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=512)
    api_key: Optional[str] = Field(default=None, max_length=512)
    model_identifier: Optional[str] = Field(default=None, min_length=1, max_length=256)
    dify_model_ref: Optional[str] = Field(default=None, max_length=128)
    context_length: Optional[int] = None
    default_temp: Optional[float] = None
    max_output: Optional[int] = None
    timeout_sec: Optional[int] = None
    open_to_student: Optional[bool] = None
    status: Optional[str] = None


class ModelToggleOpen(BaseModel):
    open: bool


class ModelResponse(BaseModel):
    id: int; tenant_id: int; display_name: str; provider: str; deploy_type: str
    capability: str; protocols: str; base_url: str; api_key_cipher: Optional[str] = None
    model_identifier: str; dify_model_ref: Optional[str] = None
    context_length: Optional[int] = None; default_temp: Optional[float] = None
    max_output: Optional[int] = None; timeout_sec: Optional[int] = None
    open_to_student: bool; status: str; is_deleted: bool
    created_at: datetime; updated_at: datetime
    model_config = {"from_attributes": True}


class ModelTestResponse(BaseModel):
    success: bool; latency_ms: Optional[int] = None; error_message: Optional[str] = None
    model_id: int; tested_at: datetime
    http_status: Optional[int] = None
    response_body: Optional[str] = None
    request_url: Optional[str] = None
    error_summary: Optional[str] = None



# ── 公告管理 ─────────────────────────────────────

class AnnouncementCreate(BaseModel):
    title: str = Field(min_length=1, max_length=256)
    content: str = Field(min_length=1)
    announcement_type: str = Field(default="info", pattern=r"^(info|warning|success|error)$")
    priority: int = Field(default=0, ge=0, le=99)
    is_active: bool = True
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=256)
    content: Optional[str] = None
    announcement_type: Optional[str] = Field(default=None, pattern=r"^(info|warning|success|error)$")
    priority: Optional[int] = Field(default=None, ge=0, le=99)
    is_active: Optional[bool] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None


class AnnouncementResponse(BaseModel):
    id: int
    title: str
    content: str
    announcement_type: str
    priority: int
    is_active: bool
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class AnnouncementListResponse(BaseModel):
    list: list[AnnouncementResponse]
    total: int


class SystemConfigItem(BaseModel):
    config_key: str; config_value: str | None = None


class SystemConfigUpdate(BaseModel):
    items: list[SystemConfigItem]
