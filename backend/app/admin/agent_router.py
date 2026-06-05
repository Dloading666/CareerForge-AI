"""Agent API (admin)"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.admin.agent_service import (create_agent, delete_agent, get_agent, get_agent_dict, list_agents, toggle_agent, update_agent)
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
    app_id: str = ""

@router.post("/test-dify")
async def api_test_dify(payload: "DifyTestRequest", _current=Depends(require_role("admin"))):
    """Test Dify connection with provided credentials."""
    import httpx
    base_url = payload.api_base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            resp = await client.post(
                f"{base_url}/chat-messages",
                headers={"Authorization": f"Bearer {payload.api_key}", "Content-Type": "application/json"},
                json={"inputs": {}, "query": "ping", "response_mode": "blocking", "user": "admin-test"},
            )
        if resp.status_code == 200:
            return ok({"success": True, "message": "Connection successful"})
        elif resp.status_code == 401:
            try:
                detail = resp.json()
                err_msg = detail.get("message", "") or detail.get("error", "")
            except Exception:
                err_msg = ""
            hint = ""
            if "invalid" in str(err_msg).lower() or "unauthorized" in str(err_msg).lower():
                hint = " - Please use the API Secret from Dify App > API Access (not App ID)"
            return ok({"success": False, "message": f"Invalid API Key (401){hint}"})
        elif resp.status_code == 404:
            return ok({"success": False, "message": "App not found (404) - check Base URL path"})
        elif resp.status_code == 400:
            try:
                detail = resp.json()
                err_msg = detail.get("message", "") or str(detail)
            except Exception:
                err_msg = resp.text[:100]
            return ok({"success": False, "message": f"Bad request (400): {err_msg[:100]}"})
        else:
            return ok({"success": False, "message": f"HTTP {resp.status_code}: {resp.text[:100]}"})
    except httpx.ConnectError:
        return ok({"success": False, "message": "Cannot connect - check Base URL (is server reachable?)"})
    except httpx.TimeoutException:
        return ok({"success": False, "message": "Connection timed out"})
    except Exception as exc:
        return ok({"success": False, "message": str(exc)[:200]})

@router.post("/{agent_id}/chat")
def api_agent_chat(agent_id: int, payload: AgentChatRequest, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    agent = get_agent(db, agent_id)

    # Dify mode
    if agent.use_dify and agent.dify_api_key_cipher:
        try:
            result = dify_chat_completion(agent, user_message=payload.message, variables=payload.variables,
                                           conversation_id=payload.variables.get("conversation_id", "") if payload.variables else "")
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
        return ok(AgentChatResponse(reply=result["reply"], model_name="Dify", usage=result["usage"]).model_dump())

    # Direct LLM mode
    if not agent.model_config_id or not agent.model_config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This agent has no model bound")
    if not agent.model_config.api_key_cipher:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Model [{agent.model_config.display_name}] has no API Key configured")
    try:
        result = chat_completion(agent.model_config, system_prompt=agent.system_prompt, variables=payload.variables,
            memory=[], user_message=payload.message, temperature=agent.temperature, max_tokens=agent.max_tokens,
            top_p=agent.top_p, frequency_penalty=agent.frequency_penalty, presence_penalty=agent.presence_penalty)
    except RuntimeError as exc:
        detail = _enhance_error(agent.model_config.model_identifier, str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    return ok(AgentChatResponse(reply=result["reply"], model_name=agent.model_config.display_name, usage=result["usage"]).model_dump())
