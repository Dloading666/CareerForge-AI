"""LLM client supporting OpenAI-compatible and Anthropic-compatible APIs."""
from __future__ import annotations

import json
import logging
from typing import Any, Generator

import httpx

from app.admin.model_service import decrypt_api_key

logger = logging.getLogger(__name__)


_MODEL_ALIAS_MAP = {
    "deepseek-v4": "deepseek-v4-pro",
}


def _normalize_model_id(model_id: str, base_url: str) -> str:
    normalized = _MODEL_ALIAS_MAP.get(model_id)
    if normalized:
        import logging

        logging.getLogger(__name__).warning("model id normalized: %s -> %s", model_id, normalized)
    return normalized or model_id


def _protocols(model_config) -> set[str]:
    raw = (getattr(model_config, "protocols", "") or "").lower()
    return {item.strip() for item in raw.split(",") if item.strip()}


def is_anthropic_model(model_config) -> bool:
    protocols = _protocols(model_config)
    base_url = (getattr(model_config, "base_url", "") or "").lower()
    return "anthropic" in protocols or "/anthropic" in base_url or "api.anthropic.com" in base_url


def _apply_variables(system_prompt: str | None, variables: dict[str, str] | None) -> str:
    sp = system_prompt or "You are a helpful AI assistant."
    if variables:
        for key, val in variables.items():
            sp = sp.replace(f"{{{{{key}}}}}", str(val))
    return sp


def _anthropic_messages(memory: list[dict[str, Any]], user_message: str) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for item in memory:
        role = item.get("role")
        if role == "system":
            continue
        if role == "assistant":
            messages.append({"role": "assistant", "content": str(item.get("content") or "")})
        elif role == "user":
            messages.append({"role": "user", "content": str(item.get("content") or "")})
        elif role == "tool":
            messages.append({"role": "user", "content": str(item.get("content") or "")})
    messages.append({"role": "user", "content": user_message})
    return messages


def _anthropic_completion(
    model_config,
    *,
    system_prompt: str,
    memory: list[dict[str, Any]],
    user_message: str,
    temperature: float,
    max_tokens: int,
    top_p: float,
) -> dict:
    api_base = (model_config.base_url or "https://api.anthropic.com/v1").rstrip("/")
    if api_base.endswith("/anthropic"):
        api_base = f"{api_base}/v1"
    elif not api_base.endswith("/v1"):
        api_base = f"{api_base}/v1"
    api_key = decrypt_api_key(model_config.api_key_cipher) if model_config.api_key_cipher else ""
    body = {
        "model": model_config.model_identifier,
        "system": system_prompt,
        "messages": _anthropic_messages(memory, user_message),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "stream": False,
    }
    headers = {
        "x-api-key": api_key,
        "api-key": api_key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=httpx.Timeout(getattr(model_config, "timeout_sec", None) or 120.0)) as client:
        resp = client.post(f"{api_base}/messages", json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"LLM call failed ({resp.status_code}): {resp.text[:512]}")
    data = resp.json()
    reply_parts: list[str] = []
    for block in data.get("content") or []:
        if block.get("type") == "text":
            reply_parts.append(block.get("text") or "")
    usage = data.get("usage") or {}
    return {
        "reply": "".join(reply_parts),
        "usage": {
            "prompt_tokens": usage.get("input_tokens", 0),
            "completion_tokens": usage.get("output_tokens", 0),
            "total_tokens": (usage.get("input_tokens", 0) or 0) + (usage.get("output_tokens", 0) or 0),
        },
    }


def _openai_completion(
    model_config,
    *,
    system_prompt: str,
    memory: list[dict[str, Any]],
    user_message: str,
    temperature: float,
    max_tokens: int,
    top_p: float,
    frequency_penalty: float,
    presence_penalty: float,
) -> dict:
    messages = [{"role": "system", "content": system_prompt}]
    messages.extend(memory)
    messages.append({"role": "user", "content": user_message})

    api_base = (model_config.base_url or "https://api.deepseek.com").rstrip("/")
    api_key = decrypt_api_key(model_config.api_key_cipher) if model_config.api_key_cipher else ""
    model_id = _normalize_model_id(model_config.model_identifier or "deepseek-chat", api_base)
    body = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "frequency_penalty": frequency_penalty,
        "presence_penalty": presence_penalty,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    with httpx.Client(timeout=httpx.Timeout(getattr(model_config, "timeout_sec", None) or 120.0)) as client:
        resp = client.post(f"{api_base}/chat/completions", json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"LLM call failed ({resp.status_code}): {resp.text[:512]}")
    data = resp.json()
    choice = data.get("choices", [{}])[0]
    reply = choice.get("message", {}).get("content", "")
    usage = data.get("usage")
    return {
        "reply": reply,
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
        if usage
        else None,
    }


def chat_completion(
    model_config,
    *,
    system_prompt,
    variables,
    memory,
    user_message,
    temperature=0.7,
    max_tokens=4096,
    top_p=0.9,
    frequency_penalty=0.0,
    presence_penalty=0.0,
) -> dict:
    sp = _apply_variables(system_prompt, variables)
    model_max_output = getattr(model_config, 'max_output', None) or 4096
    if max_tokens > model_max_output:
        max_tokens = model_max_output
    if is_anthropic_model(model_config):
        return _anthropic_completion(
            model_config,
            system_prompt=sp,
            memory=memory,
            user_message=user_message,
            temperature=temperature,
            max_tokens=max_tokens,
            top_p=top_p,
        )
    return _openai_completion(
        model_config,
        system_prompt=sp,
        memory=memory,
        user_message=user_message,
        temperature=temperature,
        max_tokens=max_tokens,
        top_p=top_p,
        frequency_penalty=frequency_penalty,
        presence_penalty=presence_penalty,
    )


