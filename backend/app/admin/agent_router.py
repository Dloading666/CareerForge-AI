"""Agent API (admin)"""
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.admin.agent_service import (create_agent, delete_agent, get_agent, get_agent_dict, list_agents, toggle_agent, update_agent)
from app.admin.agent_schemas import AgentChatRequest, AgentChatResponse, AgentCreate, AgentToggle, AgentUpdate
from app.auth.service import require_role
from app.core.llm_client import chat_completion
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/admin/agents", tags=["admin-agents"])

# ── 已知模型名称建议映射 ──────────────────────────
_MODEL_SUGGESTIONS = {
    "deepseek-v4": "deepseek-v4-pro 或 deepseek-v4-flash",
}

def _enhance_error(model_identifier: str, original_detail: str) -> str:
    """为已知不支持的模型名称附加修复建议"""
    suggestion = _MODEL_SUGGESTIONS.get(model_identifier)
    if suggestion:
        return f"{original_detail}。提示：请将模型名称 \"{model_identifier}\" 更新为 \"{suggestion}\"（在管理后台 > 模型广场 中修改）"
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
    delete_agent(db, agent_id); return ok(msg="已删除")

@router.patch("/{agent_id}/toggle")
def api_toggle_agent(agent_id: int, payload: AgentToggle, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    return ok(toggle_agent(db, agent_id, is_enabled=payload.is_enabled))

@router.post("/{agent_id}/chat")
def api_agent_chat(agent_id: int, payload: AgentChatRequest, db: Session = Depends(get_db), _current=Depends(require_role("admin"))):
    agent = get_agent(db, agent_id)
    if not agent.model_config_id or not agent.model_config:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该智能体尚未绑定模型")
    if not agent.model_config.api_key_cipher:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"模型「{agent.model_config.display_name}」未配置 API Key")
    try:
        result = chat_completion(agent.model_config, system_prompt=agent.system_prompt, variables=payload.variables,
            memory=[], user_message=payload.message, temperature=agent.temperature, max_tokens=agent.max_tokens,
            top_p=agent.top_p, frequency_penalty=agent.frequency_penalty, presence_penalty=agent.presence_penalty)
    except RuntimeError as exc:
        detail = _enhance_error(agent.model_config.model_identifier, str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    return ok(AgentChatResponse(reply=result["reply"], model_name=agent.model_config.display_name, usage=result["usage"]).model_dump())
