# 智培职联 AI 智能体平台 — 系统设计文档

> CareerForge-AI · 面向高校学生的 AI 就业辅助平台
>
> 本文是整合后的**完整设计文档**，汇总并取代散落在各处的开发文档（README / MODEL_PLAZA_DEV_DOC / STUDENT_MASTER_AGENT_DEV_REPORT / DOCKER_DEPLOY / OPTIMIZATION_LOG）。后续规划见 `AGENT_LOOP_AND_KB_DEV_PLAN.md`，给 AI 协作者的速查见 `CLAUDE.md`。
>
> 最后更新：2026-06-10

---

## 1. 项目概述

智培职联是一个**双角色**（学生 / 管理员）的就业辅助平台：

- **学生端**：内置两个对话智能体——**AI简历助手**（制作/优化简历、生成可下载 PDF）和 **AI面试官**（一对一模拟面试训练）。两者均由同一套 Agentic Loop 驱动，通过 `agent_type` 字段区分，工具池和 system prompt 各自独立。配套简历制作（在线编辑器）、个人中心（档案/头像/求职意向）、日程。
- **管理端**：配置与治理后台——模型广场、主智能体配置、子智能体管理、Skills 广场、MCP 广场、系统设置。

| 角色 | 入口 | 能力 |
|------|------|------|
| `student` | 邮箱验证码注册 → 邮箱+密码登录 | AI简历助手 / AI面试官对话、简历制作、个人资料、日程 |
| `admin` | 账号+密码登录（env 初始化） | 模型 / 智能体 / Skill / MCP / 主智能体 / 系统配置全套 CRUD |

两个角色共享同一登录页（Tab 切换），登录后按 `role` 跳转。

---

## 2. 设计哲学：Agent = Model + Harness

整个智能体体系遵循团队内部纲领文档《Agent = Model + Harness 原则下的企业经营管理智能体开发准则》：

> **Model 提供智能，Harness 提供信任。企业级智能体，信任优先于智能。**

- **Model（认知层）**：只负责理解意图、规划、选择工具、综合结果。不控制循环、不判定权限、不直接碰数据库、不得编造事实。
- **Harness（管控执行层）**：负责 Agent Loop、工具校验、权限、审计、记忆、安全。**90% 的工程在 Harness。**

这一哲学直接落到学生端主智能体的实现上（见 §6.3）：循环由 Harness 控制、只暴露能诚实兑现的工具、反幻觉铁律写进 system prompt 而非散落在业务代码里。

---

## 3. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11 · FastAPI 0.115 · SQLAlchemy 2 · Alembic · Pydantic v2 |
| 鉴权 | PyJWT · passlib[bcrypt] · Redis 5（吊销名单 / 验证码 / 限流） |
| 数据库 | MySQL 8.4（生产，零外键约束）/ SQLite（本地开发） |
| LLM / 工具 | httpx 调 OpenAI 兼容 `/chat/completions`（function-calling）· Dify API · reportlab（简历 PDF，内嵌 CJK 字体） |
| 文档解析 | pypdf · python-docx · openpyxl · Pillow |
| 前端 | React 19 · TypeScript · Vite 8 · Arco Design 2.66 · React Router 7 · react-markdown + remark-gfm |
| 基础设施 | Docker Compose · Nginx 1.29 · fonts-noto-cjk |

---

## 4. 系统架构

### 4.1 部署拓扑（Docker Compose）

```
                    ┌─────────────────────────────────────────┐
  浏览器 ──:8080──▶ │ zhipei-frontend (nginx:1.29)            │
                    │  /        → React 静态资源              │
                    │  /api/    → backend:8000               │
                    │  /data/   → backend:8000 (附件/简历PDF) │
                    │  /static/ → backend:8000 (头像/横幅)    │
                    └───────────────┬─────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────┐
                    │ zhipei-backend (FastAPI + uvicorn :8000) │
                    └───────┬──────────────────┬───────────────┘
                            │                  │
              ┌─────────────▼───┐    ┌─────────▼──────────┐
              │ zhipei-mysql 8.4 │    │ zhipei-redis 7      │
              │ (3307→3306)      │    │ (6380→6379)         │
              └──────────────────┘    └─────────────────────┘
                            │
                  外部 LLM / Dify API（httpx 出站）
```

