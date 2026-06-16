# AI 面试官代码审计结论

审计日期：2026-06-12

范围：

- `backend/app/interview/*`
- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/student/AgentChatView.tsx`
- `frontend/src/student/chatRuntimeStore.ts`
- `docs/*ai-interviewer*.md`
- 参考文档：桌面 `Agent = Model + Harness 原则下的企业经营管理智能体开发准则 (1).docx`

## 1. 总结论：不是纯屎山，但正在变重

AI 面试官现在不是“完全没有架构”的屎山代码。它已经有独立模块、结构化面试表、Harness 校验、阶段字段、幂等保护、报告表和部分测试。

但它已经出现明显的“重 service + 重页面”趋势：

- `backend/app/interview/service.py` 约 1524 行，混合了 prompt 拼装、模型选择、RAG 检索、状态推进、评分、报告生成、DB 写入和 fallback。
- `backend/app/interview/harness.py` 约 810 行，既做 validator，也保留了一些未真正接入主流程的类和函数。
- `frontend/src/student/AIInterviewerPage.tsx` 约 1081 行，配置面板、聊天房间、报告、语音输入、历史列表全部堆在一个组件里。

判断：当前属于“可继续维护，但必须拆职责”的状态。如果继续堆新功能，尤其是语音、流式、报告训练闭环，会很快变成真正难改的屎山。

## 2. 明显没有必要或应整理的代码

### 2.1 `service.py` 中的旧 LLM 函数 `_llm_json`

位置：`backend/app/interview/service.py:311`

当前主链路已经使用 `run_harnessed_json_generation(...)`：

- 开场：`service.py:872`
- 提交回答：`service.py:1127`
- 生成报告：`service.py:1384`

`_llm_json(...)` 仍保留，但审计中没有发现主流程调用它。建议删除，或者明确改成仅测试/兼容用途。保留它会误导后续开发者，以为还有一条绕过 Harness 的模型调用路径。

### 2.2 `harness.py` 末尾的 `InterviewState`

位置：`backend/app/interview/harness.py:769`

这个类只是动态挂属性，没有状态机规则，也没有在主流程中承担控制职责。名称会让人误以为已有完整状态机。建议删除，或者替换成真正的 `state_machine.py`。

### 2.3 `check_hallucination` / `validate_against_resume`

位置：

- `backend/app/interview/harness.py:784`
- `backend/app/interview/harness.py:798`

这两个函数是很粗糙的示例级校验，且没有接入 `validate_start_output` / `validate_followup_output` / `validate_report_output` 主链路。建议删除，或者重写后接入统一 validator。

### 2.4 未使用或误导性导入

位置：`backend/app/interview/service.py:21-32`

审计看到这些导入存在但当前主路径未明显使用：

- `InterviewLLMError`
- `InterviewReportExistsError`
- `InterviewReportGenerationError`
- `build_fallback_report`

建议清理。`build_fallback_report` 如果要保留，应替换 `generate_report(...)` 里的手写 fallback，否则不要同时保留两套报告兜底。

### 2.5 学生端知识库 reload 路由不应暴露

位置：

- `backend/app/interview/router_student.py:37`
- `backend/app/interview/service.py:200`

`POST /student/interviews/knowledge/reload` 允许 student 角色重载知识库。即使返回值脱敏了路径，这个操作也不应该给学生端。建议删除学生端路由，迁到 admin 或内部维护接口。

### 2.6 前端 `AIInterviewerPage.tsx` 过大

位置：`frontend/src/student/AIInterviewerPage.tsx`

一个文件承载了：

- 面试配置
- 简历来源选择
- 文件上传解析
- 历史会话
- 对话渲染
- 每轮评分
- 报告展示
- 浏览器语音输入

建议拆成：

- `InterviewSetupPanel`
- `InterviewRoom`
- `InterviewTurnBubble`
- `InterviewReportPanel`
- `InterviewResumePicker`
- `useInterviewSession`
- `useVoiceInput`

## 3. 已经做得比较好的部分

### 3.1 多租户隔离主查询已修

`_get_session` 同时检查 `student_id` 和 `tenant_id`：

- `backend/app/interview/service.py:954-958`

`list_interviews` 也按 `student_id + tenant_id` 过滤：

- `backend/app/interview/service.py:961-967`

### 3.2 模型选择规则基本合格

AI 面试官候选模型过滤了：

- `tenant_id`
- `is_deleted=False`
- `status=active`
- `open_to_student=True`
- `api_key_cipher is not None`
- `capability in ("chat", "text", "multimodal")`

位置：`backend/app/interview/service.py:289-309`

学生端模型列表也过滤了 `tenant_id/open_to_student/status/api_key/capability`：

- `backend/app/student/agent_runtime.py:1331-1344`

但前端 `AgentModelOption` 类型没有 `capability` 字段：

- `frontend/src/student/AIInterviewerPage.tsx:36-41`

### 3.3 报告链路有后端能力

`generate_report(...)` 已经能生成报告、写 `interview_reports`，并带本地 fallback：

- `backend/app/interview/service.py:1322-1441`

问题在前端按钮调用了只读 `GET /report`，没有触发 `POST /finish`。

## 4. 当前最危险的工程债

### 4.1 Harness 不完整

`validate_start_output(...)` 只强校验 `first_question/focus_points/knowledge_points`：

- `backend/app/interview/harness.py:343-379`

它没有强制校验：

- `resume_brief`
- `question_reason`
- `question_type`
- `capability_tags`

这会导致模型输出字段缺失时，前端解释性体验不稳定。

### 4.2 报告 validator 对训练闭环字段太宽松

`validate_report_output(...)` 中 `training_plan` 和 `rewrite_examples` 是可选校验：

- `backend/app/interview/harness.py:644-652`

如果模型不返回训练计划，后端会 fallback 部分字段，但 validator 本身没有把“训练闭环”当作强约束。

### 4.3 状态机还散在 `service.py`

阶段函数都在 `service.py` 中：

- `_build_stage_plan`
- `_stage_for_turn`
- `_advance_stage`
- `_should_skip_stage`
- `harness_should_finish_interview`

建议抽到 `backend/app/interview/state_machine.py`，让 `service.py` 只做编排和落库。

## 5. 是否已经达到企业级 Model + Harness 原则

参考 docx 的核心原则：

- Model 只做认知、理解、生成。
- Harness 负责权限、工具、状态、校验、安全、落地。
- 禁忌应写进 Harness，而不是只写进 Prompt。
- 所有执行与入库都要由 Harness 裁决。

当前 AI 面试官达成度：

- 已做到：模型输出候选 JSON，后端解析、校验、fallback 后入库。
- 部分做到：停止判定由 Harness 控制，模型 `should_end` 只是建议。
- 未完全做到：状态机没有独立控制器，部分 required fields 未强校验，语音还没有进入 Harness 闭环。

结论：方向正确，但还不是完整企业级 Harness。

## 6. 优先级建议

P0：

- 修复报告按钮：前端点击“结束并生成报告”应调用 `POST /finish`，不是 `GET /report`。
- 删除或迁移 student 知识库 reload。
- 面试类型前后端只保留 `first_round`、`second_round`。
- 在线简历选择器列出简历中心简历，并把 `resume_id` 传给后端。
- 明确语音能力：当前只是浏览器语音输入辅助，不能声称 Mimo 语音对话已完成。

P1：

- 抽 `state_machine.py`。
- 拆 `AIInterviewerPage.tsx`。
- 删除未使用旧函数和误导性类。
- 补齐 Harness required fields。

P2：

- 实现真正的服务端 ASR/TTS 或多模态音频链路。
- 实现 SSE 状态流 + 通过 Harness 后的打字机展示。

