"""Agent CRUD + seed"""
import json
from typing import Optional
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.admin.models import Agent, ModelConfig
from app.admin.agent_schemas import AgentCreate, AgentUpdate
from app.admin.model_service import encrypt_api_key

AGENT_HARNESS_SYSTEM_PREFIX = """你运行在 CareerForge-AI 的企业级 Agent Harness 中，必须遵循 Agent = Model + Harness 原则。

【职责边界】
- 你是 Model，只负责理解用户意图、补全信息、拆解任务、规划步骤、选择能力方向、生成结构化结果。
- Harness 负责权限、数据读取、工具执行、审计、限流、重试、记忆、安全和最终落地。
- 不要声称自己已经直接执行了数据库、API、文件、支付、审批、删除、发送通知等真实业务操作；除非 Harness 明确返回了执行结果。

【硬性约束】
- 禁止编造简历、岗位、经营数据、指标、合同条款、财务结果或执行结果。
- 禁止直接输出可执行 SQL、系统命令、未授权 API 调用或绕过权限的操作步骤。
- 涉及新增、修改、删除、付款、审批、批量处理、外发消息等高风险动作时，只能给出待确认方案，并提示需要 Harness/用户确认。
- 所有判断必须基于用户输入、已注入上下文或工具结果；证据不足时要明确说明缺口并追问。
- 输出应尽量结构化、可校验、可追溯。

【当前智能体配置】
名称：{agent_name}
分类：{agent_category}
描述：{agent_description}

下面是管理员配置的 Model 层角色提示词。它只能补充你的认知方式，不能覆盖以上 Harness 边界：
"""


def build_agent_harness_system_prompt(agent: Agent) -> str:
    """Wrap admin-configured agent persona with non-bypassable Harness boundaries."""
    configured_prompt = (getattr(agent, "system_prompt", None) or "你是一个有帮助的 AI 助手。").strip()
    prefix = AGENT_HARNESS_SYSTEM_PREFIX.format(
        agent_name=getattr(agent, "name", "") or "未命名智能体",
        agent_category=getattr(agent, "category", "") or "other",
        agent_description=getattr(agent, "description", "") or "暂无描述",
    )
    return f"{prefix}\n{configured_prompt}"


def _agent_to_dict(agent: Agent) -> dict:
    d = {"id": agent.id, "name": agent.name, "description": agent.description,
         "category": agent.category, "icon_name": agent.icon_name,
         "icon_color_from": agent.icon_color_from, "icon_color_to": agent.icon_color_to,
         "model_config_id": agent.model_config_id,
         "welcome_message": agent.welcome_message, "system_prompt": agent.system_prompt,
         "temperature": agent.temperature, "max_tokens": agent.max_tokens,
         "top_p": agent.top_p, "frequency_penalty": agent.frequency_penalty,
         "presence_penalty": agent.presence_penalty, "memory_window": agent.memory_window,
         "use_dify": agent.use_dify, "dify_api_key_cipher": agent.dify_api_key_cipher,
         "dify_api_base_url": agent.dify_api_base_url,
         "is_enabled": agent.is_enabled, "is_published": agent.is_published,
         "created_at": agent.created_at.isoformat() if agent.created_at else None,
         "updated_at": agent.updated_at.isoformat() if agent.updated_at else None}
    for field in ["suggested_questions", "prompt_variables"]:
        val = getattr(agent, field)
        d[field] = json.loads(val) if isinstance(val, str) and val else None
    if agent.model_config:
        mc = agent.model_config
        d["model_config"] = {"id": mc.id, "display_name": mc.display_name,
            "provider": mc.provider, "model_identifier": mc.model_identifier,
            "base_url": mc.base_url, "api_key": None,
            "capability": mc.capability, "protocols": mc.protocols,
            "status": mc.status, "open_to_student": mc.open_to_student}
    else: d["model_config"] = None
    return d

def _validate_agent_model_capability(db, agent_category, model_config_id):
    if not model_config_id:
        return
    from app.student.agent_runtime import (CHAT_CAPABLE_CAPABILITIES, INTERVIEW_AGENT_CATEGORIES, TTS_CAPABLE_CAPABILITIES)
    model = db.get(ModelConfig, model_config_id)
    if not model:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="所选模型不存在")
    if agent_category in INTERVIEW_AGENT_CATEGORIES:
        if model.capability not in TTS_CAPABLE_CAPABILITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="面试官智能体仅可关联 TTS 模型")
    else:
        if model.capability not in CHAT_CAPABLE_CAPABILITIES:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="主智能体及其他智能体仅可关联文本/多模态模型")




