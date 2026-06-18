import { Input, Modal, Skeleton, Tooltip } from '@arco-design/web-react'
import {
  IconAttachment,
  IconBook,
  IconCaretDown,
  IconCaretRight,
  IconCheck,
  IconClose,
  IconCopy,
  IconDashboard,
  IconDownload,
  IconFile,
  IconLoading,
  IconMindMapping,
  IconNotification,
  IconPlus,
  IconSend,
} from '@arco-design/web-react/icon'
import type { ChangeEvent, KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, apiRequest, authenticatedFetch } from '../shared/api'
import { AnnouncementBanner } from './StudentAnnouncementBar'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { useAuth } from '../shared/auth'
import { buildTimelineSegments, chatRuntimeStore, type TimelineSegment } from './chatRuntimeStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export type AgentChatSession = {
  id: number
  title: string
  status: string
  agent_type: string
  active_resume_id?: number | null
  created_at: string
  updated_at: string
}

type AgentMessage = {
  id: number
  session_id: number
  role: 'user' | 'assistant'
  content: string
  model_name?: string | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
  total_tokens?: number | null
  duration_ms?: number | null
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
  display_summary: string | null
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

type RuntimeInfo = {
  message_id: number
  model_name: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  duration_ms: number
}

type RuntimeStatus = {
  message_id: number
  phase: string
  label: string
  iteration: number
}

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
  onOpenProfile?: () => void
}

// ── Constants ──────────────────────────────────────────────────────────────────


const MAX_RESUMES = 6

const reasoningOptions: { value: ReasoningEffort; label: string }[] = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
]

// ── Resume list types (for workspace selector) ────────────────────────────

type ResumeSummary = {
  id: number
  title: string
  updated_at: string | null
}

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


