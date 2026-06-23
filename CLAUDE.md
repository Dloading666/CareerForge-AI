# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

CareerForge-AI —— 面向高校学生的 AI 就业辅助平台。学生端内置两个对话智能体：**AI简历助手**（制作/优化简历）和 **AI面试官**（模拟面试训练），均采用 Agentic Loop（Model + Harness）架构，对话历史存储在同一张表里通过 `agent_type` 字段区分。管理端负责配置模型、Skill、MCP 与系统设置。后端 FastAPI + SQLAlchemy，前端 React 19 + Arco Design，Docker Compose 一键部署。

## 理解需求的方式（铁律）

用户是**非技术人员**，用业务语言提需求，不会用技术术语。你必须以**产品经理思维**工作：

1. **先理解意图，再动手**：用户说的每句话，先翻译成「他想要什么用户体验/业务结果」，而不是字面意思。需求描述模糊、不完整、甚至前后矛盾是常态——这是你的问题，不是用户的问题。
2. **主动提出你的理解**：动手前用一句话复述你理解的需求（「你是想让 XX 变成 YY 对吧？」），确认对齐再写代码。猜错了返工的成本远高于多问一句。
3. **用业务语言沟通**：回复中不要出现 API、state、组件、hook 等技术词。用户关心的是「页面上能不能看到 XX」「点了之后会怎样」「这个会不会影响 YY」。
4. **需求不清晰时，给选项不给问题**：不要问「你想怎么做？」（太开放），而是「我理解有两种做法：A 是…好处是…；B 是…好处是…。你倾向哪个？」
5. **别假设用户知道技术限制**：如果需求在技术上有难度或有副作用，用业务影响解释（「这样做的话，加载会慢 2-3 秒」），不要说「技术上做不到」。
6. **超范围需求要拦住**：如果需求改动可能影响已有的核心功能（如简历助手、多租户隔离、SSE 流式），主动提醒风险，等用户确认再做。

## 常用命令

### 后端（`backend/`，已有 `.venv`）
```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head                 # 跑迁移（本地默认 SQLite，无需 MySQL）
uvicorn app.main:app --reload        # http://localhost:8000，文档 /docs

# 迁移：新建一条
alembic revision -m "描述"           # 文件名遵循 YYYYMMDD_NNNN_slug 约定
alembic upgrade head
alembic downgrade -1
```
注意：本仓库没有测试套件、没有 Python linter 配置。改后端时手动跑 `/docs` 或 curl 验证。

### 前端（`frontend/`）
```bash
cd frontend
npm install
npm run dev          # http://localhost:5173，Vite proxy 把 /api 转发到 :8000
npm run build        # tsc -b && vite build —— 这是唯一的「类型检查 + 构建」入口
npm run lint         # eslint .
```

### Docker 全栈
```bash
docker compose up -d --build     # MySQL(3307) · Redis(6380) · backend(8000) · frontend(8080)
```
需先 `cp backend/.env.example backend/.env.docker` 并填写密钥（`.env.docker` 已 gitignore）。

## 分支与提交

- `main` 生产（仅负责人合并）→ `master` 开发主线 → `dev-xxx` 个人分支（从 master 切出）。
- 工作流：从 master 切分支 → 开发完 PR 到 master → 负责人审批合并 → 部署到 main。
- 提交前确认不要把真实密钥（`.env.docker`）带进版本库。

## 架构要点

### 后端分层（`backend/app/`）
按业务域分包，每个域典型含 `models.py`(SQLAlchemy) / `schemas.py`(Pydantic) / `service.py`(业务逻辑) / `router.py`(API)：

- `auth/` — 注册/登录/JWT/邮件验证码。`service.py` 定义 `AuthIdentity`（含 `user_id` / `role` / **`tenant_id`**）、`get_current_identity` 依赖、`require_role("admin"|"student")` 守卫。
- `admin/` — 管理端。模型广场（`model_service.py`、`models.py:ModelConfig`）、子智能体（`agent_*`）、主智能体路由配置（`master_models.py:MasterRouteRule` / `master_service.py`、含 `DEFAULT_SYSTEM_PROMPT`）。
- `student/` — 学生端主智能体。核心是 **`agent_runtime.py`**（见下）、`router.py`（会话/消息/流式）、`attachment_router.py`（附件上传）、`event_router.py`（日历/事件）。
- `agent/` — 面向学生的公开智能体广场只读路由。
- `skills/` `mcp/` — Skill 广场、MCP 广场的 CRUD。
- `core/` — `config.py`(pydantic-settings，全部从 env 读取)、`security.py`(JWT/bcrypt)、`response.py`(统一 `{code,msg,data}` 信封，`ok()`/`error()`)、`llm_client.py`、`dify_client.py`。
- `infra/` — `db.py`(engine/SessionLocal/Base)、`redis_client.py`(token 吊销名单、验证码、登录限流)。

