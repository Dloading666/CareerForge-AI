# AGENTS.md

面向 AI 编码代理（Codex / Cursor / Claude Code / mimo 等）的项目操作指南。
人类贡献者请同时阅读 README；本文件假设你是一个在仓库里直接动手改代码的 agent。

## 理解需求的方式（铁律）

用户是**非技术人员**，用业务语言提需求，不会用技术术语。你必须以**产品经理思维**工作：

1. **先理解意图，再动手**：用户说的每句话，先翻译成「他想要什么用户体验/业务结果」，而不是字面意思。需求描述模糊、不完整、甚至前后矛盾是常态——这是你的问题，不是用户的问题。
2. **主动提出你的理解**：动手前用一句话复述你理解的需求（「你是想让 XX 变成 YY 对吧？」），确认对齐再写代码。猜错了返工的成本远高于多问一句。
3. **用业务语言沟通**：回复中不要出现 API、state、组件、hook 等技术词。用户关心的是「页面上能不能看到 XX」「点了之后会怎样」「这个会不会影响 YY」。
4. **需求不清晰时，给选项不给问题**：不要问「你想怎么做？」（太开放），而是「我理解有两种做法：A 是…好处是…；B 是…好处是…。你倾向哪个？」
5. **别假设用户知道技术限制**：如果需求在技术上有难度或有副作用，用业务影响解释（「这样做的话，加载会慢 2-3 秒」），不要说「技术上做不到」。
6. **超范围需求要拦住**：如果需求改动可能影响已有的核心功能（如简历助手、多租户隔离、SSE 流式），主动提醒风险，等用户确认再做。

## 项目是什么

CareerForge-AI：面向高校学生的 AI 就业辅助平台。

- **学生端**两个对话智能体：**AI简历助手**（自研 Agentic Loop，能直接读写简历中心的在线简历）和 **AI面试官**（独立的结构化面试 API，不走 Agentic Loop）。
- **管理端**：模型广场、Skill、MCP、主智能体路由配置。
- 技术栈：FastAPI + SQLAlchemy（后端）、React 19 + Arco Design + Vite（前端）、MySQL/Redis（生产）、SQLite（本地开发）。

## 常用命令

```bash
# 后端（backend/，已有 .venv）
cd backend && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                  # 本地默认 SQLite，无需 MySQL
uvicorn app.main:app --reload         # http://localhost:8000，API 文档 /docs

# 前端（frontend/）
cd frontend && npm install
npm run dev                           # http://localhost:5173，/api 代理到 :8000
npm run build                         # tsc -b && vite build —— 唯一的类型检查入口
npm run lint

# Docker 全栈（需先 cp backend/.env.example backend/.env.docker 并填密钥）
docker compose up -d --build          # MySQL(3307) · Redis(6380) · backend(8000) · frontend(8080)
```

## 如何验证你的改动

本仓库**没有 Python linter、没有 CI**。每次改动后的最低验证标准：

1. 前端：`cd frontend && npm run build && npm run lint` 必须全绿。
2. 前端 E2E：`cd frontend && npx playwright test`（需先 `npx playwright install`，覆盖面试官流程）。
3. 后端单元测试：`cd backend && python -m pytest tests/ -v`（unittest 风格，覆盖 agent_runtime 事件、fact_guard、简历路由、工具校验、面试流程 + harness）。
3. 后端迁移：`cd backend && alembic heads`（必须只有一个 head）+ 在干净 SQLite 库上 `alembic upgrade head`。
4. 后端逻辑：启动 uvicorn，用 `/docs` 或 curl 打一遍你改过的端点。
5. 涉及对话/工具链的改动：手动走一遍核心剧本——选择工作简历 → 发消息 → AI 调工具 → 前端 activity 胶囊正常渲染 → 简历中心确认结果。

## 铁律（违反任何一条都算事故）

