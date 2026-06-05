from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator


McpStatus = Literal["enabled", "disabled", "error"]
McpTransport = Literal["stdio", "SSE", "Streamable HTTP"]


class McpToolPayload(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = Field(default="", max_length=1000)
    risk: str = Field(default="低风险", max_length=32)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class McpServiceCreate(BaseModel):
    slug: Optional[str] = Field(default=None, min_length=2, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = Field(default="", max_length=2000)
    category: str = Field(default="通用", max_length=64)
    transport: McpTransport = "Streamable HTTP"
    endpoint: str = Field(min_length=1, max_length=512)
    auth_type: str = Field(default="无鉴权", max_length=64)
    auth_config: Optional[str] = Field(default="", max_length=2000)
    owner: Optional[str] = Field(default="", max_length=128)
    version: str = Field(default="v1.0.0", max_length=32)
    status: McpStatus = "enabled"
    agent_ids: list[str] = Field(default_factory=list, max_length=20)
    auto_disable_on_error: bool = True
    tools: list[McpToolPayload] = Field(default_factory=list, max_length=50)

    @field_validator("agent_ids")
    @classmethod
    def clean_agent_ids(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for item in values:
            value = item.strip()
            if value and value not in cleaned:
                cleaned.append(value[:128])
        return cleaned


class McpServiceUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    category: Optional[str] = Field(default=None, max_length=64)
    transport: Optional[McpTransport] = None
    endpoint: Optional[str] = Field(default=None, min_length=1, max_length=512)
    auth_type: Optional[str] = Field(default=None, max_length=64)
    auth_config: Optional[str] = Field(default=None, max_length=2000)
    owner: Optional[str] = Field(default=None, max_length=128)
    version: Optional[str] = Field(default=None, max_length=32)
    status: Optional[McpStatus] = None
    agent_ids: Optional[list[str]] = Field(default=None, max_length=20)
    auto_disable_on_error: Optional[bool] = None
    tools: Optional[list[McpToolPayload]] = Field(default=None, max_length=50)

    @field_validator("agent_ids")
    @classmethod
    def clean_agent_ids(cls, values: Optional[list[str]]) -> Optional[list[str]]:
        if values is None:
            return None
        cleaned: list[str] = []
        for item in values:
            value = item.strip()
            if value and value not in cleaned:
                cleaned.append(value[:128])
        return cleaned


class McpStatusRequest(BaseModel):
    status: McpStatus


class McpCallRequest(BaseModel):
    service_id: int
    tool_name: str = Field(min_length=1, max_length=128)
    agent_id: str = Field(min_length=1, max_length=128)
    agent_name: str = Field(min_length=1, max_length=128)
    input: str = Field(default="", max_length=4000)


class McpToolResponse(BaseModel):
    id: int
    name: str
    description: str
    risk: str
    input_schema: dict[str, Any]
    enabled: bool


class McpServiceResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    category: str
    transport: str
    endpoint: str
    auth_type: str
    auth_config: str
    owner: str
    version: str
    status: str
    agent_ids: list[str]
    auto_disable_on_error: bool
    latency_ms: Optional[int]
    success_rate: Optional[int]
    last_checked_at: Optional[datetime]
    tools: list[McpToolResponse]
    created_at: datetime
    updated_at: datetime


class McpCallLogResponse(BaseModel):
    id: int
    service_id: Optional[int]
    service_name: str
    tool_name: str
    agent_id: str
    agent_name: str
    request_text: str
    response: dict[str, Any]
    success: bool
    latency_ms: Optional[int]
    error_message: str
    created_at: datetime
