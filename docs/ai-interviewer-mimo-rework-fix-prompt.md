# AI 面试官 Mimo 修改后返工修复提示词

> 本文件用于交给下一个 AI 编程助手直接执行修改。  
> 当前状态：Mimo 已完成部分 UI 改造和基础校验，但仍存在上线阻塞 bug、模型选择链路不一致、语音/流式未真正实现等问题。  
> 你的任务不是重新规划，而是按本文件逐项修复代码、补测试、跑验证。

---

## 0. 强制规则

1. 必须先阅读实际代码，再修改。
2. 禁止只输出建议。
3. 禁止只修前端，不修后端。
4. 禁止因为测试通过就跳过本文件列出的缺口。
5. 禁止声称“语音对话已完成”，除非实现服务端音频上传、ASR、统一 `submit_turn`、TTS。
6. 禁止声称“流式输出已完成”，除非实现面试专用 SSE/fetch streaming 或至少完成校验后问题打字机输出。
7. 禁止放宽模型权限来解决模型列表为空。
8. 禁止 AI 面试官调用未对学生开放、未配置 API Key、非本租户的模型。
9. 禁止模型输出绕过 Harness。
10. 修完后必须运行验证命令，并说明结果。

---

## 1. 必须阅读的文件

必须阅读：

- `docs/ai-interviewer-ui-streaming-voice-model-fix-prompt.md`
- `backend/app/interview/service.py`
- `backend/app/interview/exceptions.py`
- `backend/app/interview/router_student.py`
- `backend/app/interview/schemas.py`
- `backend/app/interview/models.py`
- `backend/app/interview/harness.py`
- `backend/app/student/router.py`
- `backend/app/student/agent_runtime.py`
- `backend/app/student/agent_schemas.py`
- `backend/app/admin/models.py`
- `backend/app/admin/model_service.py`
- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/shared/api.ts`
- `frontend/src/index.css`
- `backend/alembic/versions/`
- `backend/tests/test_interview.py`
- `backend/tests/test_interview_harness.py`

---

## 2. 当前复查结论

Mimo 已完成：

- 前端目标岗位、岗位 JD 校验。
- `InterviewStartRequest.job_description` 改为必填。
- 顶部设置/结束按钮移除。
- 底部四按钮两行布局。
- 提交后乐观显示用户回答。
- 用户气泡改成接近飞书风格。
- Select 外层从 `label` 改为 `div`，并加了部分居中样式。
- `api.ts` 对非 JSON 响应做了错误提示。
- 学生端模型 capability 放宽到 `chat/text/multimodal`。

但仍有以下必须返工问题：

1. `InterviewError(status_code=...)` 仍会触发 `TypeError`。
2. AI 面试官实际候选模型 `_candidate_chat_models` 没有限制租户和 `open_to_student`。
3. 学生端模型列表和 AI 面试官实际调用模型规则不一致。
4. 学生端模型列表 schema 没有返回 `capability`。
5. 学生端模型列表没有过滤或标记无 API Key 模型。
6. `(session_id, turn_index)` 数据库唯一约束仍未实现。
7. `api.ts` 非 JSON response preview 读取顺序错误，可能读不到 body。
8. 真正语音对话没有实现。
9. 真正流式输出没有实现。
10. “再试一次”按钮语义不够清晰，当前只是展开设置。

---

## 3. P0：修复 `InterviewError(status_code=...)` 触发 500

当前代码中存在：

```python
raise InterviewError(status_code=400, detail="请填写目标岗位")
raise InterviewError(status_code=400, detail="请填写岗位 JD")
raise InterviewError(status_code=409, detail="该问题已回答，请刷新面试记录")
```

但 `InterviewError.__init__` 当前只接受 `detail`，不接受 `status_code`。

必须选择以下一种方式修复。

### 方案 A：修改 `InterviewError`

修改 `backend/app/interview/exceptions.py`：

```python
class InterviewError(Exception):
    status_code: int = 500
    detail: str = "Internal server error"

    def __init__(self, detail: str | None = None, *, status_code: int | None = None):
        self.detail = detail or self.__class__.detail
        self.status_code = status_code or self.__class__.status_code
        super().__init__(self.detail)
