# AI 面试官模型选择、语音对话、流式输出与房间 UI 强制修改提示词

> 本文件用于交给下一个 AI 编程助手直接执行修改。  
> 目标：修复 CareerForge-AI 的 AI 面试官在模型选择、语音能力、流式输出、房间操作区、即时消息展示、必填校验和表单交互上的问题。

---

## 0. 任务边界

你不是来重新设计一套 AI 面试官。  
你必须在当前项目已有代码上修改，并保持现有 Harness、面试流程、鉴权、数据库隔离不被破坏。

必须优先阅读：

- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/shared/api.ts`
- `frontend/src/index.css`
- `backend/app/interview/router_student.py`
- `backend/app/interview/service.py`
- `backend/app/interview/schemas.py`
- `backend/app/interview/harness.py`
- `backend/app/interview/models.py`
- `backend/app/student/router.py`
- `backend/app/student/agent_runtime.py`
- `backend/app/admin/models.py`
- `backend/app/admin/model_service.py`
- `backend/app/admin/schemas.py`

---

## 1. 强制禁止

1. 禁止只输出建议，必须修改代码。
2. 禁止绕过现有 `submit_turn` / Harness / DB 流程。
3. 禁止让模型输出未经 Harness 校验就展示或入库。
4. 禁止把当前浏览器 `SpeechRecognition` 伪装成“多模态语音面试”。
5. 禁止在没有服务端 ASR、音频上传、TTS 的情况下声称“语音对话已实现”。
6. 禁止只修前端，不排查后端模型列表为空问题。
7. 禁止为了让模型列表显示而放宽到未配置 API Key 或未对学生开放的模型。
8. 禁止把“目标岗位”和“岗位 JD”继续做成可空字段。
9. 禁止让用户发送回答后必须等大模型完成才看到自己的消息。
10. 禁止伪造流式输出。若后端没有流式能力，必须实现真实 SSE 或 fetch streaming；否则明确标记未完成。

---

## 2. 当前必须确认的事实

当前代码里：

- AI 面试官前端仍在使用 `SpeechRecognition/webkitSpeechRecognition` 做浏览器语音转文字。
- 没有看到 `/api/v1/student/interviews/{session_id}/turns/voice` 服务端音频上传接口。
- 没有看到服务端 ASR。
- 没有看到 TTS 面试官语音回复。
- 没有看到真正的大模型流式追问输出。
- 前端模型列表从 `/api/v1/student/master/models` 获取。
- 管理端模型字段是 `ModelConfig.open_to_student`。
- 管理端模型能力字段是 `ModelConfig.capability`。
- 管理端 API Key 字段是 `ModelConfig.api_key_cipher`。

如果你发现代码已经和上述事实不同，必须以实际代码为准，并在最终回复中说明差异。

---

## 3. 第一优先级：排查并修复模型列表为空

用户现象：

```text
请先选择一个可用模型。若列表为空，请管理员在模型广场开启「对学生开放」。
服务返回了不可识别的内容
```

用户已经在管理端设置了模型，因此必须排查是否因为字段、筛选条件、接口响应或错误处理导致学生端模型列表为空。

### 3.1 必须排查的链路

必须检查：

1. 管理端模型表 `ModelConfig` 字段：
   - `open_to_student`
   - `capability`
   - `status`
   - `api_key_cipher`
   - `is_deleted`
2. 管理端开关是否写入 `open_to_student`。
3. 学生端 `/api/v1/student/master/models` 是否筛选了过窄的 capability。
4. AI 面试官是否需要支持 `chat` 和 `multimodal` 两类模型。
5. 如果用户选择的是多模态模型，不能因为 `capability != "chat"` 被过滤掉。
6. 是否错误要求模型必须是 `chat`，导致多模态模型不显示。
7. 是否要求 `api_key_cipher` 非空。
8. 如果 API Key 未配置，应该给出明确错误，而不是“服务返回了不可识别的内容”。
9. `apiRequest` 是否因为后端返回非 JSON HTML/500 错误而提示“不可识别”。
10. 后端异常是否被统一 JSON envelope 包装。

### 3.2 学生端模型列表规则

AI 面试官可用模型必须满足：

```text
open_to_student == True
is_deleted == False
status 可用或未禁用
api_key_cipher 非空
capability in ["chat", "multimodal"]
```

如果当前系统使用其他 capability 命名，必须兼容已有命名，不允许写死只支持一个值。

必须返回字段：

```json
{
  "id": 1,
  "display_name": "xxx",
  "provider": "openai",
  "model_identifier": "xxx",
  "capability": "multimodal"
}
```

前端 `AgentModelOption` 必须补上：

```ts
capability?: string
```

### 3.3 错误提示要求

如果模型列表为空，前端必须区分原因：

1. 没有任何对学生开放模型：

```text
暂无对学生开放的模型，请管理员在模型广场开启“对学生开放”。
```

2. 有开放模型但没有 API Key：

```text
模型已开放，但未配置 API Key，请管理员在模型广场补全配置。
```

3. 有模型但 capability 不支持面试官：

```text
当前开放模型不支持 AI 面试官，请开启 chat 或 multimodal 模型。
```

4. 后端返回非 JSON：

```text
模型服务接口异常，请检查后端日志和 /api/v1/student/master/models 响应。
```

不得继续只显示：

```text
服务返回了不可识别的内容
```

### 3.4 必须新增测试

后端必须补测试，覆盖：

1. `open_to_student=True`、`capability="chat"`、有 API Key，模型出现在学生端列表。
2. `open_to_student=True`、`capability="multimodal"`、有 API Key，模型出现在学生端列表。
3. `open_to_student=False` 不出现。
4. 没有 API Key 不作为可用模型，或返回明确不可用原因。
5. 接口返回必须是统一 JSON envelope，不能返回 HTML/traceback。

---

## 4. 第二优先级：明确语音对话/多模态是否实现

用户问题：

```text
我目前用的模型具有多模态的功能，语音对话功能也实现了吗？
```

当前判断：

```text
没有实现真正语音对话。
当前只是浏览器语音输入辅助。
```

### 4.1 必须在产品和代码中明确区分

如果本轮不实现服务端语音闭环，前端只能显示：

```text
语音输入辅助
```

不得显示：

```text
语音面试已上线
多模态语音面试
AI 语音对话
实时通话面试
```

### 4.2 如果要实现真正语音对话，必须完成以下接口

新增后端接口：

```text
POST /api/v1/student/interviews/{session_id}/turns/voice
```

请求：

```text
multipart/form-data
audio: File
turn_id: int
request_id: string
duration_ms?: int
mime_type?: string
```

处理流程必须是：

```text
前端 MediaRecorder 录音
        ↓
