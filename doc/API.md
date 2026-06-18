# API 接口文档

> 最后更新：2026-06-18
>
> 权威源头：FastAPI 自动生成的 `/docs`（Swagger UI，可在容器启动后访问 `http://localhost:8000/docs`）
>
> 本文档是「按业务域分组的端点速查表」，详细的请求/响应字段以 Swagger 为准。

## 1. 基础约定

### 1.1 统一前缀

所有 API 走 `/api/v1` 前缀（从 `settings.api_v1_prefix` 读取）。

### 1.2 统一响应信封

所有非流式端点返回 `{code, msg, data}` 三段式：

```json
{ "code": 0, "msg": "ok", "data": { ... } }
```

- `code: 0` 表示成功
- 错误时 `code` 为业务错误码，`msg` 为中文/英文提示
- 422 校验错误会被前端 `extractErrorMessage` 映射为中文字段提示

### 1.3 鉴权

- 除登录/注册/验证码/公开智能体外，端点都需 JWT
- HTTP Header：`Authorization: Bearer <access_token>`
- access token 30 分钟有效，refresh token 7 天有效
- 刷新机制：`POST /auth/refresh` 用 refresh 换新 access

### 1.4 流式端点（SSE）

学生端主智能体、面试官的回复、报告生成都走 **Server-Sent Events**。SSE 事件名详见各模块。

## 2. 按业务域分组

### 2.1 鉴权（`/auth`）

> 源：`backend/app/auth/router.py`

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/auth/captcha` | 获取图形验证码（注册/重置前） |
| POST | `/auth/student/email/send-code` | 发送邮箱验证码（注册/重置） |
| POST | `/auth/student/register` | 学生注册 |
| POST | `/auth/student/login` | 学生登录（邮箱 + 密码） |
| POST | `/auth/student/reset-password` | 重置学生密码（邮箱 + 验证码 + 新密码） |
| POST | `/auth/admin/login` | 管理员登录 |
| GET | `/auth/me` | 获取当前用户信息（按 token 角色返回 student / admin 视图） |
| PATCH | `/auth/me` | 更新当前用户基础信息 |
| POST | `/auth/refresh` | 用 refresh token 换新 access token |
| POST | `/auth/logout` | 登出（refresh token 进 Redis 吊销名单） |

### 2.2 管理端（`/admin`）

> 源：`backend/app/admin/router.py` + `backend/app/admin/master_router.py` + `backend/app/admin/agent_router.py`
> 鉴权：`require_role("admin")`

#### 2.2.1 模型广场

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/models` | 列出所有模型配置 |
| POST | `/admin/models` | 新增模型配置 |
| GET | `/admin/models/{id}` | 查看模型详情 |
| PUT | `/admin/models/{id}` | 更新模型配置 |
| DELETE | `/admin/models/{id}` | 删除模型配置 |
| POST | `/admin/models/{id}/test` | 测试单个模型连通性 |
| POST | `/admin/models/test-batch` | 批量测试模型 |
| PATCH | `/admin/models/{id}/open` | 切换 `open_to_student` |

#### 2.2.2 系统配置 / 仪表盘

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/system/config` | 获取键值对系统配置 |
| PUT | `/admin/system/config` | 更新键值对系统配置 |
| GET | `/admin/dashboard` | 仪表盘聚合数据 |

#### 2.2.3 主智能体配置

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/master/config` | 获取主智能体 Harness 全局配置 |
| PUT | `/admin/master/config` | 更新主智能体 Harness 全局配置 |
| GET | `/admin/master/routes` | 列出主智能体路由规则 |
| POST | `/admin/master/routes` | 新增路由规则 |
| PUT | `/admin/master/routes/{id}` | 更新路由规则 |
| DELETE | `/admin/master/routes/{id}` | 删除路由规则 |

