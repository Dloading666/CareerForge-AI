"""Agent runtime utilities: effort config, temperature, fallback answers.

Extracted from agent_runtime.py for focused responsibility.
"""
from __future__ import annotations

import re as _re
from dataclasses import dataclass, field
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


# ── Intent classification ──────────────────────────────────────────────────
#
# classify_intent 把用户消息归类为 7 种意图模式（与评测集文档对齐）：
#   create  从零生成新简历
#   refine  整体优化已有简历（含针对 JD 订制）
#   patch   局部增删改某段/某字段
#   style   改语气/措辞/排版，不改事实
#   enrich  补充量化/成果
#   export  导出 PDF
#   chat    闲聊/提供信息/提问（不该直接改简历）
#
# is_directive 标记「明确指令」——与 _harness_system_prompt 的「先说后做」行动准则
# 对齐：明确指令应直接动手，闲聊/提供信息应先复述确认。recommended_effort 是意图
# 层面的推荐思考程度，auto_classify_effort 现在派生自它（消除两套关键词表）。

# 导出意图关键词（无论有无简历，导出动作都很明确）
_INTENT_EXPORT_KEYWORDS = {
    "导出", "下载pdf", "下载简历", "生成pdf", "转成pdf", "导成pdf", "打印简历",
}

# 从零生成意图关键词（生成全新简历，不依赖已有简历）
_INTENT_CREATE_KEYWORDS = {
    "做一份", "写一份", "生成一份", "创建一份", "新建一份", "帮我做简历",
    "帮我写简历", "帮我生成简历", "帮我创建简历", "做份简历", "写份简历",
    "从零", "从无到有", "没简历", "还没有简历", "第一份简历",
}

# 整体优化/订制意图关键词（针对已有简历做全局性改写）
_INTENT_REFINE_KEYWORDS = {
    "优化简历", "优化一下", "优化我的", "订制", "针对岗位", "针对这个岗位",
    "针对jd", "tailor", "customize", "ats优化", "全面优化", "整体优化",
    "重写简历", "重新生成", "岗位匹配", "jd匹配", "jd分析", "差距分析",
    "竞争分析", "求职策略",
}

# 局部 patch 意图关键词（增删改某段/某字段，不重写整体）
_INTENT_PATCH_KEYWORDS = {
    "加进去", "加上去", "加到", "加进简历", "添加", "补充", "删掉", "删除",
    "去掉", "改成", "修改", "改一下", "改一下简历", "调整", "更新简历",
    "更新一下", "加入", "插进", "替换", "换成",
}

# 风格/措辞意图关键词（不改事实，只改表达）
_INTENT_STYLE_KEYWORDS = {
    "润色", "语气", "措辞", "正式一点", "口语一点", "简洁一点", "精简",
    "排版", "格式调整", "换个说法", "改写一下", "表达", "更专业",
}

# 补充量化意图关键词（在已有内容上加数字/成果）
_INTENT_ENRICH_KEYWORDS = {
    "加数字", "加指标", "量化", "补充数字", "补充指标", "加成果",
    "量化成果", "数据指标", "可量化", "数字成果", "加一些数字", "加些数字",
    "加结果", "补充结果", "数字指标",
}

# 明确指令的确认短语（即使简短，也构成「直接动手」的信号）
_DIRECTIVE_CONFIRMATIONS = {
    "改吧", "改吧。", "加进去", "加吧", "好的就这样", "好的就这样改",
    "行，直接更新", "行，改吧", "好，更新", "就这样改", "确认", "确定了",
    "直接改", "直接更新", "直接加", "直接删", "可以了，改吧",
}

# 提供信息/闲聊的信号词（出现且无动作动词时，倾向 chat）
_CHAT_INFO_SIGNALS = {
    "我做过", "我之前", "我还有", "我还会", "我参与过", "我在", "我的经历",
    "要不要", "需要吗", "可以吗", "行不行", "怎么办", "为什么",
}


@dataclass
class IntentClassification:
    """单条用户消息的意图分类结果。"""

    mode: str  # create / refine / patch / style / enrich / export / chat
    is_directive: bool  # 是否构成「明确指令」（应直接动手，不再追问）
    recommended_effort: str  # low / medium / high / xhigh / max
    confidence: float = 0.7  # 0-1，规则匹配的把握度
    plan_steps: list[str] = field(default_factory=list)

    def __str__(self) -> str:  # pragma: no cover - 调试用
        return f"Intent(mode={self.mode}, directive={self.is_directive}, effort={self.recommended_effort})"


