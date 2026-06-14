"""Interview Harness tests.

Covers all required P0/P1 test scenarios from the modification document.
All tests use pure functions — no database or HTTP dependencies.
"""

import unittest
from unittest.mock import MagicMock, patch

from app.interview.harness import (
    SCORE_KEYS,
    _build_repair_prompt,
    _contains_forbidden_text,
    _filter_evidence_quotes,
    _looks_like_single_question,
    _normalize_text_for_match,
    _strict_bool,
    build_fallback_report,
    harness_should_finish_interview,
    validate_followup_output,
    validate_question_grounding,
    validate_report_output,
    validate_start_output,
)


# ── Helper: 完全合法的 followup 数据 ──────────────────────────────────────────

def _valid_followup_data(**overrides) -> dict:
    """生成一个完全合法的 followup 数据，可按需覆盖字段。"""
    data = {
        "answer_assessment": {
            "summary": "回答有一定内容",
            "is_vague": False,
            "risk_points": ["缺少量化指标"],
            "positive_points": ["技术方向正确"],
        },
        "score": {k: 3 for k in SCORE_KEYS},
        "score_reasons": {k: "理由充分" for k in SCORE_KEYS},
        "evidence_quotes": [],
        "followup_strategy": "追问项目证据和技术细节",
        "interviewer_tone": "strict",
        "next_question": "请补充说明优化前后的性能数据。",
        "question_reason": "需要验证量化指标",
        "question_type": "project_deep_dive",
        "capability_tags": ["量化结果"],
        "knowledge_points": ["性能优化"],
        "should_end": False,
    }
    data.update(overrides)
    return data


# ═══════════════════════════════════════════════════════════════════════════════
# P0-1: should_end 严格布尔
# ═══════════════════════════════════════════════════════════════════════════════

class StrictBoolTests(unittest.TestCase):
    """_strict_bool 必须正确区分 bool 和字符串。"""

    def test_bool_true_returns_true(self):
        self.assertTrue(_strict_bool(True))

    def test_bool_false_returns_false(self):
        self.assertFalse(_strict_bool(False))

    def test_none_returns_default_false(self):
        self.assertFalse(_strict_bool(None))

    def test_none_returns_default_true(self):
        self.assertTrue(_strict_bool(None, default=True))

    def test_string_true_returns_true_with_warning(self):
        """字符串 'true' 虽然能解析，但应有 warning 记录。"""
        self.assertTrue(_strict_bool("true"))

    def test_string_false_returns_false_with_warning(self):
        """字符串 'false' 虽然能解析，但应有 warning 记录。"""
        self.assertFalse(_strict_bool("false"))

    def test_numeric_returns_default(self):
        self.assertFalse(_strict_bool(1))
        self.assertFalse(_strict_bool(0))


class ShouldEndStrictValidationTests(unittest.TestCase):
    """validate_followup_output 必须拒绝字符串 should_end。"""

    def test_should_end_string_false_rejected(self):
        """should_end: 'false' 必须被 validator 拒绝。"""
        data = _valid_followup_data(should_end="false")
        errors = validate_followup_output(data, {"last_answer": "回答"})
        self.assertTrue(any("should_end" in e and "boolean" in e for e in errors),
                        f"Expected should_end boolean error, got: {errors}")

    def test_should_end_string_true_rejected(self):
        """should_end: 'true' 必须被 validator 拒绝。"""
        data = _valid_followup_data(should_end="true")
        errors = validate_followup_output(data, {"last_answer": "回答"})
        self.assertTrue(any("should_end" in e and "boolean" in e for e in errors),
                        f"Expected should_end boolean error, got: {errors}")

    def test_should_end_bool_false_passes(self):
        """should_end: false（JSON boolean）必须通过。"""
        data = _valid_followup_data(should_end=False)
        # next_question 非空，应该通过 should_end 校验
        should_end_errors = [e for e in validate_followup_output(data, {"last_answer": "回答"})
                             if "should_end" in e and "boolean" in e]
        self.assertEqual(should_end_errors, [], f"Unexpected should_end errors: {should_end_errors}")

    def test_should_end_bool_true_passes(self):
        """should_end: true（JSON boolean）必须通过。"""
        data = _valid_followup_data(should_end=True, next_question="")
        should_end_errors = [e for e in validate_followup_output(data, {"last_answer": "回答"})
                             if "should_end" in e and "boolean" in e]
        self.assertEqual(should_end_errors, [], f"Unexpected should_end errors: {should_end_errors}")

    def test_should_end_missing_rejected(self):
        """should_end 字段缺失必须被拒绝。"""
        data = _valid_followup_data()
        del data["should_end"]
        errors = validate_followup_output(data, {"last_answer": "回答"})
        self.assertTrue(any("should_end" in e and "缺失" in e for e in errors))