#### 2.2.4 子智能体

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/agents` | 列出所有子智能体 |
| POST | `/admin/agents` | 新增子智能体 |
| GET | `/admin/agents/{id}` | 查看子智能体详情 |
| PUT | `/admin/agents/{id}` | 更新子智能体 |
| DELETE | `/admin/agents/{id}` | 删除子智能体 |
| PATCH | `/admin/agents/{id}/toggle` | 启用/停用切换 |
| POST | `/admin/agents/test-dify` | 测试 Dify 集成 |

#### 2.2.5 MCP 管理

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/mcp-services` | 列出 MCP 服务 |
| POST | `/admin/mcp-services` | 注册 MCP 服务 |
| GET | `/admin/mcp-services/{id}` | 查看 MCP 服务详情 |
| PUT | `/admin/mcp-services/{id}` | 更新 MCP 服务 |
| DELETE | `/admin/mcp-services/{id}` | 删除 MCP 服务 |
| POST | `/admin/mcp-services/{id}/discover` | 自动发现工具列表 |
| POST | `/admin/mcp-services/{id}/test` | 测试 MCP 连通性 |
| POST | `/admin/mcp-call` | 管理端手动调用 MCP 工具 |
| GET | `/admin/mcp-call-logs` | 查看 MCP 调用日志 |
| GET | `/admin/mcp-tool-pool` | 查看可用 MCP 工具池 |

#### 2.2.6 Skill 管理

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/admin/skills` | 列出所有 Skill 资产 |
| POST | `/admin/skills` | 上传 Skill 资产 |
| GET | `/admin/skills/{id}` | 查看 Skill 详情 |
| PUT | `/admin/skills/{id}` | 更新 Skill 元信息 |
| DELETE | `/admin/skills/{id}` | 删除 Skill |
| PATCH | `/admin/skills/{id}/status` | 启用/停用切换 |

### 2.3 公开智能体广场（`/agents`）

> 源：`backend/app/agent/router.py`
> 鉴权：学生登录即可访问

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/agents` | 列出对学生开放的智能体 |
| GET | `/agents/{id}` | 查看智能体详情 |
| POST | `/agents/{id}/chat` | 与该智能体对话（非流式） |

### 2.4 学生端（`/student`）

> 源：`backend/app/student/router.py` + `attachment_router.py` + `event_router.py` + `resume_router.py` + `ai_assist_router.py`
> 鉴权：`require_role("student")`

#### 2.4.1 主页 / 个人中心

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/student/home` | 学生首页聚合数据 |
| GET | `/student/profile` | 获取个人档案 |
| PUT | `/student/profile` | 更新个人档案 |
| POST | `/student/profile/avatar` | 上传头像 |
| POST | `/student/profile/banner` | 上传横幅 |

#### 2.4.2 主智能体（AI 简历助手 / AI 面试官共用）

| 方法 | 端点 | 用途 |
|---|---|---|
| POST | `/student/master/sessions` | 创建会话（请求体含 `agent_type`：`resume` / `interviewer`） |
| GET | `/student/master/sessions` | 列出当前学生的所有会话 |
| DELETE | `/student/master/sessions/{id}` | 删除会话 |
| GET | `/student/master/sessions/{id}/messages` | 列出会话的所有消息 |
| POST | `/student/master/sessions/{id}/messages/stream` | 发送消息并流式接收回复（**SSE**） |
| POST | `/student/master/sessions/{id}/runs` | 启动后台运行 |
| GET | `/student/master/runs/{id}/events` | 订阅后台运行事件流（**SSE**，断线重连按 seq 续传） |

**SSE 事件名**：
- `message.saved` / `activity.started` / `activity.completed` / `activity.failed`
- `message.delta` / `message.snapshot` / `message.completed` / `done`
- `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.completed`

#### 2.4.3 简历（在线简历编辑器）

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/student/resumes` | 列出当前学生的所有简历 |
| POST | `/student/resumes` | 新建简历 |
| GET | `/student/resumes/{id}` | 查看简历详情 |
| PUT | `/student/resumes/{id}` | 更新简历 |
| DELETE | `/student/resumes/{id}` | 删除简历 |
| POST | `/student/resumes/{id}/revert` | 撤销到指定快照版本 |
| POST | `/student/resumes/ai-assist` | AI 辅助（polish / quantify / concise / expand / translate_en / custom） |

