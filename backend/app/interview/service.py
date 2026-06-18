from __future__ import annotations

import json
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig
from app.auth.service import AuthIdentity
from app.core.llm_client import chat_completion, voice_chat_completion
from app.interview.exceptions import (
    InterviewError,
    InterviewLLMError,
    InterviewNoPendingQuestionError,
    InterviewNotActiveError,
    InterviewNotFoundError,
    InterviewReportExistsError,
    InterviewReportGenerationError,
)
from app.interview.progress import set_progress
from app.interview.run_events import emit_interview_event, mark_interview_run_done
from app.interview import voice_service
from app.interview import resume_anchors as resume_anchor_service
from app.interview.harness import (
    SCORE_KEYS,
    _filter_evidence_quotes,
    _looks_like_single_question,
    _qa_score_question,
    _strict_bool,
    build_fallback_report,
    harness_should_finish_interview,
    run_harnessed_json_generation,
    validate_followup_output,
    validate_report_output,
    validate_start_output,
)
from app.interview.knowledge import get_knowledge_index, reload_knowledge_index
from app.interview.models import InterviewReport, InterviewSession, InterviewTurn
from app.interview.prompts import (
    EXTRACTED_JOB_PROMPT,
    FOLLOWUP_USER_PROMPT,
    INTERVIEW_FOLLOWUP_SUBPROMPT,
    INTERVIEW_REPORT_SCORING_RUBRIC,
    INTERVIEW_REPORT_SUBPROMPT,
    INTERVIEW_START_SUBPROMPT,
    INTERVIEW_STREAMING_SYSTEM_PROMPT,
    INTERVIEW_STYLE_CONFIG,
    INTERVIEW_SYSTEM_PROMPT,
    INTERVIEW_TYPE_CONFIG,
    QUALITY_FEEDBACK_PROMPT,
    REPORT_USER_PROMPT,
    SCORING_RUBRIC,
    START_USER_PROMPT,
)
from app.interview.schemas import InterviewStartRequest
from app.student.resume_models import StudentResume


SCORE_WEIGHTS = {
    "technical_accuracy": 0.25,
    "project_evidence": 0.20,
    "problem_solving": 0.20,
    "communication": 0.15,
    "job_fit": 0.15,
    "pressure_handling": 0.05,
}


def _json_loads(raw: str | None, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


def _json_dumps(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False)


def _extract_json(text: str) -> dict[str, Any] | None:
    text = text.strip()
    # 1. 直接解析
    try:
        return json.loads(text)
    except Exception:
        pass
    # 2. 剥离 markdown 代码块 ```json ... ``` 或 ``` ... ```
    fence = re.search(r"```(?:json)?\s*\n?([\s\S]*?)```", text)
    if fence:
        inner = fence.group(1).strip()
        try:
            return json.loads(inner)
        except Exception:
            pass
    # 3. 正则提取最外层 JSON 对象（贪婪）
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            pass
    # 4. 尝试修复截断的 JSON：逐层补全缺失的 } ]
    for stripped in [text, fence.group(1).strip() if fence else ""]:
        if not stripped or not stripped.startswith("{"):
            continue
        depth = 0
        for ch in stripped:
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
        if depth > 0:
            candidate = stripped + "}" * depth
            try:
                return json.loads(candidate)
            except Exception:
                pass
    return None


def _render_template(template: str, values: dict[str, Any]) -> str:
    """单次遍历替换模板变量，避免已注入值中的 {key} 被后续迭代误替换。"""
    def _replacer(match: re.Match) -> str:
        key = match.group(1)
        return str(values[key]) if key in values else match.group(0)
    return re.sub(r"\{(\w+)\}", _replacer, template)


def _serialize_session(session: InterviewSession) -> dict:
    return {
        "id": session.id,
        "target_role": session.target_role,
        "interview_type": session.interview_type,
        "interview_style": session.interview_style,
        "difficulty": session.difficulty,
        "round_limit": session.round_limit,
        "model_config_id": session.model_config_id,
        "status": session.status,
        "company_name": session.company_name,
        "seniority_level": session.seniority_level,
        "job_skills": _json_loads(session.job_skills_json, []),
        "current_stage": session.current_stage or "opening",
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
    }


def serialize_turn(turn: InterviewTurn) -> dict:
    return {
        "id": turn.id,
        "turn_index": turn.turn_index,
        "role": "candidate" if turn.answer else "interviewer",
        "question": turn.question,
        "answer": turn.answer,
        "answer_assessment": _json_loads(turn.answer_assessment, None),
        "score": _json_loads(turn.score_json, None),
        "followup_reason": turn.followup_reason,
        "retrieved_chunks": _json_loads(turn.retrieved_chunks_json, []),
        "knowledge_points": _json_loads(turn.knowledge_points_json, []),
        # 阶段 + 检索解释性 + 评分可解释性
        "stage": turn.stage,
        "question_type": turn.question_type,
        "question_reason": turn.question_reason,
        "capability_tags": _json_loads(turn.capability_tags_json, []),
        "score_reasons": _json_loads(turn.score_reasons_json, {}),
        "evidence_quotes": _json_loads(turn.evidence_quotes_json, []),
        "top_sources": _json_loads(turn.top_sources_json, []),
    }


def serialize_report(report: InterviewReport) -> dict:
    return {
        "id": report.id,
        "session_id": report.session_id,
        "overall_score": report.overall_score,
        "dimension_scores": _json_loads(report.dimension_scores_json, {}),
        "strengths": _json_loads(report.strengths_json, []),
        "weaknesses": _json_loads(report.weaknesses_json, []),
        "suggestions": _json_loads(report.suggestions_json, []),
        "next_questions": _json_loads(report.next_questions_json, []),
        "comparison": _json_loads(report.comparison_json, None),
        "report_text": report.report_text,
        # 训练闭环
        "training_plan": _json_loads(report.training_plan_json, []),
        "rewrite_examples": _json_loads(report.rewrite_examples_json, []),
        "next_session_preset": _json_loads(report.next_session_preset_json, {}),
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


def knowledge_status() -> dict:
    info = get_knowledge_index().status()
    # 不向学生端暴露服务器绝对路径
    info.pop("root", None)
    return info


def reload_knowledge_status() -> dict:
    info = reload_knowledge_index()
    # 不向学生端暴露服务器绝对路径
    info.pop("root", None)
    return info


def _latest_resume_snapshot(db: Session, identity: AuthIdentity) -> str:
    # 优先读取「智能体可读取」（visibility=True）的简历
    resume = db.scalar(
        select(StudentResume)
        .where(
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
            StudentResume.visibility.is_(True),
        )
        .limit(1)
    )
    # 若没有开启可读取，则回退到最新保存的简历
    if not resume:
        resume = db.scalar(
            select(StudentResume)
            .where(StudentResume.student_id == identity.user_id, StudentResume.tenant_id == identity.tenant_id)
            .order_by(StudentResume.updated_at.desc())
            .limit(1)
        )
    if not resume:
        return "学生暂未在「简历制作」中保存在线简历。面试时需要优先询问项目、技能和求职方向，并降低对简历证据的确信度。"
    return resume.data_json[:8000]


def _resume_snapshot_by_id(db: Session, identity: AuthIdentity, resume_id: int) -> str:
    """根据指定的简历 ID 读取简历内容。"""
    row = db.scalar(
        select(StudentResume).where(
            StudentResume.id == resume_id,
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
    )
    if not row:
        raise InterviewError(status_code=404, detail="简历不存在")
    return row.data_json[:12000]


def _resume_source_label(source: str) -> str:
    if source == "upload":
        return "本次上传简历"
    return "智能体可读取的在线简历"


async def extract_uploaded_resume(upload: UploadFile) -> dict[str, Any]:
    original_name = upload.filename or "resume"
    ext = Path(original_name).suffix.lower()
    if ext not in {".pdf", ".docx", ".txt", ".md"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持 PDF、DOCX、TXT、Markdown 简历")
    content = await upload.read()
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="简历文件不能超过 8MB")
    text = ""
    with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        if ext == ".pdf":
            from pypdf import PdfReader

            reader = PdfReader(str(tmp_path))
            chunks = []
            for index, page in enumerate(reader.pages[:12], start=1):
                page_text = (page.extract_text() or "").strip()
                if page_text:
                    chunks.append(f"[PDF 第 {index} 页]\n{page_text}")
            text = "\n\n".join(chunks)
        elif ext == ".docx":
            from docx import Document

            doc = Document(str(tmp_path))
            chunks = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            for table in doc.tables[:6]:
                for row in table.rows[:24]:
                    values = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                    if any(values):
                        chunks.append(" | ".join(values))
            text = "\n".join(chunks)
        else:
            text = tmp_path.read_text(encoding="utf-8", errors="ignore")
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
    text = text.strip()[:12000]
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="未能从简历中提取到可读文本")
    return {
        "filename": original_name,
        "chars": len(text),
        "estimated_tokens": max(1, round(len(text) / 1.5)),
        "extracted_text": text,
    }


def _extract_resume_anchors(resume_snapshot: str) -> list[dict[str, Any]]:
    """从简历中提取结构化锚点。

    优先解析 JSON 格式简历（projects/work_experience/skills/honors/education），
    回退到纯文本行扫描。

    返回列表，每项为 {"type": str, "name": str, "evidence": str, "keywords": list[str]}。
    """
    return resume_anchor_service.extract_resume_anchors(resume_snapshot)

    text = (resume_snapshot or "").strip()
    if not text or "暂未" in text:
        return []

    anchors: list[dict[str, Any]] = []

    # 尝试 JSON 解析
    try:
        import json as _json
        data = _json.loads(text)
        if isinstance(data, dict):
            # projects
            for proj in (data.get("projects") or data.get("project") or [])[:5]:
                if not isinstance(proj, dict):
                    continue
                name = str(proj.get("name") or proj.get("title") or "").strip()
                desc = str(proj.get("description") or proj.get("detail") or proj.get("responsibility") or "").strip()
                tech = proj.get("tech_stack") or proj.get("technologies") or []
                keywords = [name] + (tech if isinstance(tech, list) else [str(tech)]) + _extract_keywords_from_text(desc)
                if name or desc:
                    anchors.append({"type": "project", "name": name or desc[:40], "evidence": desc[:120], "keywords": [k for k in keywords if k][:8]})
            # work_experience
            for work in (data.get("work_experience") or data.get("experience") or data.get("internships") or [])[:3]:
                if not isinstance(work, dict):
                    continue
                company = str(work.get("company") or work.get("organization") or "").strip()
                title = str(work.get("title") or work.get("position") or work.get("role") or "").strip()
                desc = str(work.get("description") or work.get("detail") or "").strip()
                name = f"{company} {title}".strip() or desc[:40]
                keywords = [company, title] + _extract_keywords_from_text(desc)
                if name:
                    anchors.append({"type": "work", "name": name, "evidence": desc[:120], "keywords": [k for k in keywords if k][:8]})
            # skills
            skills = data.get("skills") or data.get("technical_skills") or []
            if isinstance(skills, list) and skills:
                skill_strs = [str(s) for s in skills[:10] if s]
                anchors.append({"type": "skill", "name": "技能栈", "evidence": "、".join(skill_strs)[:120], "keywords": skill_strs})
            # honors
            for honor in (data.get("honors") or data.get("awards") or [])[:3]:
                if not isinstance(honor, dict):
                    h_name = str(honor).strip()
                else:
                    h_name = str(honor.get("name") or honor.get("title") or "").strip()
                if h_name:
                    anchors.append({"type": "honor", "name": h_name, "evidence": h_name, "keywords": _extract_keywords_from_text(h_name)[:5]})
            if anchors:
                return anchors[:8]
    except (ValueError, TypeError, AttributeError):
        pass

    # 纯文本回退：按行扫描
    for line in text.splitlines():
        item = line.strip(" -•\t")
        if not item:
            continue
        if _is_contact_or_intent_line(item):
            continue
        if any(key in item for key in ("项目", "经历", "实习", "公司", "技术", "负责", "开发", "系统", "平台")):
            keywords = _extract_keywords_from_text(item)
            anchors.append({"type": "text", "name": item[:40], "evidence": item[:120], "keywords": keywords[:5]})
        if len(anchors) >= 5:
            break
    return anchors


def _is_contact_or_intent_line(text: str) -> bool:
    """联系方式、邮箱、求职意向等简历头部信息不能作为首问项目锚点。"""
    return resume_anchor_service.is_contact_or_intent_line(text)

    lowered = text.lower()
    has_real_project_marker = any(marker in text for marker in ("项目：", "项目:", "项目经历", "项目经验"))
    if has_real_project_marker:
        return False
    has_contact_label = any(label in text for label in ("电话", "手机", "微信", "邮箱", "联系方式", "求职意向"))
    has_phone = bool(re.search(r"(?<!\d)1[3-9]\d{9}(?!\d)", text))
    has_email = bool(re.search(r"[\w.+-]+@[\w.-]+\.\w+", lowered))
    return has_contact_label or has_phone or has_email


def _select_opening_anchor(resume_anchors: list[dict[str, Any]]) -> dict[str, Any] | None:
    return resume_anchor_service.select_opening_anchor(resume_anchors)

    for anchor in resume_anchors:
        name = str(anchor.get("name") or "")
        evidence = str(anchor.get("evidence") or "")
        combined = f"{name} {evidence}"
        if _is_contact_or_intent_line(combined):
            continue
        if anchor.get("type") == "project" or any(marker in combined for marker in ("项目", "平台", "系统", "开发", "RAG", "Agent", "Redis")):
            return anchor
    return None


def _extract_keywords_from_text(text: str) -> list[str]:
    """从文本中提取关键词片段。"""
    return resume_anchor_service.extract_keywords_from_text(text)

    import re as _re
    parts = _re.split(r"[，,、。；;：:（）()\s/]+", text)
    return [p.strip() for p in parts if len(p.strip()) >= 2][:8]


def _candidate_chat_models(
    db: Session,
    identity: AuthIdentity,
    preferred_model_id: int | None = None,
) -> list[ModelConfig]:
    models = list(db.scalars(
        select(ModelConfig)
        .where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.status == "active",
            ModelConfig.open_to_student.is_(True),
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability.in_(("chat", "text", "multimodal")),
        )
        .order_by(ModelConfig.open_to_student.desc(), ModelConfig.capability.asc(), ModelConfig.id.asc())
    ).all())
    if preferred_model_id:
        models.sort(key=lambda item: 0 if item.id == preferred_model_id else 1)
    return models


def _candidate_voice_models(
    db: Session,
    identity: AuthIdentity,
    preferred_model_id: int | None = None,
) -> list[ModelConfig]:
    """选择支持语音多模态（voice_multimodal）的模型，回退到 multimodal/chat。

    排序保证 voice_multimodal 优先于 multimodal 优先于 chat。
    """
    # 分别查询，确保优先级
    voice_models = list(db.scalars(
        select(ModelConfig).where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.status == "active",
            ModelConfig.open_to_student.is_(True),
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability == "voice_multimodal",
        ).order_by(ModelConfig.id.asc())
    ).all())

    multi_models = list(db.scalars(
        select(ModelConfig).where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.status == "active",
            ModelConfig.open_to_student.is_(True),
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability == "multimodal",
        ).order_by(ModelConfig.id.asc())
    ).all())

    chat_models = list(db.scalars(
        select(ModelConfig).where(
            ModelConfig.tenant_id == identity.tenant_id,
            ModelConfig.is_deleted.is_(False),
            ModelConfig.status == "active",
            ModelConfig.open_to_student.is_(True),
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability == "chat",
        ).order_by(ModelConfig.id.asc())
    ).all())

    # voice_multimodal 最优先，multimodal 次之，chat 最后
    models = voice_models + multi_models + chat_models

    if preferred_model_id:
        models.sort(key=lambda item: 0 if item.id == preferred_model_id else 1)
    return models


