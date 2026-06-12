"""Student resume revision history model.

Snapshots the resume state before each AI-driven update so we can roll back.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.infra.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class StudentResumeRevision(TimestampMixin, Base):
    __tablename__ = "student_resume_revision"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    resume_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    data_json: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(128), nullable=False)
    template_id: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="ai_update")
    session_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    message_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
