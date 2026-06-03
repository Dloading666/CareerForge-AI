# 智培职联 · AI 智能体平台 — FastAPI 接口设计文档（V1）

> 配套《产品设计文档 V4》《MySQL 表设计》。FastAPI 作为前端唯一入口（BFF），向下编排 LangGraph / Dify。
> §6 为**端到端设计校验**——逐一验证「表 + 接口」能否支撑整个项目运行。

---

## 1. 通用约定

- **Base**：`/api`；版本前缀 `/api/v1`。
- **鉴权**：`Authorization: Bearer <JWT>`。JWT payload 含 `sub`(用户 id)、`role`(admin/student)、`tenant_id`、`exp`。登录返回 access(短) + refresh(长)。
- **角色守卫**：管理员接口 `/api/v1/admin/**` 仅 `role=admin`；学生接口 `/api/v1/student/**` 仅 `role=student`。越权 → 403。
- **统一响应包**：
  ```json
  { "code": 0, "msg": "ok", "data": { } }
  ```
  `code=0` 成功；非 0 为业务错误码。HTTP 状态码同时语义化（400/401/403/404/409/422/500）。
- **错误示例**：`{ "code": 1001, "msg": "API Key 鉴权失败 (401)", "data": null }`。
- **分页**：query `page`(从1)、`size`(默认20)；返回 `{ "list": [...], "total": N, "page": p, "size": s }`。
- **流式**：对话/面试用 **SSE**（`Content-Type: text/event-stream`），事件见 §5.2。
- **时间**：ISO8601 UTC。**金额/密钥**永不返回明文（密钥回显 `sk-****1234`）。

---

## 2. 鉴权 Auth

| 方法 | 路径 | 说明 | 请求 | 响应 data |
|---|---|---|---|---|
| POST | `/api/v1/auth/login` | 账号密码登录 | `{role, account, password}` | `{access, refresh, role, profile}` |
| POST | `/api/v1/auth/login/sms` | 短信验证码登录 | `{role, phone, code}` | 同上 |
| POST | `/api/v1/auth/refresh` | 刷新 access | `{refresh}` | `{access}` |
| POST | `/api/v1/auth/logout` | 注销（吊销 refresh） | `{refresh}` | `{}` |
| GET | `/api/v1/auth/me` | 当前用户 | — | `{id, role, profile}` |

> 登录按 `role` 路由到 `admin_user` 或 `student_user`；写 `*_login_log`；成功签发 JWT 并落 `*_refresh_token`。

---

## 3. 超级管理员端

### 3.1 模型广场
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/models` | 列表（query: `capability,status,open,keyword,page,size`） |
| POST | `/api/v1/admin/models` | 新增模型 |
| GET | `/api/v1/admin/models/{id}` | 详情 |
| PUT | `/api/v1/admin/models/{id}` | 编辑 |
| DELETE | `/api/v1/admin/models/{id}` | 删除（软删） |
| POST | `/api/v1/admin/models/{id}/test` | 测试连接/测速 → `{status, latency_ms, sample, message}` |
| POST | `/api/v1/admin/models/test-batch` | 批量「测试速度」 → 每个模型最新延迟 |
| PATCH | `/api/v1/admin/models/{id}/open` | 切换对学生开放 `{open: true}` |

新增请求体（A2）：
```json
{
  "display_name": "DeepSeek 对话-生产",
  "provider": "deepseek", "deploy_type": "cloud", "capability": "llm",
  "protocols": "openai,anthropic",
  "base_url": "https://api.deepseek.com/v1",
  "api_key": "sk-xxx", "model_identifier": "deepseek-chat",
  "context_length": 65536, "default_temp": 0.7, "max_output": 4096, "timeout_sec": 60,
  "open_to_student": false
}
```
> 测试连接由后端按 OpenAI/Anthropic 兼容协议发探针（或经 Dify）；密钥加密存 `model_config.api_key_cipher`，落 `model_test_log`。

### 3.2 MCP 广场
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/mcp-servers` | 列表 |
| POST | `/api/v1/admin/mcp-servers` | 新增 `{name,transport,endpoint,auth,timeout_sec}` |
| PUT/DELETE | `/api/v1/admin/mcp-servers/{id}` | 编辑/删除 |
| POST | `/api/v1/admin/mcp-servers/{id}/test` | 测试连接 → 发现工具列表（写 `mcp_tool`、回填 `tool_count`） |
| GET | `/api/v1/admin/mcp-servers/{id}/tools` | 工具列表 |
| PATCH | `/api/v1/admin/mcp-servers/{id}/enable` | 启用/停用 |

