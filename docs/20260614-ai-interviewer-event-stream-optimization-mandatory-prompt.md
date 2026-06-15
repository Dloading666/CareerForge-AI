# AI 面试官下一阶段事件流与体验优化强制提示词

> 使用方式：把本文件完整发送给下一个 AI 编码代理。它必须先读本文，再改代码。本文是强制执行任务书，不是建议清单。禁止跳过验证，禁止把未完成能力描述成已完成。

## 0. 当前真实状态

项目路径：

```text
D:\Ai Agent\CareerForge-AI
```

正式 AI 面试官入口：

- 前端：`frontend/src/student/AIInterviewerPage.tsx`
- 后端路由：`backend/app/interview/router_student.py`
- 后端服务：`backend/app/interview/service.py`
- 状态机：`backend/app/interview/state_machine.py`
- Harness：`backend/app/interview/harness.py`
- 进度缓存：`backend/app/interview/progress.py`

当前已经完成：

1. 旧 Agentic Loop 面试官执行能力已删除，只保留 `agent_runtime.py` 中的跳转引导。
2. 正式面试不走 `student/agent_runtime.py`，只走 `/api/v1/student/interviews` 独立 API。
3. 语音回答接口为：

```http
POST /api/v1/student/interviews/{session_id}/turns/voice
Content-Type: multipart/form-data
```

4. Mimo v2.5 在用户语音链路中只负责音频转写。
5. 转写文本进入 `submit_turn(...)`，不绕过 Harness。
6. 面试官语音提问当前是：
   - `browser_tts`：浏览器 `SpeechSynthesis`
   - 服务端 TTS 暂未真正接入
7. 开始面试已有进度轮询：

```http
GET /api/v1/student/interviews/progress/{request_id}
```

8. 这不是 SSE，不是简历助手那种 `message.delta` 流式，只是后端进度轮询。

## 1. 最高优先级原则

下一个 AI 必须遵守：

1. **绝对禁止恢复旧面试官 Agentic Loop。**
   - 不得新增 `start_interview_session`
   - 不得新增 `submit_interview_answer`
   - 不得新增 `get_interview_report`
   - 不得把面试官接入 `chatRuntimeStore.ts` 的简历助手 run 流程

2. **AI 面试官必须继续是结构化面试 Workflow。**
   - 流程控制属于 `service.py + state_machine.py + harness.py`
   - 模型只生成候选问题、候选评分、候选报告
   - Harness 决定校验、fallback、阶段推进、结束条件

3. **允许做类似简历助手的“事件流体验”，但不允许复用简历助手 Agentic Loop。**
   - 可以新增 interview 专用 SSE
   - 可以新增 interview run id
   - 可以新增 interview event store
   - 但不能把面试官变成开放式工具调用 Agent

4. **语音模型不能越权。**
   - Mimo v2.5 只能转写用户回答音频
   - 不能评分
   - 不能生成下一题
   - 不能决定是否结束

5. **所有用户可见状态必须真实。**
   - 如果是后端真实事件，文案可以写“正在分析”
   - 如果只是前端 fallback，必须在代码注释中标明 fallback
   - 不允许把浏览器 `SpeechSynthesis` 写成 Mimo 服务端 TTS

## 2. 总目标

把 AI 面试官从“REST 请求 + 进度轮询”升级为“结构化面试事件流”：

```text
用户点击开始面试
→ 后端创建 interview run
→ 前端订阅 run events
→ 后端按阶段发送 runtime.status
→ 后端生成第一问
→ 前端实时显示阶段状态
→ 第一问展示
→ 语音模式下朗读问题
→ 用户回答
→ 后端继续发送评分/追问阶段事件
→ 下一题展示
→ 结束后报告生成事件流
```

用户体验目标：

- 不再像“卡住”等待。
- 每一步都知道面试官正在做什么。
- 第一问直接围绕简历具体内容。
- 语音面试是连续体验：面试官说，用户说，系统转写，再继续问。
- 报告生成也有进度，不是点击后干等。

## 3. P0：新增 Interview Run 事件流，不接入旧 Agentic Loop

### 3.1 新增后端事件模型或内存事件队列

优先实现内存事件队列，避免本阶段引入迁移。如果需要断线续传，再升级数据库事件表。

