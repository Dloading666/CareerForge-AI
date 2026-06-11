from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig
from app.auth.models import StudentUser
from app.auth.service import AuthIdentity
from app.core.llm_client import chat_completion
from app.interview.knowledge import get_knowledge_index
from app.interview.models import InterviewReport, InterviewSession, InterviewTurn
from app.interview.prompts import (
    FOLLOWUP_USER_PROMPT,
    INTERVIEW_STYLE_CONFIG,
    INTERVIEW_SYSTEM_PROMPT,
    INTERVIEW_TYPE_CONFIG,
    REPORT_USER_PROMPT,
    START_USER_PROMPT,
)
from app.interview.schemas import InterviewStartRequest
from app.student.profile_details_models import (
    StudentCertification,
    StudentEducation,
    StudentHonor,
    StudentProject,
    StudentSkill,
    StudentWorkExperience,
)
from app.student.resume_models import StudentResume


SCORE_KEYS = [
    "technical_accuracy",
    "project_evidence",
    "problem_solving",
    "communication",
    "job_fit",
    "pressure_handling",
]


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
    try:
        return json.loads(text)
    except Exception:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except Exception:
        return None


def _render_template(template: str, values: dict[str, Any]) -> str:
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{" + key + "}", str(value))
    return rendered


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
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "ended_at": session.ended_at.isoformat() if session.ended_at else None,
    }


def serialize_turn(turn: InterviewTurn) -> dict:
    return {
        "id": turn.id,
        "turn_index": turn.turn_index,
        "question": turn.question,
        "answer": turn.answer,
        "answer_assessment": _json_loads(turn.answer_assessment, None),
        "score": _json_loads(turn.score_json, None),
        "followup_reason": turn.followup_reason,
        "retrieved_chunks": _json_loads(turn.retrieved_chunks_json, []),
        "knowledge_points": _json_loads(turn.knowledge_points_json, []),
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
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


def knowledge_status() -> dict:
    return get_knowledge_index().status()


def _latest_resume_snapshot(db: Session, identity: AuthIdentity) -> str:
    resume = db.scalar(
        select(StudentResume)
        .where(StudentResume.student_id == identity.user_id, StudentResume.tenant_id == identity.tenant_id)
        .order_by(StudentResume.updated_at.desc())
        .limit(1)
    )
    if not resume:
        return "学生暂未创建在线简历。面试时需要优先询问项目、技能和求职方向。"
    return resume.data_json[:8000]


def _student_profile_snapshot(db: Session, identity: AuthIdentity) -> str:
    student = db.get(StudentUser, identity.user_id)
    if not student:
        return "未读取到学生基础档案。"
    fields = [
        ("姓名", student.name),
        ("邮箱", student.email),
        ("学院", student.college),
        ("专业", student.major),
        ("年级", student.grade),
        ("求职状态", student.job_search_status),
        ("期望岗位", student.expected_position),
        ("期望城市", student.expected_location),
        ("个人优势", student.personal_advantages),
    ]
    lines = [f"{label}: {value}" for label, value in fields if value]

    def add_rows(title: str, rows: list[Any], render) -> None:
        if not rows:
            return
        lines.append(f"\n{title}:")
        for row in rows[:5]:
            item = render(row)
            if item:
                lines.append(f"- {item}")

    common_filter = (
        lambda model: select(model)
        .where(model.student_id == identity.user_id, model.tenant_id == identity.tenant_id)
        .order_by(model.sort_order.asc(), model.id.desc())
        .limit(5)
    )
    add_rows("教育经历", list(db.scalars(common_filter(StudentEducation)).all()), lambda r: " / ".join(x for x in [r.school, r.major, r.degree, r.duration, r.description] if x))
    add_rows("项目经历", list(db.scalars(common_filter(StudentProject)).all()), lambda r: " / ".join(x for x in [r.name, r.role, r.start_date, r.end_date, r.description] if x))
    add_rows("实习/工作经历", list(db.scalars(common_filter(StudentWorkExperience)).all()), lambda r: " / ".join(x for x in [r.company, r.position, r.start_date, r.end_date, r.description] if x))
    add_rows("技能", list(db.scalars(common_filter(StudentSkill)).all()), lambda r: " / ".join(x for x in [r.name, f"{r.level}级" if r.level else None, r.description] if x))
    add_rows("荣誉", list(db.scalars(common_filter(StudentHonor)).all()), lambda r: " / ".join(x for x in [r.title, r.level, r.award_date, r.description] if x))
    add_rows("证书", list(db.scalars(common_filter(StudentCertification)).all()), lambda r: " / ".join(x for x in [r.name, r.issuer, r.issue_date, r.description] if x))
    return "\n".join(lines)[:8000] or "学生档案为空。"


def _candidate_chat_models(db: Session, preferred_model_id: int | None = None) -> list[ModelConfig]:
    models = list(db.scalars(
        select(ModelConfig)
        .where(
            ModelConfig.is_deleted == False,
            ModelConfig.status == "active",
            ModelConfig.api_key_cipher.is_not(None),
            ModelConfig.capability.in_(["chat", "text", "multimodal"]),
        )
        .order_by(ModelConfig.open_to_student.desc(), ModelConfig.capability.asc(), ModelConfig.id.asc())
    ).all())
    if preferred_model_id:
        models.sort(key=lambda item: 0 if item.id == preferred_model_id else 1)
    return models


def _llm_json(
    db: Session,
    user_prompt: str,
    fallback: dict[str, Any],
    *,
    temperature: float = 0.35,
    preferred_model_id: int | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    models = _candidate_chat_models(db, preferred_model_id)
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
                max_tokens=2500,
            )
            parsed = _extract_json(result["reply"])
            if not parsed:
                errors.append(f"{model.display_name}: invalid JSON")
                continue
            return parsed, {"used": True, "model": model.display_name, "usage": result.get("usage")}
        except Exception as exc:
            errors.append(f"{model.display_name}: {str(exc)[:180]}")
    return fallback, {"used": False, "model": models[0].display_name, "error": " | ".join(errors)[:500]}


def _conversation_history(turns: list[InterviewTurn]) -> str:
    lines: list[str] = []
    for turn in turns:
        lines.append(f"Q{turn.turn_index}: {turn.question}")
        if turn.answer:
            lines.append(f"A{turn.turn_index}: {turn.answer}")
    return "\n".join(lines[-16:])


def _score_to_100(scores: dict[str, Any]) -> dict[str, float]:
    normalized = {}
    for key in SCORE_KEYS:
        try:
            val = float(scores.get(key, 3))
        except Exception:
            val = 3
        normalized[key] = round(max(1, min(5, val)) * 20, 1)
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
        "followup_strategy": "追问项目证据和技术细节",
        "interviewer_tone": "strict",
        "next_question": question,
        "question_type": "project_deep_dive",
        "knowledge_points": [topic],
        "should_end": False,
    }