# 意图 → 典型步骤预告（P2.2 runtime.steps_plan）
# 用人话描述每一步，让用户在 AI 动手前知道整体计划。
# chat 意图无步骤（只是对话）。
_INTENT_PLAN_STEPS: dict[str, list[str]] = {
    "create": [
        "读取你的个人档案",
        "根据岗位要求生成简历",
    ],
    "refine": [
        "读取当前简历",
        "分析岗位匹配度",
        "优化并保存新版本",
    ],
    "patch": [
        "读取当前简历",
        "修改指定内容",
        "Review 修改质量",
        "保存修改",
    ],
    "style": [
        "读取当前简历",
        "调整措辞和表达",
        "Review 修改质量",
        "保存修改",
    ],
    "enrich": [
        "读取当前简历",
        "补充量化成果",
        "Review 修改质量",
        "保存修改",
    ],
    "export": [
        "读取当前简历",
        "生成 PDF",
    ],
    "chat": [],  # 纯对话无步骤预告
}


def intent_plan_steps(mode: str) -> list[str]:
    """返回某意图模式的典型步骤预告（用于 runtime.steps_plan 事件）。"""
    return list(_INTENT_PLAN_STEPS.get(mode, []))


def _text_has_any(text: str, text_lower: str, keywords: set[str]) -> bool:
    """同时支持中英文敏感的子串匹配（英文走小写化集合）。"""
    # 英文/混排关键词用小写比对；纯中文关键词直接子串比对即可（不区分也无妨）。
    lower_set = {kw.lower() for kw in keywords}
    return any(kw in text_lower for kw in lower_set)


def classify_intent(
    content: str,
    *,
    has_resume: bool = False,
    has_jd: bool = False,
    has_attachments: bool = False,
) -> IntentClassification:
    """把用户消息归类为 7 种意图模式之一。

    参数：
        content: 用户消息原文。
        has_resume: 当前是否已绑定工作简历（影响 refine/patch/style 的判别——
            这些模式只在有简历时才成立，否则降级为 create 或 chat）。
        has_jd: 当前会话是否已有 JD（影响 refine 的订制判定）。
        has_attachments: 是否带附件（附件本身不改变意图，但会提升 effort）。
    """
    text = (content or "").strip()

    # 空文本 + 有附件（如纯图片）→ 视为明确的分析/操作指令，不是闲聊
    if not text and has_attachments:
        if has_resume:
            return IntentClassification(mode="refine", is_directive=True, recommended_effort="medium", confidence=0.7)
        return IntentClassification(mode="create", is_directive=True, recommended_effort="medium", confidence=0.7)

    if not text:
        return IntentClassification(mode="chat", is_directive=False, recommended_effort="low", confidence=0.4)

    text_lower = text.lower()

    # 1. 闲聊/打招呼短句优先识别（最长匹配前的快速路径，避免「你好」被判为 patch）
    if _AUTO_LOW_PATTERNS.match(text):
        return IntentClassification(mode="chat", is_directive=False, recommended_effort="low", confidence=0.9)

    # 2. 明确指令确认短语（短但强指令）—— 但需要结合 has_resume，否则"改吧"没有对象
    is_confirmation = text in _DIRECTIVE_CONFIRMATIONS or any(
        text.startswith(c) and len(text) <= len(c) + 2 for c in _DIRECTIVE_CONFIRMATIONS
    )

    # 3. 动作关键词命中扫描（按优先级：export > create > refine > enrich > patch > style）
    hits = {
        "export": _text_has_any(text, text_lower, _INTENT_EXPORT_KEYWORDS),
        "create": _text_has_any(text, text_lower, _INTENT_CREATE_KEYWORDS),
        "refine": _text_has_any(text, text_lower, _INTENT_REFINE_KEYWORDS),
        "enrich": _text_has_any(text, text_lower, _INTENT_ENRICH_KEYWORDS),
        "patch": _text_has_any(text, text_lower, _INTENT_PATCH_KEYWORDS),
        "style": _text_has_any(text, text_lower, _INTENT_STYLE_KEYWORDS),
    }

    # 4. 有无简历决定 refine/patch/style/enrich 是否成立
    #    无简历时，refine 降级为 create（用户其实想要一份简历），
    #    patch/style/enrich 因没有操作对象而落为 chat（需先引导建简历）。
    if not has_resume:
        if hits["refine"] or hits["patch"] or hits["style"] or hits["enrich"]:
            # 若同时有 create 关键词，判 create；否则提示性 chat
            if hits["create"] or _text_has_any(text, text_lower, {"简历", "做", "写", "生成", "创建"}):
                mode = "create"
            else:
                # 有改的意图但没简历 → 不是明确指令（需先确认目标）
                return IntentClassification(mode="chat", is_directive=False, recommended_effort="low", confidence=0.6)
        else:
            mode = "create" if hits["create"] else None
    else:
        mode = None

    # 5. 按优先级确定 mode（export 最高，因为它是独立动作）
    if mode is None:
        for candidate in ("export", "create", "refine", "enrich", "style", "patch"):
            if hits.get(candidate):
                mode = candidate
                break

    # 6. 是否构成明确指令
    #    - 确认短语 → 强指令（但需有简历作对象）
    #    - 命中动作关键词 → 指令
    #    - 仅提供信息信号词且无动作关键词 → 非指令（chat）
    has_action_keyword = any(hits.values())
    has_info_signal = _text_has_any(text, text_lower, _CHAT_INFO_SIGNALS)

    if mode is None:
        # 没有任何动作关键词
        if has_info_signal and not is_confirmation:
            mode = "chat"
            is_directive = False
        elif is_confirmation and has_resume:
            # 短确认但没有上下文动作词 → 视为对话确认
            mode = "chat"
            is_directive = True
        else:
            mode = "chat"
            is_directive = False
    else:
        # 有明确的动作意图
        # 关键边界：当一句里既有「提供信息」又有「动作指令」时，动作优先（is_directive=True）
        # 例如「我在腾讯实习过，帮我加到简历里」→ patch + directive
        is_directive = True

    # 7. 短确认但无简历对象 → 仍非指令
    if is_confirmation and not has_resume and mode == "chat":
        is_directive = False

    # 8. 推荐思考程度
    recommended_effort = _derive_effort_from_intent(
        mode=mode,
        text=text,
        has_jd=has_jd,
        has_attachments=has_attachments,
        has_resume=has_resume,
    )

    confidence = 0.85 if has_action_keyword else 0.55
    return IntentClassification(
        mode=mode,
        is_directive=is_directive,
        recommended_effort=recommended_effort,
        confidence=confidence,
        plan_steps=intent_plan_steps(mode),
    )


