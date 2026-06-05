# 学生端主智能体开发报告

## 当前落地范围

学生端首页已经从静态占位改成主智能体对话窗口。学生登录后进入 `/student`，可以直接输入求职需求；前端通过 SSE 接收主智能体运行过程，按 Codex 风格展示工具活动行和最终回答。

后端新增 Agent Runtime，按 `Agent = Model + Harness` 组织：

- Model：读取管理端主智能体模型配置，优先使用已配置模型，未配置时使用学生可用聊天模型。
- Harness：管理会话、消息、工具池、工具执行、子智能体调用、SSE 事件输出。
- ReAct 展示：前端只展示工具活动摘要，不暴露隐藏推理链。

## 工具池设计

`assemble_tool_pool()` 按三层合并工具，并保证同名时内置工具优先：

1. 内置工具：`invoke_agent`、`query_student_profile`、`query_job_positions`、`query_knowledge_base`、`read_resume`、`send_notification`、`get_session_context`。
2. Skill 工具：管理端 Skills 广场中启用的 Skill 会被转换为工具描述，注入主智能体工具池。
3. MCP 工具：当前保留动态发现 adapter 和占位工具，后续 MCP 广场落库后接入真实发现与调用。

## 子智能体与 Dify 扩展

管理端主智能体路由规则新增：

- `target_provider`: `builtin` 或 `dify`
- `provider_config_json`: Dify API 配置 JSON

`invoke_agent` 会根据路由调用 provider adapter。当前已支持：

- `builtin`: 平台内置子智能体占位执行摘要。
- `dify`: 调用 Dify `/chat-messages`，使用 `blocking` 模式拿到子智能体回答并回流主对话。

后续新增 LangGraph、FastGPT、自研 Agent 服务时，只需要增加 provider adapter，不需要改学生端聊天 API。

## 数据与接口

新增数据库表：

- `student_agent_session`
- `student_agent_message`
- `student_agent_activity`

新增学生端接口：

- `POST /api/v1/student/master/sessions`
- `GET /api/v1/student/master/sessions`
- `GET /api/v1/student/master/sessions/{session_id}/messages`
- `POST /api/v1/student/master/sessions/{session_id}/messages/stream`

SSE 事件：

- `message.saved`
- `activity.started`
- `activity.completed`
- `activity.failed`
- `message.delta`
- `message.completed`
- `done`

## 前端体验

学生端首页现在包含：

- 空态建议入口。
- 对话消息流。
- 灰色工具活动行。
- 底部输入框与发送/停止按钮。
- 历史会话恢复。
- 移动端无横向溢出。

## 参考原则

- Claude Code subagents：子智能体独立上下文、专属 prompt/tools/model，并只把结果摘要回流主对话。
- Claude Code agent teams：主会话负责协调，团队成员独立执行，适合后续做多智能体并行任务。
- Dify Chatflow API：Dify 子智能体通过 `/chat-messages` 接口接入，后续可从 blocking 升级到 streaming。

参考链接：

- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/agent-teams
- https://docs.dify.ai/api-reference/chatflows/send-chat-message
- https://github.com/liuup/claude-code-analysis/

## 后续开发建议

1. 把 `query_job_positions` 接到真实岗位库。
2. 把 `query_knowledge_base` 接到知识库/RAG 检索。
3. 为简历上传补 `read_resume` 的文件解析和简历结构化存储。
4. MCP 广场接入真实服务发现，替换当前占位 adapter。
5. Dify 子智能体支持 streaming，把 Dify 事件逐段转发给学生端。
6. 增加工具权限确认流，让 `send_notification`、投递申请等高风险动作需要学生确认。