新增文件：

```text
backend/app/interview/run_events.py
```

必须提供：

```python
from __future__ import annotations

from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

_EVENTS: dict[str, deque[dict[str, Any]]] = defaultdict(deque)
_DONE: dict[str, bool] = {}
_TTL = timedelta(minutes=30)
_CREATED_AT: dict[str, datetime] = {}


def create_interview_run() -> str:
    run_id = str(uuid4())
    _CREATED_AT[run_id] = datetime.now(timezone.utc)
    _DONE[run_id] = False
    return run_id


def emit_interview_event(run_id: str | None, event: str, data: dict[str, Any]) -> None:
    if not run_id:
        return
    payload = {
        "seq": len(_EVENTS[run_id]) + 1,
        "event": event,
        "data": data,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _EVENTS[run_id].append(payload)
    while len(_EVENTS[run_id]) > 500:
        _EVENTS[run_id].popleft()


def mark_interview_run_done(run_id: str | None) -> None:
    if run_id:
        _DONE[run_id] = True


def get_interview_events(run_id: str, after_seq: int = 0) -> list[dict[str, Any]]:
    cleanup_interview_runs()
    return [item for item in _EVENTS.get(run_id, []) if int(item.get("seq", 0)) > after_seq]


def is_interview_run_done(run_id: str) -> bool:
    return bool(_DONE.get(run_id))


def cleanup_interview_runs() -> None:
    now = datetime.now(timezone.utc)
    expired = [run_id for run_id, created in _CREATED_AT.items() if now - created > _TTL]
    for run_id in expired:
        _EVENTS.pop(run_id, None)
        _DONE.pop(run_id, None)
        _CREATED_AT.pop(run_id, None)
```

### 3.2 新增 SSE 端点

文件：

```text
backend/app/interview/router_student.py
```

新增：

```http
GET /api/v1/student/interviews/runs/{run_id}/events?after_seq=0
```

实现要求：

- 返回 `text/event-stream`
- 每条事件包含：
  - `seq`
  - `event`
  - `data`
- 支持 `after_seq`
- run done 且没有新事件后发送 `done`
- 每 10 秒发送 heartbeat，避免连接无响应

事件格式示例：

```text
event: runtime.status
data: {"seq":1,"label":"正在读取简历","phase":"resume"}

event: interview.question.created
data: {"seq":7,"turn_id":123,"question":"..."}

event: done
data: {"seq":8}
```

### 3.3 新增启动 run 的端点

不要破坏原来的 `POST /student/interviews`。

新增：

```http
POST /api/v1/student/interviews/runs/start
```

请求体仍使用 `InterviewStartRequest`。

返回：

```json
{
  "run_id": "uuid",
  "request_id": "uuid"
}
```

后端行为：

1. 创建 `run_id`
2. 后台执行 `start_interview(...)`
3. 执行中不断 `emit_interview_event(...)`
4. 完成后发送：

```text
interview.started
```

data 包含：

```json
{
  "session": {},
  "first_turn": {},
  "knowledge_status": {}
}
```

5. 最后发送 `done`

注意：

- 不要阻塞 HTTP 请求直到第一问生成。
- 可以用 `BackgroundTasks` 或 `asyncio.create_task`。
- 后台任务里要自己管理 DB session，不能使用请求生命周期里的 session。

### 3.4 service.py 支持事件发射

修改：

```text
backend/app/interview/service.py
```

给 `start_interview(...)` 增加可选参数：

```python
event_run_id: str | None = None
```

每个关键阶段调用：

```python
emit_interview_event(event_run_id, "runtime.status", {
    "phase": "resume",
    "label": "正在读取用户选择的在线简历",
})
```

必须至少发这些事件：

- `runtime.status` phase=`resume`
- `runtime.status` phase=`jd`
- `runtime.status` phase=`match`
- `runtime.status` phase=`rag`
- `runtime.status` phase=`llm`
- `runtime.status` phase=`harness`
- `interview.question.created`
- `interview.started`
- `done`

错误时必须发：

- `runtime.error`
- `done`

## 4. P0：前端改成订阅 Interview SSE

文件：

```text
frontend/src/student/AIInterviewerPage.tsx
```

