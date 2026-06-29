import { Input, Message, Modal, Skeleton, Tooltip } from '@arco-design/web-react'
import {
  IconArrowRight,
  IconAttachment,
  IconBook,
  IconBulb,
  IconCaretDown,
  IconCaretRight,
  IconCheck,
  IconClose,
  IconCode,
  IconCopy,
  IconDashboard,
  IconDelete,
  IconDownload,
  IconEdit,
  IconExport,
  IconFile,
  IconFilePdf,
  IconHistory,
  IconImage,
  IconLink,
  IconLoading,
  IconMindMapping,
  IconNotification,
  IconPlus,
  IconRobot,
  IconSearch,
  IconSend,
  IconUndo,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ChangeEvent, ComponentType, CSSProperties, KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, apiRequest, authenticatedFetch } from '../shared/api'
import { AnnouncementBanner } from './StudentAnnouncementBar'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { useAuth } from '../shared/auth'
import { getResume } from '../resume/api'
import type { ResumeData } from '../resume/types'
import { ResumeLivePreviewPanel } from './ResumeLivePreviewPanel'
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

type QueuedMessage = {
  id: number
  content: string
  attachments: AgentAttachment[]
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
  supported_efforts: string[]
}

type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

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
  /** 右侧简历实时预览：受控开关，由标题栏右上角按钮驱动 */
  resumePreviewVisible?: boolean
  resumePreviewWidth?: number
  onResumePreviewWidthChange?: (width: number) => void
  onResumePreviewClose?: () => void
  /** 当前工作简历变化时同步给父组件（用于决定预览按钮是否显示） */
  onActiveResumeIdChange?: (id: number | null) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────


const MAX_RESUMES = 6
const AUTO_ATTACHMENT_PROMPT = '请帮我分析上传的附件。'

async function copyMessageText(text: string) {
  if (!text.trim()) return
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try { document.execCommand('copy') } catch { /* noop */ }
    document.body.removeChild(ta)
  }
  Message.success('已复制')
}

function parseServerDate(value: string) {
  const raw = value.trim()
  if (!raw) return null
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)
  const date = new Date(hasTimezone ? raw : `${raw}Z`)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function formatMessageTime(value: string) {
  const date = parseServerDate(value)
  if (!date) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
}

