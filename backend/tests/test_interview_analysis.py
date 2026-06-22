"""面试报告智能分析 - 单元测试

覆盖：
- prompt 渲染（build_analysis_user_prompt / build_fallback_analysis）
- JSON 校验器（_validate_analysis_output）
- 归一化（_normalize_analysis）
- 安全 json 解析（_safe_json_loads）
"""
import json
import unittest

from app.interview.analysis_prompts import (
    RADAR_DIMENSIONS,
    RADAR_DIMENSION_LABELS,
    build_analysis_user_prompt,
    build_fallback_analysis,
)
from app.interview.analysis_service import (
    _normalize_analysis,
    _safe_json_loads,
    _validate_analysis_output,
)


class ValidateAnalysisOutputTests(unittest.TestCase):
    def test_valid_output_passes(self):
        output = {
            "radar": {k: 70 for k in RADAR_DIMENSIONS},
            "knowledge": [
                {"name": "Redis", "mastery": 80, "asked_count": 5, "avg_score": 80},
            ],
            "weaknesses": ["\u7b97\u6cd5 \u504f\u5f31", "\u7f16\u7801 \u504f\u5f31"],
        }
        errors = _validate_analysis_output(output, {})
        self.assertEqual(errors, [])

    def test_missing_radar_key(self):
        output = {
            "radar": {k: 70 for k in list(RADAR_DIMENSIONS)[:7]},
            "knowledge": [],
            "weaknesses": [],
        }
        errors = _validate_analysis_output(output, {})
        self.assertTrue(any("radar \u7f3a\u5c11" in e for e in errors), errors)

    def test_radar_out_of_range(self):
        output = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
        }
        output["radar"]["algorithm"] = 150
        errors = _validate_analysis_output(output, {})
        self.assertTrue(any("algorithm" in e for e in errors))

    def test_knowledge_not_list(self):
        output = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": "not a list",
            "weaknesses": [],
        }
        errors = _validate_analysis_output(output, {})
        self.assertIn("knowledge \u4e0d\u662f\u6570\u7ec4", errors)

    def test_weaknesses_not_strings(self):
        output = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": [],
            "weaknesses": [1, 2, 3],
        }
        errors = _validate_analysis_output(output, {})
        self.assertTrue(any("weaknesses" in e for e in errors))


class NormalizeAnalysisTests(unittest.TestCase):
    def test_normalize_fills_missing_radar(self):
        parsed = {"radar": {"algorithm": 85}, "knowledge": [], "weaknesses": []}
        result = _normalize_analysis(parsed)
        for key in RADAR_DIMENSIONS:
            self.assertIn(key, result["radar"])
        self.assertEqual(result["radar"]["algorithm"], 85)

    def test_normalize_clamps_values(self):
        parsed = {"radar": dict.fromkeys(RADAR_DIMENSIONS, 200), "knowledge": [], "weaknesses": []}
        result = _normalize_analysis(parsed)
        for v in result["radar"].values():
            self.assertLessEqual(v, 100)
            self.assertGreaterEqual(v, 0)

    def test_normalize_sorts_knowledge_by_mastery(self):
        parsed = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": [
                {"name": "A", "mastery": 50, "asked_count": 1, "avg_score": 50},
                {"name": "B", "mastery": 90, "asked_count": 1, "avg_score": 90},
                {"name": "C", "mastery": 70, "asked_count": 1, "avg_score": 70},
            ],
            "weaknesses": [],
        }
        result = _normalize_analysis(parsed)
        mastery_order = [k["mastery"] for k in result["knowledge"]]
        self.assertEqual(mastery_order, [90, 70, 50])

    def test_normalize_truncates_knowledge(self):
        parsed = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": [
                {"name": "k%d" % i, "mastery": 50, "asked_count": 1, "avg_score": 50}
                for i in range(15)
            ],
            "weaknesses": [],
        }
        result = _normalize_analysis(parsed)
        self.assertLessEqual(len(result["knowledge"]), 10)

    def test_normalize_drops_empty_knowledge_name(self):
        parsed = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": [
                {"name": "  ", "mastery": 50, "asked_count": 1, "avg_score": 50},
                {"name": "Redis", "mastery": 80, "asked_count": 1, "avg_score": 80},
            ],
            "weaknesses": [],
        }
        result = _normalize_analysis(parsed)
        self.assertEqual(len(result["knowledge"]), 1)
        self.assertEqual(result["knowledge"][0]["name"], "Redis")

    def test_normalize_truncates_weaknesses(self):
        parsed = {
            "radar": dict.fromkeys(RADAR_DIMENSIONS, 70),
            "knowledge": [],
            "weaknesses": ["w%d" % i for i in range(10)],
        }
        result = _normalize_analysis(parsed)
        self.assertLessEqual(len(result["weaknesses"]), 5)


class SafeJsonLoadsTests(unittest.TestCase):
    def test_none_returns_default(self):
        self.assertEqual(_safe_json_loads(None, []), [])

    def test_empty_returns_default(self):
        self.assertEqual(_safe_json_loads("", {}), {})

    def test_invalid_returns_default(self):
        self.assertEqual(_safe_json_loads("not json", {"x": 1}), {"x": 1})

    def test_valid_parses(self):
        self.assertEqual(_safe_json_loads('{"a": 1}', {}), {"a": 1})


