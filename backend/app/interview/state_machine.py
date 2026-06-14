"""Interview State Machine — 面试阶段状态机。

从 service.py 中抽取，使状态推进逻辑可独立测试。
"""
from __future__ import annotations

from typing import Any


# ── 面试阶段定义 ──────────────────────────────────────────────────────────────

STAGE_DEFINITIONS: dict[str, dict[str, str]] = {
    "opening": {"label": "开场", "goal": "确认目标岗位与面试类型，建立氛围"},
    "self_intro": {"label": "自我介绍", "goal": "考察候选人的自我认知和表达结构"},
    "resume_deep_dive": {"label": "简历深挖", "goal": "验证项目真实性、个人贡献和量化结果"},
    "technical_core": {"label": "核心技术", "goal": "考察岗位必备技术深度和原理理解"},
    "scenario": {"label": "场景题", "goal": "考察系统设计、业务理解和问题拆解能力"},
    "pressure": {"label": "压力追问", "goal": "考察抗压能力、证据意识和诚实度"},
    "reverse_question": {"label": "反问环节", "goal": "考察候选人对岗位和公司的思考深度"},
    "wrap_up": {"label": "收束复盘", "goal": "总结表现，给出改进方向"},
    "completed": {"label": "已完成", "goal": "面试结束"},
}

_STAGE_ORDER = ["opening", "self_intro", "resume_deep_dive", "technical_core", "scenario", "pressure", "reverse_question", "wrap_up"]


# ── 阶段计划 ──────────────────────────────────────────────────────────────────

