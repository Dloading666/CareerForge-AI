from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Request schemas ───────────────────────────────────────────────────────────


class InterviewStartRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "target_role": "后端开发工程师",
                    "interview_type": "first_round",
                    "interview_style": "strict",
                    "round_limit": 8,
                }
            ]
        }
    )

    target_role: str = Field(
        min_length=1, max_length=128, description="目标岗位，必填"
    )
    job_description: str = Field(
        min_length=1, description="岗位 JD，必填"
    )
    interview_type: Literal["first_round", "second_round"] = Field(
        default="first_round", max_length=64, description="面试类型：first_round / second_round"
    )
    interview_style: str = Field(
        default="strict", max_length=32, description="面试风格"
    )
    difficulty: str = Field(
        default="normal", max_length=32, description="难度"
    )
    round_limit: int = Field(
        default=8, ge=3, le=20, description="面试轮数"
    )
    model_id: Optional[int] = Field(
        default=None, description="指定模型 ID，选填"
    )
    resume_source: str = Field(
        default="online", max_length=16, description="简历来源：online / upload"
    )
    resume_id: Optional[int] = Field(
        default=None, description="指定在线简历 ID（选填，不填则自动选最新可读取简历）"
    )
    uploaded_resume_text: Optional[str] = Field(
        default=None, description="上传简历的提取文本"
    )
    focus_tags: list[str] = Field(
        default_factory=list, description="面试重点标签"
    )
    custom_instruction: Optional[str] = Field(
        default=None, max_length=800, description="自定义要求"
    )
    request_id: Optional[str] = Field(
        default=None, max_length=80, description="前端生成的进度追踪 ID"
    )
    reasoning_effort: Optional[str] = Field(
        default=None, max_length=16, description="推理深度：low / medium / high"
    )
    # 岗位画像
    company_name: Optional[str] = Field(
        default=None, max_length=128, description="公司名称"
    )
    seniority_level: Optional[str] = Field(
        default=None, max_length=32, description="级别"
    )
    job_skills: list[str] = Field(
        default_factory=list, description="岗位核心技能"
    )
    interview_mode: str = Field(
        default="text", max_length=16, description="面试模式：text / voice"
    )


class InterviewTurnRequest(BaseModel):
    model_config = ConfigDict(
        json_schema_extra={"examples": [{"answer": "我用 Redis 做缓存...", "turn_id": 1, "request_id": "550e8400-e29b-41d4-a716-446655440000"}]}
    )

    answer: str = Field(min_length=1, description="候选人回答")
    request_id: str | None = Field(default=None, max_length=80, description="幂等请求 ID，由前端 crypto.randomUUID() 生成")
    turn_id: int | None = Field(default=None, description="当前正在回答的问题 ID")


# ── Response schemas ──────────────────────────────────────────────────────────


class InterviewSessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_role: str
    interview_type: str
    interview_style: str
    difficulty: str
    round_limit: int
    model_config_id: int | None = None
    interview_mode: str = "text"
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
    model_config = ConfigDict(from_attributes=True)

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


class VoiceTranscript(BaseModel):
    """语音转写结果。"""
    text: str = Field(description="转写文本")
    language: str = Field(default="zh-CN", description="识别语言")
    confidence: float = Field(default=0.0, description="置信度 0-1")


class VoiceTurnResponse(BaseModel):
    """语音面试回答响应。"""
    transcript: VoiceTranscript
    turn_result: InterviewSubmitResponse


class InterviewReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class VoiceReplyResponse(BaseModel):
    """面试官问题 TTS 响应。"""
    mode: str = Field(description="TTS 模式：server_tts / browser_tts")
    text: str = Field(description="问题文本")
    audio_base64: str | None = Field(default=None, description="服务端 TTS 音频 base64")
    content_type: str | None = Field(default=None, description="音频 MIME 类型")
    provider: str | None = Field(default=None, description="TTS 提供商")
    reason: str | None = Field(default=None, description="降级原因")
    turn_id: int
    question_text: str = Field(description="问题文本，供前端 TTS 朗读")
    turn_index: int
