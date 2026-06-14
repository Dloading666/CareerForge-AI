# 给下一个 AI 的直接修改提示：AI 面试官八项问题修复

你要在 `D:\Ai Agent\CareerForge-AI` 仓库中直接修改 AI 面试官。不要重新设计全项目，不要动无关模块。先阅读下面文件，再按 P0/P1 顺序改。

## 必读文件

后端：

- `backend/app/interview/router_student.py`
- `backend/app/interview/service.py`
- `backend/app/interview/harness.py`
- `backend/app/interview/prompts.py`
- `backend/app/interview/schemas.py`
- `backend/app/interview/models.py`
- `backend/app/student/resume_router.py`
- `backend/app/student/agent_runtime.py`

前端：

- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/student/AgentChatView.tsx`
- `frontend/src/student/chatRuntimeStore.ts`
- `frontend/src/shared/api.ts`

参考文档：

- `docs/20260612-ai-interviewer-code-audit.md`
- `docs/20260612-ai-interviewer-answer-optimization-plan.md`
- `docs/20260612-ai-interviewer-execution-flow-review.md`
- `docs/ai-interviewer-mimo-rework-fix-prompt.md`
- `docs/ai-interviewer-harness-review-fix-prompt.md`
- `docs/ai-interviewer-ui-streaming-voice-model-fix-prompt.md`

## 总原则

AI 面试官必须遵守 Model + Harness：

- Model 只生成候选 JSON 或候选转写/候选报告。
- Harness 控制读取、权限、阶段、校验、停止、fallback 和入库。
- 不允许模型直接决定结束。
- 不允许未经 Harness 校验的问题展示为正式下一题。
- 不允许语音绕过 `submit_turn(...)`。

## P0-1 修复“结束并生成报告”按钮

当前 bug：

- `AIInterviewerPage.loadReport()` 调 `GET /report`。
- `GET /report` 只读报告，不生成报告。
- 没有报告时后端返回“报告不存在”。

必须修改：

1. 在 `frontend/src/student/AIInterviewerPage.tsx` 中把“结束并生成报告”的逻辑改为调用：

```ts
POST /api/v1/student/interviews/${sessionId}/finish
```

2. 成功返回后：

```ts
setReport(data)
setSession(prev => prev ? { ...prev, status: 'completed' } : prev)
await loadInterviewSessions()
```

3. 保留历史已完成面试加载报告时的 `GET /report`。

验收：

- 活跃面试点击“结束并生成报告”不再显示报告不存在。
- 已完成历史记录仍能通过 `GET /report` 打开。

## P0-2 在线简历显示简历中心列表，并支持指定简历

当前问题：

- 前端只显示“在线简历 / 本次上传简历”。
- 后端只能自动读 `visibility=True` 或最新简历。
- 用户不能指定某一份在线简历。

后端修改：

1. `backend/app/interview/schemas.py` 的 `InterviewStartRequest` 增加：

```python
resume_id: Optional[int] = Field(default=None, description="指定在线简历 ID")
```

2. `backend/app/interview/service.py` 新增函数：

```python
def _resume_snapshot_by_id(db: Session, identity: AuthIdentity, resume_id: int) -> str:
    row = db.scalar(
        select(StudentResume).where(
            StudentResume.id == resume_id,
            StudentResume.student_id == identity.user_id,
            StudentResume.tenant_id == identity.tenant_id,
        )
    )
    if not row:
        raise InterviewError(status_code=404, detail="简历不存在")
    return row.data_json[:12000]
```

3. `start_interview(...)` 中：

```python
if payload.resume_source == "upload":
    ...
elif payload.resume_id:
    resume_snapshot = _resume_snapshot_by_id(db, identity, payload.resume_id)
else:
    resume_snapshot = _latest_resume_snapshot(db, identity)
