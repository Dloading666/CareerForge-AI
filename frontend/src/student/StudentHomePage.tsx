import { Button, Checkbox, Dropdown, Input, Menu, Modal, Popconfirm, Skeleton, Tooltip } from '@arco-design/web-react'
import {
  IconApps,
  IconAttachment,
  IconBook,
  IconCaretDown,
  IconCaretRight,
  IconCheck,
  IconClose,
  IconCopy,
  IconCloseCircle,
  IconDashboard,
  IconDelete,
  IconDownload,
  IconFile,
  IconHistory,
  IconLoading,
  IconMindMapping,
  IconNotification,
  IconPlus,
  IconPoweroff,
  IconRobot,
  IconSearch,
  IconSend,
  IconMenuFold,
  IconMenuUnfold,
  IconThunderbolt,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, apiRequest } from '../shared/api'
import { AnnouncementBellDropdown, AnnouncementBanner } from './StudentAnnouncementBar'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { AgentPlaza } from './AgentPlaza'
import { ProfilePage } from './ProfilePage'
import { useAuth } from '../shared/auth'
import { ResumeCenterPage } from '../resume/ResumeCenterPage'
import { ResumeEditorPage } from '../resume/ResumeEditorPage'

// ── Types ──────────────────────────────────────────────────────────────────────

type NavKey = 'agent' | 'resume' | 'plaza' | 'profile'

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
  download_url?: string | null
}

// 主智能体生成的可下载文件（如 export_resume_pdf 产出的简历 PDF），按 assistant 消息 id 归集
type GeneratedFile = { attachment_id: number; download_url: string; filename: string }

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

type ReasoningEffort = 'low' | 'medium' | 'high'

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
    <Dropdown
      trigger="click"
      position="tr"
      disabled={disabled}
      popupVisible={popupVisible}
      onVisibleChange={(visible) => {
        setPopupVisible(visible)
        if (!visible) setModelMenuVisible(false)
      }}
      triggerProps={{ popupAlign: { bottom: 8 } }}
      droplist={
        <div className="composer-settings-menu" onClick={(event) => event.stopPropagation()}>
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
                  onClick={() => {
                    onReasoningChange(option.value)
                    closePicker()
                  }}
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
                      onClick={() => {
                        onModelChange(model.id)
                        closePicker()
                      }}
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
      }
    >
      <button
        type="button"
        className={`composer-settings-button${popupVisible ? ' active' : ''}`}
        disabled={disabled}
        aria-label="选择模型和推理强度"
      >
        <span className="composer-settings-model">{selectedModel?.display_name ?? '选择模型'}</span>
        <span className="composer-settings-effort">{selectedReasoning?.label ?? '中'}</span>
        <IconCaretDown />
      </button>
    </Dropdown>
  )
}

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
  message,
  activities,
  files = [],
  pending = false,
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