本地开发：后端 `uvicorn`（默认 SQLite，无需 MySQL）+ 前端 `vite`（dev proxy 把 `/api` `/data` `/static` 转发到 `:8000`）。

### 4.2 后端分层（`backend/app/`）

按**业务域分包**，每个域典型含 `models.py`(SQLAlchemy) / `schemas.py`(Pydantic) / `service.py`(业务逻辑) / `router.py`(API)：

| 包 | 职责 |
|----|------|
| `auth/` | 注册 / 登录 / JWT 双 Token / 邮箱验证码 / 图形验证码 / 登录限流。定义 `AuthIdentity`、`get_current_identity`、`require_role` |
| `admin/` | 模型广场、智能体 CRUD、主智能体配置 + 子智能体路由、系统设置 |
| `student/` | 学生端主智能体（Agentic Loop）、会话/消息/附件、个人资料、日程 |
| `agent/` | 面向学生的公开智能体广场只读路由 + 单体智能体对话 |
| `skills/` | Skill 广场（Markdown 资产）CRUD |
| `mcp/` | MCP 广场 CRUD（执行目前为模拟） |
| `core/` | `config`(env) · `security`(JWT/bcrypt) · `response`(统一信封) · `llm_client` · `dify_client` |
| `infra/` | `db`(engine/Session/Base) · `redis_client` |

所有 router 在 `main.py` 以 `settings.api_v1_prefix`（默认 `/api/v1`）挂载，各自带二级 prefix。

### 4.3 统一响应信封

后端所有业务接口返回 `core/response.py` 的信封；前端 `shared/api.ts` 按此解析（流式 SSE 端点除外）：

```json
{ "code": 0, "msg": "ok", "data": { ... } }
```

### 4.4 多租户隔离（核心约束）

**所有数据查询都按 `tenant_id` 隔离**，且**零外键约束**（MySQL 设计要求，一致性靠应用层保证）。新增任何表 / 查询都必须带 `tenant_id` 过滤，否则跨租户泄漏。当前默认单租户 `tenant_id=0`。

---

## 5. 数据模型

> 全部零 FK（`mcp_tool→mcp_service` 是唯一例外），软删除用 `is_deleted`，时间戳用 `TimestampMixin`。

### 5.1 鉴权域（`auth/models.py`）
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `admin_user` | username, email, password_hash, display_name, status, avatar_url | 管理员 |
| `student_user` | account, email, email_verified_at, password_hash, name, college, major, grade, gender, age, avatar_url, banner_url, signature | 学生（含档案字段） |
| `admin_refresh_token` / `student_refresh_token` | token_hash, expires_at, revoked | refresh token 存证 |
| `admin_login_log` / `student_login_log` | ip, ua, result, reason | 登录审计 |
| `student_email_code` | email, scene, code_hash, expires_at, send_count, attempt_count | 邮箱验证码（注册/重置） |

### 5.2 管理域（`admin/`）
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `model_config` | display_name, provider, deploy_type, capability, protocols, base_url, **api_key_cipher**, model_identifier, dify_model_ref, context_length, default_temp, max_output, timeout_sec, open_to_student, status | 模型广场 |
| `model_test_log` | model_id, success, latency_ms, error_message | 连接测试日志 |
| `system_config` | config_key, config_value | 键值配置（平台名/公告/维护模式） |
| `agent` | name, category, icon_*, model_config_id(FK), system_prompt, temperature/top_p/penalties, memory_window, prompt_variables, suggested_questions, use_dify, dify_api_key_cipher, dify_app_id | 单体智能体（广场） |
| `master_agent_config` | model_id, system_prompt, temperature, max_tokens, **max_iterations**, **permission_mode**, memory_isolation, model_passthrough, fallback_mode | 主智能体 Harness 配置（每租户一行） |
| `master_route_rule` | **intent**, target_agent_key, target_agent_name, target_provider(builtin/dify), provider_config_json, memory_strategy, priority, enabled | 子智能体工具注册表（intent=工具描述，供模型自主选择） |