```

### 方案 B：改回 `HTTPException`

把所有动态 `status_code` 的地方改成：

```python
raise HTTPException(status_code=400, detail="...")
```

推荐方案 A，因为项目已经在 `main.py` 注册了 `InterviewError` 全局 handler。

必须新增测试：

1. `InterviewError(status_code=400, detail="x")` 不报 `TypeError`。
2. `InterviewError(status_code=409, detail="x").status_code == 409`。

---

## 4. P0：统一学生端模型列表与 AI 面试官实际调用规则

当前问题：

- 学生端 `/api/v1/student/master/models` 过滤 `open_to_student=True`，但不要求 API Key。
- AI 面试官 `_candidate_chat_models` 要求 API Key，但不要求 `open_to_student=True`，也不限制 `tenant_id`。
- 这会导致：
  - 前端能选到后端不可用模型。
  - 后端可能调用未对学生开放的模型。
  - 多租户场景可能误用其他租户模型。

### 4.1 新增统一能力常量

在合适位置新增统一常量，避免散落：

```python
INTERVIEW_MODEL_CAPABILITIES = ("chat", "text", "multimodal")
```

可放在：

- `backend/app/interview/service.py`

或者新文件：

- `backend/app/interview/model_policy.py`

### 4.2 修改 `_candidate_chat_models`

位置：

- `backend/app/interview/service.py`

必须把签名改为：

```python
def _candidate_chat_models(
    db: Session,
    identity: AuthIdentity,
    preferred_model_id: int | None = None,
) -> list[ModelConfig]:
```

查询必须包含：

```python
ModelConfig.tenant_id == identity.tenant_id
ModelConfig.is_deleted.is_(False)
ModelConfig.status == "active"
ModelConfig.open_to_student.is_(True)
ModelConfig.api_key_cipher.is_not(None)
ModelConfig.capability.in_(INTERVIEW_MODEL_CAPABILITIES)
```

如果保留旧函数名，所有调用方必须传入 `identity`。

必须修改所有调用：

- `_llm_json(...)`
- `run_harnessed_json_generation(...)` 内部如果延迟 import `_candidate_chat_models`，也必须传 identity 或改成通过 context 获取。
- `start_interview(...)`
- `submit_turn(...)`
- `generate_report(...)`

注意：当前 `run_harnessed_json_generation(...)` 内部调用 `_candidate_chat_models(db, preferred_model_id)`。  
必须调整其参数，新增：

```python
identity: AuthIdentity | None = None
```

或者不让 Harness 内部查模型，把候选模型列表在 service 层传入。  
推荐最小改法：给 `run_harnessed_json_generation(...)` 增加 `identity` 参数，并传给 `_candidate_chat_models(...)`。

### 4.3 修改学生端模型列表

位置：

- `backend/app/student/agent_runtime.py`
- `backend/app/student/agent_schemas.py`

学生端模型列表必须和 AI 面试官一致：

```python
ModelConfig.tenant_id == identity.tenant_id
ModelConfig.is_deleted.is_(False)
ModelConfig.open_to_student.is_(True)
ModelConfig.status == "active"
ModelConfig.api_key_cipher.is_not(None)
ModelConfig.capability.in_(("chat", "text", "multimodal"))
```

如果产品希望显示“已开放但缺 API Key”的模型，必须返回不可用原因并前端禁用；但当前最小修复要求是：没有 API Key 的模型不作为可用模型。

### 4.4 返回 capability

`AgentModelOptionResponse` 必须增加：

```python
capability: str
```

前端 `AgentModelOption` 必须增加：

```ts
capability?: string
```

模型 Select 文案建议显示：

```text
模型展示名 · 模型标识 · chat/multimodal
```

### 4.5 必须新增测试

后端必须新增或更新测试，覆盖：

1. `open_to_student=True`、`capability="chat"`、有 API Key、本租户：出现在学生端列表。
2. `open_to_student=True`、`capability="text"`、有 API Key、本租户：出现在学生端列表。
3. `open_to_student=True`、`capability="multimodal"`、有 API Key、本租户：出现在学生端列表。
4. `open_to_student=False`：不出现。
5. `api_key_cipher=None`：不出现。
6. 其他租户模型：不出现。
7. `_candidate_chat_models` 不返回未开放模型。
8. `_candidate_chat_models` 不返回其他租户模型。

---

## 5. P0：数据库唯一约束仍未完成

当前问题：

`InterviewTurn` 没有：

```python
UniqueConstraint("session_id", "turn_index")
```

当前 migration 只加了 `submit_request_id` 普通索引，挡不住并发重复创建下一轮问题。

### 5.1 修改模型

位置：

- `backend/app/interview/models.py`

必须添加：

```python
from sqlalchemy import UniqueConstraint

