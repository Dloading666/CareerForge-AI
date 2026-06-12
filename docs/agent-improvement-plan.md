# AI简历助手改造清单：工作区状态 / 用户意愿契约 / 记忆管理 / 上下文管理

> 目标体验：用户在对话里口述经历或提出要求，AI 像 Codex/Claude Code 改代码一样，
> 直接去简历中心编辑对应的简历——动手前说清楚要做什么，动完报告改了什么，随时可撤销。
> 简历本身是唯一事实源（相当于代码库），每次动手前重新读取，绝不凭记忆改写。

## 全局约定（动手前必读）

- 迁移文件命名 `YYYYMMDD_NNNN_slug`（当前最新 `20260612_0021`，从 `0022` 续），`alembic upgrade head` 必须在干净 SQLite 库上跑通。
- 所有新表必须带 `tenant_id`，所有查询按 `tenant_id` + `student_id` 过滤（本项目零外键，应用层保证隔离）。
- API 返回统一 `{code, msg, data}` 信封（`core/response.py` 的 `ok()/error()`）。
- 新增 SSE 事件名要同步：① `CLAUDE.md` 的事件列表；② 前端 `frontend/src/student/chatRuntimeStore.ts` 的 `handleStreamEvent`。
- 新增配置项走 `core/config.py` 的 `Field(..., alias="ENV_NAME")` 并更新 `backend/.env.example`。
- 本仓库无测试套件：每步用 `/docs`、curl 和前端手动操作验证；前端验收 `cd frontend && npm run build && npm run lint`。
- **不要改动 AI 面试官相关代码**（`AIInterviewerPage.tsx`、`/student/interviews` 后端）。

---

## 板块 A：工作区状态管理（让「对话即编辑」跑通）

### A1【P0】`read_resume` 重构：拆成「列表 + 工作简历全文」两层

位置：`backend/app/student/agent_runtime.py` 的 `_read_resume` 实现（约 3110-3174 行）。

1. **去掉 `visibility` 过滤**（仅限简历助手的 read_resume；`StudentResume.visibility` 字段和 AI 面试官的读取逻辑**原样保留**，面试官还依赖它）。
2. **列表层**：返回该学生**全部**在线简历的 `resume_id + 标题 + updated_at`（轻量，相当于 `ls`），去掉现在「只取前 3 份」的限制。
3. **全文层**：只返回**当前工作简历**（`session.active_resume_id`，见 A2）的完整内容；模型也可以显式传 `resume_id` 参数指定读哪份。不要把多份简历全文同时灌进上下文。
4. **删除 id 隐藏逻辑**：现在 3170-3174 行故意把 `resume_id` 从模型可见结果中抹掉（`clean_resumes`），导致 `update_resume_data`（必填 `resume_id`）拿不到 id、read→edit 链条断裂。直接删掉这个过滤，summary 写成 `已读取简历：《标题》(id=12)`。安全性不受影响：update 工具内部已做 `student_id + tenant_id` 归属校验（约 4167-4175 行）。
5. 每份简历返回里带 `updated_at`（ISO 字符串），供 A3 版本检查使用。
6. 本轮上传附件优先的现有逻辑保持不变。

### A2【P0】Session 绑定工作简历 + 前端选择器

**后端：**

1. `StudentAgentSession`（`backend/app/student/agent_models.py`）增加 `active_resume_id: Optional[int]` 字段 + 迁移。
2. **自动绑定**：`_generate_resume_data_tool` / `_optimize_resume_data_tool` / `_update_resume_data_tool` 成功后，由 harness（不是模型）把结果 resume_id 写入 `session.active_resume_id`。
3. **手动绑定**：
   - `POST /student/master/sessions` 的 body 支持可选 `active_resume_id`（session 是首条消息时才惰性创建的，前端会把预选的简历在创建时带上）；
   - 新增 `PATCH /student/master/sessions/{id}` 支持更新 `active_resume_id`（校验简历归属当前学生+租户）；
   - `GET .../sessions/{id}/messages` 返回的 session 对象带上 `active_resume_id`（前端恢复 chip 状态用）。