def _llm_json(
    db: Session,
    user_prompt: str,
    fallback: dict[str, Any],
    *,
    identity: AuthIdentity | None = None,
    temperature: float = 0.35,
    preferred_model_id: int | None = None,
    max_tokens: int = 2500,
) -> tuple[dict[str, Any], dict[str, Any]]:
    models = _candidate_chat_models(db, identity, preferred_model_id)
    if not models:
        return fallback, {"used": False, "model": None, "error": "No student-open chat model with API key"}
    errors: list[str] = []
    for model in models:
        try:
            result = chat_completion(
                model,
                system_prompt=INTERVIEW_SYSTEM_PROMPT,
                variables={},
                memory=[],
                user_message=user_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
            parsed = _extract_json(result["reply"])
            if not parsed:
                errors.append(f"{model.display_name}: invalid JSON")
                continue
            return parsed, {"used": True, "model": model.display_name, "usage": result.get("usage")}
        except Exception as exc:
            errors.append(f"{model.display_name}: {str(exc)[:180]}")
    return fallback, {"used": False, "model": models[0].display_name, "error": " | ".join(errors)[:500]}


def delete_report(db: Session, identity: AuthIdentity, session_id: int) -> None:
    """删除已有报告，允许重新生成。"""
    session = _get_session(db, identity, session_id)
    db.query(InterviewReport).filter(InterviewReport.session_id == session.id).delete()
    db.commit()


def _conversation_history(turns: list[InterviewTurn], max_turns: int = 16) -> str:
    lines: list[str] = []
    for turn in turns[-max_turns:]:
        lines.append(f"Q{turn.turn_index}: {turn.question}")
        if turn.answer:
            lines.append(f"A{turn.turn_index}: {turn.answer}")
    return "\n".join(lines)


def _score_to_100(scores: dict[str, Any]) -> dict[str, float]:
    normalized = {}
    for key in SCORE_KEYS:
        try:
            val = float(scores.get(key, 3))
        except Exception:
            val = 3
        normalized[key] = round(max(1, min(5, val)) * 20, 1)
    return normalized


def _weighted_overall(dim_scores: dict[str, Any]) -> float:
    total = 0.0
    for key, weight in SCORE_WEIGHTS.items():
        try:
            value = float(dim_scores.get(key, 0))
        except Exception:
            value = 0
        total += max(0, min(100, value)) * weight
    return round(total, 1)


def _normalize_report_dimensions(raw: Any, fallback: dict[str, float]) -> dict[str, float]:
    if not isinstance(raw, dict):
        return fallback
    normalized: dict[str, float] = {}
    for key in SCORE_KEYS:
        try:
            value = float(raw.get(key))
        except Exception:
            value = fallback.get(key, 60.0)
        normalized[key] = round(max(0, min(100, value)), 1)
    return normalized


def _fallback_followup(answer: str, retrieved: list[dict]) -> dict[str, Any]:
    topic = retrieved[0]["topic"] if retrieved else "项目经历"
    vague = len(answer.strip()) < 80
    question = (
        f"你刚才的回答还偏概括。围绕 {topic}，请补充一个你亲自处理过的实现细节："
        "具体问题是什么、你做了什么、结果如何量化？"
        if vague
        else f"你提到了这些内容，但我还需要验证深度。请结合 {topic} 说明一个异常场景或取舍：你当时为什么这么设计？"
    )
    return {
        "answer_assessment": {
            "summary": "回答信息量偏少，需要继续追问可验证细节。" if vague else "回答有一定内容，但仍需验证技术深度和个人贡献。",
            "is_vague": vague,
            "risk_points": ["缺少量化指标"] if vague else ["技术取舍说明不足"],
            "positive_points": ["愿意给出项目或技术线索"],
        },
        "score": {
            "technical_accuracy": 3,
            "project_evidence": 2 if vague else 3,
            "problem_solving": 3,
            "communication": 3,
            "job_fit": 3,
            "pressure_handling": 3,
        },
        "score_reasons": {
            "technical_accuracy": "回答偏概括，缺少技术细节支撑",
            "project_evidence": "缺少量化指标和具体项目细节" if vague else "有项目线索但取舍说明不足",
            "problem_solving": "需要补充问题拆解和方案比较",
            "communication": "表达有方向但结构可以更清晰",
            "job_fit": "需要更多岗位核心技术匹配的证据",
            "pressure_handling": "抗压表现待验证",
        },
        "followup_strategy": "追问项目证据和技术细节",
        "interviewer_tone": "strict",
        "next_question": question,
        "question_reason": "回答信息量偏少，需要追问可验证的项目细节和技术深度" if vague else "回答有一定内容，但仍需验证技术深度和个人贡献",
        "question_type": "project_deep_dive",
        "capability_tags": ["项目证据", "技术深度"],
        "knowledge_points": [topic],
        "should_end": False,
        "stage": "resume_deep_dive",
    }


# ── 岗位画像 ──────────────────────────────────────────────────────────────────

_JOB_SKILL_KEYWORDS = [
    "Java", "Spring", "Spring Boot", "MySQL", "Redis", "Kafka",
    "Elasticsearch", "JVM", "Docker", "Kubernetes", "Linux",
    "React", "Vue", "TypeScript", "Python", "Django", "FastAPI", "Flask",
    "LLM", "RAG", "Agent", "MCP", "Function Calling", "LangChain", "LangGraph",
    "数据结构", "算法", "系统设计", "分布式", "微服务", "缓存", "消息队列", "数据库事务",
]


def _extract_job_skills(jd_text: str, user_skills: list[str]) -> list[str]:
    """从 JD 中提取技能标签，优先使用用户手动填写的内容。"""
    if user_skills:
        return list(dict.fromkeys(s.strip() for s in user_skills if s.strip()))
    if not jd_text:
        return []
    found: list[str] = []
    jd_lower = jd_text.lower()
    for kw in _JOB_SKILL_KEYWORDS:
        if kw.lower() in jd_lower:
            found.append(kw)
    return found


# ── 面试阶段状态机（P1-2: 已抽取到 state_machine.py）───────────────────────────

from app.interview.state_machine import (
    STAGE_DEFINITIONS,
    _STAGE_ORDER,
    advance_stage,
    build_stage_plan,
    compute_answer_quality,
    is_valid_wrap_up_question,
    should_skip_stage,
    stage_for_turn,
    update_coverage,
    update_quality_metrics,
)


def _get_effective_focus_points(retrieved: list[dict]) -> list[str]:
    """从检索结果中提取有效的 focus_points。"""
    points = []
    for item in retrieved[:3]:
        topic = item.get("topic", "")
        if topic and topic not in points:
            points.append(topic)
    return points or ["项目经历", "技术深度", "岗位匹配"]


def _extract_job_profile_info(session: InterviewSession) -> dict:
    """从 session 中提取岗位画像信息。"""
    job_skills = _json_loads(session.job_skills_json, [])
    return {
        "title": session.target_role or "未知岗位",
        "company": session.company_name or "未提供",
        "level": session.seniority_level or "未提供",
        "skills": "、".join(job_skills) if job_skills else "未指定",
        "responsibility": session.job_description[:500] if session.job_description else "未提供",
        "requirements": session.job_description[:500] if session.job_description else "未提供",
    }


# ── wrap_up 本地 fallback ────────────────────────────────────────────────────

def _wrap_up_fallback(target_role: str) -> dict[str, Any]:
    """wrap_up 阶段 LLM 不可用时的本地 fallback。"""
    return {
        "answer_assessment": {
            "summary": "候选人的整体回答表现需要综合评估。",
            "is_vague": False,
            "risk_points": ["需要在报告中综合评估"],
            "positive_points": ["完成了完整的面试流程"],
        },
        "score": {
            "technical_accuracy": 3,
            "project_evidence": 3,
            "problem_solving": 3,
            "communication": 3,
            "job_fit": 3,
            "pressure_handling": 3,
        },
        "score_reasons": {
            "technical_accuracy": "最后一轮综合评估",
            "project_evidence": "最后一轮综合评估",
            "problem_solving": "最后一轮综合评估",
            "communication": "最后一轮综合评估",
            "job_fit": "最后一轮综合评估",
            "pressure_handling": "最后一轮综合评估",
        },
        "evidence_quotes": [],
        "followup_strategy": "收束面试",
        "interviewer_tone": "friendly",
        "next_question": f"感谢你参加这次{target_role}的面试。请用 2 分钟总结一下：你认为自己表现最好的是哪个环节？哪个环节还可以做得更好？",
        "question_reason": "作为收束问题，让候选人自我复盘",
        "question_type": "wrap_up",
        "capability_tags": ["自我认知", "复盘能力"],
        "knowledge_points": [],
        "should_end": True,
        "stage": "wrap_up",
    }


# ── 评分可解释性 ──────────────────────────────────────────────────────────────

def _normalize_score_reasons(raw: Any) -> dict[str, str]:
    """补齐缺失维度的评分原因。"""
    if not isinstance(raw, dict):
        raw = {}
    return {key: str(raw.get(key, "本轮未提供足够证据。")) for key in SCORE_KEYS}


# ── 训练闭环 ──────────────────────────────────────────────────────────────────

def _build_fallback_training_plan(weakest_dim: str) -> list[dict]:
    """当 LLM 未返回训练计划时生成 fallback（至少 3 天）。"""
    dim_label = {
        "technical_accuracy": "技术准确性",
        "project_evidence": "项目证据",
        "problem_solving": "问题拆解",
        "communication": "表达能力",
        "job_fit": "岗位匹配",
        "pressure_handling": "抗压能力",
    }.get(weakest_dim, "核心能力")
    return [
        {
            "day": 1,
            "focus": dim_label,
            "tasks": ["复盘本轮最低分问题", "准备一个具体项目案例", "补充量化指标"],
            "expected_output": "一段 2 分钟结构化回答",
        },
        {
            "day": 2,
            "focus": "综合练习",
            "tasks": ["用 STAR 结构重写 3 个常见回答", "准备 2 个技术细节追问的应对"],
            "expected_output": "3 个可直接使用的面试回答模板",
        },
        {
            "day": 3,
            "focus": "模拟实战",
            "tasks": ["找朋友做一次 15 分钟模拟面试", "录音回听，标记空泛表达", "补充 2 个量化案例"],
            "expected_output": "一次完整模拟面试录音和复盘笔记",
        },
    ]


def start_interview(
    db: Session,
    identity: AuthIdentity,
    payload: InterviewStartRequest,
    *,
    event_run_id: str | None = None,
) -> dict:
    request_id = payload.request_id
    # ── 目标岗位强制必填 ──
    target_role = (payload.target_role or "").strip()
    if not target_role:
        raise InterviewError(status_code=400, detail="请填写目标岗位")

    # ── 岗位 JD 强制必填 ──
    job_description = (payload.job_description or "").strip()
    if not job_description:
        raise InterviewError(status_code=400, detail="请填写岗位 JD")

    set_progress(request_id, stage="resume", status="active", message="正在读取用户选择的在线简历")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "resume", "title": "正在读取简历"})
    resume_source_label = _resume_source_label(payload.resume_source)
    company_name = (payload.company_name or "").strip() or None
    seniority_level = (payload.seniority_level or "").strip() or None
    if payload.resume_source == "upload":
        resume_snapshot = (payload.uploaded_resume_text or "").strip()[:12000]
        if not resume_snapshot:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="请选择并上传一份可读取的简历")
    elif payload.resume_id:
        resume_snapshot = _resume_snapshot_by_id(db, identity, payload.resume_id)
    else:
        resume_snapshot = _latest_resume_snapshot(db, identity)
    resume_anchors = _extract_resume_anchors(resume_snapshot)
    opening_anchor = _select_opening_anchor(resume_anchors)
    prioritized_anchors = ([opening_anchor] if opening_anchor else []) + [a for a in resume_anchors if a is not opening_anchor]
    anchor_names = [a.get("name", "") for a in prioritized_anchors[:5] if a.get("name")]
    anchor_keywords = []
    for a in resume_anchors[:5]:
        anchor_keywords.extend(a.get("keywords", [])[:3])
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "resume",
        "title": "已读取在线简历",
        "summary": f"识别到候选人简历，核心项目/经历：{'、'.join(anchor_names[:3]) or '未识别到具体项目'}",
        "details": [
            f"简历来源：{resume_source_label}",
            f"项目/经历：{'、'.join(anchor_names) or '无'}",
            f"关键词：{'、'.join(list(dict.fromkeys(anchor_keywords))[:8]) or '无'}",
            f"可用于首问的锚点：{len(resume_anchors)} 个",
        ],
        "evidence": [a.get("evidence", "")[:80] for a in resume_anchors[:3] if a.get("evidence")],
    })
    set_progress(request_id, stage="jd", status="active", message="正在分析岗位 JD")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "jd", "title": "正在分析岗位 JD"})
    index = get_knowledge_index()
    retrieved = index.search(
        f"{target_role} {job_description} 面试 项目 技术基础",
        target_role=target_role,
        limit=6,
    )
    type_cfg = INTERVIEW_TYPE_CONFIG.get(payload.interview_type, INTERVIEW_TYPE_CONFIG["technical"])
    style_cfg = INTERVIEW_STYLE_CONFIG.get(payload.interview_style, INTERVIEW_STYLE_CONFIG["strict"])
    job_skills = _extract_job_skills(job_description, list(payload.job_skills))
    jd_keywords = job_skills[:8]
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "jd",
        "title": "已分析岗位 JD",
        "summary": f"岗位「{target_role}」核心要求：{'、'.join(jd_keywords[:3]) or '未提取到关键词'}",
        "details": [
            f"岗位：{target_role}",
            f"技术关键词：{'、'.join(jd_keywords) or '无'}",
            f"公司：{company_name or '未提供'}",
            f"级别：{seniority_level or '未提供'}",
        ],
        "evidence": [job_description[:120]],
    })
    set_progress(request_id, stage="match", status="active", message="正在匹配简历经历与岗位要求")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "match", "title": "正在匹配简历与岗位"})

    # ── 岗位画像 ──
    job_profile_parts = [f"岗位：{target_role}"]
    if company_name:
        job_profile_parts.append(f"公司：{company_name}")
    if seniority_level:
        job_profile_parts.append(f"级别：{seniority_level}")
    if job_skills:
        job_profile_parts.append(f"核心技能：{'、'.join(job_skills)}")
    job_profile_summary = "，".join(job_profile_parts)

    # ── 阶段计划 ──
    stage_plan = build_stage_plan(payload.interview_type, payload.round_limit, list(payload.focus_tags))
    current_stage = "opening"

    # 选择开场锚点：优先用具体项目名，回退到 JD 核心技能
    if anchor_names:
        best_anchor = anchor_names[0]
    elif jd_keywords:
        best_anchor = jd_keywords[0]
    else:
        best_anchor = f"与「{target_role}」最相关"

    rag_topics = list({item["topic"] for item in retrieved[:4] if item.get("topic")})
    fallback_start = {
        "resume_brief": f"已读取{resume_source_label}，将围绕岗位匹配度、项目证据和关键能力进行验证。",
        "focus_points": ["项目真实性与个人职责", "目标岗位核心技术匹配", "量化结果和复盘能力"],
        "first_question": (
            f"{type_cfg['opening']} 当前风格是「{style_cfg['label']}」。"
            f"我已经先读取了{resume_source_label}。"
            + (
                f"我看到你简历中提到了「{best_anchor}」，请先说明你在其中承担的个人职责——包括具体的技术方案、你负责的模块和最终达成的量化结果。"
                if anchor_names
                else f"请先介绍一个你与「{target_role}」最相关的项目经历，说明你在其中承担的个人职责和技术方案。"
            )
        ),
        "knowledge_points": rag_topics or [item["topic"] for item in retrieved[:3]] or ["项目证据", "岗位匹配"],
        "question_reason": f"作为开场问题，要求候选人围绕目标岗位「{target_role}」展示最有说服力的项目经历",
        "question_type": "resume_deep_dive",
        "capability_tags": ["项目证据", "岗位匹配"],
    }

    # 构建匹配分析
    match_details = []
    if anchor_names and jd_keywords:
        match_details.append(f"简历项目：{'、'.join(anchor_names[:3])}")
        match_details.append(f"岗位要求：{'、'.join(jd_keywords[:5])}")
        match_details.append(f"最佳首问项目：{anchor_names[0] if anchor_names else '待确定'}")
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "match",
        "title": "已匹配简历与岗位",
        "summary": f"最适合作为第一问的项目：{anchor_names[0] if anchor_names else '待确定'}",
        "details": match_details or ["简历信息不足，无法精确匹配"],
        "evidence": [],
    })

    # Prompt 注入岗位画像信息
    profile_injection = f"\n【岗位画像】{job_profile_summary}" if job_skills or company_name or seniority_level else ""
    set_progress(request_id, stage="rag", status="active", message="正在检索题库/RAG")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "rag", "title": "正在检索题库/RAG"})
    effective_focus = _get_effective_focus_points(retrieved)

    # 简历锚点注入 prompt（已在 resume 阶段提取）
    anchor_injection = ""
    if resume_anchors:
        anchor_lines = []
        for a in resume_anchors:
            anchor_lines.append(f"- [{a['type']}] {a['name']}：{a['evidence']}")
        anchor_injection = (
            "\n\n【必须引用的简历事实锚点】\n"
            + "\n".join(anchor_lines)
            + '\n\n第一问必须至少引用其中一个具体项目、经历、技能或职责。不得只说"我已经读取了你的简历"。'
        )

    start_prompt = _render_template(
        START_USER_PROMPT,
        {
            "target_role": target_role,
            "job_description": job_description + profile_injection,
            "interview_type": type_cfg["label"],
            "interview_type_rule": type_cfg["focus"],
            "interview_style": style_cfg["label"],
            "interview_style_rule": style_cfg["rule"],
            "focus_tags": "、".join(payload.focus_tags[:8]) or "、".join(effective_focus),
            "custom_instruction": payload.custom_instruction or "无",
            "round_limit": payload.round_limit,
            "resume_summary": resume_snapshot,
            "retrieved_context": json.dumps(retrieved, ensure_ascii=False),
        },
    )
    start_prompt += anchor_injection
    # RAG 阶段完成
    rag_sources = [{"title": item.get("title", ""), "topic": item.get("topic", "")} for item in retrieved[:3]]
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "rag",
        "title": "已检索题库",
        "summary": f"命中 {len(retrieved)} 条知识，top 主题：{'、'.join(s['topic'] for s in rag_sources if s['topic']) or '无'}",
        "details": [
            f"检索命中：{len(retrieved)} 条",
            f"top sources：{'、'.join(s['title'] for s in rag_sources if s['title']) or '无'}",
        ],
        "evidence": [],
    })
    set_progress(request_id, stage="llm", status="active", message="正在生成第一问")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "llm", "title": "正在生成第一问"})

    # P0: 流式生成第一问
    def _on_delta(delta: str):
        emit_interview_event(event_run_id, "interview.stage.delta", {"stage": "llm", "delta": delta})
        emit_interview_event(event_run_id, "interviewer.delta", {"target": "start_question", "delta": delta})

    def _on_display_text(text: str):
        if text:
            emit_interview_event(event_run_id, "interviewer.snapshot", {"target": "start_question", "text": text})

    def _on_completed(text: str):
        emit_interview_event(event_run_id, "interviewer.completed", {"target": "start_question", "text": text})

    from app.interview.harness import run_harnessed_streaming_generation
    start_parsed, start_llm_meta = run_harnessed_streaming_generation(
        db,
        task_name="start_interview",
        system_prompt=INTERVIEW_STREAMING_SYSTEM_PROMPT + "\n\n" + INTERVIEW_START_SUBPROMPT,
        user_prompt=start_prompt,
        fallback=fallback_start,
        validator=validate_start_output,
        context={"resume_anchors": resume_anchors},
        identity=identity,
        preferred_model_id=payload.model_id,
        temperature=0.35,
        max_tokens=1500,
        max_retries=2,
        on_delta=_on_delta,
        on_display_text=_on_display_text,
        on_completed=_on_completed,
    )
    # LLM 阶段完成报告
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "llm",
        "title": "已生成第一问草稿",
        "summary": "模型已完成第一问草稿生成，进入 Harness 校验。",
        "details": [
            f"模型：{start_llm_meta.get('model') or '未使用模型'}",
            f"fallback：{'是' if start_llm_meta.get('fallback_used') else '否'}",
            f"尝试次数：{start_llm_meta.get('attempts', 0)}",
        ],
        "evidence": [],
    })
    set_progress(request_id, stage="harness", status="active", message="正在校验第一问是否围绕简历和 JD")
    emit_interview_event(event_run_id, "interview.stage.started", {"stage": "harness", "title": "正在校验第一问"})

    # 判断是否使用了 fallback
    fallback_used = start_llm_meta.get("fallback_used", False)
    fallback_reason = None
    if fallback_used:
        model_was_found = bool(start_llm_meta.get("model"))
        model_was_called = bool(start_llm_meta.get("used"))
        if not model_was_found:
            fallback_reason = "no_model_available"
        elif not model_was_called:
            # 模型找到了但调用失败（流式报错/超时/非法 JSON），从 errors 推断原因
            errors_str = "; ".join(start_llm_meta.get("errors", [])[-5:])
            if not errors_str:
                fallback_reason = "unknown_error"
            elif "timeout" in errors_str.lower():
                fallback_reason = "llm_timeout"
            elif "stream" in errors_str.lower():
                fallback_reason = "llm_stream_error"
            elif "json" in errors_str.lower():
                fallback_reason = "json_parse_failed"
            else:
                fallback_reason = "llm_stream_error"
        else:
            errors_str = "; ".join(start_llm_meta.get("errors", [])[-3:])
            if "timeout" in errors_str.lower():
                fallback_reason = "llm_timeout"
            elif "stream" in errors_str.lower():
                fallback_reason = "llm_stream_error"
            elif "json" in errors_str.lower():
                fallback_reason = "json_parse_failed"
            elif "锚点" in errors_str or "anchor" in errors_str.lower() or "引用" in errors_str:
                fallback_reason = "harness_validation_failed"
            elif errors_str:
                fallback_reason = "harness_validation_failed"
            else:
                fallback_reason = "unknown_error"
    # 将 fallback_reason 写入 llm meta
    start_llm_meta["fallback_reason"] = fallback_reason
    start_llm_meta["fallback_detail"] = "; ".join(start_llm_meta.get("errors", [])[-3:]) if start_llm_meta.get("errors") else None

    intro = str(start_parsed.get("first_question") or fallback_start["first_question"])
    knowledge_points = start_parsed.get("knowledge_points") if isinstance(start_parsed.get("knowledge_points"), list) else fallback_start["knowledge_points"]
    question_reason = str(start_parsed.get("question_reason") or fallback_start["question_reason"])
    question_type = str(start_parsed.get("question_type") or fallback_start["question_type"])
    capability_tags = start_parsed.get("capability_tags") if isinstance(start_parsed.get("capability_tags"), list) else fallback_start["capability_tags"]

    # Harness 校验结果
    harness_passed = not fallback_used
    harness_checks = []
    if resume_anchors:
        anchor_hit = any(kw.lower() in intro.lower() for a in resume_anchors for kw in (a.get("keywords") or []) if kw)
        harness_checks.append(f"引用简历锚点：{'是' if anchor_hit else '否'}")
    harness_checks.append(f"单问题校验：{'通过' if _looks_like_single_question(intro) else '未通过'}")
    harness_checks.append(f"已读简历表述：{'有' if any(w in intro for w in ['读取', '简历', '看过', '阅读', '了解了']) else '无'}")
    harness_checks.append(f"是否 fallback：{'是' if fallback_used else '否'}")
    if fallback_used:
        harness_checks.append(f"fallback 原因：{fallback_reason or '未知'}")

    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "harness",
        "title": "已校验第一问",
        "summary": f"校验{'通过' if harness_passed else '未通过，已使用保守策略'}",
        "details": harness_checks,
        "evidence": [],
    })

    # 构建 top_sources（只保留 top 3）
    top_sources = [
        {"title": item.get("title", ""), "topic": item.get("topic", ""), "source_file": item.get("source_file", ""), "score": item.get("score", 0)}
        for item in retrieved[:3]
    ]

    session = InterviewSession(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        target_role=target_role,
        job_description=job_description,
        interview_type=payload.interview_type,
        interview_style=payload.interview_style,
        difficulty=payload.difficulty,
        round_limit=payload.round_limit,
        model_config_id=payload.model_id,
        resume_snapshot=f"【简历来源】{resume_source_label}\n【面试类型】{type_cfg['label']}：{type_cfg['focus']}\n【面试风格】{style_cfg['label']}：{style_cfg['rule']}\n【面试重点】{'、'.join(payload.focus_tags[:8]) or '默认'}\n【用户自定义要求】{payload.custom_instruction or '无'}\n\n【岗位画像】{job_profile_summary}\n\n【简历内容】\n{resume_snapshot}",
        # 岗位画像
        company_name=company_name,
        seniority_level=seniority_level,
        job_skills_json=_json_dumps(job_skills),
        job_profile_json=_json_dumps({"summary": job_profile_summary, "skills": job_skills}),
        # 阶段状态机
        current_stage=current_stage,
        stage_plan_json=_json_dumps(stage_plan),
        coverage_json=_json_dumps({}),
    )
    db.add(session)
    db.flush()
    turn = InterviewTurn(
        session_id=session.id,
        student_id=identity.user_id,
        turn_index=1,
        question=intro,
        answer_assessment=_json_dumps({
            "summary": str(start_parsed.get("resume_brief") or fallback_start["resume_brief"]),
            "positive_points": start_parsed.get("focus_points") if isinstance(start_parsed.get("focus_points"), list) else fallback_start["focus_points"],
            "risk_points": [],
            "llm": start_llm_meta,
            "retrieval": {
                "query": f"{target_role} {job_description} 面试 项目 技术基础"[:500],
                "hit_count": len(retrieved),
                "top_sources": [item.get("source_file") for item in retrieved[:3]],
            },
        }),
        retrieved_chunks_json=_json_dumps(retrieved),
        knowledge_points_json=_json_dumps(knowledge_points),
        # 阶段 + 检索解释性
        stage=current_stage,
        question_type=question_type,
        question_reason=question_reason,
        capability_tags_json=_json_dumps(capability_tags),
        retrieval_query=f"{target_role} {job_description} 面试 项目 技术基础"[:500],
        retrieval_hit_count=len(retrieved),
        top_sources_json=_json_dumps(top_sources),
    )
    db.add(turn)
    db.commit()
    db.refresh(session)
    db.refresh(turn)
    set_progress(request_id, stage="done", status="done", message="第一问已生成", done=True)
    result = {"session": _serialize_session(session), "first_turn": serialize_turn(turn), "knowledge_status": knowledge_status()}
    emit_interview_event(event_run_id, "interview.stage.completed", {
        "stage": "done",
        "title": "第一问已生成",
        "summary": f"第一问已准备就绪，考察方向：{'、'.join(capability_tags[:2]) if capability_tags else '综合能力'}",
        "details": [
            f"第一问：{intro[:80]}{'...' if len(intro) > 80 else ''}",
            f"考察原因：{question_reason}",
            f"考察点：{'、'.join(capability_tags) if capability_tags else '无'}",
            f"知识点：{'、'.join(knowledge_points) if knowledge_points else '无'}",
        ],
        "evidence": [],
    })
    emit_interview_event(event_run_id, "interview.question.created", {"turn_id": turn.id, "question": intro})
    emit_interview_event(event_run_id, "interview.started", result)
    mark_interview_run_done(event_run_id)
    return result


