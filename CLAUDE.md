# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

智培职联（CareerForge-AI）—— 面向高校学生的 AI 就业辅助平台。学生端是一个「主智能体」对话系统（Agent = Model + Harness），管理端负责配置模型、子智能体、Skill、MCP 与系统设置。后端 FastAPI + SQLAlchemy，前端 React 19 + Arco Design，Docker Compose 一键部署。

文档说明（README 的 Roadmap 已过时）：代码实际已实现学生端主智能体对话、模型广场、子智能体路由、Skill/MCP 广场。架构细节见 `STUDENT_MASTER_AGENT_DEV_REPORT.md` 和 `MODEL_PLAZA_DEV_DOC.md`。

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
- 当前工作分支是 `master`；提交前确认不要把真实密钥（`.env.docker`）带进版本库。

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
一个自研的 **Agentic Loop（Model + Harness）**：模型用 OpenAI function-calling 自主决定调哪些工具，Harness 负责执行/校验/审计并把结果回灌，直到模型给出最终答复或触顶 `max_iterations`。设计纲领见仓库 `Agent = Model + Harness ...docx`（“Harness 提供信任”）。

1. `assemble_active_tools()` 组装**克制的安全工具池**：内置工具白名单 `ACTIVE_BUILTIN_TOOL_NAMES`（query_student_profile / read_resume / analyze_uploaded_file / get_session_context / export_resume_pdf）+ 已启用 Skill（`skill__<slug>`）+ 已启用子智能体（`subagent__<key>`，真实执行）。**会编造结果的占位工具（岗位库 / 知识库 / MCP）刻意不进池**——对应准则「禁止编造」。
2. `stream_master_reply()` 是 SSE 入口：保存用户消息 → 选模型 → `_build_initial_messages()`（硬化 system prompt + 历史多轮 + 附件）→ 创建空 assistant 行 → 进入 `run_agent_loop()`。
3. `run_agent_loop()` 是 Harness 主循环（**模型不控制循环**）：`_stream_llm_turn()` 带 `tools` 流式调用 → 若返回 `tool_calls` 则先过 `_permission_decision()` 四态权限裁决、再 `_dispatch_tool()` 逐个执行（发 `activity.*` 事件、写 `StudentAgentActivity` 审计）并把结果作为 `role=tool` 回灌 → 否则直接流式输出最终答复。`max_iterations` 取 `MasterAgentConfig.max_iterations`（默认 8，安全上限 20）。模型不支持 `tools`（请求报错）时自动降级为无工具纯文本回答。
4. **Harness 护栏**：未知工具名 / 非法参数 → 返回结构化错误让模型自我纠正而非崩溃；只暴露能诚实兑现的工具；`permission_mode`（auto/ask/strict）`strict` 时只放行内置工具、拒绝 Skill 与子智能体；`_harness_system_prompt()` 把反幻觉铁律写进 system（简历建议必须先 `read_resume`、禁止虚构经历）。
4.5. **子智能体**：每条启用的 `MasterRouteRule` 经 `assemble_active_tools()` 暴露为 `subagent__<key>` 工具（描述=`intent`）。`builtin` 走 `_run_builtin_subagent()`（`_resolve_builtin_agent()` 把 key 解析到平台 `agent`，独立上下文跑一轮 `_oneshot_llm`，仅回流摘要），`dify` 走 `_call_dify_subagent()`。
5. **简历工具**：`read_resume` 读取学生在「个人中心—我的简历」已存的 PDF（profile 级附件 `session_id=0`），缺 `extracted_text` 时用 `_ensure_attachment_text()` 现抽现存；`export_resume_pdf` 用 reportlab + **内嵌 CJK 字体**（`_register_cjk_font()` 优先嵌入真实 TTF/TTC，Docker 靠 `fonts-noto-cjk`）渲染可下载 PDF，存为附件并返回 `/data/...` 下载链接，模型以 Markdown 链接呈现给学生。
6. 模型选择 `_select_chat_model()`：请求指定 model_id > 主智能体配置 model > 第一个对学生开放的 chat 模型。只接受 `capability in ("text","multimodal","chat")` 且 `open_to_student` 且 `status=="active"`。

SSE 事件名：`message.saved` / `activity.started` / `activity.completed` / `activity.failed` / `message.delta` / `message.completed` / `done`（外加 `attachment.created`，前端目前忽略）。

> 旧的关键词预规划函数（`_plan_tool_calls` / `_run_tool_planning` / `_compose_prompt` / `_stream_llm_response` / `assemble_tool_pool`）已被循环取代，目前是**死代码**，保留未删。

附件：`save_attachment()` 落盘到 `data/agent_uploads/{tenant}/{user}/`，并同步抽取文本（pypdf/python-docx/openpyxl/Pillow）。图片在模型支持视觉时以 base64 data-url 内联进 prompt（`_supports_image_input` 用排除法：非 embedding/rerank/audio 即尝试视觉直传）。

### 前端（`frontend/src/`）
- `App.tsx` 路由：`/auth`、`/student`、`/admin`，按 `session.role` 重定向；`shared/ProtectedRoute.tsx` 做角色守卫，`shared/AuthProvider.tsx` 管登录态。
- `shared/api.ts` 统一请求封装：自动从 localStorage 附加 JWT；`extractErrorMessage` 把 422 校验错误用 `FIELD_LABELS`/`ERROR_TYPES` 映射成字段级中文提示。新增表单字段时记得补这两张映射表。
- `admin/` 与 `student/` 各自一个大首页组件，内部用导航切换子页面（ModelPlaza、SystemSettings、AgentManagement、StudentAgentChat 等）。

## 关键约定与陷阱

- **统一响应信封**：后端返回 `{code, msg, data}`（`core/response.py`）；前端按此解析。
- **软删除**：`is_deleted` 字段，查询默认要过滤掉，不物理删除。
- **API Key 存储**：`ModelConfig.api_key_cipher` 经 `model_service.encrypt/decrypt_api_key`。
- **React 19 + Arco**：用 `Alert` 而非 Arco `Message`（后者在 React 19 有兼容问题）；`element.ref` 警告可忽略。
- **启动种子**：`main.py` 的 lifespan 会建表 + bootstrap 管理员 + seed 默认模型/智能体；默认管理员 `admin`/`123456`（可在 env 改）。
- **迁移在容器内的特殊处理**：`entrypoint.sh` 对「已有库但无 `alembic_version`」的情况按表存在性 `alembic stamp` 到对应版本再 upgrade。新增迁移若改了这个判定链，记得同步 entrypoint。
- 配置全部走 env（`core/config.py`），新增配置项加 `Field(..., alias="ENV_NAME")` 并更新 `.env.example`。
