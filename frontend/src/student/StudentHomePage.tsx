import { Button, Input, Popconfirm, Select, Tooltip } from '@arco-design/web-react'
import {
  IconApps,
  IconAttachment,
  IconBook,
  IconCaretDown,
  IconCaretRight,
  IconClose,
  IconCloseCircle,
  IconFile,
  IconHistory,
  IconLoading,
  IconNotification,
  IconPlus,
  IconPoweroff,
  IconRobot,
  IconSearch,
  IconSend,
  IconStop,
  IconThunderbolt,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { ApiError, apiRequest } from '../shared/api'
import { AgentPlaza } from './AgentPlaza'
import { useAuth } from '../shared/auth'

// ── Types ──────────────────────────────────────────────────────────────────────

type NavKey = 'agent' | 'plaza' | 'history' | 'profile'

type AgentSession = {
  id: number
  title: string
  status: string
  created_at: string
  updated_at: string
}

type AgentMessage = {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

type AgentActivity = {
  id: number
  session_id: number
  message_id: number | null
  kind: string
  name: string
  status: 'started' | 'completed' | 'failed'
  summary: string | null
  detail: Record<string, unknown>
  started_at: string
  completed_at: string | null
}

type AgentAttachment = {
  id: number
  session_id: number
  message_id: number | null
  original_name: string
  content_type: string
  file_ext: string
  file_size: number
  status: string
  created_at: string
}

type AgentHistory = {
  session: AgentSession
  messages: AgentMessage[]
  activities: AgentActivity[]
  attachments: AgentAttachment[]
}

type AgentModelOption = {
  id: number
  display_name: string
  provider: string
  model_identifier: string
  context_length: number | null
  default_temp: number | null
  max_output: number | null
  timeout_sec: number | null
}

type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

type StreamEvent = {
  event: string
  data: Record<string, unknown>
}

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const suggestions = [
  { title: '帮我模拟一次面试', desc: '沉浸式多回合对话，检验真实水平。' },
  { title: '看看我和某岗位的匹配度', desc: '上传 JD 与简历，智能分析优劣势。' },
  { title: '优化我的简历项目经历', desc: '用更有说服力的结构包装你的真实经历。' },
  { title: '应届生求职常见问题', desc: '秋招节奏、三方协议、网申技巧一网打尽。' },
]

const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function activityKindIcon(kind: string): ReactNode {
  const style = { fontSize: 12 }
  switch (kind) {
    case 'profile': return <IconUser style={style} />
    case 'resume': return <IconFile style={style} />
    case 'file': return <IconAttachment style={style} />
    case 'job': return <IconSearch style={style} />
    case 'knowledge': return <IconBook style={style} />
    case 'subagent': return <IconRobot style={style} />
    case 'skill': return <IconApps style={style} />
    case 'notification': return <IconNotification style={style} />
    case 'context': return <IconHistory style={style} />
    default: return <IconThunderbolt style={style} />
  }
}

function ActivityChip({ activity }: { activity: AgentActivity }) {
  const running = activity.status === 'started'
  const failed = activity.status === 'failed'
  return (
    <span className={`activity-chip${running ? ' running' : ''}${failed ? ' failed' : ''}`}>
      <span className="activity-chip-icon">
        {running
          ? <IconLoading style={{ fontSize: 12 }} />
          : failed
            ? <IconCloseCircle style={{ fontSize: 12 }} />
            : activityKindIcon(activity.kind)}
      </span>
      <span>{activity.summary || activity.name}</span>
    </span>
  )
}

function ActivityBlock({
  activities,
  pending,
}: {
  activities: AgentActivity[]
  pending: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  // Auto-collapse after streaming finishes
  useEffect(() => {
    if (!pending && activities.length > 0 && activities.every((a) => a.status !== 'started')) {
      const timer = window.setTimeout(() => setExpanded(false), 800)
      return () => window.clearTimeout(timer)
    }
  }, [pending, activities])

  if (activities.length === 0) return null

  const completedCount = activities.filter((a) => a.status === 'completed').length
  const failedCount = activities.filter((a) => a.status === 'failed').length
  const runningCount = activities.filter((a) => a.status === 'started').length

  return (
    <div className="activity-block">
      {expanded ? (
        <>
          <button
            type="button"
            className="activity-block-toggle"
            onClick={() => setExpanded(false)}
          >
            <IconCaretDown style={{ fontSize: 11 }} />
            <span>
              {runningCount > 0
                ? `${runningCount} 个工具运行中…`
                : `已调用 ${completedCount} 个工具${failedCount > 0 ? `，${failedCount} 个失败` : ''}`}
            </span>
          </button>
          <div className="activity-chip-list">
            {activities.map((a) => (
              <ActivityChip key={a.id} activity={a} />
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          className="activity-block-toggle collapsed"
          onClick={() => setExpanded(true)}
        >
          <IconCaretRight style={{ fontSize: 11 }} />
          <span>
            已调用 {completedCount} 个工具{failedCount > 0 ? `，${failedCount} 个失败` : ''}
          </span>
        </button>
      )}
    </div>
  )
}

function AssistantMessage({
  message,
  activities,
  pending = false,
}: {
  message: AgentMessage
  activities: AgentActivity[]
  pending?: boolean
}) {
  return (
    <div className="message-row assistant">
      <div className="assistant-message">
        <ActivityBlock activities={activities} pending={pending} />

        {message.content ? (
          <div className="assistant-answer">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            {pending && <span className="stream-cursor" />}
          </div>
        ) : (
          pending && (
            <div className="assistant-thinking">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
          )
        )}
      </div>
    </div>
  )
}

function SessionHistoryPanel({
  sessions,
  currentSessionId,
  onSelect,
}: {
  sessions: AgentSession[]
  currentSessionId: number | null
  onSelect: (session: AgentSession) => void
}) {
  function relativeTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime()
    const m = Math.floor(diff / 60000)
    if (m < 1) return '刚刚'
    if (m < 60) return `${m} 分钟前`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h} 小时前`
    return `${Math.floor(h / 24)} 天前`
  }

  if (sessions.length === 0) {
    return (
      <div className="history-empty">
        <IconHistory style={{ fontSize: 28 }} />
        <p>暂无历史对话</p>
      </div>
    )
  }

  return (
    <div className="history-list">
      {sessions.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`history-item${s.id === currentSessionId ? ' active' : ''}`}
          onClick={() => onSelect(s)}
        >
          <div className="history-item-title">{s.title}</div>
          <div className="history-item-time">{relativeTime(s.updated_at)}</div>
        </button>
      ))}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StudentHomePage() {
  const { session, logout } = useAuth()
  const studentName = (session?.profile.name as string) || '同学'
  const studentEmail = (session?.profile.email as string) || ''

  const [activeNav, setActiveNav] = useState<NavKey>('agent')
  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [allSessions, setAllSessions] = useState<AgentSession[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [inputValue, setInputValue] = useState('')
  const [bootingAgent, setBootingAgent] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)

  const abortRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const optimisticIdRef = useRef(-1)

  const navItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'agent', icon: <IconRobot />, label: '主智能体' },
    { key: 'plaza', icon: <IconApps />, label: '智能体广场' },
    { key: 'history', icon: <IconHistory />, label: '历史对话' },
    { key: 'profile', icon: <IconUser />, label: '个人中心' },
  ]

  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user'),
    [messages],
  )

  const hasAssistantAfterLatestUser = useMemo(() => {
    if (!latestUserMessage) return false
    const idx = messages.findIndex((m) => m.id === latestUserMessage.id)
    return messages.slice(idx + 1).some((m) => m.role === 'assistant')
  }, [latestUserMessage, messages])



  // Auto-scroll
  useEffect(() => {
    const node = threadRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages, activities, streaming])

  const loadHistory = useCallback(async (target: AgentSession) => {
    const history = await apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${target.id}/messages`)
    setAgentSession(history.session)
    setMessages(history.messages)
    setActivities(history.activities)
    setPendingAttachments([])
  }, [])

  const createAgentSession = useCallback(async () => {
    const created = await apiRequest<AgentSession>('/api/v1/student/master/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '新对话' }),
    })
    setAgentSession(created)
    setMessages([])
    setActivities([])
    setPendingAttachments([])
    setAllSessions((prev) => [created, ...prev])
    return created
  }, [])

  // 每次登录（session 对象引用变化）都重新初始化：加载模型 + 创建全新会话
  useEffect(() => {
    if (!session?.access) return
    let alive = true
    const timer = window.setTimeout(async () => {
      setBootingAgent(true)
      setNotice(null)
      // 清空旧对话状态，避免残留上一次登录的数据
      setAgentSession(null)
      setMessages([])
      setActivities([])
      setPendingAttachments([])
      setAllSessions([])
      try {
        // 加载可用模型
        const list = await apiRequest<AgentModelOption[]>('/api/v1/student/master/models')
        if (!alive) return
        setModelOptions(list)
        setSelectedModelId((cur) => {
          if (cur && list.some((m) => m.id === cur)) return cur
          return list[0]?.id ?? null
        })
        if (list.length === 0) {
          setNotice('当前没有可用模型，请管理员先在模型广场开启「对学生开放」。')
        }

        // 拉取历史会话列表
        const sessions = await apiRequest<AgentSession[]>('/api/v1/student/master/sessions')
        if (!alive) return
        setAllSessions(sessions)

        // 始终创建一个新会话作为当前对话，旧会话保留在历史记录中
        const created = await apiRequest<AgentSession>('/api/v1/student/master/sessions', {
          method: 'POST',
          body: JSON.stringify({ title: '新对话' }),
        })
        if (!alive) return
        setAgentSession(created)
        setMessages([])
        setActivities([])
        setPendingAttachments([])
        setAllSessions([created, ...sessions])
      } catch (error) {
        if (alive) {
          setNotice(error instanceof ApiError ? error.message : '主智能体会话初始化失败')
        }
      } finally {
        if (alive) setBootingAgent(false)
      }
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [session])

  const upsertActivity = (activity: AgentActivity) => {
    setActivities((prev) => {
      const idx = prev.findIndex((a) => a.id === activity.id)
      if (idx < 0) return [...prev, activity]
      const next = [...prev]
      next[idx] = activity
      return next
    })
  }

  const appendAssistantDelta = (messageId: number, delta: string, sessionId: number) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId)
      if (idx < 0) {
        return [
          ...prev,
          { id: messageId, session_id: sessionId, role: 'assistant', content: delta, created_at: new Date().toISOString() },
        ]
      }
      const next = [...prev]
      next[idx] = { ...next[idx], content: next[idx].content + delta }
      return next
    })
  }

  const handleStreamEvent = (evt: StreamEvent, optimisticId: number, sessionId: number) => {
    const { event, data } = evt
    if (event === 'message.saved') {
      const messageId = Number(data.message_id)
      setMessages((prev) => prev.map((m) => (m.id === optimisticId ? { ...m, id: messageId } : m)))
      return
    }
    if (event === 'activity.started' || event === 'activity.completed' || event === 'activity.failed') {
      upsertActivity(data as AgentActivity)
      return
    }
    if (event === 'message.delta') {
      appendAssistantDelta(Number(data.message_id), String(data.delta ?? ''), sessionId)
    }
  }

  const submitMessage = async (preset?: string) => {
    const content = (preset ?? inputValue).trim()
    if (!content || streaming) return
    if (!selectedModelId) {
      setNotice('请先选择一个可用模型。若列表为空，请管理员在模型广场开启「对学生开放」。')
      return
    }

    let currentSession = agentSession
    try {
      if (!currentSession) currentSession = await createAgentSession()
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '创建对话失败')
      return
    }

    const optimisticId = optimisticIdRef.current
    optimisticIdRef.current -= 1
    setInputValue('')
    setNotice(null)
    setStreaming(true)
    const sendingAttachments = [...pendingAttachments]
    setPendingAttachments([])
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        session_id: currentSession.id,
        role: 'user',
        content: withAttachmentNames(content, sendingAttachments),
        created_at: new Date().toISOString(),
      },
    ])

    const controller = new AbortController()
    abortRef.current = controller
    try {
      const response = await fetch(
        `${API_BASE_URL}/api/v1/student/master/sessions/${currentSession.id}/messages/stream`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            content,
            model_id: selectedModelId,
            reasoning_effort: reasoningEffort,
            attachment_ids: sendingAttachments.map((a) => a.id),
          }),
          signal: controller.signal,
        },
      )
      if (!response.ok || !response.body) {
        throw new Error(`主智能体响应失败（${response.status}）`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const parsed = parseSseBlock(block)
          if (parsed) handleStreamEvent(parsed, optimisticId, currentSession.id)
        }
      }
      if (buffer.trim()) {
        const parsed = parseSseBlock(buffer)
        if (parsed) handleStreamEvent(parsed, optimisticId, currentSession.id)
      }
      // Update session list title after reply
      setAllSessions((prev) =>
        prev.map((s) => (s.id === currentSession.id ? { ...s, updated_at: new Date().toISOString() } : s)),
      )
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : '主智能体回复失败')
        setPendingAttachments((prev) => [...sendingAttachments, ...prev])
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const handleNewChat = async () => {
    if (streaming) abortRef.current?.abort()
    setNotice(null)
    try {
      await createAgentSession()
      setActiveNav('agent')
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '新建对话失败')
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const handleSelectSession = async (s: AgentSession) => {
    if (streaming) abortRef.current?.abort()
    try {
      await loadHistory(s)
      setActiveNav('agent')
    } catch {
      setNotice('加载历史会话失败')
    }
  }

  const uploadFiles = async (files: File[], currentSession?: AgentSession | null) => {
    if (files.length === 0 || uploadingAttachment) return
    let sess = currentSession ?? agentSession
    try {
      if (!sess) sess = await createAgentSession()
      setUploadingAttachment(true)
      setNotice(null)
      for (const file of files.slice(0, 8)) {
        const form = new FormData()
        form.append('file', file)
        const response = await fetch(
          `${API_BASE_URL}/api/v1/student/master/sessions/${sess.id}/attachments`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session?.access ?? ''}` },
            body: form,
          },
        )
        const payload = await response.json()
        if (!response.ok || payload.code !== 0) {
          throw new Error(payload.msg || payload.detail || `附件上传失败（${response.status}）`)
        }
        setPendingAttachments((prev) => [...prev, payload.data as AgentAttachment])
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '附件上传失败')
    } finally {
      setUploadingAttachment(false)
    }
  }

  const handleFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    await uploadFiles(files)
  }

  const removePendingAttachment = (id: number) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    await uploadFiles(Array.from(event.dataTransfer.files))
  }

  const handleComposerPaste = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    const fileItems = Array.from(event.clipboardData.items).filter((item) => item.kind === 'file')
    if (fileItems.length === 0) return
    event.preventDefault()
    const files = fileItems.map((item) => item.getAsFile()).filter(Boolean) as File[]
    await uploadFiles(files)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragCounterRef.current += 1
    if (event.dataTransfer.types.includes('Files')) {
      setIsDraggingOver(true)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) {
      setIsDraggingOver(false)
    }
  }

  return (
    <div className="app-shell student-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <span className="brand-mark-badge">智</span>
          <div>
            <h1>智培职联</h1>
            <p>学生端</p>
          </div>
        </div>

        <Button type="primary" size="large" icon={<IconPlus />} long onClick={() => void handleNewChat()}>
          新建对话
        </Button>

        <div className="side-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button
              key={key}
              className="side-nav-item"
              type={activeNav === key ? 'primary' : 'text'}
              icon={icon}
              onClick={() => setActiveNav(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="side-nav-footer">
          <div style={{ fontWeight: 600 }}>{studentName}</div>
          <div className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>
            {studentEmail}
          </div>
          <Popconfirm title="确定要退出登录吗？" okText="退出" cancelText="取消" onOk={logout}>
            <Button type="text" size="small" icon={<IconPoweroff />} style={{ paddingLeft: 0, color: '#f53f3f' }}>
              退出登录
            </Button>
          </Popconfirm>
        </div>
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div className="topbar-title">
            <h2>就业助手</h2>
          </div>
        </header>

        {activeNav === 'agent' && (
          <main className="page-content student-chat-page">
            <div ref={threadRef} className="agent-thread">
              {bootingAgent && <div className="agent-system-line">正在连接主智能体会话…</div>}
              {notice && <div className="agent-error-line">{notice}</div>}

              {!bootingAgent && messages.length === 0 && (
                <section className="agent-empty-state">
                  <div className="hero-icon">
                    <IconRobot />
                  </div>
                  <h3>你好，{studentName}</h3>
                  <p>我可以调用 Skill、子智能体和工具，帮你完成求职准备。</p>
                  <div className="agent-suggestion-grid">
                    {suggestions.map(({ title, desc }) => (
                      <button key={title} type="button" onClick={() => void submitMessage(title)}>
                        <strong>{title}</strong>
                        <span>{desc}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {messages.map((message, index) =>
                message.role === 'user' ? (
                  <div key={message.id} className="message-row user">
                    <div className="message-bubble user">{message.content}</div>
                  </div>
                ) : (
                  <AssistantMessage
                    key={message.id}
                    message={message}
                    activities={activitiesForAssistant(messages, activities, index)}
                  />
                ),
              )}

              {streaming && latestUserMessage && !hasAssistantAfterLatestUser && (
                <AssistantMessage
                  message={{
                    id: 0,
                    session_id: latestUserMessage.session_id,
                    role: 'assistant',
                    content: '',
                    created_at: new Date().toISOString(),
                  }}
                  activities={activities.filter((a) => a.message_id === latestUserMessage.id)}
                  pending
                />
              )}
            </div>

            <div
              className={`agent-composer${isDraggingOver ? ' drag-over' : ''}`}
              onDrop={(e) => void handleDrop(e)}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onPaste={(e) => void handleComposerPaste(e)}
            >
              {isDraggingOver && (
                <div className="drop-overlay">
                  <IconAttachment style={{ fontSize: 28 }} />
                  <span>松开以上传附件</span>
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className="attachment-chip-row">
                  {pendingAttachments.map((a) => (
                    <span key={a.id} className="attachment-chip">
                      <IconAttachment />
                      <span>{a.original_name}</span>
                      <button type="button" onClick={() => removePendingAttachment(a.id)}>
                        <IconClose />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <Input.TextArea
                value={inputValue}
                onChange={setInputValue}
                onKeyDown={handleComposerKeyDown}
                autoSize={{ minRows: 1, maxRows: 8 }}
                placeholder="直接说你的求职需求，例如：帮我准备明天字节后端面试"
                disabled={bootingAgent || modelOptions.length === 0}
              />

              <div className="composer-bottom">
                {/* Left: attachment + */}
                <div className="composer-left">
                  <Tooltip content="上传文件或图片（也可直接拖拽）">
                    <button
                      type="button"
                      className={`composer-add-btn${uploadingAttachment ? ' loading' : ''}`}
                      disabled={streaming || bootingAgent || uploadingAttachment}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploadingAttachment ? <IconLoading /> : <IconPlus />}
                    </button>
                  </Tooltip>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    hidden
                    accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.json"
                    onChange={(e) => void handleFileInputChange(e)}
                  />
                </div>

                {/* Right: model · effort · send */}
                <div className="composer-right">
                  <Select
                    className="composer-model-select"
                    size="small"
                    value={selectedModelId ?? undefined}
                    placeholder="选择模型"
                    disabled={streaming || modelOptions.length === 0}
                    onChange={(v) => setSelectedModelId(v as number)}
                  >
                    {modelOptions.map((m) => (
                      <Select.Option key={m.id} value={m.id}>
                        {m.display_name}
                      </Select.Option>
                    ))}
                  </Select>

                  <Select
                    className="composer-effort-select"
                    size="small"
                    value={reasoningEffort}
                    disabled={streaming}
                    onChange={(v) => setReasoningEffort(v as ReasoningEffort)}
                  >
                    {reasoningOptions.map((o) => (
                      <Select.Option key={o.value} value={o.value}>
                        {o.label}
                      </Select.Option>
                    ))}
                  </Select>

                  {streaming ? (
                    <button type="button" className="composer-send-btn stop" onClick={stopStreaming}>
                      <IconStop />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="composer-send-btn"
                      disabled={!inputValue.trim() || bootingAgent || !selectedModelId}
                      onClick={() => void submitMessage()}
                    >
                      <IconSend />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </main>
        )}

        {activeNav === 'plaza' && (
          <main className="page-content">
            <AgentPlaza />
          </main>
        )}

        {activeNav === 'history' && (
          <main className="page-content">
            <div className="history-panel">
              <div className="history-panel-header">
                <h3>历史对话</h3>
                <p>{allSessions.length} 条记录</p>
              </div>
              <SessionHistoryPanel
                sessions={allSessions}
                currentSessionId={agentSession?.id ?? null}
                onSelect={handleSelectSession}
              />
            </div>
          </main>
        )}

        {activeNav === 'profile' && (
          <main className="page-content">
            <section className="student-placeholder">
              <IconUser />
              <h3>个人中心</h3>
              <p>你的求职档案、简历和记录将在这里汇总。</p>
            </section>
          </main>
        )}
      </section>
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function activitiesForAssistant(
  messages: AgentMessage[],
  activities: AgentActivity[],
  assistantIndex: number,
) {
  const previousUser = [...messages.slice(0, assistantIndex)].reverse().find((m) => m.role === 'user')
  if (!previousUser) return []
  return activities.filter((a) => a.message_id === previousUser.id)
}

function withAttachmentNames(content: string, attachments: AgentAttachment[]) {
  if (attachments.length === 0) return content
  return `${content}\n\n附件：${attachments.map((a) => a.original_name).join('、')}`
}

function parseSseBlock(block: string): StreamEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
    }
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> }
  } catch {
    return null
  }
}