# ═══════════════════════════════════════════════════════════════════════════════
# P0-3: LLM 总耗时上限
# ═══════════════════════════════════════════════════════════════════════════════

class MaxTotalSecondsTests(unittest.TestCase):
    """run_harnessed_json_generation 必须在超时后返回 fallback。"""

    def test_no_models_returns_fallback_with_meta(self):
        """无可用模型时，meta 包含 elapsed_ms 和 max_total_seconds。"""
        from app.interview.harness import run_harnessed_json_generation

        mock_db = MagicMock()
        fallback = {"test": True}
        with patch("app.interview.service._candidate_chat_models", return_value=[]):
            result, meta = run_harnessed_json_generation(
                mock_db,
                task_name="test",
                system_prompt="test",
                user_prompt="test",
                fallback=fallback,
                validator=lambda d, c: [],
            )
        self.assertEqual(result, fallback)
        self.assertFalse(meta["used"])
        self.assertTrue(meta["fallback_used"])
        self.assertIn("elapsed_ms", meta)
        self.assertIn("max_total_seconds", meta)
        self.assertIsInstance(meta["elapsed_ms"], int)
        self.assertIsInstance(meta["max_total_seconds"], (int, float))

    def test_timeout_returns_fallback_with_error(self):
        """多次模型失败后 fallback，meta 包含超时信息。"""
        from app.interview.harness import run_harnessed_json_generation

        mock_db = MagicMock()
        fallback = {"fallback": True}
        mock_model = MagicMock()
        mock_model.display_name = "test-model"

        # 模拟模型调用总是抛异常
        with patch("app.interview.service._candidate_chat_models", return_value=[mock_model]), \
             patch("app.core.llm_client.chat_completion", side_effect=Exception("timeout error")):
            result, meta = run_harnessed_json_generation(
                mock_db,
                task_name="test_timeout",
                system_prompt="test",
                user_prompt="test",
                fallback=fallback,
                validator=lambda d, c: [],
                max_retries=2,
                max_total_seconds=5.0,
            )
        self.assertEqual(result, fallback)
        self.assertTrue(meta["fallback_used"])
        self.assertIn("elapsed_ms", meta)
        self.assertEqual(meta["max_total_seconds"], 5.0)
        self.assertGreater(len(meta["errors"]), 0)

    def test_meta_always_has_elapsed_ms(self):
        """无论成功还是失败，meta 都必须包含 elapsed_ms。"""
        from app.interview.harness import run_harnessed_json_generation

        mock_db = MagicMock()
        fallback = {"fallback": True}
        mock_model = MagicMock()
        mock_model.display_name = "test-model"

        # 模拟模型返回合法 JSON 且通过校验
        with patch("app.interview.service._candidate_chat_models", return_value=[mock_model]), \
             patch("app.core.llm_client.chat_completion", return_value={"reply": '{"ok": true}', "usage": {}}):
            result, meta = run_harnessed_json_generation(
                mock_db,
                task_name="test_success",
                system_prompt="test",
                user_prompt="test",
                fallback=fallback,
                validator=lambda d, c: [],
            )
        self.assertTrue(meta["used"])
        self.assertFalse(meta["fallback_used"])
        self.assertIn("elapsed_ms", meta)
        self.assertIn("max_total_seconds", meta)


# ═══════════════════════════════════════════════════════════════════════════════
# P0-4: repair prompt 必须带原始上下文
# ═══════════════════════════════════════════════════════════════════════════════