### 5.3 学生端域（`student/agent_models.py`）
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `student_agent_session` | tenant_id, student_id, title, status, **agent_type**, summary | 对话会话；`agent_type='resume'`（简历助手，默认）/ `'interviewer'`（面试官） |
| `student_agent_message` | session_id, role, content | 消息 |
| `student_agent_activity` | session_id, message_id, kind, name, status, summary, detail_json | 工具活动审计（驱动前端活动行） |
| `student_agent_attachment` | session_id, message_id, original_name, stored_path, content_type, file_ext, file_size, **extracted_text**, status | 附件 / 简历 / 生成的 PDF |
| `student_event` | （日程：标题、日期等） | 学生日历事件 |

> `agent_type` 迁移：`20260610_0016_session_agent_type.py`，使用 `batch_alter_table` 兼容 SQLite。
>
> 简历约定：个人中心上传的简历是 `student_agent_attachment` 中 `session_id=0, message_id=0, file_ext='pdf'` 的行；主智能体生成的 PDF 则绑定到对应 assistant 消息（`message_id=assistant_message.id`）。

### 5.4 Skill / MCP 域
| 表 | 关键字段 | 说明 |
|----|----------|------|
| `skill_asset` | slug, name, description, version, category, tags_json, status, file_name, file_path, content_hash | Skill（Markdown 文件 + frontmatter 元数据） |
| `mcp_service` | slug, name, transport, endpoint, auth_type, auth_config, status, agent_ids_json | MCP 服务（存了真实连接信息） |
| `mcp_tool` | service_id(FK), name, description, risk, input_schema_json, enabled | MCP 工具 schema |
| `mcp_call_log` | service_name, tool_name, agent_id, request_text, response_json, success, latency_ms | 调用日志 |

迁移文件：`backend/alembic/versions/`，命名 `YYYYMMDD_NNNN_slug.py`。

---

## 6. 核心机制详解

### 6.1 鉴权与会话

- **JWT 双 Token**：access（默认 30 min）+ refresh（默认 7 天）。Token 载荷含 `sub`(user_id) / `role` / `tenant_id`。
- **Redis** 存 refresh token 吊销名单、邮箱验证码状态、登录失败限流。
- **登录限流**：`LOGIN_FAIL_LIMIT` 次失败后锁定 `LOGIN_LOCK_SECONDS`（默认 5 次 / 锁 15 min）。
- **图形验证码** `GET /auth/captcha`；**邮箱验证码** `student/email/send-code`（有冷却 + 次数上限，SMTP 未配置则跳过发送）。
- **依赖注入守卫**：`require_role("admin"|"student")` 返回 `(AuthIdentity, user)`，`AuthIdentity` 携带 `user_id / role / tenant_id`，是所有租户隔离查询的入口。
- 管理员初始账号由 env `ADMIN_BOOTSTRAP_*` 在 lifespan 启动时 bootstrap。

### 6.2 模型广场与模型选择

- 管理员在模型广场登记 OpenAI 兼容模型：`base_url` + `model_identifier` + `api_key_cipher` + `capability`(text/multimodal/embedding/...) + `open_to_student`。
- 连接测试 `test_model_connection` 用 httpx 探活并记录延迟。
- 主智能体选模型 `_select_chat_model()`：**请求指定 model_id > 主智能体配置 model > 第一个对学生开放的 chat 模型**；只接受 `capability ∈ (text, multimodal, chat)` 且 `open_to_student` 且 `status==active`。

### 6.3 ⭐ 学生端主智能体：Agentic Loop（Model + Harness）

**项目最核心、最复杂的部分**（`student/agent_runtime.py`）。模型用 OpenAI function-calling **自主决定调哪些工具**，Harness 负责执行 / 校验 / 审计并回灌结果，直到模型给出最终答复或触顶 `max_iterations`。