def _get_session(db: Session, identity: AuthIdentity, session_id: int) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if not session or session.student_id != identity.user_id or session.tenant_id != identity.tenant_id:
        raise InterviewNotFoundError
    return session


def list_interviews(db: Session, identity: AuthIdentity) -> list[dict]:
    sessions = db.scalars(
        select(InterviewSession)
        .where(
            InterviewSession.student_id == identity.user_id,
            InterviewSession.tenant_id == identity.tenant_id,
        )
        .order_by(InterviewSession.created_at.desc())
        .limit(50)
    ).all()
    return [_serialize_session(item) for item in sessions]


def get_interview_detail(db: Session, identity: AuthIdentity, session_id: int) -> dict:
    session = _get_session(db, identity, session_id)
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    return {"session": _serialize_session(session), "turns": [serialize_turn(item) for item in turns]}


def delete_interview(db: Session, identity: AuthIdentity, session_id: int) -> None:
    session = _get_session(db, identity, session_id)
    # 先删子记录（无外键约束，需手动清理）
    db.query(InterviewTurn).filter(InterviewTurn.session_id == session.id).delete()
    db.query(InterviewReport).filter(InterviewReport.session_id == session.id).delete()
    db.delete(session)
    db.commit()


def submit_turn(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    answer: str,
    *,
    request_id: str | None = None,
    turn_id: int | None = None,
    event_run_id: str | None = None,
) -> dict:
    emit_interview_event(event_run_id, "runtime.status", {"phase": "receive_answer", "label": "正在读取你的回答"})
    session = _get_session(db, identity, session_id)
    if session.status != "active":
        raise InterviewNotActiveError
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    
    # ── 幂等保护：先处理 turn_id ──
    target_turn = None
    if turn_id is not None:
        target_turn = db.scalar(
            select(InterviewTurn).where(
                InterviewTurn.id == turn_id,
                InterviewTurn.session_id == session.id,
                InterviewTurn.student_id == identity.user_id,
            )
        )
        if not target_turn:
            raise InterviewError(status_code=404, detail="问题不存在")
    else:
        # 找到当前 pending turn
        target_turn = next((turn for turn in reversed(turns) if not turn.answer), None)
        if not target_turn:
            raise InterviewNoPendingQuestionError

    # ── 幂等保护：同一 request_id 重复提交直接返回已有结果 ──
    if target_turn.answer and target_turn.submit_request_id == request_id:
        # 找到已有的 next_turn
        existing_next = next((t for t in turns if t.turn_index == target_turn.turn_index + 1), None)
        return {
            "current_turn": serialize_turn(target_turn),
            "next_turn": serialize_turn(existing_next) if existing_next else None,
            "is_finished": session.status == "completed",
            "report_id": None,
        }

    # ── 幂等保护：同一 turn 不同 request_id 已回答 → 冲突 ──
    if target_turn.answer and (not request_id or target_turn.submit_request_id != request_id):
        raise InterviewError(status_code=409, detail="该问题已回答，请刷新面试记录")

    # ── 检查 target_turn 是否是当前 pending turn ──
    current = next((turn for turn in reversed(turns) if not turn.answer), None)
    if current and target_turn.id != current.id:
        raise InterviewError(status_code=400, detail="turn_id 与当前待回答问题不匹配，请刷新面试记录")
    # 设置 current 为 target_turn，以便后续代码使用
    current = target_turn

    emit_interview_event(event_run_id, "runtime.status", {"phase": "retrieval", "label": "正在检索题库和岗位知识"})
    index = get_knowledge_index()
    retrieval_query = f"{session.target_role} {current.question} {answer}"[:500]
    retrieved = index.search(retrieval_query, target_role=session.target_role, limit=6)
    fallback = _fallback_followup(answer, retrieved)

    # ── 构建 top_sources ──
    top_sources = [
        {"title": item.get("title", ""), "topic": item.get("topic", ""), "source_file": item.get("source_file", ""), "score": item.get("score", 0)}
        for item in retrieved[:3]
    ]

    # ── 岗位画像注入 ──
    job_profile = _extract_job_profile_info(session)
    job_profile_text = _render_template(EXTRACTED_JOB_PROMPT, job_profile)

    # ── 注入当前阶段到 Prompt ──
    current_stage = session.current_stage or "opening"
    stage_def = STAGE_DEFINITIONS.get(current_stage, STAGE_DEFINITIONS["opening"])
    stage_injection = f"\n【当前面试阶段】{stage_def['label']}——{stage_def['goal']}"

    # ── 当前回答质量初判（注入给模型）──
    pre_quality_score, pre_is_vague, pre_lacks_depth = compute_answer_quality(answer, None, None)
    current_quality_injection = (
        f"\n【当前回答质量初判】\n"
        f"质量分：{pre_quality_score}/10\n"
        f"是否空泛：{'是' if pre_is_vague else '否'}\n"
        f"是否缺少深度：{'是' if pre_lacks_depth else '否'}\n"
        f"{'如果空泛，下一问必须要求候选人补充个人职责、实现细节、量化指标或具体案例。' if pre_is_vague else ''}"
    )

    # ── 构建 context_block（截断长文本以加速推理）──
    resume_text = (session.resume_snapshot or "未提供")
    if len(resume_text) > 3000:
        resume_text = resume_text[:3000] + "\n…[简历内容已截断，完整信息已在首轮注入]"
    retrieved_brief = json.dumps(
        [{"topic": item.get("topic", ""), "title": item.get("title", "")} for item in retrieved[:4]],
        ensure_ascii=False,
    )
    asked_kps = sum((_json_loads(t.knowledge_points_json, []) for t in turns), [])
    asked_kps_str = "、".join(asked_kps[-12:]) if len(asked_kps) > 12 else "、".join(asked_kps)
    context_parts = [
        f"【目标岗位】{session.target_role}",
        f"【岗位 JD】{(session.job_description or '未提供')[:2000] + stage_injection}",
        f"【面试类型】{INTERVIEW_TYPE_CONFIG.get(session.interview_type, INTERVIEW_TYPE_CONFIG['technical'])['label']}",
        f"【面试风格】{INTERVIEW_STYLE_CONFIG.get(session.interview_style, INTERVIEW_STYLE_CONFIG['strict'])['label']}——{INTERVIEW_STYLE_CONFIG.get(session.interview_style, INTERVIEW_STYLE_CONFIG['strict'])['rule']}",
        f"【候选人简历摘要】{resume_text}",
        job_profile_text,
        f"【上一轮问题】{current.question}",
        f"【候选人上一轮回答】{answer}",
        f"【知识库检索结果】{retrieved_brief}",
        f"【已问过的知识点】{asked_kps_str}",
        current_quality_injection,
    ]
    # 注入上一轮回答的质量反馈（供 Model 参考）
    prev_turns_with_answer = [t for t in turns if t.answer and t.turn_index < current.turn_index]
    if prev_turns_with_answer:
        last_turn = prev_turns_with_answer[-1]
        prev_score_data = _json_loads(last_turn.score_json, None)
        prev_assessment_data = _json_loads(last_turn.answer_assessment, None)
        if prev_score_data and prev_assessment_data:
            prev_quality, prev_vague, prev_lacks = compute_answer_quality(
                last_turn.answer, prev_score_data, prev_assessment_data
            )
            feedback_text = _render_template(QUALITY_FEEDBACK_PROMPT, {
                "quality_score": prev_quality,
                "is_vague": "是" if prev_vague else "否",
                "lacks_depth": "是" if prev_lacks else "否",
                "feedback": "回答空泛，需要更具体的细节和量化指标。" if prev_vague else "",
            })
            context_parts.append("【上一轮已完成回答质量反馈】\n" + feedback_text)
    context_block = "\n\n".join(context_parts)
    conversation_block = f"【历史问答】\n{_conversation_history(turns, max_turns=8)}"

    # ── 选择任务 sub-prompt ──
    task_subprompt = INTERVIEW_FOLLOWUP_SUBPROMPT

    prompt = _render_template(
        FOLLOWUP_USER_PROMPT,
        {
            "task_subprompt": task_subprompt,
            "round_context": f"【轮次信息】当前第 {current.turn_index + 1} 轮，共 {session.round_limit} 轮。"
            + (
                f" 这是倒数第 {max(1, session.round_limit - current.turn_index)} 轮，请准备收束面试。"
                if session.round_limit - current.turn_index <= 2
                else ""
            ),
            "context_block": context_block,
            "conversation_block": conversation_block,
        },
    )

    # 构建 grounding context（供 Harness 校验 next_question 引用式幻觉）
    grounding_context = {
        "last_answer": answer,
        "resume_snapshot": (session.resume_snapshot or "")[:3000],
        "history_text": _conversation_history(turns, max_turns=8),
        "job_description": (session.job_description or "")[:2000],
    }

    emit_interview_event(event_run_id, "runtime.status", {"phase": "score", "label": "正在分析回答并评分"})

    # P0: 流式生成追问 — 首个 delta 到达时才切换到 followup 阶段
    _followup_stage_emitted = False

    def _on_followup_delta(delta: str):
        nonlocal _followup_stage_emitted
        if not _followup_stage_emitted:
            _followup_stage_emitted = True
            emit_interview_event(event_run_id, "runtime.status", {"phase": "followup", "label": "正在生成追问"})
        emit_interview_event(event_run_id, "interview.stage.delta", {"stage": "score", "delta": delta})
        emit_interview_event(event_run_id, "interviewer.delta", {"target": "followup", "delta": delta})

    def _on_followup_display(text: str):
        if text:
            emit_interview_event(event_run_id, "interviewer.snapshot", {"target": "followup", "text": text})

    def _on_followup_completed(text: str):
        emit_interview_event(event_run_id, "interviewer.completed", {"target": "followup", "text": text})

    from app.interview.harness import run_harnessed_streaming_generation
    parsed, llm_meta = run_harnessed_streaming_generation(
        db,
        task_name="submit_turn",
        system_prompt=INTERVIEW_STREAMING_SYSTEM_PROMPT,
        user_prompt=prompt,
        fallback=fallback,
        validator=validate_followup_output,
        context=grounding_context,
        identity=identity,
        preferred_model_id=session.model_config_id,
        temperature=0.35,
        max_tokens=1500,
        max_retries=2,
        on_delta=_on_followup_delta,
        on_display_text=_on_followup_display,
        on_completed=_on_followup_completed,
    )

    # 添加 fallback_reason 到 llm meta
    if llm_meta.get("fallback_used"):
        model_was_found = bool(llm_meta.get("model"))
        model_was_called = bool(llm_meta.get("used"))
        errors_str = "; ".join(llm_meta.get("errors", [])[-3:])
        if not model_was_found:
            llm_meta["fallback_reason"] = "no_model_available"
        elif not model_was_called:
            if not errors_str:
                llm_meta["fallback_reason"] = "llm_stream_error"
            elif "timeout" in errors_str.lower():
                llm_meta["fallback_reason"] = "llm_timeout"
            elif "stream" in errors_str.lower():
                llm_meta["fallback_reason"] = "llm_stream_error"
            elif "JSON" in errors_str or "json" in errors_str:
                llm_meta["fallback_reason"] = "json_parse_failed"
            else:
                llm_meta["fallback_reason"] = "llm_stream_error"
        elif "timeout" in errors_str.lower():
            llm_meta["fallback_reason"] = "llm_timeout"
        elif "stream" in errors_str.lower():
            llm_meta["fallback_reason"] = "llm_stream_error"
        elif "JSON" in errors_str or "json" in errors_str:
            llm_meta["fallback_reason"] = "json_parse_failed"
        elif "质量" in errors_str or "QA" in errors_str:
            llm_meta["fallback_reason"] = "question_quality_failed"
        else:
            llm_meta["fallback_reason"] = "harness_validation_failed"
        llm_meta["fallback_detail"] = errors_str

    # ── QA 打分：对 next_question 做质量检查，低于 6 分触发一次轻量重试 ──
    raw_next_q = str(parsed.get("next_question") or "").strip()
    qa_score, qa_issues = _qa_score_question(raw_next_q)
    if qa_score < 6 and raw_next_q:
        logger = __import__("logging").getLogger(__name__)
        logger.warning("submit_turn QA score=%.1f (<6), issues=%s — triggering lightweight retry", qa_score, qa_issues)
        retry_prompt_parts = [
            "你的上一个 next_question 质量不达标，请重新生成一个更具体的追问。",
            f"【原问题】{raw_next_q}",
            f"【质量问题】{'；'.join(qa_issues)}",
            "【要求】新问题必须有明确的验证目标，引用候选人回答中的具体内容，禁止泛泛收尾。",
            "只输出 next_question 字段的文本内容，不要输出 JSON。",
        ]
        retry_prompt = "\n".join(retry_prompt_parts)
        from app.core.llm_client import chat_completion
        models = _candidate_chat_models(db, identity, session.model_config_id)
        if models:
            try:
                retry_result = chat_completion(
                    models[0],
                    system_prompt="你是一个严格的技术面试官。请根据要求重新生成一个高质量的追问。只输出问题文本。",
                    variables={},
                    memory=[],
                    user_message=retry_prompt,
                    temperature=0.4,
                    max_tokens=300,
                )
                retry_q = str(retry_result.get("reply") or "").strip()
                retry_score, retry_issues = _qa_score_question(retry_q)
                if retry_score >= 6 and retry_q:
                    parsed["next_question"] = retry_q
                    llm_meta["qa_retry"] = True
                    llm_meta["qa_retry_score"] = retry_score
                else:
                    llm_meta["qa_retry"] = False
                    llm_meta["qa_retry_score"] = retry_score
                    llm_meta["qa_retry_issues"] = retry_issues
            except Exception as exc:
                llm_meta["qa_retry"] = False
                llm_meta["qa_retry_error"] = str(exc)[:180]
    score = parsed.get("score") if isinstance(parsed.get("score"), dict) else fallback["score"]
    assessment = parsed.get("answer_assessment") if isinstance(parsed.get("answer_assessment"), dict) else fallback["answer_assessment"]
    knowledge_points = parsed.get("knowledge_points") if isinstance(parsed.get("knowledge_points"), list) else fallback["knowledge_points"]

    # ── 评分可解释性 ──
    score_reasons = _normalize_score_reasons(parsed.get("score_reasons"))
    evidence_quotes = _filter_evidence_quotes(parsed.get("evidence_quotes"), answer)

    # ── 计算回答质量指标 ──
    quality_score, is_vague, lacks_depth = compute_answer_quality(answer, score, assessment)

    current.answer = answer
    current.submit_request_id = request_id
    if isinstance(assessment, dict):
        assessment["llm"] = llm_meta
        assessment["retrieval"] = {
            "query": retrieval_query,
            "hit_count": len(retrieved),
            "top_sources": [item.get("source_file") for item in retrieved[:3]],
        }
    current.answer_assessment = _json_dumps(assessment)
    current.score_json = _json_dumps(score)
    current.followup_reason = str(parsed.get("followup_strategy") or parsed.get("followup_reason") or fallback["followup_strategy"])
    current.retrieved_chunks_json = _json_dumps(retrieved)
    current.knowledge_points_json = _json_dumps(knowledge_points)
    # 评分可解释性
    current.score_reasons_json = _json_dumps(score_reasons)
    current.evidence_quotes_json = _json_dumps(evidence_quotes)
    # 检索解释性
    current.retrieval_query = retrieval_query
    current.retrieval_hit_count = len(retrieved)
    current.top_sources_json = _json_dumps(top_sources)

    # ── 更新阶段覆盖度 + 质量指标（区分累计空泛和连续空泛）──
    coverage = _json_loads(session.coverage_json, {})
    coverage = update_coverage(coverage, current_stage, knowledge_points, score)
    coverage = update_quality_metrics(coverage, current_stage, quality_score, is_vague)
    # 更新连续空泛计数
    if current_stage not in coverage:
        coverage[current_stage] = {}
    stage_cov = coverage[current_stage]
    if is_vague:
        stage_cov["consecutive_vague_count"] = stage_cov.get("consecutive_vague_count", 0) + 1
    else:
        stage_cov["consecutive_vague_count"] = 0
    session.coverage_json = _json_dumps(coverage)

    # ── Harness 主导的停止判定 ──
    model_should_end = _strict_bool(parsed.get("should_end"))
    valid_answer_count = sum(1 for t in turns if t.answer and len(t.answer.strip()) >= 20)
    coverage_for_decision = _json_loads(session.coverage_json, {})
    should_finish, finish_reason = harness_should_finish_interview(
        model_should_end=model_should_end,
        current_turn_index=current.turn_index,
        round_limit=session.round_limit,
        coverage=coverage_for_decision,
        current_stage=current_stage,
        valid_answer_count=valid_answer_count,
    )
    # 将 finish_reason 写入 assessment 的 llm 字段供审计
    if isinstance(assessment, dict):
        if "llm" not in assessment:
            assessment["llm"] = {}
        assessment["llm"]["finish_reason"] = finish_reason
    report_id = None
    next_turn = None
    if should_finish:
        session.status = "completed"
        session.current_stage = "completed"
        session.ended_at = datetime.now(timezone.utc)
        # 强制出题三件套：即使结束，也将模型生成的收束性提问写入 followup_reason 供前端展示
        closing_question = str(parsed.get("next_question") or "").strip()
        if closing_question:
            current.followup_reason = closing_question
        report = generate_report(db, identity, session.id, commit=False)
        report_id = report.id
        # 报告生成完成后自动触发一次能力画像分析（24h 节流）
        _schedule_post_report_analysis(identity)
    else:
        # ── 计算下一阶段（回答质量感知，使用连续空泛）──
        stage_plan = _json_loads(session.stage_plan_json, [])
        previous_stage = current_stage
        next_stage = advance_stage(
            current_stage=current_stage,
            stage_plan=stage_plan,
            turn_index=current.turn_index + 1,
            round_limit=session.round_limit,
            coverage=coverage,
            quality_score=quality_score,
            is_vague=is_vague,
        )
        # 跳过不适用的阶段
        while should_skip_stage(next_stage, session.interview_type) and next_stage != "wrap_up":
            idx = _STAGE_ORDER.index(next_stage) if next_stage in _STAGE_ORDER else -1
            if idx >= 0 and idx + 1 < len(_STAGE_ORDER):
                next_stage = _STAGE_ORDER[idx + 1]
            else:
                break
        session.current_stage = next_stage

        next_question = str(parsed.get("next_question") or fallback["next_question"])
        next_question_type = str(parsed.get("question_type") or fallback.get("question_type", ""))
        next_question_reason = str(parsed.get("question_reason") or fallback.get("followup_strategy", ""))
        next_capability_tags = parsed.get("capability_tags") if isinstance(parsed.get("capability_tags"), list) else []

        # wrap_up 阶段强制收束：不只是 next_question 为空时 fallback
        if next_stage == "wrap_up":
            if not is_valid_wrap_up_question(next_question, next_question_type):
                wrap_fallback = _wrap_up_fallback(session.target_role)
                next_question = wrap_fallback["next_question"]
                next_question_type = wrap_fallback.get("question_type", "wrap_up")
                next_question_reason = wrap_fallback.get("question_reason", "")
                next_capability_tags = wrap_fallback.get("capability_tags", [])

        # 幂等保护：创建下一轮 turn 前检查 (session_id, turn_index) 是否已存在
        next_turn_index = current.turn_index + 1
        existing_next = db.scalar(
            select(InterviewTurn).where(
                InterviewTurn.session_id == session.id,
                InterviewTurn.turn_index == next_turn_index,
            )
        )
        if existing_next:
            # 已存在，直接复用（防止并发重复创建）
            next_turn = existing_next
            next_turn.question = next_question
            next_turn.stage = next_stage
            next_turn.question_type = next_question_type
            next_turn.question_reason = next_question_reason
        else:
            next_turn = InterviewTurn(
                session_id=session.id,
                student_id=identity.user_id,
                turn_index=next_turn_index,
                question=next_question,
                retrieved_chunks_json=_json_dumps(retrieved),
                knowledge_points_json=_json_dumps(knowledge_points),
                # 阶段
                stage=next_stage,
                question_type=next_question_type,
                question_reason=next_question_reason,
                capability_tags_json=_json_dumps(next_capability_tags),
            )
            db.add(next_turn)
            try:
                db.flush()
            except IntegrityError:
                db.rollback()
                # 回查已有的 next_turn
                existing_next = db.scalar(
                    select(InterviewTurn).where(
                        InterviewTurn.session_id == session.id,
                        InterviewTurn.turn_index == next_turn_index,
                    )
                )
                if existing_next:
                    next_turn = existing_next
                    next_turn.question = next_question
                    next_turn.stage = next_stage
                    next_turn.question_type = next_question_type
                    next_turn.question_reason = next_question_reason
                else:
                    raise
        # 记录阶段推进信息到 answer_assessment（审计用）
        if isinstance(assessment, dict):
            assessment.setdefault("stage_transition", {})
            assessment["stage_transition"] = {
                "from": previous_stage,
                "to": next_stage,
                "quality_score": quality_score,
                "is_vague": is_vague,
                "lacks_depth": lacks_depth,
                "consecutive_vague_count": coverage.get(current_stage, {}).get("consecutive_vague_count", 0),
            }
            current.answer_assessment = _json_dumps(assessment)
    db.commit()
    db.refresh(current)
    if next_turn:
        db.refresh(next_turn)
    result = {
        "current_turn": serialize_turn(current),
        "next_turn": serialize_turn(next_turn) if next_turn else None,
        "is_finished": should_finish,
        "report_id": report_id,
    }
    emit_interview_event(event_run_id, "interview.turn.scored", {"turn_id": current.id, "score": _json_loads(current.score_json, {})})
    if next_turn:
        emit_interview_event(event_run_id, "interview.question.created", {"turn_id": next_turn.id, "question": next_turn.question})
    emit_interview_event(event_run_id, "runtime.status", {"phase": "completed", "label": "已生成追问"})
    emit_interview_event(event_run_id, "interview.turn.completed", result)
    mark_interview_run_done(event_run_id)
    return result