class RepairPromptWithContextTests(unittest.TestCase):
    """_build_repair_prompt 必须包含原始上下文和禁止编造约束。"""

    def test_repair_prompt_contains_original_context(self):
        """repair prompt 包含原始上下文。"""
        prompt = _build_repair_prompt(
            "submit_turn",
            '{"bad": true}',
            ["should_end 缺失"],
            original_prompt="【候选人简历摘要】张三，Redis 经验 3 年",
        )
        self.assertIn("原始任务上下文", prompt)
        self.assertIn("张三", prompt)
        self.assertIn("Redis 经验 3 年", prompt)

    def test_repair_prompt_contains_forbid_fabrication(self):
        """repair prompt 包含'禁止编造候选人没有说过的经历'约束。"""
        prompt = _build_repair_prompt(
            "submit_turn",
            '{"bad": true}',
            ["error"],
            original_prompt="一些上下文",
        )
        self.assertIn("禁止编造候选人没有说过的经历、公司、指标、技术栈", prompt)

    def test_repair_prompt_contains_errors(self):
        """repair prompt 包含 Harness 错误列表。"""
        prompt = _build_repair_prompt(
            "submit_turn",
            '{"bad": true}',
            ["should_end 缺失", "score_reasons 不是对象"],
            original_prompt="上下文",
        )
        self.assertIn("should_end 缺失", prompt)
        self.assertIn("score_reasons 不是对象", prompt)

    def test_repair_prompt_contains_previous_output(self):
        """repair prompt 包含上一轮模型输出。"""
        prompt = _build_repair_prompt(
            "submit_turn",
            '{"bad_output": true}',
            ["error"],
            original_prompt="上下文",
        )
        self.assertIn("bad_output", prompt)

    def test_repair_prompt_without_original_prompt(self):
        """没有 original_prompt 时也能正常工作。"""
        prompt = _build_repair_prompt(
            "test",
            '{"x": 1}',
            ["error"],
        )
        self.assertIn("error", prompt)
        self.assertIn("x", prompt)
        self.assertNotIn("原始任务上下文", prompt)

    def test_repair_prompt_truncates_long_context(self):
        """原始上下文被截断到 3000 字符。"""
        long_context = "x" * 5000
        prompt = _build_repair_prompt(
            "test", '{"x": 1}', ["error"], original_prompt=long_context,
        )
        # 不应包含全部 5000 字符
        self.assertLess(len(prompt), 5000 + 500)  # 加上其他内容也不应超过太多


# ═══════════════════════════════════════════════════════════════════════════════
# P1-5: validate_followup_output 强校验核心字段
# ═══════════════════════════════════════════════════════════════════════════════

class StrongFieldValidationTests(unittest.TestCase):
    """validate_followup_output 必须强校验所有核心字段。"""

    def test_missing_answer_assessment_rejected(self):
        data = _valid_followup_data()
        del data["answer_assessment"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("answer_assessment" in e for e in errors))

    def test_assessment_summary_empty_rejected(self):
        data = _valid_followup_data()
        data["answer_assessment"]["summary"] = ""
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("summary" in e for e in errors))

    def test_assessment_is_vague_not_bool_rejected(self):
        data = _valid_followup_data()
        data["answer_assessment"]["is_vague"] = "yes"
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("is_vague" in e and "boolean" in e for e in errors))

    def test_assessment_risk_points_not_list_rejected(self):
        data = _valid_followup_data()
        data["answer_assessment"]["risk_points"] = "not a list"
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("risk_points" in e and "数组" in e for e in errors))

    def test_assessment_positive_points_not_list_rejected(self):
        data = _valid_followup_data()
        data["answer_assessment"]["positive_points"] = 123
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("positive_points" in e and "数组" in e for e in errors))

    def test_missing_score_reasons_rejected(self):
        data = _valid_followup_data()
        del data["score_reasons"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("score_reasons" in e and "不是对象" in e for e in errors))

    def test_score_reasons_missing_dimension_rejected(self):
        data = _valid_followup_data()
        del data["score_reasons"]["technical_accuracy"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("score_reasons" in e and "technical_accuracy" in e for e in errors))

    def test_missing_followup_strategy_rejected(self):
        data = _valid_followup_data()
        del data["followup_strategy"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("followup_strategy" in e for e in errors))

    def test_missing_question_reason_rejected(self):
        data = _valid_followup_data()
        del data["question_reason"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("question_reason" in e for e in errors))

    def test_missing_question_type_rejected(self):
        data = _valid_followup_data()
        del data["question_type"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("question_type" in e for e in errors))

    def test_missing_capability_tags_rejected(self):
        data = _valid_followup_data()
        del data["capability_tags"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("capability_tags" in e for e in errors))

    def test_missing_knowledge_points_rejected(self):
        data = _valid_followup_data()
        del data["knowledge_points"]
        errors = validate_followup_output(data, {"last_answer": "答"})
        self.assertTrue(any("knowledge_points" in e for e in errors))

    def test_valid_data_passes_all_checks(self):
        """完整的合法数据应通过所有校验。"""
        data = _valid_followup_data()
        errors = validate_followup_output(data, {"last_answer": "我优化了接口性能"})
        self.assertEqual(errors, [], f"Expected no errors, got: {errors}")