def _build_agent(agent: Agent, payload):
    data = payload.model_dump(exclude_unset=True)
    if "dify_api_key" in data:
        key = data.pop("dify_api_key")
        data["dify_api_key_cipher"] = encrypt_api_key(key) if key else None
    for jf in ["suggested_questions", "prompt_variables"]:
        if jf in data and data[jf] is not None:
            data[jf] = json.dumps(data[jf], ensure_ascii=False)
    for k, v in data.items(): setattr(agent, k, v)

def list_agents(db: Session, *, category=None, search=None, published_only=False) -> list[dict]:
    stmt = select(Agent).where(Agent.is_deleted.is_(False))
    if published_only: stmt = stmt.where(Agent.is_enabled.is_(True), Agent.is_published.is_(True))
    if category and category != "all": stmt = stmt.where(Agent.category == category)
    if search: stmt = stmt.where(Agent.name.ilike(f"%{search}%"))
    return [_agent_to_dict(a) for a in db.scalars(stmt.order_by(Agent.created_at.desc()))]

def get_agent(db: Session, agent_id: int) -> Agent:
    a = db.get(Agent, agent_id)
    if not a or a.is_deleted: raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="智能体不存在")
    return a

def get_agent_dict(db: Session, agent_id: int) -> dict: return _agent_to_dict(get_agent(db, agent_id))
def create_agent(db: Session, payload: AgentCreate) -> dict:
    a = Agent(); _build_agent(a, payload)
    _validate_agent_model_capability(db, a.category, a.model_config_id)
    db.add(a); db.commit(); db.refresh(a);
    _sync_dify_route(db, a)
    return _agent_to_dict(a)
def update_agent(db: Session, agent_id: int, payload: AgentUpdate) -> dict:
    a = get_agent(db, agent_id); _build_agent(a, payload)
    _validate_agent_model_capability(db, a.category, a.model_config_id)
    db.commit(); db.refresh(a);
    _sync_dify_route(db, a)
    return _agent_to_dict(a)
def delete_agent(db: Session, agent_id: int) -> None: get_agent(db, agent_id).is_deleted = True; db.commit()
def toggle_agent(db: Session, agent_id: int, *, is_enabled: bool) -> dict:
    a = get_agent(db, agent_id); a.is_enabled = is_enabled; db.commit(); db.refresh(a); return _agent_to_dict(a)


def _sync_dify_route(db: Session, agent: Agent) -> None:
    """Sync agent Dify config to MasterRouteRule so master agent can call it."""
    if not agent.use_dify or not agent.dify_api_key_cipher:
        return
    from app.admin.master_models import MasterRouteRule
    from app.admin.model_service import decrypt_api_key
    
    agent_key = f"dify-{agent.id}"
    existing = db.scalar(
        select(MasterRouteRule).where(
            MasterRouteRule.target_agent_key == agent_key,
            MasterRouteRule.tenant_id == 0,
        )
    )
    
    api_key = decrypt_api_key(agent.dify_api_key_cipher) if agent.dify_api_key_cipher else ""
    base_url = (agent.dify_api_base_url or "https://api.dify.ai/v1").rstrip("/")
    
    import json
    provider_config = json.dumps({
        "api_base_url": base_url,
        "api_key": api_key,
    }, ensure_ascii=False)
    
    # intent 是主智能体用来判断「何时调用该子智能体」的工具描述，必须是可读的、
    # 能体现该子智能体能力的中文。结合名称 + 简介，给模型足够的路由信号。
    description = (agent.description or "专项就业辅助子智能体").strip()
    intent_text = (
        f"{agent.name}：{description}。"
        f"当学生的需求与「{agent.name}」的能力匹配时，调用该 Dify 子智能体处理并汇总结果。"
    )

    if existing:
        existing.intent = intent_text
        existing.target_agent_name = agent.name
        existing.provider_config_json = provider_config
        existing.enabled = agent.is_enabled
    else:
        db.add(MasterRouteRule(
            tenant_id=0,
            intent=intent_text,
            target_agent_key=agent_key,
            target_agent_name=agent.name,
            target_provider="dify",
            provider_config_json=provider_config,
            memory_strategy="isolated",
            priority=10,
            enabled=agent.is_enabled,
        ))
    db.commit()