function ResumeSelector({
  activeResumeId,
  onResumeChange,
  disabled,
}: {
  activeResumeId: number | null
  onResumeChange: (id: number | null) => void
  disabled: boolean
}) {
  const [popupVisible, setPopupVisible] = useState(false)
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const activeResume = resumes.find((r) => r.id === activeResumeId)
  const fetchedRef = useRef(false)

  const fetchResumes = async () => {
    setLoading(true)
    try {
      const data = await apiRequest<ResumeSummary[]>('/api/v1/student/resumes')
      setResumes(data)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  // P1-8: 加载历史会话后 activeResumeId 非空但列表为空时，主动 fetch 一次
  useEffect(() => {
    if (activeResumeId && resumes.length === 0 && !fetchedRef.current) {
      fetchedRef.current = true
      let cancelled = false
      apiRequest<ResumeSummary[]>('/api/v1/student/resumes')
        .then((data) => { if (!cancelled) setResumes(data) })
        .catch(() => { /* silent */ })
      return () => { cancelled = true }
    }
  }, [activeResumeId, resumes.length])

  const handleOpen = () => {
    if (disabled) return
    setPopupVisible((v) => !v)
    if (!popupVisible) void fetchResumes()
  }

  const handleSelect = (id: number) => {
    onResumeChange(id)
    setPopupVisible(false)
  }

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onResumeChange(null)
  }

  if (activeResume) {
    return (
      <div style={{ position: 'relative' }}>
        <span
          className="attachment-chip"
          style={{ cursor: disabled ? 'default' : 'pointer', background: '#EEF2FF', borderColor: '#C7D2FE', color: '#4338CA' }}
          onClick={handleOpen}
        >
          📄
          <span>正在编辑：《{activeResume.title}》</span>
          <button type="button" onClick={handleClear} aria-label="解除绑定"><IconClose /></button>
        </span>
        {popupVisible && (
          <div
            className="composer-settings-menu"
            style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 100, minWidth: 280 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="composer-settings-heading">
              <IconFile />
              <span>切换工作简历</span>
            </div>
            <div className="composer-settings-options">
              {resumes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`composer-settings-option${r.id === activeResumeId ? ' selected' : ''}`}
                  onClick={() => handleSelect(r.id)}
                >
                  <span>{r.title}</span>
                  {r.id === activeResumeId && <IconCheck />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="attachment-chip"
        style={{
          cursor: disabled ? 'default' : 'pointer',
          borderStyle: 'dashed',
          background: 'transparent',
          color: '#86909C',
        }}
        disabled={disabled}
        onClick={handleOpen}
      >
        📄
        <span>选择简历</span>
      </button>
      {popupVisible && (
        <div
          className="composer-settings-menu"
          style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 100, minWidth: 280 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="composer-settings-heading">
            <IconFile />
            <span>选择工作简历</span>
          </div>
          {loading ? (
            <div style={{ padding: '12px 16px', color: '#86909C', fontSize: 13 }}>加载中…</div>
          ) : resumes.length === 0 ? (
            <div style={{ padding: '12px 16px', fontSize: 13 }}>
              <div style={{ color: '#86909C', marginBottom: 8 }}>还没有简历</div>
              <button
                type="button"
                className="composer-settings-option"
                onClick={() => { setPopupVisible(false); navigate('/student/resumes') }}
              >
                <span>去简历制作新建</span>
              </button>
            </div>
          ) : (
            <div className="composer-settings-options">
              {resumes.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="composer-settings-option"
                  onClick={() => handleSelect(r.id)}
                >
                  <span>{r.title}</span>
                  {r.updated_at && <span style={{ fontSize: 11, color: '#86909C' }}>{r.updated_at.slice(0, 10)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/** 根据当前运行状态返回状态栏的 phase 图标（emoji）和动画 class */

const toolDisplayNames: Record<string, string> = {
  query_student_profile: '查看个人档案',
  read_resume: '查看简历',
  analyze_uploaded_file: '分析附件',
  get_session_context: '回顾对话',
  generate_resume_data: '生成在线简历',
  optimize_resume_data: '生成优化版简历',
  update_resume_data: '更改简历',
  export_resume_pdf: '导出简历 PDF',
  read_webpage: '读取网页',
  web_search: '搜索网络信息',
  analyze_jd_match: '分析 JD 匹配度',
  save_session_note: '记下要点',
}

const skillDisplayNames: Record<string, string> = {
  skill__evidence_backed_resume_tailor: '准备简历定制策略',
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs && durationMs !== 0) return ''
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} 秒`
}

function activityDisplayName(activity: AgentActivity) {
  const knownName = toolDisplayNames[activity.name] || skillDisplayNames[activity.name]
  if (knownName) return knownName

  const displayName = activity.detail?.display_name
  if (typeof displayName === 'string' && displayName.trim() && !displayName.includes('_')) {
    return displayName.trim()
  }

  if (activity.name.startsWith('skill__') || activity.kind === 'skill' || activity.kind === 'resume_skill') {
    return '运行专业技能'
  }
  return '处理任务'
}

function activityAction(activity: AgentActivity) {
  const action = activityDisplayName(activity)
  if (activity.status === 'started') return `正在${action}…`
  if (activity.status === 'failed') return `${action}未完成`
  return `已${action}`
}



/** Format elapsed ms as "Xm Ys" for the runtime statusline. */
function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

/** Estimate token count from character count (CJK ≈ 1.5 chars/token). */
function formatTokens(chars: number): string {
  const t = Math.round(chars / 1.5)
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t)
}

/** Resolve the statusline label with priority rules. */

type ActivityIconSpec = {
  src: string
  tone: string
}

const ACTIVITY_ICON_BASE = '/activity-icons-v2'

const ACTIVITY_ICON_MAP: Record<string, ActivityIconSpec> = {
  query_student_profile: { src: `${ACTIVITY_ICON_BASE}/profile.png`, tone: 'profile' },
  read_resume: { src: `${ACTIVITY_ICON_BASE}/read-resume.png`, tone: 'resume' },
  analyze_uploaded_file: { src: `${ACTIVITY_ICON_BASE}/analyze-attachment.png`, tone: 'file' },
  get_session_context: { src: `${ACTIVITY_ICON_BASE}/context-history.png`, tone: 'context' },
  generate_resume_data: { src: `${ACTIVITY_ICON_BASE}/generate-resume.png`, tone: 'generate' },
  optimize_resume_data: { src: `${ACTIVITY_ICON_BASE}/optimize-resume.png`, tone: 'optimize' },
  update_resume_data: { src: `${ACTIVITY_ICON_BASE}/edit-resume.png`, tone: 'edit' },
  export_resume_pdf: { src: `${ACTIVITY_ICON_BASE}/export-pdf.png`, tone: 'export' },
  read_webpage: { src: `${ACTIVITY_ICON_BASE}/read-webpage.png`, tone: 'web' },
  web_search: { src: `${ACTIVITY_ICON_BASE}/web-search.png`, tone: 'search' },
  analyze_jd_match: { src: `${ACTIVITY_ICON_BASE}/analyze-jd.png`, tone: 'analysis' },
  save_session_note: { src: `${ACTIVITY_ICON_BASE}/edit-resume.png`, tone: 'note' },
}

const KIND_ICON_MAP: Record<string, ActivityIconSpec> = {
  profile: { src: `${ACTIVITY_ICON_BASE}/profile.png`, tone: 'profile' },
  resume: { src: `${ACTIVITY_ICON_BASE}/read-resume.png`, tone: 'resume' },
  file: { src: `${ACTIVITY_ICON_BASE}/analyze-attachment.png`, tone: 'file' },
  context: { src: `${ACTIVITY_ICON_BASE}/context-history.png`, tone: 'context' },
  job: { src: `${ACTIVITY_ICON_BASE}/analyze-jd.png`, tone: 'analysis' },
  knowledge: { src: `${ACTIVITY_ICON_BASE}/web-search.png`, tone: 'search' },
  skill: { src: `${ACTIVITY_ICON_BASE}/run-skill.png`, tone: 'skill' },
  resume_skill: { src: `${ACTIVITY_ICON_BASE}/run-skill.png`, tone: 'skill' },
}

type SessionMemory = {
  constraints?: string[]
  facts?: string[]
  preferences?: string[]
}

function MemoryPanel({
  sessionId,
  visible,
}: {
  sessionId: number | null
  visible: boolean
}) {
  const [memory, setMemory] = useState<SessionMemory>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!visible || !sessionId) return
    let cancelled = false
    apiRequest<{ session: { memory_json?: string | null } }>(`/api/v1/student/master/sessions/${sessionId}/messages?limit=0`)
      .then((data) => {
        if (cancelled) return
        setLoading(true)
        try {
          setMemory(JSON.parse(data.session.memory_json || '{}'))
        } catch { setMemory({}) }
      })
      .catch(() => { if (!cancelled) setMemory({}) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [visible, sessionId])

  const handleDelete = async (type: 'constraints' | 'facts' | 'preferences', index?: number) => {
    const updated: SessionMemory = { ...memory, constraints: [...(memory.constraints || [])], facts: [...(memory.facts || [])], preferences: [...(memory.preferences || [])] }
    if (type === 'preferences' && index !== undefined) {
      updated.preferences = updated.preferences!.filter((_, i) => i !== index)
    } else if (type === 'constraints' && index !== undefined) {
      updated.constraints = updated.constraints!.filter((_, i) => i !== index)
    } else if (type === 'facts' && index !== undefined) {
      updated.facts = updated.facts!.filter((_, i) => i !== index)
    }
    setMemory(updated)
    if (sessionId) {
      try {
        await authenticatedFetch(`/api/v1/student/master/sessions/${sessionId}/memory`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updated),
        })
      } catch { /* silent */ }
    }
  }

  if (!visible) return null

  const constraints = memory.constraints || []
  const facts = memory.facts || []
  const prefs = memory.preferences || []
  const total = constraints.length + facts.length + prefs.length

  return (
    <div
      className="composer-settings-menu"
      style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 8, zIndex: 100, minWidth: 300, maxHeight: 360, overflow: 'auto' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="composer-settings-heading">
        <IconMindMapping />
        <span>本次对话记住的内容</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#86909C' }}>{total} 条</span>
      </div>
      {loading ? (
        <div style={{ padding: '12px 16px', color: '#86909C', fontSize: 13 }}>加载中…</div>
      ) : total === 0 ? (
        <div style={{ padding: '12px 16px', color: '#86909C', fontSize: 13 }}>暂无记忆内容</div>
      ) : (
        <div style={{ padding: '4px 0' }}>
          {constraints.length > 0 && (
            <div style={{ padding: '4px 16px' }}>
              <div style={{ fontSize: 11, color: '#86909C', marginBottom: 4 }}>约束</div>
              {constraints.map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '2px 0' }}>
                  <span style={{ flex: 1 }}>🚫 {c}</span>
                  <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#86909C' }} onClick={() => void handleDelete('constraints', i)}><IconClose style={{ fontSize: 12 }} /></button>
                </div>
              ))}
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ padding: '4px 16px' }}>
              <div style={{ fontSize: 11, color: '#86909C', marginBottom: 4 }}>事实</div>
              {facts.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '2px 0' }}>
                  <span style={{ flex: 1 }}>📝 {f}</span>
                  <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#86909C' }} onClick={() => void handleDelete('facts', i)}><IconClose style={{ fontSize: 12 }} /></button>
                </div>
              ))}
            </div>
          )}
          {prefs.length > 0 && (
            <div style={{ padding: '4px 16px' }}>
              <div style={{ fontSize: 11, color: '#86909C', marginBottom: 4 }}>偏好</div>
              {prefs.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, padding: '2px 0' }}>
                  <span style={{ flex: 1 }}>⚙️ {p}</span>
                  <button type="button" style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#86909C' }} onClick={() => void handleDelete('preferences', i)}><IconClose style={{ fontSize: 12 }} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function activityPhaseIcon(name: string, kind: string): ActivityIconSpec {
  if (name.startsWith('skill__')) return { src: `${ACTIVITY_ICON_BASE}/run-skill.png`, tone: 'skill' }
  return ACTIVITY_ICON_MAP[name]
    || KIND_ICON_MAP[kind]
    || { src: `${ACTIVITY_ICON_BASE}/run-skill.png`, tone: 'neutral' }
}

/** 工具动作像普通消息一样嵌入对话时间线，不再呈现为面板或列表。 */
function ActivityTrace({ segment }: { segment: { activities: AgentActivity[]; collapsed: boolean } }) {
  const toolActivities = segment.activities

  const isRecoveredFailure = (activity: AgentActivity) => (
    activity.status === 'failed'
    && toolActivities.some((candidate) => (
      candidate.name === activity.name
      && candidate.status === 'completed'
      && candidate.id > activity.id
    ))
  )
  const visibleActivities = toolActivities.filter((activity) => !isRecoveredFailure(activity))
  const primaryActivity = [...visibleActivities].reverse().find((activity) => activity.status === 'started')
    || visibleActivities[visibleActivities.length - 1]
  const hasFailures = visibleActivities.some((activity) => activity.status === 'failed')

  if (!primaryActivity) return null

  const { src, tone } = activityPhaseIcon(primaryActivity.name, primaryActivity.kind)
  const isRunning = visibleActivities.some((activity) => activity.status === 'started')

  return (
    <div className={`activity-trace${isRunning ? ' is-running' : ''}${hasFailures ? ' has-failures' : ''}`}>
      <Tooltip content={activityDisplayName(primaryActivity)} mini>
        <span className={`activity-trace-icon tone-${tone}`} aria-hidden="true">
          <img className="activity-trace-image" src={src} alt="" />
        </span>
      </Tooltip>
      <span className="activity-trace-copy">
        {visibleActivities.map((activity, index) => (
          <span key={activity.id}>
            {index > 0 && <span className="activity-trace-separator"> · </span>}
            <span className={`activity-trace-action status-${activity.status}`}>
              {activityAction(activity)}
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}

/** 时间线渲染：text 和 actions 段交错 */
function TimelineRenderer({ segments }: { segments: TimelineSegment[] }) {
  return (
    <div className="timeline-container">
      {segments.map((seg, i) => {
        if (seg.type === 'text') {
          return seg.content ? (
            <div key={`t${i}`} className="assistant-answer timeline-text">
              <MarkdownMessage content={seg.content} />
            </div>
          ) : null
        }
        return <ActivityTrace key={`a${i}`} segment={seg} />
      })}
    </div>
  )
}

/** Breathing-logo status line shown during streaming; freezes to a static footer on completion. */
function RuntimeStatusline({
  pending,
  heartbeat,
  runtimeStatus,
  runtimeInfo,
  activities,
  streamStartMs,
}: {
  pending: boolean
  heartbeat?: { output_chars: number; phase: string }
  runtimeStatus?: RuntimeStatus
  runtimeInfo?: RuntimeInfo
  activities: AgentActivity[]
  streamStartMs: number | null
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!streamStartMs || !pending) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [streamStartMs, pending])
  if (!pending && !runtimeInfo) return null

  // Completed state -> static footer
  if (!pending && runtimeInfo) {
    const chars = runtimeInfo.total_tokens > 0 ? runtimeInfo.total_tokens : 0
    return (
      <div className="runtime-footer">
        <span className="status-logo-wrap"><img className="status-logo" src="/baidi.png" alt="" /></span>
        <span>用时 {formatDuration(runtimeInfo.duration_ms)}</span>
        {chars > 0 && (
          <>
            <span className="rs-dot">·</span>
            <span>{chars.toLocaleString()} tokens</span>
          </>
        )}
      </div>
    )
  }

  // Streaming state
  const elapsed = streamStartMs ? now - streamStartMs : 0
  const outputChars = heartbeat?.output_chars ?? 0
  // Resolve label from active tool or heartbeat phase
  const activeTool = activities.find((a) => a.status === 'started')
  let label = activeTool?.summary || ''
  if (!label) {
    if (heartbeat?.phase === 'tool_writing') label = '正在撰写内容…'
    else if (heartbeat?.phase === 'writing') label = '正在组织回复…'
    else if (runtimeStatus?.label) label = runtimeStatus.label
    else label = '正在理解你的需求…'
  }
  if (elapsed > 30000 && !label.includes('请稍候')) {
    label = label.replace(/…$/, '（内容较多，请稍候）…')
  }

  return (
    <div className="runtime-statusline">
      <span className="status-logo-wrap"><img className="status-logo" src="/baidi.png" alt="" /></span>
      <span>{formatElapsed(elapsed)}</span>
      <span className="rs-dot">·</span>
      <span>{formatTokens(outputChars)} tokens</span>
      <span className="rs-dot">·</span>
      <span className="rs-label">{label}</span>
    </div>
  )
}

function ResumeEditorLinks({ activities }: { activities: AgentActivity[] }) {
  const navigate = useNavigate()
  const [reverting, setReverting] = useState<number | null>(null)
  const editorLinks = useMemo(() => {
    const links: { resumeId: number; label: string; activityName: string; revisionId?: number }[] = []
    for (const a of activities) {
      if (a.status !== 'completed') continue
      const detail = a.detail || {}
      if (detail?.open_resume_editor && typeof detail?.resume_id === 'number') {
        const label = a.name === 'generate_resume_data' ? '查看生成的简历'
          : a.name === 'optimize_resume_data' ? '查看优化后的简历'
          : a.name === 'update_resume_data' ? '查看修改后的简历'
          : '查看简历'
        links.push({ resumeId: detail.resume_id as number, label, activityName: a.name, revisionId: typeof detail?.revision_id === 'number' ? detail.revision_id as number : undefined })
      }
    }
    return links
  }, [activities])

  const handleRevert = async (resumeId: number, revisionId: number | undefined, e: React.MouseEvent) => {
    e.preventDefault()
    if (!window.confirm('确定撤销本次修改？简历将恢复到修改前的状态。')) return
    setReverting(resumeId)
    try {
      let targetRevisionId = revisionId
      if (!targetRevisionId) {
        // 兜底：获取最近的 revision
        const revisions = await apiRequest<{ id: number }[]>(`/api/v1/student/resumes/${resumeId}/revisions`)
        if (revisions.length === 0) {
          alert('没有可撤销的快照')
          return
        }
        targetRevisionId = revisions[0].id
      }
      const resp = await authenticatedFetch(`/api/v1/student/resumes/${resumeId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision_id: targetRevisionId }),
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        alert(err.detail || '撤销失败，请重试')
        return
      }
      alert('已撤销修改')
    } catch {
      alert('撤销失败，请重试')
    } finally {
      setReverting(null)
    }
  }

  if (editorLinks.length === 0) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      {editorLinks.map((link) => (
        <span key={link.resumeId} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <a
            href={`/student/resumes/${link.resumeId}`}
            onClick={(e) => { e.preventDefault(); navigate(`/student/resumes/${link.resumeId}`) }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 14px', borderRadius: 10,
              border: '1px solid #C7D2FE', background: '#EEF2FF',
              color: '#4338CA', fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}
          >
            <IconFile />
            <span>{link.label}</span>
            <IconCaretRight />
          </a>
          {link.activityName === 'update_resume_data' && (
            <button
              type="button"
              onClick={(e) => void handleRevert(link.resumeId, link.revisionId, e)}
              disabled={reverting === link.resumeId}
              style={{
                padding: '6px 10px', borderRadius: 8,
                border: '1px solid #FCA5A5', background: '#FEF2F2',
                color: '#DC2626', fontSize: 12, cursor: 'pointer',
              }}
            >
              {reverting === link.resumeId ? '撤销中…' : '撤销本次修改'}
            </button>
          )}
        </span>
      ))}
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
  message, activities, files = [], pending = false, runtimeStatus, runtimeInfo, heartbeat, streamStartMs, segments,
}: {
  message: AgentMessage
  activities: AgentActivity[]
  files?: GeneratedFile[]
  pending?: boolean
  runtimeStatus?: RuntimeStatus
  runtimeInfo?: RuntimeInfo
  heartbeat?: { output_chars: number; phase: string }
  streamStartMs?: number | null
  segments?: TimelineSegment[]
}) {
  // 流式阶段使用 store 时间线；历史消息依据持久化 activity 的
  // content_offset 重建，保证工具轨迹不会随临时流式组件卸载而消失。
  const timelineSegments = segments?.length
    ? segments
    : activities.length
      ? buildTimelineSegments(message.content, activities)
      : []
  const hasSegments = timelineSegments.length > 0
  return (
    <div className="message-row assistant">
      <div className="assistant-message">
        {hasSegments ? (
          <TimelineRenderer segments={timelineSegments} />
        ) : (
          <>
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
          </>
        )}
        <ResumeEditorLinks activities={activities} />
        <GeneratedFileLinks files={files} />
        {(pending || runtimeInfo) && (
          <RuntimeStatusline
            pending={pending}
            heartbeat={heartbeat}
            runtimeStatus={runtimeStatus}
            runtimeInfo={runtimeInfo}
            activities={activities}
            streamStartMs={streamStartMs ?? null}
          />
        )}
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


/** 缓存的会话状态，用于并行对话切换时保留各会话的 UI 状态 */
type SavedSessionState = {
  messages: AgentMessage[]
  activities: AgentActivity[]
  generatedFiles: Record<number, GeneratedFile[]>
  runtimeStatuses: Record<number, RuntimeStatus>
  runtimeInfo: Record<number, RuntimeInfo>
  userMessageAttachments: Record<number, AgentAttachment[]>
  storeSegments: TimelineSegment[]
  heartbeats: Record<number, { output_chars: number; phase: string }>
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
  onOpenProfile,
}: AgentChatViewProps) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'

  const [agentSession, setAgentSession] = useState<AgentChatSession | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [generatedFiles, setGeneratedFiles] = useState<Record<number, GeneratedFile[]>>({})
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<number, RuntimeStatus>>({})
  const [runtimeInfo, setRuntimeInfo] = useState<Record<number, RuntimeInfo>>({})
  const [heartbeats, setHeartbeats] = useState<Record<number, { output_chars: number; phase: string }>>({})
  const [storeSegments, setStoreSegments] = useState<TimelineSegment[]>([])
  const streamStartRef = useRef<number | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('medium')
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [activeResumeId, setActiveResumeId] = useState<number | null>(null)
  const [memoryPanelVisible, setMemoryPanelVisible] = useState(false)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [userMessageAttachments, setUserMessageAttachments] = useState<Record<number, AgentAttachment[]>>({})
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // 新用户提示：个人档案未填写完整（教育/经历/技能等任一板块缺失）时，弹窗建议先去完善；
  // 注意：注册时系统会给默认姓名「同学」，所以不能只看姓名，要看整体完整度。填完整后自动不再弹。
  const [profilePromptVisible, setProfilePromptVisible] = useState(false)
  const profilePromptHandledRef = useRef(false)  // 本次加载只判定一次，避免重复弹

  useEffect(() => {
    if (agentType !== 'resume' || messages.length > 0 || profilePromptHandledRef.current) return
    apiRequest<{ items: Record<string, boolean>; missing: string[] }>('/api/v1/student/profile/completeness')
      .then((c) => {
        profilePromptHandledRef.current = true
        if ((c.missing?.length ?? 0) > 0) setProfilePromptVisible(true)
      })
      .catch(() => {})
  }, [agentType, messages.length])


  const sessionCache = useRef<Map<number, SavedSessionState>>(new Map())  // 并行对话：缓存各 session 的 UI 状态
  const pendingResumeNavRef = useRef<number | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const optimisticIdRef = useRef(-1)
  const isNearBottomRef = useRef(true)
  const dragCounterRef = useRef(0)
  const [showScrollBtn, setShowScrollBtn] = useState(false)

  // ── Store sync ────────────────────────────────────────────────────────────
  const [storeTick, setStoreTick] = useState(0)
  useEffect(() => {
    return chatRuntimeStore.subscribe(() => setStoreTick((t) => t + 1))
  }, [])

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

  // ── 并行对话：计算当前 session 是否正在运行 ─────────────────────────────
  const currentSessionId = agentSession?.id ?? null
  const isCurrentStreaming = currentSessionId != null ? chatRuntimeStore.isRunning(currentSessionId) : false

  // Load session when loadTrigger increments — 并行对话：切换会话时保留状态、不中断运行
  useEffect(() => {
    if (loadTrigger === 0 || !sessionToLoad) return

    // 1. 保存当前 session 的 UI 状态到缓存（不 abort 正在运行的任务）
    if (agentSession?.id) {
      sessionCache.current.set(agentSession.id, {
        messages,
        activities,
        generatedFiles,
        runtimeStatuses,
        runtimeInfo,
        userMessageAttachments,
        storeSegments,
        heartbeats,
      })
      // 限制缓存大小：最多保留 5 个 session
      if (sessionCache.current.size > 5) {
        const oldest = sessionCache.current.keys().next().value
        if (oldest != null) sessionCache.current.delete(oldest)
      }
    }

    // 如果目标就是当前 session，不重复加载
    if (sessionToLoad.id === agentSession?.id) return

    setNotice(null)
    setPendingAttachments([])

    // 2. 优先从缓存恢复
    const cached = sessionCache.current.get(sessionToLoad.id)
    if (cached) {
      setHistoryLoading(false)
      // 需要从 API 获取 session 元数据（title 等可能更新了）
      apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${sessionToLoad.id}/messages?limit=0`)
        .then((history) => { setAgentSession(history.session); setActiveResumeId(history.session.active_resume_id ?? null) })
        .catch(() => {
          // 兜底：构造一个最小 session 对象
          setAgentSession({ id: sessionToLoad.id, title: sessionToLoad.title, status: 'active', agent_type: agentType, created_at: '', updated_at: '' })
        })
      setMessages(cached.messages)
      setActivities(cached.activities)
      setGeneratedFiles(cached.generatedFiles)
      setRuntimeStatuses(cached.runtimeStatuses)
      setRuntimeInfo(cached.runtimeInfo)
      setUserMessageAttachments(cached.userMessageAttachments)
      setStoreSegments(cached.storeSegments)
      setHeartbeats(cached.heartbeats)
      return
    }

    // 3. 无缓存 → 正常 API 加载
    setHistoryLoading(true)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})

    apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${sessionToLoad.id}/messages`)
      .then((history) => {
        setAgentSession(history.session)
        setActiveResumeId(history.session.active_resume_id ?? null)
        setMessages(history.messages)
        setActivities(history.activities)
        setRuntimeInfo(Object.fromEntries(
          history.messages
            .filter((message) => message.role === 'assistant' && message.duration_ms)
            .map((message) => [message.id, {
              message_id: message.id,
              model_name: message.model_name || '未知模型',
              prompt_tokens: message.prompt_tokens || 0,
              completion_tokens: message.completion_tokens || 0,
              total_tokens: message.total_tokens || 0,
              duration_ms: message.duration_ms || 0,
            }]),
        ))
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
    // 并行对话：新建对话前保存当前 session 状态（不 abort 正在运行的任务）
    if (agentSession?.id) {
      sessionCache.current.set(agentSession.id, {
        messages, activities, generatedFiles, runtimeStatuses,
        runtimeInfo, userMessageAttachments, storeSegments, heartbeats,
      })
    }
    setAgentSession(null)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})
    setHeartbeats({})
    setStoreSegments([])
    streamStartRef.current = null
    setPendingAttachments([])
    setGeneratedFiles({})
    setInputValue('')
    setNotice(null)
    setActiveResumeId(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newChatTrigger])

  const createAgentSession = useCallback(async () => {
    const body: Record<string, unknown> = { title: '新对话', agent_type: agentType }
    if (activeResumeId) body.active_resume_id = activeResumeId
    const created = await apiRequest<AgentChatSession>('/api/v1/student/master/sessions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    setAgentSession(created)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})
    setHeartbeats({})
    streamStartRef.current = null
    setPendingAttachments([])
    setGeneratedFiles({})
    return created
  }, [agentType, activeResumeId])

  // 工作简历切换：已有 session 走 PATCH，否则只存 state
  const handleResumeChange = useCallback(async (resumeId: number | null) => {
    setActiveResumeId(resumeId)
    if (agentSession?.id) {
      try {
        await apiRequest<AgentChatSession>(`/api/v1/student/master/sessions/${agentSession.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active_resume_id: resumeId }),
        })
      } catch {
        // silent — state already updated locally
      }
    }
  }, [agentSession?.id])

  // 从 activity.completed 事件同步 activeResumeId（AI 生成/优化简历后自动绑定）
  useEffect(() => {
    for (const a of activities) {
      if (a.status !== 'completed') continue
      const detail = a.detail || {}
      if ((a.name === 'generate_resume_data' || a.name === 'optimize_resume_data' || a.name === 'update_resume_data')
        && typeof detail?.resume_id === 'number') {
        setActiveResumeId(detail.resume_id as number)
      }
    }
  }, [activities])


  const ensureResumeCapacity = async () => {
    try {
      const resumes = await apiRequest<unknown[]>('/api/v1/student/resumes')
      if (resumes.length >= MAX_RESUMES) {
        setNotice(`简历数量已达上限（${MAX_RESUMES} 份），请先前往「简历制作」删除一份简历后再继续生成。`)
        return false
      }
      return true
    } catch (error) {
      setNotice(error instanceof ApiError ? error.message : '暂时无法检查简历数量，请稍后重试')
      return false
    }
  }

  const startResumeCreation = async () => {
    if (!(await ensureResumeCapacity())) return
    await submitMessage('AI简历制作：请先读取我的个人信息，然后帮我制作一份针对目标岗位的简历')
  }

  const startResumeOptimization = async () => {
    try {
      const list = await apiRequest<{ id: number; title: string }[]>('/api/v1/student/resumes')
      if (list.length === 0) {
        // 0 份简历：引导去简历中心导入
        Modal.confirm({
          title: '还没有在线简历',
          content: '先把简历上传到简历中心，AI 就能直接优化它。',
          okText: '去导入简历',
          cancelText: '取消',
          onOk: () => navigate('/student/resumes?import=1'),
        })
        return
      }
      if (list.length === 1) {
        // 1 份：自动绑定为工作简历
        await handleResumeChange(list[0].id)
        setInputValue('请优化这份简历。目标岗位 JD：\n（在这里粘贴 JD）')
      } else {
        // 多份：预填提示，用户通过 ResumeSelector 选择
        setInputValue('请优化我的工作简历。目标岗位 JD：\n（在这里粘贴 JD）')
      }
    } catch {
      // silent
    }
  }

  const submitMessage = async (preset?: string) => {
    const text = (preset ?? inputValue).trim()
    const hasAttachments = pendingAttachments.length > 0
    if ((!text && !hasAttachments) || isCurrentStreaming) return
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
    setRuntimeStatuses({})
    setHeartbeats({})
    setStoreSegments([])
    streamStartRef.current = Date.now()
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

    // Store-driven streaming: chatRuntimeStore manages the SSE connection
    try {
      await chatRuntimeStore.startRun(
        currentSession.id,
        agentType,
        {
          content,
          model_id: selectedModelId,
          reasoning_effort: reasoningEffort,
          attachment_ids: sendingAttachments.map((a) => a.id),
          optimisticUserMessageId: optimisticId,
          sendingAttachments,
        },
        {
          onSessionUpdated: (sess) => onSessionUpdated(sess as AgentChatSession),
          onResumeNav: (resumeId) => {
            pendingResumeNavRef.current = resumeId
          },
        },
      )
      // After startRun resolves, check pending resume navigation
      if (pendingResumeNavRef.current !== null) {
        const resumeId = pendingResumeNavRef.current
        pendingResumeNavRef.current = null
        navigate(`/student/resumes/${resumeId}`)
      }
      // Check store error
      const storeState = chatRuntimeStore.getState(currentSession.id)
      if (storeState?.error) {
        const message = storeState.error
        const hint = message.includes('上下文预算') ? '对话内容较长，建议新建对话继续。'
          : message.includes('事实校验') ? '部分内容缺少事实依据，请补充材料后重试。'
          : message === 'Failed to fetch' ? '无法连接后端服务，请稍后重试'
          : message
        setNotice(hint)
        setPendingAttachments((prev) => [...sendingAttachments, ...prev])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '回复失败'
      const hint = message.includes('上下文预算') ? '对话内容较长，建议新建对话继续。'
        : message.includes('事实校验') ? '部分内容缺少事实依据，请补充材料后重试。'
        : message === 'Failed to fetch' ? '无法连接后端服务，请稍后重试'
        : message
      setNotice(hint)
      setPendingAttachments((prev) => [...sendingAttachments, ...prev])
    } finally {
      setStreaming(false)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const scrollToBottom = () => {
    const node = threadRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
  }

  const stopStreaming = () => {
    if (agentSession?.id != null) chatRuntimeStore.abortSession(agentSession.id)
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
        const response = await authenticatedFetch(
          `/api/v1/student/master/sessions/${sess.id}/attachments`,
          { method: 'POST', body: form },
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

  // ── Sync store events → component state ──────────────────────────────────
  useEffect(() => {
    const sid = agentSession?.id
    if (sid == null || storeTick === 0) return // storeTick===0 means no store notify yet
    const storeState = chatRuntimeStore.getState(sid)
    if (!storeState) return

    // Update streaming flag from store（并行对话：仅跟踪当前 session 的状态）
    setStreaming(storeState.streaming || false)

    // Sync stream start ref
    if (storeState.streamStartMs != null) {
      streamStartRef.current = storeState.streamStartMs
    }

    // Sync segments
    if (storeState.segments.length > 0) {
      setStoreSegments(storeState.segments)
    }

    // Sync activities
    if (storeState.activities.length > 0) {
      setActivities((prev) => {
        const merged = [...prev]
        for (const act of storeState.activities) {
          const idx = merged.findIndex((a) => a.id === act.id)
          if (idx >= 0) merged[idx] = act
          else merged.push(act)
        }
        return merged
      })
    }

    // Sync runtime status
    if (storeState.runtimeStatus) {
      setRuntimeStatuses((prev) => ({ ...prev, [storeState.runtimeStatus!.message_id]: storeState.runtimeStatus! }))
    } else {
      // Clear runtime statuses when store has none
      setRuntimeStatuses({})
    }

    // Sync heartbeat
    if (storeState.heartbeat) {
      setHeartbeats((prev) => ({ ...prev, [storeState.heartbeat!.message_id]: { output_chars: storeState.heartbeat!.output_chars, phase: storeState.heartbeat!.phase } }))
    }

    // Sync runtime info
    if (storeState.runtimeInfo) {
      setRuntimeInfo((prev) => ({ ...prev, [storeState.runtimeInfo!.message_id]: storeState.runtimeInfo! }))
    }

    // Sync assistant content (delta-based incremental append)
    if (storeState.assistantContent && storeState.assistantMessageId) {
      // store.assistantContent 是全量累加内容，组件 messages 里已有部分内容，
      // 只追加增量部分，避免复读
      const fullContent = storeState.assistantContent
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === storeState.assistantMessageId)
        if (idx < 0) {
          return [...prev, { id: storeState.assistantMessageId!, session_id: sid, role: 'assistant', content: fullContent, created_at: new Date().toISOString() }]
        }
        const existing = prev[idx].content
        if (fullContent.length <= existing.length) return prev // 无新内容
        const delta = fullContent.slice(existing.length)
        if (!delta) return prev
        const next = [...prev]
        next[idx] = { ...next[idx], content: existing + delta }
        return next
      })
    }

    // Sync message.saved：把乐观负数 id 替换为数据库真实 id。
    // 活动(activity)事件按 user_message 的真实 id 关联——不替换的话，
    // 流式期间步骤列表按 message_id 过滤永远匹配不上，整个执行过程区域不渲染。
    const realUserMsgId = storeState.pendingUserMessageId
    if (typeof realUserMsgId === 'number' && realUserMsgId > 0) {
      setMessages((prev) => {
        if (prev.some((m) => m.id === realUserMsgId)) return prev
        let optimisticIdx = -1
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === 'user' && prev[i].id < 0) { optimisticIdx = i; break }
        }
        if (optimisticIdx < 0) return prev
        const next = [...prev]
        next[optimisticIdx] = { ...next[optimisticIdx], id: realUserMsgId }
        return next
      })
      setUserMessageAttachments((prev) => {
        const negKey = Object.keys(prev).map(Number).find((k) => k < 0)
        if (negKey == null || prev[realUserMsgId]) return prev
        const { [negKey]: moved, ...rest } = prev
        return { ...rest, [realUserMsgId]: moved }
      })
    }

    // Sync generated files
    for (const [msgId, files] of storeState.generatedFiles) {
      setGeneratedFiles((prev) => {
        const list = prev[msgId] ?? []
        const newFiles = files.filter((f) => !list.some((l) => l.attachment_id === f.attachment_id))
        if (newFiles.length === 0) return prev
        return { ...prev, [msgId]: [...list, ...newFiles] }
      })
    }

    // Sync user attachments
    for (const [msgId, atts] of storeState.userAttachments) {
      setUserMessageAttachments((prev) => ({ ...prev, [msgId]: atts as AgentAttachment[] }))
    }
  }, [storeTick, agentSession?.id])

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
            onClick={() => void startResumeCreation()}
          >
            <strong>AI订制简历</strong>
            <span>读取个人信息档案，结合你提供的目标岗位 JD，自动生成一份在线简历。</span>
          </button>
          <button
            className="agent-home-card"
            type="button"
            onClick={() => void startResumeOptimization()}
          >
            <strong>简历优化</strong>
            <span>选择一份在线简历 + 粘贴目标岗位 JD，AI 直接优化并保存。</span>
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
            className="agent-home-card agent-home-card--centered"
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
              pending={streaming && index === messages.length - 1}
              runtimeStatus={runtimeStatuses[message.id]}
              runtimeInfo={runtimeInfo[message.id]}
              heartbeat={heartbeats[message.id]}
              streamStartMs={streamStartRef.current}
              segments={index === messages.length - 1 ? storeSegments : undefined}
            />
          ),
        )}

        {streaming && latestUserMessage && !hasAssistantAfterLatestUser && (
          <AssistantMessage
            message={{ id: 0, session_id: latestUserMessage.session_id, role: 'assistant', content: '', created_at: new Date().toISOString() }}
            activities={activities.filter((a) => a.message_id === latestUserMessage.id)}
            runtimeStatus={Object.values(runtimeStatuses).at(-1)}
            heartbeat={Object.values(heartbeats).at(-1)}
            streamStartMs={streamStartRef.current}
            pending
            segments={storeSegments}
          />
        )}
      </div>

      {showScrollBtn && (
        <button
          type="button"
          className="scroll-to-bottom-btn"
          title="回到底部"
          aria-label="回到底部"
          onClick={scrollToBottom}
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

        {(agentType === 'resume' || pendingAttachments.length > 0) && (
          <div className="attachment-chip-row">
            {agentType === 'resume' && (
              <ResumeSelector
                activeResumeId={activeResumeId}
                onResumeChange={(id) => void handleResumeChange(id)}
                disabled={streaming}
              />
            )}
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
            {agentType === 'resume' && agentSession?.id && (
              <div style={{ position: 'relative' }}>
                <Tooltip content="查看本次对话记住的内容">
                  <button
                    type="button"
                    className="composer-add-btn"
                    onClick={() => setMemoryPanelVisible((v) => !v)}
                    style={memoryPanelVisible ? { background: '#EEF2FF', color: '#4338CA' } : undefined}
                  >
                    <IconMindMapping />
                  </button>
                </Tooltip>
                <MemoryPanel
                  sessionId={agentSession.id}
                  visible={memoryPanelVisible}
                />
              </div>
            )}
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

      {/* 新用户提示：建议先去个人档案填好个人信息 */}
      <Modal
        visible={profilePromptVisible}
        title="欢迎使用 👋"
        onCancel={() => setProfilePromptVisible(false)}
        okText="去完善个人档案"
        cancelText="暂不"
        onOk={() => { setProfilePromptVisible(false); onOpenProfile?.() }}
        maskClosable
        style={{ width: 420 }}
      >
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.8, color: '#4E5969' }}>
          建议你先到「个人档案」把个人信息填写完整，这样 AI 助手才能更好地为你订制和优化简历。
        </p>
      </Modal>
    </main>
  )
}