1. **多租户隔离**：所有表带 `tenant_id`，所有查询必须按 `tenant_id`（通常还有 `student_id`）过滤。数据库**零外键约束**（MySQL 设计要求），一致性全靠应用层。新查询漏了 tenant_id = 跨租户数据泄漏。
2. **统一响应信封**：非流式端点一律返回 `{code, msg, data}`（用 `core/response.py` 的 `ok()/error()`）。前端按此解析。
3. **软删除**：用 `is_deleted` 字段，查询默认过滤，不物理删除业务数据。
4. **迁移命名**：`YYYYMMDD_NNNN_slug`（当前最新 `20260613_0005`）。改动迁移判定链时同步检查 `backend/entrypoint.sh`（容器内对「有表无 alembic_version」自动 stamp 再 upgrade）。
5. **配置全走 env**：新增配置项必须在 `core/config.py` 加 `Field(..., alias="ENV_NAME")` 并更新 `backend/.env.example`。不要硬编码。
6. **密钥安全**：永远不要把 `.env.docker` 或任何真实 API key 写进版本库。
7. **新增 SSE 事件**必须三处同步：后端发射点、`CLAUDE.md` 事件列表、前端 `chatRuntimeStore.ts` 的 `handleStreamEvent`。
8. **前端请求**一律走 `shared/api.ts` 的 `apiRequest`（信封解析 + 401 自动刷新）或 `authenticatedFetch`（流式/文件）。**禁止裸 `fetch` + 手拼 Bearer header**——token 过期不会自动续期。

## 分支与提交

`main`（生产，仅负责人合并）← `master`（开发主线）← `dev-xxx`（个人分支）。
从 master 切分支 → PR 回 master → 审批合并。提交信息中文，格式 `feat:/fix:/refactor: 描述`。

## 架构地图

### 后端 `backend/app/`（按业务域分包：models / schemas / service / router）

| 包 | 职责 |
|----|------|
| `auth/` | 注册/登录/JWT/验证码。`AuthIdentity`（含 `tenant_id`）、`get_current_identity`、`require_role("admin"\|"student")` |
| `admin/` | 模型广场（`ModelConfig`，字段是 `base_url` 不是 api_base_url）、子智能体、主智能体路由 |
| `student/` | **核心**。`agent_runtime.py`（Agentic Loop，5000+ 行）、`router.py`（会话/消息/记忆/提案）、`run_manager.py`（后台 run + SSE）、`resume_router.py`（简历 CRUD/快照/撤销）、`ai_assist_router.py` + `ai_assist_service.py`（简历编辑器 AI 辅助：polish/quantify/concise/expand/translate_en）、`agent_models.py` / `revision_models.py` / `proposal_models.py` |
| `interview/` | AI面试官独立实现，自有 Harness + 状态机。`service.py`（面试流程引擎，2000+ 行）、`harness.py`（校验层：评分/追问/结束判定）、`state_machine.py`（8 阶段：opening→self_intro→resume_deep_dive→technical_core→scenario→pressure→reverse_question→wrap_up）、`voice_service.py`（语音转写）、`run_events.py`（Redis/内存事件队列）、`report_generator.py`、`resume_anchors.py`（简历锚点提取）、`knowledge.py`、`prompts.py`。路由双文件：`router.py`（同步 CRUD）+ `router_student.py`（SSE run 模式 + 语音提交）。不走主智能体 Agentic Loop |
| `agent/` `skills/` `mcp/` | 广场类只读/CRUD 路由 |
| `core/` | `config.py`、`security.py`、`response.py`、`llm_client.py` |
| `infra/` | `db.py`、`redis_client.py` |

所有 router 挂在 `settings.api_v1_prefix`（默认 `/api/v1`）下。

### 学生端主智能体（`student/agent_runtime.py`）——项目最复杂的部分

自研 Agentic Loop（Model + Harness）：模型用 OpenAI function-calling 自主调工具，Harness 执行/校验/审计并回灌，直到最终答复或触顶 `max_iterations`（默认 8）。

