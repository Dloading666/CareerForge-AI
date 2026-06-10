import { Input, Skeleton, Tooltip } from '@arco-design/web-react'
import {
  IconAttachment,
  IconBook,
  IconCaretDown,
  IconCaretRight,
  IconCheck,
  IconClose,
  IconCloseCircle,
  IconCopy,
  IconDashboard,
  IconDownload,
  IconFile,
  IconLoading,
  IconMindMapping,
  IconNotification,
  IconPlus,
  IconRobot,
  IconSend,
  IconThunderbolt,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, apiRequest } from '../shared/api'
import { AnnouncementBanner } from './StudentAnnouncementBar'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { useAuth } from '../shared/auth'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentChatSession = {
  id: number
  title: string
  status: string
  agent_type: string
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
  download_url?: string | null
}

type GeneratedFile = { attachment_id: number; download_url: string; filename: string }

type AgentHistory = {
  session: AgentChatSession
  messages: AgentMessage[]
  activities: AgentActivity[]
  attachments: AgentAttachment[]
}

export type AgentModelOption = {
  id: number
  display_name: string
  provider: string
  model_identifier: string
  context_length: number | null
  default_temp: number | null
  max_output: number | null
  timeout_sec: number | null
}

type ReasoningEffort = 'low' | 'medium' | 'high'

