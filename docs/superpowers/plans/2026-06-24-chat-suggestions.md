# AI 简历助手对话建议 + 背景风格调整 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 简历助手增加两项体验改进：(1) 对话背景改为干净白色风格；(2) AI 回复完成后在消息下方展示 2-3 条动态生成的对话建议按钮。

**Architecture:** 纯 CSS 调整背景色 + 复用现有 SSE 流新增 `message.suggestions` 事件。后端在 `message.completed` 后调用轻量级 LLM 生成建议，前端 store 接收并渲染为可点击的 pill 按钮。

**Tech Stack:** React 19 + TypeScript (frontend), FastAPI + SQLAlchemy (backend), SSE 事件流。

---

## File Structure

| 文件 | 职责 |
|------|------|
| `frontend/src/index.css` | 对话背景样式 + 建议按钮样式 |
| `frontend/src/student/chatRuntimeStore.ts` | SSE `message.suggestions` 事件处理，扩展 `RunState` |
| `frontend/src/student/AgentChatView.tsx` | `MessageSuggestions` 子组件，集成到 `AssistantMessage` |
| `backend/app/student/agent_runtime.py` | 回复完成后生成建议并发送 SSE 事件 |
| `CLAUDE.md` | 更新 SSE 事件列表 |

---

## Task 1: 前端 Store — 扩展 RunState 并处理 message.suggestions 事件

**Files:**
- Modify: `frontend/src/student/chatRuntimeStore.ts`

- [ ] **Step 1: 扩展 RunState 类型，新增 messageSuggestions Map**

在 `RunState` 类型定义（约第 153 行）的 `error` 字段下方新增：

```typescript
  // 对话建议：message_id -> suggestions
  messageSuggestions: Map<number, string[]>
```

- [ ] **Step 2: 在 createEmptyState 中初始化 messageSuggestions**

在 `createEmptyState` 方法（约第 310 行）的 `error: null` 下方新增：

```typescript
      messageSuggestions: new Map(),
```

- [ ] **Step 3: 在 handleStreamEvent 中新增 message.suggestions 分支**

在 `handleStreamEvent` 方法中，在 `message.completed` 处理分支（约第 786 行）之后、`attachment.created` 分支之前，插入：

```typescript
    if (event === 'message.suggestions') {
      const messageId = Number(data.message_id)
      const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
      this.updateState(sessionId, (s) => {
        const newMap = new Map(s.messageSuggestions)
        newMap.set(messageId, suggestions)
        return { ...s, messageSuggestions: newMap }
      })
      return
    }
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/student/chatRuntimeStore.ts
git commit -m "feat: store 层支持 message.suggestions SSE 事件"
```

---

## Task 2: 前端组件 — 新增 MessageSuggestions 组件并集成到 AssistantMessage

**Files:**
- Modify: `frontend/src/student/AgentChatView.tsx`

- [ ] **Step 1: 导入 IconArrowRight**

在文件顶部的 icon 导入区域（约第 2-32 行），在 `IconAttachment` 和 `IconBook` 之间插入：

```typescript
  IconArrowRight,
```

- [ ] **Step 2: 新增 MessageSuggestions 子组件**

在 `GeneratedFileLinks` 组件（约第 924 行）之后、`AssistantMessage` 组件（约第 953 行）之前，插入：

```typescript
function MessageSuggestions({
  suggestions,
  onSuggestionClick,
}: {
  suggestions: string[]
  onSuggestionClick: (text: string) => void
}) {
  if (!suggestions.length) return null
  return (
    <div className="message-suggestions">
      {suggestions.map((text, i) => (
        <button
          key={i}
          type="button"
          className="message-suggestion-chip"
          onClick={() => onSuggestionClick(text)}
        >
          <span>{text}</span>
          <IconArrowRight />
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: 扩展 AssistantMessage 的 props，接收 suggestions 和 onSuggestionClick**

修改 `AssistantMessage` 组件的 props 定义（约第 953-965 行），在 `stepsPlan` 参数之后新增：

```typescript
  suggestions?: string[]
  onSuggestionClick?: (text: string) => void