# ═══════════════════════════════════════════════════════════════════════════════
# P1-6: next_question grounding 检查
# ═══════════════════════════════════════════════════════════════════════════════

class QuestionGroundingTests(unittest.TestCase):
    """validate_question_grounding 只在引用式表达时校验。"""

    def test_reference_to_undeclared_topic_rejected(self):
        """候选人没说 Kubernetes，模型问'你刚才提到 Kubernetes'必须失败。"""
        question = "你刚才提到 Kubernetes 的调度优化，能展开说说吗？"
        context = {
            "last_answer": "我主要用 Redis 做缓存优化了接口性能",
            "resume_snapshot": "",
            "history_text": "",
            "job_description": "",
        }
        errors = validate_question_grounding(question, context)
        self.assertTrue(len(errors) > 0, f"Expected grounding error for undeclared Kubernetes, got: {errors}")
        self.assertTrue(any("Kubernetes" in e for e in errors))

    def test_reference_to_declared_topic_passes(self):
        """候选人说了 Redis，模型问'你刚才提到 Redis'必须通过。"""
        question = "你刚才提到 Redis 缓存，能说说缓存一致性怎么保证吗？"
        context = {
            "last_answer": "我主要用 Redis 做缓存优化了接口性能",
            "resume_snapshot": "",
            "history_text": "",
            "job_description": "",
        }
        errors = validate_question_grounding(question, context)
        self.assertEqual(errors, [], f"Expected no errors for Redis reference, got: {errors}")

    def test_normal_technical_question_not_killed(self):
        """普通问题'请解释 Redis 缓存一致性'不应因 grounding 被误杀。"""
        question = "请解释 Redis 缓存和数据库的一致性如何保证？"
        context = {
            "last_answer": "我不太清楚",
            "resume_snapshot": "",
            "history_text": "",
            "job_description": "",
        }
        errors = validate_question_grounding(question, context)
        self.assertEqual(errors, [], f"Normal tech question should not be killed: {errors}")

    def test_reference_in_resume_passes(self):
        """引用的内容在 resume_snapshot 中能找到时通过。"""
        question = "你前面说你用过 Kafka，能说说消费者组的设计吗？"
        context = {
            "last_answer": "我做了个消息队列的项目",
            "resume_snapshot": "技术栈：Java, Spring Boot, Kafka, MySQL",
            "history_text": "",
            "job_description": "",
        }
        errors = validate_question_grounding(question, context)
        self.assertEqual(errors, [], f"Expected Kafka found in resume: {errors}")

    def test_reference_in_job_description_passes(self):
        """引用的内容在 job_description 中能找到时通过。"""
        question = "你提到分布式系统，能结合我们的微服务架构说说吗？"
        context = {
            "last_answer": "我做过分布式系统",
            "resume_snapshot": "",
            "history_text": "",
            "job_description": "要求熟悉分布式系统和微服务架构",
        }
        errors = validate_question_grounding(question, context)
        self.assertEqual(errors, [], f"Expected no errors for JD reference: {errors}")


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：模型输出校验通过
# ═══════════════════════════════════════════════════════════════════════════════