**调用链**：`POST /student/master/sessions/{id}/messages/stream` → `stream_master_reply()` →
1. 保存用户消息、认领本轮附件 → 发 `message.saved`
2. `_select_chat_model()` 选模型（无模型 / 无 Key → 受控错误回答）
3. 读 `session.agent_type`：`"interviewer"` → `assemble_interviewer_tools()`；其他 → `assemble_active_tools()`
4. `_build_initial_messages(..., agent_type)`：`_harness_system_prompt(config, effort, agent_type)` 分支选 prompt + 历史多轮 + 当前附件
5. `run_agent_loop()`：Harness 主循环
6. 持久化最终答复 → 发 `message.completed` / `done`

**两套工具池对比**：
| 工具 | AI简历助手 | AI面试官 |
|------|-----------|---------|
| `query_student_profile` | ✅ | ✅ |
| `read_resume` | ✅ | ✅（只读，不修改） |
| `analyze_uploaded_file` | ✅ | ✅ |
| `get_session_context` | ✅ | ✅ |
| `export_resume_pdf` | ✅ | ❌ |
| `skill__*` | ✅ | ❌ |

**`run_agent_loop()` 单轮逻辑**：
```
for _ in range(max_iterations):           # max_iterations 来自配置（默认 8，安全上限 20）
    流式调用 LLM（带 tools）→ 收集 content 增量 + tool_calls
    if 无 tool_calls:  return              # 最终答复已流式输出
    for 每个 tool_call:
        _permission_decision(permission_mode, tool) 四态权限裁决 → 不通过则跳过并回结构化拒绝
        校验工具名/参数 → _dispatch_tool() 执行
        写 StudentAgentActivity 审计 → 发 activity.started / completed / failed
        结果作为 role=tool 消息回灌
触顶 → 强制一次无工具收尾回答
```

**Harness 护栏（对应纲领准则）**：
| 护栏 | 实现 |
|------|------|
| 循环由 Harness 控制 | `max_iterations` 取配置值，安全上限 20，模型无法自行决定循环 |
| 四态权限 | `_permission_decision()` 读 `permission_mode`：`auto` 全放行 / `ask`（默认）放行低风险、暂缓需确认动作 / `strict` 仅放行平台内置工具（Skill 与子智能体一律拒绝） |
| 只暴露能诚实兑现的工具 | 内置白名单 + Skill + 子智能体（**真实执行**）；**会编造结果的占位工具（岗位库/知识库/MCP）刻意不进池** |
| 调错工具能自愈 | 未知工具名 / 非法参数 → 返回结构化错误让模型自我纠正，不崩溃 |
| 反幻觉铁律写进 Harness | `_harness_system_prompt()`：简历建议必须先 `read_resume`、禁止虚构经历 |
| 模型不支持 tools | 请求报错 → 自动降级为无工具纯文本回答 |
| 全链路审计 | 每次工具调用落 `student_agent_activity` |

**当前激活的工具池**：
- `query_student_profile` — 读学生档案
- `read_resume` — 读简历（本轮上传 + 个人中心已存 PDF，缺文本时现抽现存）
- `analyze_uploaded_file` — 解析本轮附件
- `get_session_context` — 回溯会话
- `export_resume_pdf` — 生成可下载简历 PDF（见 §6.4）
- `skill__<slug>` — 每个启用的 Skill（调用时把 SKILL.md 内容回灌，progressive disclosure）

> **主智能体不调用子智能体（2026-06 决策，见 §6.6）**：工具池只有内置工具 + Skill。

**SSE 事件**：`message.saved` / `activity.started` / `activity.completed` / `activity.failed` / `message.delta` / `message.completed` / `done` / `attachment.created`（生成文件下载入口）。

### 6.4 简历改写 → PDF 下载闭环

1. 学生在个人中心传简历 PDF（或对话里上传）。
2. 主智能体调 `read_resume` 读到真实简历文本。
3. 基于真实内容改写后调 `export_resume_pdf(markdown, filename)`。
4. `_render_resume_pdf()` 用 reportlab 把 Markdown 渲染成 PDF，**`_register_cjk_font()` 优先嵌入真实 CJK 字体**（Docker 装 `fonts-noto-cjk`，macOS 用系统字体；保证任意查看器中文不空白），落盘到 `data/agent_uploads/{tenant}/{user}/`，存为附件行。
5. 返回 `/data/...` 下载链接 → 发 `attachment.created` 事件 → 前端在助手气泡下渲染下载按钮（历史记录也会恢复）。