def build_stage_plan(interview_type: str, round_limit: int, focus_tags: list[str]) -> list[dict]:
    """根据面试类型和轮次生成阶段计划。"""
    stages = [s for s in _STAGE_ORDER if s != "wrap_up"]
    if interview_type == "stress":
        stages = [s for s in stages if s != "self_intro"]
    if interview_type == "hr":
        stages = [s for s in stages if s not in ("technical_core", "pressure")]

    plan: list[dict] = []
    usable_rounds = max(1, round_limit - 1)
    per_stage = max(1, usable_rounds // len(stages))
    round_num = 1
    for i, stage in enumerate(stages):
        if i == len(stages) - 1:
            end = usable_rounds
        else:
            end = min(round_num + per_stage - 1, usable_rounds)
        rounds = list(range(round_num, end + 1))
        if rounds:
            plan.append({"stage": stage, "rounds": rounds})
        round_num = end + 1
    plan.append({"stage": "wrap_up", "rounds": [round_limit]})
    return plan


def stage_for_turn(stage_plan: list[dict], turn_index: int) -> str:
    """根据 turn_index 查找当前阶段。"""
    for entry in stage_plan:
        if turn_index in entry.get("rounds", []):
            return entry["stage"]
    return "opening"


# ── 覆盖度与质量 ──────────────────────────────────────────────────────────────

def update_coverage(coverage: dict, stage: str, knowledge_points: list[str], score: dict) -> dict:
    """更新阶段覆盖度统计。"""
    if stage not in coverage:
        coverage[stage] = {"turns": 0, "knowledge_points": [], "avg_score": 0, "scores": []}
    entry = coverage[stage]
    entry["turns"] += 1
    for kp in knowledge_points:
        if kp not in entry["knowledge_points"]:
            entry["knowledge_points"].append(kp)
    if isinstance(score, dict):
        vals = [v for v in score.values() if isinstance(v, (int, float))]
        if vals:
            entry["scores"].append(sum(vals) / len(vals))
            entry["avg_score"] = round(sum(entry["scores"]) / len(entry["scores"]), 1)
    return coverage


def compute_answer_quality(answer: str, score: dict | None, assessment: dict | None = None) -> tuple[float, bool, bool]:
    """计算回答质量指标。

    Returns:
        (quality_score, is_vague, lacks_depth)
        quality_score: 0-10 分，is_vague: 回答是否空泛，lacks_depth: 是否缺少深度
    """
    answer_len = len(answer.strip()) if answer else 0
    if answer_len < 30:
        base = 2.0
    elif answer_len < 80:
        base = 4.0
    elif answer_len < 200:
        base = 6.0
    else:
        base = 7.0
    is_vague = answer_len < 80
    lacks_depth = answer_len < 150
    if isinstance(score, dict):
        try:
            vals = [float(v) for v in score.values() if isinstance(v, (int, float))]
            if vals:
                avg = sum(vals) / len(vals)
                base = round((base + avg * 2) / 2, 1)
        except Exception:
            pass
    if isinstance(assessment, dict) and assessment.get("is_vague"):
        is_vague = True
        base = min(base, 4.0)
    return round(min(10, max(0, base)), 1), is_vague, lacks_depth


def update_quality_metrics(coverage: dict, stage: str, quality_score: float, is_vague: bool) -> dict:
    """在 coverage 中增加回答质量指标。"""
    if stage not in coverage:
        coverage[stage] = {"turns": 0, "knowledge_points": [], "avg_score": 0, "scores": [],
                           "quality_scores": [], "avg_quality": 0, "vague_count": 0}
    entry = coverage[stage]
    entry.setdefault("quality_scores", [])
    entry.setdefault("avg_quality", 0)
    entry.setdefault("vague_count", 0)
    entry["quality_scores"].append(quality_score)
    entry["avg_quality"] = round(sum(entry["quality_scores"]) / len(entry["quality_scores"]), 1)
    if is_vague:
        entry["vague_count"] += 1
    return coverage


# ── 阶段推进 ──────────────────────────────────────────────────────────────────

def advance_stage(
    current_stage: str,
    stage_plan: list[dict],
    turn_index: int,
    round_limit: int,
    coverage: dict,
    quality_score: float,
    is_vague: bool,
) -> str:
    """根据回答质量和阶段覆盖度决定是否推进阶段。"""
    if turn_index >= round_limit - 1:
        return "wrap_up"

    current_stage_idx = -1
    for i, entry in enumerate(stage_plan):
        if entry["stage"] == current_stage:
            current_stage_idx = i
            break

    if current_stage_idx < 0:
        return current_stage

    stage_coverage = coverage.get(current_stage, {})
    turns_in_stage = stage_coverage.get("turns", 0)
    avg_quality = stage_coverage.get("avg_quality", 5)
    consecutive_vague_count = stage_coverage.get("consecutive_vague_count", 0)

    if consecutive_vague_count >= 2 and turns_in_stage < 4:
        return current_stage

    if quality_score >= 7 and turns_in_stage >= 2:
        next_idx = current_stage_idx + 1
        if next_idx < len(stage_plan):
            return stage_plan[next_idx]["stage"]
        return current_stage

    if avg_quality >= 6 and turns_in_stage >= 3:
        next_idx = current_stage_idx + 1
        if next_idx < len(stage_plan):
            return stage_plan[next_idx]["stage"]
        return current_stage

    current_rounds = stage_plan[current_stage_idx].get("rounds", [])
    if current_rounds and turn_index > max(current_rounds):
        next_idx = current_stage_idx + 1
        if next_idx < len(stage_plan):
            return stage_plan[next_idx]["stage"]

    return current_stage


def should_skip_stage(stage: str, interview_type: str) -> bool:
    """判断某些阶段是否应该跳过。"""
    if stage == "self_intro" and interview_type == "stress":
        return True
    if stage == "technical_core" and interview_type == "hr":
        return True
    if stage == "pressure" and interview_type == "hr":
        return True
    return False


# ── wrap_up 校验 ──────────────────────────────────────────────────────────────

_WRAP_UP_QUESTION_TYPES = {"wrap_up", "self_review", "reflection", "summary", "closing", "reverse_question"}

_DEEP_DIVE_INDICATORS = [
    "算法", "数据结构", "系统设计", "手写", "实现一下", "代码实现",
    "时间复杂度", "空间复杂度", "设计模式", "源码", "底层原理",
    "分布式事务", "CAP 定理", "一致性哈希", "高并发", "压测",
    "请实现", "请写一个", "请设计", "请手撕",
]


def is_valid_wrap_up_question(question: str, question_type: str) -> bool:
    """判断 wrap_up 阶段的问题是否合法。"""
    if question_type not in _WRAP_UP_QUESTION_TYPES:
        return False
    q_lower = question.lower()
    for indicator in _DEEP_DIVE_INDICATORS:
        if indicator in q_lower:
            return False
    return True