4. **注入**：`_build_initial_messages` 在 system prompt 末尾追加：
   - 有绑定：`当前工作简历：《标题》(id=X，最后更新 YYYY-MM-DD HH:mm)。需要内容时先调用 read_resume，不要凭记忆。`
   - 绑定的简历已被删除：清空绑定，注入提示让模型告知用户重选；
   - 无绑定：`尚未确定要编辑哪份简历，动手前必须先和用户确认目标。`
5. `update_resume_data` 的 `resume_id` 参数改为**可选**：缺省时回落到 `session.active_resume_id`；两者都没有 → 返回失败「请先确认要编辑哪份简历」。

**前端（`frontend/src/student/AgentChatView.tsx` composer 区域）：**

6. 输入框上方左侧（`pendingAttachments` chip 行的位置）加**工作区选择器**：
   - 未选择：虚线幽灵按钮 `📄 选择简历`；
   - 已选择：实心 chip `📄 正在编辑：《XX》 ×`，点 chip 本体换一份，点 × 解除绑定；
   - 点击弹出自绘 popover（样式参考同文件的 `ModelReasoningPicker`，不引新组件库），数据来自 `GET /api/v1/student/resumes`，列出全部在线简历（标题 + 最后更新时间），**单选**，选中即绑定并关闭；
   - 列表为空：显示「还没有简历」+ 两个入口：「去简历制作新建」（navigate `/student/resumes`）/「让 AI 帮我生成一份」（往输入框填预设语）。
7. **惰性 session 的坑**：用户可能先选简历再发首条消息，此时还没有 session。选中的 `resumeId` 先存组件 state；`createAgentSession` 创建时把它放进 POST body；已有 session 时切换走 PATCH。
8. **联动**：AI 生成/优化出新简历后 chip 要自动更新——前端从 `activity.completed` 事件的 `detail.resume_id` 同步（该事件现在已用于跳转编辑器，加一行状态更新即可）。切换历史会话（`loadTrigger`）时从 session 详情恢复 chip。
9. 绑定动作**不**触发自动读取全文——模型需要时自己调 read_resume，避免闲聊时也背着 8000 字简历浪费上下文。

### A3【P0】写前版本检查（防止盖掉用户在编辑器里的手改）

1. `update_resume_data` 增加可选参数 `base_updated_at`，工具描述要求传 read_resume 时拿到的值。
2. 工具执行时与 `row.updated_at` 比对：不一致 → 返回 `status: "failed"`，summary：`这份简历在你读取之后被修改过（可能是用户手动编辑），请重新 read_resume 获取最新内容后再做最小修改`。模型收到后会自然重读，循环自愈。
3. system prompt 加一条：`修改简历前必须基于最近一次 read_resume 的内容做最小变更，禁止凭记忆重写整个章节。`

### A4【P0】改后报告：工具返回 diff 摘要

1. `_update_resume_data_tool` 成功返回增加 `changes` 字段：本次更新了哪些章节、各章节条目数变化（如 `projects: 3→4 条`）、修改的字段名清单；写入 activity 的 `detail_json`。
2. 前端 activity 胶囊明细（`ActivityStep`）展示该变更摘要（现在只有「已更改简历」一句话）。

### A5【P2·二期】条目级 patch 编辑

现在 `update_resume_data` 是章节级整体替换（传 `projects` 就整组覆盖）。二期给数组类章节支持 `{_op: "append"|"replace"|"delete", _index: n, ...fields}` 的 patch 语义。一期不做，A3 已兜住最大风险。

---

## 板块 B：按用户意愿行事的交互契约（体感核心）

### B1【P0】写操作「先说后做」规则（prompt 级软确认）

修改 `_harness_system_prompt` 的简历助手 prompt，新增「行动准则」章节：