- **思考程度系统**（`reasoning_effort`）：前端可选「自动/低/中/高/超高/极限」六档。默认「自动」模式由 `auto_classify_effort()` 根据消息内容、JD、附件自动判断难度。各模型的实际控制方式不同：
  - **OpenAI o1/o3/o4/gpt-5**：原生 `reasoning_effort` API 参数
  - **Anthropic Claude**：`thinking.type: "enabled"` + `budgetTokens`（4K/10K/16K/31K）
  - **Google Gemini**：`thinkingConfig` + `thinkingBudget`（4K/10K/16K/24-32K）
  - **DeepSeek**：不发送参数（推理始终开启），仅靠 system prompt 引导
  - **其他模型**：仅 system prompt 文字引导，无 API 级控制
  - 配置函数：`get_model_effort_config()` 返回 `supported_efforts` / `effort_api_params` / `reasoning_temp`
  - 温度：推理模式下 Claude/Gemini 强制 1.0；其他模型按 `_MODEL_TEMP_MAP` 设置默认值（Qwen=0.55, GLM=1.0 等）
- **工具池按 `session.agent_type` 路由**：`"resume"`（完整池：读档案/读简历/生成/优化/更新/导出 PDF/联网/记忆工具）；`"interviewer"` 聊天池已基本弃用（面试官走独立的 `/student/interviews` API）。
- **工作区模型**（类比 Codex：简历=代码库）：`session.active_resume_id` 绑定当前工作简历；`read_resume` 返回两层（全部简历的 id/标题/时间列表 + 工作简历全文）；`update_resume_data` 做章节级局部合并，缺省 resume_id 时落到工作简历；`base_updated_at` 做写前版本检查防覆盖用户手改。
- **写前快照**：AI 修改简历前自动存 `student_resume_revision`（每份保留 20 条），`POST /student/resumes/{id}/revert` 撤销。
- **会话记忆**：`session.memory_json`（constraints/facts/preferences），模型通过 `save_session_note` 工具写入，每轮注入 system（pinned，不被截断）；facts 同步进 `SessionEvidencePool`。
- **事实校验 + 质量闸门**：`_validate_resume_facts`（实体级，防幻觉）+ `_check_resume_quality`（强动词率/量化占比等）。`FACT_GUARD_SHADOW_MODE` 可切换仅日志。
- **上下文**：分层组装（system + 工作简历状态 + 记忆 + 滚动摘要 + 最近 K 轮全文 + 更早截断）；`session.summary` / `summarized_until_message_id` 支撑滚动摘要。
- **RunManager**（`run_manager.py`）：`POST /student/master/sessions/{id}/runs` 启动后台运行 → `GET /student/master/runs/{id}/events?after_seq=N` 订阅 SSE（断线重连按 seq 续传）。

SSE 事件名：`message.saved` / `activity.started|completed|failed` / `message.delta` / `message.snapshot` / `message.completed` / `done` / `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.steps_plan`（AI 动手前的步骤进度预告，意图驱动） / `runtime.completed`。

面试官 SSE 事件（`interview/run_events.py`，Redis 优先 + 内存降级）：`interview.started` / `interview.stage.started|completed|delta` / `interview.question.created` / `interview.turn.scored|completed` / `interview.voice.transcribed` / `interview.report.created` / `interviewer.delta|snapshot|completed` / `runtime.status|error`。

**新增一个内置工具的完整链路**（漏一步就是隐身故障）：
1. `BUILTIN_TOOLS` 加 `ToolDefinition`（name/description/input_schema/metadata.kind）；
2. `_dispatch_tool` 加分支接执行函数；
3. 前端 `AgentChatView.tsx`：`toolDisplayNames` + `ACTIVITY_ICON_MAP` + `ACTIVITY_ANIM_MAP`；
4. 前端 `chatRuntimeStore.ts`：`categorizeActivity` 归类（否则胶囊里显示「处理」）。

### 前端 `frontend/src/`

