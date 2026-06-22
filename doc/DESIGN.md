# CareerForge-AI 系统设计文档

> 最后更新：2026-06-22（基于当前代码库重新整理）
>
> 产品需求见 `doc/PRD.md`，给 AI 协作者的速查见 `CLAUDE.md` / `AGENTS.md`。

---

## 1. 技术栈

| 层 | 技术 |
|----|------|
| 后端 | Python 3.11 · FastAPI 0.115 · SQLAlchemy 2 · Alembic · Pydantic v2 |
| 鉴权 | PyJWT · passlib[bcrypt] · Redis 5（吊销名单 / 验证码 / 限流） |
| 数据库 | MySQL 8.4（生产，零外键约束）/ SQLite（本地开发） |
| AI 运行时 | 自研 Agentic Loop（OpenAI function-calling · SSE 流式）· 面试官 Harness + 状态机 |
| 向量存储 | ChromaDB（面试官知识库 RAG） |
| LLM 调用 | httpx → OpenAI 兼容 `/chat/completions` · Dify API · 多模型 fallback 链 |
| 文档解析 | pypdf · python-docx · openpyxl · Pillow |
| 简历 PDF | reportlab（内嵌 CJK 字体）· html2pdf.js（前端客户端导出） |
| 富文本 | Tiptap（@tiptap/react + starter-kit + placeholder + underline） |
| 任务队列 | RQ（Redis-backed，PDF 导出等长任务） |
| 前端 | React 19 · TypeScript 6 · Vite 8 · Arco Design 2.66 · React Router 7 · react-markdown + remark-gfm |
| E2E 测试 | Playwright |
| 基础设施 | Docker Compose · Nginx 1.29 · fonts-noto-cjk |

---

## 2. 系统架构

### 2.1 部署拓扑

```
浏览器 ──:8080──▶ zhipei-frontend (nginx)
                  /        → React 静态资源
                  /api/    → backend:8000
                  /data/   → backend:8000 (附件/简历 PDF)
                  /static/ → backend:8000 (头像/横幅)
                        │
                  zhipei-backend (FastAPI + uvicorn :8000)
                   ┌────┴────┐
            zhipei-mysql 8.4   zhipei-redis 7
            (3307→3306)        (6380→6379)
                   │
            外部 LLM API（httpx 出站）
```

本地开发：后端 uvicorn（默认 SQLite）+ 前端 vite（dev proxy `/api` `/data` `/static` → `:8000`）。

### 2.2 后端分层（`backend/app/`）

按业务域分包，每个域含 `models.py` / `schemas.py` / `service.py` / `router.py`：

| 包 | 职责 |
|----|------|
| `auth/` | 注册/登录/JWT 双 Token/邮箱验证码/图形验证码/登录限流。`AuthIdentity`（含 `tenant_id`）、`get_current_identity`、`require_role` |
| `admin/` | 模型广场（`ModelConfig`）、智能体 CRUD、主智能体配置、系统设置、反馈管理 |
| `student/` | 学生端主智能体（Agentic Loop）、会话/消息/附件、简历 CRUD/快照/撤销、简历导入、AI 辅助、个人资料、日程、公告、反馈 |
| `interview/` | AI 面试官：Harness 校验层 + 8 阶段状态机 + 语音转写 + 知识库 RAG + 面试报告生成 + SSE 事件流 |
| `agent/` | 面向学生的公开智能体广场只读路由 |
| `skills/` | Skill 广场（Markdown 资产）CRUD + 内置 Skill |
| `mcp/` | MCP 广场 CRUD（执行目前为模拟） |
| `core/` | `config`(env) · `security`(JWT/bcrypt/Fernet) · `response`(统一信封) · `llm_client`(多模型 fallback) |
| `infra/` | `db`(engine/Session/Base) · `redis_client` · `rate_limit`(IP 限流中间件) |
| `jobs.py` | RQ 后台任务（PDF 导出等长任务） |

所有 router 在 `main.py` 以 `settings.api_v1_prefix`（默认 `/api/v1`）挂载。

### 2.3 统一响应信封

非流式端点一律返回：
```json
{ "code": 0, "msg": "ok", "data": { ... } }
```
前端 `shared/api.ts` 的 `apiRequest` 按此解析（流式 SSE 端点除外）。

### 2.4 多租户隔离

所有表带 `tenant_id`，所有查询必须按 `tenant_id`（通常还有 `student_id`）过滤。数据库零外键约束，一致性靠应用层。当前默认单租户 `tenant_id=0`。

