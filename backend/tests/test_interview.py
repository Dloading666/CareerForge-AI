"""Interview module pure-function tests.

Covers the functions recommended in the modification document (Section 7).
All tests use pure functions — no database or HTTP dependencies.
"""

import unittest

from app.interview.service import (
    SCORE_KEYS,
    _build_fallback_training_plan,
    _build_stage_plan,
    _extract_job_skills,
    _filter_evidence_quotes,
    _normalize_score_reasons,
    _stage_for_turn,
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
        plan = _build_stage_plan("technical", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertIn("opening", stages)
        self.assertIn("wrap_up", stages)
        # wrap_up should be last
        self.assertEqual(stages[-1], "wrap_up")

    def test_stress_type_skips_self_intro(self):
        plan = _build_stage_plan("stress", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertNotIn("self_intro", stages)

    def test_hr_type_skips_technical_and_pressure(self):
        plan = _build_stage_plan("hr", 8, [])
        stages = [entry["stage"] for entry in plan]
        self.assertNotIn("technical_core", stages)
        self.assertNotIn("pressure", stages)

    def test_wrap_up_uses_last_round(self):
        plan = _build_stage_plan("technical", 10, [])
        wrap_up = next(e for e in plan if e["stage"] == "wrap_up")
        self.assertIn(10, wrap_up["rounds"])

    def test_minimum_rounds(self):
        plan = _build_stage_plan("technical", 3, [])
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
        self.assertEqual(_stage_for_turn(plan, 1), "opening")
        self.assertEqual(_stage_for_turn(plan, 2), "self_intro")
        self.assertEqual(_stage_for_turn(plan, 3), "resume_deep_dive")
        self.assertEqual(_stage_for_turn(plan, 4), "resume_deep_dive")
        self.assertEqual(_stage_for_turn(plan, 5), "wrap_up")

    def test_unknown_turn_returns_opening(self):
        plan = [{"stage": "opening", "rounds": [1]}]
        self.assertEqual(_stage_for_turn(plan, 99), "opening")

    def test_empty_plan_returns_opening(self):
        self.assertEqual(_stage_for_turn([], 1), "opening")


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

    def test_handles_non_dict_input(self):
        result = _normalize_score_reasons("invalid")
        for key in SCORE_KEYS:
            self.assertEqual(result[key], "本轮未提供足够证据。")

    def test_only_returns_score_keys(self):
        result = _normalize_score_reasons({"technical_accuracy": "ok", "extra_key": "ignored"})
        self.assertEqual(set(result.keys()), set(SCORE_KEYS))


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

    def test_limits_to_three(self):
        answer = "一二三四五六七八"
        raw = [{"quote": str(i), "reason": ""} for i in range(10)]
        # Only single-char quotes that match
        result = _filter_evidence_quotes(
            [{"quote": "一", "reason": ""}, {"quote": "二", "reason": ""}, {"quote": "三", "reason": ""}, {"quote": "四", "reason": ""}],
            answer,
        )
        self.assertLessEqual(len(result), 3)

    def test_handles_none_input(self):
        result = _filter_evidence_quotes(None, "some answer")
        self.assertEqual(result, [])

    def test_handles_non_list_input(self):
        result = _filter_evidence_quotes("invalid", "some answer")
        self.assertEqual(result, [])

    def test_discards_empty_quotes(self):
        result = _filter_evidence_quotes([{"quote": "", "reason": "empty"}], "some answer")
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
            self.assertIsInstance(day["tasks"], list)
            self.assertGreater(len(day["tasks"]), 0)

    def test_uses_dimension_label(self):
        plan = _build_fallback_training_plan("project_evidence")
        self.assertIn("项目证据", plan[0]["focus"])


if __name__ == "__main__":
    unittest.main()