- 路由：`/auth`、`/student/*`（`StudentHomePage` 是 shell）、`/admin`。`shared/ProtectedRoute` 角色守卫。
- 学生端页面：`/student` AI简历助手（`AgentChatView agentType="resume"`）· `/student/interviewer`（`AIInterviewerPage`，含语音面试 + `InterviewReportDrawer`）· `/student/resumes[/:id]` 简历中心/编辑器（Tiptap 富文本 + AI 辅助面板） · 个人中心是 Modal（不是路由）。
- **`chatRuntimeStore.ts` 是对话运行时的唯一数据源**（单例，订阅模式）：管理 SSE 连接、`segments` 时间线（text/actions 交错）、并行会话状态。`AgentChatView` 通过 storeTick 订阅同步。**操作单个会话用 `abortSession(id)`/`clearSession(id)`，`abort()` 会杀掉所有并行会话**。
- `AgentChatView` 的 session 是**惰性创建**的（首条消息才 POST）——任何「会话级设置」（如工作简历选择）必须先存组件 state，创建时随 body 带上。
- 触发器模式：父组件用计数器 props（`loadTrigger`/`newChatTrigger`）驱动子组件加载/重置。

## 已知陷阱（都是踩过的坑）

- **本地 venv Python 版本**：`backend/.venv` 可能是 Python 3.9，但代码使用 3.10+ 语法（如 `match`/`X | Y` 类型联合）。本地开发建议用 Python 3.11 重建 venv；Docker 镜像用 3.11 没问题。
- **datetime 时区**：SQLite/MySQL 返回的 datetime 是 naive 的。任何 aware/naive 混合比较都会抛 TypeError；isoformat 字符串解析回来也是 naive。比较前统一 `replace(tzinfo=timezone.utc)`。
- **档案明细表字段名**（`profile_details_models.py`）：Honor 是 `title/level/award_date`（不是 name/date）；Certification 是 `issue_date/expire_date`（没有 credential_id）；Skill 是 `name/level(int)/description`（没有 category）。写入前先看模型定义。
- **`StudentUser.nickname`**：学生昵称字段（`auth/models.py`），可选。简历导出和前端展示可能引用它，改动时注意关联。
- **React Hooks**：组件内所有 hooks 必须在任何 early return 之前调用（`ActionsCapsule` 曾因此崩溃）。
- **React 19 + Arco**：`element.ref` 警告可忽略；Arco `Message` 静态方法在 2.66+ 下正常。
- **`agent_type` 合法值**：`"resume"`（默认）/ `"interviewer"`。新增类型须同步 `agent_runtime.py` 的工具池与 prompt 分支。
- **简历导出**：`export_resume_pdf` 用 reportlab + 内嵌 CJK 字体；下载链接是签名 token，10 分钟过期，**不要**把链接写进消息正文。
- **`StudentResume.visibility`**：AI 面试官的简历来源开关，简历助手已不依赖它。改动前确认不破坏面试官。
- **耗时操作别挡在 SSE 收尾路径上**：`message.completed`/`done` 事件之前不要 await LLM 调用之类的慢操作，前端会一直转圈。
- **`INTERVIEW_KNOWLEDGE_BASE_DIR`**：config 默认值是 Windows 路径（`D:\Ai Agent\Knowledge Base`），macOS/Linux 上必须通过 env 覆盖，否则面试官知识库加载失败。Docker compose 已设置为 `/app/knowledge-base`。
- 阅读 `CLAUDE.md` 获取更多细节；两份文件如有冲突，以代码现状为准并顺手修正文档。

## 体验红线（改简历助手时必须遵守）

1. **按用户意愿行事**：明确指令直接干、不追问；闲聊/提供信息不许擅自改简历。
2. **简历是唯一事实源**：动手前重新 `read_resume`，禁止凭对话记忆改写；带 `base_updated_at` 版本检查。
3. **一切可撤销**：写操作前必须有 revision 快照。
4. **记忆对用户透明**：AI 记住的约束/事实用户可见、可删。
5. **流式体感**：delta 实时输出不缓冲；动手前一句话预告、动完简短总结。