#### 2.4.4 附件上传

| 方法 | 端点 | 用途 |
|---|---|---|
| POST | `/student/attachments/upload` | 上传文件（PDF/DOCX/JSON/图片） |
| GET | `/student/files/download` | 通过签名 token 下载附件（10 分钟过期） |

#### 2.4.5 日程事件

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/student/events` | 列出日程事件 |
| POST | `/student/events` | 新建日程事件 |
| PUT | `/student/events/{id}` | 更新日程事件 |
| DELETE | `/student/events/{id}` | 删除日程事件 |

#### 2.4.6 档案明细（教育/工作/项目/技能/荣誉/证书）

每个明细子表都有标准的 CRUD 端点，前缀 `/student/profile-details/...`（具体路径在 `backend/app/student/router.py` 中以 sub-router 挂载）。

#### 2.4.7 反馈工单

| 方法 | 端点 | 用途 |
|---|---|---|
| POST | `/student/feedbacks` | 提交反馈 |

### 2.5 面试官（`/student/interviews`）

> 源：`backend/app/interview/router.py` + `router_student.py`
> 鉴权：`require_role("student")`

| 方法 | 端点 | 用途 |
|---|---|---|
| POST | `/student/interviews` | 创建面试会话（指定 `interview_type`） |
| GET | `/student/interviews` | 列出当前学生的所有面试 |
| GET | `/student/interviews/{id}` | 查看面试详情 |
| POST | `/student/interviews/{id}/turns` | 提交一轮文字回答（同步） |
| POST | `/student/interviews/{id}/turns/run` | 提交文字回答并流式接收处理过程（**SSE**） |
| POST | `/student/interviews/{id}/turns/voice/run` | 提交语音回答并流式接收转写/处理过程（**SSE**） |
| POST | `/student/interviews/{id}/report` | 触发生成面试报告（**SSE**） |
| GET | `/student/interviews/{id}/report` | 获取已生成的面试报告 |
| GET | `/student/interviews/{id}/export` | 导出面试报告（PDF） |
| DELETE | `/student/interviews/{id}` | 删除面试会话 |
| POST | `/student/interviews/resume/extract` | 从简历中提取面试锚点（供 Harness 追问用） |

**SSE 事件名**：
- `interview.started` / `interview.stage.started` / `interview.stage.completed` / `interview.stage.delta`
- `interview.question.created` / `interview.turn.scored` / `interview.turn.completed`
- `interview.voice.transcribed` / `interview.report.created`
- `interviewer.delta` / `interviewer.snapshot` / `interviewer.completed`
- `runtime.status` / `runtime.error`

### 2.6 后台任务（`/jobs`）

> 源：`backend/app/jobs/router.py`
> 鉴权：登录用户

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/jobs/{id}` | 查询 RQ 后台任务状态（pending / running / finished / failed） |

### 2.7 健康检查

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/healthz` | 容器健康检查（包含 Redis + MySQL 状态） |
| GET | `/` | 服务根（返回基本信息） |
| GET | `/docs` | Swagger UI（自动生成） |
| GET | `/openapi.json` | OpenAPI 规范 JSON |

## 3. SSE 通用约定

所有 SSE 端点都遵循以下约定：

- **Content-Type**: `text/event-stream`
- **断线重连**：客户端带 `?after_seq=N` 从指定序号续传（`after_seq` 缺省 = 拉全部历史）
- **心跳**：超过 15s 无新事件自动发 `runtime.heartbeat` 保活
- **结束事件**：`done` / `runtime.completed` 表示该次运行正常结束
- **错误事件**：`runtime.error` / `activity.failed` 表示出错，客户端可展示并停止监听

## 4. 多租户隔离

所有 `/student/*` 端点都会从 JWT 中读 `tenant_id`，服务端强制按 `tenant_id` 过滤。学生之间**不可能**通过任何端点访问到对方的数据。

## 5. 待补章节

- 每个端点的请求/响应字段详细 schema（建议从 FastAPI 自动生成的 `/openapi.json` 渲染）
- 鉴权重置/验证码限流等安全相关中间件的具体阈值