---

## 3. 数据模型

> 零 FK（`mcp_tool→mcp_service` 是唯一例外），软删除用 `is_deleted`，时间戳用 `TimestampMixin`。

### 3.1 鉴权域

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `admin_user` | username, email, password_hash, display_name, status, avatar_url | 管理员 |
| `student_user` | account, email, password_hash, name, **nickname**, college, major, grade, gender, age, avatar_url, banner_url, signature, birth_date | 学生 |
| `*_refresh_token` | token_hash, expires_at, revoked | refresh token 存证 |
| `*_login_log` | ip, ua, result, reason | 登录审计 |
| `student_email_code` | email, scene, code_hash, expires_at, send_count, attempt_count | 邮箱验证码 |

### 3.2 管理域

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `model_config` | display_name, provider, base_url, **api_key_cipher**(Fernet), model_identifier, capability, open_to_student, status | 模型广场 |
| `model_test_log` | model_id, success, latency_ms, error_message | 连接测试日志 |
| `system_config` | config_key, config_value | 键值配置 |
| `agent` | name, category, model_config_id, system_prompt, temperature, use_dify, dify_api_key_cipher | 单体智能体 |
| `master_agent_config` | model_id, system_prompt, temperature, max_iterations, permission_mode | 主智能体 Harness 配置 |
| `master_route_rule` | intent, target_agent_key, target_provider, provider_config_json | 子智能体路由规则 |
| `user_feedback` | student_id, description, category, screenshot_path, status | 学生反馈 |

### 3.3 学生端域

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `student_agent_session` | tenant_id, student_id, title, status, **agent_type**, summary, **active_resume_id**, memory_json, summarized_until_message_id | 对话会话 |
| `student_agent_message` | session_id, role, content | 消息 |
| `student_agent_activity` | session_id, message_id, kind, name, status, summary, detail_json | 工具活动审计 |
| `student_agent_attachment` | session_id, message_id, original_name, stored_path, content_type, extracted_text, status | 附件/简历/PDF |
| `student_agent_run` | session_id, status, error_text | 后台运行实例 |
| `student_resume` | student_id, title, content_json, visibility, avatar_url | 在线简历 |
| `student_resume_revision` | resume_id, content_json, created_at | 简历快照（撤销用，每份最多 20 条） |
| `student_event` | student_id, title, date, ... | 日程事件 |
| `student_*_detail` | (profile_details_models.py) | 档案明细：教育/工作/项目/技能/荣誉/证书 |

### 3.4 面试官域

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `interview_session` | student_id, interview_type, status, round_limit, focus_tags, resume_snapshot, jd_text | 面试会话 |
| `interview_turn` | session_id, turn_number, question, answer, score_json, followup, stage | 单轮问答 |
| `interview_report` | session_id, overall_score, dimension_scores_json, summary, strengths, weaknesses, training_plan | 面试报告 |

### 3.5 Skill / MCP 域

| 表 | 关键字段 | 说明 |
|----|----------|------|
| `skill_asset` | slug, name, description, version, category, status, file_path, content_hash | Skill（Markdown） |
| `mcp_service` | slug, name, transport, endpoint, auth_type, status | MCP 服务 |
| `mcp_tool` | service_id, name, description, risk, input_schema_json, enabled | MCP 工具 |
| `mcp_call_log` | service_name, tool_name, success, latency_ms | 调用日志 |

迁移文件：`backend/alembic/versions/`，命名 `YYYYMMDD_NNNN_slug.py`。

---

## 4. 核心机制

### 4.1 鉴权

- **JWT 双 Token**：access（30 min）+ refresh（7 天）。载荷含 `sub`(user_id) / `role` / `tenant_id`。
- **Redis**：refresh token 吊销名单、邮箱验证码、登录限流。
- **Fernet 加密**：API Key 使用 `cryptography.fernet` 真加密（AES-128-CBC + HMAC-SHA256），密钥从 `API_KEY_ENCRYPTION_KEY` 环境变量注入。
- **IP 限流**：`rate_limit.py` 中间件，Redis 固定窗口计数，200 rps/IP/60s，Redis 挂掉 fail-open。

### 4.2 模型广场与模型选择

管理员登记 OpenAI 兼容模型（`base_url` + `model_identifier` + `api_key_cipher` + `capability` + `open_to_student`）。

主智能体选模型 `_select_chat_model()`：请求指定 model_id > 主智能体配置 model > 第一个对学生开放的 chat 模型。只接受 `capability ∈ (text, multimodal, chat)` 且 `open_to_student` 且 `status==active`。

