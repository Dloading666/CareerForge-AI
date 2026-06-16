# AI 面试官下一步优化强制修改提示词

> 使用方式：把本文件完整发送给下一个 AI 编码代理。它必须严格按本文执行，不能自行改方向、不能跳过验证、不能把未完成能力说成已完成。

## 0. 当前项目状态

仓库路径：

```text
D:\Ai Agent\CareerForge-AI
```

当前 AI 面试官的正式入口是：

- 前端：`frontend/src/student/AIInterviewerPage.tsx`
- 后端：`backend/app/interview/router_student.py`
- 核心服务：`backend/app/interview/service.py`
- 状态机：`backend/app/interview/state_machine.py`
- Harness：`backend/app/interview/harness.py`

当前已经完成的部分：

1. 旧 Agentic Loop 面试官执行能力已经删除。
2. `agent_runtime.py` 里只保留弃用引导入口，不再注册面试工具。
3. 正式面试走 `/api/v1/student/interviews` 独立结构化 API。
4. 面试类型主入口已经限制为：
   - `first_round`：初面
   - `second_round`：二面
5. 语音回答接口已经改为：

```http
POST /api/v1/student/interviews/{session_id}/turns/voice
Content-Type: multipart/form-data
```

6. 前端已使用 `MediaRecorder + FormData` 上传音频。
7. 后端 `voice_submit_turn(...)` 中 Mimo v2.5 只负责转写，转写文本进入 `submit_turn(...)`。
8. 当前测试结果曾经达到：
   - `python -m compileall -f app\interview app\student app\core` 通过
   - `python -m pytest tests\test_interview_harness.py tests\test_interview.py -q`：`110 passed`
   - `alembic heads`：单 head
   - `npm run build` 通过
   - `npm run lint`：0 error，1 个既有 warning

当前仍存在的不足：

1. 开始面试的“流式进度”仍是前端定时模拟，不是后端真实事件。
2. 面试官语音提问用的是浏览器 `SpeechSynthesis`，不是 Mimo 服务端 TTS。
3. 语音回答没有静音检测，主要依赖“我说完了”按钮和 120 秒超时。
4. 第一问虽然已有简历约束，但还需要更强地保证“直接引用简历中的具体项目/经历/技能”。
5. `frontend/src/student/InterviewerChatInput.tsx` 在 git 状态里可能仍是 `AD`，最终提交前必须清理。

## 1. 最高优先级原则

下一个 AI 必须遵守：

1. **不允许恢复旧面试官。**
   - 不允许在 `backend/app/student/agent_runtime.py` 里重新加入：
     - `start_interview_session`
     - `submit_interview_answer`
     - `get_interview_report`
   - `agent_runtime.py` 只允许保留跳转引导。

2. **不允许让语音模型接管面试逻辑。**
   - Mimo v2.5 在用户语音回答链路中只能做转写。
   - 不允许 Mimo 评分。
   - 不允许 Mimo 生成下一题。
   - 不允许 Mimo 决定是否结束。
   - 下一题、评分、阶段推进、报告必须走：
     - `submit_turn(...)`
     - `state_machine.py`
     - `harness.py`
     - `generate_report(...)`

3. **不允许把浏览器 TTS 宣传成 Mimo 双向语音。**
   - 如果仍使用 `SpeechSynthesis`，文案必须写“浏览器朗读”或“本地语音朗读”。
   - 只有真正调用 Mimo 或服务端 TTS 生成音频时，才可以写“面试官语音输出”。

4. **不允许绕过统一请求工具。**
   - 普通 JSON 请求用 `apiRequest`。
   - multipart 音频上传可以用 `apiRequest`，因为它已经识别 `FormData` 不手写 `Content-Type`。
   - 如果使用 `authenticatedFetch`，也必须走统一鉴权逻辑。
   - 禁止裸 `fetch` 手写 Bearer token。

5. **不允许漏多租户过滤。**
   - 所有后端查询必须带 `tenant_id`。
   - 涉及学生数据必须同时带 `student_id`。

## 2. P0 必须完成：真实后端进度事件

### 当前问题

`AIInterviewerPage.tsx` 现在用前端定时器模拟 7 个阶段：

1. 正在读取简历
2. 正在分析岗位 JD
3. 正在匹配简历经历与岗位要求
4. 正在检索题库/RAG
5. 正在生成第一问
6. 正在校验问题质量
7. 第一问已生成

这能缓解卡顿，但不是后端真实进度。

### 必须实现

