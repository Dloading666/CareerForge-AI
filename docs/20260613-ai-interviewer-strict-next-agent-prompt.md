# AI 面试官严格修改提示词（交给下一个 AI 直接执行）

> 使用方式：把本文件完整发送给下一个 AI 编码代理。要求它先阅读本文件和 `AGENTS.md`，再按 P0 到 P2 顺序修改。不要让它重新设计整套项目，不要做无关重构。

## 0. 项目边界和硬性原则

仓库路径：`D:\Ai Agent\CareerForge-AI`

必须遵守：

1. AI 面试官是独立结构化 API，主入口是 `frontend/src/student/AIInterviewerPage.tsx` 和 `backend/app/interview/*`。
2. 不要把 AI 面试官重新接回 `backend/app/student/agent_runtime.py` 的 Agentic Loop。AGENTS.md 已说明：`agent_type="interviewer"` 基本弃用，旧聊天入口只应引导用户去 `/student/interviewer`。
3. 所有新增/修改的非流式后端端点必须返回统一响应信封 `{code, msg, data}`。
4. 所有后端查询必须带 `tenant_id`，涉及学生数据还必须带 `student_id`。
5. 前端请求必须走 `frontend/src/shared/api.ts` 的 `apiRequest` 或 `authenticatedFetch`，禁止裸 `fetch` 手拼 token。
6. 语音输入不得绕过现有 `submit_turn(...)`，语音转文本后仍必须进入同一套面试状态机、评分、护栏、报告链路。

## 1. 当前 Mimo 修改复核结论

Mimo 已经部分完成，但不能直接认为成功。当前状态大致如下：

已完成或部分完成：

- `backend/app/interview/state_machine.py` 已新增，方向正确。
- `backend/app/interview/schemas.py` 已加入 `resume_id`。
- `backend/app/interview/service.py` 已能按 `resume_id` 读取在线简历。
- `frontend/src/student/AIInterviewerPage.tsx` 主页面面试类型已基本只显示“初面/二面”。
- `frontend/src/student/AIInterviewerPage.tsx` 已能在创建面试时提交 `resume_id`。
- `frontend/src/student/InterviewReportDrawer.tsx` 已新增，报告展示方向正确。
- `backend/app/interview/router_student.py` 学生端知识库 reload 路由已被移除。

仍未通过的关键问题：

- 后端测试集合失败：`tests/test_interview.py` 仍从 `service.py` 导入 `_advance_stage` 等旧函数，Mimo 移到 `state_machine.py` 后没有兼容。
- Harness 测试失败：`validate_start_output` 新增必填字段后，测试样例没有同步。
- 前端仍有“重新索引知识库”按钮和 `reloadKnowledge()` 调用，但后端路由已删除，点击会 404。
- `backend/app/student/agent_runtime.py` 被错误增强成工具式面试官，违反当前架构要求。
- `frontend/src/student/InterviewerChatInput.tsx` 是未使用的新文件，并且里面仍包含 `technical/behavioral/hr/stress/comprehensive` 等旧类型，和“只显示初面/二面”冲突。
- 语音仍只是浏览器 `SpeechRecognition/webkitSpeechRecognition`，没有真正接入 Mimo v2.5 多模态能力。
- 报告抽屉的“按此计划再练一场”没有真正接回页面配置。
- 后端 `InterviewStartRequest.interview_type` 默认值仍是 `technical`，缺少只允许 `first_round/second_round` 的后端约束或归一化。

## 2. P0 必须先修的问题

### P0-1：恢复 AI 面试官架构边界，清理 `agent_runtime.py` 错误改动

文件：

- `backend/app/student/agent_runtime.py`
- `frontend/src/student/chatRuntimeStore.ts`

目标：

- 旧 `agent_type="interviewer"` 不承担正式面试执行。
- 面试流程只走 `/api/v1/student/interviews`。
- 不在 `agent_runtime.py` 新增 `start_interview_session`、`submit_interview_answer`、`get_interview_report` 等面试工具。

修改要求：

