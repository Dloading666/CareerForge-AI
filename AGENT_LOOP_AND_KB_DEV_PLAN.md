# 主智能体 Agentic 改造 + 知识库对接 — 后续开发计划

> 目标：把学生端主智能体从「关键词预规划 + 单轮调用」升级为「像 Claude Code 一样的 Agentic Loop」——主智能体自主推理、自主、准确地选择并调用合适的工具（Skill / MCP / 子智能体 / 知识库检索）来帮学生解决问题。
>
> 关联文档：`STUDENT_MASTER_AGENT_DEV_REPORT.md`（现状）、`MODEL_PLAZA_DEV_DOC.md`（模型广场）、`CLAUDE.md`（架构索引）。

---

## 1. 背景与现状诊断

### 1.1 现状（一句话）
后端 `student/agent_runtime.py` 用 `_plan_tool_calls()` 做**中文关键词匹配**来决定调哪些工具，调用完一次性把结果拼进 prompt，再调一次 LLM 出最终答复。**模型从头到尾没有参与"选工具"这件事**，这与产品目标背道而驰。

### 1.2 关键发现：数据模型早就为 Agentic Loop 设计好了
现有 schema 的设计意图与目标完全一致，只是 runtime 没实现：

| 字段 | 位置 | 设计意图（注释原文） |
|------|------|----------------------|
| `max_iterations` | `MasterAgentConfig` | "Agent Loop 最大轮次，Harness 硬边界，防止 ReAct 死循环" |
| `permission_mode` | `MasterAgentConfig` | "全局四态权限默认模式：auto / ask / strict" |
| `memory_isolation` | `MasterAgentConfig` | "子智能体记忆独立隔离" |
| `intent` | `MasterRouteRule` | "Model 读取此描述来决定何时调用…**不是 if-else 路由匹配**，而是 Model 自主选择的工具池条目" |

→ 改造主要是**补齐 runtime 的循环实现**，而非推翻数据模型。

### 1.3 四类工具的就绪度
| 工具源 | 存储 | 当前执行 | 需要做的 |
|--------|------|----------|----------|
| 内置工具 | `BUILTIN_TOOLS`（已带 JSON schema） | 部分真实、部分占位 | 接真实数据源 |
| **Skill** | `skill_asset`，存完整 Markdown（frontmatter: name/description/tags/slug） | 返回内容摘要 | 改为 Claude Code 式「按需加载指令」 |
| **MCP** | `mcp_service` 存真实 `transport/endpoint/auth`，`mcp_tool` 存 `input_schema_json` | **`call_tool` / `test_service` 全是假的**，从不真连 | 写真实 MCP 客户端 |
| **子智能体** | `master_route_rule`（builtin / dify） | builtin 占位，dify 真实 HTTP | builtin 落地 + 接入 loop |
| **知识库** | **完全没有** | `query_knowledge_base` 返回占位串 | 对接 Dify 数据集 |

---

## 2. 目标架构：Agentic Loop（OpenAI Function Calling）

