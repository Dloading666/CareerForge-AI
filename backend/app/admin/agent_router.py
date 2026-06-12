"""Agent API (admin)"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.admin.agent_service import (create_agent, delete_agent, get_agent, get_agent_dict, list_agents, toggle_agent, update_agent)
from app.admin.agent_service import build_agent_harness_system_prompt
from app.admin.agent_schemas import AgentChatRequest, AgentChatResponse, AgentCreate, AgentToggle, AgentUpdate
from app.auth.service import require_role
from app.core.llm_client import chat_completion
from app.core.dify_client import dify_chat_completion
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/admin/agents", tags=["admin-agents"])

# Known model name suggestions
_MODEL_SUGGESTIONS = {
    "deepseek-v4": "deepseek-v4-pro or deepseek-v4-flash",
}

def _enhance_error(model_identifier: str, original_detail: str) -> str:
    suggestion = _MODEL_SUGGESTIONS.get(model_identifier)
    if suggestion:
        return f'{original_detail}. Hint: please update model name from [{model_identifier}] to [{suggestion}] in Admin > Model Plaza'
    return original_detail


@router.get("")
def api_list_agents(category: Optional[str] = Query(None), search: Optional[str] = Query(None),
                    db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(list_agents(db, category=category, search=search))

@router.get("/options")
def api_list_agent_options(db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    """Return lightweight agent list for dropdowns (id, name, status, kind)."""
    agents = list_agents(db)
    return ok([{
        "id": str(a["id"]),
        "name": a["name"],
        "status": "enabled" if a["is_enabled"] else "disabled",
        "kind": "dify" if a["use_dify"] else "builtin",
    } for a in agents])




@router.get("/{agent_id}")
def api_get_agent(agent_id: int, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(get_agent_dict(db, agent_id))

@router.post("", status_code=201)
def api_create_agent(payload: AgentCreate, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(create_agent(db, payload))

@router.put("/{agent_id}")
def api_update_agent(agent_id: int, payload: AgentUpdate, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(update_agent(db, agent_id, payload))

@router.delete("/{agent_id}")
def api_delete_agent(agent_id: int, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    delete_agent(db, agent_id); return ok(msg="Deleted")

@router.patch("/{agent_id}/toggle")
def api_toggle_agent(agent_id: int, payload: AgentToggle, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(toggle_agent(db, agent_id, is_enabled=payload.is_enabled))

class DifyTestRequest(BaseModel):
    api_base_url: str
    api_key: str

@router.post("/test-dify")
async def api_test_dify(payload: "DifyTestRequest", _current=Depends(require_role("admin"))):
    """Test Dify connection - probes app info + parameters, then tests matched endpoint."""
    import httpx
    base_url = payload.api_base_url.rstrip("/")
    api_key = payload.api_key
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    user = "admin-test"
    steps = []

    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
        # Step 1: GET /info to discover app mode
        app_mode = "unknown"
        try:
            info_resp = await client.get(f"{base_url}/info", headers=headers)
            if info_resp.status_code == 200:
                info = info_resp.json()
                app_mode = info.get("mode", "unknown")
                steps.append({"step": "info", "ok": True, "mode": app_mode})
            else:
                steps.append({"step": "info", "ok": False, "status": info_resp.status_code, "body": info_resp.text[:200]})
        except Exception as exc:
            steps.append({"step": "info", "ok": False, "error": str(exc)[:120]})

        # Step 2: GET /parameters to discover required inputs
        test_inputs = {}
        try:
            param_resp = await client.get(f"{base_url}/parameters", headers=headers)
            if param_resp.status_code == 200:
                params = param_resp.json()
                user_inputs = params.get("user_input_form", [])
                if isinstance(user_inputs, list):
                    for field in user_inputs:
                        if isinstance(field, dict):
                            for ftype, fconfig in field.items():
                                if isinstance(fconfig, dict):
                                    vname = fconfig.get("variable") or ""
                                    if vname and vname not in test_inputs:
                                        test_inputs[vname] = "test"
                steps.append({"step": "parameters", "ok": True, "inputs": list(test_inputs.keys())})
                # If workflow has no user inputs, inject a generic query key
                if not test_inputs:
                    test_inputs["query"] = "ping"
                    steps[-1]["inputs"] = list(test_inputs.keys())
            else:
                body = param_resp.text[:300]
                steps.append({"step": "parameters", "ok": False, "status": param_resp.status_code, "body": body})
                # Fallback: try common workflow input variable names
                test_inputs["query"] = "ping"
                test_inputs["sys.query"] = "ping"
        except Exception as exc:
            steps.append({"step": "parameters", "ok": False, "error": str(exc)[:120]})
            test_inputs["query"] = "ping"
            test_inputs["sys.query"] = "ping"

        # Step 3: Test the matched endpoint
        mode_endpoints = {
            "chat": ("/chat-messages", {"inputs": test_inputs, "query": "ping", "response_mode": "blocking", "user": user}),
            "agent-chat": ("/chat-messages", {"inputs": test_inputs, "query": "ping", "response_mode": "blocking", "user": user}),
            "advanced-chat": ("/chat-messages", {"inputs": test_inputs, "query": "ping", "response_mode": "blocking", "user": user}),
            "completion": ("/completion-messages", {"inputs": test_inputs, "response_mode": "blocking", "user": user}),
            "workflow": ("/workflows/run", {"inputs": test_inputs, "response_mode": "blocking", "user": user}),
        }

        fallback_endpoints = [
            ("/chat-messages", {"inputs": test_inputs, "query": "ping", "response_mode": "blocking", "user": user}),
            ("/completion-messages", {"inputs": test_inputs, "response_mode": "blocking", "user": user}),
            ("/workflows/run", {"inputs": test_inputs, "response_mode": "blocking", "user": user}),
        ]

        to_try = []
        if app_mode in mode_endpoints:
            to_try.append(mode_endpoints[app_mode])
        for ep in fallback_endpoints:
            if ep[0] not in [t[0] for t in to_try]:
                to_try.append(ep)

        attempt_results = []
        for path, body in to_try:
            try:
                resp = await client.post(f"{base_url}{path}", headers=headers, json=body)
                status = resp.status_code
                try:
                    detail = resp.json()
                    msg = detail.get("message", "") or str(detail)[:200]
                except Exception:
                    msg = resp.text[:200]
                attempt_results.append({"path": path, "status": status, "message": msg})
                if status == 200:
                    return ok({"success": True, "message": f"OK via {path} (mode: {app_mode})", "steps": steps, "attempts": attempt_results})
            except Exception as exc:
                attempt_results.append({"path": path, "status": 0, "message": str(exc)[:120]})

        return ok({
            "success": False,
            "message": f"Failed. Mode: {app_mode}, inputs: {list(test_inputs.keys())}",
            "steps": steps,
            "attempts": attempt_results,
            "hint": "Check: 1) App published? 2) API Secret = API Secret not App ID? 3) Required input fields exist?"
        })


@router.post("/{agent_id}/chat")
def api_agent_chat(agent_id: int, payload: AgentChatRequest, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    agent = get_agent(db, agent_id)

    # Dify mode
    if agent.use_dify and agent.dify_api_key_cipher:
        try:
            uid = _current[0].user_id if hasattr(_current[0], "user_id") else "admin"
            result = dify_chat_completion(agent, user_message=payload.message, variables=payload.variables,
                                           conversation_id=payload.variables.get("conversation_id", "") if payload.variables else "",
                                           user_id=str(uid))
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
        return ok(AgentChatResponse(reply=result["reply"], model_name="Dify", usage=result["usage"]).model_dump())

    # Direct LLM mode
    if not agent.model_config_id or not agent.model_config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This agent has no model bound")
    if not agent.model_config.api_key_cipher:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Model [{agent.model_config.display_name}] has no API Key configured")
    try:
        result = chat_completion(agent.model_config, system_prompt=build_agent_harness_system_prompt(agent), variables=payload.variables,
            memory=[], user_message=payload.message, temperature=agent.temperature, max_tokens=agent.max_tokens,
            top_p=agent.top_p, frequency_penalty=agent.frequency_penalty, presence_penalty=agent.presence_penalty)
    except RuntimeError as exc:
        detail = _enhance_error(agent.model_config.model_identifier, str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    return ok(AgentChatResponse(reply=result["reply"], model_name=agent.model_config.display_name, usage=result["usage"]).model_dump())