def start_interview(db: Session, identity: AuthIdentity, payload: InterviewStartRequest) -> dict:
    resume_snapshot = _latest_resume_snapshot(db, identity)
    profile_snapshot = _student_profile_snapshot(db, identity)
    index = get_knowledge_index()
    retrieved = index.search(
        f"{payload.target_role} {payload.job_description or ''} 面试 项目 技术基础",
        target_role=payload.target_role,
        limit=6,
    )
    type_cfg = INTERVIEW_TYPE_CONFIG.get(payload.interview_type, INTERVIEW_TYPE_CONFIG["technical"])
    style_cfg = INTERVIEW_STYLE_CONFIG.get(payload.interview_style, INTERVIEW_STYLE_CONFIG["strict"])
    fallback_start = {
        "resume_brief": "已读取学生档案和最新在线简历，将围绕岗位匹配度、项目证据和技术细节进行验证。",
        "focus_points": ["项目真实性与个人职责", "目标岗位核心技术匹配", "量化结果和复盘能力"],
        "first_question": (
            f"{type_cfg['opening']} 当前风格是「{style_cfg['label']}」。"
            f"我已经先读取了你的学生档案和最新在线简历。请选一个最能证明你适合「{payload.target_role}」的项目，"
            "按背景、你的职责、关键方案、量化结果说清楚。"
        ),
        "knowledge_points": [item["topic"] for item in retrieved[:3]] or ["项目证据", "岗位匹配"],
    }
    start_prompt = _render_template(
        START_USER_PROMPT,
        {
            "target_role": payload.target_role,
            "job_description": payload.job_description or "未提供",
            "interview_type": type_cfg["label"],
            "interview_type_rule": type_cfg["focus"],
            "interview_style": style_cfg["label"],
            "interview_style_rule": style_cfg["rule"],
            "student_profile": profile_snapshot,
            "resume_summary": resume_snapshot,
            "retrieved_context": json.dumps(retrieved, ensure_ascii=False),
        },
    )
    start_parsed, start_llm_meta = _llm_json(db, start_prompt, fallback_start, preferred_model_id=payload.model_id)
    intro = str(start_parsed.get("first_question") or fallback_start["first_question"])
    knowledge_points = start_parsed.get("knowledge_points") if isinstance(start_parsed.get("knowledge_points"), list) else fallback_start["knowledge_points"]
    session = InterviewSession(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
        target_role=payload.target_role,
        job_description=payload.job_description,
        interview_type=payload.interview_type,
        interview_style=payload.interview_style,
        difficulty=payload.difficulty,
        round_limit=payload.round_limit,
        model_config_id=payload.model_id,
        resume_snapshot=f"【学生基础档案】\n{profile_snapshot}\n\n【最新在线简历】\n{resume_snapshot}",
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
                "query": f"{payload.target_role} {payload.job_description or ''} 面试 项目 技术基础"[:500],
                "hit_count": len(retrieved),
                "top_sources": [item.get("source_file") for item in retrieved[:3]],
            },
        }),
        retrieved_chunks_json=_json_dumps(retrieved),
        knowledge_points_json=_json_dumps(knowledge_points),
    )
    db.add(turn)
    db.commit()
    db.refresh(session)
    db.refresh(turn)
    return {"session": _serialize_session(session), "first_turn": serialize_turn(turn), "knowledge_status": index.status()}


