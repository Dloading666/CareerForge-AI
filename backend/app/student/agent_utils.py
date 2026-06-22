"""Agent runtime utilities: effort config, temperature, fallback answers.

Extracted from agent_runtime.py for focused responsibility.
"""
from __future__ import annotations

import re as _re
from typing import Any

from app.admin.models import ModelConfig
from app.core.llm_client import is_anthropic_model


# ── Effort classification ──────────────────────────────────────────────────

_AUTO_LOW_PATTERNS = _re.compile(
    r"^(你好|hi|hello|hey|嗨|嗯|好的|ok|thanks|谢谢|感谢|在吗|在不在|你是谁|"
    r"你能做什么|help|帮助|测试|test|ping|帮|啥|怎么|什么|嗯嗯|哦|行|可以)[\s!！。.？?]*$",
    _re.IGNORECASE,
)

_AUTO_ACTION_KEYWORDS = {
    "帮我", "请", "优化", "生成", "修改", "改写", "添加", "删", "更新",
    "分析", "简历", "导出", "导入", "创建", "写", "润色", "翻译",
}

_AUTO_HIGH_KEYWORDS = {
    "差距分析", "gap分析", "岗位匹配", "JD匹配", "JD分析", "ATS优化",
    "全面优化", "整体优化", "重写简历", "重新生成", "从零开始",
    "多份简历", "对比分析", "岗位分析", "竞争分析", "求职策略",
    "订制", "针对岗位", " tailor", "customize",
}

_AUTO_XHIGH_KEYWORDS = {
    "全面改写", "彻底重写", "大改", "推倒重来", "重新设计",
    "多个岗位", "不同岗位", "批量优化", "系统性",
}


def auto_classify_effort(content: str, has_jd: bool = False, has_attachments: bool = False) -> str:
    """根据用户消息内容自动判断合适的思考程度。"""
    text = content.strip()
    if not text:
        return "medium"
    if _AUTO_LOW_PATTERNS.match(text):
        return "low"
    if len(text) < 8 and not any(kw in text for kw in _AUTO_ACTION_KEYWORDS):
        return "low"
    text_lower = text.lower()
    if any(kw in text_lower for kw in _AUTO_XHIGH_KEYWORDS):
        return "xhigh"
    if any(kw in text_lower for kw in _AUTO_HIGH_KEYWORDS):
        return "high"
    if has_jd:
        return "high"
    if has_attachments:
        return "high"
    if len(text) > 200:
        return "high"
    if any(kw in text for kw in _AUTO_ACTION_KEYWORDS):
        return "medium"
    return "medium"


def _effort_instruction(reasoning_effort: str) -> str:
    labels = {
        "low": "低。快速响应，给出简洁可执行建议。控制输出长度，直奔主题。",
        "medium": "中。平衡速度和质量，覆盖关键依据与下一步。",
        "high": "高。充分分析，补齐风险和细节，给出完整论据。",
        "xhigh": "超高。系统拆解、多角度验证，给出完整行动计划和备选方案。",
        "max": "极限。穷举所有角度，深度推理每一步，给出最全面的分析。",
    }
    return labels.get(reasoning_effort, labels["medium"])


# ── Model effort config ────────────────────────────────────────────────────

