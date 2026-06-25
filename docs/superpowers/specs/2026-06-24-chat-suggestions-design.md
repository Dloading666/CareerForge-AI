# 设计文档：AI 简历助手对话建议 + 背景风格调整

## 日期：2026-06-24

---

## 1. 需求概述

### 1.1 目标

为 AI 简历助手（AgentChatView，agentType="resume"）增加两项体验改进：

1. **对话背景风格调整**：将对话区域的背景从当前的微紫色调（#faf8ff）改为更简洁的浅色风格，类似现代聊天应用的干净白色背景。
2. **AI 动态生成对话建议**：每次 AI 回复完成后，在消息下方展示 2-3 条个性化对话建议按钮，方便用户继续对话。

### 1.2 范围

- **影响范围**：仅 AI 简历助手（`/student` 路由下的 AgentChatView），不影响 AI 面试官。
- **不涉及**：后端数据库 schema 变更、新的 API 端点（复用现有 SSE 流）。

---

## 2. 对话背景风格调整

### 2.1 现状

当前 `.agent-thread` 背景色为 `#faf8ff`（微紫色），`body` 背景也是 `#faf8ff` 带渐变纹理。

### 2.2 改动方案

**纯 CSS 调整，不涉及任何逻辑代码。**

| 元素 | 当前值 | 新值 | 说明 |
|------|--------|------|------|
| `.agent-thread` background | `#faf8ff` | `#ffffff` | 对话区域改为纯白色 |
| `.agent-thread` padding | `32px 28px 24px` | `24px 20px` | 适当缩小内边距，更紧凑 |
| `.message-bubble.user` background | `#ffffff` | `#f2f3f5` | 用户气泡改为浅灰，与白色背景区分 |
| `.message-bubble.user` border | `1px solid #e5e6eb` | `none` | 去掉边框，更干净 |
| `.assistant-message` 整体 | 现有样式 | 微调间距 | 让 AI 回复更突出 |

### 2.3 视觉目标

- 整体背景：干净白色，无多余纹理
- 用户消息：浅灰色圆角气泡，右对齐
- AI 消息：白色/透明背景，左对齐，突出内容
- 整体感觉：类似截图中的简洁现代聊天界面

---

## 3. 对话建议功能

### 3.1 交互流程

```
用户发送消息 → AI 流式回复 → message.completed → 后端生成建议 → 
message.suggestions SSE 事件 → 前端展示建议按钮 → 用户点击 → 自动发送
```

### 3.2 后端设计

#### 3.2.1 SSE 事件扩展

新增事件名：`message.suggestions`

事件数据结构：
```json
{
  "event": "message.suggestions",
  "data": {
    "message_id": 123,
    "suggestions": [
      "帮我优化一下简历中的项目描述",
      "根据这个岗位JD，我的匹配度如何？",
      "我想生成一份PDF简历"
    ]
  }
}
```

#### 3.2.2 生成时机

在 `message.completed` 事件发送之后，立即生成建议并发送 `message.suggestions` 事件。

#### 3.2.3 生成逻辑

在后端 `agent_runtime.py` 中，AI 回复完成后：

1. 获取当前对话上下文（最近 3 轮对话）
2. 调用轻量级模型（复用当前会话模型，但使用低 temperature）生成 2-3 条建议
3. 建议内容需符合简历助手场景，例如：
   - 简历优化相关（"帮我润色一下项目经历"）
   - 岗位匹配相关（"分析我的简历和这个岗位的匹配度"）
   - 功能操作相关（"导出 PDF 简历"、"查看我的简历"）
4. 将建议通过 SSE 发送给前端

**Prompt 模板（后端）：**
```
基于以下对话，生成 2-3 条简短的中文对话建议，帮助用户继续与 AI 简历助手对话。
建议应该具体、可操作，每条不超过 15 个字。
只输出建议列表，不要其他内容。

对话上下文：
{recent_messages}

输出格式（JSON）：
{"suggestions": ["建议1", "建议2", "建议3"]}
```

### 3.3 前端设计

#### 3.3.1 Store 层（chatRuntimeStore.ts）

