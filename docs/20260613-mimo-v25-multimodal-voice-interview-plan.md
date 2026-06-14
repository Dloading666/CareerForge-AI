# Mimo v2.5 多模态语音面试实施方案

> 目标：把 AI 面试官从“浏览器语音输入辅助”升级为真正的语音面试链路。Mimo v2.5 作为多模态模型负责音频理解/转写，可选负责面试官语音回复生成；面试状态、评分、报告仍由现有 `backend/app/interview` Harness 控制。

## 1. 核心原则

1. 语音只是输入/输出通道，不改变面试业务主链路。
2. 语音转成文本后，必须调用现有 `submit_turn(...)`。
3. 不能让 Mimo 音频模型直接决定下一题、评分或结束面试。
4. 所有状态推进必须由 `state_machine.py` 和 `service.py` 控制。
5. 所有模型输出都必须经过 `harness.py` 校验、repair 或 fallback。
6. 前端录音请求必须走 `authenticatedFetch`，因为是 `multipart/form-data`。

## 2. 目标用户体验

### 2.1 文本面试

保持现状：

- 用户输入文字回答。
- 调用 `POST /student/interviews/{session_id}/turns`。
- 返回下一题、评分摘要、阶段信息。

### 2.2 语音输入

新增：

1. 用户点击麦克风按钮开始录音。
2. 前端显示录音时长和停止按钮。
3. 用户停止录音后，前端上传音频。
4. 后端调用 Mimo v2.5 多模态模型生成 transcript。
5. 后端把 transcript 传入 `submit_turn(...)`。
6. 前端展示：
   - 用户音频气泡
   - 识别文本 transcript
   - AI 面试官下一题
   - 本轮回答反馈

### 2.3 语音回复（可选第二阶段）

如果要称为“完整语音面试”，还应支持：

1. 后端把下一题文本转成音频。
2. 前端自动或手动播放面试官语音。
3. 用户仍可选择文本输入或语音输入。

如果未实现 TTS，产品文案只能写：

```text
语音回答
```

不要写：

```text
全语音面试
```

## 3. 后端设计

### 3.1 配置项

文件：

- `backend/app/core/config.py`
- `backend/.env.example`

新增环境变量：

```python
mimo_api_key: str | None = Field(default=None, alias="MIMO_API_KEY")
mimo_base_url: str = Field(default="https://api.mimo.example/v1", alias="MIMO_BASE_URL")
mimo_multimodal_model: str = Field(default="mimov2.5", alias="MIMO_MULTIMODAL_MODEL")
mimo_voice_timeout_seconds: int = Field(default=45, alias="MIMO_VOICE_TIMEOUT_SECONDS")
mimo_voice_max_bytes: int = Field(default=5 * 1024 * 1024, alias="MIMO_VOICE_MAX_BYTES")
mimo_voice_max_seconds: int = Field(default=60, alias="MIMO_VOICE_MAX_SECONDS")
```

`.env.example` 同步增加：

```env
MIMO_API_KEY=
MIMO_BASE_URL=https://api.mimo.example/v1
MIMO_MULTIMODAL_MODEL=mimov2.5
MIMO_VOICE_TIMEOUT_SECONDS=45
MIMO_VOICE_MAX_BYTES=5242880
MIMO_VOICE_MAX_SECONDS=60
```

注意：真实 key 不能写入仓库。

### 3.2 Mimo 多模态客户端

新增文件：

- `backend/app/interview/mimo_voice.py`

职责：

- 校验音频 mime type。
- 限制文件大小。
- 调用 Mimo v2.5 多模态接口。
- 返回结构化转写结果。

建议接口：

```python
from dataclasses import dataclass

@dataclass
class VoiceTranscript:
    text: str
    language: str | None = None
    duration_seconds: float | None = None
    confidence: float | None = None

async def transcribe_interview_audio(
    *,
    filename: str,
    content_type: str,
    audio_bytes: bytes,
) -> VoiceTranscript:
    ...
```

Mimo 调用提示词建议：