```
┌─────────────────────────────────────────────────────────────┐
│  stream_master_reply (SSE)                                    │
│                                                               │
│  组装工具池(tools schema) ─┐                                  │
│       内置 + Skill + MCP + 子智能体 + retrieve_knowledge      │
│                            ↓                                   │
│  ┌──────── Agent Loop (≤ max_iterations) ───────────────┐    │
│  │  1. 调 LLM /chat/completions  (带 tools 参数, stream) │    │
│  │  2. 模型返回:                                          │    │
│  │       ├─ 纯文本 → 流式输出 → 结束循环                  │    │
│  │       └─ tool_calls → 执行工具 → 结果作为 role=tool   │    │
│  │          消息回灌 → 回到步骤 1                          │    │
│  │  3. 每个 tool_call 发 activity.* SSE 事件             │    │
│  └───────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**与 Claude Code 的对应关系**：
- 模型自主决定调用哪个工具 = OpenAI `tools` / `tool_calls`（function calling）
- 工具结果回灌 = `role: "tool"` 消息
- `max_iterations` = Harness 硬边界，防死循环
- Skill 按需加载 = progressive disclosure（名称+描述常驻，调用时才注入完整 SKILL.md）
- 子智能体独立上下文 = `memory_isolation`，只回流结果摘要

---

## 3. 关键设计决策

### 3.1 已确认决策
| 决策 | 选择 |
|------|------|
| 知识库后端 | **挂 Dify 知识库**（用 Dify 数据集检索 API，不自建向量库/embedding/分块） |
| 知识库作用域 | **共享检索 + 子智能体可绑定专属库**（主智能体可查全部开放库；子智能体可绑定特定 collection） |

### 3.2 待落地的默认决策（开发中确认）
| 议题 | 默认方案 | 备注 |
|------|----------|------|
| 模型 function-calling 检测 | 优先用原生 `tools`；不支持的模型回退到 **ReAct prompt 解析**（模型输出 JSON，我们解析） | `ModelConfig` 无 function-calling 标记字段，先按 provider/protocol 推断，建议加一个 `supports_tools` 字段 |
| Skill 语义 | Claude Code 式：description 常驻工具池，调用时把 `SKILL.md` 内容注入上下文，模型再据此用其他工具 | 复用 `serialize_skill()` 的 `content` |
| 权限/确认 | v1：低风险自动执行；高风险（`send_notification`、MCP 写操作）走确认事件 | 复用 `permission_mode` |
| 工具命名空间 | `builtin__*` / `skill__<slug>` / `mcp__<service>__<tool>` / `agent__<key>` / `kb__retrieve` | 防重名，对齐现有 `_tool_safe_name` |

---

## 4. 分阶段开发计划

> 原则：每个阶段**独立可上线、可回滚**，先把闭环跑通再加真实数据源。

### Phase 1 — Agentic Loop 内核（核心，最高优先级）
**目标**：用真实 function-calling 循环替换 `_plan_tool_calls` 单轮逻辑，先只接「内置工具 + 子智能体」。

**改动**：
- `student/agent_runtime.py`
  - 新增 `run_agent_loop()`：循环调用 LLM（带 `tools`）→ 解析 `tool_calls` → `_execute_tool_call` → 回灌 `role=tool` 消息 → 直到无 tool_calls 或触顶 `max_iterations`。
  - `_stream_llm_response` 扩展：请求体加 `tools` / `tool_choice`，流式解析 `delta.tool_calls`（增量拼接 function name/arguments）。
  - 保留并复用现有 SSE 事件（`activity.started/completed/failed`、`message.delta/completed`、`done`）。
  - 删除/降级 `_plan_tool_calls` 关键词逻辑（可保留为 fallback 模型的兜底）。
- `ToolDefinition` → 增加 `to_openai_schema()`，把 `BUILTIN_TOOLS` 和 `master_route_rule` 转成 OpenAI function 格式。
- 读取 `MasterAgentConfig.max_iterations` 作为循环上限。

**验收**：学生问"帮我看看和字节后端的匹配度"，后端日志能看到模型**自己**发起 `query_job_positions` + `query_student_profile` 的 tool_calls（而非关键词命中），SSE 正确推送活动行与最终答复。

---

### Phase 2 — Skill 作为「按需加载指令」工具
**目标**：每个启用的 Skill 成为工具池一员；模型决定调用时，把 `SKILL.md` 全文注入上下文。

**改动**：
- `assemble_tool_pool()`：Skill → function schema，名称 `skill__<slug>`，description 取 frontmatter description。
- `_execute_tool_call` 中 skill 分支：返回 `serialize_skill()` 的完整 `content` 作为 tool result（而非现在的一句摘要）。
- 控制注入体积（复用 `skill_max_content_bytes`），超长截断。

**验收**：上传一份简历，模型自主调用「简历优化 Skill」，回答中体现 SKILL.md 里的方法论。

---

### Phase 3 — 知识库对接（Dify 数据集）
**目标**：补齐管理端「知识库」菜单的后端；主/子智能体通过 `retrieve_knowledge` 工具检索 Dify 数据集。

**新增后端模块 `backend/app/kb/`**（沿用 `tenant_id` 隔离、零 FK、软删除约定）：
- `models.py` → `KbCollection`：`tenant_id / name / slug / description / dify_base_url / dify_dataset_id / dify_api_key_cipher / open_to_student / status / is_deleted`
- `schemas.py` / `service.py` / `router.py`（prefix `/admin`，`require_role("admin")` 的 CRUD + 检索测试）
- 检索适配器：`retrieve(collection, query, top_k)` → 调 Dify **数据集检索 API**
  `POST {dify_base}/v1/datasets/{dataset_id}/retrieve`，Header `Authorization: Bearer {知识库 API Key}`，Body `{"query": ..., "retrieval_model": {...}}`，解析 `records[].segment.content`。
  > ⚠️ 数据集 API Key ≠ 应用 API Key；具体端点字段以你部署的 Dify 版本为准，需联调验证。

**子智能体绑定专属库**：
- `master_route_rule` 加列 `kb_collection_ids`（JSON）。
- builtin 子智能体执行时，注入只能访问绑定 collection 的 `retrieve_knowledge`。
- dify 子智能体若在 Dify 内已挂数据集，则主智能体只管 `invoke_agent` 委派，检索在 Dify 内部完成。

**工具接入 loop**：
- 主智能体工具池 += `kb__retrieve(query, collection?)`，可查全部 `open_to_student` 的 collection。
- 替换 `query_knowledge_base` 占位实现。

**前端**：
- `admin/` 新增知识库管理页（collection CRUD + 检索测试），接入 `AdminHomePage` 导航。
- 子智能体/路由配置页加「绑定知识库」多选。

**验收**：管理员配好一个 Dify 政策数据集 → 学生问"三方违约金怎么算" → 模型自主调 `kb__retrieve(query, "政策库")` → 答复引用检索片段。

---

### Phase 4 — MCP 真实执行
**目标**：把 `mcp/service.py` 里**假的** `call_tool` / `test_service` 换成真实 MCP 协议客户端。

**改动**：
- 新增 MCP 客户端（建议引入官方 `mcp` Python SDK 或自写 JSON-RPC over Streamable HTTP），按 `transport`（Streamable HTTP / SSE / stdio）连 `endpoint`，带 `auth_config` 鉴权。
- `discover_tools` → 真实 `tools/list`；`call_tool` → 真实 `tools/call`，写入 `mcp_call_log`。
- `assemble_tool_pool()`：启用的 `mcp_tool` → function schema（用其 `input_schema_json`），命名 `mcp__<service>__<tool>`。
- `auto_disable_on_error`：调用连续失败自动禁用。

**验收**：接一个真实 MCP（如天气/搜索）→ 学生提问触发模型调用 → 拿到真实返回。

---

### Phase 5 — 权限与确认流
**目标**：高风险动作（发通知、MCP 写操作、投递）需学生确认。

**改动**：
- 工具 metadata `risk` + `MasterAgentConfig.permission_mode`（auto/ask/strict）决定是否拦截。
- 新增 SSE 事件 `permission.request`，前端弹确认；新增"恢复执行"接口，确认后继续循环。
- `send_notification` 从"直接跳过"改为"确认后执行"。

**验收**：模型要发面试提醒邮件时，前端弹确认框，确认后才真正执行。

---

### Phase 6 — 收尾与加固
- **测试**：给 `run_agent_loop` 加单测（mock LLM 返回 tool_calls 序列），锁住回归。
- **可观测**：记录每轮 token / 工具耗时 / 迭代次数。
- **上下文管理**：历史 + 工具结果超长时的截断/摘要策略。
- **安全（建议提前做）**：`encrypt_api_key` 目前只是 base64≈明文，升级为 Fernet/AES-GCM（密钥从 env 注入），覆盖模型/Dify/MCP/知识库所有密钥。

---

## 5. 数据库变更汇总（新增迁移）
| 迁移 | 内容 |
|------|------|
| `kb_collection` 表 | 知识库 collection（Dify 数据集配置） |
| `master_route_rule.kb_collection_ids` 列 | 子智能体绑定专属库 |
| `model_config.supports_tools` 列（可选） | 标记模型是否支持原生 function-calling |

> 注意同步更新 `backend/entrypoint.sh` 的 `alembic stamp` 表存在性判定链，与 `backend/alembic/env.py` 的 models 导入。

---

## 6. 优先级与里程碑建议
| 里程碑 | 包含 | 价值 |
|--------|------|------|
| **M1（最小可用）** | Phase 1 + 2 | 主智能体真正"自主选工具"，Skill 生效 — 产品核心体验立住 |
| **M2** | Phase 3 | 知识库落地，回答有依据 — 就业平台核心价值 |
| **M3** | Phase 4 + 5 | MCP 真实能力 + 高风险确认 — 能力与安全 |
| **M4** | Phase 6 | 测试/加固/密钥加密 — 上线质量 |

---

## 7. 风险与注意事项
- **模型兼容性**：并非所有 OpenAI 兼容端点都支持 `tools`，必须有 ReAct prompt 回退路径，否则换模型即崩。
- **死循环 / 成本**：严格执行 `max_iterations`；对工具结果体积设上限，避免上下文爆炸。
- **多租户隔离**：所有新查询（kb_collection、mcp 调用）必须带 `tenant_id` 过滤，零 FK 靠应用层兜住。
- **Dify 版本差异**：数据集检索 API 的端点/字段/Key 类型按实际部署联调。
- **流式 + 工具调用并存**：流式解析 `delta.tool_calls` 的增量拼接是易错点，需重点测试。
