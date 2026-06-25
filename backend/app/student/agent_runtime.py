from __future__ import annotations

import base64
import json
import logging
import time
import mimetypes
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncIterator, Optional

import anyio
import difflib
import httpx
from fastapi import HTTPException, UploadFile, status
import re as _re

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.admin.master_service import get_or_create_master_config
from app.admin.model_service import decrypt_api_key
from app.admin.models import ModelConfig
from app.auth.models import StudentUser
from app.auth.service import AuthIdentity
from app.core.config import get_settings
from app.core.llm_client import is_anthropic_model
from app.skills.service import list_skills, serialize_skill
from app.student.agent_models import (
    StudentAgentActivity,
    StudentAgentAttachment,
    StudentAgentMessage,
    StudentAgentSession,
)
from app.student.revision_models import StudentResumeRevision
from app.student.agent_schemas import AgentActivityResponse, AgentAttachmentResponse, AgentModelOptionResponse
from app.student.profile_details_models import (
    StudentCertification,
    StudentEducation,
    StudentHonor,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.resume_models import StudentResume
from app.student.tool_validation import parse_tool_arguments

# ── Import from extracted modules (re-export for backward compatibility) ──
from app.student.agent_fact_guard import (  # noqa: E402
    FACT_GUARD_SHADOW_MODE,
    ITEM_ATTRIBUTION_SHADOW_MODE,
    EvidenceSourceIndex,
    FactWhitelist,
    SessionEvidencePool,
    _EMPTY_PHRASES,
    _ROLE_ESCALATION_LADDER,
    _ROLE_VERB_RE,
    _SINGLE_DATE_RE,
    _STRONG_VERBS,
    _TIME_RANGE_RE,
    _WEAK_ITEM_RATIO_THRESHOLD,
    _assess_evidence_quality,
    _check_gap_violations,
    _check_item_attribution,
    _check_jd_coverage,
    _check_resume_quality,
    _check_role_escalation,
    _collect_evidence_values,
    _extract_candidate_facts,
    _extract_fact_whitelist,
    _extract_keywords_from_text,
    _fact_guard_failure,
    _fact_values_from_args,
    _flatten_dict_values,
    _is_chinese_noun,
    _norm_time_token,
    _norm_token,
    _noun_has_source,
    _validate_resume_facts,
)
from app.student.agent_utils import (  # noqa: E402
    _AUTO_HIGH_KEYWORDS,
    _AUTO_LOW_PATTERNS,
    _AUTO_XHIGH_KEYWORDS,
    _MODEL_TEMP_MAP,
    _configured_fallback_answer,
    _effort_instruction,
    _fallback_answer,
    _looks_like_jd,
    _supports_reasoning_effort,
    auto_classify_effort,
    classify_intent,
    get_model_default_temperature,
    get_model_effort_config,
)

logger = logging.getLogger(__name__)


def _humanize_llm_error(exc: Exception | str) -> str:
    """将 LLM 调用异常翻译为面向用户的中文提示。"""
    msg = str(exc)
    if "429" in msg or "rate_limit" in msg.lower() or "rate limit" in msg.lower() or "too many requests" in msg.lower():
        return "模型当前使用人数较多，请稍后再试"
    if "401" in msg or "403" in msg or "authentication" in msg.lower() or "invalid api key" in msg.lower() or "permission" in msg.lower():
        return "模型密钥配置有误，请联系管理员"
    if "408" in msg or "timeout" in msg.lower() or "timed out" in msg.lower():
        return "模型响应超时，请稍后重试"
    if any(code in msg for code in ("500", "502", "503", "504")) or "overloaded" in msg.lower() or "server error" in msg.lower():
        return "模型服务暂时不可用，请稍后再试"
    if "connection" in msg.lower() or "refused" in msg.lower() or "eof" in msg.lower():
        return "无法连接模型服务，请稍后重试"
    return "模型暂时无法回复，请稍后重试"


# ── Structured logging helpers ──────────────────────────────────────────────

def _req_id() -> str:
    """生成短请求 ID，用于日志串联。"""
    return uuid.uuid4().hex[:12]


def _log_ctx(request_id: str = "", session_id: Any = "", model: str = "", **extra: Any) -> dict[str, Any]:
    """构建结构化日志 extra 字段。"""
    ctx: dict[str, Any] = {}
    if request_id:
        ctx["request_id"] = request_id
    if session_id:
        ctx["session_id"] = session_id
    if model:
        ctx["model"] = model
    ctx.update(extra)
    return ctx


# ── Value objects ──────────────────────────────────────────────────────────────


@dataclass
class RuntimeObservation:
    kind: str
    name: str
    summary: str
    detail: dict[str, Any]


@dataclass
class ToolDefinition:
    name: str
    description: str
    source: str
    priority: int
    input_schema: dict[str, Any]
    metadata: dict[str, Any]


# ── Session-scoped evidence pool ──────────────────────────────────────────────
# 统一事实来源契约：generate/optimize/update/export 共享同一套证据池。
# 生命周期绑定到单次 run_agent_loop，跨 turn 不持久（设计决策：每轮重新建立事实依据）。


CHAT_CAPABLE_CAPABILITIES = ("text", "multimodal", "chat")

# TTS 模型仅供面试官类智能体使用，与聊天模型互斥
TTS_CAPABLE_CAPABILITIES = ("tts",)
INTERVIEW_AGENT_CATEGORIES = ("interview",)


def _agent_allowed_capabilities(category: str | None) -> tuple[str, ...]:
    """根据智能体类别返回允许使用的模型 capability 集合。"""
    if category in INTERVIEW_AGENT_CATEGORIES:
        return TTS_CAPABLE_CAPABILITIES
    return CHAT_CAPABLE_CAPABILITIES
AUTO_ATTACHMENT_PROMPT = "请帮我分析上传的附件。"

# ── Context budget constants ──────────────────────────────────────────────────
# 粗粒度 token 预算，用字符数近似（1 CJK char ≈ 1-2 tokens）。
_TOOL_RESULT_CHAR_BUDGET = 60000   # 每轮所有工具结果的总字符上限
_SINGLE_TOOL_RESULT_CAP = 12000    # 单个工具结果的字符上限（已有截断的地方保持不变）

# D1: 分层上下文预算参数（可通过 env 覆盖）
_AGENT_CONTEXT_RECENT_TURNS = 6    # 保留最近 K 轮完整消息
_AGENT_CONTEXT_HISTORY_LIMIT = 24  # 数据库查询的历史消息上限
_AGENT_CONTEXT_MSG_CHAR_CAP = 4000  # 单条消息字符上限


# ── Utilities ──────────────────────────────────────────────────────────────────


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def dumps_event(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# ── Built-in tool definitions ──────────────────────────────────────────────────


BUILTIN_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="invoke_agent",
        description="调用主智能体工具注册表中的子智能体，可派发给面试官、简历优化、岗位匹配等团队成员。",
        source="builtin",
        priority=1000,
        input_schema={
            "type": "object",
            "properties": {"agent_key": {"type": "string"}, "task": {"type": "string"}},
            "required": ["agent_key", "task"],
        },
        metadata={"kind": "subagent"},
    ),
    ToolDefinition(
        name="query_student_profile",
        description=(
            "查询学生完整个人档案，包括基本信息、联系方式、个人优势、求职状态与期望、"
            "工作/实习经历、项目经历、教育经历、获奖荣誉、证书和技能。"
        ),
        source="builtin",
        priority=990,
        input_schema={"type": "object", "properties": {}, "required": []},
        metadata={"kind": "profile"},
    ),
    ToolDefinition(
        name="query_job_positions",
        description="搜索岗位库，用于岗位匹配、JD 查询和职位推荐。",
        source="builtin",
        priority=980,
        input_schema={
            "type": "object",
            "properties": {"keyword": {"type": "string"}, "company": {"type": "string"}, "role": {"type": "string"}},
            "required": [],
        },
        metadata={"kind": "job"},
    ),
    ToolDefinition(
        name="query_knowledge_base",
        description="检索就业政策、行业知识、公司简介等知识库内容。",
        source="builtin",
        priority=970,
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
        metadata={"kind": "knowledge"},
    ),
    ToolDefinition(
        name="read_resume",
        description=(
            "读取学生的简历。返回两层信息："
            "① 列表层：全部在线简历的 id、标题、更新时间（轻量，相当于 ls）；"
            "② 全文层：当前工作简历的完整内容（如需读取其他简历，可传 resume_id 指定）。"
        ),
        source="builtin",
        priority=960,
        input_schema={
            "type": "object",
            "properties": {
                "resume_id": {
                    "type": "integer",
                    "description": "指定要读取全文的简历 ID。不传则读取当前工作简历。",
                },
            },
            "required": [],
        },
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="read_resume_ai",
        description=(
            "读取学生在「简历制作」中保存的简历内容（session_id=0 的附件）。"
            "AI 面试官用此工具了解学生简历以定制面试问题。"
        ),
        source="builtin",
        priority=959,
        input_schema={"type": "object", "properties": {}, "required": []},
        metadata={"kind": "resume_ai"},
    ),
    ToolDefinition(
        name="analyze_uploaded_file",
        description="分析学生上传的图片、Word、PDF、Excel、文本等附件，并把提取内容交给主智能体综合。",
        source="builtin",
        priority=955,
        input_schema={"type": "object", "properties": {"attachment_ids": {"type": "array"}}, "required": []},
        metadata={"kind": "file"},
    ),
    # 注：understand_image 不再作为独立工具注册。视觉理解改为 Harness 静默预理解
    # （_silent_understand_images 在组装上下文时后台调用视觉模型），主模型不再能
    # 主动调用此工具，避免双重调用。_understand_image_tool 函数仍保留供静默路径复用。
    ToolDefinition(
        name="send_notification",
        description="发送邮件或站内通知，用于面试提醒、报告推送等需要学生确认的动作。",
        source="builtin",
        priority=950,
        input_schema={
            "type": "object",
            "properties": {"channel": {"type": "string"}, "content": {"type": "string"}},
            "required": ["content"],
        },
        metadata={"kind": "notification", "risk": "medium"},
    ),
    ToolDefinition(
        name="get_session_context",
        description="读取当前会话历史，用于 ReAct Observe 阶段回溯上下文。",
        source="builtin",
        priority=940,
        input_schema={"type": "object", "properties": {"limit": {"type": "integer"}}, "required": []},
        metadata={"kind": "context"},
    ),
    ToolDefinition(
        name="export_resume_pdf",
        description=(
            "把优化后的简历内容生成一份可下载的 PDF 文件，并返回下载链接。"
            "推荐传入 resume_id（从已保存的在线简历生成），服务端会从已通过校验的数据渲染 PDF，"
            "无需手动拼 Markdown。也可传入 markdown 兜底（但仍受事实校验约束）。"
        ),
        source="builtin",
        priority=965,
        input_schema={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "在线简历 ID（推荐，从已保存的简历生成 PDF）"},
                "markdown": {"type": "string", "description": "完整的简历正文，Markdown 格式（仅在无 resume_id 时使用）。"},
                "filename": {"type": "string", "description": "文件名，可选，例如『张三-后端简历』。"},
            },
            "required": [],
        },
        metadata={"kind": "resume", "risk": "low"},
    ),
    ToolDefinition(
        name="read_webpage",
        description="读取指定 URL 的网页内容，返回 Markdown 格式的正文。适用于学生发送链接、需要查看招聘信息、公司官网等场景。",
        source="builtin",
        priority=900,
        input_schema={
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "要读取的网页 URL"},
                "max_length": {"type": "integer", "description": "返回内容最大字符数，默认 5000"},
            },
            "required": ["url"],
        },
        metadata={"kind": "web"},
    ),
    ToolDefinition(
        name="web_search",
        description="联网搜索关键词，返回搜索结果摘要。适用于查询公司背景、行业动态、岗位信息等需要实时网络数据的场景。",
        source="builtin",
        priority=895,
        input_schema={
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
                "num_results": {"type": "integer", "description": "返回结果数量，默认 5"},
            },
            "required": ["query"],
        },
        metadata={"kind": "web"},
    ),
    ToolDefinition(
        name="generate_resume_data",
        description=(
            "根据学生信息和目标 JD，生成第一版结构化在线简历并保存到系统，作为后续连续精修的工作简历。"
            "调用前必须先 query_student_profile 读取学生信息。"
            "适用于用户提供 JD、要求先出一版、从零创建、没有绑定工作简历的场景。"
            "经历、项目、教育、技能和自我评价必须来自个人档案或用户明确提供的新事实，禁止补齐空经历。"
            "完成后不要在正文中输出任何链接或 URL——系统会自动在消息下方渲染「查看简历」按钮。正文里用一句话引导即可，例如：简历已生成，点击下方按钮查看并编辑。"
        ),
        source="builtin",
        priority=970,
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "简历标题，例如『张三-后端工程师简历』"},
                "template_id": {"type": "string", "description": "模板ID: classic/modern/elegant/left-right/timeline/minimalist/creative/editorial/swiss，默认 classic"},
                "basic": {
                    "type": "object",
                    "description": "基本信息",
                    "properties": {
                        "name": {"type": "string"},
                        "target_position": {"type": "string", "description": "目标职位"},
                        "email": {"type": "string"},
                        "phone": {"type": "string"},
                        "location": {"type": "string"},
                        "birth_date": {"type": "string", "description": "格式 YYYY-MM（如 2002-09）"},
                    },
                },
                "education": {
                    "type": "array",
                    "description": "教育经历列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "school": {"type": "string"},
                            "major": {"type": "string"},
                            "degree": {"type": "string"},
                            "start_date": {"type": "string", "description": "格式 YYYY-MM（如 2021-09）"},
                            "end_date": {"type": "string", "description": "格式 YYYY-MM（如 2025-06），尚未毕业请填“至今”"},
                            "gpa": {"type": "string"},
                            "description": {"type": "string", "description": "每行一个亮点，换行分隔"},
                        },
                    },
                },
                "experience": {
                    "type": "array",
                    "description": "工作经历列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "company": {"type": "string"},
                            "position": {"type": "string"},
                            "date": {"type": "string", "description": "时间段，例如 2022-06 - 2024-12，尚未结束请填“至今”"},
                            "details": {"type": "string", "description": "每行一个要点，换行分隔"},
                        },
                    },
                },
                "projects": {
                    "type": "array",
                    "description": "项目经历列表",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "role": {"type": "string"},
                            "date": {"type": "string", "description": "时间段，例如 2024-03 - 2024-08，尚未结束请填“至今”"},
                            "description": {"type": "string", "description": "每行一个要点，换行分隔"},
                        },
                    },
                },
                "skills": {"type": "string", "description": "技能描述，每行一条，换行分隔"},
                "self_evaluation": {"type": "string", "description": "自我评价，每行一段，换行分隔"},
            },
            "required": ["title", "basic"],
        },
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="optimize_resume_data",
        description=(
            "基于学生已有简历内容和目标 JD，生成一份优化版简历并保存到系统，适合作为第一版后的岗位定制版本。"
            "调用前必须已获取简历内容（通过 read_resume 或本轮上传的文档附件），禁止凭空捏造。"
            "用户要求“给一版/出一版/按 JD 做一版”时可保存为新版本；用户要求在当前简历上微调时优先使用 update_resume_data。"
            "所有事实字段都会在服务端核验；无来源内容将拒绝保存。"
            "完成后不要在正文中输出任何链接或 URL——系统会自动在消息下方渲染「查看简历」按钮。正文里用一句话引导即可，例如：简历已优化完成，点击下方按钮查看并编辑。"
        ),
        source="builtin",
        priority=968,
        input_schema={
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "优化后简历标题"},
                "template_id": {"type": "string", "description": "模板ID: classic/modern/elegant/left-right/timeline/minimalist/creative/editorial/swiss，优先继承原简历模板"},
                "source_resume_id": {"type": "integer", "description": "来源的在线简历 ID（如有）"},
                "basic": {"type": "object"},
                "education": {"type": "array", "items": {"type": "object"}},
                "experience": {"type": "array", "items": {"type": "object"}},
                "projects": {"type": "array", "items": {"type": "object"}},
                "skills": {"type": "string"},
                "self_evaluation": {"type": "string"},
                "jd_text": {"type": "string", "description": "目标岗位 JD 原文（可选，用于覆盖率校验）"},
            },
            "required": ["title", "basic"],
        },
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="analyze_jd_match",
        description=(
            "分析目标岗位 JD 与学生真实档案的匹配度。订制简历前必须先调用。"
            "提交结构化分析结果：P0/P1 需求分级、证据匹配矩阵（SUPPORTED/PARTIAL/GAP）、"
            "核心 ATS 关键词。Harness 校验非空且合理后存入会话，供后续 optimize_resume_data 覆盖率检查使用。"
        ),
        source="builtin",
        priority=975,
        input_schema={
            "type": "object",
            "properties": {
                "jd_text": {
                    "type": "string",
                    "description": "原始 JD 文本（完整粘贴，不可摘要）",
                },
                "p0_requirements": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "P0 硬性门槛（学历、必须技能等），每条一句话",
                },
                "p1_keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "P1 核心 ATS 关键词（技术栈、业务场景、高频词）",
                },
                "matrix": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "requirement": {"type": "string"},
                            "status": {"type": "string", "enum": ["SUPPORTED", "PARTIAL", "GAP"]},
                            "evidence": {"type": "string"},
                        },
                        "required": ["requirement", "status"],
                    },
                    "description": "证据匹配矩阵",
                },
            },
            "required": ["jd_text", "p0_requirements", "p1_keywords", "matrix"],
        },
        metadata={"kind": "jd_analysis"},
    ),
    ToolDefinition(
        name="update_resume_data",
        description=(
            "更新学生已有的在线简历（整段兜底更新），用于复杂整体改写或兼容旧流程。"
            "调用前必须先 read_resume 确认简历内容。"
            "resume_id 可选：不传则更新当前工作简历（session 绑定）。"
            "用户要求调整语气、顺序、重点、删改段落、突出某项能力、换成更强表达时，优先调用 apply_resume_patch；只有需要替换完整章节时才调用本工具。"
            "若用户在本轮明确提供了新事实，先用 save_session_note(type=fact) 保存，再写入简历；不得增加原简历、个人档案或用户明说内容之外的事实。"
        ),
        source="builtin",
        priority=966,
        input_schema={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "要更新的简历 ID。不传则更新当前工作简历。"},
                "base_updated_at": {"type": "string", "description": "read_resume 时拿到的 updated_at，用于版本检查。"},
                "title": {"type": "string"},
                "template_id": {"type": "string"},
                "basic": {"type": "object"},
                "education": {"type": "array", "items": {"type": "object"}},
                "experience": {"type": "array", "items": {"type": "object"}},
                "projects": {"type": "array", "items": {"type": "object"}},
                "skills": {"type": "string"},
                "self_evaluation": {"type": "string"},
            },
            "required": [],
        },
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="apply_resume_patch",
        description=(
            "像 Codex 改代码一样，对当前工作简历做小步补丁式修改并自动 review。"
            "适用于用户明确要求加内容、删内容、改措辞、调整重点、突出能力、改自我评价、修改某段经历等连续精修场景。"
            "调用前必须先 read_resume 获取当前简历和 base_updated_at。"
            "只提交要改的补丁，不要重写整份简历；保存后系统会重新读取并 review，确认没有新增无来源信息、夸大职责、虚构数字或格式问题。"
            "若用户本轮明确提供新事实，先用 save_session_note(type=fact) 保存，再写入简历。"
        ),
        source="builtin",
        priority=967,
        input_schema={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "要修改的简历 ID。不传则修改当前工作简历。"},
                "base_updated_at": {"type": "string", "description": "read_resume 返回的 updated_at，用于防止覆盖用户手动编辑。"},
                "intent_summary": {"type": "string", "description": "用一句话说明用户想改什么。"},
                "patches": {
                    "type": "array",
                    "description": "小步修改列表。每个补丁只改一个章节或一个条目。",
                    "items": {
                        "type": "object",
                        "properties": {
                            "action": {
                                "type": "string",
                                "enum": [
                                    "set_field",
                                    "append_lines",
                                    "remove_lines",
                                    "rewrite",
                                    "add_item",
                                    "update_item",
                                    "delete_item",
                                ],
                                "description": "修改动作。",
                            },
                            "section": {
                                "type": "string",
                                "enum": ["title", "basic", "skills", "self_evaluation", "education", "experience", "projects"],
                                "description": "要修改的简历板块。",
                            },
                            "field": {"type": "string", "description": "要修改的字段，如 title/name/details/description/company/role/date。"},
                            "target_id": {"type": "string", "description": "条目 id；没有 id 时可用 target_index 或 target_text。"},
                            "target_index": {"type": "integer", "description": "1-based 条目序号，例如第三段项目经历传 3。"},
                            "target_text": {"type": "string", "description": "用于定位条目的原文片段。"},
                            "value": {"description": "新内容。列表板块 add/update 时传对象；文本板块传字符串或字符串数组。"},
                            "fields": {"type": "object", "description": "update_item 时要更新的字段集合。"},
                            "reason": {"type": "string", "description": "为什么做这处修改，供 review 和用户摘要使用。"},
                        },
                        "required": ["action", "section"],
                    },
                },
            },
            "required": ["patches"],
        },
        metadata={"kind": "resume"},
    ),
    ToolDefinition(
        name="search_past_sessions",
        description=(
            "在当前学生的历史对话摘要和标题中检索，返回相关摘要片段。"
            "用于跨会话记忆检索，帮助模型了解学生之前的对话内容。不自动注入历史会话内容，按需调用。"
        ),
        source="builtin",
        priority=890,
        input_schema={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "检索关键词",
                },
            },
            "required": ["query"],
        },
        metadata={"kind": "search"},
    ),
    ToolDefinition(
        name="save_session_note",
        description=(
            "保存用户在对话中提出的约束、偏好或口述的新经历到会话记忆。"
            "类型：constraint（禁止项/约束）、fact（新经历/事实）、preference（偏好设置）。"
            "每类上限 20 条，每条 ≤200 字，自动去重。"
        ),
        source="builtin",
        priority=900,
        input_schema={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "enum": ["constraint", "fact", "preference"],
                    "description": "记忆类型：constraint=约束/禁止项，fact=新经历/事实，preference=偏好",
                },
                "content": {
                    "type": "string",
                    "description": "记忆内容，≤200 字",
                },
            },
            "required": ["type", "content"],
        },
        metadata={"kind": "memory"},
    ),
]


def _tool_safe_name(value: str) -> str:
    clean = "".join(ch if ch.isalnum() else "_" for ch in value.lower()).strip("_")
    return clean or "skill_tool"


# ── Attachment handling ────────────────────────────────────────────────────────


def _is_allowed_attachment(ext: str, content_type: str) -> bool:
    allowed_ext = {
        "png", "jpg", "jpeg", "webp", "gif",
        "pdf", "docx", "doc", "xlsx", "xls",
        "csv", "txt", "md", "json",
    }
    if ext in allowed_ext:
        return True
    return content_type.startswith("image/")


def _extract_attachment_text(path: Path, content_type: str, ext: str) -> str:
    try:
        if ext == "pdf":
            return _extract_pdf_text(path)
        if ext == "docx":
            return _extract_docx_text(path)
        if ext in {"xlsx", "xls"}:
            return _extract_xlsx_text(path)
        if ext in {"csv", "txt", "md", "json"}:
            return path.read_text(encoding="utf-8", errors="ignore")[:12000]
        if content_type.startswith("image/"):
            return _extract_image_summary(path)
    except Exception as exc:
        logger.exception("附件解析失败: %s", path)
        return f"附件已保存，但自动解析失败：{str(exc)[:200]}"
    return "附件已保存，当前格式需要专用 Skill 或外部工具进一步解析。"


def _extract_pdf_text(path: Path) -> str:
    from app.student.file_text import extract_pdf_text
    return extract_pdf_text(path) or "PDF 未提取到可读文本，可能是扫描件。"


def _extract_docx_text(path: Path) -> str:
    from app.student.file_text import extract_docx_text
    return extract_docx_text(path) or "Word 文档未提取到可读文本。"


def _extract_xlsx_text(path: Path) -> str:
    from app.student.file_text import extract_xlsx_text
    return extract_xlsx_text(path) or "Excel 文件未提取到可读内容。"


def _extract_image_summary(path: Path) -> str:
    from app.student.file_text import extract_image_summary
    return extract_image_summary(path)


# ── Session CRUD ───────────────────────────────────────────────────────────────


def create_session(db: Session, identity: AuthIdentity, title: Optional[str], agent_type: str = "resume", active_resume_id: Optional[int] = None) -> StudentAgentSession:
    # 校验简历归属
    if active_resume_id is not None:
        resume = db.scalar(
            select(StudentResume).where(
                StudentResume.id == active_resume_id,
                StudentResume.student_id == identity.user_id,
                StudentResume.tenant_id == identity.tenant_id,
            )
        )
        if not resume:
            active_resume_id = None  # 不属于当前学生，忽略
    session = StudentAgentSession(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=(title or "新对话").strip() or "新对话",
        agent_type=agent_type,
        active_resume_id=active_resume_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def list_available_models(
    db: Session,
    identity: AuthIdentity,
    allowed_capabilities: tuple[str, ...] = CHAT_CAPABLE_CAPABILITIES,
) -> list[AgentModelOptionResponse]:
    rows = db.scalars(
        select(ModelConfig)
        .where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.status == "active",
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability.in_(allowed_capabilities),
        )
        .order_by(ModelConfig.id.asc())
    ).all()
    results = []
    for row in rows:
        resp = AgentModelOptionResponse.model_validate(row)
        resp.supported_efforts = get_model_effort_config(row).get("supported_efforts", ["low", "medium", "high"])
        results.append(resp)
    return results


def serialize_attachment(attachment: StudentAgentAttachment) -> AgentAttachmentResponse:
    data = AgentAttachmentResponse.model_validate(attachment)
    data.download_url = _attachment_download_url(attachment.stored_path, attachment.student_id, attachment.tenant_id)
    return data


async def save_attachment(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    upload: UploadFile,
) -> StudentAgentAttachment:
    session = get_session_or_404(db, identity, session_id)
    settings = get_settings()
    raw = await upload.read()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件为空")
    if len(raw) > settings.agent_upload_max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="附件超过大小限制")

    original_name = Path(upload.filename or "attachment").name
    ext = Path(original_name).suffix.lower().lstrip(".")
    content_type = upload.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if not _is_allowed_attachment(ext, content_type):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="暂不支持该附件格式")

    storage_dir = Path(settings.agent_upload_storage_dir) / str(identity.tenant_id) / str(identity.user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}.{ext or 'bin'}"
    stored_path = storage_dir / stored_name
    stored_path.write_bytes(raw)

    extracted_text = _extract_attachment_text(stored_path, content_type, ext)
    row = StudentAgentAttachment(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        session_id=session.id,
        original_name=original_name,
        stored_path=str(stored_path),
        content_type=content_type,
        file_ext=ext,
        file_size=len(raw),
        extracted_text=extracted_text,
        status="ready",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def list_sessions(db: Session, identity: AuthIdentity) -> list[StudentAgentSession]:
    # 只返回「至少有一条消息」的会话，自动隐藏从未对话过的空会话
    has_message = (
        select(StudentAgentMessage.id)
        .where(StudentAgentMessage.session_id == StudentAgentSession.id)
        .exists()
    )
    return list(
        db.scalars(
            select(StudentAgentSession)
            .where(
                StudentAgentSession.tenant_id == identity.tenant_id,
                StudentAgentSession.student_id == identity.user_id,
                StudentAgentSession.status == "active",
                has_message,
            )
            .order_by(StudentAgentSession.updated_at.desc())
        ).all()
    )


def delete_session(db: Session, identity: AuthIdentity, session_id: int) -> None:
    session = get_session_or_404(db, identity, session_id)
    session.status = "deleted"
    session.updated_at = utcnow()
    db.commit()


def get_session_or_404(db: Session, identity: AuthIdentity, session_id: int) -> StudentAgentSession:
    session = db.scalar(
        select(StudentAgentSession).where(
            StudentAgentSession.id == session_id,
            StudentAgentSession.tenant_id == identity.tenant_id,
            StudentAgentSession.student_id == identity.user_id,
            StudentAgentSession.status == "active",
        )
    )
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="对话不存在")
    return session


def get_history(db: Session, identity: AuthIdentity, session_id: int):
    session = get_session_or_404(db, identity, session_id)
    messages = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.asc())
        ).all()
    )
    activities = list(
        db.scalars(
            select(StudentAgentActivity)
            .where(StudentAgentActivity.session_id == session.id)
            .order_by(StudentAgentActivity.id.asc())
        ).all()
    )
    attachments = list(
        db.scalars(
            select(StudentAgentAttachment)
            .where(StudentAgentAttachment.session_id == session.id)
            .order_by(StudentAgentAttachment.id.asc())
        ).all()
    )
    return session, messages, activities, attachments