### 6.5 单体智能体广场（`agent/` + `admin/agent_*`）

管理员在「智能体管理」配置面试官 / 岗位匹配 / 简历优化 / 职业测评等独立智能体（`agent` 表，含 prompt 变量、欢迎语、可选 Dify 接入）。学生在智能体广场 `GET /agents` 浏览、`POST /agents/{id}/chat` 单轮对话（非流式，`core/llm_client.py` 或 `dify_client.py`）。启动时 `seed_default_agents()` 种入 4 个默认智能体。

### 6.6 子智能体路由（规划中接入主循环）

**设计决策（2026-06）：主智能体与子智能体解耦。** 按「任务型 vs 体验型」划分：

| 形态 | 例子 | 归属 |
|------|------|------|
| 任务型（一次性、无状态、输入→输出） | 简历优化、岗位匹配 | **Skill**，由主智能体在循环里编排 |
| 体验型（多轮、有人格、有状态） | AI 面试官、职业规划师、岗位推荐师 | **智能体广场的独立 `Agent`**，学生直接进入流式对话 |

技术理由：把有状态的多轮人格压成「工具调一次返回摘要」会毁掉其核心价值（如面试的一问一答一追问）。因此主循环**不再暴露 `subagent__*` 工具**；`_harness_system_prompt()` 让主智能体在遇到此类需求时**引导学生去广场**，而非自己扮演。

子智能体的实际入口：**智能体广场（`AgentPlaza`）卡片「去使用」→ `StudentAgentChat` 流式对话**，后端 `POST /agents/{id}/chat/stream`（direct LLM 真流式 / Dify blocking 整段下发）。

`master_route_rule`（`intent` + `target_provider` + `provider_config_json`）与 `_sync_dify_route()` 仍保留，但**当前主循环不消费**；可作为未来「主动委派」能力的接入点。

---

## 7. API 端点总览

> 统一前缀 `/api/v1`。受保护端点经 `require_role` 守卫。

**鉴权 `/auth`**：`GET captcha` · `POST student/email/send-code` · `POST student/register` · `POST student/login` · `POST student/reset-password` · `POST admin/login` · `GET me` · `PATCH me` · `POST refresh` · `POST logout`

**模型广场 `/admin`**：`GET|POST models` · `GET|PUT|DELETE models/{id}` · `POST models/{id}/test` · `POST models/test-batch` · `PATCH models/{id}/open` · `GET|PUT system/config` · `GET dashboard`

**主智能体配置 `/admin`**：`GET|PUT master/config` · `GET|POST master/routes` · `PUT|DELETE master/routes/{id}`

**智能体管理 `/admin/agents`**：`GET|POST ""` · `GET|PUT|DELETE {id}` · `PATCH {id}/toggle` · `POST test-dify`

**公开智能体 `/agents`**：`GET ""` · `GET {id}` · `POST {id}/chat`

**MCP 广场 `/admin`**：`GET|POST mcp-services` · `GET|PUT|DELETE mcp-services/{id}` · `PATCH mcp-services/{id}/status` · `POST mcp-services/{id}/discover` · `POST mcp-services/{id}/test` · `POST mcp-call` · `GET mcp-call-logs` · `GET mcp-tool-pool`

**Skills `/`**：`GET|POST admin/skills` · `GET|PUT|DELETE admin/skills/{id}` · `PATCH admin/skills/{id}/status` · `GET skills/enabled`

**学生端 `/student`**：`GET home` · `GET|PUT profile` · `POST profile/avatar` · `POST profile/banner` · 主智能体 `POST|GET master/sessions` · `DELETE master/sessions/{id}` · `GET master/sessions/{id}/messages` · `POST master/sessions/{id}/attachments` · `POST master/sessions/{id}/messages/stream`（SSE）· `GET master/models` · 简历 `GET attachments` · `POST attachments/upload` · `DELETE attachments/{id}` · 日程 `GET|POST events` · `PUT|DELETE events/{id}`