### 3.3 Skills 广场
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/skills` | 列表（query: `status,keyword`） |
| POST | `/api/v1/admin/skills` | 新建 `{name,description,sub_abilities,impl_type,impl_ref,default_model_id,dep_mcp_tool_ids}` |
| PUT/DELETE | `/api/v1/admin/skills/{id}` | 编辑/删除 |
| PATCH | `/api/v1/admin/skills/{id}/status` | 启用/停用/草稿 |

### 3.4 知识库
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/knowledge-bases` | 列表 |
| POST | `/api/v1/admin/knowledge-bases` | 新建（建 Dify 数据集） |
| PUT/DELETE | `/api/v1/admin/knowledge-bases/{id}` | 编辑/删除 |
| POST | `/api/v1/admin/knowledge-bases/{id}/documents` | 上传文档（multipart）→ 触发向量化 |
| GET | `/api/v1/admin/knowledge-bases/{id}/documents` | 文档列表 |
| DELETE | `/api/v1/admin/knowledge-documents/{id}` | 删除文档 |

### 3.5 智能体管理
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/agents` | 列表 |
| POST | `/api/v1/admin/agents` | 新建 |
| GET | `/api/v1/admin/agents/{id}` | 详情（含绑定） |
| PUT | `/api/v1/admin/agents/{id}` | 配置（A3 全量绑定） |
| POST | `/api/v1/admin/agents/{id}/publish` | 发布（校验：执行绑定+至少1模型，否则 409） |
| POST | `/api/v1/admin/agents/{id}/offline` | 下架 |

配置请求体（A3）：
```json
{
  "name": "AI 面试官", "icon": "...", "description": "...",
  "ability_points": ["按岗位出题","逐题点评","复盘报告"], "tags": ["面试","复盘"],
  "exec_type": "langgraph_graph", "exec_ref": "interview_agent_v1", "ui_type": "interview",
  "bound_model_ids": [1,2,5], "default_model_id": 1,
  "bound_skill_ids": [12,7], "bound_mcp_tool_ids": [3], "bound_kb_ids": [9],
  "allow_master_call": true
}
```

### 3.6 主智能体配置
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/admin/master-agent` | 读取配置 |
| PUT | `/api/v1/admin/master-agent` | 保存（默认模型/系统提示词/能力范围） |
| GET | `/api/v1/admin/master-agent/routes` | 路由规则列表 |
| POST | `/api/v1/admin/master-agent/routes` | 新增 `{intent_keywords,target_agent_id,priority}` |
| PUT/DELETE | `/api/v1/admin/master-agent/routes/{id}` | 编辑/删除 |

---

## 4. 学生端

### 4.1 智能体广场（子智能体）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/student/agents` | 已发布子智能体列表（含可用性：是否有可用模型） |
| GET | `/api/v1/student/agents/{id}` | 详情（能力点/适用场景/产出示例） |
| GET | `/api/v1/student/agents/{id}/models` | 该智能体**可选模型**（`bound_model_ids` ∩ 已开放 ∩ test_ok） |

### 4.2 主智能体对话（B1，核心）
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/student/master/conversations` | 我的主会话列表 |
| POST | `/api/v1/student/master/conversations` | 新建主会话 `{model_id?}` → 生成 `thread_key` |
| GET | `/api/v1/student/master/conversations/{id}/messages` | 历史消息 |
| POST | `/api/v1/student/master/conversations/{id}/messages` | **发送消息（SSE 流式）** `{content}` |
| PATCH | `/api/v1/student/master/conversations/{id}/model` | **切换主模型** `{model_id}`（更新 `master_conversation.model_id`） |
| GET | `/api/v1/student/master/models` | 主智能体可选模型（已开放且 test_ok 的 LLM） |

**发送消息的 SSE 事件**（见 §5.2）：流式 token、能力动作（skill/mcp/kb）、子智能体调用（携 `subagent_conversation_id` 与结果摘要）。

### 4.3 子智能体直接使用（B3 + 通用对话）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/student/agents/{id}/conversations` | 直接开一个子智能体会话 `{model_id}` → `subagent_conversation_id`（`entry_type=direct`） |
| GET | `/api/v1/student/subagent-conversations/{id}/messages` | 子会话历史 |
| POST | `/api/v1/student/subagent-conversations/{id}/messages` | 通用对话型子智能体发消息（SSE） |
| PATCH | `/api/v1/student/subagent-conversations/{id}/model` | 直用时**自主切换模型** `{model_id}` |

### 4.4 AI 面试官（B4）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/student/interview/sessions` | 创建面试 `{agent_id, model_id, target_position, resume_file_id?, interview_types, difficulty, question_count, answer_mode}` → 建 `subagent_conversation`(direct) + `interview_session`，SSE 返首题 |
| POST | `/api/v1/student/interview/sessions/{id}/answer` | 提交回答 `{answer}`（SSE 返下一题或结束信号） |
| POST | `/api/v1/student/interview/sessions/{id}/finish` | 结束 → 触发复盘报告生成 |
| GET | `/api/v1/student/interview/sessions/{id}` | 会话详情（进度/逐题） |
| GET | `/api/v1/student/interview/sessions/{id}/report` | 复盘报告 |
| GET | `/api/v1/student/interview/sessions/{id}/report/export?format=pdf` | 导出 |
| GET | `/api/v1/student/interview/sessions` | 我的面试列表（记录用） |