1. 凡调用 `generate/optimize/update_resume_data`、`export_resume_pdf` 之前，先用 1-2 句话说明准备做什么（改哪份、哪些章节、为什么）；
2. 用户最新消息是**明确指令**（「帮我加进去」「改吧」）→ 说完直接动手，**不要再追问**（多余确认同样破坏体感）；
3. 用户只是**提供信息或闲聊**（「我做过一个 XX 项目」）→ 不得直接改简历；先复述理解 + 给出建议方案，问「要我直接更新到《XX》里吗？」；
4. 用户表达过「以后直接改不用问」→ 本会话内豁免第 3 条（落到 C1 的 preferences）。

不做硬确认卡（run 暂停等按钮），工程量大且切碎流式体验；上线后观察 prompt 级够不够。

### B2【P0】所有 AI 修改可一键撤销

1. 新表 `student_resume_revision`：`id / tenant_id / student_id / resume_id / data_json / title / template_id / source(ai_update|ai_optimize) / session_id / message_id / created_at` + 迁移。
2. 写工具在**写入前**快照当前简历内容（generate 新建的不用存）；每份简历保留最近 20 条，超出删最老。
3. 新端点 `POST /api/v1/student/resumes/{resume_id}/revert`，body `{revision_id}`，校验归属后把快照写回 `data_json/title/template_id`。
4. 前端：「已更改简历」胶囊和「查看修改后的简历」链接旁加「撤销本次修改」按钮（Popconfirm 确认），成功后提示并刷新。

### B3【P0】用户约束持续生效

1. 依赖 C1：`constraints` 类记忆每轮注入 system prompt。
2. system prompt 加一条：`用户提出过的禁止项和偏好（见已确认约束清单）在整个会话中持续有效，违反任何一条都算严重错误。`

### B4【P1】叙述节奏微调

system prompt 输出风格：动手前一句话预告、动完两三句总结（改了什么 + 引导去看），禁止动手前后输出大段分析；中文、口语化。前端时间线胶囊结构不动。

---

## 板块 C：对话记忆与账号记忆管理

### C1【P0】Session 级结构化记忆（pinned memory）

1. `StudentAgentSession` 增加 `memory_json: Optional[Text]`（与 A2 同一迁移）。结构：
   ```json
   {
     "constraints": ["不要写 XX 公司的实习", "语气克制不夸张"],
     "facts": ["做过校园问答系统，QPS 2000，负责后端"],
     "preferences": {"auto_apply": false, "tone": "正式"}
   }
   ```
2. 新增内置工具 `save_session_note`，参数 `{type: "constraint"|"fact"|"preference", content: string}`：模型在用户提出约束/口述新经历/表达偏好时自主调用；harness 落库（去重、每类上限 20 条、每条 ≤200 字）。system prompt 写明触发时机。
3. **注入**：`_build_initial_messages` 把 memory_json 渲染为 system 段「本会话已确认的事实与约束」，每轮都在（pinned，永不被截断挤掉）。
4. **EvidencePool 打通（关键）**：`facts` 类记忆加入 `SessionEvidencePool` 的证据源，否则用户口述的经历在长对话后会被事实校验拦截。
5. 前端：对话页加「本次对话记住的内容」面板（侧栏或 popover），列出 notes，每条可删除（提供 `PUT /student/master/sessions/{id}/memory` 整体更新即可）。用户能看到 AI 记了什么、能删错的——这是「按用户意愿」的信任来源。

### C2【P1】账号级记忆：口述经历回流个人档案（确认卡）

1. 新表 `student_profile_proposal`：`id / tenant_id / student_id / session_id / section(work|project|skill|honor|cert) / payload_json / status(pending|accepted|dismissed) / created_at`。
2. 新增内置工具 `propose_profile_update`：模型发现用户口述了个人档案中**不存在**的完整经历（有名称、时间、职责）时调用 → 落 proposal 表 → 新 SSE 事件 `profile.proposal` 推给前端。
3. 前端在对话流里渲染确认卡：「是否把这段经历保存到个人档案？保存后所有简历和对话都能引用」，按钮：保存 / 忽略。保存 → `POST /api/v1/student/profile/proposals/{id}/accept`，按 section 写入档案明细表（复用 `/student/profile/details` 的写入逻辑）。
4. 采纳后该事实进入档案 → 所有会话的 EvidencePool 自动可用（真正的账号级「说一次永久生效」）。
5. 账号级偏好：`student_profile` 加 `agent_preferences_json` 字段（默认语气、auto_apply 默认值），新会话初始化 C1 preferences 时继承。