type StreamEvent = {
  event: string
  data: Record<string, unknown>
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface AgentChatViewProps {
  agentType: 'resume' | 'interviewer'
  modelOptions: AgentModelOption[]
  /** Increment to trigger loading sessionToLoad */
  loadTrigger: number
  sessionToLoad: AgentChatSession | null
  /** Increment to reset to empty new-chat state */
  newChatTrigger: number
  onSessionUpdated: (session: AgentChatSession) => void
  onActiveSessionChange: (id: number | null) => void
  todayEvents: { id: number; title: string; event_time: string | null }[]
  remindersDismissed: boolean
  onDismissReminders: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

// ── Sub-components ─────────────────────────────────────────────────────────────

function ModelReasoningPicker({
  modelOptions,
  selectedModelId,
  reasoningEffort,
  disabled,
  onModelChange,
  onReasoningChange,
}: {
  modelOptions: AgentModelOption[]
  selectedModelId: number | null
  reasoningEffort: ReasoningEffort
  disabled: boolean
  onModelChange: (modelId: number) => void
  onReasoningChange: (effort: ReasoningEffort) => void
}) {
  const [popupVisible, setPopupVisible] = useState(false)
  const [modelMenuVisible, setModelMenuVisible] = useState(false)
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId)
  const selectedReasoning = reasoningOptions.find((option) => option.value === reasoningEffort)

  const closePicker = () => {
    setPopupVisible(false)
    setModelMenuVisible(false)
  }

  return (
    <div
      className={`composer-settings-wrapper${popupVisible ? ' active' : ''}`}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        className={`composer-settings-button${popupVisible ? ' active' : ''}`}
        disabled={disabled}
        aria-label="选择模型和推理强度"
        onClick={() => setPopupVisible((v) => !v)}
      >
        <span className="composer-settings-model">{selectedModel?.display_name ?? '选择模型'}</span>
        <span className="composer-settings-effort">{selectedReasoning?.label ?? '中'}</span>
        <IconCaretDown />
      </button>
      {popupVisible && (
        <div
          className="composer-settings-menu"
          style={{ position: 'absolute', bottom: '100%', right: 0, marginBottom: 8, zIndex: 100 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="composer-settings-heading">
            <IconMindMapping />
            <span>推理</span>
          </div>
          <div className="composer-settings-options">
            {reasoningOptions.map((option) => {
              const selected = option.value === reasoningEffort
              return (
                <button
                  key={option.value}
                  type="button"
                  className={`composer-settings-option${selected ? ' selected' : ''}`}
                  onClick={() => { onReasoningChange(option.value); closePicker() }}
                >
                  <span>{option.label}</span>
                  {selected && <IconCheck />}
                </button>
              )
            })}
          </div>

          <div className="composer-settings-divider" />

          <div className="composer-settings-heading">
            <IconDashboard />
            <span>模型</span>
          </div>
          <div className="composer-model-menu-anchor">
            <button
              type="button"
              className={`composer-settings-option model-entry${modelMenuVisible ? ' selected' : ''}`}
              aria-expanded={modelMenuVisible}
              onClick={() => setModelMenuVisible(true)}
              onFocus={() => setModelMenuVisible(true)}
            >
              <span>{selectedModel?.display_name ?? '选择模型'}</span>
              <IconCaretRight />
            </button>

            <div className={`composer-model-submenu${modelMenuVisible ? ' visible' : ''}`}>
              <div className="composer-settings-heading">
                <IconDashboard />
                <span>可用模型</span>
              </div>
              <div className="composer-settings-options model-options">
                {modelOptions.map((model) => {
                  const selected = model.id === selectedModelId
                  return (
                    <button
                      key={model.id}
                      type="button"
                      className={`composer-settings-option${selected ? ' selected' : ''}`}
                      title={`${model.provider} · ${model.model_identifier}`}
                      onClick={() => { onModelChange(model.id); closePicker() }}
                    >
                      <span>{model.display_name}</span>
                      {selected && <IconCheck />}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function activityKindIcon(kind: string): ReactNode {
  const style = { fontSize: 12 }
  switch (kind) {
    case 'profile': return <IconUser style={style} />
    case 'resume': return <IconFile style={style} />
    case 'file': return <IconAttachment style={style} />
    case 'knowledge': return <IconBook style={style} />
    case 'subagent': return <IconRobot style={style} />
    case 'skill': return <IconThunderbolt style={style} />
    case 'context': return <IconThunderbolt style={style} />
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

function ActivityBlock({ activities, pending }: { activities: AgentActivity[]; pending: boolean }) {
  const [expanded, setExpanded] = useState(true)

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
          <button type="button" className="activity-block-toggle" onClick={() => setExpanded(false)}>
            <IconCaretDown style={{ fontSize: 11 }} />
            <span>
              {runningCount > 0
                ? `${runningCount} 个工具运行中…`
                : `已调用 ${completedCount} 个工具${failedCount > 0 ? `，${failedCount} 个失败` : ''}`}
            </span>
          </button>
          <div className="activity-chip-list">
            {activities.map((a) => <ActivityChip key={a.id} activity={a} />)}
          </div>
        </>
      ) : (
        <button type="button" className="activity-block-toggle collapsed" onClick={() => setExpanded(true)}>
          <IconCaretRight style={{ fontSize: 11 }} />
          <span>已调用 {completedCount} 个工具{failedCount > 0 ? `，${failedCount} 个失败` : ''}</span>
        </button>
      )}
    </div>
  )
}

function GeneratedFileLinks({ files }: { files: GeneratedFile[] }) {
  if (files.length === 0) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {files.map((f) => (
        <a
          key={f.attachment_id}
          href={f.download_url}
          target="_blank"
          rel="noreferrer"
          download={f.filename}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '8px 14px', borderRadius: 10,
            border: '1px solid #BFDBFE', background: '#EFF6FF',
            color: '#1D4ED8', fontSize: 13, fontWeight: 600, textDecoration: 'none',
          }}
        >
          <IconFile />
          <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {f.filename}
          </span>
          <IconDownload />
        </a>
      ))}
    </div>
  )
}

function AssistantMessage({
  message, activities, files = [], pending = false,
}: {
  message: AgentMessage
  activities: AgentActivity[]
  files?: GeneratedFile[]
  pending?: boolean
}) {
  return (
    <div className="message-row assistant">
      <div className="assistant-message">
        <ActivityBlock activities={activities} pending={pending} />
        {message.content ? (
          <div className="assistant-answer">
            {!pending && (
              <button
                className="msg-copy-btn"
                title="复制"
                onClick={() => navigator.clipboard.writeText(message.content)}
              >
                <IconCopy />
              </button>
            )}
            <MarkdownMessage content={message.content} />
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
        <GeneratedFileLinks files={files} />
      </div>
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

function parseSseBlock(block: string): StreamEvent | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> }
  } catch {
    return null
  }
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const handleCopy = async () => {
    try {
      const resp = await fetch(src)
      const blob = await resp.blob()
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    } catch {
      window.open(src, '_blank')
    }
  }
  return (
    <div className="image-lightbox-overlay" onClick={onClose}>
      <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <img src={src} alt="preview" />
        <div className="image-lightbox-actions">
          <button onClick={handleCopy} title="复制"><IconCopy /></button>
          <button onClick={onClose} title="关闭"><IconClose /></button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function AgentChatView({
  agentType,
  modelOptions,
  loadTrigger,
  sessionToLoad,
  newChatTrigger,
  onSessionUpdated,
  onActiveSessionChange,
  todayEvents,
  remindersDismissed,
  onDismissReminders,
}: AgentChatViewProps) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'

  const [agentSession, setAgentSession] = useState<AgentChatSession | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [generatedFiles, setGeneratedFiles] = useState<Record<number, GeneratedFile[]>>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [userMessageAttachments, setUserMessageAttachments] = useState<Record<number, AgentAttachment[]>>({})
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const pendingResumeNavRef = useRef<number | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const optimisticIdRef = useRef(-1)
  const isNearBottomRef = useRef(true)
  const dragCounterRef = useRef(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // Sync selected model with parent's model options
  useEffect(() => {
    setSelectedModelId((cur) => {
      if (cur && modelOptions.some((m) => m.id === cur)) return cur
      return modelOptions[0]?.id ?? null
    })
  }, [modelOptions])

  // Auto-scroll
  useEffect(() => {
    const node = threadRef.current
    if (!node) return
    const onScroll = () => {
      const near = node.scrollHeight - node.scrollTop - node.clientHeight < 100
      isNearBottomRef.current = near
      setShowScrollBtn(!near)
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return () => node.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const node = threadRef.current
    if (node && isNearBottomRef.current) node.scrollTop = node.scrollHeight
  }, [messages, activities, streaming])

  // Notify parent when active session changes
  useEffect(() => {
    onActiveSessionChange(agentSession?.id ?? null)
  }, [agentSession?.id, onActiveSessionChange])

  // Load session when loadTrigger increments
  useEffect(() => {
    if (loadTrigger === 0 || !sessionToLoad) return
    if (streaming) abortRef.current?.abort()
    setNotice(null)
    setHistoryLoading(true)
    setMessages([])
    setActivities([])

    apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${sessionToLoad.id}/messages`)
      .then((history) => {
        setAgentSession(history.session)
        setMessages(history.messages)
        setActivities(history.activities)
        setPendingAttachments([])
        setGeneratedFiles({})
        // Restore user image attachments
        const userMsgAttachments: Record<number, AgentAttachment[]> = {}
        for (const a of history.attachments) {
          if (a.message_id && a.content_type?.startsWith('image/') && history.messages.some((m) => m.id === a.message_id && m.role === 'user')) {
            ;(userMsgAttachments[a.message_id] ??= []).push(a)
          }
        }
        setUserMessageAttachments(userMsgAttachments)
        // Restore generated files
        const assistantIds = new Set(history.messages.filter((m) => m.role === 'assistant').map((m) => m.id))
        const restored: Record<number, GeneratedFile[]> = {}
        for (const a of history.attachments) {
          if (a.file_ext === 'pdf' && a.download_url && a.message_id && assistantIds.has(a.message_id)) {
            ;(restored[a.message_id] ??= []).push({
              attachment_id: a.id,
              download_url: a.download_url,
              filename: a.original_name,
            })
          }
        }
        setGeneratedFiles(restored)
      })
      .catch(() => setNotice('加载历史会话失败'))
      .finally(() => setHistoryLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadTrigger])

  // Reset to new chat when newChatTrigger increments
  useEffect(() => {
    if (newChatTrigger === 0) return
    if (streaming) abortRef.current?.abort()
    setAgentSession(null)
    setMessages([])
    setActivities([])
    setPendingAttachments([])
    setGeneratedFiles({})
    setInputValue('')
    setNotice(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChatTrigger])

  const createAgentSession = useCallback(async () => {
    const created = await apiRequest<AgentChatSession>('/api/v1/student/master/sessions', {
      method: 'POST',
      body: JSON.stringify({ title: '新对话', agent_type: agentType }),
    })
    setAgentSession(created)
    setMessages([])
    setActivities([])
    setPendingAttachments([])
    setGeneratedFiles({})
    return created
  }, [agentType])

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
        return [...prev, { id: messageId, session_id: sessionId, role: 'assistant', content: delta, created_at: new Date().toISOString() }]
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
      setUserMessageAttachments((prev) => {
        if (!prev[optimisticId]) return prev
        const next = { ...prev }
        next[messageId] = next[optimisticId]
        delete next[optimisticId]
        return next
      })
      return
    }
    if (event === 'activity.started' || event === 'activity.completed' || event === 'activity.failed') {
      const activity = data as AgentActivity
      upsertActivity(activity)
      if (event === 'activity.completed') {
        const detail = activity.detail
        if (detail?.open_resume_editor && typeof detail?.resume_id === 'number') {
          pendingResumeNavRef.current = detail.resume_id as number
        }
      }
      return
    }
    if (event === 'message.delta') {
      appendAssistantDelta(Number(data.message_id), String(data.delta ?? ''), sessionId)
      return
    }
    if (event === 'attachment.created') {
      const messageId = Number(data.message_id)
      const downloadUrl = String(data.download_url ?? '')
      if (!downloadUrl) return
      const file: GeneratedFile = {
        attachment_id: Number(data.attachment_id),
        download_url: downloadUrl,
        filename: String(data.filename ?? '简历.pdf'),
      }
      setGeneratedFiles((prev) => {
        const list = prev[messageId] ?? []
        if (list.some((f) => f.attachment_id === file.attachment_id)) return prev
        return { ...prev, [messageId]: [...list, file] }
      })
    }
  }

  const submitMessage = async (preset?: string) => {
    const text = (preset ?? inputValue).trim()
    const hasAttachments = pendingAttachments.length > 0
    if ((!text && !hasAttachments) || streaming) return
    const content = text || '请帮我分析上传的附件。'
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
      { id: optimisticId, session_id: currentSession.id, role: 'user', content, created_at: new Date().toISOString() },
    ])
    const imageAttachments = sendingAttachments.filter((a) => a.content_type?.startsWith('image/'))
    if (imageAttachments.length > 0) {
      setUserMessageAttachments((prev) => ({ ...prev, [optimisticId]: imageAttachments }))
    }

    // Inform parent about session (first time or timestamp update)
    const optimisticTitle = content.replace(/\n/g, ' ').slice(0, 32) || '新对话'
    const sess = currentSession
    const sessionForParent: AgentChatSession = {
      ...sess,
      title: optimisticTitle,
      agent_type: agentType,
      updated_at: new Date().toISOString(),
    }
    onSessionUpdated(sessionForParent)

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
      if (!response.ok || !response.body) throw new Error(`请求失败（${response.status}）`)

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
      if (pendingResumeNavRef.current !== null) {
        const resumeId = pendingResumeNavRef.current
        pendingResumeNavRef.current = null
        navigate(`/student/resumes/${resumeId}`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : '回复失败')
        setPendingAttachments((prev) => [...sendingAttachments, ...prev])
        setInputValue(content)
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
    setStreaming(false)
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant' && last.content && !last.content.endsWith('*[已停止]*')) {
        return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*[已停止]*' }]
      }
      return prev
    })
  }

  const uploadFiles = async (files: File[], currentSession?: AgentChatSession | null) => {
    if (files.length === 0 || uploadingAttachment) return
    let sess = currentSession ?? agentSession
    try {
      if (!sess) sess = await createAgentSession()
      setUploadingAttachment(true)
      setNotice(null)
      if (files.length > 8) setNotice('最多同时上传 8 个文件，已自动选择前 8 个。')
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
    if (event.dataTransfer.types.includes('Files')) setIsDraggingOver(true)
  }
  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => { event.preventDefault() }
  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) setIsDraggingOver(false)
  }

  const latestUserMessage = useMemo(
    () => [...messages].reverse().find((m) => m.role === 'user'),
    [messages],
  )
  const hasAssistantAfterLatestUser = useMemo(() => {
    if (!latestUserMessage) return false
    const idx = messages.findIndex((m) => m.id === latestUserMessage.id)
    return messages.slice(idx + 1).some((m) => m.role === 'assistant')
  }, [latestUserMessage, messages])

  // ── Render ──

  const emptyState = agentType === 'resume' ? (
    <section className="agent-empty-state agent-home-workbench">
      <div className="agent-home-grid">
        <div className="agent-home-badge">
          <img className="brand-logo" alt="CareerForge" src="/baidi.png" />
        </div>
        <h3>你好，{studentName}</h3>
        <p>我可以协助你制作简历、优化表达、梳理岗位方向。</p>
        <div className="agent-home-cards">
          <button
            className="agent-home-card"
            type="button"
            onClick={() => void submitMessage('AI简历制作：请先读取我的个人信息，然后帮我制作一份针对目标岗位的简历')}
          >
            <strong>AI订制简历</strong>
            <span>读取个人信息档案，结合你提供的目标岗位 JD，自动生成一份在线简历。</span>
          </button>
          <button
            className="agent-home-card"
            type="button"
            onClick={() => {
              setInputValue('请帮我优化简历，我会上传简历 PDF 和目标岗位 JD。')
              fileInputRef.current?.click()
            }}
          >
            <strong>简历优化</strong>
            <span>上传简历 PDF + 粘贴目标岗位 JD，AI 给出优化建议并保存到简历制作。</span>
          </button>
        </div>
      </div>
    </section>
  ) : (
    <section className="agent-empty-state agent-home-workbench">
      <div className="agent-home-grid">
        <div className="agent-home-badge interviewer-badge">
          <IconBook style={{ fontSize: 32, color: '#165DFF' }} />
        </div>
        <h3>AI 面试官</h3>
        <p>一对一模拟面试，获得真实面试官风格的提问与针对性点评，帮你在面试中脱颖而出。</p>
        <div className="agent-home-cards">
          <button
            className="agent-home-card agent-home-card--full"
            type="button"
            onClick={() => void submitMessage('你好，我想开始模拟面试，请先了解我的个人信息，然后开始面试。')}
          >
            <strong>开始模拟面试</strong>
            <span>面试官会先读取你的个人档案，确认目标岗位，然后逐步展开提问与点评。</span>
          </button>
        </div>
      </div>
    </section>
  )

  return (
    <main className="page-content student-chat-page">
      {!remindersDismissed && todayEvents.length > 0 && (
        <div className="agent-reminder-banner">
          <IconNotification style={{ fontSize: 16, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            今天有 {todayEvents.length} 个日程：
            {todayEvents.slice(0, 3).map((e) => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`).join('、')}
            {todayEvents.length > 3 ? ' 等' : ''}
          </span>
          <button type="button" className="agent-reminder-close" onClick={onDismissReminders}>
            <IconClose />
          </button>
        </div>
      )}

      <div ref={threadRef} className="agent-thread">
        {notice && (
          <div className="agent-error-line">
            <span>{notice}</span>
            <button className="agent-error-close" onClick={() => setNotice(null)}>
              <IconClose />
            </button>
          </div>
        )}
        <AnnouncementBanner />

        {historyLoading && (
          <div style={{ width: 'min(980px, 100%)', margin: '0 auto', padding: '12px 0' }}>
            <Skeleton animation text={{ rows: 3, width: ['40%', '88%', '70%'] }} />
            <div style={{ height: 18 }} />
            <Skeleton animation text={{ rows: 4, width: ['52%', '92%', '84%', '60%'] }} />
          </div>
        )}

        {!historyLoading && messages.length === 0 && emptyState}

        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div key={message.id} className="message-row user">
              {userMessageAttachments[message.id]?.length > 0 && (
                <div className="user-image-grid">
                  {userMessageAttachments[message.id].map((att) => {
                    const src = att.download_url || ''
                    return (
                      <div key={att.id} className="user-image-thumb" onClick={() => setLightboxImage(src)}>
                        <img src={src} alt={att.original_name} />
                      </div>
                    )
                  })}
                </div>
              )}
              {message.content && (
                <div className="message-bubble user"><MarkdownMessage content={message.content} /></div>
              )}
            </div>
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              activities={activitiesForAssistant(messages, activities, index)}
              files={generatedFiles[message.id] ?? []}
            />
          ),
        )}

        {streaming && latestUserMessage && !hasAssistantAfterLatestUser && (
          <AssistantMessage
            message={{ id: 0, session_id: latestUserMessage.session_id, role: 'assistant', content: '', created_at: new Date().toISOString() }}
            activities={activities.filter((a) => a.message_id === latestUserMessage.id)}
            pending
          />
        )}
      </div>

      {showScrollBtn && (
        <button
          className="scroll-to-bottom-btn"
          onClick={() => { const node = threadRef.current; if (node) node.scrollTop = node.scrollHeight }}
        >
          <IconCaretDown />
        </button>
      )}

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
            {pendingAttachments.map((a) =>
              a.content_type?.startsWith('image/') && a.download_url ? (
                <div key={a.id} className="composer-image-preview" title={a.original_name}>
                  <img src={a.download_url} alt={a.original_name} />
                  <button type="button" className="composer-image-remove" aria-label="移除图片" onClick={() => removePendingAttachment(a.id)}>
                    <IconClose />
                  </button>
                </div>
              ) : (
                <span key={a.id} className="attachment-chip">
                  <IconAttachment />
                  <span>{a.original_name}</span>
                  <button type="button" onClick={() => removePendingAttachment(a.id)}><IconClose /></button>
                </span>
              ),
            )}
          </div>
        )}

        <Input.TextArea
          value={inputValue}
          onChange={setInputValue}
          onKeyDown={handleComposerKeyDown}
          autoSize={{ minRows: 1, maxRows: 8 }}
          placeholder={
            agentType === 'interviewer'
              ? '回答面试官的问题，或输入你想练习的岗位…'
              : '直接说你的求职需求，例如：帮我优化简历中的项目经历'
          }
          disabled={modelOptions.length === 0}
        />

        <div className="composer-bottom">
          <div className="composer-left">
            <Tooltip content="上传文件或图片（也可直接拖拽）">
              <button
                type="button"
                className={`composer-add-btn${uploadingAttachment ? ' loading' : ''}`}
                disabled={uploadingAttachment}
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

          <div className="composer-right">
            <ModelReasoningPicker
              modelOptions={modelOptions}
              selectedModelId={selectedModelId}
              reasoningEffort={reasoningEffort}
              disabled={modelOptions.length === 0}
              onModelChange={setSelectedModelId}
              onReasoningChange={setReasoningEffort}
            />
            {streaming ? (
              <button type="button" className="composer-send-btn stop" onClick={stopStreaming}>
                <span className="stop-icon" />
              </button>
            ) : (
              <button
                type="button"
                className="composer-send-btn"
                disabled={(!inputValue.trim() && pendingAttachments.length === 0) || !selectedModelId}
                onClick={() => void submitMessage()}
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
    </main>
  )
}
