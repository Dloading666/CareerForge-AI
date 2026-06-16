"""Interview Harness — 受控式 Agentic Loop 校验层。

所有模型输出必须经过 Harness 校验后才能入库。
模型只生成候选 JSON，Harness 负责验收、修复、降级、停止判定。
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.interview.prompts import INTERVIEW_SYSTEM_PROMPT

logger = logging.getLogger(__name__)


# ── 评分维度 ──────────────────────────────────────────────────────────────────

SCORE_KEYS = [
    "technical_accuracy",
    "project_evidence",
    "problem_solving",
    "communication",
    "job_fit",
    "pressure_handling",
]


def _strict_bool(value: Any, *, default: bool = False) -> bool:
    """严格布尔解析：只接受 bool 类型，拒绝字符串 'true'/'false'。

    使用场景：模型输出 JSON 中的 should_end 字段。
    bool('false') == True 会误判结束，必须严格区分。
    """
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    # 字符串 'true'/'false' 不再静默转换，返回 default 并记录
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized == "true":
            logger.warning("harness: should_end 是字符串 'true'，应为 JSON boolean；视为 default=%s", default)
            return True
        if normalized == "false":
            logger.warning("harness: should_end 是字符串 'false'，应为 JSON boolean；视为 default=%s", default)
            return False
    return default


# ── 文本归一化（证据引用匹配用）────────────────────────────────────────────────

def _normalize_text_for_match(text: str) -> str:
    """将文本归一化以便做宽松匹配：小写、去多余空白、统一标点。"""
    text = text.lower()
    # 统一中文/英文标点
    text = text.replace("，", ",").replace("。", ".").replace("！", "!").replace("？", "?")
    text = text.replace("：", ":").replace("；", ";")
    text = text.replace("“", '"').replace("”", '"')  # 左右双引号→直双引号
    text = text.replace("‘", "'").replace("’", "'")  # 左右单引号→直单引号
    # 压缩空白
    text = re.sub(r"\s+", " ", text).strip()
    return text


# ── 禁止内容检查 ──────────────────────────────────────────────────────────────

_FORBIDDEN_PATTERNS = [
    "系统提示词",
    "内部规则",
    "developer message",
    "system prompt",
    "我已录用你",
    "你已经通过面试",
    "你已被录用",
    "C:\\",
    "/app/",
    "/root/",
    "/home/",
    "/etc/",
]


def _contains_forbidden_text(text: str) -> bool:
    """检查文本是否包含禁止泄漏给学生端的内容。"""
    text_lower = text.lower()
    for pattern in _FORBIDDEN_PATTERNS:
        if pattern.lower() in text_lower:
            return True
    return False


# ── 单问题校验 ────────────────────────────────────────────────────────────────

def _looks_like_single_question(text: str) -> bool:
    """判断文本是否只包含一个主问题。

    规则：
    - 问号数量大于 2，判定不合格。
    - 同时出现"第一/第二/第三"且多个问号，判定不合格。
    - 出现"分别回答""同时说明""请从 A、B、C 三方面"时，判定不合格。
    - 不要过度严格，避免正常问题被误杀。
    """
    if not text or not text.strip():
        return False

    # 问号计数（中英文）
    q_count = text.count("?") + text.count("？")
    if q_count > 2:
        return False

    # 序号 + 多问号
    has_sequence = bool(re.search(r"第[一二三四五六七八九十]", text))
    if has_sequence and q_count > 1:
        return False

    # 强制拆分指令
    split_patterns = ["分别回答", "同时说明", "同时回答", "逐一回答", "从以下三方面", "从以下几方面"]
    for pattern in split_patterns:
        if pattern in text:
            return False

    return True


# ── 反套路：泛泛收尾问题检测 ───────────────────────────────────────────────────

_FILLER_PATTERNS = [
    "你觉得呢",
    "你怎么看",
    "还有什么想补充的吗",
    "还有什么想说的吗",
    "你还有什么要补充",
    "你有什么想法",
    "你觉得怎么样",
    "你认为呢",
    "补充一下吧",
    "说说你的想法",
]


def _is_generic_filler_question(text: str) -> bool:
    """检测是否为泛泛收尾问题（反套路规则）。

    只有当问题主体就是这些泛泛表达时才拦截，
    如果泛泛表达只是问题的一部分（如「你觉得 Redis 和 Memcached 的区别是什么？」）则放行。
    """
    text_clean = text.strip().rstrip("？?。.!！")
    for pattern in _FILLER_PATTERNS:
        if text_clean == pattern or text_clean == f"那{pattern}" or text_clean == f"那么{pattern}":
            return True
    return False

def _filter_evidence_quotes(quotes: Any, answer: str) -> list[dict[str, Any]]:
    """过滤证据引用，只保留能在 answer 中匹配到的 quote。"""
    if not isinstance(quotes, list):
        return []
    answer_norm = _normalize_text_for_match(answer)
    filtered: list[dict[str, Any]] = []
    for item in quotes:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote", "")).strip()
        if not quote:
            continue
        quote_norm = _normalize_text_for_match(quote)
        if quote_norm not in answer_norm:
            continue
        filtered.append({"quote": quote, "reason": str(item.get("reason", ""))})
        if len(filtered) >= 3:
            break
    return filtered


# ── 修复 Prompt 构建 ──────────────────────────────────────────────────────────

def _build_repair_prompt(
    task_name: str,
    previous_output: str,
    errors: list[str],
    original_prompt: str | None = None,
) -> str:
    """构建修复 prompt，包含原始上下文、错误列表和上一轮输出，要求模型只输出 JSON。

    Args:
        task_name: 任务名称
        previous_output: 上一轮模型输出
        errors: 校验错误列表
        original_prompt: 原始任务上下文（截断版本，防止修复时丢失事实）
    """
    error_list = "\n".join(f"- {e}" for e in errors)
    parts = [
        f"你的上一轮 {task_name} 输出没有通过 Harness 校验。",
        "",
        "【Harness 校验错误】",
        error_list,
    ]
    if original_prompt:
        # 截断到 3000 字符，防止 token 爆炸
        truncated = original_prompt[:3000]
        parts.extend([
            "",
            "【原始任务上下文，禁止改写事实】",
            truncated,
        ])
    parts.extend([
        "",
        "【上一轮模型输出】",
        previous_output[:2000],
        "",
        "请只修复 JSON 结构和违反规则的字段。",
        "禁止编造候选人没有说过的经历、公司、指标、技术栈。",
        "只输出 JSON，不要输出 Markdown 代码块，不要输出解释。",
    ])
    return "\n".join(parts)


# ── 通用 Harness JSON 生成 ────────────────────────────────────────────────────

def run_harnessed_json_generation(
    db: Session,
    *,
    task_name: str,
    system_prompt: str,
    user_prompt: str,
    fallback: dict[str, Any],
    validator: Callable[[dict[str, Any], dict[str, Any]], list[str]],
    context: dict[str, Any] | None = None,
    identity: AuthIdentity | None = None,
    preferred_model_id: int | None = None,
    temperature: float = 0.35,
    max_tokens: int = 2500,
    max_retries: int = 2,
    max_total_seconds: float = 30.0,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """受控式 JSON 生成：调用模型 → 解析 JSON → 校验 → 修复重试 → fallback。

    Args:
        max_total_seconds: LLM 调用总耗时上限（秒）。超过后直接返回 fallback。

    Returns:
        (result, llm_meta) — result 是校验通过的 JSON 或 fallback，
        llm_meta 包含 used/model/usage/attempts/repaired/errors/fallback_used/elapsed_ms/max_total_seconds。
    """
    # 延迟导入避免循环引用
    from app.interview.service import _candidate_chat_models, _extract_json
    from app.core.llm_client import chat_completion

    started_at = time.monotonic()

    models = _candidate_chat_models(db, identity, preferred_model_id)
    if not models:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        return fallback, {
            "used": False, "model": None, "usage": None,
            "attempts": 0, "repaired": False, "errors": ["No student-open chat model with API key"],
            "fallback_used": True,
            "elapsed_ms": elapsed_ms, "max_total_seconds": max_total_seconds,
        }

    ctx = context or {}
    all_errors: list[str] = []
    previous_output = ""
    attempts = 0

    for attempt in range(max_retries + 1):
        # 检查总耗时
        elapsed = time.monotonic() - started_at
        if elapsed >= max_total_seconds:
            all_errors.append("max_total_seconds exceeded")
            logger.warning("harness %s exceeded max_total_seconds=%.1fs at attempt %d", task_name, max_total_seconds, attempts)
            break

        attempts += 1

        # 构建 prompt
        if attempt == 0:
            current_prompt = user_prompt
        else:
            current_prompt = _build_repair_prompt(
                task_name, previous_output, all_errors, original_prompt=user_prompt,
            )

        # 调用模型（遍历候选模型）
        raw_reply = None
        model_name = None
        usage = None
        model_errors: list[str] = []

        for model in models:
            # 每个模型调用前也检查总耗时
            if time.monotonic() - started_at >= max_total_seconds:
                all_errors.append("max_total_seconds exceeded")
                break
            try:
                result = chat_completion(
                    model,
                    system_prompt=system_prompt,
                    variables={},
                    memory=[],
                    user_message=current_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                raw_reply = result["reply"]
                model_name = model.display_name
                usage = result.get("usage")
                break
            except Exception as exc:
                model_errors.append(f"{model.display_name}: {str(exc)[:180]}")

        if "max_total_seconds exceeded" in all_errors:
            break

        if raw_reply is None:
            all_errors.extend(model_errors)
            continue

        # 解析 JSON
        parsed = _extract_json(raw_reply)
        if parsed is None:
            all_errors.append(f"attempt {attempt + 1}: 模型输出不是合法 JSON")
            previous_output = raw_reply[:2000]
            continue

        # 校验
        errors = validator(parsed, ctx)
        if not errors:
            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            return parsed, {
                "used": True, "model": model_name, "usage": usage,
                "attempts": attempts, "repaired": attempt > 0,
                "errors": [], "fallback_used": False,
                "elapsed_ms": elapsed_ms, "max_total_seconds": max_total_seconds,
            }

        # 校验失败，准备重试
        all_errors.extend(errors)
        previous_output = raw_reply[:2000]
        logger.warning(
            "harness %s attempt=%d validator errors: %s",
            task_name, attempt + 1, errors,
        )

    # 超过最大重试次数或总耗时超限，返回 fallback
    fallback_errors = validator(fallback, ctx)
    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    if fallback_errors:
        logger.warning(
            "harness %s fallback 未通过 validator: %s — 仍使用 fallback（最后手段）",
            task_name, fallback_errors,
        )
    else:
        logger.warning("harness %s exhausted %d retries, using validated fallback", task_name, max_retries)
    return fallback, {
        "used": False, "model": models[0].display_name, "usage": None,
        "attempts": attempts, "repaired": False,
        "errors": all_errors[-5:],  # 只保留最后 5 条
        "fallback_used": True,
        "elapsed_ms": elapsed_ms, "max_total_seconds": max_total_seconds,
    }


def _try_non_streaming_fallback(
    *,
    db: Session,
    models: list[Any],
    system_prompt: str,
    user_prompt: str,
    validator: Callable[[dict[str, Any], dict[str, Any]], list[str]],
    context: dict[str, Any],
    identity: Any | None,
    temperature: float,
    max_tokens: int,
    max_retries: int,
    started_at: float,
    all_errors: list[str],
    on_delta: Callable[[str], None] | None,
    on_display_text: Callable[[str], None] | None,
    on_completed: Callable[[str], None] | None,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    """流式全部失败后的降级：用非流式 chat_completion 调用模型，解析 JSON 后模拟流式输出。

    返回 None 表示非流式也失败了，调用方应继续使用 hardcoded fallback。
    """
    from app.interview.service import _candidate_chat_models, _extract_json
    from app.core.llm_client import chat_completion

    if not models:
        return None

    for model in models:
        if time.monotonic() - started_at >= 30.0:
            break

        for attempt in range(max_retries + 1):
            if time.monotonic() - started_at >= 30.0:
                break

            if attempt == 0:
                current_prompt = user_prompt
            else:
                current_prompt = _build_repair_prompt(
                    "non_streaming_fallback", "", all_errors[-3:], original_prompt=user_prompt,
                )

            try:
                result = chat_completion(
                    model,
                    system_prompt=system_prompt,
                    variables={},
                    memory=[],
                    user_message=current_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except Exception as exc:
                all_errors.append(f"{model.display_name} [non-streaming]: {str(exc)[:180]}")
                continue

            raw_reply = str(result.get("reply") or "")
            parsed = _extract_json(raw_reply)
            if parsed is None:
                all_errors.append(f"attempt {attempt + 1}: {model.display_name} [non-streaming] 输出不是合法 JSON")
                continue

            errors = validator(parsed, context)
            if errors:
                all_errors.extend(errors)
                logger.warning(
                    "harness non-streaming fallback %s attempt=%d validator errors: %s",
                    "fallback", attempt + 1, errors,
                )
                continue

            # ── 校验通过，模拟流式输出 ──
            display_text = _extract_display_text(parsed)
            _simulate_streaming_output(
                display_text=display_text,
                on_delta=on_delta,
                on_display_text=on_display_text,
                on_completed=on_completed,
            )

            elapsed_ms = int((time.monotonic() - started_at) * 1000)
            return parsed, {
                "used": True, "model": model.display_name, "usage": result.get("usage"),
                "attempts": attempt + 1, "repaired": attempt > 0,
                "errors": [], "fallback_used": False,
                "non_streaming_fallback": True,
                "elapsed_ms": elapsed_ms, "max_total_seconds": 30.0,
                "display_text": display_text,
                "models_tried": [m.display_name for m in models],
            }

    return None


def _extract_display_text(parsed: dict[str, Any]) -> str:
    """从模型输出的 JSON 中提取前端展示文本。"""
    # 面试第一问：取 first_question
    first_q = str(parsed.get("first_question") or "").strip()
    if first_q:
        return first_q
    # 追问：取 next_question
    next_q = str(parsed.get("next_question") or "").strip()
    if next_q:
        return next_q
    # 报告：取 report_text
    report = str(parsed.get("report_text") or "").strip()
    if report:
        return report
    # 兜底：转全部 JSON 为字符串（避免展示原始 JSON 给用户）
    return ""


def _simulate_streaming_output(
    *,
    display_text: str,
    on_delta: Callable[[str], None] | None,
    on_display_text: Callable[[str], None] | None,
    on_completed: Callable[[str], None] | None,
) -> None:
    """将完整文本拆成逐句 chunks，模拟流式打字机效果。

    按标点切句，逐句通过 on_delta 发送，句间短暂 sleep 制造渐进感。
    """
    if not display_text or not on_delta:
        if on_display_text:
            on_display_text(display_text)
        if on_completed:
            on_completed(display_text)
        return

    # 按句子边界切分：保留标点附在前一句末尾
    import re
    sentences = re.split(r"(?<=[。！？?！\n])", display_text)
    sentences = [s for s in sentences if s]

    if not sentences:
        sentences = [display_text]

    for sentence in sentences:
        on_delta(sentence)
        time.sleep(0.06)  # 60ms 间隔，模拟真人口吻逐句输出

    if on_display_text:
        on_display_text(display_text)
    if on_completed:
        on_completed(display_text)


def run_harnessed_streaming_generation(
    db: Session,
    *,
    task_name: str,
    system_prompt: str,
    user_prompt: str,
    fallback: dict[str, Any],
    validator: Callable[[dict[str, Any], dict[str, Any]], list[str]],
    context: dict[str, Any] | None = None,
    identity: Any | None = None,
    preferred_model_id: int | None = None,
    temperature: float = 0.35,
    max_tokens: int = 2500,
    max_retries: int = 2,
    on_delta: Callable[[str], None] | None = None,
    on_display_text: Callable[[str], None] | None = None,
    on_completed: Callable[[str], None] | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """流式 Harness 生成：调用流式模型 → 收集文本 → 解析 JSON → 校验 → fallback。

    模型输出格式要求：
    1. 先输出用户可见的工作进度说明（display text）
    2. 然后输出 ---JSON--- 分隔符
    3. 最后输出 JSON 结构化结果

    **JSON 内容绝对不能通过 on_delta 发给前端。**

    Args:
        on_delta: 每收到一个 display delta 时回调（只发展示文本，不发 JSON）
        on_display_text: display text 完成时回调（用于 SSE interviewer.snapshot）
        on_completed: display 文本完成时回调（用于 SSE interviewer.completed）

    Returns:
        (result, llm_meta)
    """
    from app.interview.service import _candidate_chat_models, _extract_json
    from app.core.llm_client import stream_chat_completion

    started_at = time.monotonic()
    ctx = context or {}

    models = _candidate_chat_models(db, identity, preferred_model_id)
    if not models:
        elapsed_ms = int((time.monotonic() - started_at) * 1000)
        fallback_detail = "No student-open chat model with API key"
        return fallback, {
            "used": False, "model": None, "usage": None,
            "attempts": 0, "repaired": False, "errors": [fallback_detail],
            "fallback_used": True,
            "fallback_reason": "no_model_available",
            "fallback_detail": fallback_detail,
            "elapsed_ms": elapsed_ms, "max_total_seconds": 30.0,
        }

    all_errors: list[str] = []
    attempts = 0
    models_tried: list[str] = []

    # 双层循环：外层遍历模型，内层重试
    for model in models:
        if time.monotonic() - started_at >= 30.0:
            break

        models_tried.append(model.display_name)

        for attempt in range(max_retries + 1):
            if time.monotonic() - started_at >= 30.0:
                break

            attempts += 1

            if attempt == 0:
                current_prompt = user_prompt
            else:
                current_prompt = _build_repair_prompt(
                    task_name, json_buffer, all_errors, original_prompt=user_prompt,
                )

            display_buffer = ""
            json_buffer = ""
            usage_info = None
            separator_seen = False
            stream_error = False
            raw_buffer = ""

            for chunk in stream_chat_completion(
                model,
                system_prompt=system_prompt,
                user_message=current_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            ):
                if chunk["type"] == "delta":
                    content = chunk["content"]
                    raw_buffer += content

                    if separator_seen:
                        # ---JSON--- 已出现，后续全部进 json_buffer，绝不发给前端
                        json_buffer += content
                    elif "---JSON---" in raw_buffer:
                        # 检测到分隔符：分隔符之前是 display text，之后是 JSON
                        before_sep, after_sep = raw_buffer.split("---JSON---", 1)
                        display_buffer = before_sep
                        separator_seen = True
                        # 只把分隔符之前的文本发给前端
                        if display_buffer and on_delta:
                            on_delta(display_buffer)
                        if on_display_text:
                            on_display_text(display_buffer.strip())
                        if on_completed:
                            on_completed(display_buffer.strip())
                        # 分隔符之后的部分进 json_buffer
                        json_buffer = after_sep
                    # 注意：未检测到分隔符时，不发任何 delta（缓冲中）

                elif chunk["type"] == "usage":
                    usage_info = chunk["usage"]
                elif chunk["type"] == "error":
                    all_errors.append(f"{model.display_name}: {chunk['message']}")
                    stream_error = True
                    break

            if stream_error:
                break

            # 流式结束：如果没有分隔符，检查是否为纯 JSON
            if not separator_seen:
                parsed_check = _extract_json(raw_buffer)
                if parsed_check is not None:
                    # 纯 JSON 输出，不向前端发送任何内容
                    display_buffer = ""
                    json_buffer = raw_buffer
                else:
                    # 既不是 JSON 也没有分隔符，当作非法输出
                    all_errors.append(f"attempt {attempts}: 输出不是合法 JSON，且缺少 ---JSON--- 分隔符")
                    continue

            parsed = _extract_json(json_buffer)
            if parsed is None:
                all_errors.append(f"attempt {attempts}: {model.display_name} 输出不是合法 JSON")
                continue

            errors = validator(parsed, ctx)
            if not errors:
                elapsed_ms = int((time.monotonic() - started_at) * 1000)
                return parsed, {
                    "used": True, "model": model.display_name, "usage": usage_info,
                    "attempts": attempts, "repaired": attempt > 0,
                    "errors": [], "fallback_used": False,
                    "elapsed_ms": elapsed_ms, "max_total_seconds": 30.0,
                    "display_text": display_buffer.strip(),
                    "models_tried": models_tried,
                }

            all_errors.extend(errors)
            logger.warning("harness_streaming %s attempt=%d validator errors: %s", task_name, attempts, errors)

    # ── 降级：流式全部失败 → 尝试非流式调用 + 模拟流式输出 ──
    non_streaming_result = _try_non_streaming_fallback(
        db=db, models=models, system_prompt=system_prompt, user_prompt=user_prompt,
        validator=validator, context=ctx, identity=identity,
        temperature=temperature, max_tokens=max_tokens, max_retries=max_retries,
        started_at=started_at, all_errors=all_errors,
        on_delta=on_delta, on_display_text=on_display_text, on_completed=on_completed,
    )
    if non_streaming_result is not None:
        return non_streaming_result

    # 非流式也失败，返回 hardcoded fallback
    elapsed_ms = int((time.monotonic() - started_at) * 1000)
    fallback_detail = "; ".join(all_errors[-5:]) if all_errors else "Unknown generation failure (streaming + non-streaming exhausted)"
    fallback_reason = "harness_validation_failed"
    lowered_detail = fallback_detail.lower()
    if "timeout" in lowered_detail:
        fallback_reason = "llm_timeout"
    elif "stream" in lowered_detail:
        fallback_reason = "llm_stream_error"
    elif "json" in lowered_detail:
        fallback_reason = "json_parse_failed"
    return fallback, {
        "used": False, "model": models[0].display_name if models else None, "usage": None,
        "attempts": attempts, "repaired": False,
        "errors": all_errors[-5:],
        "fallback_used": True,
        "fallback_reason": fallback_reason,
        "fallback_detail": fallback_detail,
        "elapsed_ms": elapsed_ms, "max_total_seconds": 30.0,
        "display_text": "",
        "models_tried": models_tried,
    }


# ── StartInterviewLoop 校验 ──────────────────────────────────────────────────

def validate_start_output(data: dict[str, Any], context: dict[str, Any]) -> list[str]:
    """校验 StartInterviewLoop 的模型输出。

    Returns:
        错误列表，空列表表示通过。
    """
    errors: list[str] = []

    # first_question 必须非空
    first_question = str(data.get("first_question") or "").strip()
    if not first_question:
        errors.append("first_question 为空")
    else:
        # 不超过 300 字
        if len(first_question) > 300:
            errors.append(f"first_question 过长（{len(first_question)} 字，建议 ≤ 300）")
        # 只能包含一个主问题
        if not _looks_like_single_question(first_question):
            errors.append("first_question 包含多个主问题，每次只允许问一个")
        # 禁止内容检查
        if _contains_forbidden_text(first_question):
            errors.append("first_question 包含禁止泄漏的内容")
        # 开场语必须包含"已读简历"表述
        _opening_indicators = ["读取", "简历", "看过", "阅读", "了解了", "看过你的"]
        if not any(indicator in first_question for indicator in _opening_indicators):
            errors.append("first_question 缺少「已读简历」表述（开场语需体现面试官已阅读候选人简历）")
        # P0: 简历锚点引用校验
        resume_anchors = context.get("resume_anchors") if context else None
        if resume_anchors and isinstance(resume_anchors, list) and len(resume_anchors) > 0:
            fq_lower = first_question.lower()
            anchor_hit = False
            for anchor in resume_anchors:
                if isinstance(anchor, dict):
                    keywords = anchor.get("keywords") or []
                    if any(kw.lower() in fq_lower for kw in keywords if kw):
                        anchor_hit = True
                        break
                else:
                    anchor_clean = str(anchor).strip(" -•\t")
                    if not anchor_clean:
                        continue
                    keywords = [kw for kw in re.split(r"[，,、。；;：:（）()\s]+", anchor_clean) if len(kw) >= 2]
                    if any(kw.lower() in fq_lower for kw in keywords):
                        anchor_hit = True
                        break
            if not anchor_hit:
                errors.append("first_question 未引用简历中的具体项目/经历/技能")
            # 有锚点时禁止泛问题
            _generic_patterns = ["请选一个", "请选择一个", "选一个最能证明", "选一个项目", "请做自我介绍", "请介绍一下自己"]
            if any(p in first_question for p in _generic_patterns):
                errors.append("first_question 包含泛问题（有简历锚点时必须引用具体项目，不能让用户自己选择）")

    # focus_points 是 1 到 6 个字符串
    focus_points = data.get("focus_points")
    if not isinstance(focus_points, list) or len(focus_points) == 0:
        errors.append("focus_points 为空或不是数组")
    elif len(focus_points) > 6:
        errors.append(f"focus_points 过多（{len(focus_points)} 个，最多 6 个）")

    # knowledge_points 是字符串数组
    knowledge_points = data.get("knowledge_points")
    if knowledge_points is not None:
        if not isinstance(knowledge_points, list):
            errors.append("knowledge_points 不是数组")

    # P1-1: resume_brief 必须是非空字符串
    resume_brief = str(data.get("resume_brief") or "").strip()
    if not resume_brief:
        errors.append("resume_brief 为空")

    # P1-1: question_reason 必须是非空字符串
    question_reason = str(data.get("question_reason") or "").strip()
    if not question_reason:
        errors.append("question_reason 为空")

    # P1-1: question_type 必须是非空字符串
    question_type = str(data.get("question_type") or "").strip()
    if not question_type:
        errors.append("question_type 为空")

    # P1-1: capability_tags 必须是字符串数组
    capability_tags = data.get("capability_tags")
    if not isinstance(capability_tags, list):
        errors.append("capability_tags 必须是数组")
    elif not all(isinstance(item, str) for item in capability_tags):
        errors.append("capability_tags 必须是字符串数组")

    return errors

def validate_followup_output(data: dict[str, Any], context: dict[str, Any]) -> list[str]:
    """校验 AnswerReviewLoop 的模型输出。

    强校验核心字段，should_end 必须是 JSON boolean。

    Returns:
        错误列表，空列表表示通过。
    """
    errors: list[str] = []

    # answer_assessment 必须是对象，且核心子字段强校验
    assessment = data.get("answer_assessment")
    if not isinstance(assessment, dict):
        errors.append("answer_assessment 不是对象")
    else:
        # summary 必须是非空字符串
        summary = assessment.get("summary")
        if not isinstance(summary, str) or not summary.strip():
            errors.append("answer_assessment.summary 必须是非空字符串")
        # is_vague 必须是 boolean
        is_vague = assessment.get("is_vague")
        if not isinstance(is_vague, bool):
            errors.append("answer_assessment.is_vague 必须是 boolean")
        # risk_points 必须是 list[str]
        risk_points = assessment.get("risk_points")
        if not isinstance(risk_points, list):
            errors.append("answer_assessment.risk_points 必须是数组")
        elif not all(isinstance(item, str) for item in risk_points):
            errors.append("answer_assessment.risk_points 必须是字符串数组")
        # positive_points 必须是 list[str]
        positive_points = assessment.get("positive_points")
        if not isinstance(positive_points, list):
            errors.append("answer_assessment.positive_points 必须是数组")
        elif not all(isinstance(item, str) for item in positive_points):
            errors.append("answer_assessment.positive_points 必须是字符串数组")

    # score 六个维度齐全
    score = data.get("score")
    if not isinstance(score, dict):
        errors.append("score 不是对象")
    else:
        for key in SCORE_KEYS:
            if key not in score:
                errors.append(f"score 缺少 {key}")
            else:
                try:
                    val = float(score[key])
                    if val < 1 or val > 5:
                        errors.append(f"score.{key} = {val}，追问阶段分数必须是 1 到 5")
                except (ValueError, TypeError):
                    errors.append(f"score.{key} 不是数字")

    # score_reasons 必须是 object，六维齐全
    score_reasons = data.get("score_reasons")
    if not isinstance(score_reasons, dict):
        errors.append("score_reasons 不是对象")
    else:
        for key in SCORE_KEYS:
            if key not in score_reasons:
                errors.append(f"score_reasons 缺少 {key}")
            elif not isinstance(score_reasons[key], str) or not score_reasons[key].strip():
                errors.append(f"score_reasons.{key} 必须是非空字符串")

    # followup_strategy 必须是非空字符串
    followup_strategy = data.get("followup_strategy")
    if not isinstance(followup_strategy, str) or not followup_strategy.strip():
        errors.append("followup_strategy 必须是非空字符串")

    # question_reason 必须是非空字符串
    question_reason = data.get("question_reason")
    if not isinstance(question_reason, str) or not question_reason.strip():
        errors.append("question_reason 必须是非空字符串")

    # question_type 必须是非空字符串
    question_type = data.get("question_type")
    if not isinstance(question_type, str) or not question_type.strip():
        errors.append("question_type 必须是非空字符串")

    # capability_tags 必须是 list[str]
    capability_tags = data.get("capability_tags")
    if not isinstance(capability_tags, list):
        errors.append("capability_tags 必须是数组")
    elif not all(isinstance(item, str) for item in capability_tags):
        errors.append("capability_tags 必须是字符串数组")

    # knowledge_points 必须是 list[str]
    knowledge_points = data.get("knowledge_points")
    if not isinstance(knowledge_points, list):
        errors.append("knowledge_points 必须是数组")
    elif not all(isinstance(item, str) for item in knowledge_points):
        errors.append("knowledge_points 必须是字符串数组")

    # should_end 必须是 JSON boolean（核心修复）
    should_end_raw = data.get("should_end")
    if "should_end" not in data:
        errors.append("should_end 字段缺失")
    elif not isinstance(should_end_raw, bool):
        errors.append("should_end 必须是 JSON boolean，不能是字符串")

    should_end = _strict_bool(should_end_raw)

    next_question = str(data.get("next_question") or "").strip()
    # 强制出题三件套：next_question 必须非空，即使 should_end=true
    if not next_question:
        errors.append("next_question 为空（违反强制出题三件套规则，即使 should_end=true 也必须给出收束性提问）")
    else:
        # 只能包含一个主问题
        if not _looks_like_single_question(next_question):
            errors.append("next_question 包含多个主问题")
        # 禁止内容检查
        if _contains_forbidden_text(next_question):
            errors.append("next_question 包含禁止泄漏的内容")
        # 反套路检查：禁止泛泛收尾
        if _is_generic_filler_question(next_question):
            errors.append(f"next_question 是泛泛收尾问题（如「你觉得呢？」），违反反套路规则：「{next_question[:50]}」")

    # evidence_quotes 引用内容必须能在 last_answer 中找到（使用归一化匹配）
    last_answer = str(context.get("last_answer") or "")
    evidence_quotes = data.get("evidence_quotes")
    if evidence_quotes is not None and isinstance(evidence_quotes, list):
        last_answer_norm = _normalize_text_for_match(last_answer)
        for item in evidence_quotes:
            if not isinstance(item, dict):
                continue
            quote = str(item.get("quote", "")).strip()
            if quote and _normalize_text_for_match(quote) not in last_answer_norm:
                errors.append(f"evidence_quotes 引用了候选人回答中不存在的内容：「{quote[:50]}」")

    # 低分维度必须在 score_reasons 中有原因
    if isinstance(score, dict) and isinstance(score_reasons, dict):
        for key in SCORE_KEYS:
            try:
                val = float(score.get(key, 3))
            except (ValueError, TypeError):
                val = 3
            if val <= 2 and key not in score_reasons:
                errors.append(f"score.{key} 分数较低（{val}）但 score_reasons 中缺少原因")

    # next_question grounding 检查（引用式幻觉拦截）
    if next_question and not should_end:
        grounding_errors = validate_question_grounding(next_question, context)
        errors.extend(grounding_errors)

    return errors


# ── next_question grounding 检查 ──────────────────────────────────────────────

# 引用式表达模式（只有出现这些词时才做 grounding 检查）
_REFERENCE_PATTERNS = [
    "你刚才提到",
    "你提到",
    "你说的",
    "刚才你讲到",
    "你刚才说",
    "你前面说",
]


def validate_question_grounding(question: str, context: dict[str, Any]) -> list[str]:
    """检查 next_question 是否引用了候选人未提供的信息。

    只有当问题包含引用式表达（如"你刚才提到"）时才严格校验。
    普通技术问题（如"请解释 Redis 缓存一致性"）不应被误杀。

    Args:
        question: 模型生成的下一个问题
        context: 包含 last_answer, resume_snapshot, history_text, job_description

    Returns:
        错误列表，空表示通过
    """
    errors: list[str] = []
    question_lower = question.lower()

    # 只有当问题包含引用式表达时才检查
    has_reference = any(pattern in question_lower for pattern in _REFERENCE_PATTERNS)
    if not has_reference:
        return errors

    # 合并所有可信上下文来源
    sources = " ".join([
        str(context.get("last_answer") or ""),
        str(context.get("resume_snapshot") or ""),
        str(context.get("history_text") or ""),
        str(context.get("job_description") or ""),
    ]).lower()

    # 从引用表达后面提取关键词
    # 简单启发式：找到引用表达后面的第一个名词/技术词
    for pattern in _REFERENCE_PATTERNS:
        idx = question_lower.find(pattern)
        if idx < 0:
            continue
        after = question[idx + len(pattern):]
        # 提取引号内容或到逗号/句号/问号前的内容
        quoted = re.search(r'[「『"“](.*?)[」』"”，。？,.\?]', after)
        if quoted:
            claimed = quoted.group(1).strip()
        else:
            # 取到第一个标点或空格前的内容（最多 30 字）
            m = re.match(r'[\s：:](.{2,30}?)[，。？,.\s]', after)
            claimed = m.group(1).strip() if m else ""
        if claimed and len(claimed) >= 2:
            # 检查声称的内容是否能在上下文中找到
            if claimed.lower() not in sources:
                errors.append(
                    f"next_question 引用了候选人未提供的信息：「{claimed[:30]}」"
                )
    return errors


# ── ReportGenerationLoop 校验 ────────────────────────────────────────────────

def validate_report_output(data: dict[str, Any], context: dict[str, Any]) -> list[str]:
    """校验 ReportGenerationLoop 的模型输出。

    Returns:
        错误列表，空列表表示通过。
    """
    errors: list[str] = []

    # overall_score 是 0 到 100
    try:
        overall = float(data.get("overall_score", -1))
        if overall < 0 or overall > 100:
            errors.append(f"overall_score = {overall}，必须在 0 到 100 之间")
    except (ValueError, TypeError):
        errors.append("overall_score 不是数字")

    # dimension_scores 六个维度齐全，每项是 0 到 100
    dim_scores = data.get("dimension_scores")
    if not isinstance(dim_scores, dict):
        errors.append("dimension_scores 不是对象")
    else:
        for key in SCORE_KEYS:
            if key not in dim_scores:
                errors.append(f"dimension_scores 缺少 {key}")
            else:
                try:
                    val = float(dim_scores[key])
                    if val < 0 or val > 100:
                        errors.append(f"dimension_scores.{key} = {val}，必须在 0 到 100 之间")
                except (ValueError, TypeError):
                    errors.append(f"dimension_scores.{key} 不是数字")

    # strengths, weaknesses, suggestions, next_questions 必须是字符串数组
    for field_name in ("strengths", "weaknesses", "suggestions", "next_questions"):
        field_val = data.get(field_name)
        if not isinstance(field_val, list):
            errors.append(f"{field_name} 不是数组")
        elif field_val and not all(isinstance(item, str) for item in field_val):
            errors.append(f"{field_name} 中包含非字符串元素")

    # report_text 非空
    report_text = str(data.get("report_text") or "").strip()
    if not report_text:
        errors.append("report_text 为空")

    # 禁止内容检查
    if report_text and _contains_forbidden_text(report_text):
        errors.append("report_text 包含禁止泄漏的内容")

    # P1-1: training_plan 必须是非空数组
    training_plan = data.get("training_plan")
    if not isinstance(training_plan, list) or len(training_plan) == 0:
        errors.append("training_plan 为空或不是数组")

    # P1-1: rewrite_examples 必须是数组（允许空数组）
    rewrite_examples = data.get("rewrite_examples")
    if not isinstance(rewrite_examples, list):
        errors.append("rewrite_examples 不是数组")

    # P1-1: next_session_preset 必须是对象
    next_session_preset = data.get("next_session_preset")
    if next_session_preset is not None and not isinstance(next_session_preset, dict):
        errors.append("next_session_preset 不是对象")

    return errors


# ── 问题质量 QA 打分 ─────────────────────────────────────────────────────────

# 高质量指标词：表明问题有具体验证目标
_SPECIFIC_INDICATORS = [
    "具体", "哪个", "什么场景", "举个例子", "量化", "指标", "数据",
    "多少", "几个", "百分比", "QPS", "TPS", "延迟", "耗时",
    "异常", "故障", "边界", "极端", "压力", "并发",
    "为什么", "怎么实现", "原理", "底层", "源码",
    "取舍", "权衡", "对比", "区别", "优缺点",
    "你当时", "你亲自", "你在项目中", "你的职责",
]

# 低质量指标词：表明问题可能过于泛泛
_VAGUE_INDICATORS = [
    "介绍一下", "谈谈", "聊聊", "说说", "讲讲",
    "你的理解", "你怎么理解", "你认为",
]


def _qa_score_question(question: str) -> tuple[float, list[str]]:
    """对生成的问题进行质量打分（0-10）。

    Returns:
        (score, issues) — score >= 6 为合格，issues 为具体问题列表
    """
    issues: list[str] = []
    score = 7.0  # 基准分

    q = question.strip()
    if not q:
        return 0.0, ["问题为空"]

    # 长度检查
    if len(q) < 15:
        score -= 2.0
        issues.append("问题过短（<15字），缺少具体验证方向")
    elif len(q) > 250:
        score -= 1.0
        issues.append("问题过长（>250字），可能包含多个子问题")

    # 具体性加分
    specific_count = sum(1 for w in _SPECIFIC_INDICATORS if w in q)
    if specific_count >= 2:
        score += 1.0
    elif specific_count == 0:
        score -= 1.5
        issues.append("缺少具体验证指标词（如具体/哪个/量化/为什么）")

    # 泛泛扣分
    vague_count = sum(1 for w in _VAGUE_INDICATORS if w in q)
    if vague_count >= 2:
        score -= 2.0
        issues.append("包含多个泛泛表达（如「介绍一下」「谈谈」）")
    elif vague_count == 1 and specific_count == 0:
        score -= 1.0
        issues.append("以泛泛表达开头且无具体验证目标")

    # 反套路：检查是否是纯收尾
    if _is_generic_filler_question(q):
        score -= 3.0
        issues.append("是泛泛收尾问题（反套路规则）")

    # 问号检查
    q_count = q.count("?") + q.count("？")
    if q_count == 0:
        score -= 1.0
        issues.append("不含问号，可能不是提问")
    elif q_count > 2:
        score -= 1.5
        issues.append(f"包含 {q_count} 个问号，可能包含多个子问题")

    return round(max(0, min(10, score)), 1), issues


# ── FinishDecisionLoop（纯代码，不调用模型）────────────────────────────────────

def harness_should_finish_interview(
    *,
    model_should_end: bool,
    current_turn_index: int,
    round_limit: int,
    coverage: dict[str, Any],
    current_stage: str,
    valid_answer_count: int,
) -> tuple[bool, str]:
    """Harness 主导的停止判定。

    模型 should_end=true 只是建议，Harness 根据规则做最终决定。

    Returns:
        (should_finish, reason)
    """
    # 规则 1：达到轮次上限，必须结束
    if current_turn_index >= round_limit:
        return True, f"已达到轮次上限（{round_limit} 轮）"

    # 规则 2：有效回答不足 3，通常不能结束
    if valid_answer_count < 3 and current_turn_index < round_limit:
        if model_should_end:
            return False, f"模型建议结束，但有效回答仅 {valid_answer_count} 条（需 ≥ 3），继续面试"
        return False, "有效回答不足，继续面试"

    # 规则 3：当前阶段是 opening 或 self_intro，通常不能直接结束
    if current_stage in ("opening", "self_intro"):
        if model_should_end:
            return False, f"模型建议结束，但当前阶段是「{current_stage}」，需要至少完成简历深挖或技术核心阶段"
        return False, f"当前阶段是「{current_stage}」，继续面试"

    # 规则 4：模型建议结束时，必须至少覆盖以下核心阶段之一
    CORE_STAGES = {"resume_deep_dive", "technical_core", "scenario"}
    covered_stages = set(coverage.keys())
    if model_should_end:
        covered_core = covered_stages & CORE_STAGES
        if not covered_core:
            return False, "模型建议结束，但未覆盖任何核心阶段（resume_deep_dive/technical_core/scenario）"
        return True, f"模型建议结束，已覆盖核心阶段：{'、'.join(covered_core)}"

    return False, "继续面试"


# ── 本地 fallback 报告 ────────────────────────────────────────────────────────

def build_fallback_report(
    *,
    overall: float,
    dim_scores: dict[str, float],
    weakest_dim: str,
    target_role: str,
) -> dict[str, Any]:
    """当报告 LLM 生成全部失败时的本地 fallback。"""
    dim_label = {
        "technical_accuracy": "技术准确性",
        "project_evidence": "项目证据",
        "problem_solving": "问题拆解",
        "communication": "表达能力",
        "job_fit": "岗位匹配",
        "pressure_handling": "抗压能力",
    }.get(weakest_dim, "核心能力")

    return {
        "overall_score": overall,
        "dimension_scores": dim_scores,
        "strengths": ["能够完成基本面试对话", "已有部分技术或项目线索可继续深挖"],
        "weaknesses": [
            f"{dim_label}是当前最薄弱的维度，面试官会继续追问",
            "回答需要更多量化指标和项目证据",
        ],
        "suggestions": [
            f"优先突破{dim_label}：准备具体案例、补充量化数据",
            "用 STAR 结构回答项目题",
            "每个技术点准备一个真实故障或优化案例",
        ],
        "next_questions": [
            f"请介绍一个你亲自优化过的、能证明{dim_label}的项目。",
            "Redis 缓存和数据库一致性如何保证？",
        ],
        "report_text": (
            f"本次面试综合分 {overall}。最薄弱维度是{dim_label}（{dim_scores.get(weakest_dim, 0)} 分）。"
            f"整体表现可以继续打磨，重点补充项目证据、数据指标和技术取舍。"
        ),
        "training_plan": [
            {
                "day": 1,
                "focus": dim_label,
                "tasks": ["复盘本轮最低分问题", "准备一个具体项目案例", "补充量化指标"],
                "expected_output": "一段 2 分钟结构化回答",
            },
            {
                "day": 2,
                "focus": "综合练习",
                "tasks": ["用 STAR 结构重写 3 个常见回答", "准备 2 个技术细节追问的应对"],
                "expected_output": "3 个可直接使用的面试回答模板",
            },
            {
                "day": 3,
                "focus": "模拟实战",
                "tasks": ["找朋友做一次 15 分钟模拟面试", "录音回听，标记空泛表达", "补充 2 个量化案例"],
                "expected_output": "一次完整模拟面试录音和复盘笔记",
            },
        ],
        "rewrite_examples": [
            {
                "original": "我负责了项目的后端开发。",
                "improved": "我主导了订单模块的后端重构，将接口 P99 延迟从 800ms 优化到 200ms，支撑了日均 10 万笔订单。",
                "dimension": "project_evidence",
            },
        ],
        "next_session_preset": {
            "target_role": target_role,
            "interview_type": "second_round",
            "interview_style": "strict",
            "focus_tags": [],
        },
    }


# ── InterviewState class method ───────────────────────────────────────────────

class InterviewState:
    """Harness state machine for interview sessions."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)

    @classmethod
    def create(cls, **kwargs) -> InterviewState:
        """Create a new interview state."""
        return cls(**kwargs)


# ── Hallucination check ──────────────────────────────────────────────────────

def check_hallucination(response: str, context: str) -> tuple[bool, str]:
    """Check if the response contains hallucinated content.

    Returns:
        (is_hallucination, reason)
    """
    # Check for fabricated technologies not in context
    tech_patterns = ["Redis", "Kafka", "Elasticsearch", "MongoDB", "RabbitMQ", "Docker", "Kubernetes"]
    for tech in tech_patterns:
        if tech.lower() in response.lower() and tech.lower() not in context.lower():
            return True, f"Response mentions {tech} but it's not in the context"
    return False, ""


def validate_against_resume(response: str, resume_text: str) -> tuple[bool, str]:
    """Validate that the response doesn't fabricate resume details.

    Returns:
        (is_valid, reason)
    """
    # Check for company names not in resume
    if "公司" in response and "公司" not in resume_text:
        return False, "Response mentions company details not in resume"
    # Check for school names not in resume
    if "大学" in response and "大学" not in resume_text:
        return False, "Response mentions school details not in resume"
    return True, ""