```text
你是面试语音转写器。请只转写候选人的回答，不要补充、润色、猜测不存在的信息。
要求：
1. 保留技术名词、公司名、项目名。
2. 听不清的地方标记为 [听不清]。
3. 不要替候选人优化表达。
4. 输出 JSON：{"text":"...", "language":"zh-CN", "confidence":0.0到1.0}
```

如果 Mimo v2.5 接口支持直接音频输入，使用多模态 messages：

```json
{
  "model": "mimov2.5",
  "messages": [
    {
      "role": "system",
      "content": "你是面试语音转写器..."
    },
    {
      "role": "user",
      "content": [
        {"type": "input_audio", "audio": "...base64...", "format": "webm"}
      ]
    }
  ],
  "response_format": {"type": "json_object"}
}
```

具体字段名以当前 Mimo 文档为准，但业务约束不变：只转写，不评分，不追问。

### 3.3 新增语音回答端点

文件：

- `backend/app/interview/router_student.py`
- `backend/app/interview/service.py`
- `backend/app/interview/schemas.py`

新增端点：

```http
POST /api/v1/student/interviews/{session_id}/turns/voice
Content-Type: multipart/form-data
```

表单字段：

- `file`: 音频文件，必填。
- `turn_id`: 当前题目 turn id，可选但推荐必传。
- `request_id`: 幂等请求 id，可选。

文件限制：

- 最大 `MIMO_VOICE_MAX_BYTES`，默认 5MB。
- 支持 `audio/webm`、`audio/wav`、`audio/mpeg`、`audio/mp4`、`audio/ogg`。
- 前端默认录 `audio/webm`。

伪代码：

```python
@router.post("/{session_id}/turns/voice")
async def submit_voice_turn(
    session_id: int,
    file: UploadFile = File(...),
    turn_id: int | None = Form(default=None),
    request_id: str | None = Form(default=None),
    db: Session = Depends(get_db),
    identity: AuthIdentity = Depends(require_role("student")),
):
    audio_bytes = await file.read()
    transcript = await transcribe_interview_audio(
        filename=file.filename or "answer.webm",
        content_type=file.content_type or "",
        audio_bytes=audio_bytes,
    )
    if not transcript.text.strip():
        raise InterviewError(status_code=422, detail="未识别到有效语音内容")

    result = submit_turn(
        db=db,
        identity=identity,
        session_id=session_id,
        answer=transcript.text,
        turn_id=turn_id,
        request_id=request_id,
    )
    return ok({
        "transcript": transcript.__dict__,
        "turn_result": result,
    })
```

注意：

- 如果现有 `submit_turn` 是同步函数，路由可以是 async，但调用同步函数时不要重复创建事务。
- 如果 `submit_turn` 已经做幂等，`request_id` 必须透传。
- 不要保存原始音频，除非产品明确需要；如要保存，必须设计过期清理和隐私说明。

### 3.4 可选：面试官 TTS 端点

如果 Mimo v2.5 支持音频输出，可新增：

```http
POST /api/v1/student/interviews/{session_id}/turns/{turn_id}/voice/reply
```

职责：

- 只把数据库里已生成的 `turn.question` 转成音频。
- 不允许重新生成问题内容。
- 返回音频 URL 或 base64 音频。

推荐第一期不落库，直接返回：

```json
{
  "audio_base64": "...",
  "content_type": "audio/mpeg",
  "text": "请介绍..."
}
```

验收：

- TTS 音频文字必须和当前 turn.question 一致。
- 不能调用模型改写题目。

## 4. 前端设计

### 4.1 修改文件

- `frontend/src/student/AIInterviewerPage.tsx`
- 可选新增：`frontend/src/student/useInterviewRecorder.ts`
- 可选新增：`frontend/src/student/VoiceAnswerButton.tsx`

### 4.2 录音 Hook

建议新增 `useInterviewRecorder.ts`，隔离 MediaRecorder 逻辑。

职责：

- 请求麦克风权限。
- 开始录音。
- 停止录音。
- 返回 `Blob`、录音时长、状态、错误。
- 自动限制最大录音时长。

接口：

