from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class AgentSessionCreate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=128)
    agent_type: str = Field(default="resume", max_length=32)
    active_resume_id: Optional[int] = None


class AgentMessageRequest(BaseModel):
    content: str = Field(default="", max_length=12000)
    model_id: Optional[int] = None
    reasoning_effort: Literal["low", "medium", "high", "xhigh"] = "medium"
    attachment_ids: list[int] = Field(default_factory=list, max_length=12)


class AgentModelOptionResponse(BaseModel):
    id: int
    display_name: str
    provider: str
    model_identifier: str
    capability: str
    context_length: int | None
    default_temp: float | None
    max_output: int | None
    timeout_sec: int | None
    supported_efforts: list[str] = ["low", "medium", "high"]
    model_config = {"from_attributes": True}


class AgentSessionResponse(BaseModel):
    id: int
    title: str
    status: str
    agent_type: str = "resume"
    active_resume_id: Optional[int] = None
    jd_text: Optional[str] = None
    memory_json: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


class AgentMessageResponse(BaseModel):
    id: int
    session_id: int
    role: str
    content: str
    model_name: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    duration_ms: int | None = None
    created_at: datetime
    model_config = {"from_attributes": True}


class AgentActivityResponse(BaseModel):
    id: int
    session_id: int
    message_id: int | None
    kind: str
    name: str
    status: str
    summary: str | None
    display_summary: str | None = None
    detail: dict[str, Any]
    started_at: datetime
    completed_at: datetime | None


class AgentAttachmentResponse(BaseModel):
    id: int
    session_id: int
    message_id: int | None
    original_name: str
    content_type: str
    file_ext: str
    file_size: int
    status: str
    created_at: datetime
    download_url: str | None = None
    model_config = {"from_attributes": True}


class AgentHistoryResponse(BaseModel):
    session: AgentSessionResponse
    messages: list[AgentMessageResponse]
    activities: list[AgentActivityResponse]
    attachments: list[AgentAttachmentResponse] = Field(default_factory=list)