def voice_chat_completion(
    model_config,
    *,
    system_prompt: str,
    audio_base64: str,
    audio_format: str = "wav",
    text_prompt: str | None = None,
    image_base64: str | None = None,
    image_format: str = "png",
    temperature: float = 0.35,
    max_tokens: int = 2500,
) -> dict:
    """调用支持音频的 VLM（如 MiMo V2.5）。

    通过 OpenAI 兼容的 multipart content 数组发送音频+文本+可选图片。
    如果模型不支持 multimodal content 数组，回退为纯文本调用。

    Args:
        model_config: ModelConfig 实例
        system_prompt: system prompt
        audio_base64: base64 编码的音频数据
        audio_format: 音频格式（wav/mp3/webm 等）
        text_prompt: 可选的文本提示（与音频一起发送）
        image_base64: 可选的 base64 编码图片（截屏等）
        image_format: 图片格式
        temperature: 温度
        max_tokens: 最大输出 token

    Returns:
        {"reply": str, "usage": dict}
    """
    api_base = (model_config.base_url or "https://api.deepseek.com").rstrip("/")
    api_key = decrypt_api_key(model_config.api_key_cipher) if model_config.api_key_cipher else ""
    model_id = _normalize_model_id(model_config.model_identifier or "deepseek-chat", api_base)

    # 构建 content 数组（multimodal 格式）
    content_parts: list[dict] = []

    # 文本部分
    if text_prompt:
        content_parts.append({"type": "text", "text": text_prompt})

    # 音频部分（OpenAI 兼容格式）
    content_parts.append({
        "type": "input_audio",
        "input_audio": {
            "data": audio_base64,
            "format": audio_format,
        },
    })

    # 可选图片部分
    if image_base64:
        content_parts.append({
            "type": "image_url",
            "image_url": {
                "url": f"data:image/{image_format};base64,{image_base64}",
            },
        })

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": content_parts},
    ]

    body = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    with httpx.Client(timeout=httpx.Timeout(getattr(model_config, "timeout_sec", None) or 180.0)) as client:
        resp = client.post(f"{api_base}/chat/completions", json=body, headers=headers)
    if resp.status_code != 200:
        raise RuntimeError(f"Voice LLM call failed ({resp.status_code}): {resp.text[:512]}")
    data = resp.json()
    choice = data.get("choices", [{}])[0]
    reply = choice.get("message", {}).get("content", "")
    usage = data.get("usage")
    return {
        "reply": reply,
        "usage": {
            "prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0),
        }
        if usage
        else None,
    }


def stream_chat_completion(
    model_config,
    *,
    system_prompt: str,
    memory: list[dict[str, Any]] | None = None,
    user_message: str,
    temperature: float = 0.35,
    max_tokens: int = 2500,
    top_p: float = 0.9,
) -> Generator[dict[str, Any], None, None]:
    """流式 Chat Completions，兼容 OpenAI-compatible API（含 mimo-v2.5）。

    Yields:
        {"type": "delta", "content": str}  — 文本增量
        {"type": "usage", "usage": dict}   — 最终 usage
        {"type": "error", "message": str}  — 错误

    注意：此生成器只 yield 用户可见的公开文本，不包含思维链。
    """
    messages = [{"role": "system", "content": system_prompt}]
    if memory:
        messages.extend(memory)
    messages.append({"role": "user", "content": user_message})

    api_base = (model_config.base_url or "https://api.deepseek.com").rstrip("/")
    api_key = decrypt_api_key(model_config.api_key_cipher) if model_config.api_key_cipher else ""
    model_id = _normalize_model_id(model_config.model_identifier or "deepseek-chat", api_base)
    body = {
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "top_p": top_p,
        "stream": True,
        "stream_options": {"include_usage": True},
    }
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    timeout_sec = getattr(model_config, "timeout_sec", None) or 120.0
    try:
        with httpx.Client(timeout=httpx.Timeout(timeout_sec)) as client:
            with client.stream("POST", f"{api_base}/chat/completions", json=body, headers=headers) as resp:
                if resp.status_code != 200:
                    error_text = resp.read().decode("utf-8", errors="replace")[:512]
                    yield {"type": "error", "message": f"LLM stream failed ({resp.status_code}): {error_text}"}
                    return

                buffer = ""
                for chunk in resp.iter_bytes():
                    buffer += chunk.decode("utf-8", errors="replace")
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if line.startswith("data: "):
                            data_str = line[6:]
                            if data_str == "[DONE]":
                                return
                            try:
                                data = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            usage = data.get("usage")
                            if usage:
                                yield {"type": "usage", "usage": {
                                    "prompt_tokens": usage.get("prompt_tokens", 0),
                                    "completion_tokens": usage.get("completion_tokens", 0),
                                    "total_tokens": usage.get("total_tokens", 0),
                                }}

                            choices = data.get("choices") or []
                            for choice in choices:
                                delta = choice.get("delta") or {}
                                content = delta.get("content")
                                if content:
                                    yield {"type": "delta", "content": content}
    except httpx.TimeoutException:
        yield {"type": "error", "message": "LLM stream timeout"}
    except Exception as exc:
        yield {"type": "error", "message": f"LLM stream error: {str(exc)[:200]}"}