# ── DB helpers ─────────────────────────────────────────────────────────────────


def serialize_activity(activity: StudentAgentActivity) -> AgentActivityResponse:
    detail: dict[str, Any] = {}
    if activity.detail_json:
        try:
            detail = json.loads(activity.detail_json)
        except json.JSONDecodeError:
            detail = {}
    return AgentActivityResponse(
        id=activity.id,
        session_id=activity.session_id,
        message_id=activity.message_id,
        kind=activity.kind,
        name=activity.name,
        status=activity.status,
        summary=activity.summary,
        display_summary=detail.pop("display_summary", None),
        detail=detail,
        started_at=activity.started_at,
        completed_at=activity.completed_at,
    )


def _save_message(db: Session, session: StudentAgentSession, role: str, content: str) -> StudentAgentMessage:
    message = StudentAgentMessage(session_id=session.id, role=role, content=content)
    session.updated_at = utcnow()
    if role == "user" and session.title == "新对话":
        session.title = content.strip().replace("\n", " ")[:32] or "新对话"
    db.add(message)
    db.commit()
    db.refresh(message)
    return message


def _save_activity(
    db: Session,
    session: StudentAgentSession,
    message: StudentAgentMessage,
    *,
    kind: str,
    name: str,
    status_value: str,
    summary: str,
    detail: Optional[dict[str, Any]] = None,
) -> StudentAgentActivity:
    activity = StudentAgentActivity(
        session_id=session.id,
        message_id=message.id,
        kind=kind,
        name=name,
        status=status_value,
        summary=summary,
        detail_json=json.dumps(detail or {}, ensure_ascii=False),
        completed_at=utcnow() if status_value in {"completed", "failed"} else None,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def _complete_activity(
    db: Session,
    activity: StudentAgentActivity,
    *,
    status_value: str,
    summary: str,
    detail: dict[str, Any],
) -> StudentAgentActivity:
    completed_at = utcnow()
    started_at = activity.started_at
    if started_at.tzinfo is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    duration_ms = max(0, int((completed_at - started_at).total_seconds() * 1000))
    activity.status = status_value
    activity.summary = summary
    activity.detail_json = json.dumps({**detail, "duration_ms": duration_ms}, ensure_ascii=False)
    activity.completed_at = completed_at
    db.commit()
    db.refresh(activity)
    return activity


# ── Main streaming entry point ─────────────────────────────────────────────────


async def stream_master_reply(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    content: str,
    model_id: Optional[int],
    reasoning_effort: str,
    attachment_ids: list[int],
) -> AsyncIterator[str]:
    """Agentic-loop entry point.

    Harness owns the loop: the model only proposes tool calls, the Harness
    validates / executes / audits them and feeds results back, until the model
    produces a final answer or `max_iterations` is reached. See the in-repo
    《Agent = Model + Harness 开发准则》— "Harness 提供信任".
    """
    session = get_session_or_404(db, identity, session_id)
    req_id = _req_id()
    user_message = _save_message(db, session, "user", content.strip())
    attachments = _claim_message_attachments(db, identity, session, user_message, attachment_ids)
    if (
        (content.strip() == AUTO_ATTACHMENT_PROMPT or not content.strip())
        and attachments
        and all(attachment.content_type.startswith("image/") for attachment in attachments)
        and session.title in (AUTO_ATTACHMENT_PROMPT, "新对话")
    ):
        session.title = "图片分析"
        db.commit()
    yield dumps_event("message.saved", {"message_id": user_message.id})

    model = _select_chat_model(db, identity.tenant_id, model_id)

    # ── Model availability guards (return a controlled assistant message) ──
    if model is None or not model.api_key_cipher:
        assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
        db.add(assistant_message)
        db.commit()
        db.refresh(assistant_message)
        if model is None:
            error = "当前没有可用的聊天模型，请管理员在模型广场开启「对学生开放」。"
        else:
            error = f"模型「{model.display_name}」未配置 API Key，请管理员在模型广场补全配置。"
        assistant_message.content = error
        session.updated_at = utcnow()
        db.commit()
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": error})
        yield dumps_event("message.completed", {"message_id": assistant_message.id})
        yield dumps_event("done", {"session_id": session.id})
        return

    config = get_or_create_master_config(db, identity.tenant_id)
    # Harness hard boundary — 尊重管理端配置的轮次，但保留一个安全上限防止失控。
    max_iterations = max(1, min(int(config.max_iterations or 8), 20))
    permission_mode = (config.permission_mode or "ask").lower()

    # ── Auto effort classification ──
    if reasoning_effort == "auto":
        has_jd = bool(session.jd_text and session.jd_text.strip())
        reasoning_effort = auto_classify_effort(content, has_jd=has_jd, has_attachments=bool(attachments))
        logger.info("auto effort classified", extra=_log_ctx(request_id=req_id, session_id=session.id, effort=reasoning_effort))

    # P2.2: 步骤进度预告——用意图分类推断本次操作的典型步骤，
    # 在 AI 动手前告诉用户整体计划（如「读取简历→分析岗位→优化保存」）。
    # chat 意图无步骤（纯对话），不发射事件。
    _plan_has_resume = bool(getattr(session, "active_resume_id", None))
    _plan_intent = classify_intent(
        content, has_resume=_plan_has_resume, has_jd=has_jd, has_attachments=bool(attachments),
    )
    if _plan_intent.plan_steps:
        yield dumps_event("runtime.steps_plan", {
            "session_id": session.id,
            "intent": _plan_intent.mode,
            "steps": _plan_intent.plan_steps,
        })

    # Curated, safe tool registry. Only tools the Harness can honestly fulfil
    # are exposed — fabricating stubs are intentionally excluded.
    agent_type = getattr(session, "agent_type", "resume") or "resume"
    tool_defs = _assemble_tools(db, identity, agent_type)

    # 设计决策（2026-06）：视觉理解改为「Harness 静默预理解」——不再向主模型
    # 暴露 understand_image 工具，而是在组装上下文时后台调用视觉模型，把图片
    # 描述作为隐藏文本喂给主模型。无论主模型是否 multimodal 都统一走这条路。
    # 见 _build_user_text_with_vision / 消息组装处的实现。

    registry = {tool.name: tool for tool in tool_defs}
    openai_tools = _build_openai_tools(tool_defs)

    # Build initial messages BEFORE creating the empty assistant row, so the
    # history loader does not pick up a blank assistant turn.
    # D2: 上下文压缩 — 组装后估算 token，超阈值则压缩并重新组装
    # 视觉静默预理解：对图片附件调用视觉模型，把描述作为隐藏上下文喂给主模型。
    # 无论主模型是否 multimodal 都统一走这条路；整个过程后台运行，前端无活动胶囊。
    image_descriptions: dict[int, str] = {}
    if _has_image_attachments(attachments):
        image_descriptions = await _silent_understand_images(db, identity, attachments)

    messages, _compressed = await _compress_context(
        db, identity, session, model, config,
        user_text=content, reasoning_effort=reasoning_effort,
        attachments=attachments, agent_type=agent_type,
        openai_tools=openai_tools,
        image_descriptions=image_descriptions,
    )

    assistant_message = StudentAgentMessage(session_id=session.id, role="assistant", content="")
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)

    full_content = ""
    run_metrics: dict[str, Any] = {}
    async for event_name, data in run_agent_loop(
        db, identity, session, user_message, assistant_message,
        model, messages, openai_tools, registry, attachments, reasoning_effort,
        max_iterations, permission_mode, config.temperature, config.max_tokens,
        request_id=req_id,
    ):
        if event_name == "message.delta":
            full_content += str(data.get("delta", ""))
        elif event_name == "runtime.completed":
            run_metrics = data
        yield dumps_event(event_name, data)

    if not full_content.strip():
        full_content = _configured_fallback_answer(config, content)
        yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": full_content})

    # ── 防复读护栏：与上一条 assistant 消息比对 ──
    if full_content.strip():
        prev_assistant = db.scalars(
            select(StudentAgentMessage)
            .where(
                StudentAgentMessage.session_id == session.id,
                StudentAgentMessage.role == "assistant",
                StudentAgentMessage.id < assistant_message.id,
            )
            .order_by(StudentAgentMessage.id.desc())
            .limit(1)
        ).first()
        if prev_assistant and prev_assistant.content:
            ratio = difflib.SequenceMatcher(
                None, full_content.strip(), prev_assistant.content.strip()
            ).ratio()
            if ratio > 0.85:
                logger.warning(
                    "防复读护栏触发 session=%s ratio=%.2f，注入纠偏消息重试",
                    session.id, ratio,
                )
                # 注入纠偏 system 消息，要求模型推进
                correction = (
                    "你的回复与上一条高度相似（相似度 {:.0%}），用户已提供新信息。"
                    "请不要重复之前的回复，直接推进下一步操作。"
                    "若用户已提供 JD，请直接进入简历生成/优化流程；"
                    "若用户提供了新内容，请基于新内容回应。"
                ).format(ratio)
                messages.append({"role": "system", "content": correction})
                # 清空已输出内容，重新流式生成
                full_content = ""
                async for retry_event, retry_data in run_agent_loop(
                    db, identity, session, user_message, assistant_message,
                    model, messages, openai_tools, registry, attachments, reasoning_effort,
                    1,  # 只重试一次
                    permission_mode, config.temperature, config.max_tokens,
                    request_id=req_id,
                ):
                    if retry_event == "message.delta":
                        full_content += str(retry_data.get("delta", ""))
                    elif retry_event == "runtime.completed":
                        run_metrics = retry_data
                    yield dumps_event(retry_event, retry_data)
                if not full_content.strip():
                    full_content = _configured_fallback_answer(config, content)
                    yield dumps_event("message.delta", {"message_id": assistant_message.id, "delta": full_content})

    assistant_message.content = full_content
    assistant_message.model_name = str(run_metrics.get("model_name") or model.display_name or model.model_identifier)[:128]
    assistant_message.prompt_tokens = int(run_metrics.get("prompt_tokens") or 0) or None
    assistant_message.completion_tokens = int(run_metrics.get("completion_tokens") or 0) or None
    assistant_message.total_tokens = int(run_metrics.get("total_tokens") or 0) or None
    assistant_message.duration_ms = int(run_metrics.get("duration_ms") or 0) or None
    session.updated_at = utcnow()
    db.commit()
    yield dumps_event("message.completed", {"message_id": assistant_message.id})
    yield dumps_event("done", {"session_id": session.id})


def _claim_message_attachments(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    message: StudentAgentMessage,
    attachment_ids: list[int],
) -> list[StudentAgentAttachment]:
    if not attachment_ids:
        return []
    rows = list(
        db.scalars(
            select(StudentAgentAttachment).where(
                StudentAgentAttachment.id.in_(attachment_ids),
                StudentAgentAttachment.tenant_id == identity.tenant_id,
                StudentAgentAttachment.student_id == identity.user_id,
                StudentAgentAttachment.session_id == session.id,
            )
        ).all()
    )
    found = {row.id for row in rows}
    missing = [item for item in attachment_ids if item not in found]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="附件不存在或不属于当前会话")
    for row in rows:
        row.message_id = message.id
    db.commit()
    return rows



def _tool_start_label(tool: ToolDefinition, arguments: dict[str, Any]) -> str:
    """Human-readable 'in progress' label shown in the activity chip."""
    labels = {
        "query_student_profile": "正在查看个人档案…",
        "read_resume": "正在查看简历…",
        "analyze_uploaded_file": "正在分析上传材料…",
        "get_session_context": "正在回顾本次对话…",
        "generate_resume_data": "正在生成在线简历…",
        "optimize_resume_data": "正在创建优化版简历…",
        "update_resume_data": "正在更改简历…",
        "apply_resume_patch": "正在修改并检查简历…",
        "export_resume_pdf": "正在导出简历 PDF…",
        "read_webpage": "正在读取岗位网页…",
        "web_search": "正在搜索相关信息…",
    }
    if tool.name in labels:
        return labels[tool.name]
    kind = tool.metadata.get("kind") or tool.source
    if kind == "profile":
        return "正在读取学生档案…"
    if kind == "resume":
        return "正在读取简历材料…"
    if kind == "file":
        return "正在解析上传附件…"
    if kind == "job":
        kw = str(arguments.get("keyword") or "")[:20]
        return f"正在检索岗位库{('：' + kw) if kw else '…'}"
    if kind == "knowledge":
        q = str(arguments.get("query") or "")[:20]
        return f"正在检索知识库{('：' + q) if q else '…'}"
    if kind == "context":
        return "正在回溯会话上下文…"
    if kind == "subagent":
        key = str(arguments.get("agent_key") or tool.name)
        return f"正在调用子智能体：{key}…"
    if kind == "notification":
        return "正在准备通知…"
    if tool.source == "skill":
        return f"正在调用技能：{tool.metadata.get('name') or tool.name}…"
    if tool.source == "mcp":
        return "正在探索 MCP 工具…"
    return f"正在执行 {tool.name}…"






def _analyze_jd_match_tool(
    db: Session,
    session: StudentAgentSession,
    args: dict[str, Any],
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    """analyze_jd_match 工具执行器：校验结构化 JD 分析产物，写入 session 和 evidence_pool。"""
    jd_text = str(args.get("jd_text") or "").strip()
    p0 = args.get("p0_requirements") or []
    p1 = args.get("p1_keywords") or []
    matrix = args.get("matrix") or []

    # 校验
    if len(jd_text) < 50:
        return {
            "status": "failed",
            "tool": "analyze_jd_match",
            "summary": "jd_text 过短（不足 50 字），请提交完整的岗位描述原文。",
        }
    if not isinstance(p0, list) or len(p0) == 0:
        return {
            "status": "failed",
            "tool": "analyze_jd_match",
            "summary": "p0_requirements 不能为空，请至少列出 1 条硬性门槛。",
        }
    if not isinstance(p1, list) or len(p1) < 2:
        return {
            "status": "failed",
            "tool": "analyze_jd_match",
            "summary": "p1_keywords 至少需要 2 个核心关键词。",
        }
    if not isinstance(matrix, list) or len(matrix) == 0:
        return {
            "status": "failed",
            "tool": "analyze_jd_match",
            "summary": "证据匹配矩阵不能为空，请逐项分析 JD 要求与学生档案的匹配状态。",
        }
    has_supported = any(
        isinstance(item, dict) and item.get("status") == "SUPPORTED"
        for item in matrix
    )
    if not has_supported:
        return {
            "status": "failed",
            "tool": "analyze_jd_match",
            "summary": "证据匹配矩阵中至少需要 1 条 SUPPORTED 状态（学生档案中应有匹配项）。请核实学生档案。",
        }

    # 写入 session 持久字段
    jd_text_stored = jd_text[:8000]
    session.jd_text = jd_text_stored  # type: ignore[attr-defined]
    session.jd_analyzed_at = datetime.now(timezone.utc)  # type: ignore[attr-defined]
    db.commit()

    # 写入 evidence_pool
    if evidence_pool:
        evidence_pool.set_jd(jd_text_stored, list(p1))
        # 将 GAP 项存入 evidence_pool，供后续简历生成/优化时拦截
        gap_items = [
            item.get("requirement") or item.get("keyword") or item.get("name")
            for item in matrix
            if isinstance(item, dict) and item.get("status") == "GAP"
        ]
        gap_items = [g for g in gap_items if g]
        if gap_items:
            evidence_pool.set_gap_keywords(gap_items)

    # 统计匹配状态
    stats = {"SUPPORTED": 0, "PARTIAL": 0, "GAP": 0}
    for item in matrix:
        if isinstance(item, dict):
            s = item.get("status", "")
            if s in stats:
                stats[s] += 1

    return {
        "status": "completed",
        "tool": "analyze_jd_match",
        "summary": (
            f"JD 分析已完成：P0 硬性门槛 {len(p0)} 条，P1 关键词 {len(p1)} 个，"
            f"匹配矩阵 {len(matrix)} 项（SUPPORTED {stats['SUPPORTED']} / "
            f"PARTIAL {stats['PARTIAL']} / GAP {stats['GAP']}）。"
            f"可继续调用 optimize_resume_data 生成优化版简历。"
        ),
        "match_stats": stats,
        "p0_count": len(p0),
        "p1_count": len(p1),
    }




def _invoke_skill(tool: ToolDefinition, arguments: dict[str, Any]) -> dict[str, Any]:
    skill_name = str(tool.metadata.get("name") or tool.name)
    # 校验 Skill 是否配置了有效的 input_schema
    schema = tool.input_schema
    if not schema or not isinstance(schema.get("properties"), dict) or not schema["properties"]:
        return {
            "status": "failed",
            "tool": tool.name,
            "summary": (
                f"Skill「{skill_name}」配置不完整：缺少参数定义（input_schema 为空），"
                "请联系管理员在 Skill 广场补全该 Skill 的参数 schema 后重试。"
            ),
        }
    return {
        "status": "completed",
        "tool": tool.name,
        "skill_slug": tool.metadata.get("slug"),
        "summary": f"已调用技能「{skill_name}」，处理「{str(arguments.get('task') or '')[:30]}」。",
        "display_name": skill_name,
        # Skill 是「渐进式披露」的操作手册，调用时应把完整正文加载进上下文（不是 1600 字的缩略）
        "skill_content": str(tool.metadata.get("content") or "")[:12000],
        "description": tool.description,
    }


def _analyze_uploaded_files(attachments: list[StudentAgentAttachment]) -> dict[str, Any]:
    if not attachments:
        return {
            "status": "failed",
            "tool": "analyze_uploaded_file",
            "summary": "本轮消息没有可分析的附件。",
        }
    file_summaries = []
    for attachment in attachments:
        text = (attachment.extracted_text or "").strip()
        excerpt = text[:10000] if text else "未提取到文本内容"
        file_summaries.append(
            {
                "id": attachment.id,
                "name": attachment.original_name,
                "content_type": attachment.content_type,
                "file_ext": attachment.file_ext,
                "file_size": attachment.file_size,
                "excerpt": excerpt,
            }
        )
    names = "、".join(item["name"] for item in file_summaries)
    has_image = any(attachment.content_type.startswith("image/") for attachment in attachments)
    image_note = (
        " 图片已解析，如模型支持视觉输入将直传。"
        if has_image
        else ""
    )
    return {
        "status": "completed",
        "tool": "analyze_uploaded_file",
        "summary": f"已解析附件：{names}。{image_note}",
        "attachments": file_summaries,
    }


# ── Vision tool (understand_image) ────────────────────────────────────────────


def _get_vision_config(db: Session, tenant_id: int) -> Optional[dict[str, Any]]:
    """读取管理端「视觉配置」页配好的视觉模型运行时配置（含解密后的 api_key）。

    多租户隔离：按 tenant_id 过滤。任一关键字段缺失、总开关关闭或密钥解密失败
    时返回 None，调用方据此判定「视觉模型未配置」并给出引导提示。
    """
    from app.admin.vision_service import get_vision_runtime_config

    return get_vision_runtime_config(db, tenant_id)


async def _understand_image_tool(
    db: Session,
    identity: AuthIdentity,
    args: dict[str, Any],
    attachments: list[StudentAgentAttachment],
) -> dict[str, Any]:
    """调用视觉模型理解图片内容，返回文字描述。"""
    attachment_id = args.get("attachment_id")
    if not attachment_id:
        return {"status": "failed", "tool": "understand_image", "summary": "缺少 attachment_id 参数。"}
    try:
        attachment_id = int(attachment_id)
    except (TypeError, ValueError):
        return {"status": "failed", "tool": "understand_image", "summary": f"attachment_id 格式错误：{attachment_id}"}

    # 查找附件（优先从当前轮附件列表，兜底从数据库加载，但必须按 tenant/student 校验）
    attachment = next((a for a in attachments if a.id == attachment_id), None)
    if not attachment:
        # 多租户隔离：兜底查询必须带 tenant_id + student_id，防止 LLM 编造 ID 跨租户读取
        attachment = db.scalar(
            select(StudentAgentAttachment).where(
                StudentAgentAttachment.id == attachment_id,
                StudentAgentAttachment.tenant_id == identity.tenant_id,
                StudentAgentAttachment.student_id == identity.user_id,
                StudentAgentAttachment.status != "deleted",
            )
        )
        if not attachment:
            return {"status": "failed", "tool": "understand_image", "summary": f"附件 {attachment_id} 不存在。"}

    if not (attachment.content_type or "").startswith("image/"):
        return {"status": "failed", "tool": "understand_image", "summary": f"附件 {attachment.original_name} 不是图片。"}

    # 读取图片
    img_path = Path(attachment.stored_path)
    if not img_path.exists():
        return {"status": "failed", "tool": "understand_image", "summary": "图片文件已丢失。"}

    try:
        img_bytes = img_path.read_bytes()
        if len(img_bytes) > 8_000_000:
            return {"status": "failed", "tool": "understand_image", "summary": "图片超过 8MB 限制。"}
        img_base64 = base64.b64encode(img_bytes).decode("ascii")
    except Exception as exc:
        return {"status": "failed", "tool": "understand_image", "summary": f"读取图片失败：{exc}"}

    # 读取视觉模型配置（来自管理端「视觉配置」页）
    vision_cfg = _get_vision_config(db, identity.tenant_id)
    if not vision_cfg:
        return {
            "status": "failed",
            "tool": "understand_image",
            "summary": "没有可用的视觉模型。请管理员在「视觉配置」中配置视觉模型（Base URL / API Key / 模型名 / 协议）并启用。",
        }

    # 调用视觉模型（直接构建 multimodal 请求，不走 chat_completion 因为它不支持 image_url content）
    system_prompt = (
        "你是一个图片内容理解助手。请详细描述用户发送的图片内容，包括：\n"
        "- 图片中的所有文字（原样提取，不要遗漏）\n"
        "- 表格、图表的数据和结构\n"
        "- 布局和排版信息\n"
        "- 如果是简历、证件、成绩单等文档，请完整提取所有字段和内容\n"
        "请用中文回答，尽量详尽准确。"
    )
    data_url = f"data:{attachment.content_type};base64,{img_base64}"
    user_message = f"请描述这张图片的内容。图片信息：{attachment.original_name}"

    # max_tokens：直接用视觉配置页填的值，代码不额外设限。
    # 注意不同模型的接口上限不同（如 GLM-4V-Flash 限 [1,1024]），
    # 配置值超出模型能力时模型会返回 400，届时按模型实际限制调整配置即可。
    vision_max_tokens = vision_cfg["max_tokens"]

    try:
        is_anthropic = vision_cfg["protocol"] == "anthropic"
        api_key = vision_cfg["api_key"]
        base = (vision_cfg["base_url"] or "").rstrip("/")

        async with httpx.AsyncClient(timeout=httpx.Timeout(60)) as client:
            if is_anthropic:
                # ── Anthropic 协议：/v1/messages，图片用 source.base64 ──
                api_base = base
                if api_base.endswith("/anthropic"):
                    api_base = f"{api_base}/v1"
                elif not api_base.endswith("/v1"):
                    api_base = f"{api_base}/v1"
                body = {
                    "model": vision_cfg["model_name"],
                    "system": system_prompt,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": user_message},
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": attachment.content_type or "image/png",
                                        "data": img_base64,
                                    },
                                },
                            ],
                        }
                    ],
                    "max_tokens": vision_max_tokens,
                    "stream": False,
                }
                headers = {
                    "x-api-key": api_key,
                    "api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                }
                resp = await client.post(f"{api_base}/messages", json=body, headers=headers)
                if resp.status_code != 200:
                    logger.error("Vision(anthropic) model error: %s %s", resp.status_code, resp.text[:300])
                    return {"status": "failed", "tool": "understand_image", "summary": f"视觉模型调用失败（{resp.status_code}）。"}
                data = resp.json()
                # Anthropic 响应：content[].text
                reply_parts: list[str] = []
                for block in (data.get("content") or []):
                    if block.get("type") == "text":
                        reply_parts.append(block.get("text") or "")
                description = "".join(reply_parts)
            else:
                # ── OpenAI 协议：/chat/completions，图片用 image_url ──
                messages_for_vision = [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_message},
                            {"type": "image_url", "image_url": {"url": data_url}},
                        ],
                    },
                ]
                body = {
                    "model": vision_cfg["model_name"],
                    "messages": messages_for_vision,
                    "max_tokens": vision_max_tokens,
                    "stream": False,
                }
                headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
                resp = await client.post(f"{base}/chat/completions", json=body, headers=headers)
                if resp.status_code != 200:
                    logger.error("Vision(openai) model error: %s %s", resp.status_code, resp.text[:300])
                    return {"status": "failed", "tool": "understand_image", "summary": f"视觉模型调用失败（{resp.status_code}）。"}
                data = resp.json()
                description = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        if not description:
            return {"status": "failed", "tool": "understand_image", "summary": "视觉模型未返回内容。"}

        return {
            "status": "completed",
            "tool": "understand_image",
            "summary": f"已理解图片「{attachment.original_name}」的内容。",
            "description": description,
            "image_info": {
                "id": attachment.id,
                "name": attachment.original_name,
                "content_type": attachment.content_type,
                "file_size": attachment.file_size,
            },
        }
    except Exception as exc:
        logger.exception("understand_image failed")
        return {"status": "failed", "tool": "understand_image", "summary": f"图片理解失败：{str(exc)[:200]}"}


async def _silent_understand_images(
    db: Session,
    identity: AuthIdentity,
    attachments: list[StudentAgentAttachment],
) -> dict[int, str]:
    """静默预理解：对当前轮的所有图片附件调用视觉模型，返回 {attachment_id: 描述}。

    设计：不再依赖主模型自主调用 understand_image 工具（会显示活动胶囊且依赖模型自觉），
    而是由 Harness 在组装上下文前预先、静默地调用视觉模型，把描述文本作为隐藏
    上下文喂给主模型。整个过程不发射任何 SSE 活动事件，前端不可见。

    - 视觉模型未配置 → 返回空 dict，主模型按无视觉能力处理（不阻断）。
    - 单张图失败 → 该图描述为空，跳过，不影响其它图。
    """
    image_attachments = [a for a in attachments if (a.content_type or "").startswith("image/")]
    if not image_attachments:
        return {}

    # 视觉模型未配置时直接放弃，避免每张图都走一遍「未配置」分支
    if not _get_vision_config(db, identity.tenant_id):
        logger.info("silent vision skipped: vision model not configured (tenant=%s)", identity.tenant_id)
        return {}

    descriptions: dict[int, str] = {}
    for attachment in image_attachments:
        try:
            result = await _understand_image_tool(db, identity, {"attachment_id": attachment.id}, attachments)
            if result.get("status") == "completed" and result.get("description"):
                descriptions[attachment.id] = result["description"]
                logger.info(
                    "silent vision OK attachment=%s (%s), desc_len=%d",
                    attachment.id, attachment.original_name, len(result["description"]),
                )
            else:
                logger.warning(
                    "silent vision failed attachment=%s: %s",
                    attachment.id, result.get("summary", "unknown"),
                )
        except Exception as exc:  # noqa: BLE001 — 静默预理解不能让单张图异常中断整轮
            logger.exception("silent vision exception attachment=%s: %s", attachment.id, exc)
    return descriptions


# ── Web tools (Jina Reader) ───────────────────────────────────────────────────


async def _read_webpage_tool(args: dict[str, Any]) -> dict[str, Any]:
    """通过 Jina Reader 读取网页内容，返回 Markdown（异步，避免阻塞事件循环）。"""
    url = str(args.get("url") or "").strip()
    if not url:
        return {"status": "failed", "tool": "read_webpage", "summary": "缺少 url 参数。"}
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    max_length = int(args.get("max_length") or 5000)

    try:
        jina_url = f"https://r.jina.ai/{url}"
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(jina_url, headers={"Accept": "text/plain"})
            resp.raise_for_status()
            content = resp.text[:max_length]
        return {
            "status": "completed",
            "tool": "read_webpage",
            "summary": f"已读取网页内容（{len(content)} 字符）。",
            "url": url,
            "content": content,
        }
    except httpx.TimeoutException:
        return {"status": "failed", "tool": "read_webpage", "summary": f"读取超时：{url}"}
    except httpx.HTTPStatusError as exc:
        return {"status": "failed", "tool": "read_webpage", "summary": f"HTTP {exc.response.status_code}：{url}"}
    except Exception as exc:
        logger.warning("read_webpage 失败: %s", exc)
        return {"status": "failed", "tool": "read_webpage", "summary": f"读取失败：{exc}"}