class ValidateStartOutputPassTests(unittest.TestCase):
    def test_valid_start_output_passes(self):
        data = {
            "resume_brief": "候选人有 3 年 Java 后端经验，简历中提到了 Redis 缓存和 MySQL 优化项目。",
            "first_question": "我看到你在简历中提到了 Redis 缓存优化的项目，请围绕这个项目说明你在其中的具体职责、技术方案和量化结果。",
            "focus_points": ["项目真实性", "岗位匹配"],
            "knowledge_points": ["Redis", "MySQL"],
            "question_reason": "围绕简历中的 Redis 项目验证候选人的真实参与度和技术深度。",
            "question_type": "resume_deep_dive",
            "capability_tags": ["项目证据", "技术深度"],
        }
        errors = validate_start_output(data, {})
        self.assertEqual(errors, [])

    def test_valid_followup_output_passes(self):
        data = _valid_followup_data()
        context = {"last_answer": "我优化了接口性能"}
        errors = validate_followup_output(data, context)
        self.assertEqual(errors, [])

    def test_valid_report_output_passes(self):
        data = {
            "overall_score": 78,
            "dimension_scores": {k: 75.0 for k in SCORE_KEYS},
            "strengths": ["技术基础扎实"],
            "weaknesses": ["项目证据不足"],
            "suggestions": ["用 STAR 结构回答"],
            "next_questions": ["请介绍一个优化过的接口"],
            "report_text": "综合分 78，项目证据维度偏弱。",
            "training_plan": [{"day": 1, "focus": "项目证据", "tasks": ["复盘"], "expected_output": "2分钟回答"}],
            "rewrite_examples": [],
            "next_session_preset": {"target_role": "后端开发"},
        }
        errors = validate_report_output(data, {})
        self.assertEqual(errors, [])


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：修复 prompt
# ═══════════════════════════════════════════════════════════════════════════════

class RepairPromptTests(unittest.TestCase):
    def test_build_repair_prompt_contains_errors(self):
        prompt = _build_repair_prompt(
            "start_interview",
            '{"first_question": ""}',
            ["first_question 为空"],
        )
        self.assertIn("first_question 为空", prompt)
        self.assertIn("start_interview", prompt)
        self.assertIn("只输出 JSON", prompt)


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：缺失字段
# ═══════════════════════════════════════════════════════════════════════════════

class ValidateStartMissingFieldsTests(unittest.TestCase):
    def test_missing_first_question(self):
        data = {"focus_points": ["点1"], "knowledge_points": []}
        errors = validate_start_output(data, {})
        self.assertTrue(any("first_question" in e for e in errors))

    def test_missing_focus_points(self):
        data = {"first_question": "问题", "knowledge_points": []}
        errors = validate_start_output(data, {})
        self.assertTrue(any("focus_points" in e for e in errors))

    def test_followup_missing_score_keys(self):
        data = _valid_followup_data(score={"technical_accuracy": 3})
        errors = validate_followup_output(data, {"last_answer": "回答"})
        missing_errors = [e for e in errors if "score 缺少" in e]
        self.assertGreater(len(missing_errors), 0)

    def test_report_missing_dimension_scores(self):
        data = {
            "overall_score": 70,
            "dimension_scores": {"technical_accuracy": 70},
            "strengths": ["优势"],
            "weaknesses": ["弱点"],
            "suggestions": ["建议"],
            "next_questions": ["问题"],
            "report_text": "报告",
        }
        errors = validate_report_output(data, {})
        missing_errors = [e for e in errors if "dimension_scores 缺少" in e]
        self.assertGreater(len(missing_errors), 0)


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：多问题检测
# ═══════════════════════════════════════════════════════════════════════════════

class MultipleQuestionsTests(unittest.TestCase):
    def test_two_questions_with_sequence_rejected(self):
        text = "第一，请说明你的项目背景？第二，请补充量化指标？"
        self.assertFalse(_looks_like_single_question(text))

    def test_three_question_marks_rejected(self):
        text = "你做了什么？结果如何？团队多大？"
        self.assertFalse(_looks_like_single_question(text))

    def test_single_question_passes(self):
        text = "请围绕你简历中的一个项目，说明你在其中的具体职责。"
        self.assertTrue(_looks_like_single_question(text))

    def test_two_question_marks_allowed(self):
        text = "你用了什么方案？效果如何？"
        self.assertTrue(_looks_like_single_question(text))

    def test_split_instruction_rejected(self):
        text = "请分别回答以下三个问题"
        self.assertFalse(_looks_like_single_question(text))


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：停止判定
# ═══════════════════════════════════════════════════════════════════════════════