### 4.3 ⭐ 学生端主智能体：Agentic Loop

**核心文件**：`student/agent_runtime.py`（5000+ 行）

Model + Harness 架构：模型用 OpenAI function-calling 自主调工具，Harness 执行/校验/审计并回灌，直到最终答复或触顶 `max_iterations`（默认 8，安全上限 20）。

**调用链**：
```
POST /student/master/sessions/{id}/messages/stream
→ stream_master_reply()
  → 保存用户消息 → 发 message.saved
  → _select_chat_model() 选模型
  → 读 session.agent_type 决定工具池
  → _build_initial_messages() 组装上下文
  → run_agent_loop() Harness 主循环
  → 持久化最终答复 → 发 message.completed / done
```

**工具池**（按 `session.agent_type` 路由）：

| 工具 | AI 简历助手 | AI 面试官 |
|------|-----------|----------|
| `query_student_profile` | ✅ | ✅ |
| `read_resume` | ✅ | ✅（只读） |
| `analyze_uploaded_file` | ✅ | ✅ |
| `get_session_context` | ✅ | ✅ |
| `export_resume_pdf` | ✅ | ❌ |
| `save_session_note` | ✅ | ❌ |
| `update_resume_data` | ✅ | ❌ |
| `skill__*` | ✅ | ❌ |

**Harness 护栏**：
- 循环由 Harness 控制，模型无法自行决定
- 四态权限：`auto` 全放行 / `ask` 放行低风险 / `strict` 仅内置工具
- 只暴露能诚实兑现的工具（占位工具刻意不进池）
- 调错工具返回结构化错误，模型自我纠正
- 反幻觉铁律写进 system prompt
- 全链路审计（每次工具调用落 `student_agent_activity`）

**工作区模型**：
- `session.active_resume_id` 绑定当前工作简历
- `read_resume` 返回两层（全部简历列表 + 工作简历全文）
- `update_resume_data` 做章节级局部合并
- `base_updated_at` 做写前版本检查防覆盖

**会话记忆**：
- `session.memory_json`（constraints/facts/preferences）
- 模型通过 `save_session_note` 工具写入
- 每轮注入 system prompt（pinned，不被截断）

**事实校验 + 质量闸门**：
- `_validate_resume_facts`：实体级校验，防幻觉
- `_check_resume_quality`：强动词率、量化占比、bullet 长度等
- `FACT_GUARD_SHADOW_MODE`：可切换仅日志不拦截

**上下文组装**：分层（system + 工作简历状态 + 记忆 + 滚动摘要 + 最近 K 轮全文 + 更早截断）

**思考程度系统**（`reasoning_effort`）：
- 前端可选六档：`auto` / `low` / `medium` / `high` / `xhigh` / `max`，默认 `auto`
- `auto` 模式由 `auto_classify_effort()` 根据消息内容自动判断（问候→low、简历操作→medium、JD分析→high、全面重写→xhigh）
- 配置函数 `get_model_effort_config()` 返回每个模型的 `supported_efforts`（前端可选档位）、`effort_api_params`（API 参数映射）、`reasoning_temp`（推理温度覆盖）
- 模型列表 API（`GET /student/master/models`）返回 `supported_efforts` 字段，前端据此动态过滤可选档位

| 模型类型 | 生效方式 | supported_efforts |
|---------|---------|-------------------|
| OpenAI o1/o3/o4/gpt-5 | 原生 `reasoning_effort` API 参数 | low/medium/high/[xhigh] |
| Anthropic Claude | `thinking.type: "enabled"` + `budgetTokens`（4K/10K/16K） | low/medium/high |
| Anthropic Claude 4.6+ | 同上，max=31999 | low/medium/high/max |
| Google Gemini 2.5 | `thinkingConfig.thinkingBudget`（4K/10K/16K/24-32K） | low/medium/high/max |
| DeepSeek | 不发送参数（推理始终开启），仅 system prompt 引导 | low/medium/high |
| 其他模型 | 仅 system prompt 文字引导 | low/medium/high |

- 温度控制：`get_model_default_temperature()` 按模型 ID 设置默认值（Qwen=0.55, Gemini=1.0, GLM=1.0 等），管理端配置优先。推理模式下 Claude/Gemini 强制 temperature=1.0