async def _web_search_tool(args: dict[str, Any]) -> dict[str, Any]:
    """联网搜索关键词（异步，避免阻塞事件循环）。优先用 Jina Search API，否则通过 Jina Reader 抓 DuckDuckGo。"""
    import os
    from urllib.parse import quote_plus

    query = str(args.get("query") or "").strip()
    if not query:
        return {"status": "failed", "tool": "web_search", "summary": "缺少 query 参数。"}

    jina_key = os.environ.get("JINA_API_KEY", "")

    # 方式一：Jina Search API（需 API Key）
    if jina_key:
        try:
            async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
                resp = await client.get(
                    f"https://s.jina.ai/{query}",
                    headers={"Accept": "text/plain", "Authorization": f"Bearer {jina_key}"},
                )
                resp.raise_for_status()
                content = resp.text[:8000]
            return {
                "status": "completed",
                "tool": "web_search",
                "summary": f"已搜索「{query}」。",
                "query": query,
                "content": content,
            }
        except Exception:
            logger.debug("Jina Search API 调用失败，回退到 DuckDuckGo")
            pass  # 回退到方式二

    # 方式二：通过 Jina Reader 抓 DuckDuckGo 搜索结果页（免费）
    try:
        ddg_url = f"https://lite.duckduckgo.com/lite/?q={quote_plus(query)}"
        jina_url = f"https://r.jina.ai/{ddg_url}"
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(jina_url, headers={"Accept": "text/plain"})
            resp.raise_for_status()
            content = resp.text[:8000]
        if not content.strip():
            raise ValueError("空内容")
        return {
            "status": "completed",
            "tool": "web_search",
            "summary": f"已搜索「{query}」（DuckDuckGo）。",
            "query": query,
            "content": content,
        }
    except Exception:
        logger.warning("web_search 所有方式均失败: query=%s", query)
        pass  # 回退到方式三

    # 方式三：回退到 read_webpage，让模型用已知 URL 自行补充
    return {
        "status": "partial",
        "tool": "web_search",
        "summary": (
            f"无法直接搜索「{query}」。建议：请学生提供具体网址，使用 read_webpage 工具读取；"
            "或在回复中引导学生自行搜索后粘贴链接。"
        ),
        "query": query,
        "fallback_hint": "read_webpage",
    }



def _query_student_profile(db: Session, identity: AuthIdentity) -> dict[str, Any]:
    student = db.get(StudentUser, identity.user_id)
    if not student or student.tenant_id != identity.tenant_id:
        return {"status": "failed", "tool": "query_student_profile", "summary": "没有找到学生档案。"}

    def load_rows(model) -> list[Any]:
        return list(
            db.scalars(
                select(model)
                .where(
                    model.student_id == identity.user_id,
                    model.tenant_id == identity.tenant_id,
                )
                .order_by(model.sort_order.asc(), model.id.asc())
                .limit(20)
            ).all()
        )

    def text(value: Any, limit: int = 6000) -> Any:
        return value[:limit] if isinstance(value, str) else value

    work_experiences = [
        {
            "company": row.company,
            "position": row.position,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "description": text(row.description),
        }
        for row in load_rows(StudentWorkExperience)
    ]
    projects = [
        {
            "name": row.name,
            "role": row.role,
            "start_date": row.start_date,
            "end_date": row.end_date,
            "link": row.link,
            "link_label": row.link_label,
            "description": text(row.description),
        }
        for row in load_rows(StudentProject)
    ]
    educations = [
        {
            "school": row.school,
            "major": row.major,
            "degree": row.degree,
            "duration": row.duration,
            "gpa": row.gpa,
            "description": text(row.description),
        }
        for row in load_rows(StudentEducation)
    ]
    honors = [
        {
            "title": row.title,
            "level": row.level,
            "award_date": row.award_date,
            "description": text(row.description),
        }
        for row in load_rows(StudentHonor)
    ]
    certifications = [
        {
            "name": row.name,
            "issuer": row.issuer,
            "issue_date": row.issue_date,
            "expire_date": row.expire_date,
            "description": text(row.description),
        }
        for row in load_rows(StudentCertification)
    ]
    skills = [
        {
            "name": row.name,
            "level": row.level,
            "description": text(row.description),
        }
        for row in load_rows(StudentSkill)
    ]

    profile = {
        "name": student.name or "",
        "email": student.email,
        "phone": student.phone,
        "gender": student.gender,
        "age": student.age,
        "birth_date": student.birth_date or "",
        "college": student.college,
        "major": student.major,
        "grade": student.grade,
        "signature": student.signature,
        "resume_avatar_url": student.resume_avatar_url,
        "personal_advantages": text(student.personal_advantages),
        "job_search_status": student.job_search_status,
        "expected_position": student.expected_position,
        "expected_salary": student.expected_salary,
        "expected_location": student.expected_location,
        "work_experiences": work_experiences,
        "projects": projects,
        "educations": educations,
        "honors": honors,
        "certifications": certifications,
        "skills": skills,
    }

    section_counts = {
        "工作/实习经历": len(work_experiences),
        "项目经历": len(projects),
        "教育经历": len(educations),
        "获奖荣誉": len(honors),
        "证书": len(certifications),
        "技能": len(skills),
    }
    loaded_sections = ["基本信息", "求职期望"]
    loaded_sections.extend(f"{label} {count} 条" for label, count in section_counts.items() if count)
    missing_sections = [label for label, count in section_counts.items() if count == 0]

    # 补充关键字段提示（出生日期、毕业时间）
    extra_notes: list[str] = []
    if student.birth_date:
        extra_notes.append(f"出生日期：{student.birth_date}")
    if educations:
        latest_edu = educations[0]
        if latest_edu.get("duration"):
            extra_notes.append(f"最近教育经历时间：{latest_edu['duration']}")
    extra_hint = f"（{', '.join(extra_notes)}）" if extra_notes else ""

    return {
        "status": "completed",
        "tool": "query_student_profile",
        "summary": f"已读取完整个人档案：{'、'.join(loaded_sections)}。{extra_hint}",
        "profile": profile,
        "profile_completeness": {
            "loaded_sections": loaded_sections,
            "empty_sections": missing_sections,
        },
    }


def _get_session_context(db: Session, session: StudentAgentSession, limit: int) -> dict[str, Any]:
    messages = list(
        db.scalars(
            select(StudentAgentMessage)
            .where(StudentAgentMessage.session_id == session.id)
            .order_by(StudentAgentMessage.id.desc())
            .limit(max(1, min(limit, 20)))
        ).all()
    )
    context = [{"role": item.role, "content": item.content[:500]} for item in reversed(messages)]
    return {
        "status": "completed",
        "tool": "get_session_context",
        "summary": f"已回溯 {len(context)} 条会话记录。",
        "messages": context,
    }




def _select_chat_model(
    db: Session,
    tenant_id: int,
    requested_model_id: Optional[int],
    allowed_capabilities: tuple[str, ...] = CHAT_CAPABLE_CAPABILITIES,
) -> Optional[ModelConfig]:
    if requested_model_id:
        model = db.get(ModelConfig, requested_model_id)
        if (
            model
            and model.tenant_id == tenant_id
            and not model.is_deleted
            and model.open_to_student
            and model.capability in allowed_capabilities
            and model.status == "active"
        ):
            return model
        return None

    config = get_or_create_master_config(db, tenant_id)
    if config.model_id:
        model = db.get(ModelConfig, config.model_id)
        if (
            model
            and model.tenant_id == tenant_id
            and not model.is_deleted
            and model.open_to_student
            and model.capability in allowed_capabilities
            and model.status == "active"
        ):
            return model
    return db.scalar(
        select(ModelConfig)
        .where(
            ModelConfig.tenant_id == tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.open_to_student.is_(True),
            ModelConfig.capability.in_(allowed_capabilities),
            ModelConfig.status == "active",
        )
        .order_by(ModelConfig.id.asc())
    )






def _attachment_prompt_text(
    attachments: list[StudentAgentAttachment],
) -> str:
    if not attachments:
        return "无附件。"
    chunks: list[str] = []
    for attachment in attachments:
        is_image = attachment.content_type.startswith("image/")
        if is_image:
            # 图片内容不再内联给主模型；视觉模型已在 Harness 层静默识别，
            # 这里只标记存在性，实际描述见 image_descriptions 拼接。
            body = "（图片，内容见上方视觉模型识别结果；若未提供则表示视觉模型未识别到内容。）"
        else:
            extracted = (attachment.extracted_text or "").strip()[:20000]
            body = f"提取内容:\n{extracted or '未提取到文本内容。'}"
        chunks.append(
            "\n".join(
                [
                    f"附件 {attachment.id}: {attachment.original_name}",
                    f"类型: {attachment.content_type}, 大小: {attachment.file_size} bytes",
                    body,
                ]
            )
        )
    return "\n\n".join(chunks)


def _has_image_attachments(attachments: list[StudentAgentAttachment]) -> bool:
    return any(attachment.content_type.startswith("image/") for attachment in attachments)




# ══════════════════════════════════════════════════════════════════════════════
# Agentic Loop（Model + Harness）—— Model 只提议工具，Harness 负责执行/校验/审计
# ══════════════════════════════════════════════════════════════════════════════

# ── 已弃用的旧面试官聊天入口 ───────────────────────────────────────────────────

INTERVIEWER_SYSTEM_PROMPT = """AI 面试官已升级为独立结构化面试页面。

请引导用户前往「AI 面试官」页面（/student/interviewer）开始正式面试。不要在当前 Agentic Loop 对话里创建面试、追问、评分或生成报告；正式面试只允许通过 /api/v1/student/interviews 独立 API 执行。
"""

INTERVIEWER_ACTIVE_TOOL_NAMES: tuple[str, ...] = ()


def _assemble_tools(db: Session, identity: AuthIdentity, agent_type: str) -> list[ToolDefinition]:
    """统一工具池组装：按 agent_type 决定内置工具白名单和是否加载平台 Skill。"""
    if agent_type == "interviewer":
        active_names = INTERVIEWER_ACTIVE_TOOL_NAMES
    else:
        active_names = ACTIVE_BUILTIN_TOOL_NAMES

    by_name = {tool.name: tool for tool in BUILTIN_TOOLS}
    pool: dict[str, ToolDefinition] = {}
    for name in active_names:
        tool = by_name.get(name)
        if tool:
            pool[name] = tool

    # 简历助手额外加载内置 Skill + 平台 Skill（面试官不需要）
    if agent_type != "interviewer":
        builtin_skill = _builtin_resume_tailor_skill()
        pool[builtin_skill.name] = builtin_skill

        for skill in list_skills(db, include_disabled=False):
            data = serialize_skill(skill)
            name = "skill__" + _tool_safe_name(str(data["slug"]))
            if name in pool:
                continue
            pool[name] = ToolDefinition(
                name=name,
                description=str(data.get("description") or data.get("name") or "Skill 工具"),
                source="skill",
                priority=500,
                input_schema={
                    "type": "object",
                    "properties": {"task": {"type": "string", "description": "交给该 Skill 处理的具体任务。"}},
                    "required": ["task"],
                },
                metadata=data,
            )

    # 设计决策（2026-06）：主智能体不再调用子智能体。任务型能力（简历优化/岗位匹配）做成
    # Skill 由主智能体编排；沉浸型人格（AI 面试官/职业规划师/岗位推荐师）放在「智能体广场」，
    # 由学生直接进入多轮对话——把有状态人格压成一次性工具调用会毁掉其多轮体验。
    return sorted(pool.values(), key=lambda item: (-item.priority, item.name))


# ── AI 简历助手工具池 ──────────────────────────────────────────────────────────
# 仅暴露 Harness 能够「诚实兑现」的工具。会编造结果的占位工具（岗位库 / 知识库 /
# 子智能体 / MCP）在内核稳定前一律不进工具池——对应准则「禁止编造经营结果」。
ACTIVE_BUILTIN_TOOL_NAMES = (
    "query_student_profile",
    "read_resume",
    "analyze_uploaded_file",
    "get_session_context",
    "export_resume_pdf",
    "read_webpage",
    "web_search",
    "generate_resume_data",
    "optimize_resume_data",
    "update_resume_data",
    "apply_resume_patch",
    "analyze_jd_match",
    "save_session_note",
)

_BUILTIN_RESUME_SKILL_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "builtin"
    / "evidence-backed-resume-tailor"
    / "SKILL.md"
)
_BUILTIN_RESUME_SKILL_NAME = "skill__evidence_backed_resume_tailor"


def _builtin_resume_tailor_skill() -> ToolDefinition:
    try:
        content = _BUILTIN_RESUME_SKILL_PATH.read_text(encoding="utf-8")
    except OSError:
        content = (
            "# 证据约束订制简历\n"
            "只允许使用个人档案、用户指定简历和本轮附件中的事实；JD 只能用于匹配和排序，"
            "不得新增经历、技能、技术栈、职责、指标或成果。"
        )
    return ToolDefinition(
        name=_BUILTIN_RESUME_SKILL_NAME,
        description=(
            "订制简历或根据 JD 优化简历时必须先调用。建立事实清单、JD 优先级和证据匹配矩阵，"
            "只选择、排序和保守改写有来源内容，禁止补造技能、项目、经历和指标。"
        ),
        source="skill",
        priority=985,
        input_schema={
            "type": "object",
            "properties": {
                "task": {
                    "type": "string",
                    "description": "本次订制任务，例如目标岗位、已有材料和希望重点优化的模块。",
                }
            },
            "required": ["task"],
        },
        metadata={
            "slug": "evidence-backed-resume-tailor",
            "name": "证据约束订制简历",
            "version": "1.0.0",
            "category": "简历求职",
            "kind": "resume_skill",
            "risk": "allow",
            "trusted_builtin": True,
            "content": content,
        },
    )


def _resume_skill_prerequisite_failure(
    name: str,
    completed_tools: set[str],
    session: Optional[StudentAgentSession] = None,
) -> Optional[dict[str, Any]]:
    if name not in {"generate_resume_data", "optimize_resume_data", "export_resume_pdf"}:
        return None
    if _BUILTIN_RESUME_SKILL_NAME not in completed_tools:
        return {
            "status": "failed",
            "tool": name,
            "error_code": "resume_tailor_skill_required",
            "recoverable": True,
            "summary": (
                "Harness 已阻止写入：订制或优化简历前必须先调用「证据约束订制简历」Skill，"
                "完成事实清单、JD 优先级和证据匹配矩阵后再保存。"
            ),
            "display_summary": "正在先梳理你的真实经历和岗位要求",
        }
    # optimize 场景额外要求：必须已提交 JD 分析
    if name == "optimize_resume_data" and session and not getattr(session, "jd_text", None):
        return {
            "status": "failed",
            "tool": name,
            "error_code": "jd_analysis_required",
            "recoverable": True,
            "summary": (
                "Harness 已阻止保存：请先调用 analyze_jd_match 提交目标岗位 JD 的结构化分析"
                "（P0/P1 需求、证据匹配矩阵），再调用 optimize_resume_data 生成优化版简历。"
            ),
            "display_summary": "正在先分析目标岗位的要求",
        }
    return None


def assemble_active_tools(db: Session, identity: AuthIdentity) -> list[ToolDefinition]:
    """组装工具池：内置工具白名单 + 平台可信 Skill + 管理端启用 Skill。"""
    return _assemble_tools(db, identity, "resume")


def assemble_interviewer_tools(db: Session, identity: AuthIdentity) -> list[ToolDefinition]:
    """AI 面试官精简工具池：只读取学生信息，不包含生成/修改简历类工具。"""
    return _assemble_tools(db, identity, "interviewer")


def _build_openai_tools(tool_defs: list[ToolDefinition]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": (tool.description or "")[:1024],
                "parameters": tool.input_schema or {"type": "object", "properties": {}},
            },
        }
        for tool in tool_defs
    ]


RESUME_DEFAULT_SYSTEM_PROMPT = (
    "你是 CareerForge 的 AI 简历助手，负责协助学生规划求职和优化简历。\n\n"
    "你的工作方式（ReAct 范式）：\n"
    "1. Reason：分析学生意图，判断需要调用哪个工具\n"
    "2. Act：调用对应工具，传递清晰的参数\n"
    "3. Observe：接收工具返回的结果\n"
    "4. 重复或综合：继续调用工具或直接向学生输出最终回答\n\n"
    "原则：\n"
    "- 自我介绍时请说你是「AI简历助手」，不要提及任何技术架构或内部角色名称\n"
    "- 简历是唯一事实来源，禁止编造任何经历、项目或数据\n"
    "- 无合适工具时，直接以友好方式回答学生"
)


def _harness_system_prompt(config: Any, reasoning_effort: str, agent_type: str = "resume") -> str:
    if agent_type == "interviewer":
        return INTERVIEWER_SYSTEM_PROMPT
    persona = (getattr(config, "system_prompt", None) or RESUME_DEFAULT_SYSTEM_PROMPT).strip()
    effort = _effort_instruction(reasoning_effort)
    rules = (
        "\n\n## 运行机制（Harness 管控，必须遵守）\n"
        "- 你只负责理解需求、规划步骤、选择工具、综合结果；工具的执行、校验与权限由 Harness 负责，你无需也不能自行控制循环。\n"
        "- 工具纪律：只能调用系统提供给你的工具，并严格按其参数 schema 传参；不要臆测不存在的能力，也不要伪造任何工具的返回结果。\n"
        "- 反幻觉铁律：禁止编造学生的简历内容、经历、项目、岗位、公司、时间、职责、技术栈、成果、数字或任何数据。"
        "个人档案、用户明确指定的已有简历和本轮上传的简历文件是唯一事实来源；JD、网页、模板示例、常识和模型记忆都不是学生事实。\n"
        "- 空字段必须保持为空：个人档案中的空数组或空字段表示学生尚未填写，绝不能为了让简历完整而补齐。"
        "可以调整已有事实的顺序和表达，但不能增加原文没有的新事实、新技能、新指标或新经历。资料不足时明确列出缺少项并请学生补充。\n"
        "- 写入保护：generate_resume_data 会忽略模型提交的事实字段并由服务端从个人档案重建；"
        "optimize_resume_data、apply_resume_patch、update_resume_data 和 export_resume_pdf 共享同一套事实核验契约——关键实体（公司名、学校名、职位、项目名、时间段、技术栈、数字指标）必须在证据中有据，但允许改写表达、动词、STAR 结构和措辞优化。校验失败后不得换一种说法绕过校验。\n"
        "- 像 Codex 改代码一样工作：先根据用户意图生成或保存一个可编辑版本，然后围绕当前工作简历持续精修。"
        "用户说『再改一下/精修/弱一点/强一点/突出某能力/删掉某段/换个语气』时，默认是在改当前工作简历；"
        "必须先 read_resume 读取当前版本，再调用 apply_resume_patch 保存，不要只给建议、不落盘。只有需要整段替换完整章节时才用 update_resume_data 兜底。\n"
        "- 订制 Skill：只要用户提供 JD 或要求『订制/针对岗位/ATS 优化/岗位匹配后改简历』，"
        "必须先调用 skill__evidence_backed_resume_tailor，再按其事实清单、JD 优先级、证据矩阵和保存前自检流程执行；"
        "然后调用 analyze_jd_match 提交结构化 JD 分析（P0/P1 需求、证据矩阵）；"
        "不得直接跳到 generate_resume_data、optimize_resume_data 或 export_resume_pdf。\n"
        "- 简历相关：给出简历修改建议、或对已有简历进行优化/导出时，必须先调用 read_resume 读取学生的真实简历；"
        "若 read_resume 返回无简历，告知学生并引导其在『简历助手』中新建，绝不虚构内容。\n"
        "- AI 简历制作流程（全新生成，无需 read_resume）：\n"
        "  ▸ 条件判断——先检查本轮及历史消息中是否已有 JD（含岗位职责/任职要求/招聘内容等）：\n"
        "    · 若已提供 JD：直接调用 query_student_profile + generate_resume_data 生成简历，\n"
        "      禁止再次索要 JD，禁止重复输出与历史回复相同的内容。\n"
        "    · 若未提供 JD：调用 query_student_profile 后回复：『已读取您的个人信息，请提供目标岗位的 JD（职位描述）』。\n"
        "  ▸ 工具返回后不要在正文中输出任何链接或 URL——系统会自动在消息下方渲染「查看简历」按钮。正文里用一句话引导即可，例如：简历已生成，点击下方按钮查看并编辑。\n"
        "- 简历优化流程（以工作简历为源 + JD）：\n"
        "  ▸ 前提：学生已在简历中心导入或创建在线简历，并通过工作区选择器绑定为当前工作简历。\n"
        "  ▸ 条件判断——先检查本轮及历史消息中是否已有 JD：\n"
        "    · 若已提供 JD：直接进入优化，禁止再次索要 JD。\n"
        "    · 若未提供 JD：索要 JD 后再继续。\n"
        "  ▸ 读取工作简历：调用 read_resume 获取全文（工作简历已在上方工作区状态中标注）；\n"
        "    · 若未绑定工作简历：先调 read_resume 看列表——有简历就引导选择，一份都没有就引导『先到简历中心上传或创建简历』，不要让用户在对话里上传简历文件。\n"
        "  ▸ 获得简历和 JD 后，先调用 analyze_jd_match 提交结构化 JD 分析，再在回复中输出匹配摘要（SUPPORTED/PARTIAL/GAP 各几条），\n"
        "    再调用 optimize_resume_data（title/basic 必填）将优化版本保存到学生的「简历制作」模块；\n"
        "    工具返回后不要在正文中输出任何链接或 URL——系统会自动在消息下方渲染「查看简历」按钮。正文里用一句话引导即可，例如：简历已优化完成，点击下方按钮查看并编辑。\n"
        "- 软引导：用户在对话中上传疑似简历的 PDF/DOCX 时：可以用 analyze_uploaded_file 读取并即时点评，\n"
        "  但不要基于它调用 optimize/generate 生成新简历；同时告知用户把简历导入简历中心（路径：简历制作 → 导入简历），\n"
        "  导入后选为工作简历即可持续优化。\n"
        "- 图片分析：用户发送图片（如截图、拍照、扫描件）时，先仔细观察图片内容，再根据内容决定下一步——\n"
        "  · 简历图片：点评内容、指出可优化的点，若学生想优化则引导导入简历中心；\n"
        "  · JD 截图：提取岗位要求并据此订制简历；\n"
        "  · 其他图片：描述内容后主动询问学生想做什么，不要只回复「收到图片」就结束。\n"
        "- 简历写作标准（generate/optimize/apply_patch/update/export 均适用，共享同一套事实来源契约）：\n"
        "  · 经历/项目每条描述尽量以真实强动词开头。优先使用「实现、完成、优化、搭建、设计、开发、整理、分析、封装」；"
        "不要为了显得更强把「参与」升级成「主导/独立负责/从0到1」，强动词不等于角色升级；\n"
        "  · 尽量采用 STAR 格式：【背景/规模】→【具体行动】→【可量化结果】，"
        "原材料中有数字（性能提升%、用户量、团队人数、金额）必须保留；\n"
        "  · ATS 优化：experience/projects 的 details/description 字段和 skills 字段须自然地覆盖 JD 中出现的核心技术关键词；\n"
        "  · 自我评价控制在 2-3 句，重点突出与 JD 最匹配的核心能力，不写泛泛的「认真负责」「吃苦耐劳」；\n"
        "  · 没有具体数字时，用规模描述（「百万级 DAU」「10+ 人跨部门」）替代空洞形容词；\n"
        "  · 同一份简历中时间格式统一为 YYYY-MM（如 2022-06），不保留具体日期，勿混用。\n"
        "- 修改已有在线简历：优先调用 apply_resume_patch 做小步修改并自动 review；只有需要替换完整章节时才调用 update_resume_data。完成后不要在正文中输出任何链接或 URL——系统会自动在消息下方渲染「查看简历」按钮。\n"
        "- 修改简历前必须基于最近一次 read_resume 的内容做最小变更，禁止凭记忆重写整个章节。"
        "传入 read_resume 时拿到的 updated_at 作为 base_updated_at 参数，用于版本检查。\n"
        "- 生成可下载简历：当学生需要『修改好的 / 可下载的简历』时，先基于真实简历完成改写，再调用 "
        "export_resume_pdf（传入完整的 Markdown 简历正文）生成 PDF。注意 export_resume_pdf 也受事实核验约束，禁止用 export 绕过 optimize 的校验。"
        "不要在回复正文中内嵌下载链接（签名链接 10 分钟后过期），提示学生查看下方的文件卡片下载即可。\n"
        "- 沉浸式专家：当学生需要『模拟面试 / AI 面试官』『职业规划咨询』『岗位推荐』等多轮、有人格的沉浸体验时，"
        "你不要自己扮演，而是引导学生前往『智能体广场』进入对应的专属智能体（那里才是多轮对话的入口）。\n"
        "- 联网工具：当学生发来 URL 链接或需要查看网页内容时，调用 read_webpage 读取；"
        "当需要搜索公司信息、行业动态等实时数据时，调用 web_search 搜索。"
        "如果搜索失败，引导学生自行搜索后粘贴链接，再用 read_webpage 读取。\n"
        "- 会话记忆：当用户提出约束（「不要写 XX」「语气克制」）、口述新经历（「我做过 XX 项目」）或表达偏好（「以后直接改不用问」）时，"
        "调用 save_session_note 保存。这些记忆在整个会话中持续有效，违反任何约束都算严重错误。\n"
        "- 用户提出过的禁止项和偏好（见「本会话已确认的事实与约束」清单）在整个会话中持续有效，"
        "违反任何一条都算严重错误——即使用户自己后来忘了，你也不能忘。\n"
        "- 行动准则（写操作「先说后做」）：\n"
        "  ▸ 调用 generate/optimize/apply_resume_patch/update_resume_data 或 export_resume_pdf 前，先用 1-2 句话预告（改哪份简历、改什么章节、为什么）；\n"
        "  ▸ 用户最新消息是明确指令（「帮我加进去」「改吧」「优化一下」）→ 说完直接动手，不要再追问确认；\n"
        "  ▸ 用户只是提供信息或闲聊（「我做过一个 XX 项目」「我还会 Python」）→ 不得直接改简历，先复述理解 + 给出建议方案，问「要我直接更新到简历里吗？」；\n"
        "  ▸ 用户表达过「以后直接改不用问」（已存入偏好）→ 本会话内豁免第 3 条，收到信息后直接动手。\n"
        "- JD 匹配铁律：\n"
        "  ▸ JD 匹配分析中标记为 GAP 的项（缺失能力/技能/经历），**禁止以任何形式写入简历正文**；\n"
        "  ▸ GAP 项只能出现在给用户的差距分析说明中，并建议用户补充相关经历或学习计划；\n"
        "  ▸ 若用户坚持要求写入 GAP 项，明确告知风险：「这部分在你的档案中没有依据，写入简历后在面试中可能被追问」；\n"
        "  ▸ 违反此规则等同于简历造假。\n"
        "- 输出规范：使用 Markdown，先结论后步骤；不要输出工具调用的原始 JSON、tool_call 或隐藏推理过程。\n"
        "- 输出节奏：动手前一句话预告（如「帮你把项目经历加到简历里」），动完两三句总结（改了什么 + 引导去看链接）；"
        "禁止动手前后输出大段分析或内心独白，禁止把内部修正过程（如校验失败重试、格式调整）写给用户。"
        "中文、口语化，像朋友帮忙而非写报告。\n"
        f"- 推理强度：{effort}"
    )
    return persona + rules


# ── D2: 上下文压缩（token 预算触发，替换式摘要）──────────────────────────────

# 压缩阈值：上下文预算使用率超过此值时触发压缩
_COMPRESS_THRESHOLD = 0.70
# 安全余量：从 context_length 中扣除的百分比（留给函数调用开销等）
_SAFETY_MARGIN = 0.15
# 长消息转存阈值
_LONG_MSG_THRESHOLD = 8000


def _estimate_message_tokens(messages: list[dict[str, Any]], openai_tools: Optional[list[dict[str, Any]]] = None) -> int:
    """粗粒度 token 估算。中文按 chars/1.5，英文按 words/0.75，取混合值 chars/1.2。"""
    total_chars = 0
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    total_chars += len(part.get("text", ""))
    # 工具 schema 实算（11 个工具约 2-4k token）
    tools_chars = len(json.dumps(openai_tools)) if openai_tools else 0
    return int((total_chars + tools_chars) / 1.2)


def _context_budget(model: ModelConfig) -> int:
    """计算可用 token 预算：context_length - max_output - 安全余量。"""
    ctx = model.context_length or 32000
    max_out = model.max_output or 4096
    return int((ctx - max_out) * (1 - _SAFETY_MARGIN))


