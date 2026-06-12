from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class InterviewStartRequest(BaseModel):
    target_role: str = Field(min_length=1, max_length=128)
    job_description: Optional[str] = None
    interview_type: str = Field(default="technical", max_length=64)
    interview_style: str = Field(default="strict", max_length=32)
    difficulty: str = Field(default="normal", max_length=32)
    round_limit: int = Field(default=8, ge=3, le=20)
    model_id: Optional[int] = None
    resume_source: str = Field(default="online", max_length=16)
    uploaded_resume_text: Optional[str] = None
    focus_tags: list[str] = Field(default_factory=list)
    custom_instruction: Optional[str] = Field(default=None, max_length=800)
    # 岗位画像
    company_name: Optional[str] = Field(default=None, max_length=128)
    seniority_level: Optional[str] = Field(default=None, max_length=32)
    job_skills: list[str] = Field(default_factory=list)


class InterviewTurnRequest(BaseModel):
    answer: str = Field(min_length=1)


class InterviewSessionResponse(BaseModel):
    id: int
    target_role: str
    interview_type: str
    interview_style: str
    difficulty: str
    round_limit: int
    model_config_id: int | None = None
    status: str
    # 岗位画像
    company_name: str | None = None
    seniority_level: str | None = None
    job_skills: list[str] = []
    # 阶段状态机
    current_stage: str = "opening"
    created_at: str | None = None
    ended_at: str | None = None


class InterviewTurnResponse(BaseModel):
    id: int
    turn_index: int
    question: str
    answer: str | None = None
    answer_assessment: dict[str, Any] | None = None
    score: dict[str, int] | None = None
    followup_reason: str | None = None
    retrieved_chunks: list[dict[str, Any]] = []
    knowledge_points: list[str] = []
    # 阶段 + 检索解释性 + 评分可解释性
    stage: str | None = None
    question_type: str | None = None
    question_reason: str | None = None
    capability_tags: list[str] = []
    score_reasons: dict[str, str] = {}
    evidence_quotes: list[dict[str, Any]] = []
    top_sources: list[dict[str, Any]] = []


class InterviewStartResponse(BaseModel):
    session: InterviewSessionResponse
    first_turn: InterviewTurnResponse
    knowledge_status: dict[str, Any]


class InterviewSubmitResponse(BaseModel):
    current_turn: InterviewTurnResponse
    next_turn: InterviewTurnResponse | None = None
    is_finished: bool
    report_id: int | None = None


class InterviewReportResponse(BaseModel):
    id: int
    session_id: int
    overall_score: float
    dimension_scores: dict[str, float]
    strengths: list[str]
    weaknesses: list[str]
    suggestions: list[str]
    next_questions: list[str]
    comparison: dict[str, Any] | None = None
    report_text: str
    # 训练闭环
    training_plan: list[dict[str, Any]] = []
    rewrite_examples: list[dict[str, Any]] = []
    next_session_preset: dict[str, Any] = {}
    created_at: str | None = None