def _get_session(db: Session, identity: AuthIdentity, session_id: int) -> InterviewSession:
    session = db.get(InterviewSession, session_id)
    if not session or session.student_id != identity.user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="面试会话不存在")
    return session


def list_interviews(db: Session, identity: AuthIdentity) -> list[dict]:
    sessions = db.scalars(
        select(InterviewSession)
        .where(InterviewSession.student_id == identity.user_id)
        .order_by(InterviewSession.created_at.desc())
        .limit(50)
    ).all()
    return [_serialize_session(item) for item in sessions]


def get_interview_detail(db: Session, identity: AuthIdentity, session_id: int) -> dict:
    session = _get_session(db, identity, session_id)
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    return {"session": _serialize_session(session), "turns": [serialize_turn(item) for item in turns]}


def submit_turn(db: Session, identity: AuthIdentity, session_id: int, answer: str) -> dict:
    session = _get_session(db, identity, session_id)
    if session.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="面试已经结束")
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    current = next((turn for turn in reversed(turns) if not turn.answer), None)
    if not current:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="没有待回答的问题")

    index = get_knowledge_index()
    retrieved = index.search(f"{session.target_role} {current.question} {answer}", target_role=session.target_role, limit=6)
    fallback = _fallback_followup(answer, retrieved)
    prompt = _render_template(
        FOLLOWUP_USER_PROMPT,
        {
            "target_role": session.target_role,
            "job_description": session.job_description or "未提供",
            "interview_type": INTERVIEW_TYPE_CONFIG.get(session.interview_type, INTERVIEW_TYPE_CONFIG["technical"])["label"],
            "interview_type_rule": INTERVIEW_TYPE_CONFIG.get(session.interview_type, INTERVIEW_TYPE_CONFIG["technical"])["focus"],
            "interview_style": INTERVIEW_STYLE_CONFIG.get(session.interview_style, INTERVIEW_STYLE_CONFIG["strict"])["label"],
            "interview_style_rule": INTERVIEW_STYLE_CONFIG.get(session.interview_style, INTERVIEW_STYLE_CONFIG["strict"])["rule"],
            "resume_summary": session.resume_snapshot or "未提供",
            "conversation_history": _conversation_history(turns),
            "last_question": current.question,
            "last_answer": answer,
            "retrieved_context": json.dumps(retrieved, ensure_ascii=False),
            "asked_topics": ", ".join(sum((_json_loads(t.knowledge_points_json, []) for t in turns), [])),
        },
    )
    parsed, llm_meta = _llm_json(db, prompt, fallback, preferred_model_id=session.model_config_id)
    score = parsed.get("score") if isinstance(parsed.get("score"), dict) else fallback["score"]
    assessment = parsed.get("answer_assessment") if isinstance(parsed.get("answer_assessment"), dict) else fallback["answer_assessment"]
    knowledge_points = parsed.get("knowledge_points") if isinstance(parsed.get("knowledge_points"), list) else fallback["knowledge_points"]

    current.answer = answer
    if isinstance(assessment, dict):
        assessment["llm"] = llm_meta
        assessment["retrieval"] = {
            "query": f"{session.target_role} {current.question} {answer}"[:500],
            "hit_count": len(retrieved),
            "top_sources": [item.get("source_file") for item in retrieved[:3]],
        }
    current.answer_assessment = _json_dumps(assessment)
    current.score_json = _json_dumps(score)
    current.followup_reason = str(parsed.get("followup_strategy") or parsed.get("followup_reason") or fallback["followup_strategy"])
    current.retrieved_chunks_json = _json_dumps(retrieved)
    current.knowledge_points_json = _json_dumps(knowledge_points)

    should_finish = bool(parsed.get("should_end")) or current.turn_index >= session.round_limit
    report_id = None
    next_turn = None
    if should_finish:
        session.status = "completed"
        session.ended_at = datetime.now(timezone.utc)
        report = generate_report(db, identity, session.id, commit=False)
        report_id = report.id
    else:
        next_question = str(parsed.get("next_question") or fallback["next_question"])
        next_turn = InterviewTurn(
            session_id=session.id,
            student_id=identity.user_id,
            turn_index=current.turn_index + 1,
            question=next_question,
            retrieved_chunks_json=_json_dumps(retrieved),
            knowledge_points_json=_json_dumps(knowledge_points),
        )
        db.add(next_turn)
    db.commit()
    db.refresh(current)
    if next_turn:
        db.refresh(next_turn)
    return {
        "current_turn": serialize_turn(current),
        "next_turn": serialize_turn(next_turn) if next_turn else None,
        "is_finished": should_finish,
        "report_id": report_id,
    }


