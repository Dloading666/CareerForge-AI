"""Agent API (public)"""
import json
from typing import Any, AsyncIterator, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.admin.agent_service import build_agent_harness_system_prompt, get_agent, get_agent_dict, list_agents
from app.admin.agent_schemas import AgentChatRequest, AgentChatResponse
from app.admin.model_service import decrypt_api_key
from app.auth.service import get_current_identity
from app.core.llm_client import chat_completion
from app.core.dify_client import dify_chat_completion
from app.core.response import ok
from app.infra.db import get_db

router = APIRouter(prefix="/agents", tags=["agents"])


def _sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def _stream_agent_reply(agent, message: str, variables: dict[str, Any]) -> AsyncIterator[str]:
    """SSE 流式输出单体智能体回复。direct LLM 走真流式，Dify 走 blocking 后整段下发。"""
    # Dify 模式：当前 SDK 是 blocking，拿到整段后一次性下发
    if agent.use_dify and agent.dify_api_key_cipher:
        try:
            result = dify_chat_completion(agent, user_message=message, variables=variables)
            yield _sse("delta", {"text": result.get("reply") or ""})
        except Exception as exc:  # noqa: BLE001
            yield _sse("error", {"message": str(exc)[:200]})
        yield _sse("done", {})
        return

    model = agent.model_config
    if not model or not model.api_key_cipher:
        yield _sse("error", {"message": "该智能体暂未配置可用模型"})
        yield _sse("done", {})
        return

    system_prompt = build_agent_harness_system_prompt(agent)
    for key, value in (variables or {}).items():
        system_prompt = system_prompt.replace(f"{{{{{key}}}}}", str(value))

    api_key = decrypt_api_key(model.api_key_cipher)
    payload = {
        "model": model.model_identifier,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        "temperature": agent.temperature,
        "max_tokens": agent.max_tokens,
        "top_p": agent.top_p,
        "stream": True,
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=120, write=30, pool=5)) as client:
            async with client.stream(
                "POST",
                f"{(model.base_url or '').rstrip('/')}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        obj = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    delta = (obj.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                    if delta:
                        yield _sse("delta", {"text": delta})
    except Exception as exc:  # noqa: BLE001
        yield _sse("error", {"message": str(exc)[:200]})
    yield _sse("done", {})

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
def api_public_list(category: Optional[str] = Query(None), search: Optional[str] = Query(None), db: Session = Depends(get_db)):
    return ok(list_agents(db, category=category, search=search, published_only=True))

@router.get("/{agent_id}")
def api_public_get(agent_id: int, db: Session = Depends(get_db)):
    data = get_agent_dict(db, agent_id)
    if not data["is_enabled"] or not data["is_published"]:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Smart agent not available")
    return ok(data)

@router.post("/{agent_id}/chat")
def api_public_chat(agent_id: int, payload: AgentChatRequest, db: Session = Depends(get_db), _identity=Depends(get_current_identity)):
    agent = get_agent(db, agent_id)
    if not agent.is_enabled or not agent.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Smart agent not available")

    # Dify mode
    if agent.use_dify and agent.dify_api_key_cipher:
        try:
            result = dify_chat_completion(agent, user_message=payload.message, variables=payload.variables,
                                           conversation_id=payload.variables.get("conversation_id", "") if payload.variables else "",
                                           user_id=str(_identity[0].id) if _identity and _identity[0] else "student")
        except RuntimeError as exc:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc))
        return ok(AgentChatResponse(reply=result["reply"], model_name="Dify", usage=result["usage"]).model_dump())

    # Direct LLM mode
    if not agent.model_config_id or not agent.model_config:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="This agent is temporarily unavailable")
    if not agent.model_config.api_key_cipher:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="This agent is temporarily unavailable")
    try:
        result = chat_completion(agent.model_config, system_prompt=build_agent_harness_system_prompt(agent), variables=payload.variables,
            memory=[], user_message=payload.message, temperature=agent.temperature, max_tokens=agent.max_tokens,
            top_p=agent.top_p, frequency_penalty=agent.frequency_penalty, presence_penalty=agent.presence_penalty)
    except RuntimeError as exc:
        detail = _enhance_error(agent.model_config.model_identifier, str(exc))
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)
    return ok(AgentChatResponse(reply=result["reply"], model_name=agent.model_config.display_name, usage=result["usage"]).model_dump())


@router.post("/{agent_id}/chat/stream")
async def api_public_chat_stream(
    agent_id: int,
    payload: AgentChatRequest,
    db: Session = Depends(get_db),
    _identity=Depends(get_current_identity),
):
    agent = get_agent(db, agent_id)
    if not agent.is_enabled or not agent.is_published:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Smart agent not available")
    return StreamingResponse(
        _stream_agent_reply(agent, payload.message, payload.variables or {}),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
