from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator


SkillStatus = Literal["enabled", "disabled"]


class SkillCreateRequest(BaseModel):
    slug: Optional[str] = Field(default=None, min_length=2, max_length=128)
    name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    version: Optional[str] = Field(default=None, max_length=32)
    category: Optional[str] = Field(default=None, max_length=64)
    tags: list[str] = Field(default_factory=list, max_length=20)
    status: SkillStatus = "enabled"
    file_name: str = Field(default="SKILL.md", min_length=1, max_length=255)
    content: str = Field(min_length=1)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, tags: list[str]) -> list[str]:
        cleaned: list[str] = []
        for tag in tags:
            value = tag.strip()
            if value and value not in cleaned:
                cleaned.append(value[:32])
        return cleaned


class SkillUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=128)
    description: Optional[str] = Field(default=None, max_length=2000)
    version: Optional[str] = Field(default=None, max_length=32)
    category: Optional[str] = Field(default=None, max_length=64)
    tags: Optional[list[str]] = Field(default=None, max_length=20)
    status: Optional[SkillStatus] = None
    file_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    content: Optional[str] = Field(default=None, min_length=1)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, tags: Optional[list[str]]) -> Optional[list[str]]:
        if tags is None:
            return None
        cleaned: list[str] = []
        for tag in tags:
            value = tag.strip()
            if value and value not in cleaned:
                cleaned.append(value[:32])
        return cleaned


class SkillStatusRequest(BaseModel):
    status: SkillStatus


class SkillResponse(BaseModel):
    id: int
    slug: str
    name: str
    description: str
    version: str
    category: str
    tags: list[str]
    status: SkillStatus
    file_name: str
    content: str
    content_hash: str
    created_at: datetime
    updated_at: datetime