### C3【P2·二期】跨会话检索

1. 复用 `session.summary`：每次 run 结束后由 harness 生成/更新 3-5 句会话摘要。
2. 新增只读工具 `search_past_sessions(query)`：在当前学生的 summary + 标题中检索，返回摘要片段。不自动注入历史会话内容（防串味），模型按需调用。

---

## 板块 D：上下文管理

### D0【P0·前置】摸清现状

通读 `_build_initial_messages` 和 `run_agent_loop` 的历史组装/截断逻辑，先写一段现状说明（带多少轮历史？工具结果是否全量回灌？超长怎么处理？「上下文预算」错误何时触发？），后续步骤基于现状校准。

### D1【P1】Token 预算器 + 分层上下文

按所选模型的 `context_length`（`ModelConfig` 已有）建预算，预留 `max_output` 输出空间。组装优先级：

1. system prompt + A2 工作简历状态 + C1 pinned memory（**永不裁剪**）；
2. 最近 K 轮（建议 6）user/assistant 消息全文；
3. 更早轮次 → 滚动摘要（D2）；
4. 工具结果瘦身（D3）。

预算参数走 env（如 `AGENT_CONTEXT_RECENT_TURNS`、`AGENT_CONTEXT_BUDGET_RATIO`），加进 `config.py` + `.env.example`。

### D2【P1】滚动摘要（替代「上下文预算」报错）

1. `StudentAgentSession` 增加 `summarized_until_message_id: Optional[int]`（水位标记）。
2. 历史超预算时：把水位之后、最近 K 轮之前的消息用低 effort 调模型压成摘要，**合并**进 `session.summary`，推进水位；注入为一条 system 消息「早前对话摘要：…」。
3. 前端现有「对话内容较长，建议新建对话」提示保留为兜底，但正常路径应是自动摘要后继续、用户无感。

### D3【P1】工具结果降采样

组装历史时只保留**最近 2 轮**的完整 tool result；更早轮次的工具结果替换为一行占位：`（此前已读取简历《X》/已分析附件 Y，内容已省略，如需引用请重新调用工具）`。简历内容永远可以重新读（配合 A3 版本检查，重读反而更安全），不值得在历史里反复携带 8000 字全文。

### D4【P2】观测

后端日志按 run 记录 `prompt_tokens / completion_tokens / 摘要触发次数`，跑一两周校准 D1 预算参数（`runtime.completed` 事件已带 token 数）。

---

## 实施批次与验收

| 批次 | 内容 | 达成效果 |
|------|------|----------|
| 1 | A1 + A2 + A3 + A4 | 「对话即编辑」跑通且不会盖掉手改 |
| 2 | B1 + B2 + B3 + C1 | 先说后做、可撤销、约束持续生效——体感成型 |
| 3 | D0 + D1 + D2 + D3 | 长对话不崩、不再报「上下文预算」错误 |
| 4 | C2 + B4 + C3 + A5 + D4 | 账号级记忆与打磨 |

**每批统一验收**：

1. `cd frontend && npm run build && npm run lint` 通过；
2. 后端 `alembic upgrade head` 在干净 SQLite 库跑通（注意 entrypoint.sh 的 stamp 判定链是否需要同步）；
3. 手动走核心剧本：选择工作简历 → 口述项目经历 → AI 复述并请求确认 → 同意 → AI 修改简历 → 前端显示变更摘要 → 在简历中心确认内容 → 点撤销 → 简历恢复原状。

**已知风险**：B1 的「指令 vs 闲聊」判定全靠 prompt，上线后专门测几组边界输入（如「我还会 Python」算不算让它改技能栏）；误判率高再考虑确认卡机制，先靠 prompt + 撤销兜底。