### 4.5 岗位匹配（B5）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/student/match/tasks` | 提交匹配 `{agent_id, model_id, resume_source, resume_file_id?/resume_text?, jd_source, jd_text?/target_position?}` → `match_task`，异步算 |
| GET | `/api/v1/student/match/tasks/{id}` | 任务状态 |
| GET | `/api/v1/student/match/tasks/{id}/report` | 匹配报告（可解释） |
| GET | `/api/v1/student/match/tasks/{id}/report/export` | 导出 |
| GET | `/api/v1/student/match/tasks` | 我的匹配列表 |

### 4.6 我的记录 & 文件
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/student/records` | 合并面试+匹配（BFF 查两表合并排序，无多态表） query: `type=all/interview/match` |
| POST | `/api/v1/student/uploads` | 上传简历（multipart）→ `upload_file` → `{file_id, url}` |
| GET | `/api/v1/student/profile` | 个人画像（可后置） |

---

## 5. 运行时关键机制（接口 + 表如何落地）

### 5.1 模型传递 & 记忆隔离（最关键）
- **主会话**：`POST /master/conversations` 生成 `thread_key=mc-{uuid}` 写 `master_conversation`。每条消息走 LangGraph，以该 `thread_key` 为 checkpointer thread。
- **切模型**：`PATCH /master/conversations/{id}/model` 更新 `master_conversation.model_id`。**不影响记忆**（thread 不变）。
- **主→子调用**：主智能体（LangGraph）命中路由或工具时，BFF 内部：
  1. 读 `master_conversation.model_id`（= 当前主模型 M）；
  2. 新建 `subagent_conversation{entry_type:'via_master', model_id:M, parent_master_conversation_id:当前主会话, thread_key:'sc-{uuid}'}`；
  3. 以**新 thread** 运行子智能体，模型注入运行配置 = M（**模型传递**）；
  4. 子结果**仅摘要**写回主会话一条 `master_message{action_type:'subagent_call', action_meta:{subagent_conversation_id, summary}}`（**记忆隔离**：子明细在子表，不进主上下文）。
- **直用切模型**：`PATCH /subagent-conversations/{id}/model` 更新该子会话 `model_id`，与主互不影响。

### 5.2 SSE 事件协议（主对话 / 面试）
```
event: token       data: {"delta":"你好"}
event: action      data: {"type":"skill_call","name":"简历解析Skill"}
event: action      data: {"type":"kb_query","name":"就业政策知识库"}
event: subagent    data: {"type":"subagent_call","agent":"AI 面试官","subagent_conversation_id":88,"summary":"已生成首题"}
event: message_end data: {"message_id":123}
event: error       data: {"code":1500,"msg":"上游模型超时"}
```

### 5.3 子智能体能力范围校验（中间件）
- 每次子智能体调用 Skill/MCP/KB，BFF 用 `agent.bound_skill_ids/bound_mcp_tool_ids/bound_kb_ids` 做白名单校验；越界拒绝并记 `student_action_log`。
- 主智能体用 `master_agent_config`（`allow_all_*` 或 `*_scope_ids`）。

### 5.4 鉴权 & 审计
- 角色守卫见 §1。管理员写操作落 `admin_audit_log`；学生关键动作（切模型/开面试/跑匹配）落 `student_action_log`。

---

## 6. 端到端设计校验（覆盖性矩阵）

> 逐条核对《产品设计文档 V4》的屏/流程/机制，确认「有表 + 有接口」可支撑。✅=完备。

| # | 设计要求（V4） | 支撑接口 | 支撑表 | 结论 |
|---|---|---|---|---|
| 1 | 登录、双端路由(A0/B0) | `auth/login`,`refresh`,`me` | admin_user/student_user/*_token/*_login_log | ✅ |
| 2 | 模型接入+测速+对学生开放(A1/A2) | `admin/models*`,`/test`,`/test-batch`,`/open` | model_config/model_test_log | ✅ |
| 3 | MCP 接入+测试+工具发现(A4) | `admin/mcp-servers*`,`/test`,`/tools` | mcp_server/mcp_tool | ✅ |
| 4 | Skills 管理(A5) | `admin/skills*` | skill | ✅ |
| 5 | 知识库+文档向量化(A6) | `admin/knowledge-bases*`,`/documents` | knowledge_base/knowledge_document | ✅ |
| 6 | 智能体装配（模型/技能/工具/知识库）(A3) | `admin/agents*`,`/publish` | agent(JSON 绑定) | ✅ |
| 7 | 主智能体配置+路由(A7) | `admin/master-agent*`,`/routes` | master_agent_config/master_agent_route | ✅ |
| 8 | 主智能体问答(B1) | `student/master/conversations*`,`/messages`(SSE) | master_conversation/master_message | ✅ |
| 9 | 主智能体切模型 | `master/conversations/{id}/model` | master_conversation.model_id | ✅ |
| 10 | **模型传递给子智能体** | §5.1 内部编排 + 子会话建表 | subagent_conversation.model_id(=主模型) | ✅ |
| 11 | **主/子记忆隔离** | 不同 thread_key + 仅摘要回写 | master_conversation/subagent_conversation.thread_key | ✅ |
| 12 | 主智能体调 Skill/MCP/按需查知识库 | SSE action 事件 + §5.3 | master_agent_config 范围 | ✅ |
| 13 | 主路由调用子智能体 | §5.1 + master_agent_route | master_agent_route/subagent_* | ✅ |
| 14 | 智能体广场列表+可用性(B2) | `student/agents`,`/{id}` | agent | ✅ |
| 15 | 子智能体详情+可选模型(B3) | `student/agents/{id}/models` | model_config∩agent.bound_model_ids | ✅ |
| 16 | 子智能体直用+自主切模型 | `student/agents/{id}/conversations`,`/model` | subagent_conversation(direct) | ✅ |
| 17 | 子智能体仅用其配置的能力 | §5.3 白名单校验 | agent.bound_* | ✅ |
| 18 | AI 面试官 设置→进行→报告(B4) | `interview/sessions*`,`/answer`,`/finish`,`/report` | interview_session/interview_qa/interview_report | ✅ |
| 19 | 面试导出/分享 | `/report/export` | interview_report.export_pdf_url | ✅ |
| 20 | 岗位匹配 输入→报告(B5) | `match/tasks*`,`/report` | match_task/match_report | ✅ |
| 21 | 匹配可解释/技能差距 | `match/.../report` | match_report.reasons_json/gap_skills_json | ✅ |
| 22 | 我的记录(B6) | `student/records`(合并查询) | interview_session+match_task | ✅ |
| 23 | 简历上传 | `student/uploads` | upload_file | ✅ |
| 24 | RBAC 双端隔离 | §1 角色守卫 | JWT role | ✅ |
| 25 | 审计/风控(P0) | §5.4 | admin_audit_log/student_action_log | ✅ |
| 26 | 安全：密钥不下发 | 响应脱敏 sk-**** | model_config.api_key_cipher | ✅ |

### 校验中发现并补齐的点（非走过场）
1. **缺「主模型→子模型透传」的落点** → 已加 `subagent_conversation.model_id` + §5.1 第 1–3 步明确"读主会话模型并注入子运行配置"。
2. **记忆隔离缺物理隔离单位** → 已加两张会话表各自 `thread_key`（唯一），并规定主表只写"子会话 id+摘要"。
3. **"我的记录"易被设计成多态总表** → 按你的约束**拒绝**，改为 `GET /student/records` 在 BFF 合并 `interview_session`+`match_task` 两表。
4. **子智能体越权风险** → 已加 §5.3 范围校验中间件 + `student_action_log` 记录。
5. **岗位匹配耗时** → 设计为**异步**（`match_task.status=pending→done`），前端轮询 `GET /match/tasks/{id}`，避免请求超时。
6. **简历来源多样** → `match_task` 同时支持 `resume_file_id`/`resume_text`/`profile`，`upload_file` 承接上传。

### 结论
> **可以支撑整个项目运行。** V4 的全部屏、跨端流程、以及三条硬机制（**模型传递 / 记忆隔离 / 子智能体能力范围**）都已落到具体「表 + 接口」，且满足你的 DB 约束（零多态、无 FK、按上下文拆表）。
>
> 落地前仍需技术确认 1 项：§5.1 的"子智能体模型注入"在 **Dify 路线**下需用"按模型配置工作流变体"实现（LangGraph 路线可直接以参数注入）——与《产品设计文档 V4 §8.1》一致。

---

## 7. 模块化建议（FastAPI 工程）
```
app/
 ├─ core/        # config, security(JWT), deps(role guard), response
 ├─ auth/        # admin/student 登录
 ├─ admin/       # models, mcp, skills, kb, agents, master_agent
 ├─ student/     # agents, master_chat, subagent, interview, match, records, uploads
 ├─ orchestr/    # langgraph 编排 + dify 客户端 + mcp 客户端 + 模型注入/记忆隔离
 └─ infra/       # mysql(sqlalchemy), redis(可选 checkpointer), storage
```
