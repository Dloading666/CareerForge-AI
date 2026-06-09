"""Agent schemas"""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

AGENT_CATEGORIES = ["interview", "job_search", "tools", "other"]

class PromptVariableDef(BaseModel):
    name: str; label: str = ""; required: bool = False; default: str = ""

class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=256)
    category: str = Field(default="other")
    icon_name: Optional[str] = Field(default="smart_toy", max_length=64)
    icon_color_from: Optional[str] = Field(default="#7C4DFF", max_length=16)
    icon_color_to: Optional[str] = Field(default="#2962FF", max_length=16)
    model_config_id: Optional[int] = None
    welcome_message: Optional[str] = Field(default=None, max_length=512)
    suggested_questions: Optional[list[str]] = None
    prompt_variables: Optional[list[PromptVariableDef]] = None
    system_prompt: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=4096, ge=1, le=128000)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    frequency_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    presence_penalty: float = Field(default=0.0, ge=-2.0, le=2.0)
    memory_window: int = Field(default=10, ge=0, le=100)
    use_dify: bool = False
    dify_api_key: Optional[str] = Field(default=None, max_length=256)
    dify_api_base_url: Optional[str] = Field(default=None, max_length=512)
    is_enabled: bool = True; is_published: bool = True

class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    description: Optional[str] = Field(default=None, max_length=256)
    category: Optional[str] = None
    icon_name: Optional[str] = Field(default=None, max_length=64)
    icon_color_from: Optional[str] = Field(default=None, max_length=16)
    icon_color_to: Optional[str] = Field(default=None, max_length=16)
    model_config_id: Optional[int] = None
    welcome_message: Optional[str] = Field(default=None, max_length=512)
    suggested_questions: Optional[list[str]] = None
    prompt_variables: Optional[list[PromptVariableDef]] = None
    system_prompt: Optional[str] = None
    temperature: Optional[float] = Field(default=None, ge=0.0, le=2.0)
    max_tokens: Optional[int] = Field(default=None, ge=1, le=128000)
    top_p: Optional[float] = Field(default=None, ge=0.0, le=1.0)
    frequency_penalty: Optional[float] = Field(default=None, ge=-2.0, le=2.0)
    presence_penalty: Optional[float] = Field(default=None, ge=-2.0, le=2.0)
    memory_window: Optional[int] = Field(default=None, ge=0, le=100)
    use_dify: Optional[bool] = None
    dify_api_key: Optional[str] = Field(default=None, max_length=256)
    dify_api_base_url: Optional[str] = Field(default=None, max_length=512)
    is_enabled: Optional[bool] = None; is_published: Optional[bool] = None

class AgentToggle(BaseModel): is_enabled: bool
class AgentChatRequest(BaseModel): message: str = Field(min_length=1, max_length=8192); variables: dict = {}
class AgentChatResponse(BaseModel):
    reply: str; model_name: str; usage: Optional[dict] = None
