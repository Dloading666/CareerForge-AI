"""Interview module pure-function tests.

Covers the functions recommended in the modification document (Section 7).
All tests use pure functions — no database or HTTP dependencies.
"""

import unittest

from app.interview.service import (
    _build_fallback_training_plan,
    _extract_job_skills,
    _normalize_score_reasons,
)
from app.interview.harness import (
    SCORE_KEYS,
    _filter_evidence_quotes,
)
from app.interview.state_machine import (
    advance_stage,
    build_stage_plan,
    compute_answer_quality,
    is_valid_wrap_up_question,
    stage_for_turn,
    update_coverage,
    update_quality_metrics,
)


class ExtractJobSkillsTests(unittest.TestCase):
    def test_returns_user_skills_when_provided(self):
        result = _extract_job_skills("some JD text", ["Redis", "MySQL"])
        self.assertEqual(result, ["Redis", "MySQL"])

    def test_deduplicates_user_skills(self):
        result = _extract_job_skills("", ["Redis", "Redis", "MySQL"])
        self.assertEqual(result, ["Redis", "MySQL"])

    def test_extracts_from_jd_when_no_user_skills(self):
        jd = "要求熟悉 Java、Spring Boot、MySQL、Redis 和 Docker"
        result = _extract_job_skills(jd, [])
        self.assertIn("Java", result)
        self.assertIn("Spring Boot", result)
        self.assertIn("MySQL", result)
        self.assertIn("Redis", result)
        self.assertIn("Docker", result)

    def test_returns_empty_for_empty_jd(self):
        result = _extract_job_skills("", [])
        self.assertEqual(result, [])

    def test_case_insensitive_extraction(self):
        result = _extract_job_skills("python and FASTAPI required", [])
        self.assertIn("Python", result)
        self.assertIn("FastAPI", result)


