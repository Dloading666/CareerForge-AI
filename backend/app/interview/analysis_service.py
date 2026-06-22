"""Interview Analysis Service 面试报告智能分析服务

负责：聚合学生最近的面试报告 → 调 LLM → 输出 8 维雷达 + 知识分布 + 薄弱项
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.auth.service import AuthIdentity
from app.interview.analysis_prompts import (
    RADAR_DIMENSIONS,
    RADAR_DIMENSION_LABELS,
    build_analysis_user_prompt,
    build_fallback_analysis,
    ANALYSIS_SYSTEM_PROMPT,
)
from app.interview.harness import run_harnessed_json_generation
from app.interview.models import (
    InterviewReport,
    InterviewReportAnalysis,
    InterviewSession,
    InterviewTurn,
)

logger = logging.getLogger(__name__)


# 一次分析最多取最近多少场报告
MAX_REPORTS_PER_ANALYSIS = 20
# 自动触发节流：同一个学生 24h 内不重复跑
AUTO_TRIGGER_COOLDOWN_HOURS = 24


def _validate_analysis_output(data, context):
    """校验 LLM 输出的能力画像 JSON。返回错误列表，空列表表示通过。"""
    errors = []

    radar = data.get("radar")
    if not isinstance(radar, dict):
        errors.append("radar 不是对象")
    else:
        for key in RADAR_DIMENSIONS:
            if key not in radar:
                errors.append("radar 缺少 " + key)
                continue
            try:
                val = float(radar[key])
                if val < 0 or val > 100:
                    errors.append("radar." + key + " = " + str(val) + ", 必须在 0-100 之间")
            except (ValueError, TypeError):
                errors.append("radar." + key + " 不是数字")

    knowledge = data.get("knowledge")
    if not isinstance(knowledge, list):
        errors.append("knowledge 不是数组")
    else:
        if len(knowledge) > 20:
            errors.append("knowledge 数量超过 20")
        for i, item in enumerate(knowledge):
            if not isinstance(item, dict):
                errors.append("knowledge[" + str(i) + "] 不是对象")
                continue
            if "name" not in item or not str(item.get("name", "")).strip():
                errors.append("knowledge[" + str(i) + "].name 缺失")
            for field in ("mastery", "avg_score"):
                try:
                    val = float(item.get(field, -1))
                    if val < 0 or val > 100:
                        errors.append("knowledge[" + str(i) + "]." + field + " = " + str(val) + ", 必须在 0-100")
                except (ValueError, TypeError):
                    errors.append("knowledge[" + str(i) + "]." + field + " 不是数字")
            try:
                count = int(item.get("asked_count", 0))
                if count < 1:
                    errors.append("knowledge[" + str(i) + "].asked_count = " + str(count) + ", 必须 >= 1")
            except (ValueError, TypeError):
                errors.append("knowledge[" + str(i) + "].asked_count 不是整数")

    weaknesses = data.get("weaknesses")
    if not isinstance(weaknesses, list):
        errors.append("weaknesses 不是数组")
    elif weaknesses and not all(isinstance(s, str) for s in weaknesses):
        errors.append("weaknesses 元素必须全部是字符串")

    return errors


def _normalize_analysis(parsed):
    """把 LLM 输出归一化：补齐缺失维度、限制 knowledge 数量"""
    radar_in = parsed.get("radar") or {}
    radar = {}
    for key in RADAR_DIMENSIONS:
        try:
            v = float(radar_in.get(key, 60))
        except (ValueError, TypeError):
            v = 60
        radar[key] = int(round(max(0, min(100, v))))

    knowledge_in = parsed.get("knowledge") or []
    knowledge = []
    for item in knowledge_in[:10]:
        if not isinstance(item, dict):
            continue
        try:
            mastery = float(item.get("mastery", 60))
        except (ValueError, TypeError):
            mastery = 60
        try:
            avg_score = float(item.get("avg_score", mastery))
        except (ValueError, TypeError):
            avg_score = mastery
        try:
            asked_count = int(item.get("asked_count", 1))
        except (ValueError, TypeError):
            asked_count = 1
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        knowledge.append({
            "name": name,
            "mastery": int(round(max(0, min(100, mastery)))),
            "asked_count": max(1, asked_count),
            "avg_score": round(max(0, min(100, avg_score)), 1),
        })
    knowledge.sort(key=lambda x: x["mastery"], reverse=True)

    weaknesses_in = parsed.get("weaknesses") or []
    weaknesses = [str(s).strip() for s in weaknesses_in if str(s).strip()][:5]

    return {
        "radar": radar,
        "knowledge": knowledge,
        "weaknesses": weaknesses,
    }


def _safe_json_loads(raw, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _collect_recent_reports(db, identity, limit=MAX_REPORTS_PER_ANALYSIS):
    """收集学生最近的报告 + 知识点"""
    reports = list(db.scalars(
        select(InterviewReport)
        .where(InterviewReport.student_id == identity.user_id)
        .order_by(desc(InterviewReport.created_at))
        .limit(limit)
    ).all())

    if not reports:
        return []

    session_ids = [r.session_id for r in reports]
    sessions = {
        s.id: s
        for s in db.scalars(
            select(InterviewSession).where(InterviewSession.id.in_(session_ids))
        ).all()
    }

    result = []
    for rep in reports:
        sess = sessions.get(rep.session_id)
        turns = db.scalars(
            select(InterviewTurn.knowledge_points_json)
            .where(InterviewTurn.session_id == rep.session_id)
        ).all()
        kn_set = []
        seen = set()
        for raw in turns:
            kn_list = _safe_json_loads(raw, [])
            if isinstance(kn_list, list):
                for k in kn_list:
                    if isinstance(k, str) and k.strip() and k.strip() not in seen:
                        seen.add(k.strip())
                        kn_set.append(k.strip())

        result.append({
            "target_role": sess.target_role if sess else "未知",
            "interview_type": sess.interview_type if sess else "未知",
            "difficulty": sess.difficulty if sess else "未知",
            "overall_score": rep.overall_score,
            "dimension_scores": _safe_json_loads(rep.dimension_scores_json, {}),
            "strengths": _safe_json_loads(rep.strengths_json, []),
            "weaknesses": _safe_json_loads(rep.weaknesses_json, []),
            "knowledge_points": kn_set,
        })
    return result


def _collect_top_knowledge(db, identity, limit=20):
    """聚合学生所有面试的知识点：按 asked_count 降序，取前 limit"""
    rows = db.execute(
        select(InterviewTurn.knowledge_points_json, InterviewTurn.score_json)
        .join(InterviewSession, InterviewSession.id == InterviewTurn.session_id)
        .where(InterviewSession.student_id == identity.user_id)
    ).all()

    counter = {}
    for raw_kn, raw_score in rows:
        kn_list = _safe_json_loads(raw_kn, [])
        score_dict = _safe_json_loads(raw_score, {})
        if not isinstance(kn_list, list) or not isinstance(score_dict, dict):
            continue
        try:
            overall = float(score_dict.get("overall", 60))
        except (ValueError, TypeError):
            overall = 60.0
        for k in kn_list:
            if not isinstance(k, str) or not k.strip():
                continue
            key = k.strip()
            if key not in counter:
                counter[key] = {"name": key, "asked_count": 0, "score_sum": 0.0, "score_n": 0}
            counter[key]["asked_count"] += 1
            counter[key]["score_sum"] += overall
            counter[key]["score_n"] += 1

    items = []
    for c in counter.values():
        avg = c["score_sum"] / c["score_n"] if c["score_n"] else 60.0
        items.append({
            "name": c["name"],
            "asked_count": c["asked_count"],
            "avg_score": round(max(0, min(100, avg)), 1),
        })
    items.sort(key=lambda x: x["asked_count"], reverse=True)
    return items[:limit]


def _compute_summary_stats(db, identity):
    """顶部 4 张卡：评价分率/通过次数/提问次数/掌握技能数"""
    reports = list(db.scalars(
        select(InterviewReport)
        .where(InterviewReport.student_id == identity.user_id)
        .order_by(desc(InterviewReport.created_at))
    ).all())

    if not reports:
        return {
            "avg_score": 0.0,
            "pass_count": 0,
            "total_interviews": 0,
            "question_count": 0,
            "skill_count": 0,
        }

    avg_score = round(sum(r.overall_score for r in reports) / len(reports), 1)
    pass_count = sum(1 for r in reports if r.overall_score >= 80)
    total_interviews = len(reports)

    session_ids = [r.session_id for r in reports]
    question_count = db.scalar(
        select(func.count(InterviewTurn.id))
        .where(InterviewTurn.session_id.in_(session_ids))
    ) or 0

    rows = db.execute(
        select(InterviewTurn.knowledge_points_json)
        .join(InterviewSession, InterviewSession.id == InterviewTurn.session_id)
        .where(InterviewSession.student_id == identity.user_id)
    ).all()
    kn_set = set()
    for (raw_kn,) in rows:
        kn_list = _safe_json_loads(raw_kn, [])
        if isinstance(kn_list, list):
            for k in kn_list:
                if isinstance(k, str) and k.strip():
                    kn_set.add(k.strip())

    return {
        "avg_score": avg_score,
        "pass_count": pass_count,
        "total_interviews": total_interviews,
        "question_count": int(question_count),
        "skill_count": len(kn_set),
    }


def _preferred_model_id_from_reports(db, identity):
    """从最近的报告里推断 model_config_id（用于 LLM 调用）"""
    rep = db.scalar(
        select(InterviewReport)
        .join(InterviewSession, InterviewSession.id == InterviewReport.session_id)
        .where(InterviewSession.student_id == identity.user_id)
        .order_by(desc(InterviewReport.created_at))
        .limit(1)
    )
    if rep is None:
        return None
    sess = db.get(InterviewSession, rep.session_id)
    return sess.model_config_id if sess else None


def _find_latest_analysis(db, identity):
    return db.scalar(
        select(InterviewReportAnalysis)
        .where(
            InterviewReportAnalysis.tenant_id == identity.tenant_id,
            InterviewReportAnalysis.student_id == identity.user_id,
        )
        .order_by(desc(InterviewReportAnalysis.updated_at))
        .limit(1)
    )


def _cooldown_active(record):
    """自动触发节流：24h 内已分析过则跳过"""
    if record is None:
        return False
    threshold = datetime.now(timezone.utc) - timedelta(hours=AUTO_TRIGGER_COOLDOWN_HOURS)
    updated = record.updated_at
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    return updated > threshold


def get_latest_analysis_payload(db, identity):
    """获取最新分析结果（无则返回空态）"""
    record = _find_latest_analysis(db, identity)
    if record is None:
        return {
            "status": "empty",
            "radar": None,
            "knowledge": [],
            "weaknesses": [],
            "summary": _compute_summary_stats(db, identity),
            "report_count": 0,
            "trigger_type": None,
            "created_at": None,
            "updated_at": None,
            "error_message": None,
        }

    return {
        "status": record.status,
        "radar": _safe_json_loads(record.radar_json, None),
        "knowledge": _safe_json_loads(record.knowledge_json, []),
        "weaknesses": _safe_json_loads(record.weaknesses_text, []),
        "summary": _safe_json_loads(record.summary_json, _compute_summary_stats(db, identity)),
        "report_count": record.report_count,
        "trigger_type": record.trigger_type,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "updated_at": record.updated_at.isoformat() if record.updated_at else None,
        "error_message": record.error_message,
    }


def get_summary_stats(db, identity):
    return _compute_summary_stats(db, identity)


def analyze_user_reports(db, identity, trigger_type="auto"):
    """执行分析：聚合 → 调 LLM → 落库"""
    existing = _find_latest_analysis(db, identity)

    reports = _collect_recent_reports(db, identity)
    top_knowledge = _collect_top_knowledge(db, identity)
    summary = _compute_summary_stats(db, identity)

    if not reports:
        record = existing or InterviewReportAnalysis(
            tenant_id=identity.tenant_id,
            student_id=identity.user_id,
        )
        record.status = "ready"
        record.report_count = 0
        record.trigger_type = trigger_type
        record.radar_json = None
        record.knowledge_json = None
        record.weaknesses_text = json.dumps(["暂无面试数据，完成首场面试后会自动生成"], ensure_ascii=False)
        record.summary_json = json.dumps(summary, ensure_ascii=False)
        record.llm_meta_json = None
        record.error_message = None
        if existing is None:
            db.add(record)
        db.commit()
        return get_latest_analysis_payload(db, identity)

    target_role = reports[0].get("target_role")
    job_description = None
    last_session = db.scalar(
        select(InterviewSession)
        .where(InterviewSession.student_id == identity.user_id)
        .order_by(desc(InterviewSession.created_at))
        .limit(1)
    )
    if last_session:
        target_role = target_role or last_session.target_role
        job_description = last_session.job_description

    user_prompt = build_analysis_user_prompt(
        reports=reports,
        target_role=target_role,
        job_description=job_description,
        top_knowledge=top_knowledge,
    )

    fallback = build_fallback_analysis(reports, top_knowledge)
    preferred_model_id = _preferred_model_id_from_reports(db, identity)

    try:
        parsed, llm_meta = run_harnessed_json_generation(
            db,
            task_name="analyze_user_reports",
            system_prompt=ANALYSIS_SYSTEM_PROMPT,
            user_prompt=user_prompt,
            fallback=fallback,
            validator=_validate_analysis_output,
            identity=identity,
            preferred_model_id=preferred_model_id,
            temperature=0.3,
            max_tokens=2000,
            max_retries=2,
            max_total_seconds=40.0,
        )
    except Exception as exc:
        logger.exception("analyze_user_reports LLM 调用异常")
        parsed = fallback
        llm_meta = {"used": False, "model": None, "error": str(exc), "fallback_used": True}

    normalized = _normalize_analysis(parsed)

    record = existing or InterviewReportAnalysis(
        tenant_id=identity.tenant_id,
        student_id=identity.user_id,
    )
    record.status = "ready"
    record.report_count = len(reports)
    record.trigger_type = trigger_type
    record.radar_json = json.dumps(normalized["radar"], ensure_ascii=False)
    record.knowledge_json = json.dumps(normalized["knowledge"], ensure_ascii=False)
    record.weaknesses_text = json.dumps(normalized["weaknesses"], ensure_ascii=False)
    record.summary_json = json.dumps(summary, ensure_ascii=False)
    record.llm_meta_json = json.dumps(llm_meta, ensure_ascii=False)
    record.error_message = None
    if existing is None:
        db.add(record)
    db.commit()

    return get_latest_analysis_payload(db, identity)


def trigger_auto_analysis(db, identity):
    """自动触发入口：受 24h 节流控制"""
    existing = _find_latest_analysis(db, identity)
    if _cooldown_active(existing):
        return None
    return analyze_user_reports(db, identity, trigger_type="auto")