1. **AgentMessage 类型扩展**：
   ```typescript
   type AgentMessage = {
     // ... 现有字段
     suggestions?: string[]  // 新增：建议列表
   }
   ```

2. **新增 SSE 事件处理**：在 `handleStreamEvent` 中增加对 `message.suggestions` 的分支：
   ```typescript
   if (event === 'message.suggestions') {
     const messageId = Number(data.message_id)
     const suggestions = Array.isArray(data.suggestions) ? data.suggestions : []
     // 将建议关联到对应的消息上
     this.updateState(sessionId, (s) => ({
       ...s,
       // suggestions 存储在消息级别，通过 message_id 关联
     }))
   }
   ```

3. **RunState 扩展**：
   ```typescript
   export type RunState = {
     // ... 现有字段
     messageSuggestions: Map<number, string[]>  // message_id -> suggestions
   }
   ```

#### 3.3.2 组件层（AgentChatView.tsx）

1. **新增 MessageSuggestions 组件**：
   ```typescript
   function MessageSuggestions({
     suggestions,
     onSuggestionClick,
   }: {
     suggestions: string[]
     onSuggestionClick: (text: string) => void
   }) {
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

2. **AssistantMessage 组件集成**：在 `AssistantMessage` 中，当消息非 pending 状态且有 suggestions 时，在消息内容下方渲染 `MessageSuggestions`。

3. **点击交互**：点击建议按钮时，调用 `submitMessage(text)` 直接发送该文案。

#### 3.3.3 样式（index.css）

新增样式：
```css
.message-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
  padding-left: 38px; /* 与 AI 消息对齐 */
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

### 3.4 数据流

```
后端 agent_runtime.py
  → 发送 message.completed
  → 生成 suggestions
  → 发送 message.suggestions (SSE)

前端 chatRuntimeStore.ts
  → handleStreamEvent 接收 message.suggestions
  → 存储到 RunState.messageSuggestions
  → notify() 触发组件更新

前端 AgentChatView.tsx
  → storeTick 变化，同步 state
  → AssistantMessage 获取 suggestions
  → 渲染 MessageSuggestions 组件
  → 用户点击 → submitMessage(text)
```

---

## 4. 文件改动清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `frontend/src/index.css` | 修改 + 新增 | 背景样式调整 + 建议按钮样式 |
| `frontend/src/student/chatRuntimeStore.ts` | 修改 | 新增 message.suggestions 事件处理 |
| `frontend/src/student/AgentChatView.tsx` | 修改 | 新增 MessageSuggestions 组件，集成到 AssistantMessage |
| `backend/app/student/agent_runtime.py` | 修改 | 在回复完成后生成并发送 suggestions |
| `CLAUDE.md` | 修改 | 更新 SSE 事件列表（如存在） |

---

## 5. 边界情况

| 场景 | 处理方案 |
|------|----------|
| 建议生成失败 | 静默失败，不展示建议区域，不影响主流程 |
| 建议数量不足 2 条 | 前端只展示实际返回的数量（1 条或 0 条） |
| 用户快速发送新消息 | 新消息会打断当前流，建议随旧消息的 completed 事件一起被清理 |
| 历史消息加载 | 历史消息没有 suggestions，只在新对话中展示 |
| 断线重连 | 建议随 message.completed 一起被缓存/恢复 |

---

## 6. 验证标准

1. **前端构建**：`npm run build && npm run lint` 全绿
2. **后端迁移**：`alembic heads` 只有一个 head（本改动无 schema 变更）
3. **功能验证**：
   - 打开 AI 简历助手，背景为干净白色
   - 发送消息，AI 回复完成后下方出现 2-3 个建议按钮
   - 点击建议按钮，自动发送对应文案
   - 建议按钮样式正确，hover 效果正常
4. **兼容性**：面试官页面不受影响

---

## 7. 风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| 后端生成建议增加延迟 | 低 | 建议生成是异步的，在 message.completed 后发送，不影响主回复流 |
| 建议内容不相关 | 中 | 通过 prompt 工程和上下文限制，确保建议贴合简历场景 |
| 前端样式影响其他页面 | 低 | CSS 改动使用特定 class 选择器，不影响其他组件 |