function SessionHistoryPanel({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
}: {
  sessions: AgentSession[]
  currentSessionId: number | null
  onSelect: (session: AgentSession) => void
  onDelete: (session: AgentSession) => void
}) {
  if (sessions.length === 0) {
    return <div className="side-nav-history-empty">暂无历史对话</div>
  }

  return (
    <>
      <div className="side-nav-history-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`side-nav-history-item${s.id === currentSessionId ? ' active' : ''}`}
            onClick={() => onSelect(s)}
            title={s.title}
          >
            <IconHistory className="side-nav-history-item-icon" />
            <span className="side-nav-history-item-title">{s.title}</span>
            <Popconfirm
              title="删除这条对话记录？"
              okText="删除"
              cancelText="取消"
              onOk={() => onDelete(s)}
            >
              <span
                className="side-nav-history-del"
                title="删除"
                onClick={(e) => e.stopPropagation()}
              >
                <IconDelete />
              </span>
            </Popconfirm>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StudentHomePage() {
  const { session, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'
  const studentAvatar = (session?.profile.avatar_url as string) || ''
  const [studentAvatarKey] = useState(0)
  const studentEmail = (session?.profile.email as string) || ''
  const [announcement, setAnnouncement] = useState<{ text: string; visible: boolean }>({ text: '', visible: false })
  const [dontShowAgain, setDontShowAgain] = useState(false)

  const [agentSession, setAgentSession] = useState<AgentSession | null>(null)
  const [allSessions, setAllSessions] = useState<AgentSession[]>([])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [generatedFiles, setGeneratedFiles] = useState<Record<number, GeneratedFile[]>>({})
  const [historyLoading, setHistoryLoading] = useState(false)
  const [todayEvents, setTodayEvents] = useState<{ id: number; title: string; event_time: string | null }[]>([])
  const [remindersDismissed, setRemindersDismissed] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [bootingAgent, setBootingAgent] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  // Track image attachments associated with user messages (optimistic id -> attachments)
  const [userMessageAttachments, setUserMessageAttachments] = useState<Record<number, AgentAttachment[]>>({})
  // Lightbox state
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const dragCounterRef = useRef(0)

  const abortRef = useRef<AbortController | null>(null)
  const pendingResumeNavRef = useRef<number | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const optimisticIdRef = useRef(-1)
  const isNearBottomRef = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  const activeNav = useMemo<NavKey>(() => {
    if (location.pathname.startsWith('/student/resumes')) return 'resume'
    if (location.pathname.startsWith('/student/plaza')) return 'plaza'
    if (location.pathname.startsWith('/student/profile')) return 'profile'
    return 'agent'
  }, [location.pathname])

  const navItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'agent', icon: <IconRobot />, label: '主智能体' },
    { key: 'resume', icon: <IconFile />, label: '简历制作' },
    { key: 'plaza', icon: <IconApps />, label: '智能体广场' },
    { key: 'profile', icon: <IconUser />, label: '个人中心' },
  ]

  const topbarMeta = useMemo(() => {
    if (activeNav === 'resume') {
      return {
        title: '简历中心',
        subtitle: location.pathname.includes('/student/resumes/') ? '在线编辑、模板切换与实时预览' : '管理在线简历与附件简历',
      }
    }
    if (activeNav === 'plaza') {
      return { title: '智能体广场', subtitle: '发现并使用不同场景的专业智能体' }
    }
    if (activeNav === 'profile') {
      return { title: '个人中心', subtitle: '管理个人资料、账号安全与附件简历' }
    }
    return { title: '就业助手', subtitle: '主智能体将帮助你完成求职准备与简历打磨' }
  }, [activeNav, location.pathname])

  const navigateToNav = (key: NavKey) => {
    if (key === 'agent') {
      navigate('/student')
      return
    }
    if (key === 'resume') {
      navigate('/student/resumes')
      return
    }
    if (key === 'plaza') {
      navigate('/student/plaza')
      return
    }
    navigate('/student/profile')
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



  // Smart auto-scroll: only scroll if user is near bottom
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

  // 今日日程提醒：登录后拉取今天的事件，顶部横幅提示
  useEffect(() => {
    if (!session?.access) return
    let alive = true
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    apiRequest<{ id: number; title: string; event_time: string | null }[]>(
      `/api/v1/student/events?date_from=${today}&date_to=${today}`,
    )
      .then((list) => {
        if (alive) {
          setTodayEvents(list ?? [])
          setRemindersDismissed(false)
        }
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [session?.access])

  const loadHistory = useCallback(async (target: AgentSession) => {
    setHistoryLoading(true)
    setMessages([])
    setActivities([])
    let history: AgentHistory
    try {
      history = await apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${target.id}/messages`)
    } finally {
      setHistoryLoading(false)
    }
    setAgentSession(history.session)
    setMessages(history.messages)
    setActivities(history.activities)
    setPendingAttachments([])
    // 恢复用户消息的图片附件
    const userMsgAttachments: Record<number, AgentAttachment[]> = {}
    for (const a of history.attachments) {
      if (a.message_id && a.content_type?.startsWith('image/') && history.messages.some((m) => m.id === a.message_id && m.role === 'user')) {
        ;(userMsgAttachments[a.message_id] ??= []).push(a)
      }
    }
    setUserMessageAttachments(userMsgAttachments)
    // 恢复主智能体生成的可下载文件（绑定在 assistant 消息上的 PDF）
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
    setGeneratedFiles({})
    // 注意：不在此处加入 allSessions，空会话不进历史，等首次发送消息再加入
    return created
  }, [])

  useEffect(() => {
    if (!session?.access) return
    const dismissed = localStorage.getItem('announcement_dismissed')
    apiRequest<{ announcement: string; enabled: boolean }>('/api/v1/student/announcement')
      .then((res) => {
        if (res.enabled && res.announcement && res.announcement !== dismissed) {
          setDontShowAgain(false)
          setAnnouncement({ text: res.announcement, visible: true })
        }
      })
      .catch(() => {})
  }, [session?.access])

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

        // 拉取历史会话列表（后端只返回有过对话的会话）
        const sessions = await apiRequest<AgentSession[]>('/api/v1/student/master/sessions')
        if (!alive) return
        setAllSessions(sessions)

        // 不再预创建空会话：登录后保持「新对话」空状态，首次发送消息时才真正创建会话
        setAgentSession(null)
        setMessages([])
        setActivities([])
        setPendingAttachments([])
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
      // 把乐观 id 上挂的图片附件迁移到真实消息 id，否则 message.saved 后图片会消失
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
    // 仅有附件、无文字时，补一句默认指令让模型知道要做什么
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
      {
        id: optimisticId,
        session_id: currentSession.id,
        role: 'user',
        content: content,
        created_at: new Date().toISOString(),
      },
    ])
    // Track image attachments for this user message
    const imageAttachments = sendingAttachments.filter((a) => a.content_type?.startsWith('image/'))
    if (imageAttachments.length > 0) {
      setUserMessageAttachments((prev) => ({ ...prev, [optimisticId]: imageAttachments }))
    }

    // 首次发送后才把会话加入历史侧栏；继续对话则把它移到顶部
    const sess = currentSession
    const optimisticTitle = content.replace(/\n/g, ' ').slice(0, 32) || '新对话'
    setAllSessions((prev) => {
      const existing = prev.find((s) => s.id === sess.id)
      const entry: AgentSession = {
        ...sess,
        title: existing ? existing.title : optimisticTitle,
        updated_at: new Date().toISOString(),
      }
      return [entry, ...prev.filter((s) => s.id !== sess.id)]
    })

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
      // 流结束后，如果有待跳转的简历编辑器
      if (pendingResumeNavRef.current !== null) {
        const resumeId = pendingResumeNavRef.current
        pendingResumeNavRef.current = null
        navigate(`/student/resumes/${resumeId}`)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : '主智能体回复失败')
        setPendingAttachments((prev) => [...sendingAttachments, ...prev])
        setInputValue(content) // 失败时恢复输入框内容，方便重试
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词中（如中文输入法打拼音）按 Enter 是「确认候选」，不能当作发送
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const handleNewChat = () => {
    if (streaming) abortRef.current?.abort()
    setNotice(null)
    // 仅重置为空的「新对话」状态，会话在首次发送消息时才创建
    setAgentSession(null)
    setMessages([])
    setActivities([])
    setPendingAttachments([])
    setGeneratedFiles({})
    setInputValue('')
    navigate('/student')
  }

  const handleDeleteSession = async (target: AgentSession) => {
    try {
      await apiRequest(`/api/v1/student/master/sessions/${target.id}`, { method: 'DELETE' })
      setAllSessions((prev) => prev.filter((s) => s.id !== target.id))
      // 删除的是当前会话则回到空状态
      if (agentSession?.id === target.id) {
        if (streaming) abortRef.current?.abort()
        setAgentSession(null)
        setMessages([])
        setActivities([])
        setPendingAttachments([])
      }
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '删除对话失败')
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

  const handleSelectSession = async (s: AgentSession) => {
    if (streaming) abortRef.current?.abort()
    try {
      await loadHistory(s)
      navigate('/student')
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
      <aside className={`side-nav${navCollapsed ? ' side-nav--collapsed' : ''}`}>
        <div className="brand-mark">
          <img className="brand-logo" src="/baidi.png" alt="CareerForge" />
          <div>
            <h1>CareerForge</h1>
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
              onClick={() => navigateToNav(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="side-nav-history">
          <div className="side-nav-history-label">历史对话</div>
          <SessionHistoryPanel
            sessions={allSessions}
            currentSessionId={activeNav === 'agent' ? (agentSession?.id ?? null) : null}
            onSelect={handleSelectSession}
            onDelete={handleDeleteSession}
          />
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
          <div className="topbar-left">
            <button
              className="side-nav-toggle-btn"
              onClick={() => setNavCollapsed((v) => !v)}
              title={navCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {navCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
            </button>
            <div className="topbar-title">
              <h2>{topbarMeta.title}</h2>
              <p>{topbarMeta.subtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            <AnnouncementBellDropdown />
            <Dropdown
              droplist={
                <Menu>
                  <Menu.Item key="name" disabled>
                    <span style={{ fontWeight: 600 }}>{studentName}</span>
                  </Menu.Item>
                  <Menu.Item key="email" disabled>
                    <span style={{ color: '#86909C', fontSize: 12 }}>{studentEmail}</span>
                  </Menu.Item>
                  <Menu.Item key="logout" onClick={logout}>
                    <IconPoweroff style={{ marginRight: 8 }} />
                    退出登录
                  </Menu.Item>
                </Menu>
              }
              trigger="click"
              position="br"
            >
              <div style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#edf2ff', color: '#0b45d9' }}>
                {studentAvatar ? (
                  <img
                    key={studentAvatarKey}
                    src={studentAvatar}
                    alt="avatar"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <IconUser />
                )}
              </div>
            </Dropdown>
          </div>
        </header>

        <Routes>
          <Route
            index
            element={
              <main className="page-content student-chat-page">
            {!remindersDismissed && todayEvents.length > 0 && (
              <div className="agent-reminder-banner">
                <IconNotification style={{ fontSize: 16, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  今天有 {todayEvents.length} 个日程：
                  {todayEvents
                    .slice(0, 3)
                    .map((e) => `${e.event_time ? e.event_time.slice(0, 5) + ' ' : ''}${e.title}`)
                    .join('、')}
                  {todayEvents.length > 3 ? ' 等' : ''}
                </span>
                <button type="button" className="agent-reminder-close" onClick={() => setRemindersDismissed(true)}>
                  <IconClose />
                </button>
              </div>
            )}
            <div ref={threadRef} className="agent-thread">
              {bootingAgent && <div className="agent-system-line">正在连接主智能体会话…</div>}
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

              {!bootingAgent && !historyLoading && messages.length === 0 && (
                <section className="agent-empty-state agent-home-workbench">
                  <div className="agent-home-grid">
                    <div className="agent-home-badge">
                      <img className="brand-logo" alt="CareerForge" src="/baidi.png" />
                    </div>
                    <h3>你好，{studentName}</h3>
                    <p>我可以协助你制作简历、优化表达、梳理岗位方向，也能把你带去更适合的专属智能体。</p>
                    <div className="agent-home-cards">
                      <button className="agent-home-card" type="button" onClick={() => navigate('/student/resumes/new')}>
                        <strong>AI订制简历</strong>
                        <span>基于你的经历快速搭建第一版在线简历，并进入编辑器细化内容。</span>
                      </button>
                      <button className="agent-home-card" type="button" onClick={() => navigate('/student/resumes?tab=attachments&mode=optimize')}>
                        <strong>简历优化</strong>
                        <span>上传已有 PDF / Word，或直接选择在线简历，继续打磨表达和结构。</span>
                      </button>
                      <button className="agent-home-card" type="button" onClick={() => navigate('/student/plaza')}>
                        <strong>AI面试官</strong>
                        <span>进入智能体广场体验更沉浸的面试训练和场景化求职辅导。</span>
                      </button>
                    </div>
                    <div className="agent-suggestion-grid compact">
                      {suggestions.map(({ title, desc }) => (
                        <button key={title} type="button" onClick={() => void submitMessage(title)}>
                          <strong>{title}</strong>
                          <span>{desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              )}

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
                    {message.content && <div className="message-bubble user"><MarkdownMessage content={message.content} /></div>}
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

            {showScrollBtn && (
              <button
                className="scroll-to-bottom-btn"
                onClick={() => {
                  const node = threadRef.current
                  if (node) node.scrollTop = node.scrollHeight
                }}
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
                        <button
                          type="button"
                          className="composer-image-remove"
                          aria-label="移除图片"
                          onClick={() => removePendingAttachment(a.id)}
                        >
                          <IconClose />
                        </button>
                      </div>
                    ) : (
                      <span key={a.id} className="attachment-chip">
                        <IconAttachment />
                        <span>{a.original_name}</span>
                        <button type="button" onClick={() => removePendingAttachment(a.id)}>
                          <IconClose />
                        </button>
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
                      disabled={bootingAgent || uploadingAttachment}
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
                      disabled={(!inputValue.trim() && pendingAttachments.length === 0) || bootingAgent || !selectedModelId}
                      onClick={() => void submitMessage()}
                    >
                      <IconSend />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </main>
            }
          />
          <Route path="plaza" element={<main className="page-content"><AgentPlaza /></main>} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="resumes" element={<main className="page-content"><ResumeCenterPage /></main>} />
          <Route path="resumes/new" element={<main className="page-content resume-editor-route"><ResumeEditorPage /></main>} />
          <Route path="resumes/:resumeId" element={<main className="page-content resume-editor-route"><ResumeEditorPage /></main>} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </section>

      <Modal
        title={<span style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>系统公告</span>}
        visible={announcement.visible}
        onCancel={() => setAnnouncement((prev) => ({ ...prev, visible: false }))}
        footer={null}
        closable
        maskClosable={false}
        className="announcement-modal"
      >
        <style>{`
          .announcement-modal { margin-top: -80px; margin-left: 80px; }
          .announcement-modal .arco-modal-header {
            background: linear-gradient(135deg, #165dff, #2c73ff);
            border-radius: 8px 8px 0 0;
            padding: 16px 24px;
            border-bottom: none;
          }
          .announcement-modal .arco-modal-close-btn {
            color: #fff;
          }
          .announcement-modal .arco-modal-content {
            padding: 24px;
            background: #fff;
            border-radius: 0 0 8px 8px;
          }
        `}</style>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.8, padding: '12px 0', color: '#1D2129' }}>
          {announcement.text}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <Checkbox checked={dontShowAgain} onChange={setDontShowAgain}>
            <span style={{ fontSize: 13, color: '#86909C' }}>我已知晓，不再提醒</span>
          </Checkbox>
          <Button
            type="primary"
            size="small"
            onClick={() => {
              if (dontShowAgain) {
                localStorage.setItem('announcement_dismissed', announcement.text)
              }
              setAnnouncement((prev) => ({ ...prev, visible: false }))
            }}
          >
            关闭
          </Button>
        </div>
      </Modal>

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}
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
