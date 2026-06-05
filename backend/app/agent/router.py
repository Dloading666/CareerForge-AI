"""Agent API (public)"""
import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.admin.agent_service import get_agent, get_agent_dict, list_agents
from app.admin.agent_schemas import AgentChatRequest, AgentChatResponse
from app.auth.service import get_current_identity
from app.core.llm_client import chat_completion
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/agents", tags=["agents"])

# ── 已知模型名称建议映射 ──────────────────────────
_MODEL_SUGGESTIONS = {
    "deepseek-v4": "deepseek-v4-pro 或 deepseek-v4-flash",
}

def _enhance_error(model_identifier: str, original_detail: str) -> str:
    """为已知不支持的模型名称附加修复建议"""
    suggestion = _MODEL_SUGGESTIONS.get(model_identifier)
    if suggestion:
        return f"{original_detail}。提示：请将模型名称 "{model_identifier}" 更新为 "{suggestion}"（在管理后台 > 模型广场 中修改）"
    return original_detail


@router.get("")
def api_public_list(category: Optional[str] = Query(None), search: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return ok(list_agents(db, category=category, search=search, published_only=True))

@router.get("/{agent_id}")
def api_public_get(agent_id: int, db: Session = Depends(get_db)):
    data = get_agent_dict(db, agent_id)
    if not data["is_enabled"] or not data["is_published"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="智能体不可用")
    return ok(data)

@router.post("/{agent_id}/chat")
def api_public_chat(agent_id: int, payload: AgentChatRequest, db: Session = Depends(get_db), _identity=Depends(get_current_identity)):
    agent = get_agent(db, agent_id)
    if not agent.is_enabled or not agent.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="智能体不可用")
    if not agent.model_config_id or not agent.model_config:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="该智能体暂不可用")
    if not agent.model_config.api_key_cipher:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="该智能体暂不可用")
    try:
        result = chat_completion(agent.model_config, system_prompt=agent.system_prompt, variables=payload.variables,
            memory=[], user_message=payload.message, temperature=agent.temperature, max_tokens=agent.max_tokens,
            top_p=agent.top_p, frequency_penalty=agent.frequency_penalty, presence_penalty=agent.presence_penalty)
    except RuntimeError as exc:
        detail = _enhance_error(agent.model_config.model_identifier, str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    return ok(AgentChatResponse(reply=result["reply"], model_name=agent.model_config.display_name, usage=result["usage"]).model_dump())