class InterviewTurn(Base):
    __tablename__ = "interview_turns"
    __table_args__ = (
        UniqueConstraint("session_id", "turn_index", name="uq_interview_turn_session_turn_index"),
    )
```

注意不要覆盖已有 `__table_args__`。

### 5.2 修改 Alembic migration

位置：

- `backend/alembic/versions/20260613_0003_interview_idempotent_submit.py`

或者新增一个 migration。

必须创建唯一约束：

```python
op.create_unique_constraint(
    "uq_interview_turn_session_turn_index",
    "interview_turns",
    ["session_id", "turn_index"],
)
```

downgrade 必须删除该约束。

如果历史数据可能已有重复，migration 前必须说明需要清理重复数据，或者 migration 中做保守清理策略。

### 5.3 处理 IntegrityError

位置：

- `backend/app/interview/service.py`

创建 `next_turn` 时必须捕获数据库唯一约束冲突：

```python
from sqlalchemy.exc import IntegrityError
```

如果 insert 冲突：

1. rollback 当前事务或 savepoint。
2. 回查已有 `next_turn`。
3. 返回已有 `next_turn`。
4. 不要让用户看到 500。

必须新增测试：

- 模拟已有相同 `(session_id, turn_index)` 的 turn，`submit_turn` 不创建重复记录。

---

## 6. P1：修复幂等返回逻辑

当前问题：

`submit_turn` 先找：

```python
current = next((turn for turn in reversed(turns) if not turn.answer), None)
```

如果第一次提交已成功，原 turn 已经有 answer，重复请求带同一个 `turn_id/request_id` 进来时，`current` 会变成下一轮未回答 turn，导致 `turn_id != current.id`，不能返回已有结果。

### 6.1 正确逻辑

`submit_turn` 必须先处理 `turn_id`：

```python
target_turn = None
if turn_id is not None:
    target_turn = db.scalar(
        select(InterviewTurn).where(
            InterviewTurn.id == turn_id,
            InterviewTurn.session_id == session.id,
            InterviewTurn.student_id == identity.user_id,
        )
    )
    if not target_turn:
        raise InterviewError(status_code=404, detail="问题不存在")
else:
    target_turn = next pending turn