# ── 语音面试管线（Voice Pipeline）──────────────────────────────────────────────
#
# 架构原则：
# - Mimo v2.5 在语音链路中 **只负责音频转写**
# - 评分、追问、阶段推进、报告生成必须走 submit_turn / state_machine / harness
# - 语音回答最终进入 submit_turn(...)，不绕过任何 Harness 校验

VOICE_TRANSCRIPT_SYSTEM_PROMPT = """你是一个音频转写模块。你会收到一段候选人的语音音频。

你的唯一任务是：将音频内容准确转写为文字。

输出 JSON 格式（只输出这个格式，不要输出其他内容）：
{
  "text": "音频转写的完整文字内容",
  "language": "zh-CN",
  "confidence": 0.9
}

注意：
- 只做转写，不要评估、不要评分、不要生成问题。
- 如实转写，不要编造、补充或改写内容。
- 如果音频无法识别，text 字段返回空字符串。
- confidence 为 0-1 之间的浮点数，表示转写置信度。
"""


VOICE_ALLOWED_MIME_PREFIXES = ("audio/", "video/webm", "application/octet-stream")
VOICE_MAX_AUDIO_BYTES = 10 * 1024 * 1024


def _infer_audio_format(content_type: str | None, filename: str | None = None) -> str:
    """Infer the compact audio format expected by voice-capable chat/STT APIs."""
    return voice_service.infer_audio_format(content_type, filename)

    normalized_type = (content_type or "").lower()
    normalized_name = (filename or "").lower()
    source = f"{normalized_type} {normalized_name}"
    if "wav" in source or normalized_name.endswith(".wave"):
        return "wav"
    if "mp3" in source or "mpeg" in source or normalized_name.endswith(".mpga"):
        return "mp3"
    if "ogg" in source or "oga" in source:
        return "ogg"
    if "mp4" in source or "m4a" in source or normalized_name.endswith((".mp4", ".m4a")):
        return "mp4"
    if "webm" in source or normalized_name.endswith(".webm"):
        return "webm"
    return "webm"