def get_model_effort_config(model: ModelConfig) -> dict:
    """返回模型的思考程度配置。"""
    mid = (model.model_identifier or "").lower()
    config: dict = {
        "supported_efforts": ["low", "medium", "high"],
        "effort_api_params": {},
        "reasoning_temp": None,
        "supports_api_effort": False,
    }

    if is_anthropic_model(model):
        config["reasoning_temp"] = 1.0
        if any(k in mid for k in ["opus-4-6", "opus-4.6", "sonnet-4-6", "sonnet-4.6"]):
            config["supported_efforts"] = ["low", "medium", "high", "max"]
            config["effort_api_params"] = {
                "low": {"thinking": {"type": "enabled", "budgetTokens": 4000}},
                "medium": {"thinking": {"type": "enabled", "budgetTokens": 10000}},
                "high": {"thinking": {"type": "enabled", "budgetTokens": 16000}},
                "max": {"thinking": {"type": "enabled", "budgetTokens": 31999}},
            }
        else:
            config["effort_api_params"] = {
                "low": {"thinking": {"type": "enabled", "budgetTokens": 4000}},
                "medium": {"thinking": {"type": "enabled", "budgetTokens": 10000}},
                "high": {"thinking": {"type": "enabled", "budgetTokens": 16000}},
            }
        return config

    if "gemini" in mid:
        config["reasoning_temp"] = 1.0
        if "2.5" in mid:
            budget_max = 32768 if ("pro" in mid and "flash" not in mid) else 24576
            config["supported_efforts"] = ["low", "medium", "high", "max"]
            config["effort_api_params"] = {
                "low": {"thinkingConfig": {"includeThoughts": True, "thinkingBudget": 4000}},
                "medium": {"thinkingConfig": {"includeThoughts": True, "thinkingBudget": 10000}},
                "high": {"thinkingConfig": {"includeThoughts": True, "thinkingBudget": 16000}},
                "max": {"thinkingConfig": {"includeThoughts": True, "thinkingBudget": budget_max}},
            }
        else:
            config["supported_efforts"] = ["low", "high"]
            config["effort_api_params"] = {
                "low": {"thinkingConfig": {"includeThoughts": True, "thinkingLevel": "low"}},
                "high": {"thinkingConfig": {"includeThoughts": True, "thinkingLevel": "high"}},
            }
        return config

    if "deepseek" in mid:
        config["supported_efforts"] = ["low", "medium", "high"]
        config["effort_api_params"] = {}
        config["supports_api_effort"] = False
        return config

    if "grok" in mid and "mini" in mid:
        config["supported_efforts"] = ["low", "high"]
        config["effort_api_params"] = {
            "low": {"reasoning_effort": "low"},
            "high": {"reasoning_effort": "high"},
        }
        config["supports_api_effort"] = True
        return config

    reasoning_tokens = ["o1", "o3", "o4", "gpt-5"]
    if any(token in mid for token in reasoning_tokens):
        config["supports_api_effort"] = True
        efforts = ["low", "medium", "high"]
        if any(k in mid for k in ["gpt-5", "o3", "o4"]):
            efforts.append("xhigh")
        config["supported_efforts"] = efforts
        config["effort_api_params"] = {e: {"reasoning_effort": e} for e in efforts}
        return config

    return config


_MODEL_TEMP_MAP = {
    "qwen": 0.55,
    "gemini": 1.0,
    "glm-4.6": 1.0,
    "glm-4.7": 1.0,
    "minimax-m2": 1.0,
    "kimi-k2": 0.6,
}


def get_model_default_temperature(model: ModelConfig) -> float:
    """按模型 ID 返回推荐的默认 temperature。"""
    if model.default_temp is not None:
        return model.default_temp
    mid = (model.model_identifier or "").lower()
    for key, temp in _MODEL_TEMP_MAP.items():
        if key in mid:
            return temp
    if is_anthropic_model(model):
        return 1.0
    return 0.7


def _supports_reasoning_effort(model: ModelConfig) -> bool:
    return get_model_effort_config(model).get("supports_api_effort", False)


def _supports_image_input(model: ModelConfig) -> bool:
    """Assume chat models are multimodal by default."""
    capability = (model.capability or "").lower()
    if capability in ("embedding", "rerank", "speech"):
        return False
    return True


# ── Fallback answers ───────────────────────────────────────────────────────

def _fallback_answer(user_text: str, observations: list[Any]) -> str:
    if observations:
        return "我已完成操作，请查看上方的工具执行结果。"
    return "抱歉，我暂时无法处理您的请求。请稍后再试，或联系管理员。"


def _configured_fallback_answer(config: Any, user_text: str) -> str:
    custom = getattr(config, "fallback_answer", None)
    if custom and custom.strip():
        return custom.strip()
    return _fallback_answer(user_text, [])


# ── Misc helpers ───────────────────────────────────────────────────────────

def _looks_like_jd(text: str) -> bool:
    """启发式判断用户消息是否包含 JD（≥150 字 + 2+ 个 JD 特征词）。"""
    if len(text) < 150:
        return False
    text_lower = text.lower()
    hits = sum(1 for w in _JD_FEATURE_WORDS if w in text_lower)
    return hits >= 2


_JD_FEATURE_WORDS = frozenset({
    "岗位职责", "任职要求", "职位要求", "职位描述", "学历要求", "工作经验",
    "技能要求", "岗位要求", "工作职责", "任职资格", "岗位说明",
    "job description", "requirements", "qualifications", "responsibilities",
})