async def _compress_context(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    model: ModelConfig,
    config: Any,
    user_text: str = "",
    reasoning_effort: str = "medium",
    attachments: Optional[list[StudentAgentAttachment]] = None,
    agent_type: str = "resume",
    openai_tools: Optional[list[dict[str, Any]]] = None,
    emit_event: Any = None,
    image_descriptions: Optional[dict[int, str]] = None,
) -> tuple[list[dict[str, Any]], bool]:
    """上下文压缩：组装 → 估算 → 超阈值则压缩 → 重新组装。

    返回 (messages, compressed)。compressed=True 表示发生了压缩。
    emit_event 可选，用于发送 runtime.status 事件（RunManager 路径）。
    """
    # 第一次组装，估算 token
    messages = _build_initial_messages(
        db, identity, session, user_text, reasoning_effort, model, attachments or [], config,
        agent_type=agent_type, image_descriptions=image_descriptions,
    )
    estimated = _estimate_message_tokens(messages, openai_tools)
    budget = _context_budget(model)

    if estimated <= budget * _COMPRESS_THRESHOLD:
        return messages, False  # 未超阈值，不需要压缩

    logger.info("上下文压缩触发 session=%s estimated=%d budget=%d threshold=%d",
                session.id, estimated, budget, int(budget * _COMPRESS_THRESHOLD))

    if emit_event:
        await emit_event("runtime.status", {"label": "对话较长，正在整理早前内容…", "phase": "compressing"})

    # 取水位之后、最近 K 轮之前的消息
    recent_turns = getattr(config, "agent_context_recent_turns", None) or _AGENT_CONTEXT_RECENT_TURNS
    watermark = getattr(session, "summarized_until_message_id", None)

    old_query = (
        select(StudentAgentMessage)
        .where(
            StudentAgentMessage.session_id == session.id,
            StudentAgentMessage.role.in_(("user", "assistant")),
        )
        .order_by(StudentAgentMessage.id.asc())
        .limit(200)
    )
    if watermark:
        old_query = old_query.where(StudentAgentMessage.id > watermark)

    all_msgs = list(db.scalars(old_query).all())
    # 排除最近 K 轮（保留完整上下文）
    cutoff = max(0, len(all_msgs) - recent_turns * 2)
    old_msgs = all_msgs[:cutoff]

    if len(old_msgs) < 2:
        logger.info("可压缩消息不足，跳过 session=%s", session.id)
        return messages, False

    # 构建压缩 prompt
    conv_lines = []
    for msg in old_msgs:
        prefix = "学生" if msg.role == "user" else "AI"
        conv_lines.append(f"{prefix}: {msg.content[:500]}")

    # 排除记忆里已有的内容（constraints/preferences），避免重复
    memory_exclusion = ""
    try:
        mem = json.loads(getattr(session, "memory_json", None) or "{}")
        constraints = mem.get("constraints") or []
        preferences = mem.get("preferences") or []
        if constraints or preferences:
            exclusion_parts = []
            if constraints:
                exclusion_parts.append("约束：" + "；".join(constraints[:5]))
            if preferences:
                exclusion_parts.append("偏好：" + "；".join(preferences[:5]))
            memory_exclusion = f"\n\n以下内容已单独记录，摘要中不要重复：\n" + "\n".join(exclusion_parts)
    except Exception:
        pass

    # 工作简历绑定信息也排除
    resume_exclusion = ""
    if getattr(session, "active_resume_id", None):
        resume_exclusion = f"\n工作简历绑定（id={session.active_resume_id}）已单独记录，无需在摘要中重复。"

    old_summary = session.summary or ""
    summary_input = "\n".join(conv_lines)
    summary_prompt = (
        "请将以下旧摘要与新增对话合并为一份 3-8 句的替换式摘要。"
        "保留：学生的目标岗位、已确认的决定、已完成的简历操作、未完成的待办。"
        "不要逐条罗列，用连贯的叙述。用中文，简洁明了。"
        f"{memory_exclusion}{resume_exclusion}"
    )
    if old_summary:
        summary_prompt += f"\n\n## 旧摘要\n{old_summary}"
    summary_prompt += f"\n\n## 新增对话\n{summary_input}"

    # 调用低 effort 模型生成摘要
    from app.admin.model_service import decrypt_api_key
    from app.core.llm_client import is_anthropic_model

    api_key = decrypt_api_key(model.api_key_cipher)
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    base_url = (model.base_url or "https://api.openai.com/v1").rstrip("/")
    is_anthropic = is_anthropic_model(model.model_identifier)

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            if is_anthropic:
                resp = await client.post(
                    f"{base_url}/v1/messages",
                    headers={**headers, "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    json={
                        "model": model.model_identifier,
                        "max_tokens": 400,
                        "messages": [{"role": "user", "content": summary_prompt}],
                    },
                )
                resp.raise_for_status()
                new_summary = resp.json().get("content", [{}])[0].get("text", "")
            else:
                resp = await client.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json={
                        "model": model.model_identifier,
                        "messages": [{"role": "user", "content": summary_prompt}],
                        "max_tokens": 400,
                    },
                )
                resp.raise_for_status()
                new_summary = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")

        if new_summary and len(new_summary.strip()) > 20:
            # 替换式：覆盖旧摘要（不追加）
            session.summary = new_summary.strip()[:2000]
            # 推进水位到最后一条被压缩的消息
            last_compressed = old_msgs[-1] if old_msgs else None
            if last_compressed:
                session.summarized_until_message_id = last_compressed.id
            db.commit()
            db.refresh(session)
            logger.info("上下文压缩完成 session=%s old_msgs=%d new_summary_len=%d",
                        session.id, len(old_msgs), len(new_summary))
        else:
            logger.warning("摘要生成结果过短，跳过压缩 session=%s", session.id)
            return messages, False
    except Exception as exc:
        logger.warning("上下文压缩 LLM 调用失败 session=%s: %s", session.id, exc)
        return messages, False

    # 重新组装消息（水位已推进，旧消息会被过滤掉）
    rebuilt = _build_initial_messages(
        db, identity, session, user_text, reasoning_effort, model, attachments or [], config,
        agent_type=agent_type, image_descriptions=image_descriptions,
    )
    return rebuilt, True


def _build_initial_messages(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_text: str,
    reasoning_effort: str,
    model: ModelConfig,
    attachments: list[StudentAgentAttachment],
    config: Any,
    agent_type: str = "resume",
    image_descriptions: Optional[dict[int, str]] = None,
) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": _harness_system_prompt(config, reasoning_effort, agent_type)}
    ]

    # JD 持久化注入：绕过历史截断，确保 JD 全文始终在上下文中
    if getattr(session, "jd_text", None):
        messages.append({
            "role": "system",
            "content": (
                f"## 学生已提供的目标岗位 JD\n{session.jd_text}\n\n"
                "以上是学生已经提供的完整岗位描述。禁止再次索要 JD；"
                "本轮必须直接分析岗位要求并推进简历生成或优化流程。"
            ),
        })

    # D2: 滚动摘要注入
    if getattr(session, "summary", None):
        messages.append({
            "role": "system",
            "content": f"## 早前对话摘要\n{session.summary}",
        })

    # 工作简历状态注入（A2）
    if agent_type == "resume":
        active_resume_id = getattr(session, "active_resume_id", None)
        if active_resume_id:
            resume_row = db.scalar(
                select(StudentResume).where(
                    StudentResume.id == active_resume_id,
                    StudentResume.tenant_id == identity.tenant_id,
                    StudentResume.student_id == identity.user_id,
                )
            )
            if resume_row:
                updated_str = resume_row.updated_at.strftime("%Y-%m-%d %H:%M") if resume_row.updated_at else "未知"
                messages.append({
                    "role": "system",
                    "content": (
                        f"当前工作简历：《{resume_row.title}》(id={resume_row.id}，最后更新 {updated_str})。"
                        f"需要内容时先调用 read_resume，不要凭记忆。"
                    ),
                })
            else:
                # 绑定的简历已被删除，清空绑定
                session.active_resume_id = None
                db.commit()
                messages.append({
                    "role": "system",
                    "content": "之前绑定的工作简历已被删除，请告知用户重新选择要编辑的简历。",
                })
        else:
            messages.append({
                "role": "system",
                "content": "尚未确定要编辑哪份简历，动手前必须先和用户确认目标。",
            })

    # C1: 会话记忆注入（pinned，永不被截断挤掉）
    if agent_type == "resume":
        try:
            memory = json.loads(getattr(session, "memory_json", None) or "{}")
        except Exception:
            memory = {}
        memory_parts = []
        constraints = memory.get("constraints") or []
        facts = memory.get("facts") or []
        preferences = memory.get("preferences") or []
        if constraints:
            memory_parts.append("## 已确认约束（必须持续遵守）\n" + "\n".join(f"- {c}" for c in constraints))
        if facts:
            memory_parts.append("## 用户口述的新经历\n" + "\n".join(f"- {f}" for f in facts))
        if preferences:
            memory_parts.append("## 用户偏好\n" + "\n".join(f"- {p}" for p in preferences))
        if memory_parts:
            messages.append({
                "role": "system",
                "content": "## 本会话已确认的事实与约束\n\n" + "\n\n".join(memory_parts),
            })

    # G3: 档案完整度引导（缺项时注入，省 token）
    if agent_type == "resume":
        try:
            from app.student.profile_details_models import (
                StudentEducation as _G3Edu,
                StudentProject as _G3Proj,
                StudentSkill as _G3Skill,
                StudentWorkExperience as _G3Work,
            )
            student = db.get(StudentUser, identity.user_id)
            missing_items = []
            if student and not (student.name or "").strip():
                missing_items.append("姓名")
            if not db.scalar(select(_G3Edu.id).where(_G3Edu.student_id == identity.user_id, _G3Edu.tenant_id == identity.tenant_id).limit(1)):
                missing_items.append("教育经历")
            if not db.scalar(select(_G3Work.id).where(_G3Work.student_id == identity.user_id, _G3Work.tenant_id == identity.tenant_id).limit(1)):
                if not db.scalar(select(_G3Proj.id).where(_G3Proj.student_id == identity.user_id, _G3Proj.tenant_id == identity.tenant_id).limit(1)):
                    missing_items.append("工作经历或项目经历")
            if not db.scalar(select(_G3Skill.id).where(_G3Skill.student_id == identity.user_id, _G3Skill.tenant_id == identity.tenant_id).limit(1)):
                missing_items.append("技能")
            if missing_items:
                messages.append({
                    "role": "system",
                    "content": (
                        f"学生档案目前缺少：{'、'.join(missing_items)}。"
                        "涉及简历生成/优化时，先建议用户到『个人中心 → 个人资料』补充对应内容，"
                        "**不要凭空编造**，也不要在对话里逐条追问代替档案填写。"
                    ),
                })
        except Exception:
            pass  # 档案查询失败不阻塞主流程

    # D1: 分层上下文 — 最近 K 轮完整，更早的截断
    recent_turns = getattr(config, "agent_context_recent_turns", None) or _AGENT_CONTEXT_RECENT_TURNS
    history_limit = getattr(config, "agent_context_history_limit", None) or _AGENT_CONTEXT_HISTORY_LIMIT
    msg_char_cap = getattr(config, "agent_context_msg_char_cap", None) or _AGENT_CONTEXT_MSG_CHAR_CAP

    # D2 水位过滤：跳过已被摘要压缩的旧消息（id > summarized_until_message_id）
    # 必须条件判断——id > NULL 在 SQL 里返回 NULL，会导致所有行不匹配，历史直接消失
    history_query = (
        select(StudentAgentMessage)
        .where(StudentAgentMessage.session_id == session.id)
        .order_by(StudentAgentMessage.id.desc())
        .limit(history_limit)
    )
    watermark = getattr(session, "summarized_until_message_id", None)
    if watermark:
        history_query = history_query.where(StudentAgentMessage.id > watermark)
    history_rows = list(db.scalars(history_query).all())
    history_rows.reverse()

    # 最近 K 轮 = 2*K 条消息（user + assistant 成对）
    recent_cutoff = max(0, len(history_rows) - 1 - recent_turns * 2)

    for idx, msg in enumerate(history_rows[:-1]):
        if msg.role not in ("user", "assistant"):
            continue
        text = msg.content
        if idx < recent_cutoff:
            # 更早的消息：更激进的截断
            if len(text) > 1500:
                text = text[:1500] + "\n…[已截断]"
        else:
            # 最近 K 轮：保留较完整内容
            if len(text) > msg_char_cap:
                text = text[:msg_char_cap] + "\n…[已截断]"
        messages.append({"role": msg.role, "content": text})

    # 设计决策（2026-06）：视觉理解改为「Harness 静默预理解」。
    # 不再向主模型内联图片二进制，也不再提示它调用 understand_image 工具——
    # 主模型统一只读视觉模型返回的文字描述（见下方 image_descriptions 拼接）。
    image_desc_map = image_descriptions or {}
    has_image_desc = bool(image_desc_map)
    # 用户只发图片/附件、未输入任何文字时，给模型一句内部引导让它主动分析
    # （用户在气泡里看不到——气泡只渲染图片缩略图，见前端 image-only 分支）。
    effective_user_text = user_text
    if not user_text.strip() and attachments:
        effective_user_text = "用户未输入文字，只上传了附件。请直接分析附件内容并给出有价值的总结与建议，不要反问用户「需要我做什么」。"
    parts = [effective_user_text]
    if attachments:
        parts.append("\n---\n**本轮附件**\n" + _attachment_prompt_text(attachments))
    # 把视觉模型对图片的描述拼进上下文（若有），让主模型直接基于描述回复。
    if has_image_desc:
        desc_lines = ["", "**图片内容（视觉模型识别结果，可直接引用）**"]
        for att in attachments:
            if (att.content_type or "").startswith("image/") and att.id in image_desc_map:
                desc_lines.append(f"- 图片「{att.original_name}」：{image_desc_map[att.id]}")
        parts.append("\n".join(desc_lines))
    current_text = "\n".join(parts)

    # 长消息转存：当前轮消息超长时，识别为 JD 存入 session.jd_text，
    # 正文只留摘录 + 提示模型按需取全文。不能截断——用户刚粘贴的 JD 是核心输入。
    _LONG_MSG_THRESHOLD = 8000
    if len(current_text) > _LONG_MSG_THRESHOLD:
        is_jd = any(kw in current_text for kw in ("岗位职责", "任职要求", "职位描述", "工作职责", "任职资格"))
        if is_jd and not getattr(session, "jd_text", None):
            session.jd_text = current_text[:20000]
            db.commit()
            excerpt = current_text[:1500] + "\n\n…[JD 全文已保存，后续可随时引用]"
            current_text = excerpt
            logger.info("长 JD 转存到 session.jd_text session=%s len=%d", session.id, len(session.jd_text))
        elif len(current_text) > _LONG_MSG_THRESHOLD * 2:
            # 非 JD 但极端长：截断 + 提示
            current_text = current_text[:_LONG_MSG_THRESHOLD] + "\n\n…[内容过长已截断，请分段发送或上传为附件]"
            logger.info("极端长消息截断 session=%s original_len=%d", session.id, len(parts[0]))

    # 主模型只读文字描述（视觉模型已在 Harness 层静默完成识别），
    # 因此当前轮始终以纯文本 user 消息发送，不再内联图片或提示调用工具。
    messages.append({"role": "user", "content": current_text})
    return messages


async def run_agent_loop(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_message: StudentAgentMessage,
    assistant_message: StudentAgentMessage,
    model: ModelConfig,
    messages: list[dict[str, Any]],
    openai_tools: list[dict[str, Any]],
    registry: dict[str, ToolDefinition],
    attachments: list[StudentAgentAttachment],
    reasoning_effort: str,
    max_iterations: int,
    permission_mode: str = "ask",
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    request_id: str = "",
) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """The harness-owned ReAct loop. Yields (sse_event_name, data) tuples."""
    req_id = request_id or _req_id()
    assistant_id = assistant_message.id
    run_started = time.monotonic()
    usage_totals = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    cumulative_output_chars = 0

    def runtime_payload() -> dict[str, Any]:
        return {
            "message_id": assistant_id,
            "model_name": model.display_name or model.model_identifier,
            **usage_totals,
            "duration_ms": max(0, int((time.monotonic() - run_started) * 1000)),
        }

    def add_usage(value: dict[str, Any]) -> None:
        usage = value.get("usage") or {}
        for key in usage_totals:
            usage_totals[key] += int(usage.get(key) or 0)

    deadline = time.monotonic() + 300  # 5 分钟总超时
    logger.info("agent_loop start", extra=_log_ctx(request_id=req_id, session_id=session.id, model=model.model_identifier, max_iter=max_iterations))

    completed_tools: set[str] = set()
    evidence_pool = SessionEvidencePool()
    # P1.1: 跨轮恢复证据来源索引——让 per-run 的证据池换轮后能懒重读、
    # 不丢 JD 分析的 GAP 关键词（防止下轮误把 GAP 项写回简历）。
    _persisted_index_json = getattr(session, "evidence_index_json", None)
    if _persisted_index_json:
        evidence_pool.restore_source_index(EvidenceSourceIndex.from_json(_persisted_index_json))
    # Phase 2.3: 将用户消息自动写入证据池（对话内容天然是合法事实来源）
    if user_message.content:
        evidence_pool.add_attachment_text("对话内容", user_message.content)
    # 恢复 session 持久化的 JD 到 evidence_pool（跨轮复用）
    if getattr(session, "jd_text", None):
        evidence_pool.set_jd(session.jd_text, [])
    # JD 兜底识别：以用户最近一次粘贴的完整 JD 为准。
    detected_jd = user_message.content[:8000]
    if user_message.content and _looks_like_jd(user_message.content) and session.jd_text != detected_jd:
        session.jd_text = detected_jd  # type: ignore[attr-defined]
        db.commit()
        logger.info("JD auto-detected and saved", extra=_log_ctx(request_id=req_id, session_id=session.id, jd_len=len(session.jd_text)))
    # 工具结果字符预算跟踪（本轮所有工具结果总和）
    tool_result_budget_used = 0
    # P3: 心跳节流——同 phase 的心跳至少间隔 1.5s，phase 切换立即发送，
    # 避免 LLM 流式输出时 progress 事件洪流压垮 SSE 通道。
    _HEARTBEAT_MIN_INTERVAL = 1.5
    last_heartbeat_phase: str = ""
    last_heartbeat_ts: float = 0.0
    for iteration in range(max_iterations):
        if time.monotonic() > deadline:
            logger.warning("agent_loop timeout", extra=_log_ctx(request_id=req_id, session_id=session.id, iteration=iteration))
            yield "message.delta", {"message_id": assistant_id, "delta": "回复超时，请重试"}
            yield "runtime.completed", runtime_payload()
            return
        turn_content = ""
        turn_tool_calls: list[dict[str, Any]] = []
        turn_error = False
        streamed_any = False  # 是否已向客户端输出过任何 delta（用于判断是否可安全重试）
        first_delta_emitted = False

        yield "runtime.status", {
            "message_id": assistant_id,
            "phase": "thinking",
            "label": "正在理解你的需求…" if iteration == 0 else "正在结合已有信息继续分析…",
            "iteration": iteration + 1,
        }
        # 缓冲 delta：工具轮次的推理过程不展示给用户，只在最终回复轮次实时 yield。
        # 部分模型（如 DeepSeek）会在 tool_calls 旁输出 Reason/Act/Observe 文本，
        # 这些是内部推理过程，不应泄露到前端。
        turn_delta_parts: list[str] = []
        turn_has_tool_calls_so_far = False
        async for kind, value in _stream_llm_turn(
            model, messages, openai_tools, reasoning_effort, temperature, max_tokens
        ):
            if kind == "delta":
                streamed_any = True
                turn_delta_parts.append(value)
                if not turn_has_tool_calls_so_far:
                    if not first_delta_emitted:
                        first_delta_emitted = True
                        yield "runtime.status", {
                            "message_id": assistant_id,
                            "phase": "writing",
                            "label": "正在撰写回复…",
                            "iteration": iteration + 1,
                        }
                    yield "message.delta", {"message_id": assistant_id, "delta": value}
            elif kind == "tool_call_start":
                if not turn_has_tool_calls_so_far:
                    turn_has_tool_calls_so_far = True
                    if turn_delta_parts and first_delta_emitted:
                        yield "message.snapshot", {"message_id": assistant_id, "content": ""}
            elif kind == "error":
                turn_error = True
            elif kind == "progress":
                # P3: 心跳节流——phase 切换立即发，同 phase 至少间隔 _HEARTBEAT_MIN_INTERVAL。
                _hb_phase = value["phase"]
                _now = time.monotonic()
                if _hb_phase != last_heartbeat_phase or _now - last_heartbeat_ts >= _HEARTBEAT_MIN_INTERVAL:
                    last_heartbeat_phase = _hb_phase
                    last_heartbeat_ts = _now
                    yield "runtime.heartbeat", {
                        "message_id": assistant_id,
                        "elapsed_ms": int((_now - run_started) * 1000),
                        "output_chars": cumulative_output_chars + value["turn_output_chars"],
                        "phase": _hb_phase,
                        "iteration": iteration + 1,
                    }
            elif kind == "final":
                turn_content = value.get("content") or ""
                turn_tool_calls = value.get("tool_calls") or []
                add_usage(value)
                cumulative_output_chars += len(turn_content) + sum(len(tc.get("arguments", "")) for tc in turn_tool_calls)

        # 模型不支持 tools（请求报错）→ 降级：去掉 tools 再要一次纯文本回答。
        # 仅在尚未输出任何 delta 时重试（避免已输出内容被重复拼接）。
        if turn_error and not turn_tool_calls:
            if first_delta_emitted:
                # 已经向客户端输出过部分内容，直接结束，避免重复
                yield "message.delta", {"message_id": assistant_id, "delta": "\n\n模型响应中断，请稍后重试"}
                yield "runtime.completed", runtime_payload()
                return
            async for kind, value in _stream_llm_turn(
                model, messages, [], reasoning_effort, temperature, max_tokens
            ):
                if kind == "delta":
                    yield "message.delta", {"message_id": assistant_id, "delta": value}
                elif kind == "progress":
                    # P3: 心跳节流（与主路径一致）
                    _hb_phase = value["phase"]
                    _now = time.monotonic()
                    if _hb_phase != last_heartbeat_phase or _now - last_heartbeat_ts >= _HEARTBEAT_MIN_INTERVAL:
                        last_heartbeat_phase = _hb_phase
                        last_heartbeat_ts = _now
                        yield "runtime.heartbeat", {
                            "message_id": assistant_id,
                            "elapsed_ms": int((_now - run_started) * 1000),
                            "output_chars": cumulative_output_chars + value["turn_output_chars"],
                            "phase": _hb_phase,
                            "iteration": iteration + 1,
                        }
                elif kind == "final":
                    add_usage(value)
                    cumulative_output_chars += len(value.get("content") or "") + sum(len(tc.get("arguments", "")) for tc in (value.get("tool_calls") or []))
            yield "runtime.completed", runtime_payload()
            return

        # ── delta 处理：工具轮次的推理文本已被 snapshot 清空，最终轮次已完成实时推送 ──
        if turn_tool_calls:
            if turn_delta_parts:
                logger.info("agent_loop iteration=%d: tool-call round, %d delta chars suppressed (model reasoning)",
                            iteration, sum(len(p) for p in turn_delta_parts))
        else:
            # "writing" 状态已在首个 delta 之前 yield 过，这里不再重复
            pass
        if not turn_tool_calls:
            yield "runtime.completed", runtime_payload()
            return  # 最终回答已流式输出完毕

        # 规范每个 tool_call 的 id，保证 assistant 消息与 tool 结果一一对应。
        for i, tc in enumerate(turn_tool_calls):
            if not tc.get("id"):
                tc["id"] = f"call_{iteration}_{i}"

        messages.append(
            {
                "role": "assistant",
                "content": turn_content or "",
                "tool_calls": [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {"name": tc.get("name") or "", "arguments": tc.get("arguments") or "{}"},
                    }
                    for tc in turn_tool_calls
                ],
            }
        )

        for tc in turn_tool_calls:
            name = tc.get("name") or ""
            call_id = tc["id"]
            td = registry.get(name)
            args, argument_errors = parse_tool_arguments(
                tc.get("arguments"),
                td.input_schema if td else None,
            )
            activity_kind = (td.metadata.get("kind") if td else None) or (td.source if td else None) or "context"
            start_label = (
                f"工具「{name}」参数校验失败"
                if argument_errors
                else (_tool_start_label(td, args) if td else f"正在处理未知工具 {name}…")
            )

            # 四态权限裁决（Harness 管控）：未通过则不执行，回结构化结果让模型转而向学生说明。
            decision, deny_reason = _permission_decision(permission_mode, name, td)

            started = _save_activity(
                db, session, user_message,
                kind=str(activity_kind), name=name or "unknown",
                status_value="started",
                summary=deny_reason if decision != "allow" else start_label,
                detail={
                    "iteration": iteration + 1,
                    "tool_call_id": call_id,
                    "arguments": args,
                    "argument_errors": argument_errors,
                    "permission_mode": permission_mode,
                    "decision": decision,
                    "content_offset": cumulative_output_chars,
                },
            )
            yield "activity.started", serialize_activity(started).model_dump(mode="json")

            if argument_errors:
                result = {
                    "status": "failed",
                    "tool": name,
                    "summary": "；".join(argument_errors),
                    "error_code": "invalid_tool_arguments",
                }
            elif decision == "allow":
                prerequisite_failure = _resume_skill_prerequisite_failure(name, completed_tools, session=session)
                if prerequisite_failure:
                    result = prerequisite_failure
                else:
                    yield "runtime.status", {
                        "message_id": assistant_id,
                        "phase": "tool",
                        "label": _tool_start_label(td, args) if td else f"正在执行 {name}…",
                        "tool": name,
                        "iteration": iteration + 1,
                    }
                    tool_start = time.monotonic()
                    try:
                        result = await _dispatch_tool(
                            db, identity, session, assistant_message, user_message.content, attachments, name, args, td,
                            evidence_pool=evidence_pool,
                        )
                    except Exception as exc:
                        logger.exception("工具 %s 执行失败", name)
                        result = {
                            "status": "failed",
                            "tool": name,
                            "summary": f"Skill 执行失败：{str(exc)[:200]}。请换一种方式重试，或告知学生当前 Skill 暂时不可用。",
                        }
                    tool_ms = int((time.monotonic() - tool_start) * 1000)
                    if tool_ms > 1000:
                        yield "runtime.heartbeat", {
                            "message_id": assistant_id,
                            "elapsed_ms": int((time.monotonic() - run_started) * 1000),
                            "output_chars": cumulative_output_chars,
                            "phase": "tool",
                            "tool": name,
                            "iteration": iteration + 1,
                        }
            else:
                result = {"status": "failed", "tool": name, "summary": deny_reason, "permission": decision}
            if result.get("status") == "completed":
                completed_tools.add(name)
                # 自动绑定：generate/optimize/update 成功后，把 resume_id 写入 session.active_resume_id
                if name in ("generate_resume_data", "optimize_resume_data", "update_resume_data", "apply_resume_patch"):
                    result_resume_id = result.get("resume_id")
                    if result_resume_id:
                        session.active_resume_id = int(result_resume_id)
                        db.commit()
            result_detail = {
                **result,
                "iteration": iteration + 1,
                "tool_call_id": call_id,
                "arguments": args,
                "content_offset": cumulative_output_chars,
            }
            if td and td.source == "skill":
                result_detail["display_name"] = td.metadata.get("name") or td.name
            completed = _complete_activity(
                db, started,
                status_value=result.get("status", "completed"),
                summary=result.get("summary", ""),
                detail=result_detail,
            )
            event_name = "activity.completed" if result.get("status") == "completed" else "activity.failed"
            yield event_name, serialize_activity(completed).model_dump(mode="json")

            # 生成了可下载文件时，额外推一个事件供前端做下载入口（前端忽略也无害）。
            if result.get("download_url"):
                yield "attachment.created", {
                    "message_id": assistant_id,
                    "download_url": result["download_url"],
                    "filename": result.get("filename"),
                    "attachment_id": result.get("attachment_id"),
                }

            # 上下文预算：截断超限工具结果，避免撑爆 model context
            tool_content = _tool_result_for_model(result)
            remaining_budget = _TOOL_RESULT_CHAR_BUDGET - tool_result_budget_used
            if remaining_budget <= 0:
                tool_content = '{"status":"skipped","summary":"上下文预算已耗尽，工具结果已省略。"}'
            elif len(tool_content) > remaining_budget:
                tool_content = tool_content[:remaining_budget] + "\n…[工具结果因上下文预算截断]"
            tool_result_budget_used += len(tool_content)
            messages.append({"role": "tool", "tool_call_id": call_id, "content": tool_content})

    # 触顶 max_iterations —— 强制一次无工具的收尾回答，避免无限循环。
    yield "runtime.status", {
        "message_id": assistant_id,
        "phase": "writing",
        "label": "正在整理结果并生成回复…",
        "iteration": max_iterations + 1,
    }
    async for kind, value in _stream_llm_turn(
        model, messages, [], reasoning_effort, temperature, max_tokens
    ):
        if kind == "delta":
            yield "message.delta", {"message_id": assistant_id, "delta": value}
        elif kind == "progress":
            yield "runtime.heartbeat", {
                "message_id": assistant_id,
                "elapsed_ms": int((time.monotonic() - run_started) * 1000),
                "output_chars": cumulative_output_chars + value["turn_output_chars"],
                "phase": value["phase"],
                "iteration": max_iterations + 1,
            }
        elif kind == "final":
            add_usage(value)
            cumulative_output_chars += len(value.get("content") or "") + sum(len(tc.get("arguments", "")) for tc in (value.get("tool_calls") or []))

    # P1.1: 持久化证据来源索引到 session，供下一轮跨轮恢复。
    # GAP 关键词、已读 resume_id 等元数据换轮后不丢（避免事实校验误拦、
    # 避免 GAP 项被误写回简历）。轻量 JSON 写入，不阻塞 SSE 收尾。
    try:
        session.evidence_index_json = evidence_pool.build_source_index().to_json()  # type: ignore[attr-defined]
        db.commit()
    except Exception as _idx_err:  # pragma: no cover - 持久化失败不应影响回复
        logger.warning("evidence_index persist failed session=%s err=%s", session.id, _idx_err)

    yield "runtime.completed", runtime_payload()