def _validate_voice_audio(audio_bytes: bytes, content_type: str | None, filename: str | None = None) -> str:
    content_type = content_type or ""
    lower_name = (filename or "").lower()
    has_known_extension = lower_name.endswith((".webm", ".wav", ".mp3", ".mpeg", ".mpga", ".ogg", ".oga", ".mp4", ".m4a"))
    if not any(content_type.startswith(prefix) for prefix in VOICE_ALLOWED_MIME_PREFIXES) and not has_known_extension:
        raise InterviewError(
            status_code=400,
            detail=f"不支持的文件类型：{content_type or filename or 'unknown'}，请上传 webm/wav/mp3/ogg/m4a 音频。",
        )
    if len(audio_bytes) > VOICE_MAX_AUDIO_BYTES:
        raise InterviewError(status_code=400, detail=f"音频文件过大（{len(audio_bytes) // (1024 * 1024)}MB），最大支持 10MB")
    if len(audio_bytes) < 100:
        raise InterviewError(status_code=400, detail="音频数据过短，请重新录音")
    return _infer_audio_format(content_type, filename)


def _transcribe_voice_audio_sync(
    db: Session,
    identity: AuthIdentity,
    *,
    audio_bytes: bytes,
    content_type: str,
    filename: str | None = None,
) -> dict:
    return voice_service.transcribe_voice_audio_sync(
        db,
        identity,
        audio_bytes=audio_bytes,
        content_type=content_type,
        filename=filename,
    )

    audio_format = _validate_voice_audio(audio_bytes, content_type, filename)

    import base64 as _b64

    audio_base64 = _b64.b64encode(audio_bytes).decode("utf-8")
    models = _candidate_voice_models(db, identity, None)
    if not models:
        raise InterviewError(status_code=503, detail="暂无支持语音转写的模型，请联系管理员配置。")

    model_errors: list[str] = []
    for model in models:
        model_name = getattr(model, "display_name", None) or getattr(model, "model_name", None) or "voice_model"
        try:
            result = voice_chat_completion(
                model,
                system_prompt=VOICE_TRANSCRIPT_SYSTEM_PROMPT,
                audio_base64=audio_base64,
                audio_format=audio_format,
                temperature=0.1,
                max_tokens=1000,
            )
            parsed = _extract_json(result["reply"])
            if parsed and parsed.get("text"):
                return {
                    "text": str(parsed["text"]).strip(),
                    "language": str(parsed.get("language", "zh-CN")),
                    "confidence": float(parsed.get("confidence", 0.8)),
                    "audio_format": audio_format,
                    "audio_size_bytes": len(audio_bytes),
                }
            model_errors.append(f"{model_name}: empty transcript")
        except Exception as exc:  # noqa: BLE001 - expose provider errors to the caller.
            model_errors.append(f"{model_name}: {str(exc)[:240]}")

    detail = "音频转写失败，未识别到有效内容。请重新录音或切换为文字模式。"
    if model_errors:
        detail = f"{detail} 模型返回：{'; '.join(model_errors[:3])}"
    raise InterviewError(status_code=422, detail=detail)


