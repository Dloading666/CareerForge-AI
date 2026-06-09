from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class ResumeSummaryResponse(BaseModel):
    id: int
    title: str
    templateId: str
    visibility: bool
    updatedAt: datetime
    createdAt: datetime


class ResumeDetailResponse(BaseModel):
    id: int
    title: str
    templateId: str
    visibility: bool
    data: dict[str, Any]
    updatedAt: datetime
    createdAt: datetime


class ResumeCreateRequest(BaseModel):
    title: Optional[str] = None
    templateId: Optional[str] = Field(default=None, min_length=1)
    visibility: bool = False
    data: Optional[dict[str, Any]] = None


class ResumeUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=128)
    templateId: str = Field(min_length=1, max_length=64)
    visibility: bool
    data: dict[str, Any]


class ResumeImportRequest(BaseModel):
    title: Optional[str] = None
    templateId: Optional[str] = Field(default=None, min_length=1)
    visibility: bool = False
    data: dict[str, Any]