**健康检查**：`GET /healthz`（含 Redis 状态）· `GET /`

---

## 8. 前端架构（`frontend/src/`）

- `App.tsx` 路由：`/auth`、`/student`、`/admin`，按 `session.role` 重定向；`shared/ProtectedRoute.tsx` 角色守卫，`shared/AuthProvider.tsx` 管登录态。
- `shared/api.ts`：统一请求封装，自动附加 JWT；`extractErrorMessage` 把 422 校验错误用 `FIELD_LABELS`/`ERROR_TYPES` 映射成字段级中文提示（新增表单字段要补这两张表）。

**学生端路由（`StudentHomePage.tsx` 管理）**：
| 路径 | 组件 | 说明 |
|------|------|------|
| `/student` | `AgentChatView agentType="resume"` | AI简历助手 |
| `/student/interviewer` | `AgentChatView agentType="interviewer"` | AI面试官 |
| `/student/resumes` | `ResumeCenterPage` | 简历制作 |
| `/student/resumes/:id` | `ResumeEditorPage` | 在线简历编辑器 |
| `/student/profile` | `ProfilePage` | 个人中心 |

**核心组件**：
- **`AgentChatView.tsx`**：通用对话视图，处理所有聊天状态（messages/activities/streaming/attachments）。`agentType` 决定空状态样式和 session 创建参数。父子通信：`loadTrigger`（数字计数器）触发加载指定 session，`newChatTrigger` 触发重置，`onSessionUpdated` / `onActiveSessionChange` 回调同步侧栏状态。
- **`StudentHomePage.tsx`**：Shell 组件。维护 `resumeSessions` / `interviewerSessions` 两套列表，侧边栏分组显示历史对话（每组独立 [+] 按钮），侧边栏宽度可拖动（180–480px，存 `localStorage`）。导航 4 项：AI简历助手 · AI面试官 · 简历制作 · 个人中心。

**管理端** `AdminHomePage.tsx`：导航切换 `ModelPlaza` / `MasterAgentConfig` / `AgentManagementPage` / `SystemSettings`（MCP、Skills 广场同体系）。

React 19 兼容：用 `Alert` 而非 Arco `Message`；`element.ref` 警告可忽略。

---

## 9. 部署与运维

- **一键启动**：`docker compose up -d --build`（MySQL 3307 / Redis 6380 / backend 8000 / frontend 8080）。
- **环境变量**：`cp backend/.env.example backend/.env.docker` 后填密钥（`.env.docker` 已 gitignore），同步改 compose 里 MySQL/Redis 密码。
- **迁移自愈**：`entrypoint.sh` 对「已有库但无 `alembic_version`」按表存在性 `alembic stamp` 到对应版本再 `upgrade head`——**新增迁移若改了表判定链，必须同步 entrypoint 与 `alembic/env.py` 的 models 导入**。
- **启动种子**：lifespan 建表 → bootstrap 管理员 → seed 默认模型 → seed 默认智能体。
- **CJK 字体**：Dockerfile 装 `fonts-noto-cjk` 供简历 PDF 嵌入中文。

### 9.1 关键环境变量
| 变量 | 默认 | 说明 |
|------|------|------|
| `DATABASE_URL` | `sqlite:///./zhipei_auth.db` | 本地 SQLite / 生产 MySQL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis |
| `JWT_SECRET_KEY` | `change-me-in-production` | **生产必改** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | 30 / 7 | Token 有效期 |
| `ADMIN_BOOTSTRAP_*` | admin / 123456 | 初始管理员 |
| `SMTP_*` | — | 邮箱验证码（留空跳过发送） |
| `SKILL_STORAGE_DIR` / `AGENT_UPLOAD_STORAGE_DIR` | ./data/skills · ./data/agent_uploads | 文件落盘 |
| `*_MAX_BYTES` | — | Skill / 附件大小上限 |

---

## 10. 安全设计与技术债

**已具备**：JWT 双 Token + Redis 吊销、登录限流与审计日志、bcrypt 口令、多租户隔离、软删除、四态权限（`permission_mode`：auto/ask/strict）、反幻觉 Harness 护栏、子智能体在独立上下文真实执行。