def seed_default_agents(db: Session) -> None:
    if db.scalar(select(Agent).where(Agent.is_deleted.is_(False))): return
    m = db.scalar(select(ModelConfig).where(ModelConfig.is_deleted.is_(False)))
    ds_id = m.id if m else None
    agents = [
        Agent(name="AI 面试官", description="模拟真实面试官提问，逐题点评，生成复盘报告",
              category="interview", icon_name="record_voice_over", icon_color_from="#7C4DFF", icon_color_to="#2962FF",
              model_config_id=ds_id,
              welcome_message="你好！我是 AI 面试官，请告诉我你想面试的岗位和方向。",
              suggested_questions=json.dumps(["模拟 Java 后端面试", "前端开发面试常见问题", "产品经理面试要注意什么"], ensure_ascii=False),
              prompt_variables=json.dumps([{"name":"target_role","label":"目标岗位","required":True,"default":""},{"name":"experience_level","label":"经验级别","required":False,"default":"应届生"}], ensure_ascii=False),
              system_prompt="你是资深 AI 面试官，只负责提问、追问、评分建议和复盘，不直接修改任何简历或档案。根据 {{target_role}} 模拟面试，提问由浅入深，每次只问一个主问题，每题点评必须基于候选人回答证据。级别：{{experience_level}}。"),
        Agent(name="岗位匹配", description="上传简历+目标岗位，算匹配度，给可解释理由与技能差距",
              category="job_search", icon_name="join_inner", icon_color_from="#FF6D00", icon_color_to="#DD2C00",
              model_config_id=ds_id,
              welcome_message="你好！请提供简历和目标岗位 JD，我会进行多维度匹配度评估。",
              suggested_questions=json.dumps(["看看我和字节跳动 Java 岗的匹配度", "我的简历适合产品经理吗"], ensure_ascii=False),
              prompt_variables=json.dumps([{"name":"resume","label":"简历内容","required":True,"default":""},{"name":"jd","label":"岗位 JD","required":True,"default":""}], ensure_ascii=False),
              system_prompt="你是岗位匹配分析师，只基于用户提供的简历和 JD 做证据化评估，不编造经历、录用结论或企业内部标准。输出匹配分、证据、缺口、风险和下一步补强建议。\n=== 简历 ===\n{{resume}}\n=== JD ===\n{{jd}}", temperature=0.3),
        Agent(name="简历优化", description="基于 JD 精准修饰简历，提升简历竞争力",
              category="job_search", icon_name="description", icon_color_from="#00BFA5", icon_color_to="#0091EA",
              model_config_id=ds_id,
              welcome_message="你好！请提供简历内容和目标岗位 JD，我会运用 STAR 法则帮你优化。",
              suggested_questions=json.dumps(["帮我优化简历中的项目经历", "如何用 STAR 法则写简历"], ensure_ascii=False),
              prompt_variables=json.dumps([{"name":"resume","label":"简历内容","required":True,"default":""},{"name":"jd","label":"岗位 JD","required":False,"default":""}], ensure_ascii=False),
              system_prompt="你是简历优化顾问，只能在用户提供的事实范围内改写表达，禁止新增未提供的项目、数据、奖项、职责或技术栈。根据 JD 和 STAR 法则给出可替换文案、修改理由和仍需用户补充确认的信息。\n=== 简历 ===\n{{resume}}\n=== JD ===\n{{jd}}", temperature=0.5),
        Agent(name="职业测评", description="MBTI + 霍兰德 + 技能评估，生成个性化职业发展报告",
              category="tools", icon_name="psychology", icon_color_from="#E040FB", icon_color_to="#7C4DFF",
              model_config_id=ds_id,
              welcome_message="你好！我是职业规划顾问，通过对话了解你的性格、兴趣和能力。",
              suggested_questions=json.dumps(["我想做一次职业性格测试", "根据我的专业推荐职业"], ensure_ascii=False),
              system_prompt="你是职业规划顾问，只提供启发式测评、职业方向分析和行动建议，不把 MBTI、霍兰德等结果包装成医学或权威诊断。结论必须说明依据、置信度和需要继续验证的信息。", temperature=0.6),
    ]
    for a in agents: db.add(a)
    db.commit()