上传后端 /turns/voice
        ↓
服务端 ASR 或多模态音频转写
        ↓
得到 transcript
        ↓
调用同一套 submit_turn(...)
        ↓
走同一套 Harness 校验
        ↓
生成 next_turn
```

禁止语音接口单独写一套面试逻辑。

### 4.3 多模态模型使用规则

如果模型 `capability == "multimodal"`，可以优先用于音频转写或音频理解。  
但必须检测模型是否真的支持音频输入。

新增函数建议：

```python
def model_supports_audio(model: ModelConfig) -> bool:
    haystack = f"{model.provider} {model.model_identifier} {model.protocols} {model.capability}".lower()
    return model.capability == "multimodal" and any(
        token in haystack for token in ["audio", "realtime", "voice", "omni", "gpt-4o", "gemini"]
    )
```

如果模型只是图文多模态，不支持音频，不得强行调用音频接口。

### 4.4 音频安全要求

必须限制：

```text
最大文件大小：15MB
最大音频时长：120 秒
允许格式：audio/webm, audio/wav, audio/mpeg, audio/mp4
```

转写失败时不得写入当前 turn。

### 4.5 TTS 回复

如果要实现“对话”，还需要：

```text
POST /api/v1/student/interviews/{session_id}/turns/{turn_id}/voice/reply
```

要求：

1. 只能读取 DB 中已经通过 Harness 保存的 `turn.question`。
2. 不能重新调用面试生成模型。
3. 不能改写问题文本。
4. TTS 失败时前端仍显示文字问题。

---

## 5. 第三优先级：实现大模型流式输出

用户要求：

```text
大模型输出回答问题一定要是流式输出。
```

### 5.1 需要明确的技术现实

当前 AI 面试官的追问生成是：

```text
submit answer
        ↓
后端调用 LLM 生成完整 JSON
        ↓
Harness 校验 JSON
        ↓
写 DB
        ↓
