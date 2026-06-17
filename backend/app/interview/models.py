from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, func
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
    interview_mode: Mapped[str] = mapped_column(String(16), nullable=False, default="text", server_default="text")
    model_config_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")
    resume_snapshot: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 岗位画像
    company_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    seniority_level: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    job_skills_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    job_profile_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 阶段状态机
    current_stage: Mapped[str] = mapped_column(String(32), nullable=False, default="opening")
    stage_plan_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    coverage_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    __table_args__ = (
        UniqueConstraint("session_id", "turn_index", name="uq_interview_turn_session_turn_index"),
    )

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
    # 阶段 + 检索解释性 + 评分可解释性
    stage: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    question_type: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    question_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    capability_tags_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retrieval_query: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retrieval_hit_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    top_sources_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    score_reasons_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    evidence_quotes_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # 幂等保护：记录提交请求 ID，防止重复提交
    submit_request_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
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
    # 训练闭环
    training_plan_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rewrite_examples_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    next_session_preset_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