```

前端修改：

1. 在 `AIInterviewerPage.tsx` 增加 `resumes`、`selectedResumeId`、`loadingResumes` state。
2. 点击或 hover “在线简历”时请求：

```ts
apiRequest<ResumeSummary[]>('/api/v1/student/resumes')
```

3. 菜单里列出简历标题和更新时间。
4. 选中在线简历后：

```ts
setResumeSource('online')
setSelectedResumeId(resume.id)
```

5. 创建面试 body 增加：

```ts
resume_id: resumeSource === 'online' ? selectedResumeId : undefined
```

验收：

- 在线简历菜单能看到简历中心所有简历。
- 选中某份简历后，第一问围绕该简历。
- 不选时保持旧逻辑，优先 visibility，再最新。

## P0-3 面试类型只保留初面和二面

当前问题：

- 前端有 8 个面试类型。
- 后端 `INTERVIEW_TYPE_CONFIG` 也支持 8 个。

前端必须改：

```ts
const INTERVIEW_TYPE_OPTIONS = [
  { value: 'first_round', label: '初面' },
  { value: 'second_round', label: '二面' },
]
```

默认值：

```ts
const [interviewType, setInterviewType] = useState('first_round')
```

后端建议：

- `INTERVIEW_TYPE_CONFIG` 可以保留旧类型兼容历史数据。
- `InterviewStartRequest` 对新请求增加 validator，只允许 `first_round` / `second_round`。
- 如果担心历史 API 兼容，至少在 `start_interview(...)` 中把未知或旧类型归一到 `first_round`。

验收：

- UI 只显示初面、二面。
- 新建面试不会再提交 technical/hr/project/stress。

## P0-4 明确语音能力：Mimo v2.5 不是已完成语音对话

当前代码：

- `AIInterviewerPage.tsx` 使用 `SpeechRecognition/webkitSpeechRecognition`。
- 没有 `MediaRecorder`。
- 没有 `/turns/voice`。
- 没有服务端 ASR/TTS。

如果本轮不做完整语音：

- UI 文案只能写“语音输入辅助”。
- 禁用“语音面试”卡片，文案写“暂未上线”。
- 最终回复必须说明“尚未支持完整语音对话”。

如果本轮要实现完整语音，必须做：

后端：

```text
POST /api/v1/student/interviews/{session_id}/turns/voice
```

要求：

- `multipart/form-data`
- 字段：`file`, `turn_id`, `request_id`
- 文件限制：15MB，120 秒，允许 webm/wav/mp3/m4a/ogg
- 转写得到 transcript
- 调用现有 `submit_turn(db, identity, session_id, transcript, turn_id=..., request_id=...)`
- 不允许单独写评分逻辑

前端：

- 使用 `MediaRecorder` 录音。
- 上传音频到 `/turns/voice`。
- 展示 transcript。
- 返回后更新 turns。

TTS 可后做，但如果说“语音对话已完成”，必须也实现：

```text
POST /api/v1/student/interviews/{session_id}/turns/{turn_id}/voice/reply
```

且 TTS 只能朗读已入库 `turn.question`。

## P0-5 删除学生端知识库 reload

当前问题：

- `POST /student/interviews/knowledge/reload` 给 student 角色开放。

必须修改：

- 删除或注释 `backend/app/interview/router_student.py` 中的 `reload_knowledge` 路由。
- 前端删除任何“重新索引知识库”按钮和调用。
- 如需要保留，迁移到 admin 权限路由。

验收：

- 普通学生无法重载知识库。

## P1-1 补齐 Harness required fields

在 `backend/app/interview/harness.py` 增加：

```python
START_REQUIRED_FIELDS = [
    "resume_brief",
    "focus_points",
    "first_question",
    "question_reason",
    "question_type",
    "capability_tags",
    "knowledge_points",
]

FOLLOWUP_REQUIRED_FIELDS = [
    "answer_assessment",
    "score",
    "followup_strategy",
    "next_question",
    "should_end",
    "question_reason",
    "question_type",
    "capability_tags",
    "knowledge_points",
    "score_reasons",
    "evidence_quotes",
]

REPORT_REQUIRED_FIELDS = [
    "overall_score",
    "dimension_scores",
    "strengths",
    "weaknesses",
    "suggestions",
    "next_questions",
    "report_text",
    "training_plan",
    "rewrite_examples",
    "next_session_preset",
]
```

三个 validator 都必须检查 missing required field。

验收：

- 缺 `resume_brief` 的 start 输出不能通过。
- 缺 `training_plan` 的 report 输出不能通过，必须 repair 或 fallback。

## P1-2 抽状态机

新建：

```text
backend/app/interview/state_machine.py
```

迁移或新增：

- `STAGE_DEFINITIONS`
- `_build_stage_plan`
- `_stage_for_turn`
- `_advance_stage`
- `_should_skip_stage`
- `harness_should_finish_interview`

`service.py` 只调用这些函数，不再承载所有阶段决策。

验收：

- 状态推进单测可以不依赖数据库。
- 模型 `should_end=true` 仍只是建议。

## P1-3 前端展示“为什么问”和评分证据

当前后端已经返回字段：

- `question_reason`
- `capability_tags`
- `score_reasons`
- `evidence_quotes`
- `top_sources`

前端要展示：

- AI 问题气泡下：考察点、追问原因、题库来源。
- 用户回答后：维度小分、扣分原因、证据引用。
- 旧数据字段缺失时不崩溃。

## P1-4 报告训练闭环展示

报告已有字段：

- `training_plan`
- `rewrite_examples`
- `next_session_preset`

前端报告区必须展示：

- 训练计划
- 回答改写示例
- 下一场预设
- “按此计划再练一场”按钮，点击只填配置，不自动开始。

## P1-5 清理不必要代码

建议删除或重构：

- `service.py` 中未使用的 `_llm_json(...)`
- `harness.py` 中未接入的 `InterviewState`
- `harness.py` 中未接入的 `check_hallucination`
- `harness.py` 中未接入的 `validate_against_resume`
- 未使用异常和未使用 `build_fallback_report` 导入

不要删除仍被测试直接引用的函数，先改测试或保留兼容 shim。

## 验证命令

后端：

```powershell
cd backend
python -m compileall -f app/interview app/student
$env:PYTHONPATH='.'; python -m pytest tests/test_interview_harness.py tests/test_interview.py -q
alembic heads
```

如果新增迁移：

```powershell
alembic upgrade head
```

前端：

```powershell
cd frontend
npm run build
npm run lint
```

## 最终回复必须说明

- 改了哪些文件。
- 报告按钮是否已改成真正生成。
- 在线简历是否能列出并指定。
- 面试类型是否只剩初面/二面。
- 当前语音能力是哪一级：浏览器语音输入辅助 / 服务端 ASR / 多模态音频输入 / TTS。
- 是否删除学生端知识库 reload。
- Harness required fields 是否补齐。
- 是否抽出状态机。
- 测试和构建结果。