```ts
type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'stopping' | 'error'

interface UseInterviewRecorderResult {
  status: RecorderStatus
  durationMs: number
  error: string | null
  start: () => Promise<void>
  stop: () => Promise<Blob | null>
  reset: () => void
}
```

默认 mime type：

```ts
const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
  ? 'audio/webm;codecs=opus'
  : 'audio/webm'
```

### 4.3 上传语音回答

在 `AIInterviewerPage.tsx` 中新增：

```ts
async function submitVoiceAnswer(audioBlob: Blob) {
  if (!activeSession || !currentTurnId) return

  const form = new FormData()
  form.append('file', audioBlob, 'answer.webm')
  form.append('turn_id', String(currentTurnId))
  form.append('request_id', crypto.randomUUID())

  const response = await authenticatedFetch(
    `/api/v1/student/interviews/${activeSession.id}/turns/voice`,
    {
      method: 'POST',
      body: form,
    },
  )

  const envelope = await response.json()
  if (!response.ok || envelope.code !== 0) {
    throw new Error(envelope.msg || '语音回答提交失败')
  }

  const { transcript, turn_result } = envelope.data
  // 1. 把 transcript.text 显示到用户回答气泡
  // 2. 用 turn_result 更新 turns/session/report 状态
}
```

注意：

- `authenticatedFetch` 不要手写 `Content-Type`，浏览器会自动带 multipart boundary。
- 录音中禁用文本提交，或允许并行但必须防止同一 turn 重复提交。
- 若后端返回 422，提示用户“没有识别到有效语音，请重新录制或改用文字输入”。

### 4.4 UI 行为

语音按钮状态：

- idle：麦克风图标，点击开始。
- requesting：显示“请求麦克风权限”。
- recording：红点/计时/停止按钮。
- uploading：显示“识别中”。
- error：展示错误并允许重试。

文案建议：

- 未实现 TTS：`语音回答`
- 已实现 TTS：`语音面试`
- 权限失败：`无法访问麦克风，请检查浏览器权限或改用文字回答`
- 识别失败：`未识别到有效语音，请重新录制或改用文字回答`

## 5. Harness 和 Agentic Loop 限制

语音链路中的模型调用分两类：

### 5.1 Mimo v2.5 音频理解

职责只允许：

- 转写候选人回答。
- 输出语言、置信度、可选时长。

禁止：

- 评分。
- 判断候选人能力。
- 生成下一题。
- 判断是否结束面试。
- 修改简历事实。

### 5.2 面试官问题生成模型

仍按现有 `service.py` 流程：

- start：生成第一题候选 JSON。
- followup：生成下一题候选 JSON。
- report：生成报告候选 JSON。

Harness 必须控制：

- 字段完整性。
- 问题合法性。
- 阶段推进。
- 最大轮次。
- fallback 问题。
- 报告结构。

建议限制：

- 单次语音转写调用：最多 1 次主调用 + 1 次 JSON repair。
- 单次 followup 生成：最多 1 次主调用 + 1 次 repair + fallback。
- 单场面试最大题目数由 `round_limit` 控制，建议 UI 最大 12，后端硬上限 20。
- 不允许模型自行无限追问。

## 6. 数据结构建议

如果暂不保存音频，现有 turn 表可只增加或复用字段：

- `answer`：转写文本。
- `answer_meta_json`：可选保存：

```json
{
  "input_mode": "voice",
  "transcript_confidence": 0.86,
  "transcript_language": "zh-CN",
  "audio_content_type": "audio/webm",
  "audio_duration_seconds": 32.4
}
```

如果要保存音频，需要新增表或对象存储字段：

- `tenant_id`
- `student_id`
- `session_id`
- `turn_id`
- `storage_key`
- `content_type`
- `size_bytes`
- `duration_seconds`
- `expires_at`
- `created_at`
- `is_deleted`

第一期建议不保存原始音频，只保存 transcript 和 meta，降低隐私风险。

## 7. 测试方案

### 7.1 后端测试

新增测试：