前端一次性展示 next_turn
```

因为 Harness 必须校验完整 JSON，所以不能把未校验的模型 token 直接当正式问题展示。

### 5.2 正确流式方案

必须实现“两层流式”：

#### 第一层：状态流

用 SSE 或 fetch streaming 输出状态：

```text
已收到你的回答
正在检索题库
正在评估回答质量
正在组织追问
Harness 正在校验
正在保存下一轮问题
```

这些状态可以即时流式展示。

#### 第二层：问题文本流

只有在 Harness 校验通过后，才允许把最终 `next_question` 以打字机效果流式展示到 UI。  
不允许展示未经 Harness 校验的模型原始 token。

### 5.3 后端接口建议

新增接口：

```text
POST /api/v1/student/interviews/{session_id}/turns/stream
```

返回：

```text
text/event-stream
```

事件类型：

```text
event: user_answer_saved
event: retrieval_started
event: assessment_started
event: harness_validation_started
event: next_question_ready
event: completed
event: error
```

`next_question_ready` 的 data 必须来自已经通过 Harness 并写入 DB 的 `next_turn`。

如果暂时不做后端 SSE，也必须在前端实现发送后立即显示用户消息和阶段进度，但不能声称已经实现大模型 token 流式输出。

---

## 6. 第四优先级：发送消息后立即显示我的回答

当前问题：

用户点击提交后，要等大模型回答完，才看到自己的回答气泡。

必须修改：

- `frontend/src/student/AIInterviewerPage.tsx`

### 6.1 乐观消息展示

点击提交后必须立即在对话区展示用户回答气泡。

实现方式：

1. 在前端维护 `optimisticAnswerByTurnId` 或临时 turn 状态。
2. 用户点击提交后，立即把当前 `answer` 显示在对应 pending turn 下。
3. 后端返回 `current_turn` 后，用真实数据替换乐观数据。
4. 如果提交失败，显示错误状态，并允许“再试一次”。

### 6.2 用户气泡视觉

用户回答气泡颜色需要接近飞书聊天风格：

```text
背景：#E8F3FF 或 #DDEBFF
文字：#1F2329
边框：#B7D4FF
布局：右侧对齐
圆角：8px
最大宽度：70%
```

不要使用过度花哨渐变。

---

## 7. 第五优先级：房间操作区改造

用户要求：

```text
进入房间之后不要顶部“设置”按钮。
改成“再试一次”，放在整个房间右下角，和提交答案按钮放一起。
点击之后重新弹出设置信息。
结束并生成报告也放下来。
四个按钮：两个在上面，两个在下面。
```

### 7.1 移除顶部按钮

进入房间后，顶部 header 不再显示：

```text
设置
结束并生成报告
```

从 `.interview-room-header` 删除这两个操作按钮。

### 7.2 底部操作区布局

在回答输入框右侧或下方建立固定操作区：

```text
第一行：
[提交回答] [语音输入辅助]

第二行：
[再试一次] [结束并生成报告]
```

要求：

1. `提交回答`：提交当前答案。
2. `语音输入辅助`：当前仍是浏览器语音输入，未做服务端语音时必须这样命名。
3. `再试一次`：点击后重新展开左侧设置面板或设置抽屉。
4. `结束并生成报告`：触发 `loadReport()`。

### 7.3 “再试一次”的含义

`再试一次` 不是重新提交当前答案。  
它的含义是：

```text
重新打开设置，让用户可以调整模型、面试类型、岗位信息后重新开始一场面试。
```

如果当前已有 active session，用户点击“再试一次”后：

1. 展开设置面板。
2. 显示“重新开始一场”按钮。
3. 不要自动清空当前会话，除非用户点击“重新开始一场”。

---

## 8. 第六优先级：目标岗位和岗位 JD 强制填写

用户要求：

```text
目标岗位、岗位 JD、必须强制填写。
```

### 8.1 前端校验

在 `startInterview` 中必须校验：

```ts
if (!targetRole.trim()) {
  Message.warning('请填写目标岗位')
  return
}

if (!jobDescription.trim()) {
  Message.warning('请填写岗位 JD')
  return
}
```

开始按钮在二者为空时可以 disabled，但仍必须保留点击校验提示。

### 8.2 后端校验

`InterviewStartRequest` 中：

```python
target_role: str = Field(min_length=1, max_length=128)
job_description: str = Field(min_length=1)
```

`start_interview(...)` 中也必须二次校验：

```python
if not payload.job_description.strip():
    raise HTTPException(status_code=400, detail="请填写岗位 JD")
```

不允许继续用：

```python
payload.job_description or "未提供"
```

作为正常路径。

---

## 9. 第七优先级：Select 点击区域和文字居中修复

用户问题：

```text
大模型、面试类型、面试风格、面试重点不是点击框就显示，而是点击文字才显示。
点击框里的文字还不是居中。
```

必须修改：

- `frontend/src/student/AIInterviewerPage.tsx`
- `frontend/src/index.css`

### 9.1 点击区域

所有 Select 必须保证点击整个框都能打开：

- 大模型
- 面试类型
- 面试风格
- 面试重点（可多选）

检查是否因为外层 `label`、CSS `pointer-events`、遮罩、布局层级、宽度塌陷导致只有文字可点击。

如果 Arco `Select` 被 `label` 包裹导致点击异常，必须改成：

```tsx
<div className="interview-field">
  <span>大模型</span>
  <Select ... />