```

然后：

1. 如果 `target_turn.answer` 已存在且 `target_turn.submit_request_id == request_id`：
   - 返回该 turn 和已有 next_turn。
   - 不调用模型。
2. 如果 `target_turn.answer` 已存在但 request_id 不同：
   - 返回 409。
3. 如果 `target_turn` 不是当前 pending turn：
   - 返回 400。
4. 如果未回答：
   - 正常提交。

前端当前每次点击都生成新 `request_id`，这可以保留，但如果用户自动重试同一请求，必须复用同一 request_id。  
如要支持“点击重试”，需要把当前 request_id 保存在组件 state 中，直到请求成功或用户修改答案。

---

## 7. P1：修复 `api.ts` 非 JSON 响应 preview

当前问题：

`api.ts` 在 `response.json()` 失败后再 `response.clone().text()`，此时 body 可能已消费，preview 读不到。

必须修改：

```ts
const responseForPreview = response.clone()
let payload
try {
  payload = await response.json()
} catch {
  let preview = ''
  try {
    preview = (await responseForPreview.text()).slice(0, 300)
  } catch {}
  console.error('Non-JSON API response', { path, status: response.status, preview })
  throw new ApiError('服务接口异常，请稍后重试或联系管理员', response.status)
}
```

如果 path 包含 `/student/master/models`，用户提示必须更具体：

```text
模型列表加载失败，请检查管理员模型广场配置和后端日志。
```

---

## 8. P1：语音对话仍未实现，必须诚实处理

当前没有：

- `/api/v1/student/interviews/{session_id}/turns/voice`
- `MediaRecorder`
- 服务端 ASR
- 多模态音频输入
- TTS 回复

### 8.1 如果本轮不做完整语音

必须确保 UI 文案只写：

```text
语音输入辅助
```

禁用或标记：

```text
语音面试：暂未上线
```

最终回复必须明确：

```text
当前未实现完整语音对话，只支持浏览器语音输入辅助。
```

### 8.2 如果本轮要做完整语音

必须实现：

```text
POST /api/v1/student/interviews/{session_id}/turns/voice
```

并满足：

1. 前端用 `MediaRecorder` 录音。
2. 后端接收音频文件。
3. 检查音频大小、格式、时长。
4. 服务端 ASR 或多模态音频转写。
5. 转写文本进入同一套 `submit_turn`。
6. 语音提交必须带 `turn_id` 和 `request_id`。
7. 转写失败不得写入 answer。

如还要 TTS，必须实现：

```text
POST /api/v1/student/interviews/{session_id}/turns/{turn_id}/voice/reply
```

TTS 只能使用 DB 中已保存的 `turn.question`。

---

## 9. P1：流式输出仍未实现

当前没有：

- `/turns/stream`
- `StreamingResponse`
- `text/event-stream`
- 前端 `EventSource` 或 fetch stream
- 校验后问题打字机输出

### 9.1 最小可接受方案

如果不做真正 LLM token streaming，必须至少实现：

1. 用户提交后立即显示用户气泡。
2. 前端显示状态流：
   - 已收到你的回答
   - 正在检索题库
   - 正在评估回答
   - Harness 正在校验
   - 正在生成下一问
3. 后端返回后，对已经通过 Harness 的 `next_turn.question` 做打字机效果。

注意：这只能叫：

```text
状态流 + 校验后打字机展示
```

不能叫：

```text
大模型 token 级流式输出
```

### 9.2 真正后端流式方案

新增：

```text
POST /api/v1/student/interviews/{session_id}/turns/stream
```

返回：

```text
text/event-stream
```

事件：

```text
user_answer_saved
retrieval_started
assessment_started
harness_validation_started
next_question_ready
completed
error
```

`next_question_ready` 必须来自已经通过 Harness 并写入 DB 的 `next_turn`。  
禁止把未经 Harness 校验的大模型 token 直接展示为正式问题。

---

## 10. P2：UI 文案和交互细节修正

### 10.1 “再试一次”文案

当前按钮：

```text
再试一次
```

实际行为是展开设置面板。

建议改成：

```text
调整设置
```

或者保留“再试一次”，但展开设置后必须显示提示：

```text
调整配置后点击“重新开始一场”生效，当前面试记录不会自动清空。
```

### 10.2 模型 option 显示 capability

Select option 建议显示：

```text
{display_name} · {model_identifier} · {capability}
```

多模态模型可用颜色标识：

```text
multimodal
```

但不能因此声称支持语音对话。

---

## 11. 必须运行的验证命令

必须运行：

```powershell
python -m compileall -f backend\app\interview backend\app\student
```

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend\tests\test_interview_harness.py backend\tests\test_interview.py -q
```

如果新增模型列表测试，必须运行对应测试文件。

前端：

```powershell
cd frontend
npm run build
```

如果修改 Alembic migration，必须至少静态检查 migration 是否包含：

- upgrade 创建列/约束
- downgrade 删除列/约束

---

## 12. 最终回复格式

完成后必须按以下格式回复：

### 修改文件

列出所有修改过的文件。

### 已修复

逐条说明：

1. `InterviewError(status_code=...)` 是否修复。
2. AI 面试官候选模型是否限制租户、API Key、对学生开放、capability。
3. 学生端模型列表是否和 AI 面试官一致。
4. 模型列表是否返回 capability。
5. `(session_id, turn_index)` 唯一约束是否完成。
6. 幂等重复请求是否能返回已有结果。
7. `api.ts` 非 JSON preview 是否修复。

### 语音能力状态

只能选择并说明：

- 仅浏览器语音输入辅助
- 已实现服务端 ASR
- 已实现多模态音频输入
- 已实现 TTS 语音回复

如果没有 `/turns/voice`，必须写：

```text
未实现完整语音对话。
```

### 流式输出状态

只能选择并说明：

- 未实现
- 状态流 + 校验后打字机展示
- SSE 状态流
- 真正 token 级流式输出

如果没有 `/turns/stream` 或 fetch/SSE streaming，不能说流式已完成。

### 测试结果

列出实际运行命令和结果。

### 上线判断

只能选择：

- 可以上线内测
- 不建议上线
- 必须阻塞上线

如果 P0 未全部修复，必须选择：

```text
必须阻塞上线
```