1. 删除或回退 `agent_runtime.py` 中 Mimo 新增的面试工具定义。
2. 删除或回退 `_dispatch_tool` 里对应的面试工具分支。
3. 恢复 `INTERVIEWER_SYSTEM_PROMPT` 为引导文案，例如：

```text
AI 面试官已升级为结构化面试页面。请前往 /student/interviewer 开始面试；我不会在当前简历助手对话里直接执行正式面试。
```

4. 如果 `chatRuntimeStore.ts` 只为旧 Agentic Loop 面试官新增了活动分类或状态，也一并清理，避免形成双入口。

验收：

- 全仓搜索 `start_interview_session`、`submit_interview_answer`、`get_interview_report`，不应再作为 `agent_runtime.py` 内置工具存在。
- `/student/interviewer` 页面仍能通过独立 API 开始面试。

### P0-2：修复后端测试导入失败

文件：

- `backend/app/interview/service.py`
- `backend/app/interview/state_machine.py`
- `backend/tests/test_interview.py` 或 `tests/test_interview.py`（以仓库实际路径为准）

问题：

`tests/test_interview.py` 仍导入：

```python
from app.interview.service import (
    _advance_stage,
    _build_stage_plan,
    _compute_answer_quality,
    _is_valid_wrap_up_question,
    _stage_for_turn,
    _update_coverage,
    _update_quality_metrics,
)
```

但 Mimo 已把函数迁到 `state_machine.py`。

推荐修改：

优先修改测试导入，让测试直接从 `app.interview.state_machine` 导入公开函数：

```python
from app.interview.state_machine import (
    advance_stage,
    build_stage_plan,
    compute_answer_quality,
    is_valid_wrap_up_question,
    stage_for_turn,
    update_coverage,
    update_quality_metrics,
)
```

然后把测试里的旧函数名同步替换为新函数名。

如果为了兼容旧测试，也可以在 `service.py` 添加短期兼容别名，但必须加注释说明只用于兼容测试或旧内部调用：

```python
_build_stage_plan = build_stage_plan
_stage_for_turn = stage_for_turn
_update_coverage = update_coverage
_compute_answer_quality = compute_answer_quality
_update_quality_metrics = update_quality_metrics
_advance_stage = advance_stage
_should_skip_stage = should_skip_stage
_is_valid_wrap_up_question = is_valid_wrap_up_question
```

验收：

```bash
cd backend
$env:PYTHONPATH='.'
python -m pytest tests\test_interview.py -q
```

应通过。

### P0-3：修复 Harness 新字段导致的测试失败

文件：

- `backend/app/interview/harness.py`
- `backend/tests/test_interview_harness.py` 或 `tests/test_interview_harness.py`

问题：

Mimo 加强了 `validate_start_output`，但测试数据还是旧结构。当前失败点通常是有效样例缺少：

- `resume_brief`
- `question_reason`
- `question_type`
- `capability_tags`

修改要求：

1. 保留更严格的 Harness 校验，不要为了过测试删掉护栏。
2. 更新测试里的有效 start output 样例，例如：

```python
payload = {
    "resume_brief": "候选人有 Java 后端项目和 Redis 缓存经验。",
    "focus_points": ["项目复杂度", "技术深度"],
    "first_question": "请介绍你最近一个后端项目中缓存设计的取舍。",
    "question_reason": "简历中提到 Redis 缓存，需要验证候选人是否理解一致性和性能权衡。",
    "question_type": "resume_deep_dive",
    "capability_tags": ["backend", "redis", "system_design"],
    "knowledge_points": ["缓存一致性", "性能优化"],
}
```

3. 增加缺字段测试，确认缺 `resume_brief`、`question_reason`、`capability_tags` 时会返回错误。

验收：

```bash
cd backend
$env:PYTHONPATH='.'
python -m pytest tests\test_interview_harness.py -q
```

应通过。

### P0-4：删除前端学生端知识库 reload 按钮和调用

文件：

- `frontend/src/student/AIInterviewerPage.tsx`

问题：

后端已删除 `/student/interviews/knowledge/reload`，但前端仍有 `reloadKnowledge()` 和“重新索引知识库”按钮。

修改要求：