async def _stream_llm_turn(
    model: ModelConfig,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    reasoning_effort: str,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> AsyncIterator[tuple[str, Any]]:
    """Single streaming turn. Yields ("delta", text) / ("tool_call_start", name) / ("error", msg) / ("progress", dict) / ("final", dict)."""
    effort_config = get_model_effort_config(model)
    api_params = effort_config.get("effort_api_params", {}).get(reasoning_effort, {})

    # max_tokens 上限：不超过模型配置的 max_output
    model_max_output = model.max_output or 4096
    if max_tokens is None:
        max_tokens = model_max_output
    elif max_tokens > model_max_output:
        max_tokens = model_max_output

    # 温度：先看调用方显式传入，再看 effort 配置的 reasoning_temp，最后用模型默认值
    effective_temp = temperature
    if effective_temp is None and effort_config.get("reasoning_temp") is not None and api_params:
        effective_temp = effort_config["reasoning_temp"]

    if is_anthropic_model(model):
        async for item in _stream_anthropic_turn(model, messages, effective_temp, max_tokens, api_params):
            yield item
        return

    # 平台策略：只搭配支持 function calling 的模型，不再为不支持工具的模型做降级。

    try:
        api_key = decrypt_api_key(model.api_key_cipher or "")
        llm_start = time.monotonic()
        payload: dict[str, Any] = {
            "model": model.model_identifier,
            "messages": messages,
            "temperature": effective_temp if effective_temp is not None else get_model_default_temperature(model),
            "max_tokens": max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        # 注入 effort 对应的 API 参数（reasoning_effort / thinking budget 等）
        if api_params:
            payload.update(api_params)

        tool_calls_acc: dict[int, dict[str, str]] = {}
        content_acc = ""
        finish: Optional[str] = None
        usage: dict[str, int] = {}
        turn_output_chars = 0
        last_progress_emit: float = 0.0

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=model.timeout_sec or 60, write=30, pool=5)
        ) as client:
            async with client.stream(
                "POST",
                f"{model.base_url.rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    error_text = error_body.decode("utf-8", errors="replace")[:512]
                    logger.error("LLM stream rejected status=%s body=%s model=%s", response.status_code, error_text, model.model_identifier)
                    raise RuntimeError(f"LLM call failed ({response.status_code}): {error_text}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choice = (obj.get("choices") or [{}])[0]
                    if obj.get("usage"):
                        usage = {
                            "prompt_tokens": int(obj["usage"].get("prompt_tokens") or 0),
                            "completion_tokens": int(obj["usage"].get("completion_tokens") or 0),
                            "total_tokens": int(obj["usage"].get("total_tokens") or 0),
                        }
                    delta = choice.get("delta") or {}
                    piece = delta.get("content")
                    if piece:
                        if not isinstance(piece, str):
                            piece = str(piece)
                        content_acc += piece
                        turn_output_chars += len(piece)
                        yield "delta", piece
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0) or 0
                        slot = tool_calls_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            if not slot["name"]:
                                yield "tool_call_start", fn["name"]
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]
                            turn_output_chars += len(fn["arguments"])
                    # Heartbeat: throttle to at most once per second
                    _now = time.monotonic()
                    if _now - last_progress_emit >= 1.0:
                        last_progress_emit = _now
                        tc_chars = sum(len(s["arguments"]) for s in tool_calls_acc.values())
                        phase = "writing" if content_acc else ("tool_writing" if tc_chars > 0 else "thinking")
                        yield "progress", {
                            "turn_output_chars": turn_output_chars,
                            "phase": phase,
                        }
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
    except Exception as exc:  # noqa: BLE001 — surfaced to caller for graceful fallback
        llm_latency_ms = int((time.monotonic() - llm_start) * 1000)
        logger.exception("LLM stream failed", extra=_log_ctx(model=model.model_identifier, latency_ms=llm_latency_ms))
        yield "error", _humanize_llm_error(exc)
        return

    llm_latency_ms = int((time.monotonic() - llm_start) * 1000)
    ordered = [tool_calls_acc[key] for key in sorted(tool_calls_acc.keys())]
    logger.info("LLM stream done", extra=_log_ctx(
        model=model.model_identifier, latency_ms=llm_latency_ms,
        prompt_tokens=usage.get("prompt_tokens", 0),
        completion_tokens=usage.get("completion_tokens", 0),
        finish_reason=finish,
    ))
    yield "final", {"content": content_acc, "tool_calls": ordered, "finish_reason": finish, "usage": usage}


def _anthropic_api_base(model: ModelConfig) -> str:
    api_base = (model.base_url or "https://api.anthropic.com/v1").rstrip("/")
    if api_base.endswith("/anthropic"):
        api_base = f"{api_base}/v1"
    elif not api_base.endswith("/v1"):
        api_base = f"{api_base}/v1"
    return api_base


def _anthropic_payload_messages(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, str]]]:
    system_parts: list[str] = []
    converted: list[dict[str, str]] = []
    pending_user_parts: list[str] = []
    for item in messages:
        role = item.get("role")
        content = str(item.get("content") or "")
        if role == "system":
            system_parts.append(content)
        elif role == "assistant":
            if pending_user_parts:
                converted.append({"role": "user", "content": "\n".join(pending_user_parts)})
                pending_user_parts = []
            if content:
                converted.append({"role": "assistant", "content": content})
        elif role == "user":
            pending_user_parts.append(content)
        elif role == "tool":
            pending_user_parts.append(f"Tool result:\n{content}")
    if pending_user_parts:
        converted.append({"role": "user", "content": "\n".join(pending_user_parts)})
    if not converted:
        converted.append({"role": "user", "content": "请继续。"})
    return "\n\n".join(system_parts), converted