const reasoningOptions: { value: ReasoningEffort; label: string; desc?: string }[] = [
  { value: 'auto', label: '自动', desc: '根据任务难度智能选择' },
  { value: 'low', label: '低', desc: '快速响应，简洁建议' },
  { value: 'medium', label: '中', desc: '平衡速度与质量' },
  { value: 'high', label: '高', desc: '充分分析，补齐细节' },
  { value: 'xhigh', label: '超高', desc: '系统拆解，多角度验证' },
  { value: 'max', label: '极限', desc: '穷举推理，最全面分析' },
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
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId)
  const supportedEfforts = selectedModel?.supported_efforts ?? ['low', 'medium', 'high']
  // "auto" 始终可用（服务端处理），其他档位按模型支持过滤
  const filteredOptions = reasoningOptions.filter((opt) => opt.value === 'auto' || supportedEfforts.includes(opt.value))
  const selectedReasoning = reasoningOptions.find((option) => option.value === reasoningEffort)

  useEffect(() => {
    if (!popupVisible) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopupVisible(false)
        setModelMenuVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [popupVisible])

  const closePicker = () => {
    setPopupVisible(false)
    setModelMenuVisible(false)
  }

  return (
    <div
      ref={containerRef}
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
            {filteredOptions.map((option) => {
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
                      onClick={() => {
                        onModelChange(model.id)
                        // 切换模型时，如果当前 effort 不是 auto 且不被新模型支持，自动调整
                        if (reasoningEffort !== 'auto') {
                          const newEfforts = model.supported_efforts ?? ['low', 'medium', 'high']
                          if (!newEfforts.includes(reasoningEffort)) {
                            onReasoningChange((newEfforts.includes('medium') ? 'medium' : newEfforts[0]) as ReasoningEffort)
                          }
                        }
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
  const containerRef = useRef<HTMLDivElement>(null)

  const activeResume = resumes.find((r) => r.id === activeResumeId)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!popupVisible) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPopupVisible(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [popupVisible])

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
      <div ref={containerRef} style={{ position: 'relative' }}>
        <span
          className="attachment-chip"
          style={{ cursor: disabled ? 'default' : 'pointer', background: '#EEF2FF', borderColor: '#C7D2FE', color: '#4338CA' }}
          onClick={handleOpen}
        >
          <IconFile style={{ fontSize: 15, opacity: 0.7 }} />
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
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="attachment-chip"
        style={{
          cursor: disabled ? 'default' : 'pointer',
          borderStyle: 'dashed',
          background: 'transparent',
          color: '#86909C',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
        disabled={disabled}
        onClick={handleOpen}
      >
        <IconFile style={{ fontSize: 15, opacity: 0.7 }} />
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
  apply_resume_patch: '修改并 Review 简历',
  export_resume_pdf: '导出简历 PDF',
  read_webpage: '读取网页',
  web_search: '搜索网络信息',
  analyze_jd_match: '分析 JD 匹配度',
  save_session_note: '记下要点',
  understand_image: '理解图片',
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
  if (activity.status === 'failed') {
    return activity.display_summary || `${action}需要轻微调整`
  }
  return `已${action}`
}

function activityStatusClass(activity: AgentActivity) {
  if (activity.status === 'failed') return 'status-hint'
  return `status-${activity.status}`
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

type ActivityIconComponent = ComponentType<{ className?: string; style?: CSSProperties }>

type ActivityIconSpec = {
  icon: ActivityIconComponent
  tone: string
}

const ACTIVITY_ICON_MAP: Record<string, ActivityIconSpec> = {
  query_student_profile: { icon: IconUser, tone: 'profile' },
  read_resume: { icon: IconFile, tone: 'resume' },
  analyze_uploaded_file: { icon: IconFilePdf, tone: 'file' },
  get_session_context: { icon: IconHistory, tone: 'context' },
  generate_resume_data: { icon: IconRobot, tone: 'generate' },
  optimize_resume_data: { icon: IconBulb, tone: 'optimize' },
  update_resume_data: { icon: IconEdit, tone: 'edit' },
  apply_resume_patch: { icon: IconEdit, tone: 'edit' },
  export_resume_pdf: { icon: IconExport, tone: 'export' },
  read_webpage: { icon: IconLink, tone: 'web' },
  web_search: { icon: IconSearch, tone: 'search' },
  analyze_jd_match: { icon: IconDashboard, tone: 'analysis' },
  save_session_note: { icon: IconCode, tone: 'note' },
  understand_image: { icon: IconImage, tone: 'vision' },
}

const KIND_ICON_MAP: Record<string, ActivityIconSpec> = {
  profile: { icon: IconUser, tone: 'profile' },
  resume: { icon: IconFile, tone: 'resume' },
  file: { icon: IconFilePdf, tone: 'file' },
  context: { icon: IconHistory, tone: 'context' },
  job: { icon: IconDashboard, tone: 'analysis' },
  knowledge: { icon: IconSearch, tone: 'search' },
  skill: { icon: IconRobot, tone: 'skill' },
  resume_skill: { icon: IconRobot, tone: 'skill' },
}

function activityPhaseIcon(name: string, kind: string): ActivityIconSpec {
  if (name.startsWith('skill__')) return { icon: IconRobot, tone: 'skill' }
  return ACTIVITY_ICON_MAP[name]
    || KIND_ICON_MAP[kind]
    || { icon: IconRobot, tone: 'neutral' }
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
  if (!primaryActivity) return null

  const { icon: ActivityIcon, tone } = activityPhaseIcon(primaryActivity.name, primaryActivity.kind)
  const isRunning = visibleActivities.some((activity) => activity.status === 'started')

  return (
    <div className={`activity-trace${isRunning ? ' is-running' : ''}`}>
      <Tooltip content={activityDisplayName(primaryActivity)} mini>
        <span className={`activity-trace-icon tone-${tone}`} aria-hidden="true">
          <ActivityIcon className="activity-trace-symbol" />
        </span>
      </Tooltip>
      <span className="activity-trace-copy">
        {visibleActivities.map((activity, index) => (
          <span key={activity.id}>
            {index > 0 && <span className="activity-trace-separator"> · </span>}
            <span className={`activity-trace-action ${activityStatusClass(activity)}`}>
              {activityAction(activity)}
            </span>
          </span>
        ))}
      </span>
    </div>
  )
}

function stripToolCallMarkup(content: string): string {
  return content
    .replace(/<tool_call\b[\s\S]*?<\/tool_call>/gi, '')
    .replace(/<tool_call\b[\s\S]*$/gi, '')
    .replace(/<function=[\s\S]*?<\/function>\s*/gi, '')
    .replace(/<function=[\s\S]*$/gi, '')
    .replace(/<parameter=[\s\S]*?<\/parameter>\s*/gi, '')
    .replace(/<parameter=[\s\S]*$/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 时间线渲染：工具动作固定在正文上方，避免正文被工具记录切开。 */
function TimelineRenderer({ segments }: { segments: TimelineSegment[] }) {
  const actionSegments = segments.filter((seg) => seg.type === 'actions')
  const textContent = segments
    .filter((seg): seg is Extract<TimelineSegment, { type: 'text' }> => seg.type === 'text')
    .map((seg) => seg.content)
    .join('')
  const cleanTextContent = stripToolCallMarkup(textContent)

  return (
    <div className="timeline-container">
      {actionSegments.map((seg, i) => (
        <ActivityTrace key={`a${i}`} segment={seg} />
      ))}
      {cleanTextContent ? (
        <div className="assistant-answer timeline-text">
          <MarkdownMessage content={cleanTextContent} />
        </div>
      ) : null}
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
  stepsPlan,
}: {
  pending: boolean
  heartbeat?: { output_chars: number; phase: string }
  runtimeStatus?: RuntimeStatus
  runtimeInfo?: RuntimeInfo
  activities: AgentActivity[]
  streamStartMs: number | null
  stepsPlan?: { steps: string[] } | null
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

  // P2.2: 步骤进度预告——纯静态列表，不做假进度追踪
  const planSteps = stepsPlan?.steps ?? []
  const showSteps = planSteps.length > 1

  return (
    <div>
      <div className="runtime-statusline">
        <span className="status-logo-wrap"><img className="status-logo" src="/baidi.png" alt="" /></span>
        <span>{formatElapsed(elapsed)}</span>
        <span className="rs-dot">·</span>
        <span>{formatTokens(outputChars)} tokens</span>
        <span className="rs-dot">·</span>
        <span className="rs-label">{label}</span>
      </div>
      {showSteps && (
        <div className="runtime-steps-plan">
          {planSteps.map((step) => (
            <span key={step} className="plan-step current">
              <span className="plan-step-dot">●</span>
              <span className="plan-step-label">{step}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ResumeEditorLinks({ activities }: { activities: AgentActivity[] }) {
  const navigate = useNavigate()
  const [reverting, setReverting] = useState<number | null>(null)
  const [revertedResumeIds, setRevertedResumeIds] = useState<Set<number>>(new Set())
  const editorLinks = useMemo(() => {
    const links = new Map<number, { resumeId: number; label: string; activityName: string; revisionId?: number; reviewPassed?: boolean }>()
    for (const a of [...activities].sort((left, right) => left.id - right.id)) {
      if (a.status !== 'completed') continue
      const detail = a.detail || {}
      if (detail?.open_resume_editor && typeof detail?.resume_id === 'number') {
        const label = a.name === 'generate_resume_data' ? '查看生成的简历'
          : a.name === 'optimize_resume_data' ? '查看优化后的简历'
          : a.name === 'apply_resume_patch' ? '查看修改后的简历'
          : a.name === 'update_resume_data' ? '查看修改后的简历'
          : '查看简历'
        links.set(detail.resume_id as number, {
          resumeId: detail.resume_id as number,
          label,
          activityName: a.name,
          revisionId: typeof detail?.revision_id === 'number' ? detail.revision_id as number : undefined,
          reviewPassed: detail?.review_passed === true,
        })
      }
    }
    return [...links.values()]
  }, [activities])

  const handleRevert = (resumeId: number, revisionId: number | undefined) => {
    Modal.confirm({
      className: 'resume-revert-confirm',
      title: '撤销本次修改？',
      content: '简历会恢复到这次 AI 修改之前的状态。',
      okText: '撤销修改',
      cancelText: '再想想',
      icon: <IconUndo />,
      okButtonProps: { className: 'resume-revert-confirm-ok' },
      cancelButtonProps: { className: 'resume-revert-confirm-cancel' },
      onOk: () => doRevert(resumeId, revisionId),
    })
  }

  const doRevert = async (resumeId: number, revisionId: number | undefined) => {
    setReverting(resumeId)
    try {
      let targetRevisionId = revisionId
      if (!targetRevisionId) {
        // 兜底：获取最近的 revision
        const revisions = await apiRequest<{ id: number }[]>(`/api/v1/student/resumes/${resumeId}/revisions`)
        if (revisions.length === 0) {
          Message.warning('没有可撤销的快照')
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
        Message.error(err.detail || '撤销失败，请重试')
        return
      }
      // 撤销成功：标记该链接已撤销（按钮消失，给出即时反馈）
      setRevertedResumeIds((prev) => new Set(prev).add(resumeId))
      Message.success('已撤销修改，简历已恢复')
    } catch {
      Message.error('撤销失败，请重试')
    } finally {
      setReverting(null)
    }
  }

  const title = editorLinks.length > 1
    ? `已更新 ${editorLinks.length} 份简历`
    : editorLinks[0]?.activityName === 'generate_resume_data'
      ? '已生成简历'
      : editorLinks[0]?.activityName === 'optimize_resume_data'
        ? '已优化简历'
        : editorLinks[0]?.activityName === 'apply_resume_patch'
          ? '已修改简历'
        : '已修改简历'

  if (editorLinks.length === 0) return null
  return (
    <div className="resume-result-card">
      <div className="resume-result-card-head">
        <button
          type="button"
          className="resume-result-card-main"
          onClick={() => navigate(`/student/resumes/${editorLinks[0].resumeId}`)}
        >
          <span className="resume-result-card-icon" aria-hidden="true">
            <IconEdit />
          </span>
          <span className="resume-result-card-copy">
            <span className="resume-result-card-title">{title}</span>
            <span className="resume-result-card-meta">
              <span className="resume-result-card-link">
                查看简历 <IconCaretRight />
              </span>
              {editorLinks.some((link) => link.reviewPassed) && (
                <span className="resume-result-card-review">
                  <IconCheck /> 内容检查通过
                </span>
              )}
            </span>
          </span>
        </button>
        <div className="resume-result-card-actions">
          {editorLinks.some((link) => (link.activityName === 'update_resume_data' || link.activityName === 'apply_resume_patch') && !revertedResumeIds.has(link.resumeId)) && (
            <button
              type="button"
              className={`resume-result-card-revert${reverting !== null ? ' is-loading' : ''}`}
              onClick={() => {
                const target = editorLinks.find((link) => (link.activityName === 'update_resume_data' || link.activityName === 'apply_resume_patch') && !revertedResumeIds.has(link.resumeId))
                if (target) handleRevert(target.resumeId, target.revisionId)
              }}
              disabled={reverting !== null}
            >
              {reverting !== null ? <IconLoading /> : <IconUndo />}
              <span>{reverting !== null ? '正在撤销' : '撤销本次修改'}</span>
            </button>
          )}
          {editorLinks.some((link) => (link.activityName === 'update_resume_data' || link.activityName === 'apply_resume_patch') && revertedResumeIds.has(link.resumeId)) && (
            <span className="resume-result-card-reverted" role="status">
              <IconCheck /> 已撤销
            </span>
          )}
        </div>
      </div>
      {editorLinks.length > 1 && (
        <div className="resume-result-card-list">
          {editorLinks.map((link) => (
            <button
              type="button"
              key={link.resumeId}
              className="resume-result-card-row"
              onClick={() => navigate(`/student/resumes/${link.resumeId}`)}
            >
              <span>{link.label}</span>
              <span className="resume-result-card-row-action">
                打开 <IconCaretRight />
              </span>
            </button>
          ))}
        </div>
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

function AssistantMessage({
  message, activities, files = [], pending = false, runtimeStatus, runtimeInfo, heartbeat, streamStartMs, segments, stepsPlan,
  suggestions,
  onSuggestionClick,
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
  stepsPlan?: { steps: string[] } | null
  suggestions?: string[]
  onSuggestionClick?: (text: string) => void
}) {
  // 流式阶段使用 store 时间线；历史消息依据持久化 activity 的
  // content_offset 重建，保证工具轨迹不会随临时流式组件卸载而消失。
  const timelineSegments = segments?.length
    ? segments
    : activities.length
      ? buildTimelineSegments(message.content, activities)
      : []
  const hasSegments = timelineSegments.length > 0
  const cleanMessageContent = stripToolCallMarkup(message.content)
  return (
    <div className="message-row assistant">
      <div className="assistant-message">
        {hasSegments ? (
          <TimelineRenderer segments={timelineSegments} />
        ) : (
          <>
            {cleanMessageContent ? (
              <div className="assistant-answer">
                <MarkdownMessage content={cleanMessageContent} />
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
        {!pending && cleanMessageContent.trim() && (
          <div className="assistant-message-actions">
            <button type="button" className="message-action-btn" aria-label="复制回复" onClick={() => void copyMessageText(cleanMessageContent)}>
              <IconCopy />
            </button>
          </div>
        )}
        <ResumeEditorLinks activities={activities} />
        <GeneratedFileLinks files={files} />
        {!pending && suggestions && suggestions.length > 0 && onSuggestionClick && (
          <MessageSuggestions suggestions={suggestions} onSuggestionClick={onSuggestionClick} />
        )}
        {(pending || runtimeInfo) && (
          <RuntimeStatusline
            pending={pending}
            heartbeat={heartbeat}
            runtimeStatus={runtimeStatus}
            runtimeInfo={runtimeInfo}
            activities={activities}
            streamStartMs={streamStartMs ?? null}
            stepsPlan={stepsPlan}
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
  const [scale, setScale] = useState(1)
  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = src
    a.download = 'image'
    a.click()
  }
  return (
    <div className="image-lightbox-overlay" onClick={onClose}>
      <div className="image-lightbox-content" onClick={(e) => e.stopPropagation()}>
        <div className="image-lightbox-toolbar">
          <button onClick={() => setScale(s => Math.max(0.25, s - 0.25))} title="缩小"><span style={{fontSize:18}}>−</span></button>
          <span style={{fontSize:13,color:'#fff',minWidth:40,textAlign:'center'}}>{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale(s => Math.min(5, s + 0.25))} title="放大"><span style={{fontSize:18}}>+</span></button>
          <div style={{width:1,height:20,background:'rgba(255,255,255,0.3)',margin:'0 8px'}}/>
          <button onClick={handleDownload} title="下载"><IconDownload /></button>
          <button onClick={onClose} title="关闭"><IconClose /></button>
        </div>
        <div className="image-lightbox-img-wrap">
          <img src={src} alt="preview" style={{transform:`scale(${scale})`,transition:'transform 0.2s ease'}} />
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
  stepsPlan: { steps: string[] } | null
  messageSuggestions: Record<number, string[]>
  queue: QueuedMessage[]
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
  resumePreviewVisible = false,
  resumePreviewWidth = 420,
  onResumePreviewWidthChange,
  onResumePreviewClose,
  onActiveResumeIdChange,
}: AgentChatViewProps) {
  const { session } = useAuth()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'
  const studentNickname = (session?.profile.nickname as string) || studentName

  const [agentSession, setAgentSession] = useState<AgentChatSession | null>(null)
  // 跟踪最新的 agentSession：state 在闭包里是旧值，ref 是同步最新值，
  // 用于 createAgentSession 异步期间检测用户是否已切到别的会话。
  const agentSessionRef = useRef<AgentChatSession | null>(agentSession)
  useEffect(() => { agentSessionRef.current = agentSession }, [agentSession])
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [activities, setActivities] = useState<AgentActivity[]>([])
  const [generatedFiles, setGeneratedFiles] = useState<Record<number, GeneratedFile[]>>({})
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<number, RuntimeStatus>>({})
  const [runtimeInfo, setRuntimeInfo] = useState<Record<number, RuntimeInfo>>({})
  const [heartbeats, setHeartbeats] = useState<Record<number, { output_chars: number; phase: string }>>({})
  const [storeSegments, setStoreSegments] = useState<TimelineSegment[]>([])
  const [stepsPlan, setStepsPlan] = useState<{ steps: string[] } | null>(null)
  const [messageSuggestions, setMessageSuggestions] = useState<Record<number, string[]>>({})
  const streamStartRef = useRef<number | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editingMessageText, setEditingMessageText] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null)
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto')
  const [pendingAttachments, setPendingAttachments] = useState<AgentAttachment[]>([])
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [activeResumeId, setActiveResumeId] = useState<number | null>(null)
  // ── 右侧简历实时预览 ──
  // 预览的开关/宽度由父组件（标题栏右上角按钮）受控；这里只保留简历内容、加载态、刷新信号
  const [resumePreviewData, setResumePreviewData] = useState<ResumeData | null>(null)
  const [resumePreviewLoading, setResumePreviewLoading] = useState(false)
  const [resumePreviewTick, setResumePreviewTick] = useState(0)
  const previewResizeRef = useRef(false)
  const previewStartXRef = useRef(0)
  const previewStartWidthRef = useRef(0)
  const lastResumeTickRef = useRef(0)
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const [userMessageAttachments, setUserMessageAttachments] = useState<Record<number, AgentAttachment[]>>({})
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  // 待发队列：模型流式回复时，用户继续输入的消息先堆在这里，不打断当前回复
  const [queue, setQueue] = useState<QueuedMessage[]>([])
  const queuedIdRef = useRef(-1000)
  const drainingRef = useRef(false)        // 防止队列自动发送重入
  const wasStreamingRef = useRef(false)    // 记录上一帧 streaming，用于检测 true→false 转换

  // 新用户提示：个人档案未填写完整时弹窗。档案完善后永不弹出。
  const [profilePromptVisible, setProfilePromptVisible] = useState(false)
  const profilePromptHandledRef = useRef(false)

  useEffect(() => {
    if (agentType !== 'resume' || messages.length > 0 || profilePromptHandledRef.current) return
    // 如果用户之前已关闭过弹窗，本次不再检查
    if (localStorage.getItem('zhipei-profile-prompt-dismissed') === '1') {
      profilePromptHandledRef.current = true
      return
    }
    apiRequest<{ items: Record<string, boolean>; missing: string[] }>('/api/v1/student/profile/completeness')
      .then((c) => {
        profilePromptHandledRef.current = true
        if ((c.missing?.length ?? 0) > 0) {
          setProfilePromptVisible(true)
        } else {
          // 档案已完善，标记为不再弹出
          localStorage.setItem('zhipei-profile-prompt-dismissed', '1')
        }
      })
      .catch(() => { profilePromptHandledRef.current = true })
  }, [agentType, messages.length])


  const sessionCache = useRef<Map<number, SavedSessionState>>(new Map())  // 并行对话：缓存各 session 的 UI 状态
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
        stepsPlan,
        messageSuggestions,
        queue,
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
    setEditingMessageId(null)
    setEditingMessageText('')

    // 2. 优先从缓存恢复
    const cached = sessionCache.current.get(sessionToLoad.id)
    // 恢复目标会话的排队内容（无缓存则清空，避免串入其他会话的待发消息）
    setQueue(cached?.queue ?? [])
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
      setStepsPlan(cached.stepsPlan ?? null)
      setMessageSuggestions(cached.messageSuggestions ?? {})
      setQueue(cached.queue ?? [])
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
        // Restore user attachments (images + files) for display in the user bubble
        const userMsgAttachments: Record<number, AgentAttachment[]> = {}
        for (const a of history.attachments) {
          if (a.message_id && history.messages.some((m) => m.id === a.message_id && m.role === 'user')) {
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
        runtimeInfo, userMessageAttachments, storeSegments, heartbeats, stepsPlan,
        messageSuggestions, queue,
      })
    }
    setAgentSession(null)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})
    setHeartbeats({})
    setStoreSegments([])
    setStepsPlan(null)
    setMessageSuggestions({})
    streamStartRef.current = null
    setPendingAttachments([])
    setGeneratedFiles({})
    setInputValue('')
    setNotice(null)
    setActiveResumeId(null)
    setQueue([])
    setEditingMessageId(null)
    setEditingMessageText('')
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
    const prev = activeResumeId
    setActiveResumeId(resumeId) // 乐观更新，UI 立即响应
    if (agentSession?.id) {
      try {
        await apiRequest<AgentChatSession>(`/api/v1/student/master/sessions/${agentSession.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active_resume_id: resumeId }),
        })
      } catch (err: unknown) {
        setActiveResumeId(prev) // 失败回滚，避免下次修改落到旧简历
        const detail = (err as { detail?: string })?.detail
        Message.error(detail || '切换工作简历失败，请重试')
      }
    }
  }, [agentSession?.id, activeResumeId])

  // 右侧预览面板：拖拽调宽（宽度提升到父组件受控，松手时持久化）
  const handlePreviewResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    previewResizeRef.current = true
    previewStartXRef.current = e.clientX
    previewStartWidthRef.current = resumePreviewWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.classList.add('is-resizing')
  }, [resumePreviewWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!previewResizeRef.current) return
      // 右侧面板：鼠标向左拖（delta 负）宽度变大
      const next = Math.min(720, Math.max(280, previewStartWidthRef.current - (e.clientX - previewStartXRef.current)))
      onResumePreviewWidthChange?.(next)
    }
    const onUp = () => {
      if (!previewResizeRef.current) return
      previewResizeRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.body.classList.remove('is-resizing')
      // 宽度持久化由父组件负责（onResumePreviewWidthChange 会更新父 state 并存 localStorage）
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [onResumePreviewWidthChange])

  // 从 activity.completed 事件同步 activeResumeId（AI 生成/优化简历后自动绑定）
  useEffect(() => {
    for (const a of activities) {
      if (a.status !== 'completed') continue
      const detail = a.detail || {}
      if ((a.name === 'generate_resume_data' || a.name === 'optimize_resume_data' || a.name === 'update_resume_data' || a.name === 'apply_resume_patch')
        && typeof detail?.resume_id === 'number') {
        setActiveResumeId(detail.resume_id as number)
      }
    }
  }, [activities])

  // 当前工作简历变化时同步给父组件（父组件据此决定右上角「简历预览」按钮是否显示）
  useEffect(() => {
    onActiveResumeIdChange?.(activeResumeId)
  }, [activeResumeId, onActiveResumeIdChange])

  // 右侧简历实时预览：选中工作简历时加载；AI 改完简历（resumePreviewTick 变化）后强制刷新最新内容。
  // 仅简历助手显示预览面板，面试官不显示。
  useEffect(() => {
    if (agentType !== 'resume' || activeResumeId == null) {
      setResumePreviewData(null)
      return
    }
    let cancelled = false
    setResumePreviewLoading(true)
    getResume(activeResumeId)
      .then((resume) => {
        if (!cancelled) setResumePreviewData(resume)
      })
      .catch(() => {
        if (!cancelled) setResumePreviewData(null)
      })
      .finally(() => {
        if (!cancelled) setResumePreviewLoading(false)
      })
    return () => { cancelled = true }
  }, [agentType, activeResumeId, resumePreviewTick])


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

  const markCurrentAssistantStopped = () => {
    setMessages((prev) => {
      const last = prev[prev.length - 1]
      if (last?.role === 'assistant' && last.content && !last.content.endsWith('*[已停止]*')) {
        return [...prev.slice(0, -1), { ...last, content: last.content + '\n\n*[已停止]*' }]
      }
      return prev
    })
  }

  // 核心发送逻辑：创建会话（若需）+ 乐观消息 + startRun。
  // 既供直接发送使用，也供队列自动发送使用。不在内部判断流式/打断。
  const runSend = async (text: string, attachments: AgentAttachment[]) => {
    const content = text.trim()
    if (!content && attachments.length === 0) return
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

    // 竞态保护：createAgentSession 是异步的，await 期间用户可能已切到历史会话。
    // 若已切走，把消息发到用户当前看着的会话，而非刚创建的新会话。
    const latest = agentSessionRef.current
    if (latest && currentSession && latest.id !== currentSession.id) {
      currentSession = latest
    }

    const optimisticId = optimisticIdRef.current
    optimisticIdRef.current -= 1
    setNotice(null)
    setStreaming(true)
    setRuntimeStatuses({})
    setHeartbeats({})
    setStoreSegments([])
    streamStartRef.current = Date.now()
    const sendingAttachments = [...attachments]
    const imageAttachments = sendingAttachments.filter((a) => a.content_type?.startsWith('image/'))
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, session_id: currentSession.id, role: 'user', content, created_at: new Date().toISOString() },
    ])
    if (sendingAttachments.length > 0) {
      setUserMessageAttachments((prev) => ({ ...prev, [optimisticId]: sendingAttachments }))
    }

    // Inform parent about session (first time or timestamp update)
    const optimisticTitle = content
      ? content.replace(/\n/g, ' ').slice(0, 32)
      : imageAttachments.length > 0
      ? '图片分析'
      : '附件分析'
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
      )
      // Check store error
      const storeState = chatRuntimeStore.getState(currentSession.id)
      if (storeState?.error) {
        const message = storeState.error
        const hint = message.includes('上下文预算') ? '对话内容较长，建议新建对话继续。'
          : message === 'Failed to fetch' ? '无法连接后端服务，请稍后重试'
          : message
        setNotice(hint)
        setPendingAttachments((prev) => [...sendingAttachments, ...prev])
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '回复失败'
      const hint = message.includes('上下文预算') ? '对话内容较长，建议新建对话继续。'
        : message === 'Failed to fetch' ? '无法连接后端服务，请稍后重试'
        : message
      setNotice(hint)
      setPendingAttachments((prev) => [...sendingAttachments, ...prev])
    } finally {
      setStreaming(false)
    }
  }

  const forceScrollToThreadBottom = () => {
    isNearBottomRef.current = true
    setShowScrollBtn(false)
    window.requestAnimationFrame(() => {
      const node = threadRef.current
      if (!node) return
      node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
    })
  }

  const startEditingMessage = (message: AgentMessage, text: string) => {
    if (!text.trim()) return
    setEditingMessageId(message.id)
    setEditingMessageText(text)
  }

  const cancelEditingMessage = () => {
    setEditingMessageId(null)
    setEditingMessageText('')
  }

  const submitEditedMessage = async () => {
    const text = editingMessageText.trim()
    if (!text) return
    setEditingMessageId(null)
    setEditingMessageText('')
    if (streaming) {
      const id = queuedIdRef.current
      queuedIdRef.current -= 1
      setQueue((prev) => [...prev, { id, content: text, attachments: [] }])
      forceScrollToThreadBottom()
      return
    }
    forceScrollToThreadBottom()
    await runSend(text, [])
    forceScrollToThreadBottom()
  }

  const handleEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEditingMessage()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitEditedMessage()
    }
  }

  const submitMessage = async (preset?: string) => {
    const text = (preset ?? inputValue).trim()
    const hasAttachments = pendingAttachments.length > 0
    if (!text && !hasAttachments) return

    // 流式回复中：消息进入待发队列，不打断当前回复
    if (streaming) {
      const id = queuedIdRef.current
      queuedIdRef.current -= 1
      setQueue((prev) => [...prev, { id, content: text, attachments: [...pendingAttachments] }])
      setInputValue('')
      setPendingAttachments([])
      return
    }

    // 非流式：直接发送
    setInputValue('')
    setPendingAttachments([])
    await runSend(text, [...pendingAttachments])
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
    if (agentSession?.id != null) void chatRuntimeStore.cancelSessionRun(agentSession.id)
    setStreaming(false)
    markCurrentAssistantStopped()
  }

  // ── 待发队列操作 ───────────────────────────────────────────────────────
  // 删除队列中的某条待发消息
  const removeQueued = (id: number) => {
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }
  // 撤回到输入框：把该条内容和附件载入输入框，并从队列移除
  const editQueued = (id: number) => {
    const item = queue.find((q) => q.id === id)
    if (!item) return
    setInputValue(item.content)
    setPendingAttachments((prev) => [...item.attachments, ...prev])
    setQueue((prev) => prev.filter((q) => q.id !== id))
  }
  // 立即打断当前回复，触发队列自动发送
  const sendQueueNow = () => {
    if (agentSession?.id != null) void chatRuntimeStore.cancelSessionRun(agentSession.id)
    setStreaming(false)
    markCurrentAssistantStopped()
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

    // Sync steps plan (P2.2: 进度预告，随 run 生命周期存在)
    setStepsPlan(storeState.stepsPlan ?? null)

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

    // Sync 简历实时刷新信号：AI 改完简历后 store.resumeSignal.tick 自增，转发到本地 state
    if (storeState.resumeSignal && storeState.resumeSignal.tick !== lastResumeTickRef.current) {
      lastResumeTickRef.current = storeState.resumeSignal.tick
      setActiveResumeId(storeState.resumeSignal.resumeId)
      setResumePreviewTick(storeState.resumeSignal.tick)
    }
  }, [storeTick, agentSession?.id])

  // ── 队列自动发送：当前回复结束（streaming true→false）且队列非空时，发送队首 ──
  useEffect(() => {
    // 检测 streaming 从 true→false 的下降沿
    const wasStreaming = wasStreamingRef.current
    wasStreamingRef.current = streaming
    if (wasStreaming && !streaming && queue.length > 0 && !drainingRef.current) {
      drainingRef.current = true
      const [first, ...rest] = queue
      setQueue(rest)
      void runSend(first.content, first.attachments).finally(() => {
        drainingRef.current = false
      })
    }
  }, [streaming, queue])

  // ── Render ──

  const emptyState = agentType === 'resume' ? (
    <section className="agent-empty-state agent-home-workbench">
      <div className="agent-home-grid">
        <div className="agent-home-badge">
          <img className="brand-logo" alt="CareerForge" src="/baidi.png" />
        </div>
        <h3>你好，{studentNickname}</h3>
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
      <div className="student-chat-main">
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

      <div className="agent-thread-shell">
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
          message.role === 'user' ? (() => {
            const msgAttachments = userMessageAttachments[message.id] ?? []
            const imageAttachmentsForMessage = msgAttachments.filter((a) => a.content_type?.startsWith('image/'))
            const fileAttachmentsForMessage = msgAttachments.filter((a) => !a.content_type?.startsWith('image/'))
            const displayContent = (
              message.content.trim() === AUTO_ATTACHMENT_PROMPT && msgAttachments.length > 0
            ) ? '' : message.content
            const canActOnText = displayContent.trim().length > 0
            const canEditText = canActOnText && msgAttachments.length === 0
            const isEditingThisMessage = editingMessageId === message.id
            return (
              <div key={message.id} className="message-row user">
                <div className={`user-message-content${displayContent ? '' : ' image-only'}${isEditingThisMessage ? ' editing' : ''}`}>
                  {isEditingThisMessage ? (
                    <div className="user-edit-bubble">
                      <textarea
                        className="user-edit-textarea"
                        value={editingMessageText}
                        autoFocus
                        rows={2}
                        onChange={(event) => setEditingMessageText(event.target.value)}
                        onKeyDown={handleEditKeyDown}
                      />
                      <div className="user-edit-actions">
                        <button type="button" className="user-edit-btn secondary" onClick={cancelEditingMessage}>取消</button>
                        <button
                          type="button"
                          className="user-edit-btn primary"
                          disabled={!editingMessageText.trim()}
                          onClick={() => void submitEditedMessage()}
                        >
                          发送
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {imageAttachmentsForMessage.length > 0 && (
                        <div className="user-image-grid">
                          {imageAttachmentsForMessage.map((att) => {
                            const src = typeof att.download_url === 'string' ? att.download_url : ''
                            return (
                              <div key={att.id} className="user-image-thumb" onClick={() => setLightboxImage(src)}>
                                <img src={src} alt={att.original_name} />
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {fileAttachmentsForMessage.length > 0 && (
                        <div className="user-file-grid">
                          {fileAttachmentsForMessage.map((att) => (
                            <a
                              key={att.id}
                              className="user-file-chip"
                              href={att.download_url ?? '#'}
                              target="_blank"
                              rel="noreferrer"
                              download={att.original_name}
                            >
                              <IconFilePdf style={{ fontSize: 16, color: '#165DFF', flexShrink: 0 }} />
                              <span className="user-file-chip-name">{att.original_name}</span>
                            </a>
                          ))}
                        </div>
                      )}
                      {displayContent && (
                        <div className="message-bubble user"><MarkdownMessage content={displayContent} /></div>
                      )}
                      <div className="user-message-actions">
                        <span className="message-time">{formatMessageTime(message.created_at)}</span>
                        {canActOnText && (
                          <>
                            <button type="button" className="message-action-btn" aria-label="复制消息" onClick={() => void copyMessageText(displayContent)}>
                              <IconCopy />
                            </button>
                            {canEditText && (
                              <button type="button" className="message-action-btn" aria-label="编辑消息" onClick={() => startEditingMessage(message, displayContent)}>
                                <IconEdit />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })() : (
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
              stepsPlan={index === messages.length - 1 ? stepsPlan : undefined}
              suggestions={messageSuggestions[message.id]}
              onSuggestionClick={(text) => void submitMessage(text)}
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
            stepsPlan={stepsPlan}
            pending
            segments={storeSegments}
            suggestions={undefined}
            onSuggestionClick={undefined}
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

        {/* 待发队列 - 流式回复时用户继续输入的消息堆在这里 */}
        {queue.length > 0 && (
          <div className="composer-queue">
            <div className="composer-queue-list">
              {queue.map((item) => (
                <div key={item.id} className="queue-card">
                  {/* 拖拽点 */}
                  <div className="queue-card-drag">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <circle cx="2" cy="2" r="1.2" fill="currentColor" />
                      <circle cx="6" cy="2" r="1.2" fill="currentColor" />
                      <circle cx="10" cy="2" r="1.2" fill="currentColor" />
                      <circle cx="2" cy="6" r="1.2" fill="currentColor" />
                      <circle cx="6" cy="6" r="1.2" fill="currentColor" />
                      <circle cx="10" cy="6" r="1.2" fill="currentColor" />
                      <circle cx="2" cy="10" r="1.2" fill="currentColor" />
                      <circle cx="6" cy="10" r="1.2" fill="currentColor" />
                      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
                    </svg>
                  </div>
                  {/* 内容 */}
                  <div className="queue-card-body">
                    {item.content
                      ? <span className="queue-card-text">{item.content}</span>
                      : <span className="queue-card-text empty">（仅附件）</span>}
                    {item.attachments.length > 0 && (
                      <span className="queue-card-atts">
                        {item.attachments.filter((a) => a.content_type?.startsWith('image/')).length > 0 && (
                          <span className="queue-card-att-badge" title="含图片">
                            <IconImage /> {item.attachments.filter((a) => a.content_type?.startsWith('image/')).length}
                          </span>
                        )}
                        {item.attachments.filter((a) => !a.content_type?.startsWith('image/')).length > 0 && (
                          <span className="queue-card-att-badge" title="含文件">
                            <IconFile /> {item.attachments.filter((a) => !a.content_type?.startsWith('image/')).length}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                  {/* 操作按钮 - 右上角 */}
                  <div className="queue-card-actions">
                    <Tooltip content="立即发送" position="top">
                      <button type="button" aria-label="立即发送" onClick={() => { sendQueueNow() }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19" />
                          <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                      </button>
                    </Tooltip>
                    <Tooltip content="撤回编辑" position="top">
                      <button type="button" aria-label="撤回编辑" onClick={() => editQueued(item.id)}><IconEdit /></button>
                    </Tooltip>
                    <Tooltip content="删除" position="top">
                      <button type="button" aria-label="删除" onClick={() => removeQueued(item.id)}><IconDelete /></button>
                    </Tooltip>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 照片预览 - 在输入框上方 */}
        {pendingAttachments.filter(a => a.content_type?.startsWith('image/') && typeof a.download_url === 'string').length > 0 && (
          <div className="composer-image-row">
            {pendingAttachments.map((a) =>
              a.content_type?.startsWith('image/') && typeof a.download_url === 'string' ? (
                <div key={a.id} className="composer-image-preview" title={a.original_name}
                  onClick={() => setLightboxImage(a.download_url!)}
                  style={{ cursor: 'pointer' }}
                >
                  <img src={a.download_url} alt={a.original_name} />
                  <button type="button" className="composer-image-remove" aria-label="移除图片" onClick={(e) => { e.stopPropagation(); removePendingAttachment(a.id) }}>
                    <IconClose />
                  </button>
                </div>
              ) : null,
            )}
          </div>
        )}

        {/* 非图片文件预览 - 在输入框上方 */}
        {pendingAttachments.filter(a => !a.content_type?.startsWith('image/')).length > 0 && (
          <div className="composer-file-row">
            {pendingAttachments.map((a) =>
              !a.content_type?.startsWith('image/') ? (
                <div key={a.id} className="composer-file-chip">
                  <IconFilePdf style={{ fontSize: 16, color: '#86909C' }} />
                  <span>{a.original_name}</span>
                  <button type="button" className="composer-file-remove" aria-label="移除文件" onClick={() => removePendingAttachment(a.id)}>
                    <IconClose />
                  </button>
                </div>
              ) : null,
            )}
          </div>
        )}

        <Input.TextArea
          value={inputValue}
          onChange={setInputValue}
          onKeyDown={handleComposerKeyDown}
          autoSize={{ minRows: 1, maxRows: 8 }}
          placeholder={
            streaming
              ? '继续输入会排队，等当前回复后自动发送'
              : agentType === 'interviewer'
              ? '回答面试官的问题，或输入你想练习的岗位…'
              : '直接说你的求职需求，也可以只发照片让我分析'
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
            {agentType === 'resume' && (
              <ResumeSelector
                activeResumeId={activeResumeId}
                onResumeChange={(id) => void handleResumeChange(id)}
                disabled={streaming}
              />
            )}
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
            {streaming && !inputValue.trim() && pendingAttachments.length === 0 ? (
              <button type="button" className="composer-send-btn stop" onClick={stopStreaming}>
                <span className="stop-icon" />
              </button>
            ) : (
              <button
                type="button"
                className="composer-send-btn"
                disabled={(!inputValue.trim() && pendingAttachments.length === 0) || !selectedModelId}
                onClick={() => void submitMessage()}
                title={streaming ? '加入待发队列，等当前回复后自动发送' : undefined}
              >
                <IconSend />
              </button>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* 右侧简历实时预览：由标题栏右上角「简历预览」按钮控制开关，仅简历助手且有工作简历时生效。
          始终渲染 aside（有简历时），用 class 控制宽度过渡实现展开/收起动画 */}
      {agentType === 'resume' && activeResumeId != null && (
        <aside
          className={`resume-preview-wrap${resumePreviewVisible ? ' open' : ''}`}
          style={resumePreviewVisible ? { width: resumePreviewWidth } : undefined}
        >
          <div className="resume-preview-resize-handle" onMouseDown={handlePreviewResizeDown} />
          <ResumeLivePreviewPanel
            resume={resumePreviewData}
            loading={resumePreviewLoading}
            resumeTitle={resumePreviewData?.title ?? ''}
            onOpenEditor={() => navigate(`/student/resumes/${activeResumeId}`)}
            onClose={() => onResumePreviewClose?.()}
          />
        </aside>
      )}

      {lightboxImage && <ImageLightbox src={lightboxImage} onClose={() => setLightboxImage(null)} />}

      {/* 新用户提示：建议先去个人档案填好个人信息 */}
      <Modal
        visible={profilePromptVisible}
        title="欢迎使用 👋"
        onCancel={() => { setProfilePromptVisible(false); localStorage.setItem('zhipei-profile-prompt-dismissed', '1') }}
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