1. 删除 `reloadKnowledge()` 函数。
2. 删除所有“重新索引知识库”按钮、Tooltip、loading state。
3. 删除相关无用 state/import。

验收：

- 全仓搜索 `knowledge/reload`，学生端不应再出现。
- 页面上不再显示“重新索引知识库”。
- `npm run build` 通过。

### P0-5：后端面试类型只接受初面和二面

文件：

- `backend/app/interview/schemas.py`
- `backend/app/interview/service.py`
- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/student/InterviewerChatInput.tsx`（若保留）

目标：

新建面试只允许：

- `first_round`：初面
- `second_round`：二面

修改要求：

1. `InterviewStartRequest.interview_type` 默认值改为 `first_round`。
2. 加 Pydantic validator 或 `Literal` 限制：

```python
interview_type: Literal["first_round", "second_round"] = "first_round"
```

3. 如果担心历史数据，历史读取处兼容旧值；但新建请求必须禁止旧值。
4. 删除前端所有 `technical/behavioral/hr/stress/comprehensive` 新建入口。
5. `InterviewerChatInput.tsx` 如果不用，直接删除；如果保留，必须改成只显示初面/二面，并真正被页面使用。

验收：

- UI 只能选择初面/二面。
- API 传 `technical` 会被拒绝或归一化为 `first_round`，推荐拒绝新请求。
- 全仓搜索旧类型，不能再作为新建面试选项出现。

### P0-6：报告生成按钮必须稳定可用

文件：

- `frontend/src/student/AIInterviewerPage.tsx`
- `backend/app/interview/router_student.py`
- `backend/app/interview/service.py`

目标：

活跃面试点击“结束并生成报告”时，不应再显示“报告不存在”。

前端逻辑：

1. 活跃面试或用户点击强制生成时，调用：

```http
POST /api/v1/student/interviews/{session_id}/finish
```

2. 历史已完成面试查看报告时，优先调用：

```http
GET /api/v1/student/interviews/{session_id}/report
```

3. 如果 `GET /report` 返回报告不存在，页面可以提示“请先结束面试生成报告”，不要误导为系统异常。

后端逻辑：

- `finish` 应生成或返回已有报告，保证幂等。
- `finish` 不应重复创建多个报告。

验收：

- 新面试回答 1-2 轮后点击结束，能打开报告。
- 已完成历史面试点击报告，能打开已有报告。
- 重复点击结束不会创建重复报告。

## 3. P1 功能完善

### P1-1：在线简历 hover/点击展示简历中心列表

文件：

- `frontend/src/student/AIInterviewerPage.tsx`
- `backend/app/interview/service.py`
- `backend/app/interview/schemas.py`

要求：

1. 前端“在线简历”入口 hover 或点击后展示简历中心所有可用简历。
2. 列表显示标题、更新时间、是否默认/当前选择。
3. 用户选中某份简历后，创建面试 body 带：

```ts
resume_source: 'online',
resume_id: selectedResumeId,
```

4. 后端读取简历时必须同时过滤：

```python
StudentResume.id == resume_id
StudentResume.student_id == identity.user_id
StudentResume.tenant_id == identity.tenant_id
```

5. 不选 `resume_id` 时可以保留旧逻辑：优先 `visibility=True`，再最新简历。

验收：

- 用户能明确选择简历中心某一份简历。
- 第一题能围绕所选简历发问。
- 不存在跨学生/跨租户读取。

### P1-2：报告抽屉训练闭环

文件：

- `frontend/src/student/InterviewReportDrawer.tsx`
- `frontend/src/student/AIInterviewerPage.tsx`
- `backend/app/interview/prompts.py`
- `backend/app/interview/harness.py`

要求：

1. 报告展示：
   - 总分
   - 维度分
   - 优势
   - 不足
   - 建议
   - 训练计划 `training_plan`
   - 回答改写示例 `rewrite_examples`
   - 下一场预设 `next_session_preset`
2. 统一 `rewrite_examples` 字段结构，推荐：

```json
{
  "original_answer": "原回答",
  "better_answer": "优化回答",
  "why_better": "为什么更好"
}
```

3. 后端 prompt、Harness 校验、前端类型必须一致。
4. “按此计划再练一场”点击后只回填配置，不自动开始：
   - `target_role`
   - `interview_type`
   - `focus_tags`
   - `interview_style`
   - `round_limit`

验收：

- 报告抽屉字段不空、不错位。
- 点击“按此计划再练一场”能回到配置区并填入下一场建议。

### P1-3：问题解释和证据展示

文件：

- `frontend/src/student/AIInterviewerPage.tsx`
- `backend/app/interview/service.py`
- `backend/app/interview/harness.py`

要求：

每个 AI 问题展示：

- 当前阶段
- 考察能力标签 `capability_tags`
- 提问原因 `question_reason`
- 关联知识点 `knowledge_points`
- 题库/RAG 来源 `top_sources`（如果存在）

用户回答后展示：

- 回答摘要 `answer_assessment.summary`
- 扣分原因 `score_reasons`
- 证据引用 `evidence_quotes`

注意：

- 这些字段是给用户理解面试训练逻辑，不是把所有内部评分裸露出来。
- 如果字段缺失，前端降级展示，不要崩溃。

### P1-4：清理无用代码和重复状态

优先清理：

- 未使用的 `frontend/src/student/InterviewerChatInput.tsx`。
- `AIInterviewerPage.tsx` 中已经失效的知识库 reload 状态和函数。
- `agent_runtime.py` 中错误新增的面试工具。
- `chatRuntimeStore.ts` 中只服务旧面试官 Agentic Loop 的活动分类。

谨慎处理：

- `backend/app/interview/state_machine.py` 是有价值的抽离，不要删除。
- `backend/app/interview/harness.py` 中新增的严格校验方向正确，不要回退成弱校验。

## 4. P2 语音面试专项要求

语音面试不要只用浏览器 SpeechRecognition 冒充多模态。用户已经说明 Mimo v2.5 是多模态模型，因此应按独立语音链路设计：

1. 前端用 `MediaRecorder` 录音。
2. 后端新增 `POST /student/interviews/{session_id}/turns/voice`。
3. 后端把音频传给 Mimo v2.5 多模态模型做语音理解/转写。
4. 得到 transcript 后调用现有 `submit_turn(...)`。
5. 返回 transcript + 面试 turn 结果。
6. 可选：后端再用 Mimo v2.5 或独立 TTS 生成面试官问题音频。

详细方案见：

`docs/20260613-mimo-v25-multimodal-voice-interview-plan.md`

## 5. 必跑验证命令

后端：

```powershell
cd "D:\Ai Agent\CareerForge-AI\backend"
$env:PYTHONPATH='.'
python -m compileall -f app\interview app\student
python -m pytest tests\test_interview_harness.py tests\test_interview.py -q
alembic heads
```

前端：

```powershell
cd "D:\Ai Agent\CareerForge-AI\frontend"
npm run build
npm run lint
```

手动验收：

1. 打开 `/student/interviewer`。
2. 选择在线简历中的某一份简历。
3. 选择“初面”，填写岗位/JD，开始面试。
4. 确认第一题围绕所选简历和 JD。
5. 回答一轮，确认下一题由 Harness 状态机推进。
6. 点击结束生成报告，确认不是“报告不存在”。
7. 打开报告抽屉，确认训练计划和改写示例存在。
8. 点击“按此计划再练一场”，确认配置被回填但不会自动开始。
9. 如果实现语音：录音提交，确认 transcript 进入同一 `submit_turn(...)` 链路。

## 6. 禁止事项

下一个 AI 不允许做以下事情：

- 不允许把 AI 面试官正式流程接回 `agent_runtime.py`。
- 不允许绕过 `submit_turn(...)` 单独写一套语音评分逻辑。
- 不允许删除 `tenant_id` / `student_id` 查询过滤。
- 不允许用裸 `fetch` 手写 Authorization。
- 不允许把旧面试类型重新显示给用户。
- 不允许为了通过测试删除 Harness 必填字段。
- 不允许把“语音输入辅助”宣传成“完整语音面试”，除非已经实现录音、Mimo 多模态理解、同链路提交和可选 TTS。