所有 router 在 `main.py` 以 `settings.api_v1_prefix`（默认 `/api/v1`）挂载。各 router 自带二级 prefix（如 `/auth`、`/admin`、`/student`）。

### 多租户
**所有数据查询都按 `tenant_id` 隔离**，且零外键约束（MySQL 设计要求，靠应用层保证一致性）。新增表/查询时必须带上 `tenant_id` 过滤，否则会跨租户泄漏数据。

### 学生端主智能体运行时（`student/agent_runtime.py`）—— 项目最复杂的部分
一个自研的 **Agentic Loop（Model + Harness）**：模型用 OpenAI function-calling 自主决定调哪些工具，Harness 负责执行/校验/审计并把结果回灌，直到模型给出最终答复或触顶 `max_iterations`。

1. **两类工具池**（按 `session.agent_type` 路由）：
   - `assemble_active_tools()` — **AI简历助手**完整工具池：`query_student_profile / read_resume / analyze_uploaded_file / get_session_context / export_resume_pdf` + 启用 Skill。
   - `assemble_interviewer_tools()` — **AI面试官**精简只读池：`query_student_profile / read_resume / get_session_context / analyze_uploaded_file`，**不含生成/导出简历类工具**。

2. `stream_master_reply()` 是 SSE 入口：保存用户消息 → 选模型 → 读 `session.agent_type` 决定工具池 → `_build_initial_messages(..., agent_type)` → 创建空 assistant 行 → 进入 `run_agent_loop()`。

3. `run_agent_loop()` 是 Harness 主循环：流式调用 LLM → 若有 `tool_calls` 则四态权限裁决 → 执行 → 审计 → 回灌 → 否则流式输出最终答复。`max_iterations` 默认 8，安全上限 20。delta 文本实时 yield 给前端（边思考边输出），不缓冲。

4. **RunManager 后台运行**（`run_manager.py`）：`POST /student/master/runs` 启动后台运行 → `GET /student/master/runs/{id}/events` 订阅 SSE 事件流。`stream_master_reply()` 是旧的同步 SSE 端点，两者共享 `run_agent_loop()` 核心逻辑。前端通过 `chatRuntimeStore.ts` 管理 SSE 连接和状态。

5. **事实校验与质量闸门**：`SessionEvidencePool` 统一管理事实来源（个人档案 + read_resume 结果 + 附件 + 对话内容）。`_validate_resume_facts` 做实体级校验（专名 + 时间段），`_check_resume_quality` 做确定性质量检查（强动词率、量化占比、bullet 长度等）。`FACT_GUARD_SHADOW_MODE` 开关可切换为仅日志不拦截。

6. **前端时间线**：`chatRuntimeStore` 维护 `segments: TimelineSegment[]`（text 和 actions 段交错），`AgentChatView` 用 `TimelineRenderer` 渲染 Codex 式叙述+动作胶囊。活动使用自定义 PNG 图标（`/activity-icons/`）配合 CSS 动画。

4. **`_harness_system_prompt(config, reasoning_effort, agent_type)`**：
   - `agent_type == "interviewer"` → 返回 `INTERVIEWER_SYSTEM_PROMPT`（面试官人格，禁止操作简历）。
   - 其他 → 返回简历助手 prompt（反幻觉铁律 + 简历制作/优化两条流程 + 联网指引）。

5. **思考程度系统**（`reasoning_effort`）：默认「自动」模式，由 `auto_classify_effort()` 根据消息内容自动判断（问候→low、简历操作→medium、JD分析→high、全面重写→xhigh）。前端可手动选六档：auto/low/medium/high/xhigh/max。各模型实际生效方式：
   - OpenAI 推理系列：原生 `reasoning_effort` API 参数
   - Anthropic Claude：`thinking.budgetTokens`（4K~31K），temperature 强制 1.0
   - Google Gemini：`thinkingConfig.thinkingBudget`（4K~32K），temperature 强制 1.0
   - DeepSeek：推理始终开启，不发额外参数
   - 其他模型：仅 system prompt 文字引导
   - 配置：`get_model_effort_config()` → `supported_efforts` / `effort_api_params` / `reasoning_temp`
   - 温度：`get_model_default_temperature()` 按模型 ID 设置（Qwen=0.55, Gemini=1.0, GLM=1.0 等）
   - 模型列表 API 返回 `supported_efforts` 字段，前端据此动态过滤可选档位

