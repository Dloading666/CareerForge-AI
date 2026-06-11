from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.infra.db import Base


class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    target_role: Mapped[str] = mapped_column(String(128), nullable=False)
    job_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    interview_type: Mapped[str] = mapped_column(String(32), nullable=False, default="technical")
    interview_style: Mapped[str] = mapped_column(String(32), nullable=False, default="strict")
    difficulty: Mapped[str] = mapped_column(String(32), nullable=False, default="normal")
    round_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=8)
    model_config_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    resume_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class InterviewTurn(Base):
    __tablename__ = "interview_turns"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    turn_index: Mapped[int] = mapped_column(Integer, nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    answer_assessment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    score_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    followup_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retrieved_chunks_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    knowledge_points_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class InterviewReport(Base):
    __tablename__ = "interview_reports"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    overall_score: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    dimension_scores_json: Mapped[str] = mapped_column(Text, nullable=False)
    strengths_json: Mapped[str] = mapped_column(Text, nullable=False)
    weaknesses_json: Mapped[str] = mapped_column(Text, nullable=False)
    suggestions_json: Mapped[str] = mapped_column(Text, nullable=False)
    next_questions_json: Mapped[str] = mapped_column(Text, nullable=False)
    comparison_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