async def _stream_anthropic_turn(
    model: ModelConfig,
    messages: list[dict[str, Any]],
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
    effort_api_params: Optional[dict] = None,
) -> AsyncIterator[tuple[str, Any]]:
    # max_tokens 上限：不超过模型配置的 max_output
    model_max_output = model.max_output or 4096
    if max_tokens is None:
        max_tokens = model_max_output
    elif max_tokens > model_max_output:
        max_tokens = model_max_output
    try:
        api_key = decrypt_api_key(model.api_key_cipher or "")
        system_prompt, payload_messages = _anthropic_payload_messages(messages)
        payload: dict[str, Any] = {
            "model": model.model_identifier,
            "messages": payload_messages,
            "temperature": temperature if temperature is not None else get_model_default_temperature(model),
            "max_tokens": max_tokens,
            "stream": True,
        }
        if system_prompt:
            payload["system"] = system_prompt
        # 注入 thinking budget（effort_api_params 中的 thinking 配置）
        if effort_api_params:
            payload.update(effort_api_params)
        content_acc = ""
        finish: Optional[str] = None
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10, read=model.timeout_sec or 120, write=30, pool=5)
        ) as client:
            async with client.stream(
                "POST",
                f"{_anthropic_api_base(model)}/messages",
                headers={
                    "x-api-key": api_key,
                    "api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json=payload,
            ) as response:
                if response.status_code != 200:
                    error_body = await response.aread()
                    error_text = error_body.decode("utf-8", errors="replace")[:512]
                    logger.error("Anthropic stream rejected status=%s body=%s model=%s", response.status_code, error_text, model.model_identifier)
                    raise RuntimeError(f"Anthropic call failed ({response.status_code}): {error_text}")
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if not raw or raw == "[DONE]":
                        continue
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    event_type = obj.get("type")
                    if event_type == "content_block_delta":
                        delta = obj.get("delta") or {}
                        piece = delta.get("text") or ""
                        if piece:
                            content_acc += piece
                            yield "delta", piece
                    elif event_type == "message_delta":
                        delta = obj.get("delta") or {}
                        finish = delta.get("stop_reason") or finish
    except Exception as exc:  # noqa: BLE001
        logger.exception("Anthropic stream call failed", extra=_log_ctx(model=model.model_identifier))
        yield "error", _humanize_llm_error(exc)
        return

    yield "final", {"content": content_acc, "tool_calls": [], "finish_reason": finish}


# ── Harness tool dispatch ───────────────────────────────────────────────────────


async def _dispatch_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    assistant_message: StudentAgentMessage,
    user_text: str,
    attachments: list[StudentAgentAttachment],
    name: str,
    args: dict[str, Any],
    td: Optional[ToolDefinition],
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    """工具分发入口。evidence_pool 用于统一事实来源契约。"""
    # 未知工具：返回结构化错误让模型自我纠正，而不是崩溃。
    if td is None:
        return {"status": "failed", "tool": name, "summary": f"未知工具「{name}」，已忽略。请只调用系统提供的工具。"}
    if td.source == "skill":
        return _invoke_skill(td, args)

    # ── 有副作用的工具：执行后自动更新证据池 ──
    if name == "query_student_profile":
        result = _query_student_profile(db, identity)
        if result.get("status") == "completed" and evidence_pool:
            evidence_pool.set_profile(result.get("profile") or {})
        return result

    if name == "read_resume":
        # 支持模型显式指定 resume_id，否则回落到 session 绑定的工作简历
        explicit_resume_id = args.get("resume_id") if args else None
        session_active_id = getattr(session, "active_resume_id", None)
        active_id = int(explicit_resume_id) if explicit_resume_id else session_active_id
        result = _read_resume_tool(db, identity, session, attachments, active_resume_id=active_id)
        if result.get("status") == "completed" and evidence_pool:
            evidence_pool.add_resume_texts(result.get("resumes") or [])
            # P1.1: 记录已读 resume_id 到索引，供跨轮懒重读判断
            read_ids: list[int] = []
            if active_id:
                read_ids.append(int(active_id))
            for r in (result.get("resumes") or []):
                rid = r.get("resume_id")
                if rid and int(rid) not in read_ids:
                    read_ids.append(int(rid))
            if read_ids:
                existing = evidence_pool.build_source_index().resume_ids_read
                merged = list(dict.fromkeys(existing + read_ids))
                evidence_pool.restored_index = EvidenceSourceIndex(
                    has_profile=evidence_pool.profile_snapshot is not None,
                    resume_ids_read=merged,
                    attachment_ids_analyzed=(evidence_pool.restored_index.attachment_ids_analyzed if evidence_pool.restored_index else []),
                    gap_keywords=evidence_pool.gap_keywords,
                    has_jd_analysis=bool(evidence_pool.jd_text),
                )
        return result

    if name == "read_resume_ai":
        result = _read_resume_ai_tool(db, identity)
        if result.get("status") == "completed" and evidence_pool:
            evidence_pool.add_resume_texts(result.get("resumes") or [])
        return result

    if name == "analyze_uploaded_file":
        result = _analyze_uploaded_files(attachments)
        if result.get("status") == "completed" and evidence_pool:
            for att_info in result.get("attachments") or []:
                evidence_pool.add_attachment_text(att_info.get("name", ""), att_info.get("excerpt", ""))
        return result

    if name == "get_session_context":
        return _get_session_context(db, session, int(args.get("limit") or 8))

    # ── 写入类工具：从证据池抽取 evidence sources ──
    if name == "export_resume_pdf":
        return await _export_resume_pdf_tool_async(db, identity, session, assistant_message, args, attachments, evidence_pool)
    if name == "read_webpage":
        return await _read_webpage_tool(args)
    if name == "web_search":
        return await _web_search_tool(args)
    if name == "generate_resume_data":
        # Phase 2: 素材质量评估 — 素材不足时返回结构化失败让模型转而提问
        # 关键：evidence_pool 是 per-run 的，跨轮时为空，必须无条件兜底查 profile。
        # 与 optimize_resume_data 的修法对齐。
        _gen_evidence: list[Any] = []
        profile_result = _query_student_profile(db, identity)
        if profile_result.get("status") == "completed":
            _profile = profile_result.get("profile") or {}
            _gen_evidence.append(_profile)
            if evidence_pool and not evidence_pool.profile_snapshot:
                evidence_pool.set_profile(_profile)
        if evidence_pool:
            _gen_evidence.extend(evidence_pool.collect_evidence_sources())
        quality_report = _assess_evidence_quality(_gen_evidence)
        if quality_report["quality"] == "insufficient" and quality_report.get("suggestions"):
            return {
                "status": "failed",
                "tool": "generate_resume_data",
                "error_code": "insufficient_evidence",
                "recoverable": True,
                "summary": "素材不足，无法生成高质量简历。" + quality_report["suggestions"][0],
                "display_summary": "经历还不够详细，正在向你了解后再生成",
                "evidence_quality": quality_report,
            }
        return _generate_resume_data_tool(db, identity, args, evidence_pool=evidence_pool)
    if name == "optimize_resume_data":
        return _optimize_resume_data_tool(db, identity, args, attachments, evidence_pool)
    if name == "apply_resume_patch":
        return _apply_resume_patch_tool(db, identity, args, evidence_pool, session=session)
    if name == "update_resume_data":
        return _update_resume_data_tool(db, identity, args, evidence_pool, session=session)
    if name == "analyze_jd_match":
        return _analyze_jd_match_tool(db, session, args, evidence_pool)
    if name == "search_past_sessions":
        return _search_past_sessions_tool(db, identity, args)
    if name == "propose_profile_update":
        return _propose_profile_update_tool(db, identity, session, args)
    if name == "save_session_note":
        return _save_session_note_tool(db, session, args, evidence_pool)
    return {"status": "failed", "tool": name, "summary": f"工具 {name} 暂未接入执行器。"}


def _snapshot_resume_revision(
    db: Session,
    identity: AuthIdentity,
    row: StudentResume,
    source: str = "ai_update",
    session_id: Optional[int] = None,
    message_id: Optional[int] = None,
) -> Optional[int]:
    """写入前快照当前简历内容，保留最近 20 条。返回 revision id。"""
    revision = StudentResumeRevision(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        resume_id=row.id,
        data_json=row.data_json or "{}",
        title=row.title or "",
        template_id=row.template_id or "classic",
        source=source,
        session_id=session_id,
        message_id=message_id,
    )
    db.add(revision)
    db.flush()
    revision_id = revision.id
    # 清理：每份简历保留最近 20 条
    old_ids = db.scalars(
        select(StudentResumeRevision.id)
        .where(
            StudentResumeRevision.resume_id == row.id,
            StudentResumeRevision.tenant_id == identity.tenant_id,
        )
        .order_by(StudentResumeRevision.id.desc())
        .offset(20)
    ).all()
    if old_ids:
        db.query(StudentResumeRevision).filter(StudentResumeRevision.id.in_(old_ids)).delete(synchronize_session=False)
    db.commit()
    return revision_id


def _save_session_note_tool(
    db: Session,
    session: StudentAgentSession,
    args: dict[str, Any],
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    """保存会话记忆（constraint / fact / preference）。"""
    note_type = args.get("type")
    content = (args.get("content") or "").strip()

    if note_type not in ("constraint", "fact", "preference"):
        return {"status": "failed", "tool": "save_session_note", "summary": "type 必须是 constraint、fact 或 preference。"}
    if not content:
        return {"status": "failed", "tool": "save_session_note", "summary": "content 不能为空。"}
    if len(content) > 200:
        return {"status": "failed", "tool": "save_session_note", "summary": "content 不能超过 200 字。"}

    # 解析现有 memory
    try:
        memory = json.loads(session.memory_json or "{}")
    except Exception:
        memory = {}

    memory.setdefault("constraints", [])
    memory.setdefault("facts", [])
    memory.setdefault("preferences", [])

    if note_type in ("constraint", "fact", "preference"):
        key = note_type + "s" if note_type != "preference" else "preferences"
        items = memory[key]
        # 去重
        if content in items:
            label = {"constraint": "约束", "fact": "事实", "preference": "偏好"}[note_type]
            return {"status": "completed", "tool": "save_session_note", "summary": f"该{label}已存在，无需重复保存。"}
        # 上限检查
        if len(items) >= 20:
            items.pop(0)  # 删最老的
        items.append(content)
        memory[key] = items

    session.memory_json = json.dumps(memory, ensure_ascii=False)
    db.commit()

    # fact 类记忆加入 EvidencePool
    if note_type == "fact" and evidence_pool:
        evidence_pool.add_resume_texts([{"source": "会话记忆", "name": "用户口述", "excerpt": content}])

    label = {"constraint": "约束", "fact": "事实", "preference": "偏好"}[note_type]
    return {
        "status": "completed",
        "tool": "save_session_note",
        "summary": f"已保存{label}：{content[:50]}{'…' if len(content) > 50 else ''}",
    }


def _search_past_sessions_tool(
    db: Session,
    identity: AuthIdentity,
    args: dict[str, Any],
) -> dict[str, Any]:
    """在当前学生的历史对话摘要和标题中检索。"""
    query = (args.get("query") or "").strip()
    if not query:
        return {"status": "failed", "tool": "search_past_sessions", "summary": "query 不能为空。"}

    # 搜索标题和摘要中包含关键词的会话
    sessions = list(
        db.scalars(
            select(StudentAgentSession)
            .where(
                StudentAgentSession.student_id == identity.user_id,
                StudentAgentSession.tenant_id == identity.tenant_id,
                StudentAgentSession.agent_type == "resume",
            )
            .order_by(StudentAgentSession.updated_at.desc())
            .limit(50)
        ).all()
    )

    results = []
    query_lower = query.lower()
    for s in sessions:
        title_match = query_lower in (s.title or "").lower()
        summary_match = query_lower in (s.summary or "").lower()
        if title_match or summary_match:
            snippet = s.summary[:300] if s.summary else ""
            results.append({
                "session_id": s.id,
                "title": s.title,
                "snippet": snippet,
                "updated_at": s.updated_at.isoformat() if s.updated_at else None,
            })
        if len(results) >= 5:
            break

    if not results:
        return {
            "status": "completed",
            "tool": "search_past_sessions",
            "summary": f"未找到与「{query}」相关的历史对话。",
            "results": [],
        }

    return {
        "status": "completed",
        "tool": "search_past_sessions",
        "summary": f"找到 {len(results)} 条相关历史对话。",
        "results": results,
    }


def _propose_profile_update_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    args: dict[str, Any],
) -> dict[str, Any]:
    """将用户口述的经历保存为待确认的提案。"""
    from app.student.proposal_models import StudentProfileProposal

    section = args.get("section")
    payload = args.get("payload")

    valid_sections = ("work", "project", "skill", "honor", "cert")
    if section not in valid_sections:
        return {"status": "failed", "tool": "propose_profile_update", "summary": f"section 必须是 {', '.join(valid_sections)} 之一。"}
    if not payload or not isinstance(payload, dict):
        return {"status": "failed", "tool": "propose_profile_update", "summary": "payload 不能为空。"}

    proposal = StudentProfileProposal(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        session_id=session.id if session else None,
        section=section,
        payload_json=json.dumps(payload, ensure_ascii=False),
        status="pending",
    )
    db.add(proposal)
    db.commit()
    db.refresh(proposal)

    section_labels = {"work": "工作经历", "project": "项目经历", "skill": "技能", "honor": "荣誉", "cert": "证书"}
    name = payload.get("name") or payload.get("company") or payload.get("title") or "新经历"

    return {
        "status": "completed",
        "tool": "propose_profile_update",
        "summary": f"已保存{section_labels.get(section, section)}「{name}」的提案，等待用户确认。",
        "proposal_id": proposal.id,
        "section": section,
        "profile_proposal": True,
    }


_TOOL_RESULT_KEYS_TO_STRIP = {"tool", "status", "iteration", "tool_call_id", "arguments", "display_summary", "editor_url", "open_resume_editor"}


def _tool_result_for_model(result: dict[str, Any]) -> str:
    """序列化工具结果发给模型，去掉内部元数据字段以节省 context window。"""
    filtered = {k: v for k, v in result.items() if k not in _TOOL_RESULT_KEYS_TO_STRIP}
    try:
        text = json.dumps(filtered, ensure_ascii=False)
    except (TypeError, ValueError):
        text = str(filtered)
    return text[:30000]


# ── 四态权限裁决（allow / ask / deny）────────────────────────────────────────────


def _permission_decision(mode: str, name: str, td: Optional[ToolDefinition]) -> tuple[str, str]:
    """根据主智能体配置的 permission_mode 与工具风险等级裁决是否执行。

    返回 (decision, reason)，decision ∈ {"allow", "ask", "deny"}。
    - auto：除被 deny 标记外，一律放行；
    - ask（默认）：低风险放行，需确认的高风险动作暂缓（当前工具池无此类，预留给投递/发信等）；
    - strict：仅放行平台内置安全工具，Skill 与子智能体一律拒绝。
    未知工具交给 _dispatch_tool 返回结构化错误，这里直接放行。
    """
    if td is None:
        return "allow", ""

    risk_raw = str(td.metadata.get("risk", "")).lower()
    if risk_raw in ("deny", "high", "critical"):
        risk = "deny"
    elif risk_raw in ("confirm", "ask", "medium"):
        risk = "confirm"
    else:
        risk = "allow"

    strict_ok = td.source == "builtin" or bool(td.metadata.get("trusted_builtin"))

    if risk == "deny":
        return "deny", f"工具「{name}」已被 Harness 禁用，拒绝执行。"
    if mode == "strict" and not strict_ok:
        return (
            "deny",
            f"当前为 strict 权限模式，仅允许平台内置安全工具，已拒绝调用「{name}」。"
            "请改用内置工具，或如实告知学生该能力当前不可用。",
        )
    if mode == "ask" and risk == "confirm":
        return (
            "ask",
            f"工具「{name}」属于需要学生确认的操作，当前未获确认，已暂缓。"
            "请先向学生说明将要执行的动作并征得同意。",
        )
    return "allow", ""


# ── Resume tools ────────────────────────────────────────────────────────────────


def _ensure_attachment_text(db: Session, attachment: StudentAgentAttachment) -> str:
    """Lazily extract & persist text for an attachment that has none."""
    existing = (attachment.extracted_text or "").strip()
    # Skip previously cached parse-error messages so we retry with the improved extractor
    if existing and not existing.startswith("附件已保存，但自动解析失败"):
        return existing
    path = Path(attachment.stored_path)
    if not path.exists():
        return ""
    text = _extract_attachment_text_sync(path, attachment.content_type, attachment.file_ext)
    if text and text.strip():
        attachment.extracted_text = text
        try:
            db.commit()
        except Exception:
            db.rollback()
        return text
    return ""


def _extract_attachment_text_sync(path: Path, content_type: str, ext: str) -> str:
    """同步版本的附件文本提取（纯 CPU/IO，不阻塞事件循环时应在 to_thread 中调用）。"""
    try:
        if ext == "pdf":
            return _extract_pdf_text(path)
        if ext == "docx":
            return _extract_docx_text(path)
        if ext in {"xlsx", "xls"}:
            return _extract_xlsx_text(path)
        if ext in {"csv", "txt", "md", "json"}:
            return path.read_text(encoding="utf-8", errors="ignore")[:12000]
        if content_type.startswith("image/"):
            return _extract_image_summary(path)
    except Exception as exc:
        logger.exception("附件解析失败: %s", path)
        return f"附件已保存，但自动解析失败：{str(exc)[:200]}"
    return "附件已保存，当前格式需要专用 Skill 或外部工具进一步解析。"


def _rich_text_to_lines(html: str) -> list[str]:
    """Convert HTML rich text to plain text lines (mirrors frontend richTextToLines)."""
    if not html:
        return []
    text = _re.sub(r"<br\s*/?>", "\n", html, flags=_re.IGNORECASE)
    text = _re.sub(r"<li[^>]*>", "\n", text, flags=_re.IGNORECASE)
    text = _re.sub(r"</(p|div|section|li|ul|ol|h[1-6])>", "\n", text, flags=_re.IGNORECASE)
    text = _re.sub(r"<[^>]+>", "", text)
    for entity, char in [("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"), ("&quot;", '"'), ("&#39;", "'")]:
        text = text.replace(entity, char)
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


def _ta_to_list(text: Any) -> str:
    """Convert newline-separated plain text to <ul><li>…</li></ul> HTML."""
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return "<ul>" + "".join(f"<li>{esc(ln)}</li>" for ln in lines) + "</ul>"


def _ta_to_para(text: Any) -> str:
    """Convert newline-separated plain text to <p>…</p> HTML blocks."""
    lines = [ln.strip() for ln in str(text or "").splitlines() if ln.strip()]
    if not lines:
        return ""
    def esc(s: str) -> str:
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return "".join(f"<p>{esc(ln)}</p>" for ln in lines)


def _structured_resume_to_text(row: StudentResume) -> str:
    """Convert a StudentResume row to readable plain text for the AI model."""
    try:
        data = json.loads(row.data_json or "{}")
    except Exception:
        data = {}
    basic = data.get("basic") or {}
    parts: list[str] = []
    for label, key in [("姓名", "name"), ("目标职位", "title"), ("邮箱", "email"), ("电话", "phone"), ("地址", "location"), ("生日", "birthDate")]:
        val = str(basic.get(key) or "").strip()
        if val:
            parts.append(f"{label}: {val}")
    skill_lines = _rich_text_to_lines(data.get("skillContent") or "")
    if skill_lines:
        parts.append("\n专业技能:")
        parts.extend(f"- {ln}" for ln in skill_lines)
    for exp in (data.get("experience") or []):
        if exp.get("visible") is False:
            continue
        header = " | ".join(v for v in [exp.get("company"), exp.get("position"), exp.get("date")] if v)
        if header:
            parts.append(f"\n工作经历: {header}")
        parts.extend(f"- {ln}" for ln in _rich_text_to_lines(exp.get("details") or ""))
    for proj in (data.get("projects") or []):
        if proj.get("visible") is False:
            continue
        header = " | ".join(v for v in [proj.get("name"), proj.get("role"), proj.get("date")] if v)
        if header:
            parts.append(f"\n项目经历: {header}")
        parts.extend(f"- {ln}" for ln in _rich_text_to_lines(proj.get("description") or ""))
    for edu in (data.get("education") or []):
        if edu.get("visible") is False:
            continue
        header = " | ".join(v for v in [edu.get("school"), edu.get("major"), edu.get("degree"), f"{edu.get('startDate', '')}-{edu.get('endDate', '')}"] if v)
        if header:
            parts.append(f"\n教育经历: {header}")
        parts.extend(f"- {ln}" for ln in _rich_text_to_lines(edu.get("description") or ""))
    eval_lines = _rich_text_to_lines(data.get("selfEvaluationContent") or "")
    if eval_lines:
        parts.append("\n自我评价:")
        parts.extend(eval_lines)
    return "\n".join(parts)


def _read_resume_tool(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    attachments: list[StudentAgentAttachment],
    active_resume_id: Optional[int] = None,
) -> dict[str, Any]:
    """Read the student's resume — two-layer design.

    Layer 1 (list): lightweight listing of ALL online resumes (resume_id + title + updated_at).
    Layer 2 (full text): only the current working resume's full content.

    Priority:
    - If the current turn has document attachments (PDF/Word/etc.), use ONLY those
      and skip online resumes entirely — the user explicitly uploaded their own resume.
    - Otherwise fall back to: online structured resumes → profile-level PDF attachments.
    """
    # ── 本轮有文档附件（非图片）→ 直接用上传文件，跳过在线简历 ─────────────────────
    session_docs = [att for att in attachments if not att.content_type.startswith("image/")]
    if session_docs:
        resumes: list[dict[str, Any]] = []
        for att in session_docs:
            text = _ensure_attachment_text(db, att)
            if text:
                resumes.append({"source": "本轮上传", "name": att.original_name, "excerpt": text[:12000]})
        if resumes:
            names = "、".join(r["name"] for r in resumes)
            return {
                "status": "completed",
                "tool": "read_resume",
                "summary": f"已读取本轮上传的文件：{names}（已跳过在线简历，以上传内容为准）",
                "resumes": resumes,
            }

    # ── 无本轮附件 → 读在线简历 ────────────────────────────────────────────────
    # Layer 1: 列表层 — 返回该学生全部在线简历的 resume_id + 标题 + updated_at
    all_rows = list(
        db.scalars(
            select(StudentResume)
            .where(
                StudentResume.tenant_id == identity.tenant_id,
                StudentResume.student_id == identity.user_id,
            )
            .order_by(StudentResume.updated_at.desc())
        ).all()
    )

    resume_list = [
        {
            "resume_id": row.id,
            "name": row.title,
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        }
        for row in all_rows
    ]

    # Layer 2: 全文层 — 只返回当前工作简历的完整内容
    # 优先使用 active_resume_id，否则不返回全文（由模型指定或 session 绑定）
    full_text_resume: Optional[dict[str, Any]] = None
    target_row: Optional[StudentResume] = None

    if active_resume_id:
        target_row = next((r for r in all_rows if r.id == active_resume_id), None)
    elif len(all_rows) == 1:
        # 只有一份简历时自动作为目标
        target_row = all_rows[0]

    if target_row:
        text = _structured_resume_to_text(target_row)
        if text.strip():
            full_text_resume = {
                "source": "在线简历",
                "name": target_row.title,
                "resume_id": target_row.id,
                "updated_at": target_row.updated_at.isoformat() if target_row.updated_at else None,
                "excerpt": text[:8000],
            }

    # 组装返回结果
    resumes_output: list[dict[str, Any]] = []
    if full_text_resume:
        resumes_output.append(full_text_resume)

    if not resume_list:
        return {
            "status": "completed",
            "tool": "read_resume",
            "summary": "未找到简历：学生还没有在线简历。",
            "resumes": [],
            "resume_list": [],
        }

    summary_parts = []
    if full_text_resume:
        summary_parts.append(f"已读取简历：《{full_text_resume['name']}》(id={full_text_resume['resume_id']})")
    summary_parts.append(f"共 {len(resume_list)} 份在线简历")

    return {
        "status": "completed",
        "tool": "read_resume",
        "summary": "，".join(summary_parts),
        "resumes": resumes_output,
        "resume_list": resume_list,
    }


def _read_resume_ai_tool(db: Session, identity: AuthIdentity) -> dict[str, Any]:
    """读取学生在「简历制作」中保存的简历内容（session_id=0 的附件）。"""
    docs = list(
        db.scalars(
            select(StudentAgentAttachment)
            .where(
                StudentAgentAttachment.session_id == 0,
                StudentAgentAttachment.student_id == identity.user_id,
                StudentAgentAttachment.tenant_id == identity.tenant_id,
                StudentAgentAttachment.is_deleted.is_(False),
                StudentAgentAttachment.content_type.notlike("image/%"),
            )
            .order_by(StudentAgentAttachment.id.desc())
            .limit(3)
        ).all()
    )
    if not docs:
        return {
            "status": "completed",
            "tool": "read_resume_ai",
            "summary": "未找到简历：学生还没有在「简历制作」中保存过简历。",
            "resumes": [],
        }
    resumes: list[dict[str, Any]] = []
    for att in docs:
        text = _ensure_attachment_text(db, att)
        if text:
            resumes.append({"source": "简历制作", "name": att.original_name, "excerpt": text[:12000]})
    if not resumes:
        return {
            "status": "completed",
            "tool": "read_resume_ai",
            "summary": "未找到简历：「简历制作」中的附件无法解析。",
            "resumes": [],
        }
    names = "、".join(r["name"] for r in resumes)
    return {
        "status": "completed",
        "tool": "read_resume_ai",
        "summary": f"已读取简历：{names}",
        "resumes": resumes,
    }


_MAX_RESUMES = 6
_VALID_TEMPLATE_IDS = {
    "classic", "modern", "elegant",
    "left-right", "timeline", "minimalist",
    "creative", "editorial", "swiss",
}
_DEFAULT_GLOBAL_SETTINGS = {
    "classic": {
        "themeColor": "#000000",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 32,
        "lineHeight": 1.5,
        "sectionSpacing": 16,
        "paragraphSpacing": 12,
        "headerSize": 18,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": True,
    },
    "modern": {
        "themeColor": "#000000",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 0,
        "lineHeight": 1.5,
        "sectionSpacing": 8,
        "paragraphSpacing": 4,
        "headerSize": 18,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": True,
    },
    "elegant": {
        "themeColor": "#18181b",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 32,
        "lineHeight": 1.5,
        "sectionSpacing": 28,
        "paragraphSpacing": 18,
        "headerSize": 20,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": True,
    },
    "left-right": {
        "themeColor": "#2563eb",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 32,
        "lineHeight": 1.5,
        "sectionSpacing": 24,
        "paragraphSpacing": 16,
        "headerSize": 18,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": False,
    },
    "timeline": {
        "themeColor": "#18181b",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 24,
        "lineHeight": 1.5,
        "sectionSpacing": 1,
        "paragraphSpacing": 12,
        "headerSize": 18,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": False,
    },
    "minimalist": {
        "themeColor": "#171717",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 40,
        "lineHeight": 1.5,
        "sectionSpacing": 32,
        "paragraphSpacing": 24,
        "headerSize": 16,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": True,
    },
    "creative": {
        "themeColor": "#7c3aed",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 14,
        "lineHeight": 1.5,
        "sectionSpacing": 16,
        "paragraphSpacing": 16,
        "headerSize": 16,
        "subheaderSize": 16,
        "useIconMode": False,
        "centerSubtitle": False,
    },
    "editorial": {
        "themeColor": "#8e8e8e",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 36,
        "lineHeight": 1.5,
        "sectionSpacing": 32,
        "paragraphSpacing": 16,
        "headerSize": 13,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": False,
    },
    "swiss": {
        "themeColor": "#E31C24",
        "fontFamily": '"Alibaba PuHuiTi", sans-serif',
        "baseFontSize": 16,
        "pagePadding": 36,
        "lineHeight": 1.5,
        "sectionSpacing": 36,
        "paragraphSpacing": 12,
        "headerSize": 18,
        "subheaderSize": 16,
        "useIconMode": True,
        "centerSubtitle": False,
    },
}
_DEFAULT_MENU_SECTIONS = [
    {"id": "basic", "title": "基本信息", "icon": "👤", "enabled": True, "order": 0},
    {"id": "skills", "title": "专业技能", "icon": "⚡", "enabled": True, "order": 1},
    {"id": "experience", "title": "工作经历", "icon": "💼", "enabled": True, "order": 2},
    {"id": "projects", "title": "项目经历", "icon": "🚀", "enabled": True, "order": 3},
    {"id": "education", "title": "教育经历", "icon": "🎓", "enabled": True, "order": 4},
    {"id": "selfEvaluation", "title": "自我评价", "icon": "📝", "enabled": True, "order": 5},
]
_DEFAULT_FIELD_ORDER = [
    {"id": "name", "key": "name", "label": "姓名", "type": "text", "visible": True},
    {"id": "title", "key": "title", "label": "职位", "type": "text", "visible": True},
    {"id": "birthDate", "key": "birthDate", "label": "生日", "type": "date", "visible": True},
    {"id": "employementStatus", "key": "employementStatus", "label": "状态", "type": "text", "visible": False},
    {"id": "email", "key": "email", "label": "邮箱", "type": "text", "visible": True},
    {"id": "phone", "key": "phone", "label": "电话", "type": "text", "visible": True},
    {"id": "location", "key": "location", "label": "地址", "type": "text", "visible": True},
]


def _normalize_literal_escapes(value: Any) -> Any:
    """规范化模型提交参数中的字面转义序列。

    模型通过 JSON 提交 tool_call arguments 时，details 等文本字段中的换行
    可能被双重编码为字面 \n（四个字符反斜杠+n）而非真换行。
    这会导致：1) 简历正文显示 \n；2) 技术词误提取（如 nAI）。
    """
    if isinstance(value, str):
        return value.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\r", "\n").replace("\\t", "\t")
    if isinstance(value, dict):
        return {k: _normalize_literal_escapes(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_normalize_literal_escapes(item) for item in value]
    return value


def _build_resume_doc(args: dict[str, Any], student: Optional[Any], title: str, template_id: str) -> dict[str, Any]:
    """Build a full ResumeData-compatible document from AI-provided args."""
    # 规范化字面转义（\n → 真换行）
    args = _normalize_literal_escapes(args)
    basic_in = args.get("basic") or {}
    edu_in = args.get("education") or []
    exp_in = args.get("experience") or []
    proj_in = args.get("projects") or []

    def _edu(item: dict) -> dict:
        raw_desc = item.get("description") or ""
        return {
            "id": f"edu-{uuid.uuid4().hex[:8]}",
            "school": item.get("school") or "",
            "major": item.get("major") or "",
            "degree": item.get("degree") or "",
            "startDate": item.get("start_date") or item.get("startDate") or "",
            "endDate": item.get("end_date") or item.get("endDate") or "",
            "gpa": item.get("gpa") or "",
            "description": _ta_to_list(raw_desc) if raw_desc else "",
            "visible": True,
        }

    def _exp(item: dict) -> dict:
        raw = item.get("details") or item.get("description") or ""
        return {
            "id": f"exp-{uuid.uuid4().hex[:8]}",
            "company": item.get("company") or "",
            "position": item.get("position") or "",
            "date": item.get("date") or "",
            "details": _ta_to_list(raw) if raw else "",
            "visible": True,
        }

    def _proj(item: dict) -> dict:
        raw = item.get("description") or ""
        return {
            "id": f"proj-{uuid.uuid4().hex[:8]}",
            "name": item.get("name") or "",
            "role": item.get("role") or "",
            "date": item.get("date") or "",
            "description": _ta_to_list(raw) if raw else "",
            "visible": True,
            "link": item.get("link") or "",
            "linkLabel": item.get("link_label") or item.get("linkLabel") or "",
        }

    basic = {
        "name": basic_in.get("name") or (getattr(student, "name", None) if student else None) or "",
        "title": basic_in.get("target_position")
        or basic_in.get("title")
        or (getattr(student, "expected_position", None) if student else None)
        or "",
        "email": basic_in.get("email") or (getattr(student, "email", None) if student else None) or "",
        "phone": basic_in.get("phone") or (getattr(student, "phone", None) if student else None) or "",
        "location": basic_in.get("location")
        or (getattr(student, "expected_location", None) if student else None)
        or "",
        "birthDate": _normalize_month_value(
            basic_in.get("birth_date")
            or basic_in.get("birthDate")
            or (getattr(student, "birth_date", None) if student else None)
            or ""
        ),
        "employementStatus": "",
        "photo": (getattr(student, "resume_avatar_url", None) if student else None) or "",
        "icons": {"birthDate": "calendar", "employementStatus": "briefcase", "email": "mail", "phone": "phone", "location": "location"},
        "photoConfig": {"width": 90, "height": 120, "aspectRatio": "1:1", "borderRadius": "none", "customBorderRadius": 0, "visible": True},
        "fieldOrder": [dict(f) for f in _DEFAULT_FIELD_ORDER],
        "customFields": [],
        "githubKey": "",
        "githubUseName": "",
        "githubContributionsVisible": False,
    }

    skills_raw = args.get("skills") or ""
    self_eval_raw = args.get("self_evaluation") or ""

    # Phase 4.2: 结构规则后处理
    edu_list = [_edu(item) for item in edu_in if isinstance(item, dict)]
    exp_list = [_exp(item) for item in exp_in if isinstance(item, dict)]
    proj_list = [_proj(item) for item in proj_in if isinstance(item, dict)]

    # 应届生教育前置：无全职工作经历时，教育模块排在经历之前
    is_fresh = not exp_list or all(not (e.get("company") or "").strip() for e in exp_in if isinstance(e, dict))

    # 每段经历 bullet 数限制：最多 5 条
    for section_list in (exp_list, proj_list):
        for item in section_list:
            details_html = item.get("details") or ""
            lines = [ln for ln in details_html.split("</li>") if ln.strip()]
            if len(lines) > 5:
                item["details"] = "</li>".join(lines[:5]) + "</li>"

    return {
        "title": title,
        "templateId": template_id,
        "visibility": False,
        "basic": basic,
        "education": edu_list,
        "experience": exp_list,
        "projects": proj_list,
        "certificates": [],
        "customData": {},
        "skillContent": _ta_to_list(skills_raw) if skills_raw else "",
        "selfEvaluationContent": _ta_to_para(self_eval_raw) if self_eval_raw else "",
        "activeSection": "basic",
        "draggingProjectId": None,
        "globalSettings": dict(_DEFAULT_GLOBAL_SETTINGS.get(template_id, _DEFAULT_GLOBAL_SETTINGS["classic"])),
        "menuSections": [dict(s) for s in _DEFAULT_MENU_SECTIONS],
    }


def _normalize_month_value(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text in {"至今", "present", "now"}:
        return "至今"
    match = _re.match(r"^(\d{4})[.\-/年。．](\d{1,2})", text)
    if not match:
        return text
    return f"{match.group(1)}-{int(match.group(2)):02d}"


def _split_duration(value: Any) -> tuple[str, str]:
    text = str(value or "").strip()
    if not text:
        return "", ""
    parts = _re.split(r"\s*(?:-|–|—|至|~|～)\s*", text, maxsplit=1)
    return (_normalize_month_value(parts[0]), _normalize_month_value(parts[1])) if len(parts) == 2 else (_normalize_month_value(text), "")


def _date_range(start: Any, end: Any) -> str:
    start_text = _normalize_month_value(start)
    end_text = _normalize_month_value(end)
    if start_text and end_text:
        return f"{start_text} - {end_text}"
    return start_text or end_text



def _build_resume_markdown(data: dict[str, Any], student: Optional[Any], title: str) -> str:
    """从已保存的结构化简历 data_json 渲染 Markdown 文本（用于 export_resume_pdf 的 resume_id 路径）。"""
    import re as _re_md

    def _strip_html(text: Any) -> str:
        s = str(text or "")
        s = _re_md.sub(r"<[^>]+>", "", s)
        s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
        return s.strip()

    def _lines_from_rich(text: Any) -> list[str]:
        stripped = _strip_html(text)
        return [ln.strip() for ln in stripped.splitlines() if ln.strip()]

    basic = data.get("basic") or {}
    parts: list[str] = []
    parts.append("# " + title)

    name = basic.get("name") or ""
    if name:
        parts.append("")
        parts.append("## " + name)
    for label, key in [("目标职位", "title"), ("邮箱", "email"), ("电话", "phone"), ("地址", "location")]:
        val = str(basic.get(key) or "").strip()
        if val:
            parts.append("- **" + label + "**：" + val)

    skill_lines = _lines_from_rich(data.get("skillContent") or "")
    if skill_lines:
        parts.append("")
        parts.append("## 专业技能")
        for ln in skill_lines:
            parts.append("- " + ln)

    for edu in (data.get("education") or []):
        if edu.get("visible") is False:
            continue
        school = edu.get("school") or ""
        if not school:
            continue
        parts.append("")
        parts.append("## 教育经历")
        parts.append("### " + school)
        meta_parts = [v for v in [edu.get("major"), edu.get("degree"), _edu_date_range(edu)] if v]
        if meta_parts:
            parts.append(" | ".join(meta_parts))
        for ln in _lines_from_rich(edu.get("description")):
            parts.append("- " + ln)

    for exp in (data.get("experience") or []):
        if exp.get("visible") is False:
            continue
        company = exp.get("company") or ""
        position = exp.get("position") or ""
        if not company and not position:
            continue
        header = " — ".join(v for v in [company, position] if v)
        date = exp.get("date") or ""
        parts.append("")
        parts.append("## 工作经历")
        parts.append("### " + header)
        if date:
            parts.append(date)
        for ln in _lines_from_rich(exp.get("details")):
            parts.append("- " + ln)

    for proj in (data.get("projects") or []):
        if proj.get("visible") is False:
            continue
        name_p = proj.get("name") or ""
        if not name_p:
            continue
        role = proj.get("role") or ""
        parts.append("")
        parts.append("## 项目经历")
        parts.append("### " + name_p)
        if role:
            parts.append("**角色**：" + role)
        date = proj.get("date") or ""
        if date:
            parts.append(date)
        for ln in _lines_from_rich(proj.get("description")):
            parts.append("- " + ln)

    return "\n".join(parts)


def _edu_date_range(edu: dict[str, Any]) -> str:
    start = str(edu.get("startDate") or edu.get("start_date") or "").strip()
    end = str(edu.get("endDate") or edu.get("end_date") or "").strip()
    if start and end:
        return start + " - " + end
    return start or end


def _profile_backed_resume_args(
    db: Session,
    identity: AuthIdentity,
    requested_args: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Replace every biographical field with authoritative profile data."""
    result = _query_student_profile(db, identity)
    profile = result.get("profile") or {}
    basic_requested = requested_args.get("basic") or {}

    def select_profile_items(
        source_items: list[dict[str, Any]],
        requested_items: Any,
        anchor: str,
    ) -> list[dict[str, Any]]:
        if not isinstance(requested_items, list) or not requested_items:
            return source_items
        selected: list[dict[str, Any]] = []
        used: set[int] = set()
        for requested in requested_items:
            if not isinstance(requested, dict):
                continue
            requested_anchor = _normalize_evidence(requested.get(anchor))
            if not requested_anchor:
                continue
            for index, source in enumerate(source_items):
                if index in used:
                    continue
                if requested_anchor == _normalize_evidence(source.get(anchor)):
                    selected.append(source)
                    used.add(index)
                    break
        return selected or source_items

    source_educations = list(profile.get("educations") or [])
    selected_educations = select_profile_items(source_educations, requested_args.get("education"), "school")
    education: list[dict[str, Any]] = []
    for item in selected_educations:
        start_date, end_date = _split_duration(item.get("duration"))
        education.append(
            {
                "school": item.get("school") or "",
                "major": item.get("major") or "",
                "degree": item.get("degree") or "",
                "start_date": start_date,
                "end_date": end_date,
                "gpa": item.get("gpa") or "",
                "description": item.get("description") or "",
            }
        )
    if not education and (profile.get("college") or profile.get("major")):
        education.append(
            {
                "school": profile.get("college") or "",
                "major": profile.get("major") or "",
                "degree": "",
                "start_date": "",
                "end_date": "",
                "description": "",
            }
        )

    source_experiences = list(profile.get("work_experiences") or [])
    selected_experiences = select_profile_items(source_experiences, requested_args.get("experience"), "company")
    experience = [
        {
            "company": item.get("company") or "",
            "position": item.get("position") or "",
            "date": _date_range(item.get("start_date"), item.get("end_date")),
            "details": item.get("description") or "",
        }
        for item in selected_experiences
    ]
    source_projects = list(profile.get("projects") or [])
    selected_projects = select_profile_items(source_projects, requested_args.get("projects"), "name")
    projects = [
        {
            "name": item.get("name") or "",
            "role": item.get("role") or "",
            "date": _date_range(item.get("start_date"), item.get("end_date")),
            "description": item.get("description") or "",
            "link": item.get("link") or "",
            "link_label": item.get("link_label") or "",
        }
        for item in selected_projects
    ]
    source_skills = list(profile.get("skills") or [])
    requested_skills = _normalize_evidence(requested_args.get("skills"))
    if requested_skills:
        matched_skills = [
            item
            for item in source_skills
            if _normalize_evidence(item.get("name")) in requested_skills
        ]
        source_skills = matched_skills or source_skills
    skill_lines = []
    for item in source_skills:
        name = str(item.get("name") or "").strip()
        description = str(item.get("description") or "").strip()
        if name:
            skill_lines.append(f"{name}：{description}" if description else name)

    safe_args = {
        "basic": {
            "name": profile.get("name") or "",
            "target_position": basic_requested.get("target_position")
            or basic_requested.get("title")
            or profile.get("expected_position")
            or "",
            "email": profile.get("email") or "",
            "phone": profile.get("phone") or "",
            "location": profile.get("expected_location") or "",
            # birth_date: 优先用 profile（学生在个人中心填的），
            # 否则保留模型提交的值（用户在对话中告诉 AI 的出生日期）
            "birth_date": _normalize_month_value(
                profile.get("birth_date")
                or basic_requested.get("birth_date")
                or basic_requested.get("birthDate")
                or ""
            ),
        },
        "education": education,
        "experience": experience,
        "projects": projects,
        "skills": "\n".join(skill_lines),
        # Phase 4.3: self_evaluation 不再从 personal_advantages 原样搬运
        # 将 personal_advantages 作为参考素材传入，由模型基于 JD 重写
        "self_evaluation": "",
    }
    return safe_args, result.get("profile_completeness") or {}


def _normalize_evidence(value: Any) -> str:
    text = "\n".join(_rich_text_to_lines(value)) if isinstance(value, str) and "<" in value else str(value or "")
    return _re.sub(r"[\W_]+", "", text, flags=_re.UNICODE).lower()


def _collect_evidence_values(value: Any) -> list[str]:
    values: list[str] = []
    if isinstance(value, dict):
        for item in value.values():
            values.extend(_collect_evidence_values(item))
    elif isinstance(value, (list, tuple)):
        for item in value:
            values.extend(_collect_evidence_values(item))
    elif value not in (None, "", False):
        text = str(value).strip()
        if text:
            values.append(text)
            values.extend(line for line in _rich_text_to_lines(text) if line != text)
    return values


# P4: _fact_values_from_args / _norm_token / _is_chinese_noun /
# _noun_has_source / _validate_resume_facts 原在此处本地重复定义，现已统一
# 收敛到 app.student.agent_fact_guard（见文件顶部 import），消除 DRY 违规。


# Shadow mode 开关：开启时违规只写日志不拦截，用于收集真实误报率。
# 生产环境建议先开启 shadow mode 跑几天，观察日志后再关闭。
FACT_GUARD_SHADOW_MODE = False

# 条目归属校验 shadow mode（独立于 FACT_GUARD_SHADOW_MODE）
# 开启时只记录日志不拦截，用于收集真实误报率
ITEM_ATTRIBUTION_SHADOW_MODE = True


def _fact_guard_failure(tool: str, violations: list[str], whitelist: Optional[FactWhitelist] = None) -> dict[str, Any]:
    preview = "；".join(violations[:6])
    if FACT_GUARD_SHADOW_MODE:
        logger.warning("fact_guard shadow_mode violation tool=%s violations=%s", tool, violations[:10])
        return {
            "status": "completed",
            "tool": tool,
            "summary": f"（shadow mode）事实校验发现以下内容缺少依据，但未拦截：{preview}",
            "fact_validation": {"passed": True, "shadow_violations": violations[:20]},
        }
    n = len(violations)
    examples = []
    for v in violations[:2]:
        # 从 "无来源数字指标「40%」" 中提取引号内容
        if "「" in v and "」" in v:
            examples.append(v[v.index("「")+1:v.index("」")])
    example_text = "、".join(f"「{e}」" for e in examples) if examples else ""
    suffix = f"（如{example_text}等 {n} 处）" if example_text else f"（共 {n} 处）"
    # 白名单反馈：告诉模型哪些专名和时间段是可用的
    whitelist_hint = ""
    if whitelist:
        avail_nouns = sorted(whitelist.proper_nouns)[:10]
        avail_times = sorted(whitelist.time_ranges)[:6]
        if avail_nouns:
            whitelist_hint += f"\n可用专名：{'、'.join(avail_nouns)}等 {len(whitelist.proper_nouns)} 个。"
        if avail_times:
            whitelist_hint += f"\n可用时间段：{'、'.join(avail_times)}等 {len(whitelist.time_ranges)} 段。"
        if whitelist_hint:
            whitelist_hint += "\n请确保输出中的专名和时间段在以上白名单内。"
        # description 中的疑似专名 warning
        desc_sus = getattr(whitelist, "_desc_suspicious", None)
        if desc_sus:
            whitelist_hint += (
                f"\n⚠️ 以下词出现在经历描述中但不在白名单，请核实是否属实：{'、'.join(desc_sus[:6])}。"
                f"若属实请补充到档案中，若不属实请删除。"
            )

    return {
        "status": "failed",
        "tool": tool,
        "error_code": "fact_guard_retry",
        "recoverable": True,
        "summary": (
            f"Harness 事实校验未通过，简历未保存。以下关键实体在个人档案或原简历中找不到依据：{preview}。"
            "请先让学生补充或确认这些信息（可调用 query_student_profile 或 read_resume 核实），"
            "禁止换一种说法绕过校验。允许改写表达和措辞，但不允许新增无来源的经历、项目、技术栈或指标。"
            "时间比对对分隔符不敏感（2026-03 与 2026.03 等价），请统一输出为 YYYY-MM 格式，不要保留具体日期，也不要照抄档案中的全角句号等笔误。"
            + whitelist_hint
        ),
        "display_summary": f"简历里有 {n} 处对不上档案，正在帮你核实修正",
        "fact_validation": {"passed": False, "violations": violations[:20]},
    }


def _resume_count(db: Session, identity: AuthIdentity) -> int:
    return db.scalar(
        select(func.count(StudentResume.id)).where(
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
    ) or 0


def _generate_resume_data_tool(
    db: Session, identity: AuthIdentity, args: dict[str, Any],
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    """生成简历：不再丢弃模型文本，而是用事实层校验保护真实性。"""
    if _resume_count(db, identity) >= _MAX_RESUMES:
        return {
            "status": "failed",
            "tool": "generate_resume_data",
            "summary": f"简历数量已达上限（{_MAX_RESUMES} 份），请先在『我的简历』中删除一份再生成。",
        }

    # 规范化字面转义（\n → 真换行），避免 nAI 等误提取
    args = _normalize_literal_escapes(args)

    # 收集证据源用于事实校验。
    # P3: profile 去重——若 evidence_pool 已有 profile_snapshot（dispatch 兜底时查过），
    # 直接复用，避免单次 run 内重复查 6+ 张明细表。snapshot 不含 profile_completeness，
    # 该字段只影响非关键展示，缺失时回退空。
    profile_completeness: dict[str, Any] = {}
    if evidence_pool and evidence_pool.profile_snapshot:
        profile = evidence_pool.profile_snapshot
    else:
        profile_result = _query_student_profile(db, identity)
        profile = profile_result.get("profile") or {}
        profile_completeness = profile_result.get("profile_completeness") or {}
    evidence_sources: list[Any] = [profile]
    if evidence_pool:
        for source in evidence_pool.collect_evidence_sources():
            evidence_sources.append(source)

    # 事实层校验：身份字段会在保存前由服务端强制覆盖为真实档案，
    # 因此校验也应先按真实档案替换，避免模型提交的占位姓名误伤生成流程。
    validation_args = dict(args)
    validation_basic = dict(validation_args.get("basic") or {})
    for key in ("name", "email", "phone"):
        if profile.get(key):
            validation_basic[key] = profile[key]
    validation_args["basic"] = validation_basic

    # 事实层校验：只检查数字/技术词/专名/时间段是否在证据中
    violations, fact_whitelist = _validate_resume_facts(validation_args, evidence_sources)
    if violations:
        return _fact_guard_failure("generate_resume_data", violations, fact_whitelist)

    # 程度词阶梯检测
    role_escalation_violations = _check_role_escalation(validation_args, evidence_sources)
    if role_escalation_violations:
        return _fact_guard_failure("generate_resume_data", role_escalation_violations, fact_whitelist)

    # JD GAP 铁律：GAP 项禁止进入简历
    if evidence_pool and evidence_pool.gap_keywords:
        gap_violations = _check_gap_violations(validation_args, evidence_pool.gap_keywords)
        if gap_violations:
            return _fact_guard_failure("generate_resume_data", gap_violations, fact_whitelist)

    # 条目归属校验（shadow mode：只记录不拦截）
    attribution_violations = _check_item_attribution(validation_args, evidence_sources)
    if attribution_violations:
        if ITEM_ATTRIBUTION_SHADOW_MODE:
            logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", "generate_resume_data", attribution_violations[:10])
        else:
            return _fact_guard_failure("generate_resume_data", attribution_violations, fact_whitelist)

    # 质量闸门：仅当证据中有经历/项目时才要求章节非空
    _evidence_has_items = any(
        isinstance(s, dict) and (
            s.get("work_experiences") or s.get("experience") or s.get("projects")
            or s.get("educations") or s.get("education")
        )
        for s in evidence_sources
    )
    quality = _check_resume_quality(args, require_sections=_evidence_has_items)
    quality_hint = ""
    if quality.get("errors"):
        return {
            "status": "failed",
            "tool": "generate_resume_data",
            "error_code": "resume_quality_retry",
            "recoverable": True,
            "summary": "简历质量未达标，请修正以下问题后重试：" + "；".join(
                f"{e['section']}: {e['issue']}" for e in quality["errors"][:3]
            ),
            "display_summary": "正在按简历规范调整后重试",
            "quality_check": quality,
        }
    if quality.get("warnings"):
        quality_hint = "质量提示：" + "；".join(
            f"{w['section']}: {w['issue']}" for w in quality["warnings"][:3]
        )

    student = db.get(StudentUser, identity.user_id)
    title = str(args.get("title") or "AI 生成简历").strip()[:128] or "AI 生成简历"
    template_id = str(args.get("template_id") or "classic").strip()
    if template_id not in _VALID_TEMPLATE_IDS:
        template_id = "classic"

    # 使用模型提交的 args（含润色文本），不再丢弃
    # 但基本信息（姓名、邮箱、电话）仍从 profile 确保准确
    safe_args = dict(args)
    basic_in = safe_args.get("basic") or {}
    basic_in["name"] = profile.get("name") or basic_in.get("name") or ""
    basic_in["email"] = profile.get("email") or basic_in.get("email") or ""
    basic_in["phone"] = profile.get("phone") or basic_in.get("phone") or ""
    safe_args["basic"] = basic_in

    completeness = profile_completeness
    doc = _build_resume_doc(safe_args, student, title, template_id)
    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=title,
        template_id=template_id,
        visibility=False,
        data_json=json.dumps(doc, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    summary = f"简历《{title}》已生成，请在下方按钮进入编辑器查看并调整。"
    if quality_hint:
        summary += f"\n{quality_hint}"
    return {
        "status": "completed",
        "tool": "generate_resume_data",
        "summary": summary,
        "resume_id": row.id,
        "editor_url": f"/student/resumes/{row.id}",
        "open_resume_editor": True,
        "fact_validation": {
            "passed": True,
            "source": "model_polished_profile",
            "empty_sections": completeness.get("empty_sections") or [],
        },
        "quality_check": quality if quality.get("warnings") else None,
    }


def _optimize_resume_data_tool(
    db: Session,
    identity: AuthIdentity,
    args: dict[str, Any],
    attachments: Optional[list[StudentAgentAttachment]] = None,
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    if _resume_count(db, identity) >= _MAX_RESUMES:
        return {
            "status": "failed",
            "tool": "optimize_resume_data",
            "summary": f"简历数量已达上限（{_MAX_RESUMES} 份），请先在『我的简历』中删除一份再优化。",
        }
    student = db.get(StudentUser, identity.user_id)

    # 统一事实来源：优先使用 evidence_pool（如果可用），否则回退到直接查询
    evidence_sources: list[Any] = []
    src_row: Optional[StudentResume] = None
    src_id = args.get("source_resume_id")
    if src_id:
        src_row = db.scalar(
            select(StudentResume).where(
                StudentResume.id == int(src_id),
                StudentResume.student_id == identity.user_id,
                StudentResume.tenant_id == identity.tenant_id,
            )
        )
        if not src_row:
            return {
                "status": "failed",
                "tool": "optimize_resume_data",
                "summary": f"来源简历 ID {src_id} 不存在或无权限，未保存优化简历。",
            }
        try:
            evidence_sources.append(json.loads(src_row.data_json or "{}"))
        except Exception:
            evidence_sources.append({})

    # 统一证据来源：无论 evidence_pool 是否可用，都保证 profile 一定在证据中。
    # 典型跨轮场景：上一轮 read_resume + 建议，本轮用户确认后直接 optimize——
    # 此时 evidence_pool 为空（per-run），必须兜底查 profile。
    # P3: profile 去重——若 evidence_pool 已有 profile_snapshot 则复用。
    if evidence_pool and evidence_pool.profile_snapshot:
        profile = evidence_pool.profile_snapshot
        evidence_sources.append(profile)
    else:
        profile_result = _query_student_profile(db, identity)
        profile = profile_result.get("profile") or {}
        evidence_sources.append(profile)
    if evidence_pool:
        for source in evidence_pool.collect_evidence_sources():
            evidence_sources.append(source)
    if attachments:
        for attachment in attachments:
            text = _ensure_attachment_text(db, attachment)
            if text:
                evidence_sources.append(text)
    # 规范化字面转义（\n → 真换行），避免 nAI 等误提取
    args = _normalize_literal_escapes(args)

    violations, fact_whitelist = _validate_resume_facts(args, evidence_sources)
    if violations:
        return _fact_guard_failure("optimize_resume_data", violations, fact_whitelist)

    # 程度词阶梯检测
    role_escalation_violations = _check_role_escalation(args, evidence_sources)
    if role_escalation_violations:
        return _fact_guard_failure("optimize_resume_data", role_escalation_violations, fact_whitelist)

    # JD GAP 铁律：GAP 项禁止进入简历
    if evidence_pool and evidence_pool.gap_keywords:
        gap_violations = _check_gap_violations(args, evidence_pool.gap_keywords)
        if gap_violations:
            return _fact_guard_failure("optimize_resume_data", gap_violations, fact_whitelist)

    # 条目归属校验（shadow mode：只记录不拦截）
    attribution_violations = _check_item_attribution(args, evidence_sources)
    if attribution_violations:
        if ITEM_ATTRIBUTION_SHADOW_MODE:
            logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", "optimize_resume_data", attribution_violations[:10])
        else:
            return _fact_guard_failure("optimize_resume_data", attribution_violations, fact_whitelist)

    # 质量闸门（与 generate 共享同一套检查）
    _evidence_has_items = any(
        isinstance(s, dict) and (
            s.get("work_experiences") or s.get("experience") or s.get("projects")
            or s.get("educations") or s.get("education")
        )
        for s in evidence_sources
    )
    quality = _check_resume_quality(args, require_sections=_evidence_has_items)
    quality_hint = ""
    if quality.get("errors"):
        return {
            "status": "failed",
            "tool": "optimize_resume_data",
            "error_code": "resume_quality_retry",
            "recoverable": True,
            "summary": "简历质量未达标，请修正以下问题后重试：" + "；".join(
                f"{e['section']}: {e['issue']}" for e in quality["errors"][:3]
            ),
            "display_summary": "正在按简历规范调整后重试",
            "quality_check": quality,
        }
    if quality.get("warnings"):
        quality_hint = "质量提示：" + "；".join(
            f"{w['section']}: {w['issue']}" for w in quality["warnings"][:3]
        )

    # ── JD 覆盖率闸门 ──
    jd_text_for_coverage = args.get("jd_text") or (evidence_pool.jd_text if evidence_pool else None)
    if jd_text_for_coverage:
        coverage = _check_jd_coverage(args, jd_text_for_coverage)
        if coverage.get("severity") == "error":
            missing_preview = "、".join(coverage.get("missing", [])[:8])
            return {
                "status": "failed",
                "tool": "optimize_resume_data",
                "error_code": "jd_coverage_retry",
                "recoverable": True,
                "summary": (
                    f"JD 关键词覆盖率 {coverage['coverage_ratio']:.0%} 过低（阈值 15%）。"
                    f"未覆盖关键词：{missing_preview}。"
                    f"请调整 skills 和经历描述以覆盖岗位核心要求，或在差距分析中明确说明缺口。"
                ),
                "display_summary": f"正在补充岗位相关的关键词（目前覆盖 {coverage['coverage_ratio']:.0%}）",
                "jd_coverage": coverage,
            }
        if coverage.get("severity") == "warning":
            missing_preview = "、".join(coverage.get("missing", [])[:5])
            quality_hint += (
                f"\nJD 覆盖率提示：关键词覆盖率 {coverage['coverage_ratio']:.0%}（建议 ≥ 30%），"
                f"未覆盖词：{missing_preview}"
            )

    title = str(args.get("title") or "优化版简历").strip()[:128] or "优化版简历"
    template_id = str(args.get("template_id") or "classic").strip()
    if template_id not in _VALID_TEMPLATE_IDS:
        # 如果来源简历有模板，则继承
        if src_row:
            template_id = src_row.template_id or "classic"
        else:
            template_id = "classic"
    # 身份字段服务端强制覆盖（与 generate 对齐）：姓名/邮箱/电话以 profile 为准
    safe_args = dict(args)
    basic_in = safe_args.get("basic") or {}
    for key in ("name", "email", "phone"):
        if profile.get(key):
            basic_in[key] = profile[key]
    safe_args["basic"] = basic_in
    doc = _build_resume_doc(safe_args, student, title, template_id)
    row = StudentResume(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        title=title,
        template_id=template_id,
        visibility=False,
        data_json=json.dumps(doc, ensure_ascii=False),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    summary = f"优化版简历《{title}》已生成，请在下方按钮进入编辑器查看并调整。"
    if quality_hint:
        summary += f"\n{quality_hint}"
    return {
        "status": "completed",
        "tool": "optimize_resume_data",
        "summary": summary,
        "resume_id": row.id,
        "editor_url": f"/student/resumes/{row.id}",
        "open_resume_editor": True,
        "fact_validation": {"passed": True, "source": "profile_or_supplied_resume"},
        "quality_check": quality if quality.get("warnings") else None,
    }


_PATCH_LIST_SECTIONS = {"education", "experience", "projects"}
_PATCH_TEXT_SECTIONS = {"skills", "self_evaluation"}
_PATCH_SECTION_LABELS = {
    "title": "简历标题",
    "basic": "基本信息",
    "skills": "专业技能",
    "self_evaluation": "自我评价",
    "education": "教育经历",
    "experience": "工作经历",
    "projects": "项目经历",
}
_PATCH_ITEM_FIELD_ALIASES = {
    "start_date": "startDate",
    "end_date": "endDate",
    "description_text": "description",
    "details_text": "details",
}
_PATCH_BASIC_FIELD_ALIASES = {
    "target_position": "title",
    "birth_date": "birthDate",
}
_METRIC_TOKEN_RE = _re.compile(
    r"(?<![\d-])\d+(?:\.\d+)?\s*(?:%|％|万|千|亿|人|次|项|个|倍|小时|天|ms|秒|qps|QPS|\+)(?![\d-])"
)


def _patch_lines(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        raw = [str(item or "") for item in value]
    elif isinstance(value, str) and "<" in value:
        raw = _rich_text_to_lines(value)
    else:
        raw = str(value or "").splitlines()
    lines: list[str] = []
    for line in raw:
        clean = str(line or "").strip().lstrip("-•*·、 ").strip()
        if clean:
            lines.append(clean)
    return lines


def _patch_list_html(value: Any) -> str:
    return _ta_to_list("\n".join(_patch_lines(value)))


def _patch_para_html(value: Any) -> str:
    return _ta_to_para("\n".join(_patch_lines(value)))


def _clone_resume_doc(raw: dict[str, Any]) -> dict[str, Any]:
    try:
        return json.loads(json.dumps(raw or {}, ensure_ascii=False))
    except Exception:
        return dict(raw or {})


def _patch_error(summary: str, *, code: str = "resume_patch_invalid") -> dict[str, Any]:
    return {
        "status": "failed",
        "tool": "apply_resume_patch",
        "error_code": code,
        "recoverable": True,
        "summary": summary,
        "display_summary": "这次修改需要再确认一下目标内容",
    }


def _patch_target_index(items: list[dict[str, Any]], patch: dict[str, Any]) -> Optional[int]:
    target_id = str(patch.get("target_id") or patch.get("item_id") or "").strip()
    if target_id:
        for idx, item in enumerate(items):
            if str(item.get("id") or "") == target_id:
                return idx
    raw_index = patch.get("target_index") if patch.get("target_index") is not None else patch.get("index")
    if raw_index is not None:
        try:
            idx = int(raw_index) - 1
            if 0 <= idx < len(items):
                return idx
        except (TypeError, ValueError):
            return None
    target_text = str(patch.get("target_text") or patch.get("match_text") or "").strip()
    if target_text:
        needle = _normalize_evidence(target_text)
        for idx, item in enumerate(items):
            haystack = _normalize_evidence(" ".join(_collect_evidence_values(item)))
            if needle and needle in haystack:
                return idx
    return None


def _normalize_patch_item(section: str, value: Any) -> dict[str, Any]:
    src = value if isinstance(value, dict) else {}
    if section == "education":
        return {
            "id": src.get("id") or f"edu-{uuid.uuid4().hex[:8]}",
            "school": src.get("school") or "",
            "major": src.get("major") or "",
            "degree": src.get("degree") or "",
            "startDate": src.get("start_date") or src.get("startDate") or "",
            "endDate": src.get("end_date") or src.get("endDate") or "",
            "gpa": src.get("gpa") or "",
            "description": _patch_list_html(src.get("description") or ""),
            "visible": src.get("visible", True),
        }
    if section == "experience":
        return {
            "id": src.get("id") or f"exp-{uuid.uuid4().hex[:8]}",
            "company": src.get("company") or "",
            "position": src.get("position") or "",
            "date": src.get("date") or "",
            "details": _patch_list_html(src.get("details") or src.get("description") or ""),
            "visible": src.get("visible", True),
        }
    return {
        "id": src.get("id") or f"proj-{uuid.uuid4().hex[:8]}",
        "name": src.get("name") or "",
        "role": src.get("role") or "",
        "date": src.get("date") or "",
        "description": _patch_list_html(src.get("description") or src.get("details") or ""),
        "visible": src.get("visible", True),
        "link": src.get("link") or "",
        "linkLabel": src.get("linkLabel") or src.get("link_label") or "",
    }


def _apply_patch_fields(section: str, item: dict[str, Any], fields: dict[str, Any]) -> list[str]:
    changed: list[str] = []
    for raw_key, raw_value in fields.items():
        key = _PATCH_ITEM_FIELD_ALIASES.get(str(raw_key), str(raw_key))
        if section == "experience" and key in {"description", "details"}:
            key = "details"
            value = _patch_list_html(raw_value)
        elif section in {"projects", "education"} and key in {"description", "details"}:
            key = "description"
            value = _patch_list_html(raw_value)
        elif section == "education" and key in {"startDate", "endDate"}:
            value = str(raw_value or "")
        elif key == "visible":
            value = bool(raw_value)
        else:
            value = str(raw_value or "")
        if item.get(key) != value:
            item[key] = value
            changed.append(key)
    return changed


def _apply_resume_patch_operations(
    existing: dict[str, Any],
    *,
    row_title: str,
    row_template_id: str,
    args: dict[str, Any],
) -> tuple[Optional[dict[str, Any]], Optional[str], Optional[str], dict[str, Any], Optional[dict[str, Any]]]:
    doc = _clone_resume_doc(existing)
    title = row_title
    template_id = row_template_id
    patches = args.get("patches") or []
    if not isinstance(patches, list) or not patches:
        return None, None, None, {}, _patch_error("没有收到要修改的内容。")

    changes: dict[str, Any] = {"updated_sections": [], "field_changes": [], "items": []}
    for patch in patches:
        if not isinstance(patch, dict):
            return None, None, None, changes, _patch_error("修改内容格式不正确，请重新整理后再试。")
        action = str(patch.get("action") or "").strip()
        section = str(patch.get("section") or "").strip()
        label = _PATCH_SECTION_LABELS.get(section, section or "简历")
        if not action or section not in _PATCH_SECTION_LABELS:
            return None, None, None, changes, _patch_error("有一处修改没有说明要改哪个板块。")

        if section == "title":
            value = str(patch.get("value") or "").strip()
            if not value:
                return None, None, None, changes, _patch_error("新的简历标题不能为空。")
            title = value[:128]
            doc["title"] = title
            changes["field_changes"].append("简历标题")
            changes["items"].append({"section": section, "action": "set_field", "summary": "更新简历标题"})
            continue

        if section == "basic":
            field = str(patch.get("field") or "").strip()
            field = _PATCH_BASIC_FIELD_ALIASES.get(field, field)
            if not field:
                return None, None, None, changes, _patch_error("基本信息修改缺少字段名。")
            basic = doc.setdefault("basic", {})
            if not isinstance(basic, dict):
                basic = {}
                doc["basic"] = basic
            basic[field] = str(patch.get("value") or "")
            changes["field_changes"].append(f"基本信息: {field}")
            changes["items"].append({"section": section, "action": "set_field", "summary": f"更新基本信息 {field}"})
            continue

        if section in _PATCH_TEXT_SECTIONS:
            html_key = "skillContent" if section == "skills" else "selfEvaluationContent"
            current_lines = _rich_text_to_lines(str(doc.get(html_key) or ""))
            value_lines = _patch_lines(patch.get("value"))
            if action in {"set_field", "rewrite"}:
                doc[html_key] = _patch_list_html(value_lines) if section == "skills" else _patch_para_html(value_lines)
                changes["field_changes"].append(label)
                changes["items"].append({"section": section, "action": action, "summary": f"改写{label}"})
            elif action == "append_lines":
                merged = list(current_lines)
                for line in value_lines:
                    if line not in merged:
                        merged.append(line)
                doc[html_key] = _patch_list_html(merged) if section == "skills" else _patch_para_html(merged)
                changes["field_changes"].append(label)
                changes["items"].append({"section": section, "action": action, "summary": f"补充{label}"})
            elif action == "remove_lines":
                needles = {_normalize_evidence(line) for line in value_lines}
                kept = [line for line in current_lines if _normalize_evidence(line) not in needles]
                doc[html_key] = _patch_list_html(kept) if section == "skills" else _patch_para_html(kept)
                changes["field_changes"].append(label)
                changes["items"].append({"section": section, "action": action, "summary": f"删减{label}"})
            else:
                return None, None, None, changes, _patch_error(f"{label}暂不支持这个修改动作：{action}")
            continue

        if section in _PATCH_LIST_SECTIONS:
            items = doc.setdefault(section, [])
            if not isinstance(items, list):
                items = []
                doc[section] = items
            if action == "add_item":
                item = _normalize_patch_item(section, patch.get("value") or patch.get("fields") or {})
                items.append(item)
                changes["field_changes"].append(f"{label}: +1 条")
                changes["items"].append({"section": section, "action": action, "summary": f"新增{label}"})
                continue
            idx = _patch_target_index(items, patch)
            if idx is None:
                return None, None, None, changes, _patch_error(f"没有定位到要修改的{label}，请说清楚是哪一段。", code="resume_patch_target_not_found")
            if action == "delete_item":
                items.pop(idx)
                changes["field_changes"].append(f"{label}: -1 条")
                changes["items"].append({"section": section, "action": action, "summary": f"删除第 {idx + 1} 条{label}"})
                continue
            if action == "update_item":
                fields = patch.get("fields")
                if not isinstance(fields, dict):
                    value = patch.get("value")
                    fields = value if isinstance(value, dict) else {}
                field = str(patch.get("field") or "").strip()
                if field:
                    fields[field] = patch.get("value")
                if not fields:
                    return None, None, None, changes, _patch_error(f"{label}修改缺少新内容。")
                changed_fields = _apply_patch_fields(section, items[idx], fields)
                if changed_fields:
                    changes["field_changes"].append(f"{label}: 第 {idx + 1} 条")
                    changes["items"].append({"section": section, "action": action, "summary": f"更新第 {idx + 1} 条{label}", "fields": changed_fields})
                continue
            return None, None, None, changes, _patch_error(f"{label}暂不支持这个修改动作：{action}")

    deduped_sections = []
    for item in changes["items"]:
        section = item.get("section")
        if section and section not in deduped_sections:
            deduped_sections.append(section)
    changes["updated_sections"] = deduped_sections
    changes["summary"] = "、".join(changes["field_changes"][:6]) if changes["field_changes"] else "内容已更新"
    doc["title"] = title
    doc["templateId"] = template_id
    return doc, title, template_id, changes, None


def _resume_doc_to_tool_args(doc: dict[str, Any], *, title: str, template_id: str) -> dict[str, Any]:
    basic = doc.get("basic") or {}
    return {
        "title": title,
        "template_id": template_id,
        "basic": {
            "name": basic.get("name") or "",
            "target_position": basic.get("title") or "",
            "email": basic.get("email") or "",
            "phone": basic.get("phone") or "",
            "location": basic.get("location") or "",
            "birth_date": basic.get("birthDate") or "",
        },
        "education": [
            {
                "school": item.get("school") or "",
                "major": item.get("major") or "",
                "degree": item.get("degree") or "",
                "start_date": item.get("startDate") or "",
                "end_date": item.get("endDate") or "",
                "gpa": item.get("gpa") or "",
                "description": "\n".join(_rich_text_to_lines(item.get("description") or "")),
            }
            for item in (doc.get("education") or []) if isinstance(item, dict) and item.get("visible", True) is not False
        ],
        "experience": [
            {
                "company": item.get("company") or "",
                "position": item.get("position") or "",
                "date": item.get("date") or "",
                "details": "\n".join(_rich_text_to_lines(item.get("details") or "")),
            }
            for item in (doc.get("experience") or []) if isinstance(item, dict) and item.get("visible", True) is not False
        ],
        "projects": [
            {
                "name": item.get("name") or "",
                "role": item.get("role") or "",
                "date": item.get("date") or "",
                "description": "\n".join(_rich_text_to_lines(item.get("description") or "")),
            }
            for item in (doc.get("projects") or []) if isinstance(item, dict) and item.get("visible", True) is not False
        ],
        "skills": "\n".join(_rich_text_to_lines(doc.get("skillContent") or "")),
        "self_evaluation": "\n".join(_rich_text_to_lines(doc.get("selfEvaluationContent") or "")),
    }


def _metric_tokens_from_sources(sources: list[Any]) -> set[str]:
    text_parts: list[str] = []
    for source in sources:
        if isinstance(source, str):
            text_parts.append(source)
        elif isinstance(source, dict):
            text_parts.extend(_collect_evidence_values(source))
        elif isinstance(source, list):
            for item in source:
                if isinstance(item, dict):
                    text_parts.extend(_collect_evidence_values(item))
                else:
                    text_parts.append(str(item))
    blob = "\n".join(text_parts)
    return {_re.sub(r"\s+", "", m.group(0)) for m in _METRIC_TOKEN_RE.finditer(blob)}


def _check_unbacked_metrics(args: dict[str, Any], evidence_sources: list[Any]) -> list[str]:
    evidence_metrics = _metric_tokens_from_sources(evidence_sources)
    candidate_metrics = _metric_tokens_from_sources([args])
    missing = sorted(metric for metric in candidate_metrics if metric not in evidence_metrics)
    return [f"数字「{metric}」没有来源" for metric in missing[:10]]


def _review_resume_patch_result(
    args: dict[str, Any],
    evidence_sources: list[Any],
    evidence_pool: Optional[SessionEvidencePool],
) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    violations, fact_whitelist = _validate_resume_facts(args, evidence_sources)
    errors.extend(violations)
    errors.extend(_check_role_escalation(args, evidence_sources))
    errors.extend(_check_unbacked_metrics(args, evidence_sources))
    if evidence_pool and evidence_pool.gap_keywords:
        errors.extend(_check_gap_violations(args, evidence_pool.gap_keywords))
    attribution_violations = _check_item_attribution(args, evidence_sources)
    if attribution_violations:
        if ITEM_ATTRIBUTION_SHADOW_MODE:
            logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", "apply_resume_patch", attribution_violations[:10])
        else:
            errors.extend(attribution_violations)
    quality = _check_resume_quality(args, require_sections=False)
    errors.extend(f"{e['section']}: {e['issue']}" for e in quality.get("errors") or [])
    warnings.extend(f"{w['section']}: {w['issue']}" for w in quality.get("warnings") or [])
    return {
        "passed": not errors,
        "checks": [
            "已重新读取修改后的简历",
            "已检查新增信息是否有来源",
            "已检查表达是否夸大",
            "已检查格式和简历表达",
        ],
        "errors": errors[:10],
        "warnings": warnings[:10],
        "quality_check": quality,
        "fact_whitelist": fact_whitelist,
    }


def _friendly_review_errors(errors: list[str]) -> str:
    if not errors:
        return "有几处内容需要再确认。"
    friendly: list[str] = []
    for error in errors[:4]:
        text = str(error)
        if "无来源专名" in text or "没有来源" in text or "找不到依据" in text:
            friendly.append("有内容在你的简历或档案里找不到依据")
        elif "角色升级" in text or "主导" in text or "独立" in text:
            friendly.append("有表达可能夸大了你的实际职责")
        elif "GAP" in text:
            friendly.append("有岗位缺口能力不能直接写进简历")
        elif "时间格式" in text or "YYYY-MM" in text:
            friendly.append("有时间格式需要统一")
        elif "空话" in text or "自我评价" in text:
            friendly.append("自我评价里还有偏空泛的表达")
        else:
            friendly.append("有一处内容需要再确认")
    deduped = list(dict.fromkeys(friendly))
    return "；".join(deduped)


def _apply_resume_patch_tool(
    db: Session,
    identity: AuthIdentity,
    args: dict[str, Any],
    evidence_pool: Optional[SessionEvidencePool] = None,
    session: Optional[StudentAgentSession] = None,
) -> dict[str, Any]:
    args = _normalize_literal_escapes(args)
    resume_id = args.get("resume_id")
    if not resume_id and session:
        resume_id = getattr(session, "active_resume_id", None)
    if not resume_id:
        return _patch_error("还没有选中要修改的简历。请先选择当前要编辑的简历。", code="resume_patch_missing_resume")
    row = db.scalar(
        select(StudentResume).where(
            StudentResume.id == int(resume_id),
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
    )
    if not row:
        return _patch_error(f"简历 ID {resume_id} 不存在或无权限。", code="resume_patch_not_found")

    base_updated_at = args.get("base_updated_at")
    if base_updated_at and row.updated_at:
        try:
            base_dt = datetime.fromisoformat(str(base_updated_at).replace("Z", "+00:00"))
            if base_dt.tzinfo is None:
                base_dt = base_dt.replace(tzinfo=timezone.utc)
            row_dt = row.updated_at.replace(tzinfo=timezone.utc) if row.updated_at.tzinfo is None else row.updated_at
            if abs((row_dt - base_dt).total_seconds()) > 1:
                return {
                    "status": "failed",
                    "tool": "apply_resume_patch",
                    "error_code": "resume_version_retry",
                    "recoverable": True,
                    "summary": "这份简历在读取之后被修改过，请重新读取最新版后再做最小修改。",
                    "display_summary": "简历刚被改过，正在重新读取最新版",
                }
        except (ValueError, TypeError):
            pass

    original_title = row.title
    original_template_id = row.template_id
    try:
        existing = json.loads(row.data_json or "{}")
        if not isinstance(existing, dict):
            existing = {}
    except Exception:
        existing = {}

    next_doc, next_title, next_template_id, changes, apply_error = _apply_resume_patch_operations(
        existing,
        row_title=row.title,
        row_template_id=row.template_id,
        args=args,
    )
    if apply_error:
        return apply_error
    assert next_doc is not None and next_title is not None and next_template_id is not None

    if evidence_pool:
        evidence_sources = evidence_pool.collect_evidence_sources()
        if not evidence_pool.profile_snapshot:
            profile_result = _query_student_profile(db, identity)
            profile = profile_result.get("profile") or {}
            evidence_pool.set_profile(profile)
            evidence_sources.append(profile)
    else:
        profile_result = _query_student_profile(db, identity)
        evidence_sources = [profile_result.get("profile") or {}]
    evidence_sources.append(existing)

    review_args = _resume_doc_to_tool_args(next_doc, title=next_title, template_id=next_template_id)
    pre_review = _review_resume_patch_result(review_args, evidence_sources, evidence_pool)
    if not pre_review["passed"]:
        return {
            "status": "failed",
            "tool": "apply_resume_patch",
            "error_code": "resume_patch_review_retry",
            "recoverable": True,
            "summary": "修改后的简历 review 未通过：" + _friendly_review_errors(pre_review["errors"]),
            "display_summary": "这次修改有几处信息对不上，正在调整后再试",
            "review": {k: v for k, v in pre_review.items() if k != "fact_whitelist"},
        }

    revision_id = _snapshot_resume_revision(db, identity, row, source="ai_update", session_id=session.id if session else None)
    row.title = next_title
    row.template_id = next_template_id
    next_doc["title"] = next_title
    next_doc["templateId"] = next_template_id
    row.data_json = json.dumps(next_doc, ensure_ascii=False)
    db.commit()
    db.refresh(row)

    try:
        saved_doc = json.loads(row.data_json or "{}")
        if not isinstance(saved_doc, dict):
            saved_doc = {}
    except Exception:
        saved_doc = {}
    post_args = _resume_doc_to_tool_args(saved_doc, title=row.title, template_id=row.template_id)
    post_review = _review_resume_patch_result(post_args, evidence_sources, evidence_pool)
    if not post_review["passed"]:
        row.data_json = json.dumps(existing, ensure_ascii=False)
        row.title = original_title
        row.template_id = original_template_id
        db.commit()
        return {
            "status": "failed",
            "tool": "apply_resume_patch",
            "error_code": "resume_patch_review_failed",
            "recoverable": True,
            "summary": "保存后 review 未通过，已恢复到修改前：" + _friendly_review_errors(post_review["errors"]),
            "display_summary": "这次修改没有通过检查，已恢复到修改前",
            "review": {k: v for k, v in post_review.items() if k != "fact_whitelist"},
        }

    review_public = {k: v for k, v in post_review.items() if k != "fact_whitelist"}
    summary_bits = changes.get("field_changes") or []
    summary = f"简历《{row.title}》已修改并完成 review。"
    if summary_bits:
        summary += "本次主要调整：" + "、".join(summary_bits[:4]) + "。"
    if post_review.get("warnings"):
        summary += "另有几处表达可继续精修。"
    return {
        "status": "completed",
        "tool": "apply_resume_patch",
        "summary": summary,
        "resume_id": row.id,
        "editor_url": f"/student/resumes/{row.id}",
        "open_resume_editor": True,
        "revision_id": revision_id,
        "changes": changes,
        "review": review_public,
        "review_passed": True,
        "reviewed_resume_preview": _structured_resume_to_text(row)[:1200],
    }


def _update_resume_data_tool(db: Session, identity: AuthIdentity, args: dict[str, Any], evidence_pool: Optional[SessionEvidencePool] = None, session: Optional[StudentAgentSession] = None) -> dict[str, Any]:
    resume_id = args.get("resume_id")
    if not resume_id and session:
        resume_id = getattr(session, "active_resume_id", None)
    if not resume_id:
        return {"status": "failed", "tool": "update_resume_data", "summary": "缺少 resume_id 参数，且未绑定工作简历。请先确认要编辑哪份简历。"}
    row = db.scalar(
        select(StudentResume).where(
            StudentResume.id == int(resume_id),
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
    )
    if not row:
        return {"status": "failed", "tool": "update_resume_data", "summary": f"简历 ID {resume_id} 不存在或无权限。"}

    # A3: 写前版本检查 — 防止盖掉用户在编辑器里的手改
    base_updated_at = args.get("base_updated_at")
    if base_updated_at and row.updated_at:
        try:
            base_dt = datetime.fromisoformat(base_updated_at.replace("Z", "+00:00"))
            if base_dt.tzinfo is None:
                base_dt = base_dt.replace(tzinfo=timezone.utc)
            row_dt = row.updated_at.replace(tzinfo=timezone.utc) if row.updated_at.tzinfo is None else row.updated_at
            if abs((row_dt - base_dt).total_seconds()) > 1:
                return {
                    "status": "failed",
                    "tool": "update_resume_data",
                    "error_code": "resume_version_retry",
                    "recoverable": True,
                    "summary": "这份简历在你读取之后被修改过（可能是用户手动编辑），请重新 read_resume 获取最新内容后再做最小修改。",
                    "display_summary": "简历刚被改过，正在重新读取最新版",
                }
        except (ValueError, TypeError):
            pass  # 解析失败不阻塞

    try:
        existing = json.loads(row.data_json or "{}")
    except Exception:
        existing = {}

    if evidence_pool:
        evidence_sources_for_validate = evidence_pool.collect_evidence_sources()
        if existing:
            evidence_sources_for_validate.append(existing)
    else:
        profile_result = _query_student_profile(db, identity)
        evidence_sources_for_validate = [profile_result.get("profile") or {}, existing]
    # 规范化字面转义（\n → 真换行），避免 nAI 等误提取
    args = _normalize_literal_escapes(args)

    violations, fact_whitelist = _validate_resume_facts(args, evidence_sources_for_validate)
    if violations:
        return _fact_guard_failure("update_resume_data", violations, fact_whitelist)

    # 程度词阶梯检测
    role_escalation_violations = _check_role_escalation(args, evidence_sources_for_validate)
    if role_escalation_violations:
        return _fact_guard_failure("update_resume_data", role_escalation_violations, fact_whitelist)

    # JD GAP 铁律：GAP 项禁止进入简历
    if evidence_pool and evidence_pool.gap_keywords:
        gap_violations = _check_gap_violations(args, evidence_pool.gap_keywords)
        if gap_violations:
            return _fact_guard_failure("update_resume_data", gap_violations, fact_whitelist)

    # 条目归属校验（shadow mode：只记录不拦截）
    attribution_violations = _check_item_attribution(args, evidence_sources_for_validate)
    if attribution_violations:
        if ITEM_ATTRIBUTION_SHADOW_MODE:
            logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", "update_resume_data", attribution_violations[:10])
        else:
            return _fact_guard_failure("update_resume_data", attribution_violations, fact_whitelist)

    # 质量闸门：update 是部分合并工具，args 里缺少的章节会保留原有内容，
    # 不可能出现「清空所有章节」的情况，因此不需要空章节检查。
    quality = _check_resume_quality(args, require_sections=False)
    quality_hint = ""
    if quality.get("errors"):
        return {
            "status": "failed",
            "tool": "update_resume_data",
            "error_code": "resume_quality_retry",
            "recoverable": True,
            "summary": "简历质量未达标，请修正以下问题后重试：" + "；".join(
                f"{e['section']}: {e['issue']}" for e in quality["errors"][:3]
            ),
            "display_summary": "正在按简历规范调整后重试",
            "quality_check": quality,
        }
    if quality.get("warnings"):
        quality_hint = "质量提示：" + "；".join(
            f"{w['section']}: {w['issue']}" for w in quality["warnings"][:3]
        )

    # A4: 合并前快照，用于计算变更摘要
    old_existing = {k: (v[:] if isinstance(v, list) else v) for k, v in existing.items()}

    # B2: 写入前快照（撤销功能）——必须在任何 row 字段被改之前
    session_id = session.id if session else None
    revision_id = _snapshot_resume_revision(db, identity, row, source="ai_update", session_id=session_id)

    # 合并标题和模板
    if args.get("title"):
        row.title = str(args["title"]).strip()[:128]
        existing["title"] = row.title
    if args.get("template_id") and args["template_id"] in _VALID_TEMPLATE_IDS:
        row.template_id = str(args["template_id"])
        existing["templateId"] = row.template_id

    student = db.get(StudentUser, identity.user_id)

    # 合并各字段（如果 AI 提供了就覆盖，否则保留原有）
    def _to_list_if_str(val: Any) -> Any:
        return _ta_to_list(val) if isinstance(val, str) else val

    if args.get("basic"):
        basic_in = args["basic"]
        existing_basic = existing.get("basic") or {}
        # 身份字段服务端强制覆盖：profile 有值时一律用 profile，不信任模型
        profile_result = _query_student_profile(db, identity)
        profile = profile_result.get("profile") or {}
        for key, ai_key in [("name", "name"), ("title", "target_position"), ("email", "email"), ("phone", "phone"), ("location", "location"), ("birthDate", "birth_date")]:
            # 身份字段以 profile 为准
            if ai_key in ("name", "email", "phone") and profile.get(ai_key):
                existing_basic[key] = profile[ai_key]
                continue
            val = basic_in.get(ai_key) or basic_in.get(key)
            if val:
                existing_basic[key] = val
        existing_basic.setdefault("title", basic_in.get("target_position") or basic_in.get("title") or existing_basic.get("title") or "")
        existing["basic"] = existing_basic

    if args.get("education") is not None:
        existing["education"] = [
            {
                "id": item.get("id") or f"edu-{uuid.uuid4().hex[:8]}",
                "school": item.get("school") or "",
                "major": item.get("major") or "",
                "degree": item.get("degree") or "",
                "startDate": item.get("start_date") or item.get("startDate") or "",
                "endDate": item.get("end_date") or item.get("endDate") or "",
                "gpa": item.get("gpa") or "",
                "description": _ta_to_list(item["description"]) if isinstance(item.get("description"), str) else item.get("description") or "",
                "visible": item.get("visible", True),
            }
            for item in args["education"] if isinstance(item, dict)
        ]

    if args.get("experience") is not None:
        existing["experience"] = [
            {
                "id": item.get("id") or f"exp-{uuid.uuid4().hex[:8]}",
                "company": item.get("company") or "",
                "position": item.get("position") or "",
                "date": item.get("date") or "",
                "details": _ta_to_list(item["details"]) if isinstance(item.get("details"), str) else item.get("details") or "",
                "visible": item.get("visible", True),
            }
            for item in args["experience"] if isinstance(item, dict)
        ]

    if args.get("projects") is not None:
        existing["projects"] = [
            {
                "id": item.get("id") or f"proj-{uuid.uuid4().hex[:8]}",
                "name": item.get("name") or "",
                "role": item.get("role") or "",
                "date": item.get("date") or "",
                "description": _ta_to_list(item["description"]) if isinstance(item.get("description"), str) else item.get("description") or "",
                "visible": item.get("visible", True),
                "link": item.get("link") or "",
                "linkLabel": item.get("linkLabel") or "",
            }
            for item in args["projects"] if isinstance(item, dict)
        ]

    if args.get("skills") is not None:
        existing["skillContent"] = _ta_to_list(args["skills"]) if args["skills"] else ""

    if args.get("self_evaluation") is not None:
        existing["selfEvaluationContent"] = _ta_to_para(args["self_evaluation"]) if args["self_evaluation"] else ""

    # A4: 计算变更摘要
    changes: dict[str, Any] = {"updated_sections": [], "field_changes": []}
    for section_key in ("education", "experience", "projects"):
        old_count = len(old_existing.get(section_key) or [])
        new_count = len(existing.get(section_key) or [])
        if section_key in args:
            section_label = {"education": "教育经历", "experience": "工作经历", "projects": "项目经历"}[section_key]
            changes["updated_sections"].append(section_key)
            changes["field_changes"].append(f"{section_label}: {old_count}→{new_count} 条")
    for field_key in ("title", "template_id", "basic", "skills", "self_evaluation"):
        if field_key in args:
            changes["updated_sections"].append(field_key)
            changes["field_changes"].append(field_key)
    changes["summary"] = "、".join(changes["field_changes"]) if changes["field_changes"] else "内容已更新"

    row.data_json = json.dumps(existing, ensure_ascii=False)
    db.commit()
    db.refresh(row)
    summary = f"简历《{row.title}》已更新，请在下方按钮进入编辑器查看。"
    if quality_hint:
        summary += f"\n{quality_hint}"
    return {
        "status": "completed",
        "tool": "update_resume_data",
        "summary": summary,
        "resume_id": row.id,
        "editor_url": f"/student/resumes/{row.id}",
        "open_resume_editor": True,
        "revision_id": revision_id,
        "changes": changes,
    }


def _safe_pdf_filename(name: str) -> str:
    base = Path(name.strip()).name or "优化简历"
    if base.lower().endswith(".pdf"):
        base = base[:-4]
    base = "".join(ch for ch in base if ch not in '\\/:*?"<>|').strip() or "优化简历"
    return f"{base[:60]}.pdf"


def _attachment_download_url(stored_path: Path | str, user_id: int = 0, tenant_id: int = 0) -> str:
    """生成带签名 token 的下载 URL。

    调用方应传入 user_id 和 tenant_id 以生成带身份绑定的签名链接。
    当未传入时回退到无 token 的相对路径（仅用于内部序列化，不用于前端展示）。
    """
    from app.main import _sign_download_token
    s = str(stored_path).replace("\\", "/")
    marker = "agent_uploads/"
    idx = s.find(marker)
    rel_path = s[idx:] if idx >= 0 else Path(s).name
    if user_id is not None and tenant_id is not None:
        token = _sign_download_token(rel_path, user_id, tenant_id)
        return f"/api/v1/student/files/download?path={rel_path}&token={token}"
    return f"/api/v1/student/files/download?path={rel_path}"


def _resolve_student_photo(db: Session, identity: AuthIdentity) -> Optional[str]:
    """解析学生头像的本地文件路径，用于简历照片；找不到/非图片则返回 None。"""
    student = db.get(StudentUser, identity.user_id)
    avatar_url = getattr(student, "avatar_url", None) if student else None
    if not avatar_url:
        return None
    name = Path(str(avatar_url)).name
    if Path(name).suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        return None
    for base in ("/app/data/avatars", "data/avatars", "./data/avatars"):
        candidate = Path(base) / name
        if candidate.exists():
            return str(candidate)
    return None


async def _export_resume_pdf_tool_async(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    assistant_message: StudentAgentMessage,
    args: dict[str, Any],
    attachments: Optional[list[StudentAgentAttachment]] = None,
    evidence_pool: Optional[SessionEvidencePool] = None,
) -> dict[str, Any]:
    """导出简历 PDF（异步版本）：优先从 resume_id 读取已保存的结构化简历渲染 PDF。"""
    # 优先路径：从已保存的在线简历（已通过结构化校验）渲染
    resume_id = args.get("resume_id")
    if resume_id:
        row = db.scalar(
            select(StudentResume).where(
                StudentResume.id == int(resume_id),
                StudentResume.student_id == identity.user_id,
                StudentResume.tenant_id == identity.tenant_id,
            )
        )
        if not row:
            return {"status": "failed", "tool": "export_resume_pdf", "summary": f"简历 ID {resume_id} 不存在或无权限。"}
        try:
            resume_data = json.loads(row.data_json or "{}")
        except Exception:
            resume_data = {}
        student = db.get(StudentUser, identity.user_id)
        markdown = _build_resume_markdown(resume_data, student, row.title)
    else:
        markdown = str(args.get("markdown") or args.get("content") or "").strip()
    if not markdown:
        return {"status": "failed", "tool": "export_resume_pdf", "summary": "导出失败：未提供简历正文（markdown）且未指定 resume_id。"}

    # ── 事实快速校验：从 markdown 中提取 hard facts，与证据池比对 ──
    # resume_id 路径跳过校验（保存时已通过结构化校验）
    if not resume_id and evidence_pool:
        evidence_sources = evidence_pool.collect_evidence_sources()
        if evidence_sources:
            _export_args = {
                "education": _extract_sections_from_markdown(markdown, "教育"),
                "experience": _extract_sections_from_markdown(markdown, "经历"),
                "projects": _extract_sections_from_markdown(markdown, "项目"),
            }
            violations, fact_whitelist = _validate_resume_facts(
                _export_args,
                evidence_sources,
            )
            if violations:
                return _fact_guard_failure("export_resume_pdf", violations, fact_whitelist)

            # 程度词阶梯检测
            role_escalation_violations = _check_role_escalation(_export_args, evidence_sources)
            if role_escalation_violations:
                return _fact_guard_failure("export_resume_pdf", role_escalation_violations, fact_whitelist)

            # 条目归属校验（shadow mode：只记录不拦截）
            attribution_violations = _check_item_attribution(_export_args, evidence_sources)
            if attribution_violations:
                if ITEM_ATTRIBUTION_SHADOW_MODE:
                    logger.warning("item_attribution shadow_mode violations tool=%s violations=%s", "export_resume_pdf", attribution_violations[:10])
                else:
                    return _fact_guard_failure("export_resume_pdf", attribution_violations, fact_whitelist)

    filename = _safe_pdf_filename(str(args.get("filename") or "优化简历"))
    settings = get_settings()
    storage_dir = Path(settings.agent_upload_storage_dir) / str(identity.tenant_id) / str(identity.user_id)
    storage_dir.mkdir(parents=True, exist_ok=True)
    stored_path = storage_dir / f"{uuid.uuid4().hex}.pdf"
    photo_path = _resolve_student_photo(db, identity)

    # PDF 渲染是 CPU 密集操作，放到线程池避免阻塞事件循环
    try:
        await anyio.to_thread.run_sync(
            lambda: _render_resume_pdf(markdown, stored_path, title=Path(filename).stem, photo_path=photo_path)
        )
    except Exception as exc:  # noqa: BLE001
        return {"status": "failed", "tool": "export_resume_pdf", "summary": f"PDF 生成失败：{str(exc)[:160]}"}

    size = stored_path.stat().st_size if stored_path.exists() else 0
    row = StudentAgentAttachment(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        session_id=session.id,
        message_id=assistant_message.id,
        original_name=filename,
        stored_path=str(stored_path),
        content_type="application/pdf",
        file_ext="pdf",
        file_size=size,
        extracted_text=markdown[:8000],
        status="ready",
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    # 标记 export 产出的附件 ID，防止 read_resume 回读

    download_url = _attachment_download_url(stored_path, identity.user_id, identity.tenant_id)
    return {
        "status": "completed",
        "tool": "export_resume_pdf",
        "summary": f"已生成简历 PDF：{filename}",
        "filename": filename,
        "download_url": download_url,
        "model_hint": "请提示学生查看下方的文件卡片下载 PDF，不要在正文中内嵌下载链接。",
        "attachment_id": row.id,
        "attachment_id": row.id,
    }


def _extract_sections_from_markdown(markdown: str, section_keyword: str) -> list[dict[str, str]]:
    """从 Markdown 简历中提取指定板块的条目，用于事实快速校验。"""
    items: list[dict[str, str]] = []
    in_section = False
    current: dict[str, str] = {}
    # 关键词表扩展：覆盖中英文常见简历板块标题
    _EXPANDED_KEYWORDS = {
        "教育": ["教育", "学历", "Education", "教育经历"],
        "经历": ["经历", "工作", "实习", "Experience", "Work", "工作经历", "实习经历"],
        "项目": ["项目", "Project", "项目经历"],
    }
    keywords = _EXPANDED_KEYWORDS.get(section_keyword, [section_keyword])
    for line in markdown.splitlines():
        s = line.strip()
        if s.startswith("## ") and any(kw in s for kw in keywords):
            in_section = True
            continue
        if in_section and s.startswith("## "):
            break
        if in_section and s.startswith("### "):
            if current:
                items.append(current)
            current = {"name": s[4:], "description": ""}
            continue
        if in_section and current and s.startswith("- "):
            current["description"] += s[2:] + "\n"
    if current:
        items.append(current)
    return items


# 保留同步版本作为内部渲染函数（被 async 包装调用）

def _pdf_inline(text: str) -> str:
    """Escape for reportlab Paragraph and convert minimal Markdown inline marks."""
    import re

    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    safe = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", safe)
    safe = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", safe)
    return safe


# 候选 CJK 字体（按优先级）。Docker 镜像装了 fonts-noto-cjk；macOS 本地开发用系统字体。
# .ttc 需要 subfontIndex。优先嵌入真实字形，保证任意查看器都能正确渲染中文。
_CJK_FONT_CANDIDATES: tuple[tuple[str, int], ...] = (
    ("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf", 0),
    ("/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc", 0),
    ("/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc", 0),
    ("/System/Library/Fonts/PingFang.ttc", 0),
    ("/System/Library/Fonts/STHeiti Light.ttc", 0),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),
)


def _register_cjk_font() -> str:
    """Embed a real CJK font when available (renders everywhere); fall back to the
    non-embedded STSong-Light CID font, and finally to Helvetica."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_name = "ResumeCJK"
    if font_name in pdfmetrics.getRegisteredFontNames():
        return font_name
    for path, subfont_index in _CJK_FONT_CANDIDATES:
        if not Path(path).exists():
            continue
        try:
            pdfmetrics.registerFont(TTFont(font_name, path, subfontIndex=subfont_index))
            return font_name
        except Exception:
            continue
    try:
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont

        pdfmetrics.registerFont(UnicodeCIDFont("STSong-Light"))
        return "STSong-Light"
    except Exception:
        return "Helvetica"


_ACCENT = "#34507A"  # 板块标题左侧竖条 / 图标 的主题色


def _contact_icon_kind(text: str) -> str:
    """根据联系方式文本推断图标类型。"""
    import re
    t = (text or "").strip()
    low = t.lower()
    if "@" in t:
        return "mail"
    if low.startswith("http") or "www." in low or "://" in low:
        return "globe"
    if re.match(r"^\d{4}[-/.]\d{1,2}", t):
        return "calendar"
    if any(k in t for k in ("离职", "在职", "求职", "在校", "应届", "实习", "全职", "兼职")):
        return "briefcase"
    if re.fullmatch(r"[\d\-\s+()]{7,}", t):
        return "phone"
    return "pin"


def _resume_icon(kind: str, color: str):
    """用矢量图形画一个 12x12 的简约线性图标。"""
    from reportlab.graphics.shapes import Circle, Drawing, Ellipse, Line, Polygon, Rect

    d = Drawing(12, 12)
    sw = 0.9

    def rect(x, y, w, h, **kw):
        return Rect(x, y, w, h, strokeColor=color, strokeWidth=sw, fillColor=None, **kw)

    def line(x1, y1, x2, y2):
        return Line(x1, y1, x2, y2, strokeColor=color, strokeWidth=sw)

    def circ(cx, cy, r):
        return Circle(cx, cy, r, strokeColor=color, strokeWidth=sw, fillColor=None)

    if kind == "mail":
        d.add(rect(1, 2.5, 10, 7))
        d.add(line(1, 9.5, 6, 5.8)); d.add(line(11, 9.5, 6, 5.8))
    elif kind == "phone":
        d.add(rect(3.3, 1, 5.4, 10, rx=1.2, ry=1.2))
        d.add(line(5, 2.3, 7, 2.3))
    elif kind == "calendar":
        d.add(rect(1, 1.5, 10, 8.5))
        d.add(line(1, 7.6, 11, 7.6))
        d.add(line(3.6, 9.8, 3.6, 11.4)); d.add(line(8.4, 9.8, 8.4, 11.4))
    elif kind == "briefcase":
        d.add(rect(1, 2.3, 10, 6.6))
        d.add(rect(4.2, 8.6, 3.6, 1.8))
        d.add(line(1, 5.3, 11, 5.3))
    elif kind == "globe":
        d.add(circ(6, 6, 5))
        d.add(line(1, 6, 11, 6))
        d.add(Ellipse(6, 6, 2.3, 5, strokeColor=color, strokeWidth=sw, fillColor=None))
    else:  # pin
        d.add(circ(6, 8, 3.1))
        d.add(Polygon([3.4, 6.6, 8.6, 6.6, 6, 1], strokeColor=color, strokeWidth=sw, fillColor=None))
        d.add(circ(6, 8, 1.1))
    return d


def _render_resume_pdf(
    markdown_text: str, out_path: Path, title: str = "个人简历", photo_path: Optional[str] = None
) -> None:
    """把约定格式的 Markdown 简历渲染成「专业模板」PDF：左上照片 + 姓名 + 带图标的两列联系方式，
    蓝色竖条 + 灰底的板块标题，三栏对齐（标题/角色/日期）的经历条目，要点带项目符号。
    不符合约定的内容会按通用 Markdown 优雅降级，永不报错。
    """
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_RIGHT
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    font_name = _register_cjk_font()
    accent = colors.HexColor(_ACCENT)
    content_w = A4[0] - 32 * mm  # 左右各 16mm 边距

    name_st = ParagraphStyle("name", fontName=font_name, fontSize=20, leading=25)
    title_st = ParagraphStyle("title", fontName=font_name, fontSize=10.5, leading=15, textColor=colors.HexColor("#666666"))
    contact_st = ParagraphStyle("contact", fontName=font_name, fontSize=9, leading=13, textColor=colors.HexColor("#444444"))
    sec_st = ParagraphStyle("sec", fontName=font_name, fontSize=11.5, leading=15, textColor=colors.HexColor("#1F2937"))
    entry_l = ParagraphStyle("el", fontName=font_name, fontSize=10.5, leading=14)
    entry_m = ParagraphStyle("em", fontName=font_name, fontSize=10, leading=14, alignment=TA_CENTER, textColor=colors.HexColor("#444444"))
    entry_r = ParagraphStyle("er", fontName=font_name, fontSize=9.5, leading=14, alignment=TA_RIGHT, textColor=colors.HexColor("#666666"))
    body = ParagraphStyle("body", fontName=font_name, fontSize=9.8, leading=15, spaceAfter=2)
    bullet = ParagraphStyle("bullet", fontName=font_name, fontSize=9.8, leading=15, leftIndent=10, spaceAfter=1)

    no_pad = [
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]

    lines = [ln.rstrip() for ln in markdown_text.splitlines()]
    flow: list[Any] = []

    # ── 头部：照片 + 姓名/职位 + 两列带图标联系方式 ──
    idx = 0
    name = None
    for i, ln in enumerate(lines):
        if ln.strip().startswith("# ") and not ln.strip().startswith("## "):
            name = ln.strip()[2:].strip()
            idx = i + 1
            break
    if name:
        extras: list[str] = []
        while idx < len(lines) and len(extras) < 2:
            s = lines[idx].strip()
            if s.startswith("#"):
                break
            if s:
                extras.append(s)
            idx += 1
        job_title = extras[0] if extras else ""
        contacts = [c.strip() for c in extras[1].split("|") if c.strip()] if len(extras) > 1 else []

        # 左：照片 + 姓名/职位
        name_block = [Paragraph(_pdf_inline(name), name_st)]
        if job_title:
            name_block.append(Paragraph(_pdf_inline(job_title), title_st))
        photo_flow = None
        if photo_path:
            try:
                photo_flow = Image(photo_path, width=46, height=58)
            except Exception:
                photo_flow = None
        if photo_flow is not None:
            left_block: Any = Table([[photo_flow, name_block]], colWidths=[54, content_w * 0.42 - 54])
            left_block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), *no_pad]))
        else:
            left_block = name_block

        # 右：联系方式两列网格（图标 + 文本）
        cell_w = content_w * 0.58 / 2
        if contacts:
            def contact_cell(text: str) -> Any:
                icon = _resume_icon(_contact_icon_kind(text), _ACCENT)
                inner = Table([[icon, Paragraph(_pdf_inline(text), contact_st)]], colWidths=[15, cell_w - 15])
                inner.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), *no_pad,
                                           ("BOTTOMPADDING", (0, 0), (-1, -1), 4)]))
                return inner
            grid_rows: list[list[Any]] = []
            for k in range(0, len(contacts), 2):
                grid_rows.append([
                    contact_cell(contacts[k]),
                    contact_cell(contacts[k + 1]) if k + 1 < len(contacts) else "",
                ])
            right_block: Any = Table(grid_rows, colWidths=[cell_w, cell_w])
            right_block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), *no_pad]))
        else:
            right_block = Paragraph("", contact_st)

        header = Table([[left_block, right_block]], colWidths=[content_w * 0.42, content_w * 0.58])
        header.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), *no_pad]))
        flow.append(header)
        flow.append(Spacer(1, 8))
        flow.append(HRFlowable(width="100%", thickness=0.8, color=colors.HexColor("#D0D0D0"), spaceAfter=2))
        rest = lines[idx:]
    else:
        rest = lines  # 没有约定头部 → 整体走通用渲染

    def section_bar(text: str) -> Table:
        # 左侧蓝色竖条 + 灰底标题
        t = Table([["", Paragraph(f"<b>{_pdf_inline(text)}</b>", sec_st)]], colWidths=[3.5, content_w - 3.5])
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (0, 0), accent),
            ("BACKGROUND", (1, 0), (1, 0), colors.HexColor("#ECEDEF")),
            ("LEFTPADDING", (0, 0), (0, 0), 0), ("RIGHTPADDING", (0, 0), (0, 0), 0),
            ("LEFTPADDING", (1, 0), (1, 0), 9), ("RIGHTPADDING", (1, 0), (1, 0), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        return t

    def entry_row(text: str) -> Any:
        parts = [p.strip() for p in text.split("|")]
        if len(parts) == 1:
            return Paragraph(f"<b>{_pdf_inline(parts[0])}</b>", entry_l)
        if len(parts) == 2:
            cells = [[Paragraph(f"<b>{_pdf_inline(parts[0])}</b>", entry_l), Paragraph(_pdf_inline(parts[1]), entry_r)]]
            widths = [content_w * 0.7, content_w * 0.3]
        else:
            cells = [[
                Paragraph(f"<b>{_pdf_inline(parts[0])}</b>", entry_l),
                Paragraph(_pdf_inline(parts[1]), entry_m),
                Paragraph(_pdf_inline(parts[2]), entry_r),
            ]]
            widths = [content_w * 0.52, content_w * 0.26, content_w * 0.22]
        t = Table(cells, colWidths=widths)
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), *no_pad,
            ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ]))
        return t

    for raw in rest:
        s = raw.strip()
        if not s:
            flow.append(Spacer(1, 3))
        elif s in ("---", "***", "___"):
            flow.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#DDDDDD"), spaceBefore=2, spaceAfter=4))
        elif s.startswith("## "):
            flow.append(Spacer(1, 6))
            flow.append(section_bar(s[3:]))
            flow.append(Spacer(1, 3))
        elif s.startswith("### "):
            flow.append(entry_row(s[4:]))
        elif s.startswith("# "):
            flow.append(Paragraph(f"<b>{_pdf_inline(s[2:])}</b>", name_st))
        elif s[:2] in ("- ", "* ") or s.startswith("• "):
            flow.append(Paragraph("• " + _pdf_inline(s[2:].strip()), bullet))
        else:
            flow.append(Paragraph(_pdf_inline(s), body))

    if not flow:
        flow.append(Paragraph(_pdf_inline(title), name_st))

    doc = SimpleDocTemplate(
        str(out_path), pagesize=A4,
        leftMargin=16 * mm, rightMargin=16 * mm, topMargin=16 * mm, bottomMargin=14 * mm, title=title,
    )
    doc.build(flow)