def _derive_effort_from_intent(
    *,
    mode: str,
    text: str,
    has_jd: bool,
    has_attachments: bool,
    has_resume: bool,
) -> str:
    """从意图模式 + 上下文推导推荐思考程度。

    与 auto_classify_effort 保持一致的等级语义（low/medium/high/xhigh/max），
    这是「迁移」的核心约束：classify_intent 是意图层，auto_classify_effort 是
    现有的 effort 层，两者在简单闲聊上判 low、在复杂订制上判 high+。
    """
    text_lower = text.lower()

    # 极重：全面改写/系统性优化（但聊天上下文里不触发 xhigh）
    if any(kw in text_lower for kw in _AUTO_XHIGH_KEYWORDS):
        if mode != "chat":
            return "xhigh"

    # 重：refine（尤其带 JD 的订制）+ 复杂上下文
    if mode == "refine":
        if has_jd or any(kw in text_lower for kw in _AUTO_HIGH_KEYWORDS):
            return "high"
        return "medium"

    # create 带附件/JD 也偏重
    if mode == "create":
        if has_jd or has_attachments or any(kw in text_lower for kw in _AUTO_HIGH_KEYWORDS):
            return "high"
        return "medium"

    # patch / style / enrich / export：局部操作，中等即可
    if mode in ("patch", "style", "enrich", "export"):
        if len(text) > 200:
            return "high"
        return "medium"

    # chat：轻量，但保留历史 effort 行为——
    # 短闲聊（<8 字或打招呼模式）→ low；
    # 中等长度（8-200）无动作词 → medium（用户在描述背景，需要理解）；
    # 长文本（>200）无动作词 → high（可能含丰富上下文需仔细解析）。
    if mode == "chat":
        if len(text) < 8 or _AUTO_LOW_PATTERNS.match(text):
            return "low"
        if len(text) > 200:
            return "high"
        return "medium"

    return "medium"


def auto_classify_effort(content: str, has_jd: bool = False, has_attachments: bool = False) -> str:
    """根据用户消息内容自动判断合适的思考程度。

    迁移说明（P0.2c）：此函数现在委托给意图分类层的 effort 推导
    （``_classify_intent`` → ``recommended_effort``）。关键词常量统一收敛到
    意图层，effort 不再维护独立的关键词表——闲聊走 low、订制优化走 high+、
    局部操作走 medium，与 ``classify_intent.recommended_effort`` 同源。

    注意：本函数没有 ``has_resume`` 上下文（调用点在 run 循环里，意图分类时
    简历状态尚未确定），因此用乐观假设（has_resume=True）让 refine/patch/style
    等模式能成立——这与历史上的纯 effort 行为一致。
    """
    text = (content or "").strip()
    if not text and not has_attachments:
        return "medium"

    # 短文本快速路径：无动作词的极短输入直接 low（保留原行为）
    # 但有附件时不走此路径——纯图片等场景需要走 classify_intent 推导
    if len(text) < 8 and not has_attachments and not any(kw in text for kw in _AUTO_ACTION_KEYWORDS):
        return "low"

    intent = classify_intent(
        content,
        has_resume=True,  # 乐观假设，让 refine/patch 成立，与历史 effort 行为对齐
        has_jd=has_jd,
        has_attachments=has_attachments,
    )
    effort = intent.recommended_effort

    # has_jd / has_attachments 即使意图判 medium/low 也应升 high（与历史一致），
    # 但打招呼短句（如「你好」带 JD 不太现实）仍保持轻量。
    if effort in ("medium", "low") and (has_jd or has_attachments) and not _AUTO_LOW_PATTERNS.match(text):
        return "high"
    return effort


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