1. `transcribe_interview_audio` mime type 校验。
2. 超过大小限制返回错误。
3. Mimo 返回空文本时返回 422。
4. `/turns/voice` 会调用 `submit_turn(...)`。
5. `/turns/voice` 查询 session 时过滤 `tenant_id` 和 `student_id`。
6. `request_id` 幂等透传。

示例命令：

```powershell
cd "D:\Ai Agent\CareerForge-AI\backend"
$env:PYTHONPATH='.'
python -m pytest tests\test_interview_voice.py -q
```

### 7.2 前端验证

命令：

```powershell
cd "D:\Ai Agent\CareerForge-AI\frontend"
npm run build
npm run lint
```

手动验证：

1. 浏览器允许麦克风权限。
2. 开始录音 5 秒。
3. 停止后上传。
4. 页面显示识别文本。
5. 面试官给出下一题。
6. 报告里能看到语音回答对应的回答内容。

### 7.3 失败场景验证

- 拒绝麦克风权限。
- 上传空音频。
- 上传超过 5MB。
- Mimo key 未配置。
- Mimo 超时。
- 同一 turn 连续点击提交。

预期：

- 前端都有明确提示。
- 后端不会写入半截 turn。
- 面试 session 不会因为语音失败而推进阶段。

## 8. 分阶段实施顺序

### 阶段 A：真正语音输入

1. 加 Mimo 配置。
2. 加 `mimo_voice.py`。
3. 加 `/turns/voice`。
4. 前端加 MediaRecorder。
5. 上传音频并展示 transcript。
6. transcript 进入现有 `submit_turn(...)`。

验收标准：

- 用户可以说话回答。
- 系统能识别并进入现有评分/追问流程。

### 阶段 B：语音播放面试官问题

1. 加 TTS 端点。
2. 当前 turn.question 转语音。
3. 前端播放音频。
4. 用户可开关自动播放。

验收标准：

- 面试官问题能被朗读。
- 朗读文本和屏幕问题一致。

### 阶段 C：体验增强

1. 录音波形。
2. 断句提示。
3. 长回答自动停止。
4. transcript 编辑确认。
5. 语音/文本混合输入。

## 9. 下一个 AI 的执行提示词

请严格按以下提示修改：

```text
你现在要为 CareerForge-AI 的 AI 面试官实现 Mimo v2.5 多模态语音回答能力。

硬性边界：
1. AI 面试官继续走 backend/app/interview 独立 API，不接回 student/agent_runtime.py。
2. Mimo v2.5 只负责音频理解/转写，不能直接评分、追问或结束面试。
3. 转写文本必须进入现有 submit_turn(...)，复用状态机、评分、Harness 和报告。
4. 前端必须用 MediaRecorder 录音，用 authenticatedFetch 上传 multipart/form-data。
5. 后端所有查询必须过滤 tenant_id/student_id，所有非流式响应必须 ok()/error() 信封。

请按顺序完成：
1. 在 core/config.py 和 .env.example 增加 MIMO_API_KEY、MIMO_BASE_URL、MIMO_MULTIMODAL_MODEL、MIMO_VOICE_* 配置。
2. 新增 backend/app/interview/mimo_voice.py，封装音频校验和 Mimo v2.5 多模态转写。
3. 在 backend/app/interview/router_student.py 新增 POST /{session_id}/turns/voice，读取 UploadFile，调用 transcribe_interview_audio，再调用 submit_turn(...)。
4. 为语音端点新增后端测试，mock Mimo 转写，确认 submit_turn 被调用，确认空文本/超大文件/mime 错误会失败。
5. 前端新增或内联 MediaRecorder 录音逻辑，录音完成后用 authenticatedFetch 上传到 /turns/voice。
6. 前端展示 transcript，并用返回的 turn_result 更新现有面试 turns/session 状态。
7. 未实现 TTS 前，页面文案只能写“语音回答”，不要写“完整语音面试”。
8. 运行 backend compile、pytest、frontend build、frontend lint。

完成后报告：
- 修改了哪些文件。
- 哪些验证命令通过。
- Mimo 接口字段是否根据真实文档调整。
- 是否实现 TTS；若没有，明确说明当前是语音回答，不是完整语音面试。
```