6. **session 区分**：`StudentAgentSession.agent_type VARCHAR(32) DEFAULT 'resume'`，迁移 `20260610_0016`。`POST /student/master/sessions` 从 `AgentSessionCreate.agent_type` 读取并写入。

SSE 事件名：`message.saved` / `activity.started` / `activity.completed` / `activity.failed` / `message.delta` / `message.snapshot` / `message.completed` / `done` / `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.steps_plan`（AI 动手前的步骤进度预告，意图驱动） / `runtime.completed`。


### 简历工具
`read_resume` 读取学生在「简历制作」保存的 PDF（`session_id=0` 的附件），缺 `extracted_text` 时用 `_ensure_attachment_text()` 现抽现存；`export_resume_pdf` 用 reportlab + **内嵌 CJK 字体**渲染可下载 PDF，通过签名 token 下载端点（`/api/v1/student/files/download`）返回临时链接，10 分钟过期。

### 前端（`frontend/src/`）

**路由结构**：`/auth`、`/student`、`/admin`，按 `session.role` 重定向；`shared/ProtectedRoute.tsx` 角色守卫，`shared/AuthProvider.tsx` 管登录态。

**学生端路由（`StudentHomePage.tsx` 内）**：
| 路径 | 页面 |
|------|------|
| `/student` | AI简历助手（`AgentChatView agentType="resume"`） |
| `/student/interviewer` | AI面试官（`AgentChatView agentType="interviewer"`） |
| `/student/resumes` | 简历制作（`ResumeCenterPage`） |
| `/student/resumes/:id` | 简历编辑器（`ResumeEditorPage`） |
| `/student/profile` | 个人中心（`ProfilePage`） |

**关键组件**：
- **`AgentChatView.tsx`** — 通用对话视图。`agentType` 决定空状态样式和 session 创建时的类型；父组件通过 `loadTrigger`（数字计数器）+ `sessionToLoad` 触发加载，通过 `newChatTrigger` 触发重置；`onSessionUpdated` 回调通知父组件维护侧栏列表；`onActiveSessionChange` 通知当前活跃 session id 用于高亮。
- **`StudentHomePage.tsx`** — Shell。管理两套 session 列表（`resumeSessions` / `interviewerSessions`）和两套触发器，侧边栏分组显示对话历史（每组有独立 [+] 新建按钮），侧边栏宽度可拖动（180–480px，存 localStorage）。

**导航（4项）**：AI简历助手 · AI面试官 · 简历制作 · 个人中心（已移除「智能体广场」入口）。

`shared/api.ts` 统一请求封装：自动附加 JWT；`extractErrorMessage` 映射 422 错误为中文字段提示。新增表单字段时补 `FIELD_LABELS`/`ERROR_TYPES`。

## 关键约定与陷阱

- **统一响应信封**：后端返回 `{code, msg, data}`；前端按此解析（流式 SSE 端点除外）。
- **软删除**：`is_deleted` 字段，查询默认过滤，不物理删除。
- **API Key 存储**：`api_key_cipher` 经 `encrypt/decrypt_api_key`（当前实为 base64，生产待加固）。
- **React 19 + Arco**：`element.ref` 警告可忽略；Arco `Message` 静态方法在 2.66+ + React 19 下正常工作。
- **启动种子**：lifespan 建表 → bootstrap 管理员 → seed 默认模型/智能体；默认 `admin`/`123456`。
- **迁移在容器内**：`entrypoint.sh` 对「有表无 alembic_version」自动 stamp 再 upgrade。新增迁移若改了判定链记得同步 entrypoint。
- **配置全走 env**：新增配置项加 `Field(..., alias="ENV_NAME")` 并更新 `.env.example`。
- **`agent_type` 约定**：合法值 `"resume"`（默认）/ `"interviewer"`。前端创建 session 时传入，后端据此选工具池和 system prompt。新增类型须同步更新 `agent_runtime.py` 的分支逻辑。