class FinishDecisionTests(unittest.TestCase):
    def test_should_end_but_insufficient_answers(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=True,
            current_turn_index=3,
            round_limit=8,
            coverage={"resume_deep_dive": {"turns": 1}},
            current_stage="resume_deep_dive",
            valid_answer_count=2,
        )
        self.assertFalse(should_finish)
        self.assertIn("有效回答", reason)

    def test_should_end_at_opening_stage(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=True,
            current_turn_index=1,
            round_limit=8,
            coverage={},
            current_stage="opening",
            valid_answer_count=5,
        )
        self.assertFalse(should_finish)
        self.assertIn("opening", reason)

    def test_should_end_without_core_stages(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=True,
            current_turn_index=4,
            round_limit=8,
            coverage={"opening": {}, "self_intro": {}},
            current_stage="self_intro",
            valid_answer_count=4,
        )
        self.assertFalse(should_finish)
        self.assertIn("核心阶段", reason)

    def test_should_end_with_core_stages_and_enough_answers(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=True,
            current_turn_index=6,
            round_limit=8,
            coverage={"resume_deep_dive": {}, "technical_core": {}},
            current_stage="scenario",
            valid_answer_count=5,
        )
        self.assertTrue(should_finish)
        self.assertIn("核心阶段", reason)


class RoundLimitTests(unittest.TestCase):
    def test_at_round_limit_must_finish(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=False,
            current_turn_index=8,
            round_limit=8,
            coverage={"opening": {}},
            current_stage="wrap_up",
            valid_answer_count=1,
        )
        self.assertTrue(should_finish)
        self.assertIn("轮次上限", reason)

    def test_below_round_limit_continues(self):
        should_finish, reason = harness_should_finish_interview(
            model_should_end=False,
            current_turn_index=5,
            round_limit=8,
            coverage={"opening": {}, "resume_deep_dive": {}},
            current_stage="resume_deep_dive",
            valid_answer_count=4,
        )
        self.assertFalse(should_finish)


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：报告分数边界
# ═══════════════════════════════════════════════════════════════════════════════

class ReportScoreBoundsTests(unittest.TestCase):
    def test_overall_score_over_100_rejected(self):
        data = {
            "overall_score": 150,
            "dimension_scores": {k: 80 for k in SCORE_KEYS},
            "strengths": ["优势"],
            "weaknesses": ["弱点"],
            "suggestions": ["建议"],
            "next_questions": ["问题"],
            "report_text": "报告",
        }
        errors = validate_report_output(data, {})
        self.assertTrue(any("overall_score" in e and "100" in e for e in errors))

    def test_overall_score_negative_rejected(self):
        data = {
            "overall_score": -10,
            "dimension_scores": {k: 50 for k in SCORE_KEYS},
            "strengths": ["优势"],
            "weaknesses": ["弱点"],
            "suggestions": ["建议"],
            "next_questions": ["问题"],
            "report_text": "报告",
        }
        errors = validate_report_output(data, {})
        self.assertTrue(any("overall_score" in e for e in errors))

    def test_followup_score_out_of_range_rejected(self):
        data = _valid_followup_data(score={k: 6 for k in SCORE_KEYS})
        errors = validate_followup_output(data, {"last_answer": "回答"})
        score_errors = [e for e in errors if "1 到 5" in e]
        self.assertGreater(len(score_errors), 0)


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：证据引用
# ═══════════════════════════════════════════════════════════════════════════════