**RunManager**（`run_manager.py`）：
- `POST /student/master/sessions/{id}/runs` 启动后台运行
- `GET /student/master/runs/{id}/events?after_seq=N` 订阅 SSE（断线重连按 seq 续传）

**主智能体 SSE 事件**：`message.saved` / `activity.started|completed|failed` / `message.delta` / `message.snapshot` / `message.completed` / `done` / `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.completed`

### 4.4 ⭐ AI 面试官：Harness + 状态机

**核心文件**：`interview/service.py`（2358 行）、`interview/harness.py`（1319 行）、`interview/state_machine.py`

面试官不走主智能体 Agentic Loop，有自己独立的 Harness 实现。

**8 阶段状态机**：
```
opening → self_intro → resume_deep_dive → technical_core → scenario → pressure → reverse_question → wrap_up → completed
```
根据面试类型（通用/技术/HR/压力面试）动态裁剪阶段。

**Harness 校验层**：
- 模型输出候选 JSON，Harness 负责验收、修复、降级、停止判定
- `_strict_bool`：严格布尔解析，拒绝字符串 'true'/'false'（防止 `bool('false') == True` 误判结束）
- 评分 6 维度：technical_accuracy / project_evidence / problem_solving / communication / job_fit / pressure_handling
- 证据引用匹配（`_filter_evidence_quotes`）：归一化文本后做宽松匹配
- 追问输出校验（`validate_followup_output`）
- 面试结束判定（`harness_should_finish_interview`）

**简历锚点**（`resume_anchors.py`）：从学生简历中提取关键经历点，作为面试追问的事实依据。

**知识库 RAG**（`knowledge.py`）：
- ChromaDB 向量存储
- 支持文档导入、分块、嵌入
- 面试过程中检索相关知识点辅助出题

**语音面试**（`voice_service.py`）：
- 学生上传音频文件 → LLM 转写为文字 → 走正常面试流程
- 支持 wav/mp3/webm 等格式，最大 10MB
- 转写结果通过 SSE 事件 `interview.voice.transcribed` 推送

**面试报告**（`report_generator.py`）：
- 维度评分汇总 + 总体评价 + 优势/不足 + 训练计划
- 流式生成，通过 SSE 事件推送

**面试官 SSE 事件**（`run_events.py`，Redis 优先 + 内存降级）：
- `interview.started` / `interview.stage.started|completed|delta`
- `interview.question.created` / `interview.turn.scored|completed`
- `interview.voice.transcribed` / `interview.report.created`
- `interviewer.delta|snapshot|completed` / `runtime.status|error`

**路由**：
- `interview/router.py`：同步 CRUD（创建/列表/详情/删除/报告）
- `interview/router_student.py`：SSE run 模式（提交回答、语音提交、报告生成均走后台任务 + 事件流）

### 4.5 简历编辑器

**在线简历编辑**（`student/resume_router.py` + `frontend/src/resume/`）：
- 10 套预设模板（经典/现代/优雅/极简/时间线/左右分栏/创意/编辑/瑞士/空白）
- Tiptap 富文本编辑器（加粗/斜体/下划线/列表/占位符）
- 实时预览 + 模板切换
- AI 辅助面板（`ai_assist_router.py`）：polish / quantify / concise / expand / translate_en / custom 六种指令
- 导出方式：reportlab 服务端 PDF + html2pdf.js 客户端 PDF

**简历快照与撤销**：
- `student_resume_revision` 表，每份简历最多 20 条快照
- `POST /student/resumes/{id}/revert` 撤销到指定版本

### 4.6 后台任务（RQ）

`jobs.py` + `jobs_router.py`：
- Redis-backed RQ 队列
- 长任务（PDF 导出等）入队 → worker 消费 → 轮询状态
- `GET /api/v1/jobs/{id}` 查询任务状态

### 4.7 定时任务

`jobs.py` 中的 lifespan 清扫：
- 启动时把 `status=running` 的孤儿 run 标记为 `failed`

---

## 5. 前端架构

### 5.1 路由

| 路径 | 组件 | 说明 |
|------|------|------|
| `/auth` | `AuthPage` | 登录/注册（Tab 切换） |
| `/student` | `AgentChatView agentType="resume"` | AI 简历助手 |
| `/student/interviewer` | `AIInterviewerPage` | AI 面试官（含语音面试 + 报告抽屉） |
| `/student/resumes` | `ResumeCenterPage` | 简历制作（模板库） |
| `/student/resumes/:id` | `ResumeEditorPage` | 简历编辑器（Tiptap + AI 辅助） |
| `/student/profile` | `ProfilePage` | 个人中心（Modal） |
| `/admin` | `AdminHomePage` | 管理端（模型广场/智能体配置/Skill/MCP/系统设置/反馈） |

