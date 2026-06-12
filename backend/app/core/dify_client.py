"""Dify chat-messages client - supports Chatbot, Text Generator, Workflow modes"""
import httpx
import json
from app.admin.model_service import decrypt_api_key


DIFY_HARNESS_POLICY = """CareerForge-AI 平台约束：你运行在 Agent = Model + Harness 原则下。你只负责理解、规划、分析和生成建议；权限、数据读取、工具执行、审计和高风险确认由平台 Harness 负责。禁止编造业务事实、简历经历、指标或执行结果；涉及新增、修改、删除、付款、审批、批量处理、外发消息等高风险动作时，只能输出待确认方案，不能声称已执行。"""


def _inject_harness_policy(agent, user_message: str, inputs: dict) -> tuple[str, dict]:
    """Pass platform Harness boundaries into external Dify apps when invoked via CareerForge-AI."""
    policy = DIFY_HARNESS_POLICY
    if getattr(agent, "name", None):
        policy = f"{policy}\n当前智能体：{agent.name}"
    enriched_inputs = dict(inputs or {})
    enriched_inputs.setdefault("harness_policy", policy)
    guarded_message = f"{policy}\n\n用户请求：\n{user_message}"
    return guarded_message, enriched_inputs


def _discover_dify_inputs(client: httpx.Client, base_url: str, headers: dict, user_message: str, variables: dict | None) -> tuple[str, dict, list[str]]:
    """Probe /info and /parameters to build correct inputs and endpoint order.
    Returns (app_mode, inputs_dict, endpoint_order).
    """
    app_mode = "unknown"
    try:
        info_resp = client.get(f"{base_url}/info", headers=headers)
        if info_resp.status_code == 200:
            app_mode = info_resp.json().get("mode", "unknown")
    except Exception:
        pass

    # Build inputs from variables or auto-discover
    inputs: dict = {}
    extra_inputs: dict = {}

    if variables:
        # User explicitly provided variables - use them directly
        inputs.update({k: v for k, v in variables.items()})
    else:
        # Auto-discover required inputs from /parameters
        try:
            param_resp = client.get(f"{base_url}/parameters", headers=headers)
            if param_resp.status_code == 200:
                params = param_resp.json()
                user_inputs_form = params.get("user_input_form", [])
                discovered_fields = []
                if isinstance(user_inputs_form, list):
                    for field in user_inputs_form:
                        if isinstance(field, dict):
                            for ftype, fconfig in field.items():
                                if isinstance(fconfig, dict):
                                    vname = fconfig.get("variable") or ""
                                    if vname and vname not in discovered_fields:
                                        discovered_fields.append(vname)
                if discovered_fields:
                    # Map user_message to first field, rest get "test"
                    for idx, fname in enumerate(discovered_fields):
                        inputs[fname] = user_message if idx == 0 else "test"
                else:
                    # No user inputs - use generic fallback
                    inputs["query"] = user_message
            else:
                inputs["query"] = user_message
        except Exception:
            inputs["query"] = user_message

    # Determine endpoint order based on app mode
    mode_endpoints = {
        "chat": ["chat-messages"],
        "agent-chat": ["chat-messages"],
        "completion": ["completion-messages"],
        "workflow": ["workflows/run"],
        "advanced-chat": ["chat-messages"],
    }
    endpoint_order = mode_endpoints.get(app_mode, ["chat-messages", "completion-messages", "workflows/run"])
    # Append any missing fallback endpoints
    for ep in ["chat-messages", "completion-messages", "workflows/run"]:
        if ep not in endpoint_order:
            endpoint_order.append(ep)

    return app_mode, inputs, endpoint_order


def dify_chat_completion(agent, *, user_message: str, variables: dict | None = None,
                          conversation_id: str = "", user_id: str = "admin") -> dict:
    """Call Dify API (blocking mode). Auto-detects app mode by probing /info and /parameters."""
    api_key = decrypt_api_key(agent.dify_api_key_cipher) if agent.dify_api_key_cipher else ""
    if not api_key:
        raise RuntimeError("Dify API Secret not configured for this agent")

    import os
    base_url = (getattr(agent, "dify_api_base_url", None) or os.getenv("DIFY_API_BASE_URL", "") or "https://api.dify.ai/v1").rstrip("/")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

    last_error = ""
    with httpx.Client(timeout=httpx.Timeout(120.0)) as client:
        # Auto-discover app mode and required inputs
        app_mode, inputs, endpoint_order = _discover_dify_inputs(
            client, base_url, headers, user_message, variables
        )
        guarded_message, inputs = _inject_harness_policy(agent, user_message, inputs)

        # Build endpoint bodies
        available_endpoints = {
            "chat-messages": (f"{base_url}/chat-messages", {"inputs": inputs, "query": guarded_message, "response_mode": "blocking", "user": user_id}),
            "completion-messages": (f"{base_url}/completion-messages", {"inputs": inputs, "response_mode": "blocking", "user": user_id}),
            "workflows/run": (f"{base_url}/workflows/run", {"inputs": inputs, "response_mode": "blocking", "user": user_id}),
        }
        if conversation_id:
            for key in available_endpoints:
                if key == "chat-messages":
                    available_endpoints[key][1]["conversation_id"] = conversation_id

        for endpoint_name in endpoint_order:
            if endpoint_name not in available_endpoints:
                continue
            url, body = available_endpoints[endpoint_name]
            resp = client.post(url, json=body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                reply = data.get("answer") or ""
                if not reply:
                    outputs = data.get("data", {}).get("outputs", {}) or {}
                    if outputs:
                        reply = outputs.get("text") or outputs.get("result") or outputs.get("output") or json.dumps(outputs, ensure_ascii=False)
                conv_id = data.get("conversation_id", "")
                return {"reply": reply, "conversation_id": conv_id, "usage": None}
            elif resp.status_code == 401:
                raise RuntimeError("Dify call failed (401): Invalid API Secret")
            else:
                try:
                    detail = resp.json()
                    last_error = detail.get("message", "") or resp.text[:200]
                except Exception:
                    last_error = resp.text[:200]

    raise RuntimeError(f"Dify call failed: {last_error}")