```

并在解构赋值中同步添加：

```typescript
  suggestions, onSuggestionClick,
```

- [ ] **Step 4: 在 AssistantMessage 渲染中集成 MessageSuggestions**

在 `AssistantMessage` 的 JSX 中，在 `GeneratedFileLinks` 组件（约第 1008-1009 行）之后、`RuntimeStatusline` 条件渲染（约第 1010 行）之前，插入：

```typescript
        {!pending && suggestions && suggestions.length > 0 && onSuggestionClick && (
          <MessageSuggestions suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
        )}
```

- [ ] **Step 5: 在 AgentChatView 主组件中管理 suggestions state**

在 `SavedSessionState` 类型（约第 1067 行）中，在 `stepsPlan` 字段下方新增：

```typescript
  messageSuggestions: Record<number, string[]>
```

在 `AgentChatView` 主组件的 state 声明区域（约第 1100-1138 行），在 `const [stepsPlan, setStepsPlan] = useState<{ steps: string[] } | null>(null)` 之后新增：

```typescript
  const [messageSuggestions, setMessageSuggestions] = useState<Record<number, string[]>>({})
```

- [ ] **Step 6: 在 store sync useEffect 中同步 suggestions**

在 `// Sync store events → component state` 的 useEffect 中（约第 1741 行），在 `// Sync steps plan` 代码块之后、`// Sync runtime info` 代码块之前，插入：

```typescript
    // Sync message suggestions
    if (storeState.messageSuggestions.size > 0) {
      setMessageSuggestions((prev) => {
        const merged = { ...prev }
        for (const [msgId, suggs] of storeState.messageSuggestions) {
          merged[msgId] = suggs
        }
        return merged
      })
    }
```

- [ ] **Step 7: 在缓存保存/恢复中处理 suggestions**

在 `loadTrigger` useEffect 的缓存保存区域（约第 1218 行），在 `stepsPlan,` 之后添加：

```typescript
        messageSuggestions,
```

在缓存恢复区域（约第 1248 行），在 `setStepsPlan(cached.stepsPlan ?? null)` 之后添加：

```typescript
      setMessageSuggestions(cached.messageSuggestions)
```

在 `newChatTrigger` useEffect 的缓存保存区域（约第 1326 行），在 `stepsPlan,` 之后添加：

```typescript
      messageSuggestions,
```

在重置区域（约第 1338 行），在 `setStepsPlan(null)` 之后添加：

```typescript
    setMessageSuggestions({})
```

- [ ] **Step 8: 在消息渲染时传递 suggestions 和 onSuggestionClick**

在消息列表渲染区域（约第 2012-2024 行），修改 `AssistantMessage` 的调用，在 `stepsPlan={...}` 之后新增：

```typescript
              suggestions={messageSuggestions[message.id]}
              onSuggestionClick={(text) => void submitMessage(text)}
```

在流式占位 `AssistantMessage` 调用（约第 2028-2038 行），在 `stepsPlan={stepsPlan}` 之后新增：

```typescript
              suggestions={undefined}
              onSuggestionClick={undefined}
```

- [ ] **Step 9: Commit**

```bash
git add frontend/src/student/AgentChatView.tsx
git commit -m "feat: 新增 MessageSuggestions 组件并集成到 AssistantMessage"
```

---

## Task 3: 前端样式 — 调整对话背景 + 新增建议按钮样式

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: 修改 .agent-thread 背景色**

找到 `.agent-thread` 定义（约第 1158 行），将：

```css
.agent-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 32px 28px 24px;
  scroll-behavior: smooth;
}
```

改为：

```css
.agent-thread {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 20px;
  scroll-behavior: smooth;
  background: #ffffff;
}
```

- [ ] **Step 2: 修改用户消息气泡样式**

找到 `.message-bubble.user` 定义（约第 2450 行），将：

```css
.message-bubble.user {
  width: fit-content;
  max-width: min(620px, 100%);
  background: #ffffff;
  color: #1d2538;
  border: 1px solid #e5e6eb;
  border-radius: 14px;
  padding: 12px 16px;
  font-size: 14.5px;
  line-height: 1.7;
}
```