新增后端真实进度事件机制。推荐实现一个轻量轮询进度，不要一上来重构成复杂 SSE。

后端新增进度缓存：

文件：

```text
backend/app/interview/progress.py
```

职责：

- 用内存字典保存短生命周期进度。
- key 使用 `request_id`。
- value 包含：
  - `stage`
  - `status`
  - `message`
  - `updated_at`
  - `done`
  - `error`
- 进度只保存 10 分钟。

建议结构：

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

_PROGRESS: dict[str, dict[str, Any]] = {}
_TTL = timedelta(minutes=10)


def set_progress(request_id: str | None, *, stage: str, status: str, message: str, done: bool = False, error: str | None = None) -> None:
    if not request_id:
        return
    _PROGRESS[request_id] = {
        "stage": stage,
        "status": status,
        "message": message,
        "done": done,
        "error": error,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    cleanup_progress()


def get_progress(request_id: str) -> dict[str, Any] | None:
    cleanup_progress()
    return _PROGRESS.get(request_id)


def cleanup_progress() -> None:
    now = datetime.now(timezone.utc)
    expired = []
    for key, value in _PROGRESS.items():
        try:
            updated = datetime.fromisoformat(value.get("updated_at", ""))
        except Exception:
            expired.append(key)
            continue
        if now - updated > _TTL:
            expired.append(key)
    for key in expired:
        _PROGRESS.pop(key, None)
```

修改 schema：

文件：

```text
backend/app/interview/schemas.py
```

给 `InterviewStartRequest` 增加：

```python
request_id: str | None = Field(default=None, max_length=80, description="前端生成的进度追踪 ID")
```

给 `InterviewTurnRequest` 也保留或确认已有：

```python
request_id: str | None
turn_id: int | None
```

新增进度查询接口：

文件：

```text
backend/app/interview/router_student.py
```

```python
@router.get("/progress/{request_id}")
def get_interview_progress(
    request_id: str,
    current=Depends(require_role("student")),
):
    progress = get_progress(request_id)
    if not progress:
        return ok({
            "stage": "unknown",
            "status": "pending",
            "message": "等待任务开始",
            "done": False,
            "error": None,
        })
    return ok(progress)
```

修改 `start_interview(...)`：

文件：

```text
backend/app/interview/service.py
```

在关键步骤写入真实进度：

```python
set_progress(payload.request_id, stage="resume", status="active", message="正在读取用户选择的在线简历")
...
set_progress(payload.request_id, stage="jd", status="active", message="正在分析岗位 JD")
...
set_progress(payload.request_id, stage="match", status="active", message="正在匹配简历经历与岗位要求")
...
set_progress(payload.request_id, stage="rag", status="active", message="正在检索题库/RAG")
...
set_progress(payload.request_id, stage="llm", status="active", message="正在生成第一问")
...
set_progress(payload.request_id, stage="harness", status="active", message="正在校验第一问是否围绕简历和 JD")
...
set_progress(payload.request_id, stage="done", status="done", message="第一问已生成", done=True)
```

异常时必须写入：

```python
set_progress(payload.request_id, stage="error", status="error", message="创建面试失败", done=True, error=str(exc))
```

前端修改：

文件：

```text
frontend/src/student/AIInterviewerPage.tsx
```

开始面试时：

1. 生成 `requestId = crypto.randomUUID()`。
2. POST `/student/interviews` 时把 `request_id` 放入 body。
3. 同时每 800ms 轮询：

```text
GET /api/v1/student/interviews/progress/{requestId}
```

4. 用后端返回结果更新进度条。
5. 如果后端进度暂时不可用，才使用前端模拟阶段作为 fallback。

验收：

- 慢模型时，用户看到的是后端真实阶段。
- 后端报错时，前端显示具体失败阶段。
- 前端不能再只靠固定定时器假装流式。

## 3. P0 必须完成：第一问强绑定简历事实

### 当前问题

第一问虽然要求包含“我已经读取了你的简历”，但仍可能太泛。

错误示例：

```text
我已经读取了你的简历，请选择一个最能证明你适合该岗位的项目介绍。
```

这个不合格，因为它没有点名简历中的具体项目或经历。

### 必须实现

后端在生成第一问前必须抽取简历事实锚点。

文件：

```text
backend/app/interview/service.py
```

新增函数：

```python
def _extract_resume_anchors(resume_snapshot: str) -> list[str]:
    text = (resume_snapshot or "").strip()
    if not text or "暂未" in text:
        return []
    anchors: list[str] = []
    for line in text.splitlines():
        item = line.strip(" -•\t")
        if not item:
            continue
        if any(key in item for key in ("项目", "经历", "实习", "公司", "技术", "负责", "开发", "系统", "平台")):
            anchors.append(item[:120])
        if len(anchors) >= 5:
            break
    return anchors
```

把 `resume_anchors` 注入 start prompt：

```python
resume_anchors = _extract_resume_anchors(resume_snapshot)
```

Prompt 中必须加入：

```text
【必须引用的简历事实锚点】
{resume_anchors}

第一问必须至少引用其中一个具体项目、经历、技能或职责。不得只说“我已经读取了你的简历”。
```

Harness 校验增强：

文件：

```text
backend/app/interview/harness.py
```

`validate_start_output(data, context)` 必须检查：

1. `first_question` 包含“简历/看到/读取/项目/经历”等已读简历语义。
2. 如果 `context.resume_anchors` 非空，`first_question` 必须命中至少一个 anchor 里的关键词。
3. 如果没有命中，返回错误：

```text
first_question 未引用简历中的具体项目/经历/技能
```

注意：

- 不要用严格全文匹配，应该抽取关键词或使用包含关系。
- 不能因为简历为空而伪造 anchor。

测试：

文件：

```text
backend/tests/test_interview_harness.py
```

新增测试：

1. 有 anchor 且 first_question 未引用 anchor，应失败。
2. 有 anchor 且 first_question 引用了项目名/技能名，应通过。
3. 无 anchor 时，不要求引用具体项目，但必须说明没有读到足够简历信息，并优先询问项目/技能/求职方向。

验收：

- 第一问不再是泛泛让用户自己选项目。
- 第一问必须直接围绕用户简历中的具体内容。

## 4. P1 必须完成：服务端 TTS 能力探测与降级

### 当前问题

前端现在使用浏览器 `SpeechSynthesis` 朗读问题。这个可以作为 fallback，但不能宣称是 Mimo 服务端语音输出。

### 必须实现

新增服务端 TTS 能力探测与明确降级。

后端接口：

文件：

```text
backend/app/interview/router_student.py
```

保留或完善：

```http
GET /api/v1/student/interviews/{session_id}/turns/{turn_id}/voice/reply
```

但它当前只返回文本是不够的。需要返回结构：

```json
{
  "mode": "browser_tts",
  "text": "问题文本",
  "audio_base64": null,
  "content_type": null,
  "provider": null,
  "reason": "当前未配置服务端 TTS，前端将使用浏览器朗读"
}
```

如果后续确认 Mimo v2.5 支持音频输出，则返回：

```json
{
  "mode": "server_tts",
  "text": "问题文本",
  "audio_base64": "...",
  "content_type": "audio/mpeg",
  "provider": "mimo-v2.5",
  "reason": null
}
```

强制要求：

- 服务端 TTS 只能朗读数据库里已有的 `turn.question`。
- 不允许 TTS 模型改写问题。
- 不允许 TTS 模型重新生成问题。

前端修改：

`speakQuestion(questionText)` 改成：

1. 优先调用 `/voice/reply`。
2. 如果返回 `server_tts`，播放 `audio_base64`。
3. 如果返回 `browser_tts`，使用 `SpeechSynthesis`。
4. UI 文案必须区分：
   - `server_tts`：`面试官正在语音提问`
   - `browser_tts`：`正在使用浏览器朗读问题`

验收：

- 不能再让用户误以为当前一定是 Mimo 服务端语音输出。
- 浏览器 TTS 和服务端 TTS 路径清晰可区分。

## 5. P1 必须完成：语音自动录音的静音检测

### 当前问题

当前只实现了：

- 朗读结束后自动开始录音
- 用户点击“我说完了”
- 120 秒最长录音自动提交

没有静音检测。

### 必须实现

前端使用 Web Audio API 做简单静音检测。

文件：

```text
frontend/src/student/AIInterviewerPage.tsx
```

录音开始时：

1. 创建 `AudioContext`。
2. 创建 `AnalyserNode`。
3. 每 200ms 计算音量 RMS。
4. 当检测到用户开始说话后，如果连续 1500ms 低于阈值，则自动停止并提交。
5. 如果用户一直不说话，最多等待 15 秒，然后提示用户重新回答或手动点击“我说完了”。

建议状态：

```ts
const [voiceLevel, setVoiceLevel] = useState(0)
const [silenceDetected, setSilenceDetected] = useState(false)
const [hasSpoken, setHasSpoken] = useState(false)
```

阈值建议：

```ts
const SPEECH_THRESHOLD = 0.035
const SILENCE_AFTER_SPEECH_MS = 1500
const NO_SPEECH_TIMEOUT_MS = 15000
const MAX_RECORDING_MS = 120000
```

UI 必须显示：

- 当前正在听
- 检测到声音
- 静音自动提交倒计时或提示
- “我说完了”手动兜底按钮

验收：

- 面试官说完后自动开始录音。
- 用户说话后停顿 1.5 秒左右自动提交。
- 用户也可以手动点击“我说完了”。
- 没有声音时不会一直卡住。

## 6. P1 必须完成：语音模式状态机防重入

### 当前风险

语音播放、录音、上传、下一问播放可能互相重入。

### 必须实现

新增明确的前端语音状态：

```ts
type VoicePhase =
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'uploading'
  | 'thinking'
  | 'error'
```

规则：

- `speaking` 时不能开始录音。
- `listening` 时不能重复开始录音。
- `uploading/thinking` 时不能再次提交。
- 新问题返回后，必须先切到 `speaking`。
- 面试结束后必须停止所有录音、TTS、计时器。

清理逻辑：

组件卸载或面试结束时必须执行：

```ts
window.speechSynthesis?.cancel()
mediaRecorderRef.current?.stop()
audioContextRef.current?.close()
clearTimeout(...)
clearInterval(...)
```

验收：

- 快速连续点击按钮不会重复上传。
- 切换页面不会继续录音。
- 结束报告后不会继续播放或监听。

## 7. P2 应完成：历史记录与报告体验修正

### 7.1 清理 git 状态中的 `AD`

当前 `frontend/src/student/InterviewerChatInput.tsx` 可能显示为 `AD`。

必须执行：

```powershell
git add -A frontend/src/student/InterviewerChatInput.tsx
```

或者确保最终 `git status --short` 不再出现：

```text
AD frontend/src/student/InterviewerChatInput.tsx
```

注意：

- 不要恢复这个文件。
- 它是旧的未接入组件，必须删除。

### 7.2 报告“再练一场”必须保留

不要破坏：

- `InterviewReportDrawer`
- `onPracticeAgain`
- `next_session_preset`

验收：

- 点击“按此计划再练一场”只回填配置，不自动开始。

## 8. 必须运行的验证命令

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

全文搜索：

```powershell
cd "D:\Ai Agent\CareerForge-AI"
rg -n "start_interview_session|submit_interview_answer|get_interview_report|InterviewerChatInput" backend frontend --glob "!frontend/dist/**"
rg -n "voice-turns|voice-confirm|VoiceDraft|_VOICE_DRAFTS" backend frontend --glob "!frontend/dist/**"
rg -n "audio_base64" frontend/src
```

验收要求：

- 第一条搜索只能允许 `agent_runtime.py` 中的弃用引导常量，不允许旧工具出现。
- 第二条搜索必须为空。
- 第三条搜索必须为空，前端不能用 base64 JSON 上传音频。

## 9. 最终强制自查模板

完成后，不允许只说“已完成”。必须按下面格式回答：

```text
自查报告

1. 旧 Agentic Loop 面试官是否恢复？
结论：
证据：
是否仍有 start_interview_session / submit_interview_answer / get_interview_report：

2. 开始面试进度是否来自后端真实进度？
结论：
接口：
前端 fallback 是否存在：
失败阶段如何展示：

3. 第一问是否强绑定简历事实？
结论：
代码位置：
Harness 如何校验：
测试用例：
如果简历为空如何处理：

4. Mimo v2.5 在用户语音链路中是否只负责转写？
结论：
Prompt 内容：
是否评分：
是否生成下一题：
是否决定结束：
最终是否进入 submit_turn：

5. 面试官语音输出是否真实可区分？
结论：
当前使用 server_tts 还是 browser_tts：
如果是 browser_tts，UI 是否明确说明：
是否允许 TTS 改写问题：

6. 语音录音是否自动开始和自动结束？
结论：
是否朗读结束后自动录音：
是否实现静音检测：
是否保留“我说完了”兜底：
是否有最长录音限制：

7. 语音状态是否防重入？
结论：
状态枚举：
如何防止重复录音/重复上传：
页面卸载如何清理：

8. 测试和构建
backend compileall：
pytest：
alembic heads：
frontend build：
frontend lint：

9. 仍未完成或风险
必须如实列出，不允许隐藏。
```

如果以上任何一项失败，必须继续修改，不能结束任务。