</div>
```

不要用 `label` 包裹复杂 Select。

### 9.2 文字居中

统一 Select 高度和内部对齐：

```css
.interview-field .arco-select-view {
  min-height: 40px;
  display: flex;
  align-items: center;
}

.interview-field .arco-select-view-value,
.interview-field .arco-select-view-placeholder {
  display: flex;
  align-items: center;
}
```

如果 Arco 类名不同，必须按实际 DOM 类名调整。

### 9.3 多选框

面试重点多选不能因为 tag 撑高导致布局混乱。  
必须允许换行，但整体看起来稳定。

---

## 10. 第八优先级：API 错误“不可识别内容”修复

当前 `frontend/src/shared/api.ts` 在 `response.json()` 失败时只提示：

```text
服务返回了不可识别的内容
```

这对用户和开发者都不够定位问题。

必须修改：

1. 如果 response 非 JSON，尝试读取 `response.text()` 的前 300 字。
2. 控制台打印：

```ts
console.error('Non-JSON API response', { path, status: response.status, preview })
```

3. 用户提示改为：

```text
服务接口异常，请稍后重试或联系管理员
```

4. 如果是模型列表接口，前端应额外显示：

```text
模型列表加载失败，请检查管理员模型广场配置和后端日志。
```

---

## 11. 测试和验证要求

必须运行：

```powershell
python -m compileall -f backend\app\interview
```

如果修改学生模型接口：

```powershell
$env:PYTHONPATH='backend'; python -m pytest backend\tests -q
```

前端：

```powershell
cd frontend
npm run build
```

如果新增 SSE 或语音接口，必须补后端测试：

- 模型列表包含 chat 和 multimodal。
- 未开放模型不返回。
- 无 API Key 模型不作为可用模型。
- `/turns/stream` 返回 SSE 事件。
- `/turns/voice` 音频格式错误返回 400。
- ASR 失败不写入 answer。

前端必须手动或用浏览器测试确认：

1. 点击整个大模型 Select 框能打开。
2. 点击整个面试类型 Select 框能打开。
3. 点击整个面试风格 Select 框能打开。
4. 点击整个面试重点 Select 框能打开。
5. Select 文本垂直居中。
6. 进入房间后顶部没有“设置”和“结束并生成报告”按钮。
7. 底部操作区四个按钮按两行排列。
8. 点击“再试一次”能重新展开设置面板。
9. 提交回答后立即出现用户气泡。
10. 大模型追问完成后，问题以流式/打字机方式出现。

---

## 12. 最终回复必须说明

完成后最终回复必须包含：

1. 修改了哪些文件。
2. 模型列表为空的根因是什么。
3. 是否已支持 `chat` 和 `multimodal` 模型出现在 AI 面试官模型列表。
4. 当前语音能力到底是哪一级：
   - 浏览器语音输入辅助
   - 服务端 ASR
   - 多模态音频输入
   - TTS 语音回复
5. 是否实现真正流式输出。
6. 如果只是状态流 + 打字机效果，必须明确说明。
7. 目标岗位和岗位 JD 是否已经前后端强制必填。
8. Select 点击区域和居中是否修复。
9. 已运行的测试命令和结果。
10. 未完成事项。

---

## 13. 上线判定

只有满足以下条件，才能说“本轮体验问题已修复”：

1. 模型列表能正确显示对学生开放且有 API Key 的 `chat/multimodal` 模型。
2. 模型列表接口返回统一 JSON，不再导致不可识别内容。
3. 目标岗位和岗位 JD 前后端都必填。
4. 进入房间后顶部操作按钮已移除。
5. 底部四按钮两行布局完成。
6. “再试一次”能重新展开设置。
7. 用户提交后立即显示自己的消息气泡。
8. 用户气泡接近飞书风格。
9. Select 整个框可点击，文字居中。
10. 语音能力命名诚实，不把浏览器语音输入说成语音对话。

只有满足以下条件，才能说“语音对话已实现”：

1. 服务端 `/turns/voice` 已实现。
2. 前端使用 `MediaRecorder` 上传音频。
3. 服务端 ASR 或真正多模态音频理解已实现。
4. 转写结果进入同一套 `submit_turn`。
5. 语音提交有 `turn_id` 和 `request_id`。
6. 音频大小、格式、时长有限制。
7. TTS 回复接口已实现。
8. TTS 只基于 DB 中已保存的 `turn.question`。

如果没有满足以上语音条件，只能说：

```text
已支持语音输入辅助，尚未支持完整语音对话。
```