### 4.1 新增 startInterviewRun

语义：

```text
点击开始面试
→ POST /student/interviews/runs/start
→ 获取 run_id
→ 订阅 /student/interviews/runs/{run_id}/events
→ 根据事件更新 UI
```

不要删除原 REST 创建接口，可以保留 fallback。

### 4.2 事件处理要求

必须处理事件：

```ts
type InterviewRunEvent =
  | 'runtime.status'
  | 'runtime.error'
  | 'interview.question.created'
  | 'interview.started'
  | 'done'
```

处理逻辑：

- `runtime.status`：更新阶段进度条
- `runtime.error`：标记当前阶段失败，显示重试按钮
- `interview.question.created`：可以提前显示第一问草稿或问题预览
- `interview.started`：设置 `session`、`turns`、`knowledge`
- `done`：关闭事件流

必须支持断线重连：

- 保存 `afterSeq`
- 连接失败后最多重试 3 次
- 重试仍失败则回退到当前 `progress/{request_id}` 轮询

### 4.3 UI 必须像简历助手一样显示“动作过程”

在 `AIInterviewerPage.tsx` 的准备区显示：

- 当前阶段标题
- 已完成阶段列表
- 当前阶段思考耗时
- 后端发来的 label
- 出错阶段和错误信息

不要只显示一个 loading 圈。

## 5. P0：提交回答和报告生成也要事件化

### 5.1 回答提交 run

新增后端端点：

```http
POST /api/v1/student/interviews/{session_id}/turns/runs/submit
```

请求体：

```json
{
  "answer": "...",
  "turn_id": 123,
  "request_id": "uuid"
}
```

返回：

```json
{
  "run_id": "uuid"
}
```

后台任务执行 `submit_turn(...)`。

必须发送事件：

- `runtime.status` phase=`receive_answer` label=`正在读取你的回答`
- `runtime.status` phase=`score` label=`正在按评分 Rubric 评价回答`
- `runtime.status` phase=`stage` label=`正在判断下一轮面试阶段`
- `runtime.status` phase=`next_question` label=`正在生成下一问`
- `interview.turn.scored`
- `interview.question.created`
- `interview.turn.completed`
- `done`

### 5.2 语音回答提交 run

新增或扩展：

```http
POST /api/v1/student/interviews/{session_id}/turns/voice/run
Content-Type: multipart/form-data
```

返回：

```json
{
  "run_id": "uuid"
}
```

后台任务：

1. 转写音频
2. 发 `interview.voice.transcribed`
3. 调用 `submit_turn(...)`
4. 发评分和下一题事件

Mimo 仍然只能转写。

### 5.3 报告生成 run

新增：

```http
POST /api/v1/student/interviews/{session_id}/report/run
```

返回：

```json
{
  "run_id": "uuid"
}
```

事件：

- `runtime.status` phase=`collect_turns` label=`正在整理面试记录`
- `runtime.status` phase=`score_summary` label=`正在汇总维度评分`
- `runtime.status` phase=`training_plan` label=`正在生成训练计划`
- `runtime.status` phase=`report` label=`正在生成报告正文`
- `interview.report.created`
- `done`

前端点击“结束并生成报告”时订阅报告 run，而不是干等。

## 6. P1：首问质量继续强化

当前已有 `_extract_resume_anchors` 和 Harness 锚点校验。

继续优化：

1. `_extract_resume_anchors` 不要只按行粗糙抽取。
2. 如果简历是 JSON，优先解析 JSON：
   - projects
   - work_experience
   - skills
   - honors
   - education
3. 生成 anchors 时输出结构：

```python
{
  "type": "project",
  "name": "AI Agent 开发平台",
  "evidence": "负责 RAG 检索和工具编排",
  "keywords": ["AI Agent", "RAG", "工具编排"]
}
```

4. Harness 校验用 `keywords`，不要只用原始字符串切词。

测试必须覆盖：

- JSON 简历项目锚点
- 纯文本简历锚点
- 简历为空
- 模型第一问只说“我读过简历”但不引用具体锚点时失败

## 7. P1：语音体验继续优化

当前语音模式已经有：

- 浏览器 TTS
- 自动录音
- 静音检测
- 手动“我说完了”