def generate_report(db: Session, identity: AuthIdentity, session_id: int, *, commit: bool = True) -> InterviewReport:
    session = _get_session(db, identity, session_id)
    existing = db.scalar(select(InterviewReport).where(InterviewReport.session_id == session.id).order_by(InterviewReport.id.desc()).limit(1))
    if existing:
        return existing
    turns = db.scalars(select(InterviewTurn).where(InterviewTurn.session_id == session.id).order_by(InterviewTurn.turn_index)).all()
    scores = [_json_loads(turn.score_json, {}) for turn in turns if turn.score_json]
    if scores:
        dim_scores = {
            key: round(sum(float(score.get(key, 3)) for score in scores) / len(scores) * 20, 1)
            for key in SCORE_KEYS
        }
    else:
        dim_scores = {key: 60.0 for key in SCORE_KEYS}
    overall = round(
        dim_scores["technical_accuracy"] * 0.25
        + dim_scores["project_evidence"] * 0.20
        + dim_scores["problem_solving"] * 0.20
        + dim_scores["communication"] * 0.15
        + dim_scores["job_fit"] * 0.15
        + dim_scores["pressure_handling"] * 0.05,
        1,
    )
    fallback = {
        "overall_score": overall,
        "dimension_scores": dim_scores,
        "strengths": ["能够完成基本面试对话", "已有部分技术或项目线索可继续深挖"],
        "weaknesses": ["回答需要更多量化指标", "项目个人贡献和技术取舍还需要讲得更具体"],
        "suggestions": ["用 STAR 结构回答项目题", "每个技术点准备一个真实故障或优化案例", "回答优化类问题时补充前后数据"],
        "next_questions": ["请介绍一个你亲自优化过的接口。", "Redis 缓存和数据库一致性如何保证？", "如果系统 QPS 突增 10 倍，你会怎么排查瓶颈？"],
        "report_text": f"本次面试综合分 {overall}。整体表现可以继续打磨，重点补充项目证据、数据指标和技术取舍。面试官会认可诚实和细节，不会认可空泛的“负责”和“熟悉”。",
    }
    prompt = _render_template(
        REPORT_USER_PROMPT,
        {
            "target_role": session.target_role,
            "job_description": session.job_description or "未提供",
            "conversation_history": _conversation_history(turns),
            "turn_scores": json.dumps(scores, ensure_ascii=False),
        },
    )
    parsed, llm_meta = _llm_json(db, prompt, fallback, temperature=0.25, preferred_model_id=session.model_config_id)
    comparison = _build_report_comparison(db, identity, session, overall, dim_scores)
    report_text = str(parsed.get("report_text") or fallback["report_text"])
    if not llm_meta.get("used"):
        report_text += f"\n\n[系统提示] 本次报告使用本地降级评分，因为大模型调用未成功：{llm_meta.get('error')}"
    report = InterviewReport(
        session_id=session.id,
        student_id=identity.user_id,
        overall_score=float(parsed.get("overall_score") or overall),
        dimension_scores_json=_json_dumps(parsed.get("dimension_scores") or dim_scores),
        strengths_json=_json_dumps(parsed.get("strengths") or fallback["strengths"]),
        weaknesses_json=_json_dumps(parsed.get("weaknesses") or fallback["weaknesses"]),
        suggestions_json=_json_dumps(parsed.get("suggestions") or fallback["suggestions"]),
        next_questions_json=_json_dumps(parsed.get("next_questions") or fallback["next_questions"]),
        comparison_json=_json_dumps(comparison),
        report_text=report_text,
    )
    db.add(report)
    session.status = "completed"
    session.ended_at = session.ended_at or datetime.now(timezone.utc)
    if commit:
        db.commit()
        db.refresh(report)
    else:
        db.flush()
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