改为：

```css
.message-bubble.user {
  width: fit-content;
  max-width: min(620px, 100%);
  background: #f2f3f5;
  color: #1d2538;
  border: none;
  border-radius: 14px;
  padding: 12px 16px;
  font-size: 14.5px;
  line-height: 1.7;
}
```

- [ ] **Step 3: 新增建议按钮样式**

在文件末尾（或 `.composer-bottom` 附近，约第 3270 行之后），插入：

```css
/* ── Message suggestions ───────────────────────────────────────── */

.message-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-left: 38px;
}

.message-suggestion-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #f9fafb;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.message-suggestion-chip:hover {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.message-suggestion-chip svg {
  font-size: 12px;
  opacity: 0.6;
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: 对话背景改为白色 + 新增建议按钮样式"
```

---

## Task 4: 后端 — 在 agent_runtime.py 中生成并发送对话建议

**Files:**
- Modify: `backend/app/student/agent_runtime.py`

- [ ] **Step 1: 在 stream_master_reply 中 message.completed 后生成建议**

找到 `stream_master_reply` 函数中发送 `message.completed` 和 `done` 的位置（约第 1088 行）。在 `yield dumps_event("message.completed", ...)` 之后、`yield dumps_event("done", ...)` 之前，插入建议生成逻辑：

```python
    # ── 生成对话建议（轻量级，不影响主回复流）──
    try:
        suggestions = await _generate_chat_suggestions(
            db, identity, session, user_message, assistant_message, model,
            request_id=req_id,
        )
        if suggestions:
            yield dumps_event("message.suggestions", {
                "message_id": assistant_message.id,
                "suggestions": suggestions,
            })
    except Exception:
        logger.exception("生成对话建议失败", extra=_log_ctx(request_id=req_id, session_id=session.id))
        # 静默失败，不影响主流程
```

- [ ] **Step 2: 在文件末尾（或合适位置）新增 _generate_chat_suggestions 函数**

在文件中找一个合适的位置（例如在 `_configured_fallback_answer` 函数附近，或在文件末尾），添加：

```python
async def _generate_chat_suggestions(
    db: Session,
    identity: AuthIdentity,
    session: StudentAgentSession,
    user_message: StudentAgentMessage,
    assistant_message: StudentAgentMessage,
    model: ModelConfig,
    request_id: str = "",
) -> list[str]:
    """基于最近对话生成 2-3 条继续对话的建议。"""
    # 只给简历助手生成建议
    agent_type = getattr(session, "agent_type", "resume") or "resume"
    if agent_type != "resume":
        return []

    # 获取最近 3 轮对话作为上下文
    from sqlalchemy import select
    recent_messages = db.scalars(
        select(StudentAgentMessage)
        .where(StudentAgentMessage.session_id == session.id)
        .order_by(StudentAgentMessage.id.desc())
        .limit(6)
    ).all()
    recent_messages = list(reversed(recent_messages))

    context_lines = []
    for msg in recent_messages:
        role_label = "用户" if msg.role == "user" else "AI"
        content = (msg.content or "").strip()
        if content:
            context_lines.append(f"{role_label}: {content[:300]}")
    context = "\n".join(context_lines)

    if not context:
        return []

    prompt = (
        "基于以下对话，生成 2-3 条简短的中文对话建议，帮助用户继续与 AI 简历助手对话。\n"
        "建议应该具体、可操作，每条不超过 15 个字。\n"
        "只输出建议列表，不要其他内容。\n\n"
        f"对话上下文：\n{context}\n\n"
        "输出格式（JSON）：\n"
        '{"suggestions": ["建议1", "建议2", "建议3"]}'
    )

    try:
        response = await _call_llm_for_suggestions(model, prompt, request_id=request_id)
        if not response:
            return []
        data = json.loads(response)
        suggestions = data.get("suggestions", [])
        if isinstance(suggestions, list) and suggestions:
            # 过滤空字符串，限制 3 条，每条不超过 20 字
            return [
                str(s).strip()[:20]
                for s in suggestions
                if str(s).strip()
            ][:3]
    except Exception:
        logger.exception("解析建议失败", extra=_log_ctx(request_id=request_id, session_id=session.id))
    return []


async def _call_llm_for_suggestions(
    model: ModelConfig,
    prompt: str,
    request_id: str = "",
) -> str:
    """调用轻量级 LLM 生成建议。使用低 temperature 保证稳定性。"""
    from app.core.llm_client import LLMClient

    client = LLMClient()
    messages = [{"role": "user", "content": prompt}]

    # 使用低 temperature，限制 max_tokens 避免浪费
    response = await client.chat_completion(
        model_config=model,
        messages=messages,
        temperature=0.3,
        max_tokens=256,
        request_id=request_id,
    )

    if not response or not response.choices:
        return ""
    content = response.choices[0].message.content or ""
    return content.strip()
```