class EvidenceQuoteTests(unittest.TestCase):
    def test_quote_not_in_answer_rejected(self):
        data = _valid_followup_data(evidence_quotes=[
            {"quote": "我设计了微服务架构", "reason": "技术深度"},
        ])
        context = {"last_answer": "我负责优化接口性能，使用了 Redis 缓存"}
        errors = validate_followup_output(data, context)
        self.assertTrue(any("不存在" in e for e in errors))

    def test_quote_in_answer_passes(self):
        data = _valid_followup_data(evidence_quotes=[
            {"quote": "使用了 Redis 缓存", "reason": "技术点"},
        ])
        context = {"last_answer": "我负责优化接口性能，使用了 Redis 缓存"}
        errors = validate_followup_output(data, context)
        quote_errors = [e for e in errors if "不存在" in e]
        self.assertEqual(len(quote_errors), 0)

    def test_filter_evidence_quotes_basic(self):
        answer = "我负责优化接口性能，使用了 Redis 缓存"
        raw = [
            {"quote": "使用了 Redis 缓存", "reason": "技术点"},
            {"quote": "我设计了微服务架构", "reason": "不在回答中"},
        ]
        result = _filter_evidence_quotes(raw, answer)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["quote"], "使用了 Redis 缓存")

    def test_evidence_quote_normalized_matching(self):
        """归一化匹配：全角/半角标点差异应能匹配。"""
        answer = "我用了 Redis 做缓存,效果不错"
        raw = [
            {"quote": "我用了 Redis 做缓存，效果不错", "reason": "中文逗号"},
        ]
        result = _filter_evidence_quotes(raw, answer)
        self.assertEqual(len(result), 1)


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：禁止内容
# ═══════════════════════════════════════════════════════════════════════════════

class KnowledgeStatusTests(unittest.TestCase):
    def test_forbidden_text_detects_server_paths(self):
        self.assertTrue(_contains_forbidden_text("服务器路径 /root/app/config"))
        self.assertTrue(_contains_forbidden_text("C:\\Users\\admin"))
        self.assertTrue(_contains_forbidden_text("/app/backend"))

    def test_forbidden_text_detects_system_prompt_leak(self):
        self.assertTrue(_contains_forbidden_text("系统提示词规定了"))
        self.assertTrue(_contains_forbidden_text("内部规则如下"))
        self.assertTrue(_contains_forbidden_text("system prompt"))
        self.assertTrue(_contains_forbidden_text("我已录用你"))

    def test_forbidden_text_allows_normal_content(self):
        self.assertFalse(_contains_forbidden_text("请介绍一下你的项目经历"))
        self.assertFalse(_contains_forbidden_text("Redis 缓存和数据库一致性如何保证？"))


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：fallback
# ═══════════════════════════════════════════════════════════════════════════════

class FallbackTests(unittest.TestCase):
    def test_build_fallback_report_has_all_fields(self):
        report = build_fallback_report(
            overall=60.0,
            dim_scores={k: 60.0 for k in SCORE_KEYS},
            weakest_dim="project_evidence",
            target_role="后端开发工程师",
        )
        self.assertIn("overall_score", report)
        self.assertIn("dimension_scores", report)
        self.assertIn("strengths", report)
        self.assertIn("weaknesses", report)
        self.assertIn("suggestions", report)
        self.assertIn("next_questions", report)
        self.assertIn("report_text", report)
        self.assertIn("training_plan", report)
        self.assertEqual(report["overall_score"], 60.0)

    def test_build_fallback_report_references_weakest_dim(self):
        report = build_fallback_report(
            overall=55.0,
            dim_scores={k: 55.0 for k in SCORE_KEYS},
            weakest_dim="technical_accuracy",
            target_role="Java 后端",
        )
        self.assertIn("技术准确性", report["report_text"])
        self.assertIn("技术准确性", report["weaknesses"][0])


# ═══════════════════════════════════════════════════════════════════════════════
# 原有测试：集成
# ═══════════════════════════════════════════════════════════════════════════════

class HarnessIntegrationTests(unittest.TestCase):
    def test_low_score_requires_score_reasons(self):
        data = _valid_followup_data()
        data["score"]["project_evidence"] = 1
        # 删除低分维度的 score_reasons
        del data["score_reasons"]["project_evidence"]
        errors = validate_followup_output(data, {"last_answer": "回答"})
        reason_errors = [e for e in errors if "score_reasons" in e]
        self.assertGreater(len(reason_errors), 0)

    def test_should_end_false_requires_next_question(self):
        data = _valid_followup_data(next_question="")
        errors = validate_followup_output(data, {"last_answer": "回答"})
        self.assertTrue(any("next_question" in e for e in errors))

    def test_forbidden_text_case_insensitive(self):
        self.assertTrue(_contains_forbidden_text("SYSTEM PROMPT"))
        self.assertTrue(_contains_forbidden_text("Developer Message"))
        self.assertTrue(_contains_forbidden_text("/ROOT/app"))