### 5.2 核心组件

- **`chatRuntimeStore.ts`**：对话运行时唯一数据源（单例，订阅模式）。管理 SSE 连接、`segments` 时间线（text/actions 交错）、并行会话状态。`abortSession(id)` 杀单个会话，`abort()` 杀所有。
- **`AgentChatView.tsx`**：通用对话视图。Session 惰性创建（首条消息才 POST）。父组件通过 `loadTrigger`/`newChatTrigger` 计数器驱动。
- **`StudentHomePage.tsx`**：Shell 组件。两套 session 列表（resume/interviewer），侧边栏分组，宽度可拖动（180–480px，存 localStorage）。
- **`AIInterviewerPage.tsx`**：面试官独立页面。含面试配置、实时面试对话、语音录制、SSE 事件订阅、进度展示、面试报告抽屉。
- **`InterviewReportDrawer.tsx`**：面试报告侧边抽屉（维度评分、总结、训练计划）。
- **`InterviewHistoryDrawer.tsx`**：历史面试记录抽屉。
- **`ErrorBoundary.tsx`**：全局错误边界，捕获子树异常显示中文错误面。
- **`shared/api.ts`**：统一请求封装。`apiRequest`（信封解析 + 401 自动刷新）、`authenticatedFetch`（流式/文件）。禁止裸 fetch。

### 5.3 简历编辑器前端

- `RichTextEditor.tsx`：Tiptap 富文本编辑器
- `AiAssistPanel.tsx` / `FieldAiAssist.tsx`：AI 辅助面板（per-field + toolbar）
- `PreviewPanel.tsx`：实时预览
- `TemplatePicker.tsx`：模板选择器
- `exportResumePdf.ts`：html2pdf.js 客户端导出
- `content.ts`：内容处理工具函数

---

## 6. API 端点总览

> 统一前缀 `/api/v1`。受保护端点经 `require_role` 守卫。

| 模块 | 端点 |
|------|------|
| **鉴权** `/auth` | `GET captcha` · `POST student/email/send-code` · `POST student/register` · `POST student/login` · `POST student/reset-password` · `POST admin/login` · `GET me` · `PATCH me` · `POST refresh` · `POST logout` |
| **模型广场** `/admin` | `GET\|POST models` · `GET\|PUT\|DELETE models/{id}` · `POST models/{id}/test` · `POST models/test-batch` · `PATCH models/{id}/open` · `GET\|PUT system/config` · `GET dashboard` |
| **主智能体** `/admin` | `GET\|PUT master/config` · `GET\|POST master/routes` · `PUT\|DELETE master/routes/{id}` |
| **智能体管理** `/admin/agents` | `GET\|POST ""` · `GET\|PUT\|DELETE {id}` · `PATCH {id}/toggle` · `POST test-dify` |
| **公开智能体** `/agents` | `GET ""` · `GET {id}` · `POST {id}/chat` |
| **MCP** `/admin` | `GET\|POST mcp-services` · `GET\|PUT\|DELETE mcp-services/{id}` · `POST mcp-services/{id}/discover\|test` · `POST mcp-call` · `GET mcp-call-logs` · `GET mcp-tool-pool` |
| **Skills** `/` | `GET\|POST admin/skills` · `GET\|PUT\|DELETE admin/skills/{id}` · `PATCH admin/skills/{id}/status` · `GET skills/enabled` |
| **学生端** `/student` | `GET home` · `GET\|PUT profile` · `POST profile/avatar\|banner` · 主智能体 `POST\|GET master/sessions` · `DELETE master/sessions/{id}` · `GET master/sessions/{id}/messages` · `POST master/sessions/{id}/messages/stream`（SSE）· `POST master/sessions/{id}/runs` · `GET master/runs/{id}/events` · 简历 `GET\|POST resumes` · `GET\|PUT\|DELETE resumes/{id}` · `POST resumes/{id}/revert` · AI 辅助 `POST resumes/ai-assist` · 附件 `POST attachments/upload` · 日程 `GET\|POST events` · `PUT\|DELETE events/{id}` · 档案明细 CRUD · 公告 · 反馈 |
| **面试官** `/student/interviews` | `POST ""`（创建）· `GET ""`（列表）· `GET /{id}`（详情）· `POST /{id}/turns`（文字回答）· `POST /{id}/turns/run`（文字回答 SSE）· `POST /{id}/turns/voice/run`（语音回答 SSE）· `POST /{id}/report`（生成报告）· `GET /{id}/report`（获取报告）· `GET /{id}/export`（导出）· `DELETE /{id}` · `POST /resume/extract` |
| **后台任务** `/jobs` | `GET /{id}`（查询任务状态） |
| **健康检查** | `GET /healthz`（含 Redis + MySQL 状态）· `GET /` |