async def transcribe_voice_audio(
    db: Session,
    identity: AuthIdentity,
    *,
    audio_file: UploadFile,
) -> dict:
    audio_bytes = await audio_file.read()
    return _transcribe_voice_audio_sync(
        db,
        identity,
        audio_bytes=audio_bytes,
        content_type=audio_file.content_type or "",
        filename=audio_file.filename,
    )


def transcribe_voice_audio_sync(
    db: Session,
    identity: AuthIdentity,
    *,
    audio_bytes: bytes,
    content_type: str,
    filename: str | None = None,
) -> dict:
    return _transcribe_voice_audio_sync(
        db,
        identity,
        audio_bytes=audio_bytes,
        content_type=content_type,
        filename=filename,
    )


def _attach_voice_meta_to_turn_result(db: Session, turn_result: dict, transcript: dict) -> None:
    current_turn_data = turn_result.get("current_turn")
    if current_turn_data and isinstance(current_turn_data.get("answer_assessment"), dict):
        assessment = current_turn_data["answer_assessment"]
        assessment["voice_meta"] = {
            "input_mode": "voice",
            "audio_format": transcript.get("audio_format"),
            "audio_size_bytes": transcript.get("audio_size_bytes"),
            "transcript_confidence": transcript.get("confidence"),
            "transcript_language": transcript.get("language"),
        }
        current_turn_obj = db.get(InterviewTurn, current_turn_data["id"])
        if current_turn_obj:
            current_turn_obj.answer_assessment = _json_dumps(assessment)
            db.commit()


