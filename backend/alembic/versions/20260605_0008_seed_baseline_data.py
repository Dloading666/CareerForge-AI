"""统一基线数据 seed：模型广场 / 智能体广场 / 主智能体路由（不含任何 API Key）

让所有团队成员 `alembic upgrade head` 后获得相同的模型、智能体、路由配置。
- 幂等：按自然键判断是否已存在，存在则跳过，不会破坏本地已有数据。
- 安全：不写入任何 api_key_cipher / dify_api_key_cipher，密钥需各自在「模型广场」UI 补填。
"""

from alembic import op
import sqlalchemy as sa

revision = "20260605_0008"
down_revision = "20260605_0006"
branch_labels = None
depends_on = None


# ── 模型广场（不含 API Key，需 UI 补填）────────────────────────────────────────
MODELS = [
    {
        "tenant_id": 0,
        "display_name": "deepseek-v4-pro[1m]",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "text",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com",
        "model_identifier": "deepseek-v4-pro[1m]",
        "default_temp": 0.7,
        "max_output": 4096,
        "timeout_sec": 30,
        "open_to_student": 1,
        "status": "active",
    },
    {
        "tenant_id": 0,
        "display_name": "mimo-v2.5",
        "provider": "小米",
        "deploy_type": "cloud",
        "capability": "multimodal",
        "protocols": "openai",
        "base_url": "https://token-plan-cn.xiaomimimo.com/v1",
        "model_identifier": "mimo-v2.5",
        "default_temp": 0.7,
        "max_output": 4096,
        "timeout_sec": 30,
        "open_to_student": 1,
        "status": "active",
    },
]

# ── 主智能体路由规则 ───────────────────────────────────────────────────────────
ROUTE_RULES = [
    {
        "tenant_id": 0,
        "intent": "学生需要模拟面试、面试复盘或面试练习时调用",
        "target_agent_key": "interview",
        "target_agent_name": "AI 面试官",
        "target_provider": "builtin",
        "memory_strategy": "isolated",
        "priority": 10,
        "enabled": 1,
    },
    {
        "tenant_id": 0,
        "intent": "学生需要岗位推荐、JD 分析或职位匹配时调用",
        "target_agent_key": "matching",
        "target_agent_name": "岗位匹配",
        "target_provider": "builtin",
        "memory_strategy": "summary_only",
        "priority": 8,
        "enabled": 1,
    },
    {
        "tenant_id": 0,
        "intent": "学生需要简历优化、项目经历改写或简历建议时调用",
        "target_agent_key": "resume",
        "target_agent_name": "简历优化",
        "target_provider": "builtin",
        "memory_strategy": "summary_only",
        "priority": 6,
        "enabled": 1,
    },
]

# ── 智能体广场（model_config_id 在 upgrade 时动态解析为默认模型）────────────────
AGENTS = [
    {
        "name": "AI 面试官",
        "description": "模拟真实面试官提问，逐题点评，生成复盘报告",
        "category": "interview",
        "icon_name": "record_voice_over",
        "icon_color_from": "#7C4DFF",
        "icon_color_to": "#2962FF",
        "welcome_message": "你好！我是 AI 面试官，请告诉我你想面试的岗位和方向。",
        "suggested_questions": "[\"模拟 Java 后端面试\", \"前端开发面试常见问题\", \"产品经理面试要注意什么\"]",
        "prompt_variables": "[{\"name\": \"target_role\", \"label\": \"目标岗位\", \"required\": true, \"default\": \"\"}, {\"name\": \"experience_level\", \"label\": \"经验级别\", \"required\": false, \"default\": \"应届生\"}]",
        "system_prompt": "你是资深 AI 面试官，只负责提问、追问、评分建议和复盘，不直接修改任何简历或档案。根据 {{target_role}} 模拟面试，提问由浅入深，每次只问一个主问题，每题点评必须基于候选人回答证据。级别：{{experience_level}}。",
        "temperature": 0.7,
    },
    {
        "name": "岗位匹配",
        "description": "上传简历+目标岗位，算匹配度，给可解释理由与技能差距",
        "category": "job_search",
        "icon_name": "join_inner",
        "icon_color_from": "#FF6D00",
        "icon_color_to": "#DD2C00",
        "welcome_message": "你好！请提供简历和目标岗位 JD，我会进行多维度匹配度评估。",
        "suggested_questions": "[\"看看我和字节跳动 Java 岗的匹配度\", \"我的简历适合产品经理吗\"]",
        "prompt_variables": "[{\"name\": \"resume\", \"label\": \"简历内容\", \"required\": true, \"default\": \"\"}, {\"name\": \"jd\", \"label\": \"岗位 JD\", \"required\": true, \"default\": \"\"}]",
        "system_prompt": "你是岗位匹配分析师，只基于用户提供的简历和 JD 做证据化评估，不编造经历、录用结论或企业内部标准。输出匹配分、证据、缺口、风险和下一步补强建议。\n=== 简历 ===\n{{resume}}\n=== JD ===\n{{jd}}",
        "temperature": 0.3,
    },
    {
        "name": "简历优化",
        "description": "基于 JD 精准修饰简历，提升简历竞争力",
        "category": "job_search",
        "icon_name": "description",
        "icon_color_from": "#00BFA5",
        "icon_color_to": "#0091EA",
        "welcome_message": "你好！请提供简历内容和目标岗位 JD，我会运用 STAR 法则帮你优化。",
        "suggested_questions": "[\"帮我优化简历中的项目经历\", \"如何用 STAR 法则写简历\"]",
        "prompt_variables": "[{\"name\": \"resume\", \"label\": \"简历内容\", \"required\": true, \"default\": \"\"}, {\"name\": \"jd\", \"label\": \"岗位 JD\", \"required\": false, \"default\": \"\"}]",
        "system_prompt": "你是简历优化顾问，只能在用户提供的事实范围内改写表达，禁止新增未提供的项目、数据、奖项、职责或技术栈。根据 JD 和 STAR 法则给出可替换文案、修改理由和仍需用户补充确认的信息。\n=== 简历 ===\n{{resume}}\n=== JD ===\n{{jd}}",
        "temperature": 0.5,
    },
    {
        "name": "职业测评",
        "description": "MBTI + 霍兰德 + 技能评估，生成个性化职业发展报告",
        "category": "tools",
        "icon_name": "psychology",
        "icon_color_from": "#E040FB",
        "icon_color_to": "#7C4DFF",
        "welcome_message": "你好！我是职业规划顾问，通过对话了解你的性格、兴趣和能力。",
        "suggested_questions": "[\"我想做一次职业性格测试\", \"根据我的专业推荐职业\"]",
        "prompt_variables": None,
        "system_prompt": "你是职业规划顾问，只提供启发式测评、职业方向分析和行动建议，不把 MBTI、霍兰德等结果包装成医学或权威诊断。结论必须说明依据、置信度和需要继续验证的信息。",
        "temperature": 0.6,
    },
]

