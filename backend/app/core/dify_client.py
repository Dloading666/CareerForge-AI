"""Dify chat-messages client"""
import httpx
from app.admin.model_service import decrypt_api_key


def dify_chat_completion(agent, *, user_message: str, variables: dict | None = None,
                          conversation_id: str = "", user_id: str = "admin") -> dict:
    """Call Dify chat-messages API (blocking mode)."""
    api_key = decrypt_api_key(agent.dify_api_key_cipher) if agent.dify_api_key_cipher else ""
    if not api_key:
        raise RuntimeError("Dify API Key not configured for this agent")

    # Dify base URL: try agent custom, then env var, then default
    import os
    base_url = os.getenv("DIFY_API_BASE_URL", "https://api.dify.ai/v1").rstrip("/")

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    # Build inputs from prompt_variables
    inputs = {}
    if variables:
        inputs = {k: v for k, v in variables.items()}

    body = {
        "inputs": inputs,
        "query": user_message,
        "response_mode": "blocking",
        "user": user_id,
    }
    if conversation_id:
        body["conversation_id"] = conversation_id

    client = httpx.Client(timeout=httpx.Timeout(120.0))
    try:
        resp = client.post(f"{base_url}/chat-messages", json=body, headers=headers)
    finally:
        client.close()

    if resp.status_code != 200:
        raise RuntimeError(f"Dify call failed ({resp.status_code}): {resp.text[:512]}")

    data = resp.json()
    reply = data.get("answer", "")
    conv_id = data.get("conversation_id", "")
    return {
        "reply": reply,
        "conversation_id": conv_id,
        "usage": None,  # Dify doesn't return token usage in basic mode
    }