async def voice_submit_turn(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    *,
    turn_id: int,
    audio_file: UploadFile,
    request_id: str | None = None,
) -> dict:
    """语音面试回答（标准接口）。

    流程：
    1. 验证音频文件格式和大小
    2. 调用 VLM 转写音频（只做转写，不做评分/出题）
    3. 将转写文本直接传入 submit_turn() 走统一管线
    4. 返回 {transcript, turn_result}

    Mimo v2.5 只负责转写，评分/追问/阶段推进全部由 submit_turn 管线处理。
    """
    # ── 验证音频文件 ──
    transcript = await transcribe_voice_audio(db, identity, audio_file=audio_file)
    turn_result = submit_turn(
        db, identity, session_id, transcript["text"],
        request_id=request_id,
        turn_id=turn_id,
    )
    _attach_voice_meta_to_turn_result(db, turn_result, transcript)
    return {
        "transcript": {
            "text": transcript["text"],
            "language": transcript["language"],
            "confidence": transcript["confidence"],
        },
        "turn_result": turn_result,
    }

    transcript = transcribe_voice_audio_sync(
        db,
        identity,
        audio_bytes=audio_bytes,
        content_type=content_type,
        filename=filename,
    )
    turn_result = submit_turn(
        db, identity, session_id, transcript["text"],
        request_id=request_id,
        turn_id=turn_id,
        event_run_id=event_run_id,
    )
    _attach_voice_meta_to_turn_result(db, turn_result, transcript)
    return {
        "transcript": {
            "text": transcript["text"],
            "language": transcript["language"],
            "confidence": transcript["confidence"],
        },
        "turn_result": turn_result,
    }

    _ALLOWED_MIME_PREFIXES = ["audio/", "video/webm"]
    _MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10MB

    content_type = audio_file.content_type or ""
    if not any(content_type.startswith(prefix) for prefix in _ALLOWED_MIME_PREFIXES):
        raise InterviewError(
            status_code=400,
            detail=f"不支持的文件类型：{content_type}，请上传音频文件 (webm/wav/mp3/ogg)",
        )

    audio_bytes = await audio_file.read()
    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise InterviewError(status_code=400, detail=f"音频文件过大（{len(audio_bytes) // (1024*1024)}MB），最大支持 10MB")
    if len(audio_bytes) < 100:
        raise InterviewError(status_code=400, detail="音频数据过短，请重新录音")

    # ── 选择语音模型并转写 ──
    import base64 as _b64
    audio_base64 = _b64.b64encode(audio_bytes).decode("utf-8")

    # 从 content_type 推断格式
    audio_format = "webm"
    if "wav" in content_type:
        audio_format = "wav"
    elif "mp3" in content_type or "mpeg" in content_type:
        audio_format = "mp3"
    elif "ogg" in content_type:
        audio_format = "ogg"
    elif "mp4" in content_type or "m4a" in content_type:
        audio_format = "mp4"

    models = _candidate_voice_models(db, identity, None)
    if not models:
        raise InterviewError(status_code=503, detail="暂无支持语音的模型，请联系管理员配置。")

    transcript_text = ""
    confidence = 0.0
    language = "zh-CN"

    for model in models:
        try:
            result = voice_chat_completion(
                model,
                system_prompt=VOICE_TRANSCRIPT_SYSTEM_PROMPT,
                audio_base64=audio_base64,
                audio_format=audio_format,
                temperature=0.1,
                max_tokens=1000,
            )
            parsed = _extract_json(result["reply"])
            if parsed and parsed.get("text"):
                transcript_text = str(parsed["text"]).strip()
                confidence = float(parsed.get("confidence", 0.8))
                language = str(parsed.get("language", "zh-CN"))
                break
        except Exception:
            continue

    if not transcript_text:
        raise InterviewError(status_code=422, detail="音频转写失败，未识别到有效内容。请重新录音或切换为文字模式。")

    # ── 核心：直接调用 submit_turn，走统一管线 ──
    turn_result = submit_turn(
        db, identity, session_id, transcript_text,
        request_id=request_id,
        turn_id=turn_id,
    )

    # 注入语音元数据到 answer_assessment
    current_turn_data = turn_result.get("current_turn")
    if current_turn_data and isinstance(current_turn_data.get("answer_assessment"), dict):
        assessment = current_turn_data["answer_assessment"]
        assessment["voice_meta"] = {
            "input_mode": "voice",
            "audio_format": audio_format,
            "audio_size_bytes": len(audio_bytes),
            "transcript_confidence": confidence,
            "transcript_language": language,
        }
        current_turn_obj = db.get(InterviewTurn, current_turn_data["id"])
        if current_turn_obj:
            current_turn_obj.answer_assessment = _json_dumps(assessment)
            db.commit()

    return {
        "transcript": {
            "text": transcript_text,
            "language": language,
            "confidence": confidence,
        },
        "turn_result": turn_result,
    }


def voice_submit_turn_sync(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    *,
    turn_id: int,
    audio_bytes: bytes,
    content_type: str,
    filename: str | None = None,
    request_id: str | None = None,
    event_run_id: str | None = None,
) -> dict:
    """语音面试回答（同步版本，供后台任务使用）。

    与 voice_submit_turn 功能相同，但接受原始字节而非 UploadFile，
    避免在后台任务中使用 async。
    """
    transcript = transcribe_voice_audio_sync(
        db,
        identity,
        audio_bytes=audio_bytes,
        content_type=content_type,
        filename=filename,
    )
    turn_result = submit_turn(
        db, identity, session_id, transcript["text"],
        request_id=request_id,
        turn_id=turn_id,
        event_run_id=event_run_id,
    )
    _attach_voice_meta_to_turn_result(db, turn_result, transcript)
    return {
        "transcript": {
            "text": transcript["text"],
            "language": transcript["language"],
            "confidence": transcript["confidence"],
        },
        "turn_result": turn_result,
    }

    _ALLOWED_MIME_PREFIXES = ["audio/", "video/webm"]
    _MAX_AUDIO_BYTES = 10 * 1024 * 1024

    if not any(content_type.startswith(prefix) for prefix in _ALLOWED_MIME_PREFIXES):
        raise InterviewError(
            status_code=400,
            detail=f"不支持的文件类型：{content_type}，请上传音频文件 (webm/wav/mp3/ogg)",
        )

    if len(audio_bytes) > _MAX_AUDIO_BYTES:
        raise InterviewError(status_code=400, detail=f"音频文件过大（{len(audio_bytes) // (1024*1024)}MB），最大支持 10MB")
    if len(audio_bytes) < 100:
        raise InterviewError(status_code=400, detail="音频数据过短，请重新录音")

    import base64 as _b64
    audio_base64 = _b64.b64encode(audio_bytes).decode("utf-8")

    audio_format = "webm"
    if "wav" in content_type:
        audio_format = "wav"
    elif "mp3" in content_type or "mpeg" in content_type:
        audio_format = "mp3"
    elif "ogg" in content_type:
        audio_format = "ogg"
    elif "mp4" in content_type or "m4a" in content_type:
        audio_format = "mp4"

    models = _candidate_voice_models(db, identity, None)
    if not models:
        raise InterviewError(status_code=503, detail="暂无支持语音的模型，请联系管理员配置。")

    transcript_text = ""
    confidence = 0.0
    language = "zh-CN"

    for model in models:
        try:
            result = voice_chat_completion(
                model,
                system_prompt=VOICE_TRANSCRIPT_SYSTEM_PROMPT,
                audio_base64=audio_base64,
                audio_format=audio_format,
                temperature=0.1,
                max_tokens=1000,
            )
            parsed = _extract_json(result["reply"])
            if parsed and parsed.get("text"):
                transcript_text = str(parsed["text"]).strip()
                confidence = float(parsed.get("confidence", 0.8))
                language = str(parsed.get("language", "zh-CN"))
                break
        except Exception:
            continue

    if not transcript_text:
        raise InterviewError(status_code=422, detail="音频转写失败，未识别到有效内容。请重新录音或切换为文字模式。")

    turn_result = submit_turn(
        db, identity, session_id, transcript_text,
        request_id=request_id,
        turn_id=turn_id,
        event_run_id=event_run_id,
    )

    current_turn_data = turn_result.get("current_turn")
    if current_turn_data and isinstance(current_turn_data.get("answer_assessment"), dict):
        assessment = current_turn_data["answer_assessment"]
        assessment["voice_meta"] = {
            "input_mode": "voice",
            "audio_format": audio_format,
            "audio_size_bytes": len(audio_bytes),
            "transcript_confidence": confidence,
            "transcript_language": language,
        }
        current_turn_obj = db.get(InterviewTurn, current_turn_data["id"])
        if current_turn_obj:
            current_turn_obj.answer_assessment = _json_dumps(assessment)
            db.commit()

    return {
        "transcript": {
            "text": transcript_text,
            "language": language,
            "confidence": confidence,
        },
        "turn_result": turn_result,
    }