> **注意：** 需要确认 `LLMClient.chat_completion` 的签名是否支持 `temperature` 和 `max_tokens` 参数。如果不支持，需要调整调用方式。

- [ ] **Step 3: Commit**

```bash
git add backend/app/student/agent_runtime.py
git commit -m "feat: AI 回复完成后动态生成对话建议并推送 SSE"
```

---

## Task 5: 文档 — 更新 CLAUDE.md 的 SSE 事件列表

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 在 SSE 事件列表中新增 message.suggestions**

找到 CLAUDE.md 中的 SSE 事件列表（约第 109 行），在现有事件列表末尾添加 `message.suggestions`：

将：
```
SSE 事件名：`message.saved` / `activity.started|completed|failed` / `message.delta` / `message.snapshot` / `message.completed` / `done` / `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.steps_plan`（AI 动手前的步骤进度预告，意图驱动） / `runtime.completed`。
```

改为：
```
SSE 事件名：`message.saved` / `activity.started|completed|failed` / `message.delta` / `message.snapshot` / `message.completed` / `message.suggestions`（AI 回复完成后推送的 2-3 条继续对话建议） / `done` / `attachment.created` / `runtime.status` / `runtime.heartbeat` / `runtime.steps_plan`（AI 动手前的步骤进度预告，意图驱动） / `runtime.completed`。
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 SSE 事件列表，新增 message.suggestions"
```

---

## Task 6: 验证

- [ ] **Step 1: 前端构建**

```bash
cd /Users/wsr/agent/zhipei-agent-platform/frontend
npm run build
npm run lint
```

Expected: 全绿，无类型错误。

- [ ] **Step 2: 后端检查**

```bash
cd /Users/wsr/agent/zhipei-agent-platform/backend
source .venv/bin/activate
alembic heads
```

Expected: 只有一个 head（本改动无 schema 变更）。

- [ ] **Step 3: 功能验证（手动）**

1. 启动前后端：`cd backend && uvicorn app.main:app --reload` + `cd frontend && npm run dev`
2. 打开 AI 简历助手，确认对话背景为干净白色
3. 发送消息，等待 AI 回复完成
4. 确认消息下方出现 2-3 个建议按钮
5. 点击建议按钮，确认自动发送对应文案
6. 切换到 AI 面试官，确认背景和建议功能均不受影响

- [ ] **Step 4: Commit 最终验证结果**

```bash
git add -A
git commit -m "feat: AI 简历助手对话建议 + 白色背景风格调整"
```

---

## Spec Coverage Check

| 需求 | 对应 Task |
|------|-----------|
| 对话背景改为白色 | Task 3 Step 1 |
| 用户气泡改为浅灰 | Task 3 Step 2 |
| 新增 message.suggestions SSE 事件 | Task 1, Task 4 |
| 前端渲染建议按钮 | Task 2 |
| 点击建议自动发送 | Task 2 Step 8 |
| 仅简历助手生效 | Task 4 Step 2 (agent_type 检查) |
| 生成失败静默处理 | Task 4 Step 1 (try/except) |
| CLAUDE.md 文档更新 | Task 5 |

---

## Placeholder Scan

- 无 "TBD" / "TODO" / "implement later"
- 所有代码块包含完整实现
- 所有文件路径精确
- 类型名称前后一致（`messageSuggestions` / `MessageSuggestions`）