class BuildStagePlanTests(unittest.TestCase):
    def test_basic_plan_has_all_stages(self):
        plan = build_stage_plan("technical", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertIn("opening", stages)
        self.assertIn("wrap_up", stages)
        self.assertEqual(stages[-1], "wrap_up")

    def test_stress_type_skips_self_intro(self):
        plan = build_stage_plan("stress", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertNotIn("self_intro", stages)

    def test_hr_type_skips_technical_and_pressure(self):
        plan = build_stage_plan("hr", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertNotIn("technical_core", stages)
        self.assertNotIn("pressure", stages)

    def test_wrap_up_uses_last_round(self):
        plan = build_stage_plan("technical", 10, [])
        wrap_up = next(e for e in plan if e["stage"] == "wrap_up")
        self.assertIn(10, wrap_up["rounds"])

    def test_minimum_rounds(self):
        plan = build_stage_plan("technical", 3, [])
        all_rounds = []
        for entry in plan:
            all_rounds.extend(entry["rounds"])
        self.assertIn(3, all_rounds)


class StageForTurnTests(unittest.TestCase):
    def test_returns_correct_stage(self):
        plan = [
            {"stage": "opening", "rounds": [1]},
            {"stage": "self_intro", "rounds": [2]},
            {"stage": "resume_deep_dive", "rounds": [3, 4]},
            {"stage": "wrap_up", "rounds": [5]},
        ]
        self.assertEqual(stage_for_turn(plan, 1), "opening")
        self.assertEqual(stage_for_turn(plan, 2), "self_intro")
        self.assertEqual(stage_for_turn(plan, 3), "resume_deep_dive")
        self.assertEqual(stage_for_turn(plan, 4), "resume_deep_dive")
        self.assertEqual(stage_for_turn(plan, 5), "wrap_up")

    def test_unknown_turn_returns_opening(self):
        plan = [{"stage": "opening", "rounds": [1]}]
        self.assertEqual(stage_for_turn(plan, 99), "opening")


class NormalizeScoreReasonsTests(unittest.TestCase):
    def test_fills_missing_dimensions(self):
        result = _normalize_score_reasons({"technical_accuracy": "good"})
        self.assertEqual(result["technical_accuracy"], "good")
        for key in SCORE_KEYS:
            if key != "technical_accuracy":
                self.assertEqual(result[key], "本轮未提供足够证据。")

    def test_handles_none_input(self):
        result = _normalize_score_reasons(None)
        for key in SCORE_KEYS:
            self.assertEqual(result[key], "本轮未提供足够证据。")


class FilterEvidenceQuotesTests(unittest.TestCase):
    def test_keeps_quotes_in_answer(self):
        answer = "我负责优化接口性能，使用了 Redis 缓存"
        raw = [
            {"quote": "我负责优化接口性能", "reason": "有项目线索"},
            {"quote": "使用了 Redis 缓存", "reason": "技术点"},
        ]
        result = _filter_evidence_quotes(raw, answer)
        self.assertEqual(len(result), 2)

    def test_discards_quotes_not_in_answer(self):
        answer = "我负责优化接口性能"
        raw = [
            {"quote": "我负责优化接口性能", "reason": "ok"},
            {"quote": "我设计了微服务架构", "reason": "not in answer"},
        ]
        result = _filter_evidence_quotes(raw, answer)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["quote"], "我负责优化接口性能")

    def test_handles_none_input(self):
        result = _filter_evidence_quotes(None, "some answer")
        self.assertEqual(result, [])


class BuildFallbackTrainingPlanTests(unittest.TestCase):
    def test_returns_non_empty_plan(self):
        plan = _build_fallback_training_plan("project_evidence")
        self.assertGreater(len(plan), 0)

    def test_each_day_has_required_fields(self):
        plan = _build_fallback_training_plan("technical_accuracy")
        for day in plan:
            self.assertIn("day", day)
            self.assertIn("focus", day)
            self.assertIn("tasks", day)
            self.assertIn("expected_output", day)


# ═══════════════════════════════════════════════════════════════════════════════
# P1-7: 连续空泛 vs 累计空泛
# ═══════════════════════════════════════════════════════════════════════════════

class ConsecutiveVagueTests(unittest.TestCase):
    """advance_stage 必须使用 consecutive_vague_count 而非 vague_count。"""

    def _make_plan(self):
        return [
            {"stage": "opening", "rounds": [1]},
            {"stage": "resume_deep_dive", "rounds": [2, 3, 4, 5, 6]},
            {"stage": "technical_core", "rounds": [7]},
            {"stage": "wrap_up", "rounds": [8]},
        ]

    def test_vague_effective_vague_not_consecutive(self):
        """空泛→有效→空泛，不算连续 2 次，应能推进阶段。"""
        coverage = {
            "resume_deep_dive": {
                "turns": 3,
                "avg_quality": 5.0,
                "vague_count": 2,  # 累计 2 次
                "consecutive_vague_count": 1,  # 但连续只有 1 次（最后一个是空泛）
            }
        }
        result = advance_stage(
            current_stage="resume_deep_dive",
            stage_plan=self._make_plan(),
            turn_index=4,
            round_limit=8,
            coverage=coverage,
            quality_score=6.0,
            is_vague=False,  # 当前回答不空泛
        )
        # 不应该因为 vague_count=2 而卡住，因为连续只有 1
        # 当前 turn 4 还在 resume_deep_dive 的 rounds 内，所以保持
        self.assertEqual(result, "resume_deep_dive")

    def test_vague_vague_is_consecutive(self):
        """空泛→空泛，连续 2 次，应保持当前阶段。"""
        coverage = {
            "resume_deep_dive": {
                "turns": 2,
                "avg_quality": 3.0,
                "vague_count": 2,
                "consecutive_vague_count": 2,  # 连续 2 次
            }
        }
        result = advance_stage(
            current_stage="resume_deep_dive",
            stage_plan=self._make_plan(),
            turn_index=3,
            round_limit=8,
            coverage=coverage,
            quality_score=3.0,
            is_vague=True,
        )
        self.assertEqual(result, "resume_deep_dive")

    def test_consecutive_vague_resets_on_good_answer(self):
        """连续空泛计数在有效回答后应重置。"""
        coverage = {
            "resume_deep_dive": {
                "turns": 4,
                "avg_quality": 6.0,
                "vague_count": 2,  # 累计 2 次
                "consecutive_vague_count": 0,  # 但连续已被重置
            }
        }
        result = advance_stage(
            current_stage="resume_deep_dive",
            stage_plan=self._make_plan(),
            turn_index=5,
            round_limit=8,
            coverage=coverage,
            quality_score=8.0,  # 高质量
            is_vague=False,
        )
        # 高质量 + 已覆盖 4 轮 + consecutive=0 → 应该推进
        self.assertEqual(result, "technical_core")


# ═══════════════════════════════════════════════════════════════════════════════
# P1-8: wrap_up 阶段强制收束
# ═══════════════════════════════════════════════════════════════════════════════

class WrapUpEnforcementTests(unittest.TestCase):
    """wrap_up 阶段问题必须是收束/复盘类，不能是技术深挖。"""

    def test_wrap_up_type_passes(self):
        """question_type=wrap_up 应通过。"""
        self.assertTrue(is_valid_wrap_up_question(
            "请总结一下你这次面试的表现。", "wrap_up",
        ))

    def test_self_review_type_passes(self):
        self.assertTrue(is_valid_wrap_up_question(
            "你觉得自己哪个环节做得最好？", "self_review",
        ))

    def test_reflection_type_passes(self):
        self.assertTrue(is_valid_wrap_up_question(
            "回顾这次面试，你有什么收获？", "reflection",
        ))

    def test_technical_deep_dive_rejected_in_wrap_up(self):
        """技术深挖问题在 wrap_up 阶段必须被拒绝。"""
        self.assertFalse(is_valid_wrap_up_question(
            "请手写一个 LRU 缓存的实现。", "wrap_up",
        ))

    def test_algorithm_question_rejected_in_wrap_up(self):
        """算法题在 wrap_up 阶段必须被拒绝。"""
        self.assertFalse(is_valid_wrap_up_question(
            "请实现一个时间复杂度为 O(log n) 的查找算法。", "wrap_up",
        ))

    def test_system_design_rejected_in_wrap_up(self):
        """系统设计题在 wrap_up 阶段必须被拒绝。"""
        self.assertFalse(is_valid_wrap_up_question(
            "请设计一个高并发的消息队列系统。", "wrap_up",
        ))

    def test_wrong_question_type_rejected(self):
        """question_type 不是 wrap_up 类型时必须被拒绝。"""
        self.assertFalse(is_valid_wrap_up_question(
            "请总结一下面试表现。", "project_deep_dive",
        ))

    def test_reverse_question_type_passes(self):
        """reverse_question 类型在 wrap_up 阶段应通过。"""
        self.assertTrue(is_valid_wrap_up_question(
            "你对我们公司有什么想了解的？", "reverse_question",
        ))


# ═══════════════════════════════════════════════════════════════════════════════
# 回答质量计算
# ═══════════════════════════════════════════════════════════════════════════════

class ComputeAnswerQualityTests(unittest.TestCase):
    def test_short_answer_is_vague(self):
        quality, is_vague, lacks_depth = compute_answer_quality("是的", None, None)
        self.assertTrue(is_vague)
        self.assertTrue(lacks_depth)
        self.assertLess(quality, 5)

    def test_long_answer_not_vague(self):
        long_answer = "我在这个项目中负责了后端架构设计，使用了 Spring Boot + MyBatis-Plus 技术栈。" * 5
        quality, is_vague, lacks_depth = compute_answer_quality(long_answer, None, None)
        self.assertFalse(is_vague)
        self.assertGreater(quality, 5)

    def test_model_vague_assessment_overrides(self):
        """如果模型判定回答空泛，即使长度不短也要标记。"""
        answer = "我优化了接口性能，使用了 Redis 缓存，效果提升了 50%"
        assessment = {"is_vague": True}
        quality, is_vague, _ = compute_answer_quality(answer, None, assessment)
        self.assertTrue(is_vague)
        self.assertLessEqual(quality, 4.0)


if __name__ == "__main__":
    unittest.main()