def get_turn_tts_text(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    turn_id: int,
) -> dict:
    """获取面试官问题文本（供前端 TTS 朗读）。

    只读取数据库中已有的 turn.question，不重新生成。
    返回结构包含 mode 字段，区分 server_tts / browser_tts。
    当前默认返回 browser_tts，后续接入 Mimo TTS 后可切换。
    """
    session = _get_session(db, identity, session_id)
    turn = db.get(InterviewTurn, turn_id)
    if not turn or turn.session_id != session.id:
        raise InterviewError(status_code=404, detail="问题不存在")
    return {
        "mode": "browser_tts",
        "text": turn.question,
        "audio_base64": None,
        "content_type": None,
        "provider": None,
        "reason": "当前未配置服务端 TTS，前端将使用浏览器朗读",
        "turn_id": turn.id,
        "question_text": turn.question,
        "turn_index": turn.turn_index,
    }


def generate_report(
    db: Session,
    identity: AuthIdentity,
    session_id: int,
    *,
    commit: bool = True,
    event_run_id: str | None = None,
) -> InterviewReport:
    emit_interview_event(event_run_id, "runtime.status", {"phase": "collect_turns", "label": "正在整理面试记录"})
    session = _get_session(db, identity, session_id)
    existing = db.scalar(select(InterviewReport).where(InterviewReport.session_id == session.id).order_by(InterviewReport.id.desc()).limit(1))
    if existing:
        emit_interview_event(event_run_id, "interview.report.created", serialize_report(existing))
        mark_interview_run_done(event_run_id)
        return existing
    emit_interview_event(event_run_id, "runtime.status", {"phase": "score_summary", "label": "正在汇总维度评分"})
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    scores = [_json_loads(turn.score_json, {}) for turn in turns if turn.score_json]
    if scores:
        dim_scores = {
            key: round(sum(float(score.get(key, 3)) for score in scores) / len(scores) * 20, 1)
            for key in SCORE_KEYS
        }
    else:
        dim_scores = {key: 60.0 for key in SCORE_KEYS}
    overall = _weighted_overall(dim_scores)
    fallback = {
        "overall_score": overall,
        "dimension_scores": dim_scores,
        "strengths": ["能够完成基本面试对话", "已有部分技术或项目线索可继续深挖"],
        "weaknesses": ["回答需要更多量化指标", "项目个人贡献和技术取舍还需要讲得更具体"],
        "suggestions": ["用 STAR 结构回答项目题", "每个技术点准备一个真实故障或优化案例", "回答优化类问题时补充前后数据"],
        "next_questions": ["请介绍一个你亲自优化过的接口。", "Redis 缓存和数据库一致性如何保证？", "如果系统 QPS 突增 10 倍，你会怎么排查瓶颈？"],
        "report_text": f"本次面试综合分 {overall}。整体表现可以继续打磨，重点补充项目证据、数据指标和技术取舍。面试官会认可诚实和细节，不会认可空泛的'负责'和'熟悉'。",
        "training_plan": _build_fallback_training_plan(
            min(dim_scores, key=lambda k: dim_scores.get(k, 100)) if dim_scores else "project_evidence"
        ),
        "rewrite_examples": [
            {
                "original": "我负责了项目的后端开发。",
                "improved": "我主导了订单模块的后端重构，将接口 P99 延迟从 800ms 优化到 200ms，支撑了日均 10 万笔订单。",
                "dimension": "project_evidence",
            },
        ],
        "next_session_preset": {
            "target_role": session.target_role,
            "interview_type": session.interview_type,
            "interview_style": session.interview_style,
            "focus_tags": [],
        },
    }

    # ── 注入阶段覆盖度 ──
    coverage = _json_loads(session.coverage_json, {})
    coverage_summary = ""
    if coverage:
        coverage_lines = []
        for stage_key, info in coverage.items():
            stage_label = STAGE_DEFINITIONS.get(stage_key, {}).get("label", stage_key)
            avg_q = info.get("avg_quality", 0)
            coverage_lines.append(f"  {stage_label}: {info.get('turns', 0)} 轮, 平均分 {info.get('avg_score', 0)}, 回答质量 {avg_q}/10")
        coverage_summary = "\n【阶段覆盖度】\n" + "\n".join(coverage_lines)

    # ── 构建报告 prompt（新模板结构）──
    context_parts = [
        f"【目标岗位】{session.target_role}",
        f"【岗位 JD】{session.job_description or '未提供'}",
        f"【简历快照】{(session.resume_snapshot or '未提供')[:12000]}",
        f"【每轮过程评分，仅作参考】{json.dumps(scores, ensure_ascii=False) + coverage_summary}",
    ]
    prompt = _render_template(
        REPORT_USER_PROMPT,
        {
            "task_subprompt": INTERVIEW_REPORT_SUBPROMPT,
            "scoring_rubric_block": f"【评分 Rubric】\n{INTERVIEW_REPORT_SCORING_RUBRIC}",
            "context_block": "\n\n".join(context_parts),
            "conversation_block": f"【面试记录】\n{_conversation_history(turns)}",
        },
    )
    emit_interview_event(event_run_id, "runtime.status", {"phase": "training_plan", "label": "正在生成训练计划"})

    # P0: 流式生成报告
    def _on_report_delta(delta: str):
        emit_interview_event(event_run_id, "interview.stage.delta", {"stage": "report", "delta": delta})
        emit_interview_event(event_run_id, "interviewer.delta", {"target": "report", "delta": delta})

    def _on_report_display(text: str):
        if text:
            emit_interview_event(event_run_id, "interviewer.snapshot", {"target": "report", "text": text})

    def _on_report_completed(text: str):
        emit_interview_event(event_run_id, "interviewer.completed", {"target": "report", "text": text})

    from app.interview.harness import run_harnessed_streaming_generation
    parsed, llm_meta = run_harnessed_streaming_generation(
        db,
        task_name="generate_report",
        system_prompt=INTERVIEW_STREAMING_SYSTEM_PROMPT,
        user_prompt=prompt,
        fallback=fallback,
        validator=validate_report_output,
        identity=identity,
        preferred_model_id=session.model_config_id,
        temperature=0.2,
        max_tokens=4200,
        max_retries=3,
        on_delta=_on_report_delta,
        on_display_text=_on_report_display,
        on_completed=_on_report_completed,
    )
    final_dim_scores = _normalize_report_dimensions(parsed.get("dimension_scores"), dim_scores)
    try:
        model_overall = float(parsed.get("overall_score"))
    except Exception:
        model_overall = _weighted_overall(final_dim_scores)
    final_overall = round(max(0, min(100, model_overall)), 1)
    weighted_overall = _weighted_overall(final_dim_scores)
    if abs(final_overall - weighted_overall) > 8:
        final_overall = weighted_overall
    comparison = _build_report_comparison(db, identity, session, final_overall, final_dim_scores)
    if comparison is not None:
        comparison["scoring"] = {
            "mode": "llm_rubric" if llm_meta.get("used") else "local_fallback",
            "model": llm_meta.get("model"),
            "usage": llm_meta.get("usage"),
            "rubric": "CareerForge technical/behavioral interview rubric",
        }
    report_text = str(parsed.get("report_text") or fallback["report_text"])
    if not llm_meta.get("used"):
        report_text += "\n\n本次模型评分服务暂时不可用，系统已按同一套评分 Rubric 做本地兜底；建议模型服务恢复后重新生成报告。"
    report = InterviewReport(
        session_id=session.id,
        student_id=identity.user_id,
        overall_score=final_overall,
        dimension_scores_json=_json_dumps(final_dim_scores),
        strengths_json=_json_dumps(parsed.get("strengths") or fallback["strengths"]),
        weaknesses_json=_json_dumps(parsed.get("weaknesses") or fallback["weaknesses"]),
        suggestions_json=_json_dumps(parsed.get("suggestions") or fallback["suggestions"]),
        next_questions_json=_json_dumps(parsed.get("next_questions") or fallback["next_questions"]),
        comparison_json=_json_dumps(comparison),
        report_text=report_text,
        # 训练闭环
        training_plan_json=_json_dumps(parsed.get("training_plan") or fallback["training_plan"]),
        rewrite_examples_json=_json_dumps(parsed.get("rewrite_examples") or fallback["rewrite_examples"]),
        next_session_preset_json=_json_dumps(parsed.get("next_session_preset") or fallback["next_session_preset"]),
    )
    db.add(report)
    session.status = "completed"
    session.ended_at = session.ended_at or datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(report)
    else:
        db.flush()
    emit_interview_event(event_run_id, "interview.report.created", serialize_report(report))
    mark_interview_run_done(event_run_id)
    return report


def _build_report_comparison(
    db: Session,
    identity: AuthIdentity,
    session: InterviewSession,
    overall: float,
    dim_scores: dict[str, float],
) -> dict[str, Any] | None:
    previous = db.scalar(
        select(InterviewReport)
        .join(InterviewSession, InterviewReport.session_id == InterviewSession.id)
        .where(
            InterviewReport.student_id == identity.user_id,
            InterviewSession.tenant_id == identity.tenant_id,
            InterviewReport.session_id != session.id,
            InterviewSession.target_role == session.target_role,
        )
        .order_by(InterviewReport.created_at.desc())
        .limit(1)
    )
    if not previous:
        return {
            "has_previous": False,
            "message": "这是该岗位的首次面试记录，后续报告会自动和上一次对比。",
        }
    prev_dims = _json_loads(previous.dimension_scores_json, {})
    prev_overall = float(previous.overall_score or 0)
    delta = round(overall - prev_overall, 1)
    dim_delta = {
        key: round(float(dim_scores.get(key, 0)) - float(prev_dims.get(key, 0)), 1)
        for key in SCORE_KEYS
    }
    if delta >= 5:
        message = f"比上一次提升了 {delta} 分，表现明显更稳。继续保持，别给面试官挑刺的机会。"
    elif delta <= -5:
        message = f"比上一次下降了 {abs(delta)} 分，主要需要回到项目细节和量化结果上补强。"
    else:
        message = f"和上一次基本持平（{delta:+.1f} 分），下一轮建议集中突破最低分维度。"
    return {
        "has_previous": True,
        "previous_report_id": previous.id,
        "previous_overall_score": prev_overall,
        "current_overall_score": overall,
        "overall_delta": delta,
        "dimension_delta": dim_delta,
        "message": message,
    }


def get_report(db: Session, identity: AuthIdentity, session_id: int) -> dict:
    """Get report for a session."""
    session = _get_session(db, identity, session_id)
    report = db.scalar(
        select(InterviewReport)
        .where(InterviewReport.session_id == session.id)
        .order_by(InterviewReport.id.desc())
        .limit(1)
    )
    if not report:
        raise InterviewError(status_code=404, detail="报告不存在")
    return serialize_report(report)


def export_interview_report(db: Session, identity: AuthIdentity, session_id: int) -> dict:
    """Export full interview report as JSON."""
    session = _get_session(db, identity, session_id)
    turns = db.scalars(
        select(InterviewTurn)
        .where(InterviewTurn.session_id == session.id)
        .order_by(InterviewTurn.turn_index)
    ).all()
    report = db.scalar(
        select(InterviewReport)
        .where(InterviewReport.session_id == session.id)
        .order_by(InterviewReport.id.desc())
        .limit(1)
    )
    return {
        "session": _serialize_session(session),
        "turns": [serialize_turn(t) for t in turns],
        "report": serialize_report(report) if report else None,
    }



def _schedule_post_report_analysis(identity):
    """报告生成后异步触发能力画像分析（24h 节流）.

    使用 daemon 线程，不阻塞 submit_turn 的 SSE 收尾路径。
    失败时仅记录日志，不影响主流程。
    """
    def _runner():
        try:
            from app.infra.db import SessionLocal
            from app.interview.analysis_service import trigger_auto_analysis
            db = SessionLocal()
            try:
                trigger_auto_analysis(db, identity)
            finally:
                db.close()
        except Exception:
            logger.exception("_schedule_post_report_analysis failed")

    thread = threading.Thread(target=_runner, name="post-report-analysis", daemon=True)
    thread.start()
