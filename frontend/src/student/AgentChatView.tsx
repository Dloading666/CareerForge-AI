import { Input, Skeleton, Tooltip } from '@arco-design/web-react'
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
import { ApiError, apiRequest } from '../shared/api'
import { AnnouncementBanner } from './StudentAnnouncementBar'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { useAuth } from '../shared/auth'
import { chatRuntimeStore, type TimelineSegment, aggregateActions } from './chatRuntimeStore'

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
const MAX_RESUMES = 6

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
}

function formatDuration(durationMs?: number | null) {
  if (!durationMs && durationMs !== 0) return ''
  if (durationMs < 1000) return `${durationMs} ms`
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 1 : 0)} 秒`
}

function activityAction(activity: AgentActivity) {
  const action = toolDisplayNames[activity.name] || activity.name
  if (activity.status === 'started') return activity.summary || `正在${action}…`
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

/** 图标映射：工具/阶段 → /activity-icons/*.png */
const ACTIVITY_ICON_MAP: Record<string, string> = {
  query_student_profile: '/activity-icons/view.png',
  read_resume:           '/activity-icons/view.png',
  analyze_uploaded_file: '/activity-icons/attach.png',
  get_session_context:   '/activity-icons/view.png',
  generate_resume_data:  '/activity-icons/edit.png',
  optimize_resume_data:  '/activity-icons/pencil.png',
  update_resume_data:    '/activity-icons/pencil.png',
  export_resume_pdf:     '/activity-icons/edit.png',
  read_webpage:          '/activity-icons/web.png',
  web_search:            '/activity-icons/search.png',
}

const ACTIVITY_ANIM_MAP: Record<string, string> = {
  query_student_profile: 'act-browse',
  read_resume:           'act-browse',
  analyze_uploaded_file: 'act-analyze',
  get_session_context:   'act-browse',
  generate_resume_data:  'act-write',
  optimize_resume_data:  'act-write',
  update_resume_data:    'act-write',
  export_resume_pdf:     'act-write',
  read_webpage:          'act-browse',
  web_search:            'act-search',
}

const KIND_ICON_MAP: Record<string, string> = {
  profile:   '/activity-icons/view.png',
  resume:    '/activity-icons/attach.png',
  file:      '/activity-icons/attach.png',
  job:       '/activity-icons/search.png',
  knowledge: '/activity-icons/search.png',
  skill:     '/activity-icons/setting.png',
}

const KIND_ANIM_MAP: Record<string, string> = {
  profile:   'act-browse',
  resume:    'act-browse',
  file:      'act-analyze',
  job:       'act-search',
  knowledge: 'act-search',
  skill:     'act-think',
}

function activityPhaseIcon(name: string, kind: string): { src: string; anim: string } {
  const src = ACTIVITY_ICON_MAP[name] || KIND_ICON_MAP[kind] || '/activity-icons/setting.png'
  const anim = ACTIVITY_ANIM_MAP[name] || KIND_ANIM_MAP[kind] || 'act-process'
  return { src, anim }
}

function ActivityStep({ activity }: { activity: AgentActivity }) {
  const running = activity.status === 'started'
  const failed = activity.status === 'failed'
  const isFactCheck = failed && activity.display_summary?.includes('事实核对')
  const duration = formatDuration(Number(activity.detail?.duration_ms) || null)
  const { src, anim } = activityPhaseIcon(activity.name, activity.kind)

  const iconContent = running
    ? <img className={`activity-inline-icon ${anim}`} src={src} alt="" />
    : failed
      ? <img className="activity-inline-icon" src="/activity-icons/delete.png" alt="" />
      : <img className="activity-inline-icon activity-done" src={src} alt="" />

  return (
    <div className={`activity-inline-row${running ? ' running' : ''}${failed ? (isFactCheck ? ' fact-check' : ' failed') : ''}`}>
      {iconContent}
      <span className="activity-inline-label">{activityAction(activity)}</span>
      {duration && <span className="activity-inline-duration">{duration}</span>}
      {failed && activity.display_summary && (
        <span className="activity-inline-detail">{activity.display_summary}</span>
      )}
    </div>
  )
}

/** 动作胶囊：聚合显示，点击展开明细 */
function ActionsCapsule({ segment, running }: { segment: { activities: AgentActivity[]; collapsed: boolean }; running: boolean }) {
  const [expanded, setExpanded] = useState(!segment.collapsed && running)
  const toolActivities = segment.activities
  if (toolActivities.length === 0) return null

  const allDone = toolActivities.every((a) => a.status !== 'started')
  const hasFailures = toolActivities.some((a) => a.status === 'failed')
  const summary = aggregateActions(toolActivities)

  // 正在运行时自动展开，完成后自动折叠
  useEffect(() => {
    if (running && !allDone) setExpanded(true)
    if (allDone && expanded) setExpanded(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, allDone])

  return (
    <div className={`actions-capsule${hasFailures ? ' has-failures' : ''}`}>
      <button
        type="button"
        className="capsule-trigger"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="capsule-dot" />
        <span className="capsule-text">{summary}</span>
        <span className={`capsule-chevron${expanded ? ' expanded' : ''}`}>›</span>
      </button>
      {expanded && (
        <div className="capsule-detail">
          {toolActivities.map((a) => (
            <ActivityStep key={a.id} activity={a} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 时间线渲染：text 和 actions 段交错 */
function TimelineRenderer({ segments, running }: { segments: TimelineSegment[]; running: boolean }) {
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
        return <ActionsCapsule key={`a${i}`} segment={seg} running={running} />
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
  elapsedTick,
}: {
  pending: boolean
  heartbeat?: { output_chars: number; phase: string }
  runtimeStatus?: RuntimeStatus
  runtimeInfo?: RuntimeInfo
  activities: AgentActivity[]
  streamStartMs: number | null
  elapsedTick: number
}) {
  void elapsedTick  // triggers re-render each second for elapsed time
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
  const elapsed = streamStartMs ? Date.now() - streamStartMs : 0
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

function RunDetails({ info }: { info?: RuntimeInfo }) {
  const [expanded, setExpanded] = useState(false)
  if (!info) return null
  const hasUsage = info.total_tokens > 0
  return (
    <div className="run-details">
      <button type="button" className="run-details-toggle" onClick={() => setExpanded((value) => !value)}>
        <IconDashboard />
        <span>{hasUsage ? `${info.total_tokens.toLocaleString()} tokens` : '运行详情'}</span>
        <span>· {formatDuration(info.duration_ms)}</span>
        {expanded ? <IconCaretDown /> : <IconCaretRight />}
      </button>
      {expanded && (
        <div className="run-details-panel">
          <span><b>模型</b>{info.model_name}</span>
          <span><b>输入</b>{info.prompt_tokens.toLocaleString()} tokens</span>
          <span><b>输出</b>{info.completion_tokens.toLocaleString()} tokens</span>
          <span><b>总计</b>{info.total_tokens.toLocaleString()} tokens</span>
          <span><b>耗时</b>{formatDuration(info.duration_ms)}</span>
        </div>
      )}
    </div>
  )
}

function ResumeEditorLinks({ activities }: { activities: AgentActivity[] }) {
  const editorLinks = useMemo(() => {
    const links: { resumeId: number; label: string }[] = []
    for (const a of activities) {
      if (a.status !== 'completed') continue
      const detail = a.detail || {}
      if (detail?.open_resume_editor && typeof detail?.resume_id === 'number') {
        const label = a.name === 'generate_resume_data' ? '查看生成的简历'
          : a.name === 'optimize_resume_data' ? '查看优化后的简历'
          : a.name === 'update_resume_data' ? '查看修改后的简历'
          : '查看简历'
        links.push({ resumeId: detail.resume_id as number, label })
      }
    }
    return links
  }, [activities])
  if (editorLinks.length === 0) return null
  return (
    <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {editorLinks.map((link) => (
        <a
          key={link.resumeId}
          href={`/student/resumes/${link.resumeId}`}
          onClick={(e) => { e.preventDefault(); window.location.href = `/student/resumes/${link.resumeId}` }}
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
  message, activities, files = [], pending = false, runtimeStatus, runtimeInfo, heartbeat, streamStartMs, elapsedTick, segments,
}: {
  message: AgentMessage
  activities: AgentActivity[]
  files?: GeneratedFile[]
  pending?: boolean
  runtimeStatus?: RuntimeStatus
  runtimeInfo?: RuntimeInfo
  heartbeat?: { output_chars: number; phase: string }
  streamStartMs?: number | null
  elapsedTick?: number
  segments?: TimelineSegment[]
}) {
  // 如果有 segments，用时间线渲染；否则回退到旧方式
  const hasSegments = segments && segments.length > 0
  return (
    <div className="message-row assistant">
      <div className="assistant-message">
        {hasSegments ? (
          <TimelineRenderer segments={segments} running={pending} />
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
            elapsedTick={elapsedTick ?? 0}
          />
        )}
        {!pending && <RunDetails info={runtimeInfo} />}
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

export function parseSseBlock(block: string): StreamEvent | null {
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
  const [runtimeStatuses, setRuntimeStatuses] = useState<Record<number, RuntimeStatus>>({})
  const [runtimeInfo, setRuntimeInfo] = useState<Record<number, RuntimeInfo>>({})
  const [heartbeats, setHeartbeats] = useState<Record<number, { output_chars: number; phase: string }>>({})
  const [storeSegments, setStoreSegments] = useState<TimelineSegment[]>([])
  const streamStartRef = useRef<number | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const [elapsedTick, setElapsedTick] = useState(0)
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

  // Load session when loadTrigger increments
  useEffect(() => {
    if (loadTrigger === 0 || !sessionToLoad) return
    if (streaming) { abortRef.current?.abort(); chatRuntimeStore.abort() }
    setNotice(null)
    setHistoryLoading(true)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})

    apiRequest<AgentHistory>(`/api/v1/student/master/sessions/${sessionToLoad.id}/messages`)
      .then((history) => {
        setAgentSession(history.session)
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
    if (streaming) { abortRef.current?.abort(); chatRuntimeStore.abort() }
    setAgentSession(null)
    setMessages([])
    setActivities([])
    setRuntimeStatuses({})
    setRuntimeInfo({})
    setHeartbeats({})
    streamStartRef.current = null
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
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
    setRuntimeStatuses({})
    setRuntimeInfo({})
    setHeartbeats({})
    streamStartRef.current = null
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
    setPendingAttachments([])
    setGeneratedFiles({})
    return created
  }, [agentType])


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
    if (!(await ensureResumeCapacity())) return
    setInputValue('请帮我优化简历，我会上传简历 PDF 和目标岗位 JD。')
    fileInputRef.current?.click()
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
    setRuntimeStatuses({})
    setHeartbeats({})
    streamStartRef.current = Date.now()
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    elapsedTimerRef.current = setInterval(() => setElapsedTick((t) => t + 1), 1000)
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
    abortRef.current = new AbortController() // kept for stopStreaming compat
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
      abortRef.current = null
      if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
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
    abortRef.current?.abort()
    chatRuntimeStore.abort()
    setStreaming(false)
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null }
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

  // ── Sync store events → component state ──────────────────────────────────
  useEffect(() => {
    const sid = agentSession?.id
    if (sid == null || storeTick === 0) return // storeTick===0 means no store notify yet
    const storeState = chatRuntimeStore.getState(sid)
    if (!storeState) return

    // Update streaming flag from store
    setStreaming(storeState.streaming)

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
              elapsedTick={elapsedTick}
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
            elapsedTick={elapsedTick}
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