继续优化：

1. 增加声音电平可视化。
2. 增加“正在转写你的回答”事件。
3. 增加 transcript 预览：
   - 转写完成后短暂展示用户回答文本
   - 允许 5 秒内取消并改用文字
   - 如果用户不操作，继续进入评分/追问

注意：

- transcript 预览不能让 Mimo 生成下一题。
- 取消后不能写入 turn。
- 确认后仍然调用 `submit_turn(...)`。

## 8. P1：报告训练闭环增强

文件：

```text
frontend/src/student/InterviewReportDrawer.tsx
backend/app/interview/service.py
backend/app/interview/harness.py
```

必须保证报告中：

- `training_plan` 至少 3 天
- `rewrite_examples` 至少 1 条
- `next_session_preset` 包含：
  - `target_role`
  - `interview_type`
  - `interview_style`
  - `focus_tags`

如果 LLM 没有生成，fallback 必须补齐。

前端：

- “按此计划再练一场”只回填配置，不自动开始。
- 回填后滚动到配置区。
- 显示“已按报告建议回填下一场配置”。

## 9. 禁止事项

下一个 AI 不允许：

1. 不允许删除正式 `backend/app/interview/*` 独立面试 API。
2. 不允许恢复旧 `agent_runtime.py` 面试工具。
3. 不允许把面试官接入简历助手的 `chatRuntimeStore` run。
4. 不允许让语音模型评分或生成下一题。
5. 不允许用前端假进度冒充后端事件流。
6. 不允许把浏览器 TTS 说成 Mimo 服务端 TTS。
7. 不允许提交未通过 build/test 的代码。
8. 不允许隐藏失败项。

## 10. 必须运行的验证命令

后端：

```powershell
cd "D:\Ai Agent\CareerForge-AI\backend"
python -m compileall -f app\interview app\student app\core
$env:PYTHONPATH='.'
python -m pytest tests\test_interview_harness.py tests\test_interview.py -q
alembic heads
```

前端：

```powershell
cd "D:\Ai Agent\CareerForge-AI\frontend"
npm run build
npm run lint
```

搜索检查：

```powershell
cd "D:\Ai Agent\CareerForge-AI"
rg -n "start_interview_session|submit_interview_answer|get_interview_report|InterviewerChatInput" backend frontend --glob "!frontend/dist/**"
rg -n "voice-turns|voice-confirm|VoiceDraft|_VOICE_DRAFTS" backend frontend --glob "!frontend/dist/**"
rg -n "message.delta" backend/app/interview frontend/src/student/AIInterviewerPage.tsx
```

要求：

- 第一条不能出现旧面试官工具。
- 第二条必须为空。
- 第三条不应该出现，除非你真的为 interview 实现了独立 `interview.message.delta`，不能复用简历助手 `message.delta`。

## 11. 强制自查报告模板

完成后必须按此格式回答：

```text
自查报告

1. 是否恢复旧 Agentic Loop 面试官？
结论：
证据：

2. AI 面试官是否仍是独立结构化 API？
结论：
涉及文件：

3. 开始面试是否使用 Interview SSE 事件流？
结论：
run 创建接口：
events 订阅接口：
支持 after_seq：
支持 heartbeat：
失败如何展示：

4. 回答提交是否事件化？
结论：
文字回答 run：
语音回答 run：
事件列表：

5. 报告生成是否事件化？
结论：
报告 run：
事件列表：

6. 第一问是否强绑定简历事实？
结论：
anchor 抽取方式：
Harness 校验：
测试覆盖：

7. Mimo v2.5 是否只负责语音转写？
结论：
是否评分：
是否生成下一题：
是否决定结束：
最终是否进入 submit_turn：

8. 语音体验是否增强？
结论：
自动朗读：
自动录音：
静音检测：
声音电平：
transcript 预览：

9. 报告训练闭环是否增强？
结论：
training_plan：
rewrite_examples：
next_session_preset：
再练一场是否只回填不自动开始：

10. 验证结果
backend compileall：
pytest：
alembic heads：
frontend build：
frontend lint：
搜索检查：

11. 仍未完成或风险
必须如实列出。
```

如果任何一项失败，必须继续修改，不允许结束任务。