---

## 7. 部署与运维

### 7.1 Docker Compose

```bash
cp backend/.env.example backend/.env.docker  # 填写密钥
docker compose up -d --build
```

5 个服务：MySQL(3307) · Redis(6380) · backend(8000) · frontend(8080) · rq-worker

### 7.2 关键环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `DATABASE_URL` | `sqlite:///./zhipei_auth.db` | 本地 SQLite / 生产 MySQL |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis |
| `JWT_SECRET_KEY` | `change-me-in-production` | **生产必改** |
| `API_KEY_ENCRYPTION_KEY` | — | **必填** Fernet 密钥（32-byte url-safe base64） |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `REFRESH_TOKEN_EXPIRE_DAYS` | 30 / 7 | Token 有效期 |
| `ADMIN_BOOTSTRAP_*` | admin / 123456 | 初始管理员 |
| `SMTP_*` | — | 邮箱验证码（留空跳过） |
| `SKILL_STORAGE_DIR` / `AGENT_UPLOAD_STORAGE_DIR` | `./data/skills` · `./data/agent_uploads` | 文件落盘 |
| `INTERVIEW_KNOWLEDGE_BASE_DIR` | — | 面试官知识库目录（macOS/Linux 必须覆盖） |
| `API_RATE_LIMIT_RPS` / `API_RATE_LIMIT_WINDOW_SECONDS` | 200 / 60 | IP 限流 |

### 7.3 迁移自愈

`entrypoint.sh` 对「已有库但无 `alembic_version`」按表存在性 stamp 到对应版本再 upgrade head。

### 7.4 启动种子

lifespan 建表 → bootstrap 管理员 → seed 默认模型 → seed 默认智能体 → 清扫孤儿 run

---

## 8. 安全设计

| 机制 | 实现 |
|------|------|
| 鉴权 | JWT 双 Token + Redis 吊销名单 |
| 密码 | bcrypt |
| API Key | Fernet 真加密（AES-128-CBC + HMAC-SHA256） |
| 登录限流 | 5 次失败 → 锁定 15 分钟 |
| IP 限流 | 200 rps/IP/60s，Redis 固定窗口，fail-open |
| 多租户 | 所有查询按 tenant_id 隔离 |
| 软删除 | is_deleted 字段，不物理删除 |
| 权限控制 | 四态权限（auto/ask/strict） |
| 反幻觉 | Harness 层面强制 AI 基于真实数据操作 |
| 文件下载 | HMAC 签名 token，10 分钟过期 |

---

## 9. 已知技术债

| 项 | 状态 | 说明 |
|----|------|------|
| MCP 执行是假的 | 🟠 | `mcp/service.py` 返回模拟数据，待接真实 MCP 协议客户端 |
| `ask` 模式无真正人在回路 | 🟠 | 当前 ask 与 auto 行为暂同，接入高危工具时需补 SSE 确认往返 |
| 子智能体记忆策略未细化 | 🟡 | `memory_isolation` / `model_passthrough` 已建模但循环未差异化消费 |
| 本地 venv 版本错配 | 🟡 | `.venv` 可能是 Python 3.9，代码用 3.10+ 语法，建议用 3.11 |

---

## 10. 开发路线图

| 里程碑 | 状态 |
|--------|------|
| 双角色鉴权 + 模型广场 + 智能体广场 | ✅ |
| 主智能体 Agentic Loop 内核 | ✅ |
| 双智能体架构（简历助手 + 面试官） | ✅ |
| 简历在线编辑器（Tiptap + 10 套模板 + AI 辅助） | ✅ |
| AI 面试官升级（Harness + 状态机 + 语音 + 报告） | ✅ |
| 后端安全加固（Fernet + IP 限流 + 业务索引） | ✅ |
| 知识库 RAG（ChromaDB） | ✅ 基础版 |
| MCP 真实执行 | 📋 规划 |
| 子智能体增强（Dify streaming、记忆策略） | 📋 规划 |
| 工程加固（CI/CD、更多测试） | 📋 规划 |
