from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class InterviewStartRequest(BaseModel):
    target_role: str = Field(default="Java 后端开发工程师", max_length=128)
    job_description: Optional[str] = None
    interview_type: str = Field(default="technical", max_length=32)
    interview_style: str = Field(default="strict", max_length=32)
    difficulty: str = Field(default="normal", max_length=32)
    round_limit: int = Field(default=8, ge=3, le=20)
    model_id: Optional[int] = None


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
    created_at: str | None = None
