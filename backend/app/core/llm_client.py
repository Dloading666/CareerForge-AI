"""OpenAI-compatible LLM client"""
import httpx
from app.admin.model_service import decrypt_api_key

# ── 模型名称规范化映射 ──────────────────────────
# 将常见的旧/非标准模型名映射到当前支持的名称
_MODEL_ALIAS_MAP = {
    "deepseek-v4": "deepseek-v4-pro",
}

def _normalize_model_id(model_id: str, base_url: str) -> str:
    """规范化模型标识符，处理已知别名"""
    normalized = _MODEL_ALIAS_MAP.get(model_id)
    if normalized:
        import logging
        logger = logging.getLogger(__name__)
        logger.warning(f"模型名称已自动修正: '%s' -> '%s'", model_id, normalized)
    return normalized or model_id


def chat_completion(model_config, *, system_prompt, variables, memory, user_message,
                    temperature=0.7, max_tokens=4096, top_p=0.9,
                    frequency_penalty=0.0, presence_penalty=0.0) -> dict:
    sp = system_prompt or "你是一个有帮助的 AI 助手。"
    if variables:
        for key, val in variables.items(): sp = sp.replace(f"{{{{{key}}}}}", val)
    messages = [{"role": "system", "content": sp}]
    messages.extend(memory)
    messages.append({"role": "user", "content": user_message})

    api_base = (model_config.base_url or "https://api.deepseek.com").rstrip("/")
    api_key = decrypt_api_key(model_config.api_key_cipher) if model_config.api_key_cipher else ""
    model_id = _normalize_model_id(model_config.model_identifier or "deepseek-chat", api_base)

    body = {"model": model_id, "messages": messages, "temperature": temperature,
            "max_tokens": max_tokens, "top_p": top_p,
            "frequency_penalty": frequency_penalty, "presence_penalty": presence_penalty, "stream": False}
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    client = httpx.Client(timeout=httpx.Timeout(120.0))
    try: resp = client.post(f"{api_base}/chat/completions", json=body, headers=headers)
    finally: client.close()

    if resp.status_code != 200:
        raise RuntimeError(f"LLM 调用失败 ({resp.status_code}): {resp.text[:512]}")
    data = resp.json()
    choice = data.get("choices", [{}])[0]
    reply = choice.get("message", {}).get("content", "")
    usage = data.get("usage")
    return {"reply": reply, "usage": {"prompt_tokens": usage.get("prompt_tokens", 0),
            "completion_tokens": usage.get("completion_tokens", 0),
            "total_tokens": usage.get("total_tokens", 0)} if usage else None}