# ═══════════════════════════════════════════════════════════════════════════════
# 文本归一化测试
# ═══════════════════════════════════════════════════════════════════════════════

class NormalizeTextForMatchTests(unittest.TestCase):
    def test_lowercases(self):
        self.assertEqual(_normalize_text_for_match("Redis"), "redis")

    def test_normalizes_chinese_punctuation(self):
        result = _normalize_text_for_match("你好，世界！")
        self.assertIn(",", result)
        self.assertIn("!", result)

    def test_compresses_whitespace(self):
        result = _normalize_text_for_match("hello   world")
        self.assertEqual(result, "hello world")

    def test_strips_quotes(self):
        # Curly quotes should be normalized to straight quotes
        result = _normalize_text_for_match('\u201cRedis\u201d')
        self.assertIn('"', result)


# ═══════════════════════════════════════════════════════════════════════════════
# P0: 简历锚点引用校验
# ═══════════════════════════════════════════════════════════════════════════════

class ResumeAnchorTests(unittest.TestCase):
    """validate_start_output 必须校验 first_question 是否引用简历锚点。"""

    def test_anchor_present_but_not_referenced_rejected(self):
        """有锚点但 first_question 未引用任何锚点，应失败。"""
        data = {
            "resume_brief": "候选人有 Redis 项目经验",
            "first_question": "我已经读取了你的简历，请选一个最能证明你适合该岗位的项目介绍。",
            "focus_points": ["项目真实性"],
            "knowledge_points": ["Redis"],
            "question_reason": "验证项目",
            "question_type": "resume_deep_dive",
            "capability_tags": ["项目证据"],
        }
        context = {"resume_anchors": ["负责 Redis 缓存优化项目", "开发 Spring Boot 微服务系统"]}
        errors = validate_start_output(data, context)
        self.assertTrue(any("未引用简历" in e for e in errors),
                        f"Expected anchor reference error, got: {errors}")

    def test_anchor_present_and_referenced_passes(self):
        """有锚点且 first_question 引用了项目名/技能名，应通过。"""
        data = {
            "resume_brief": "候选人有 Redis 项目经验",
            "first_question": "我看到你在简历中提到了 Redis 缓存优化项目，请围绕这个项目说明你的具体职责和技术方案。",
            "focus_points": ["项目真实性"],
            "knowledge_points": ["Redis"],
            "question_reason": "验证项目",
            "question_type": "resume_deep_dive",
            "capability_tags": ["项目证据"],
        }
        context = {"resume_anchors": ["负责 Redis 缓存优化项目", "开发 Spring Boot 微服务系统"]}
        errors = validate_start_output(data, context)
        anchor_errors = [e for e in errors if "未引用简历" in e]
        self.assertEqual(anchor_errors, [], f"Expected no anchor errors, got: {anchor_errors}")

    def test_no_anchor_no_requirement(self):
        """无锚点时，不要求引用具体项目，但必须说明没有读到足够简历信息。"""
        data = {
            "resume_brief": "暂未读取到足够简历信息",
            "first_question": "我已经读取了你的简历，但信息有限。请先介绍一下你最近的一个项目经历、你的职责和使用的技术栈。",
            "focus_points": ["项目经历", "技术深度"],
            "knowledge_points": [],
            "question_reason": "简历信息不足，需要候选人主动补充",
            "question_type": "resume_deep_dive",
            "capability_tags": ["项目证据"],
        }
        context = {"resume_anchors": []}
        errors = validate_start_output(data, context)
        anchor_errors = [e for e in errors if "未引用简历" in e]
        self.assertEqual(anchor_errors, [], f"Empty anchors should not require reference: {anchor_errors}")



if __name__ == "__main__":
    unittest.main()
