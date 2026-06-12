"""Report Generator — pure report generation, no DB session needed.

Extracted from service.py for testability.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.interview.exceptions import InterviewReportGenerationError
from app.interview.harness import (
    SCORE_KEYS,
    build_fallback_report,
    harness_should_finish_interview,
    validate_report_output,
)
from app.interview.prompts import (
    INTERVIEW_REPORT_SCORING_RUBRIC,
    INTERVIEW_REPORT_SUBPROMPT,
    REPORT_USER_PROMPT,
    SCORING_RUBRIC,
)

logger = logging.getLogger(__name__)


# ── 统一权重 ──────────────────────────────────────────────────────────────────

SCORE_WEIGHTS: dict[str, float] = {
    "technical_accuracy": 0.25,
    "project_evidence": 0.20,
    "problem_solving": 0.20,
    "communication": 0.15,
    "job_fit": 0.15,
    "pressure_handling": 0.05,
}


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


class ReportGenerator:
    """Generates interview reports without direct DB session management."""

    def __init__(self, llm_bridge: Any, interview_data: dict):
        self.llm_bridge = llm_bridge
        self.data = interview_data

    def validate_report_data(self) -> None:
        """Validate that all required data is present."""
        required = ["session", "turns", "scores", "dim_scores"]
        for field in required:
            if field not in self.data:
                raise InterviewReportGenerationError(f"Missing required data: {field}")

    def build_fallback_report(self) -> dict:
        """Build a fallback report when LLM fails."""
        dim_scores = self.data["dim_scores"]
        session = self.data["session"]
        weakest_dim = min(dim_scores, key=lambda k: dim_scores.get(k, 100))
        overall = self._weighted_overall(dim_scores)
        return build_fallback_report(
            overall=overall,
            dim_scores=dim_scores,
            weakest_dim=weakest_dim,
            target_role=session["target_role"],
        )

    def generate_with_llm(self, prompt: str, fallback: dict) -> tuple[dict, dict]:
        """Generate report using LLM with fallback chain."""
        from app.interview.harness import run_harnessed_json_generation
        from app.interview.prompts import INTERVIEW_SYSTEM_PROMPT

        models = self.llm_bridge.get("models", [])
        db = self.llm_bridge.get("db")
        identity = self.llm_bridge.get("identity")
        session = self.data["session"]
        if not models or not db:
            return fallback, {"used": False, "model": None, "fallback_used": True}
        from app.admin.models import ModelConfig as _MC
        parsed, llm_meta = run_harnessed_json_generation(
            db,
            task_name="generate_report",
            system_prompt=INTERVIEW_SYSTEM_PROMPT,
            user_prompt=prompt,
            fallback=fallback,
            validator=validate_report_output,
            identity=identity,
            preferred_model_id=session.get("model_config_id"),
            temperature=0.2,
            max_tokens=4200,
            max_retries=3,
        )
        return parsed, llm_meta

    def build_report(self) -> dict:
        """Main entry point: validate, generate, normalize, and return report data."""
        self.validate_report_data()
        scores = self.data["scores"]
        dim_scores = self.data["dim_scores"]
        session = self.data["session"]
        fallback = self.build_fallback_report()
        fallback["overall_score"] = self._weighted_overall(dim_scores)

        turns = self.data["turns"]
        coverage = self.data.get("coverage", {})

        coverage_summary = ""
        if coverage:
            from app.interview.service import STAGE_DEFINITIONS
            lines = []
            for stage_key, info in coverage.items():
                label = STAGE_DEFINITIONS.get(stage_key, {}).get("label", stage_key)
                lines.append(f"  {label}: {info.get('turns', 0)} 轮, 平均分 {info.get('avg_score', 0)}")
            coverage_summary = "\n【阶段覆盖度】\n" + "\n".join(lines)

        from app.interview.service import _render_template, _conversation_history
        prompt = _render_template(
            REPORT_USER_PROMPT,
            {
                "scoring_rubric_block": SCORING_RUBRIC,
                "task_subprompt": INTERVIEW_REPORT_SUBPROMPT,
                "target_role": session["target_role"],
                "job_description": session.get("job_description") or "未提供",
                "resume_snapshot": (session.get("resume_snapshot") or "未提供")[:12000],
                "conversation_history": _conversation_history(turns),
                "context_block": f"【目标岗位】{session['target_role']}\n【岗位 JD】{session.get('job_description') or '未提供'}\n【简历快照】{(session.get('resume_snapshot') or '未提供')[:12000]}",
                "turn_scores": json.dumps(scores, ensure_ascii=False) + coverage_summary,
            },
        )
        parsed, llm_meta = self.generate_with_llm(prompt, fallback)
        final_dim_scores = _normalize_report_dimensions(parsed.get("dimension_scores"), dim_scores)
        try:
            model_overall = float(parsed.get("overall_score"))
        except Exception:
            model_overall = self._weighted_overall(final_dim_scores)
        final_overall = round(max(0, min(100, model_overall)), 1)
        weighted_overall = self._weighted_overall(final_dim_scores)
        if abs(final_overall - weighted_overall) > 8:
            final_overall = weighted_overall

        report_text = str(parsed.get("report_text") or fallback["report_text"])
        if not llm_meta.get("used"):
            report_text += "\n\n本次模型评分服务暂时不可用，系统已按同一套评分 Rubric 做本地兜底；建议模型服务恢复后重新生成报告。"

        return {
            "overall_score": final_overall,
            "dimension_scores": final_dim_scores,
            "strengths": parsed.get("strengths") or fallback["strengths"],
            "weaknesses": parsed.get("weaknesses") or fallback["weaknesses"],
            "suggestions": parsed.get("suggestions") or fallback["suggestions"],
            "next_questions": parsed.get("next_questions") or fallback["next_questions"],
            "report_text": report_text,
            "training_plan": parsed.get("training_plan") or fallback["training_plan"],
            "rewrite_examples": parsed.get("rewrite_examples") or fallback.get("rewrite_examples", []),
            "next_session_preset": parsed.get("next_session_preset") or fallback["next_session_preset"],
            "llm_meta": llm_meta,
        }

    def _weighted_overall(self, dim_scores: dict[str, Any]) -> float:
        return _weighted_overall(dim_scores)