**已知技术债（待偿还）**：
| 项 | 现状 | 建议 |
|----|------|------|
| 🔴 API Key「加密」 | `encrypt/decrypt_api_key` 实为 base64 ≈ 明文 | 升级 Fernet/AES-GCM，密钥从 env 注入；覆盖 model/dify/mcp/未来 KB 所有密钥 |
| 🟠 MCP 执行是假的 | `mcp/service.py` 的 `call_tool`/`test_service`/`discover_tools` 返回模拟数据 | 接真实 MCP 协议客户端（Streamable HTTP/SSE/stdio） |
| 🟠 知识库空白 | `query_knowledge_base` 占位 | 按计划挂 Dify 数据集（共享检索 + 子智能体可绑专属库） |
| 🟠 `ask` 模式无真正人在回路 | 当前 `ask` 仅对「需确认」风险工具软暂缓，无 SSE 确认往返；且现有工具池无高危工具，故 ask 与 auto 行为暂同 | 接入投递/发信等高危工具时补 SSE 确认往返 |
| 🟡 子智能体记忆策略未细化 | `memory_isolation`/`model_passthrough`/`memory_strategy` 已建模但循环未差异化消费（子智能体固定独立上下文 + 仅摘要回流） | 按配置实现透传/摘要回流 |
| ✅ `_sync_dify_route` intent 乱码 | 已修复：原写入 `"??Dify????..."`（编码损坏），现按「名称：简介。何时调用」生成可读中文 intent（模型选子智能体的依据）。注：数据库里**已存的旧乱码行需重新保存对应智能体**才会刷新 | — |
| 🟡 死代码 | 旧关键词规划（`_plan_tool_calls`/`_run_tool_planning`/`_compose_prompt`/`_stream_llm_response`/`assemble_tool_pool`）已被循环取代但未删 | 清理 |
| 🟡 无测试 / 无 CI | 仓库无测试套件、无 `.github/workflows`、后端无 linter | 给 `run_agent_loop` 补单测 + 加 CI |
| 🟡 本地 venv 版本错配 | `backend/.venv` 是 Python 3.9，但代码用 3.10+ 语法（仅 Docker 的 3.11 能跑） | 本地用 3.11 venv |

---

## 11. 开发路线图

| 里程碑 | 内容 | 状态 |
|--------|------|------|
| 双角色鉴权 + 模型广场 + 智能体广场 | JWT、登录注册、模型/智能体 CRUD | ✅ 已完成 |
| **主智能体 Agentic Loop 内核** | function-calling 循环 + Harness 护栏 + 简历读取/PDF 生成 | ✅ 已完成（2026-06-08） |
| **子智能体接入主循环 + 四态权限** | 路由规则成工具、builtin 真实执行、`permission_mode` 强制生效、`max_iterations` 尊重配置 | ✅ 已完成（2026-06-08） |
| **双智能体架构 + 对话历史分组** | AI简历助手 + AI面试官独立工具池/prompt，`agent_type` 分组侧栏，可拖动侧边栏 | ✅ 已完成（2026-06-10） |
| 知识库（Dify 数据集） | 共享检索 + 子智能体绑定专属库 | 📋 规划，见 `AGENT_LOOP_AND_KB_DEV_PLAN.md` |
| 子智能体增强 | Dify streaming、记忆策略差异化、`ask` 人在回路确认 | 📋 规划 |
| MCP 真实执行 | 真实协议客户端替换模拟 | 📋 规划 |
| 工程加固 | 测试 / CI / API Key 加密 | 📋 规划 |

---

## 12. 相关文档索引

| 文档 | 内容 |
|------|------|
| `CLAUDE.md` | 给 AI 协作者的架构速查 + 常用命令 + 陷阱 |
| `AGENT_LOOP_AND_KB_DEV_PLAN.md` | Agentic Loop + 知识库的后续分阶段开发计划 |
| `README.md` | 快速上手 / 部署 |
| `DOCKER_DEPLOY.md` | Docker 部署细节 |
| `Agent = Model + Harness ...docx`（团队内部） | 设计哲学纲领 |