class BuildAnalysisUserPromptTests(unittest.TestCase):
    def test_contains_target_role(self):
        reports = [{
            "target_role": "\u540e\u7aef\u5f00\u53d1",
            "interview_type": "first_round",
            "difficulty": "normal",
            "overall_score": 75.0,
            "dimension_scores": {"technical_accuracy": 70},
            "strengths": ["\u601d\u8def\u6e05\u6670"],
            "weaknesses": ["\u7f3a\u4e4f\u91cf\u5316"],
            "knowledge_points": ["Redis"],
        }]
        prompt = build_analysis_user_prompt(
            reports=reports,
            target_role="\u540e\u7aef\u5f00\u53d1",
            job_description="JD...",
            top_knowledge=[{"name": "Redis", "asked_count": 3, "avg_score": 75}],
        )
        self.assertIn("\u540e\u7aef\u5f00\u53d1", prompt)
        self.assertIn("Redis", prompt)
        self.assertIn("radar", prompt)
        self.assertIn("knowledge", prompt)
        self.assertIn("weaknesses", prompt)

    def test_handles_empty_reports(self):
        prompt = build_analysis_user_prompt(
            reports=[],
            target_role=None,
            job_description=None,
            top_knowledge=[],
        )
        self.assertIn("\u672a\u6307\u5b9a", prompt)
        self.assertIn("\u6682\u65e0\u77e5\u8bc6\u70b9\u6570\u636e", prompt)

    def test_handles_missing_optional_fields(self):
        reports = [{"target_role": "X", "interview_type": "first_round", "difficulty": "normal", "overall_score": 0, "dimension_scores": {}, "strengths": [], "weaknesses": [], "knowledge_points": []}]
        prompt = build_analysis_user_prompt(reports=reports, target_role="X", job_description="", top_knowledge=[])
        self.assertIn("\u76ee\u6807\u5c97\u4f4d: X", prompt)


class BuildFallbackAnalysisTests(unittest.TestCase):
    def test_default_radar_values(self):
        result = build_fallback_analysis([], [])
        for key in RADAR_DIMENSIONS:
            self.assertIn(key, result["radar"])
            self.assertGreaterEqual(result["radar"][key], 0)
            self.assertLessEqual(result["radar"][key], 100)

    def test_uses_reports_dimensions(self):
        reports = [{
            "target_role": "X",
            "interview_type": "first_round",
            "difficulty": "normal",
            "overall_score": 80,
            "dimension_scores": dict.fromkeys([
                "technical_accuracy", "project_evidence", "problem_solving",
                "communication", "job_fit", "pressure_handling"
            ], 80),
            "strengths": [],
            "weaknesses": [],
            "knowledge_points": [],
        }]
        result = build_fallback_analysis(reports, [])
        for v in result["radar"].values():
            self.assertGreaterEqual(v, 70)

    def test_weaknesses_filter_only_below_70(self):
        reports = [{
            "target_role": "X",
            "interview_type": "first_round",
            "difficulty": "normal",
            "overall_score": 50,
            "dimension_scores": dict.fromkeys([
                "technical_accuracy", "project_evidence", "problem_solving",
                "communication", "job_fit", "pressure_handling"
            ], 50),
            "strengths": [],
            "weaknesses": [],
            "knowledge_points": [],
        }]
        result = build_fallback_analysis(reports, [])
        self.assertGreater(len(result["weaknesses"]), 0)

    def test_knowledge_preserves_order(self):
        kn = [
            {"name": "A", "asked_count": 5, "avg_score": 70},
            {"name": "B", "asked_count": 3, "avg_score": 80},
        ]
        result = build_fallback_analysis([], kn)
        self.assertEqual(len(result["knowledge"]), 2)
        self.assertEqual(result["knowledge"][0]["name"], "A")

    def test_weaknesses_uses_chinese_labels(self):
        for key in RADAR_DIMENSIONS:
            self.assertIn(key, RADAR_DIMENSION_LABELS)
            self.assertGreater(len(RADAR_DIMENSION_LABELS[key]), 0)


class IntegrationTests(unittest.TestCase):
    def test_full_pipeline_with_valid_llm_output(self):
        llm_output = {
            "radar": {
                "algorithm": 65,
                "fundamentals": 78,
                "ai_specialty": 55,
                "ai_awareness": 72,
                "coding": 68,
                "communication": 80,
                "engineering": 70,
                "infrastructure": 60,
            },
            "knowledge": [
                {"name": "Redis \u7f13\u5b58", "mastery": 75, "asked_count": 3, "avg_score": 75},
                {"name": "\u5206\u5e03\u5f0f\u9501", "mastery": 45, "asked_count": 2, "avg_score": 45},
            ],
            "weaknesses": ["\u7b97\u6cd5 \u504f\u5f31\uff0865 \u5206\uff09"],
        }
        errors = _validate_analysis_output(llm_output, {})
        self.assertEqual(errors, [])
        normalized = _normalize_analysis(llm_output)
        self.assertEqual(len(normalized["radar"]), 8)
        self.assertEqual(len(normalized["knowledge"]), 2)
        self.assertEqual(len(normalized["weaknesses"]), 1)
        self.assertGreaterEqual(
            normalized["knowledge"][0]["mastery"],
            normalized["knowledge"][1]["mastery"],
        )

    def test_json_round_trip(self):
        original = {"radar": dict.fromkeys(RADAR_DIMENSIONS, 75), "knowledge": [], "weaknesses": []}
        encoded = json.dumps(original, ensure_ascii=False)
        decoded = _safe_json_loads(encoded, None)
        self.assertEqual(decoded, original)


if __name__ == "__main__":
    unittest.main()