# 智能体默认绑定的模型（按 model_identifier 解析，找不到则 NULL）
DEFAULT_AGENT_MODEL_IDENTIFIER = "deepseek-v4-pro[1m]"


def upgrade():
    conn = op.get_bind()

    # 1) 模型广场 ── 按 (tenant_id, model_identifier) 幂等
    for m in MODELS:
        exists = conn.execute(
            sa.text(
                "SELECT id FROM model_config "
                "WHERE tenant_id = :tenant_id AND model_identifier = :model_identifier LIMIT 1"
            ),
            {"tenant_id": m["tenant_id"], "model_identifier": m["model_identifier"]},
        ).first()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO model_config "
                "(tenant_id, display_name, provider, deploy_type, capability, protocols, "
                " base_url, model_identifier, default_temp, max_output, timeout_sec, "
                " open_to_student, status, is_deleted) "
                "VALUES (:tenant_id, :display_name, :provider, :deploy_type, :capability, :protocols, "
                " :base_url, :model_identifier, :default_temp, :max_output, :timeout_sec, "
                " :open_to_student, :status, 0)"
            ),
            m,
        )

    # 2) 路由规则 ── 按 (tenant_id, target_agent_key) 幂等
    for r in ROUTE_RULES:
        exists = conn.execute(
            sa.text(
                "SELECT id FROM master_route_rule "
                "WHERE tenant_id = :tenant_id AND target_agent_key = :target_agent_key LIMIT 1"
            ),
            {"tenant_id": r["tenant_id"], "target_agent_key": r["target_agent_key"]},
        ).first()
        if exists:
            continue
        conn.execute(
            sa.text(
                "INSERT INTO master_route_rule "
                "(tenant_id, intent, target_agent_key, target_agent_name, target_provider, "
                " memory_strategy, priority, enabled) "
                "VALUES (:tenant_id, :intent, :target_agent_key, :target_agent_name, :target_provider, "
                " :memory_strategy, :priority, :enabled)"
            ),
            r,
        )

    # 3) 智能体广场 ── 按 name 幂等，model_config_id 动态解析
    model_row = conn.execute(
        sa.text(
            "SELECT id FROM model_config "
            "WHERE tenant_id = 0 AND model_identifier = :mid AND is_deleted = 0 LIMIT 1"
        ),
        {"mid": DEFAULT_AGENT_MODEL_IDENTIFIER},
    ).first()
    default_model_id = model_row[0] if model_row else None

    for a in AGENTS:
        exists = conn.execute(
            sa.text("SELECT id FROM agent WHERE name = :name AND is_deleted = 0 LIMIT 1"),
            {"name": a["name"]},
        ).first()
        if exists:
            continue
        params = dict(a)
        params["model_config_id"] = default_model_id
        conn.execute(
            sa.text(
                "INSERT INTO agent "
                "(name, description, category, icon_name, icon_color_from, icon_color_to, "
                " model_config_id, welcome_message, suggested_questions, prompt_variables, "
                " system_prompt, temperature, max_tokens, top_p, frequency_penalty, "
                " presence_penalty, memory_window, is_enabled, is_published, use_dify, is_deleted) "
                "VALUES (:name, :description, :category, :icon_name, :icon_color_from, :icon_color_to, "
                " :model_config_id, :welcome_message, :suggested_questions, :prompt_variables, "
                " :system_prompt, :temperature, 4096, 0.9, 0.0, 0.0, 10, 1, 1, 0, 0)"
            ),
            params,
        )


def downgrade():
    conn = op.get_bind()
    # 仅删除本迁移 seed 的精确自然键，避免误删用户后续手动新增的数据。
    for a in AGENTS:
        conn.execute(sa.text("DELETE FROM agent WHERE name = :name"), {"name": a["name"]})
    for r in ROUTE_RULES:
        conn.execute(
            sa.text(
                "DELETE FROM master_route_rule "
                "WHERE tenant_id = :tenant_id AND target_agent_key = :target_agent_key"
            ),
            {"tenant_id": r["tenant_id"], "target_agent_key": r["target_agent_key"]},
        )
    for m in MODELS:
        conn.execute(
            sa.text(
                "DELETE FROM model_config "
                "WHERE tenant_id = :tenant_id AND model_identifier = :model_identifier"
            ),
            {"tenant_id": m["tenant_id"], "model_identifier": m["model_identifier"]},
        )
