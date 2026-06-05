"""Dify chat-messages client - supports Chatbot, Text Generator, Workflow modes"""
import httpx
from app.admin.model_service import decrypt_api_key


def dify_chat_completion(agent, *, user_message: str, variables: dict | None = None,
                          conversation_id: str = "", user_id: str = "admin") -> dict:
    """Call Dify API (blocking mode). Auto-detects or uses configured app mode."""
    api_key = decrypt_api_key(agent.dify_api_key_cipher) if agent.dify_api_key_cipher else ""
    if not api_key:
        raise RuntimeError("Dify API Secret not configured for this agent")

    import os
    base_url = (getattr(agent, "dify_api_base_url", None) or os.getenv("DIFY_API_BASE_URL", "") or "https://api.dify.ai/v1").rstrip("/")

    inputs = {}
    if variables:
        inputs = {k: v for k, v in variables.items()}

    client = httpx.Client(timeout=httpx.Timeout(120.0))
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    # Try endpoints in order: chat-messages, completion-messages, workflows/run
    endpoints = [
        ("/chat-messages", {"inputs": inputs, "query": user_message, "response_mode": "blocking", "user": user_id}),
        ("/completion-messages", {"inputs": inputs, "query": user_message, "response_mode": "blocking", "user": user_id}),
        ("/workflows/run", {"inputs": inputs, "response_mode": "blocking", "user": user_id}),
    ]
    if conversation_id:
        for _, body in endpoints:
            body["conversation_id"] = conversation_id

    last_error = ""
    for path, body in endpoints:
        try:
            resp = client.post(f"{base_url}{path}", json=body, headers=headers)
        finally:
            if path == endpoints[-1][0]:
                client.close()
        if resp.status_code == 200:
            data = resp.json()
            reply = data.get("answer") or data.get("data", {}).get("outputs", {}).get("text", "") or ""
            conv_id = data.get("conversation_id", "")
            return {"reply": reply, "conversation_id": conv_id, "usage": None}
        elif resp.status_code == 401:
            raise RuntimeError(f"Dify call failed (401): Invalid API Secret")
        else:
            try:
                detail = resp.json()
                last_error = detail.get("message", "") or resp.text[:200]
            except Exception:
                last_error = resp.text[:200]

    raise RuntimeError(f"Dify call failed: {last_error}")
