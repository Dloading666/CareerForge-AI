import { Button, Input, InputNumber, Message, Select, Spin, Tag } from '@arco-design/web-react'
import {
  IconBulb,
  IconCheck,
  IconCheckCircle,
  IconDelete,
  IconExclamationCircle,
  IconHistory,
  IconPlayArrow,
  IconRefresh,
  IconSend,
  IconSettings,
  IconThunderbolt,
  IconVideoCamera,
} from '@arco-design/web-react/icon'
import type { MouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest, authenticatedFetch } from '../shared/api'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import aiInterviewerIcon from '../assets/interview-icons/cute-ai-interviewer.png'
import knowledgeIcon from '../assets/interview-icons/cute-knowledge-base.png'
import reportIcon from '../assets/interview-icons/cute-score-report.png'
import resumeIcon from '../assets/interview-icons/cute-resume.png'
import retryIcon from '../assets/interview-icons/cute-retry.png'
import voiceIcon from '../assets/interview-icons/cute-voice.png'
import { subscribeInterviewRun } from './interview/stream'
import { extensionForAudioMimeType, pickSupportedAudioMimeType } from './interview/voice'

type KnowledgeStatus = {
  root?: string
  document_count: number
  chunk_count: number
  retriever: string
  vector_ready: boolean
  errors?: string[]
}

type AgentModelOption = {
  id: number
  display_name: string
  provider: string
  model_identifier: string
}

type InterviewSession = {
  id: number
  target_role: string
  interview_type: string
  interview_style: string
  difficulty: string
  round_limit: number
  model_config_id?: number | null
  status: string
  created_at?: string | null
  ended_at?: string | null
}

type InterviewTurn = {
  id: number
  turn_index: number
  question: string
  answer?: string | null
  answer_assessment?: {
    summary?: string
    is_vague?: boolean
    risk_points?: string[]
    positive_points?: string[]
    llm?: { used?: boolean; model?: string | null; error?: string; fallback_used?: boolean; fallback_reason?: string; fallback_detail?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
    retrieval?: { hit_count?: number; top_sources?: string[] }
  } | null
  score?: Record<string, number> | null
  followup_reason?: string | null
  retrieved_chunks?: Array<{ title: string; topic: string; source_file: string; score: number }>
  knowledge_points?: string[]
  // P1-3: 考察点和评分证据
  question_reason?: string | null
  capability_tags?: string[]
  top_sources?: Array<{ title: string; topic: string; source_file: string; score: number }>
  score_reasons?: Record<string, string>
  evidence_quotes?: Array<{ quote?: string; dimension?: string }>
}

type Report = {
  overall_score: number
  dimension_scores: Record<string, number>
  strengths: string[]
  weaknesses: string[]
  suggestions: string[]
  next_questions: string[]
  comparison?: {
    has_previous: boolean
    previous_overall_score?: number
    current_overall_score?: number
    overall_delta?: number
    message?: string
    scoring?: {
      mode?: string
      model?: string
      usage?: {
        prompt_tokens?: number
        completion_tokens?: number
        total_tokens?: number
      } | null
      rubric?: string
    }
  } | null
  report_text: string
}

type ReportLookupResponse =
  | Report
  | { exists: false; status: 'not_generated'; message: string }

function isReport(data: ReportLookupResponse): data is Report {
  return typeof (data as Report).overall_score === 'number'
    && !!(data as Report).dimension_scores
}

type ProgressStage = { label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }

type PrepareStageKey = 'resume' | 'jd' | 'match' | 'rag' | 'llm' | 'harness' | 'done'
type AnswerStageKey = 'receive_answer' | 'retrieval' | 'score' | 'followup' | 'completed'

type PrepareStageReport = {
  stage: PrepareStageKey
  title: string
  summary: string
  details: string[]
  evidence?: string[]
  updatedAt?: string
}

type VoicePhase = 'idle' | 'speaking' | 'listening' | 'uploading' | 'thinking' | 'error'

type VoiceTranscriptDraft = {
  turnId: number
  text: string
  language: string
  confidence: number
  audioFormat?: string
  audioSizeBytes?: number
}

const DIMENSION_LABELS: Record<string, string> = {
  technical_accuracy: '技术准确性',
  project_evidence: '项目证据',
  problem_solving: '问题解决',
  communication: '表达逻辑',
  job_fit: '岗位匹配',
  pressure_handling: '压力应对',
}

const DIMENSION_DESCRIPTIONS: Record<string, string> = {
  technical_accuracy: '概念、原理、边界、工程实现是否准确',
  project_evidence: '个人职责、落地细节、量化结果是否能证明真实参与',
  problem_solving: '能否澄清问题、拆解方案、说明取舍和异常处理',
  communication: '表达是否结构化、聚焦问题、前后连贯',
  job_fit: '回答是否贴合目标岗位 JD 和核心能力要求',
  pressure_handling: '被追问时是否稳定、诚实、能补充证据',
}

const INTERVIEW_TYPE_META: Record<string, string> = {
  first_round: '一面：基础能力、简历真实性、岗位核心要求、表达稳定性',
  second_round: '二面：项目深度、技术/业务取舍、复杂问题拆解、复盘能力',
}

const INTERVIEW_TYPE_OPTIONS = [
  { value: 'first_round', label: '初面' },
  { value: 'second_round', label: '二面' },
]

const FOCUS_OPTIONS = [
  { value: 'resume_project', label: '简历项目深挖' },
  { value: 'technical_principle', label: '技术原理' },
  { value: 'system_design', label: '系统设计' },
  { value: 'coding_logic', label: '编码思路' },
  { value: 'hr_motivation', label: '求职动机' },
  { value: 'pressure_check', label: '压力追问' },
]

const INTERVIEW_STYLE_LABELS: Record<string, string> = {
  friendly: '温和训练',
  coach: '教练式引导',
  strict: '严格追问',
  stress: '压力面试',
  executive: '高管式审视',
}

const INTERVIEW_STYLE_TONE: Record<string, string> = {
  friendly: '语气会更鼓励，但仍会追证据。',
  coach: '语气会先引导候选人补全结构，再对薄弱点继续追问。',
  strict: '语气会更直接，重点压实指标、职责和实现细节。',
  stress: '语气会更有压迫感，会质疑可信度，但不攻击人格。',
  executive: '语气会更关注业务价值、判断力、长期潜力和岗位风险。',
}

const formatDuration = (durationMs: number) => {
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`
}


const normalizeQuestionMarkdown = (text: string) => {
  // 先压缩所有连续空行为单个换行
  let result = text.replace(/\n{3,}/g, '\n\n').trim()
  // 再处理编号列表格式
  if (/(^|\s)1[)）]/.test(result)) {
    result = result
      .replace(/([：:。！？?；;])\s*(\d+[)）])/g, '$1\n\n$2 ')
      .replace(/\s+(\d+[)）])\s*/g, '\n\n$1 ')
      .replace(/\n{3,}/g, '\n\n')
  }
  return result
}

const formatDateLabel = (value?: string | null) => {
  if (!value) return '未记录日期'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '未记录日期'
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
}

const formatTimeLabel = (value?: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const scoreLevel = (value: number) => {
  if (value >= 85) return 'excellent'
  if (value >= 70) return 'steady'
  return 'weak'
}

// ── SSE 解析（复用 chatRuntimeStore 模式）───────────────────────────────────

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) }
  } catch {
    return null
  }
}

async function deprecatedSubscribeInterviewRun(
  runId: string,
  handlers: {
    onEvent: (event: string, data: unknown) => void
    onDone: () => void
    onError: (error: Error) => void
  },
  options?: {
    afterSeq?: number
    maxRetries?: number
    timeoutMs?: number
  }
): Promise<void> {
  const maxRetries = options?.maxRetries ?? 3
  const timeoutMs = options?.timeoutMs ?? 120000
  let afterSeq = options?.afterSeq ?? 0
  let retries = 0
  let gotDone = false
  let failed = false
  const controller = new AbortController()

  const failOnce = (error: Error) => {
    if (gotDone || failed) return
    failed = true
    controller.abort()
    handlers.onError(error)
  }

  const timeout = setTimeout(() => {
    failOnce(new Error('事件流超时'))
  }, timeoutMs)

  try {
    while (retries <= maxRetries && !gotDone && !failed) {
      try {
        const resp = await authenticatedFetch(
          `/api/v1/student/interviews/runs/${runId}/events?after_seq=${afterSeq}`,
          { signal: controller.signal },
        )
        if (failed) break
        if (!resp.ok || !resp.body) {
          if (resp.status === 401) {
            failOnce(new Error('登录已过期，请刷新页面'))
            break
          }
          throw new Error(`事件流连接失败（${resp.status}）`)
        }

        retries = 0
        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
          while (!gotDone && !failed) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split('\n\n')
            buffer = blocks.pop() ?? ''
            for (const block of blocks) {
              if (block.startsWith(':')) continue
              const parsed = parseSseBlock(block)
              if (parsed) {
                if (typeof parsed.data === 'object' && parsed.data !== null && 'seq' in parsed.data) {
                  afterSeq = Math.max(afterSeq, Number((parsed.data as Record<string, unknown>).seq))
                }
                handlers.onEvent(parsed.event, parsed.data)
                if (parsed.event === 'done') {
                  gotDone = true
                  break
                }
              }
            }
          }
          if (!gotDone && !failed && buffer.trim() && !buffer.startsWith(':')) {
            const parsed = parseSseBlock(buffer)
            if (parsed) {
              handlers.onEvent(parsed.event, parsed.data)
              if (parsed.event === 'done') gotDone = true
            }
          }
        } catch {
          // Stream interrupted, will retry
        } finally {
          reader.releaseLock()
        }
      } catch (err) {
        if (failed) break
        if (err instanceof DOMException && err.name === 'AbortError') break
        if (retries >= maxRetries) {
          failOnce(err instanceof Error ? err : new Error('事件流连接失败'))
          break
        }
      }

      if (!gotDone && !failed) {
        retries++
        await new Promise((r) => setTimeout(r, Math.min(1000 * retries, 5000)))
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  if (gotDone && !failed) {
    handlers.onDone()
  }
}

const ANSWER_STAGE_LABELS: Record<AnswerStageKey, string> = {
  receive_answer: '读取回答',
  retrieval: '检索题库',
  score: '评价回答',
  followup: '组织追问',
  completed: '生成完成',
}

const ANSWER_STAGE_ORDER: AnswerStageKey[] = ['receive_answer', 'retrieval', 'score', 'followup', 'completed']

const createAnswerProgressStages = (): ProgressStage[] =>
  ANSWER_STAGE_ORDER.map((key) => ({ label: ANSWER_STAGE_LABELS[key], status: 'pending' }))

void deprecatedSubscribeInterviewRun

export function AIInterviewerPage({ onInterviewActiveChange }: { onInterviewActiveChange?: (active: boolean) => void } = {}) {
  const stageOrder: PrepareStageKey[] = ['resume', 'jd', 'match', 'rag', 'llm', 'harness', 'done']
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null)
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>(undefined)
  const [targetRole, setTargetRole] = useState('')
  const [jobDescription, setJobDescription] = useState('')
  const [interviewType, setInterviewType] = useState('first_round')
  const [interviewStyle, setInterviewStyle] = useState('strict')
  const [roundLimit, setRoundLimit] = useState('8')
  const [resumeSource, setResumeSource] = useState<'online' | 'upload'>('online')
  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null)
  const [resumes, setResumes] = useState<Array<{ id: number; title: string; updated_at: string | null }>>([])
  const [loadingResumes, setLoadingResumes] = useState(false)
  const [uploadedResumeText, setUploadedResumeText] = useState('')
  const [uploadedResumeName, setUploadedResumeName] = useState('')
  const [uploadingResume, setUploadingResume] = useState(false)
  const [focusTags, setFocusTags] = useState<string[]>(['resume_project'])
  const [customInstruction, setCustomInstruction] = useState('')
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const [reportProgress, setReportProgress] = useState<string[]>([])
  const [answerProgressStages, setAnswerProgressStages] = useState<ProgressStage[]>([])
  const [interviewSessions, setInterviewSessions] = useState<InterviewSession[]>([])
  const [progressElapsed, setProgressElapsed] = useState(0)
  const [collapsedHistoryDates, setCollapsedHistoryDates] = useState<Set<string>>(() => new Set())
  const [reportCollapsed, setReportCollapsed] = useState(false)
  const [modelError, setModelError] = useState<string | null>(null)
  const [optimisticAnswer, setOptimisticAnswer] = useState<{ turnId: number; text: string } | null>(null)
  const [resumePickerVisible, setResumePickerVisible] = useState(false)

  // 语音面试状态
  const [interviewMode, setInterviewMode] = useState<'text' | 'voice'>('text')
  const [recording, setRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [progressStages, setProgressStages] = useState<ProgressStage[]>([])
  const [prepareStageReports, setPrepareStageReports] = useState<Record<string, PrepareStageReport | null>>({
    resume: null, jd: null, match: null, rag: null, llm: null, harness: null, done: null,
  })
  const [activePrepareStage, setActivePrepareStage] = useState<PrepareStageKey>('resume')
  type StreamingTarget = 'start_question' | 'followup' | 'report'
  const [streamingBlocks, setStreamingBlocks] = useState<Record<StreamingTarget, string>>({
    start_question: '',
    followup: '',
    report: '',
  })

  const appendStreamingText = (target: StreamingTarget, delta: string) => {
    setStreamingBlocks((prev) => ({ ...prev, [target]: `${prev[target] ?? ''}${delta}` }))
  }
  const setStreamingSnapshot = (target: StreamingTarget, text: string) => {
    setStreamingBlocks((prev) => ({ ...prev, [target]: text }))
  }
  const clearStreamingTarget = (target: StreamingTarget) => {
    setStreamingBlocks((prev) => ({ ...prev, [target]: '' }))
  }
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [ttsMode, setTtsMode] = useState<'server_tts' | 'browser_tts'>('browser_tts')
  // P1: 语音状态机防重入
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  const [voiceDraft, setVoiceDraft] = useState<VoiceTranscriptDraft | null>(null)
  const [voiceDraftText, setVoiceDraftText] = useState('')
  // P1: 静音检测状态
  const [silenceDetected, setSilenceDetected] = useState(false)
  const [hasSpoken, setHasSpoken] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const progressStartRef = useRef<number | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recorderMimeTypeRef = useRef('audio/webm')
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const maxRecordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noSpeechTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // P1: 静音检测 refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const silenceCheckRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speechStartedRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)

  // P0-2: 加载在线简历列表
  const loadResumes = async () => {
    if (resumes.length > 0) return
    setLoadingResumes(true)
    try {
      const data = await apiRequest<Array<{ id: number; title: string; updated_at: string | null }>>('/api/v1/student/resumes')
      setResumes(data)
    } catch {
      // 静默失败，不影响主流程
    } finally {
      setLoadingResumes(false)
    }
  }

  const pendingTurn = useMemo(() => turns.find((turn) => !turn.answer) ?? null, [turns])

  const updateAnswerProgress = (phase: string, label?: string) => {
    const idx = ANSWER_STAGE_ORDER.indexOf(phase as AnswerStageKey)
    if (idx < 0) return
    setAnswerProgressStages((prev) => {
      const base = prev.length > 0 ? prev : createAnswerProgressStages()
      return base.map((stage, stageIdx) => {
        if (phase === 'completed') return { ...stage, status: 'done' as const }
        if (stageIdx < idx) return { ...stage, status: 'done' as const }
        if (stageIdx === idx) return { ...stage, status: 'active' as const, label: label || ANSWER_STAGE_LABELS[phase as AnswerStageKey] }
        return { ...stage, status: 'pending' as const }
      })
    })
  }

  // Notify parent when interview active state changes
  useEffect(() => {
    onInterviewActiveChange?.(session?.status === 'active')
  }, [session?.status, onInterviewActiveChange])

  const sortedDimensions = useMemo(
    () => Object.entries(report?.dimension_scores ?? {}).sort((a, b) => a[1] - b[1]),
    [report],
  )
  const weakestDimension = sortedDimensions[0]
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId)
  const normalizedRoundLimit = Math.max(3, Math.min(20, Number(roundLimit) || 8))
  const promptPreview = `${selectedModel?.display_name ?? '默认模型'} · ${INTERVIEW_TYPE_META[interviewType] ?? '综合能力'} · ${INTERVIEW_STYLE_TONE[interviewStyle] ?? ''} · ${focusTags.map((tag) => FOCUS_OPTIONS.find((item) => item.value === tag)?.label ?? tag).join('、') || '默认'} · ${normalizedRoundLimit} 轮`
  const resumeSourceLabel = resumeSource === 'upload'
    ? (uploadedResumeName ? `已上传：《${uploadedResumeName}》` : '上传并读取简历')
    : (selectedResumeId ? (resumes.find((r) => r.id === selectedResumeId)?.title || '已选择在线简历') : '选择在线简历')
  const historyGroups = useMemo(() => {
    const groups: Record<string, InterviewSession[]> = {}
    for (const item of interviewSessions) {
      const key = formatDateLabel(item.created_at)
      groups[key] = [...(groups[key] ?? []), item]
    }
    return Object.entries(groups)
  }, [interviewSessions])

  const toggleHistoryDate = (date: string) => {
    setCollapsedHistoryDates((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const loadInterviewSessions = async () => {
    try {
      const list = await apiRequest<InterviewSession[]>('/api/v1/student/interviews')
      setInterviewSessions(list)
    } catch {
      setInterviewSessions([])
    }
  }

  const loadInterviewDetail = async (sessionId: number) => {
    setLoading(true)
    setReport(null)
    setReportProgress([])
    setAnswerProgressStages([])
    try {
      const detail = await apiRequest<{ session: InterviewSession; turns: InterviewTurn[] }>(`/api/v1/student/interviews/${sessionId}`)
      setSession(detail.session)
      setTurns(detail.turns)
      setAnswer('')
      setConfigCollapsed(true)
      if (detail.session.status === 'completed') {
        const data = await apiRequest<ReportLookupResponse>(`/api/v1/student/interviews/${sessionId}/report`)
        if (isReport(data)) {
          setReport(data)
        }
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '加载面试记录失败')
    } finally {
      setLoading(false)
    }
  }

  const handleResumeUpload = async (file: File) => {
    setUploadingResume(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const data = await apiRequest<{ filename: string; chars: number; estimated_tokens: number; extracted_text: string }>('/api/v1/student/interviews/resume/extract', {
        method: 'POST',
        body: form,
      })
      setResumeSource('upload')
      setUploadedResumeName(data.filename)
      setUploadedResumeText(data.extracted_text)
      setResumePickerVisible(false)
      Message.success(`已读取 ${data.filename}，约 ${data.chars.toLocaleString()} 字符`)
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '简历上传解析失败')
    } finally {
      setUploadingResume(false)
    }
  }

  const deleteInterviewSession = async (event: MouseEvent, item: InterviewSession) => {
    event.stopPropagation()
    if (!window.confirm(`删除「${item.target_role || '未填写目标岗位'}」这条面试记录？`)) return
    try {
      await apiRequest(`/api/v1/student/interviews/${item.id}`, { method: 'DELETE' })
      if (session?.id === item.id) {
        setSession(null)
        setTurns([])
        setReport(null)
        setAnswer('')
        setConfigCollapsed(false)
      }
      await loadInterviewSessions()
      Message.success('面试记录已删除')
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '删除面试记录失败')
    }
  }

  useEffect(() => {
    let cancelled = false
    apiRequest<KnowledgeStatus>('/api/v1/student/interviews/knowledge/status')
      .then((data) => { if (!cancelled) setKnowledge(data) })
      .catch(() => { if (!cancelled) setKnowledge(null) })
    apiRequest<AgentModelOption[]>('/api/v1/student/master/models')
      .then((list) => {
        if (cancelled) return
        setModelOptions(list)
        setModelError(null)
        if (list.length > 0) setSelectedModelId((prev) => prev ?? list[0].id)
      })
      .catch((err) => {
        if (!cancelled) {
          setModelOptions([])
          setModelError(err instanceof Error ? err.message : '模型列表加载失败，请检查管理员模型广场配置和后端日志。')
        }
      })
    apiRequest<InterviewSession[]>('/api/v1/student/interviews')
      .then((list) => { if (!cancelled) setInterviewSessions(list) })
      .catch(() => { if (!cancelled) setInterviewSessions([]) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
      // P1: 清理所有语音资源
      window.speechSynthesis?.cancel()
      mediaRecorderRef.current?.stop()
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
      }
      if (silenceCheckRef.current) clearInterval(silenceCheckRef.current)
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
      if (maxRecordingTimerRef.current) clearTimeout(maxRecordingTimerRef.current)
      if (noSpeechTimerRef.current) clearTimeout(noSpeechTimerRef.current)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, loading, report, reportProgress.length, answerProgressStages.length])

  const startInterview = async () => {
    if (!targetRole.trim()) {
      Message.warning('请填写目标岗位')
      return
    }
    if (!jobDescription.trim()) {
      Message.warning('请填写岗位 JD')
      return
    }
    if (modelOptions.length === 0) {
      Message.warning('暂无可用模型，请管理员在模型广场开启「对学生开放」并配置 API Key。')
      return
    }
    if (resumeSource === 'upload' && !uploadedResumeText.trim()) {
      Message.warning('请先上传并解析一份简历，或切换为读取在线简历。')
      return
    }
    if (normalizedRoundLimit < 8) {
      Message.warning('面试轮次少于 8 轮，综合评分报告可能不够准确。')
    }
    setLoading(true)
    setReport(null)
    setReportProgress([])
    clearStreamingTarget('start_question')
    clearStreamingTarget('followup')
    clearStreamingTarget('report')
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)

    const stageLabels: Record<string, string> = {
      resume: '正在读取简历',
      jd: '正在分析岗位 JD',
      match: '正在匹配简历经历与岗位要求',
      rag: '正在检索题库/RAG',
      llm: '正在生成第一问',
      harness: '正在校验问题质量',
      done: '第一问已生成',
    }
    // 初始阶段全部 pending，由后端 runtime.status 事件驱动更新
    const initialStages: ProgressStage[] = stageOrder.map((key) => ({ label: stageLabels[key], status: 'pending' }))
    setProgressStages([...initialStages])

    const bodyPayload = {
      target_role: targetRole,
      job_description: jobDescription,
      interview_type: interviewType,
      interview_style: interviewStyle,
      difficulty: 'normal',
      round_limit: normalizedRoundLimit,
      model_id: selectedModelId,
      resume_source: resumeSource,
      resume_id: resumeSource === 'online' ? selectedResumeId : undefined,
      uploaded_resume_text: resumeSource === 'upload' ? uploadedResumeText : undefined,
      focus_tags: focusTags,
      custom_instruction: customInstruction,
      request_id: crypto.randomUUID(),
    }

    // ── P0: Interview SSE 事件流 ──
    const fallbackREST = async () => {
      try {
        const res = await apiRequest<{
          session: InterviewSession
          first_turn: InterviewTurn
          knowledge_status: KnowledgeStatus
        }>('/api/v1/student/interviews', {
          method: 'POST',
          body: JSON.stringify(bodyPayload),
        })
        setProgressStages((prev) =>
          prev.map((s) =>
            s.status === 'active'
              ? { ...s, status: 'done' as const, label: '已通过降级接口完成创建' }
              : s
          )
        )
        setSession(res.session)
        setTurns([res.first_turn])
        setKnowledge(res.knowledge_status)
        setAnswer('')
        setConfigCollapsed(true)
        await loadInterviewSessions()
        if (interviewMode === 'voice') {
          await speakAndAutoRecord(res.first_turn.question, res.session.id, res.first_turn.id)
        }
      } catch (error) {
        setProgressStages((prev) =>
          prev.map((s) => s.status === 'active' ? { ...s, status: 'error' as const, detail: error instanceof Error ? error.message : '创建面试失败' } : s)
        )
        Message.error(error instanceof Error ? error.message : '创建面试失败')
      }
    }

    try {
      const runRes = await apiRequest<{ run_id: string; request_id: string }>('/api/v1/student/interviews/runs/start', {
        method: 'POST',
        body: JSON.stringify(bodyPayload),
      })

      await new Promise<void>((resolve) => {
        subscribeInterviewRun(
          runRes.run_id,
          {
            onEvent: (event, data) => {
              if (event === 'interview.stage.started') {
                const d = data as { stage: string; title: string }
                const stageIdx = stageOrder.indexOf(d.stage as PrepareStageKey)
                if (stageIdx >= 0) {
                  setProgressStages((prev) =>
                    prev.map((s, i) => i === stageIdx ? { ...s, status: 'active' as const, label: d.title || s.label } : s)
                  )
                  if (d.stage === 'llm') {
                    setActivePrepareStage('llm')
                  }
                }
              } else if (event === 'interview.stage.completed') {
                const d = data as { stage: string; title: string; summary: string; details: string[]; evidence?: string[] }
                const stageIdx = stageOrder.indexOf(d.stage as PrepareStageKey)
                if (stageIdx >= 0) {
                  setProgressStages((prev) =>
                    prev.map((s, i) => i === stageIdx ? { ...s, status: 'done' as const, label: d.title || s.label } : s)
                  )
                  setPrepareStageReports((prev) => ({ ...prev, [d.stage]: { ...d, stage: d.stage as PrepareStageKey } }))
                  setActivePrepareStage(d.stage as PrepareStageKey)
                }
              } else if (event === 'interview.stage.failed') {
                const d = data as { stage: string; message: string }
                const stageIdx = stageOrder.indexOf(d.stage as PrepareStageKey)
                if (stageIdx >= 0) {
                  setProgressStages((prev) =>
                    prev.map((s, i) => i === stageIdx ? { ...s, status: 'error' as const, detail: d.message } : s)
                  )
                }
              } else if (event === 'interview.stage.delta') {
                // 仅保留事件，不写入 UI 文本，避免和 interviewer.delta 重复追加
              } else if (event === 'interviewer.delta') {
                const d = data as { target: string; delta: string }
                if (d.target === 'start_question' || d.target === 'followup' || d.target === 'report') {
                  appendStreamingText(d.target, d.delta)
                }
              } else if (event === 'interviewer.snapshot') {
                const d = data as { target: string; text: string }
                if (d.target === 'start_question' || d.target === 'followup' || d.target === 'report') {
                  setStreamingSnapshot(d.target, d.text)
                }
              } else if (event === 'interviewer.completed') {
                const d = data as { target: string; text: string }
                if (d.target === 'start_question' || d.target === 'followup' || d.target === 'report') {
                  setStreamingSnapshot(d.target, d.text)
                }
              } else if (event === 'interview.question.created') {
                // 不修改阶段状态，阶段只由 interview.stage.completed 控制
              } else if (event === 'interview.started') {
                const d = data as { session: InterviewSession; first_turn: InterviewTurn; knowledge_status: KnowledgeStatus }
                clearStreamingTarget('start_question')
                setSession(d.session)
                setTurns([d.first_turn])
                setKnowledge(d.knowledge_status)
                setAnswer('')
                setConfigCollapsed(true)
                void loadInterviewSessions()
                if (interviewMode === 'voice') {
                  void speakAndAutoRecord(d.first_turn.question, d.session.id, d.first_turn.id)
                }
              } else if (event === 'runtime.error') {
                const d = data as { message: string }
                clearStreamingTarget('start_question')
                setProgressStages((prev) =>
                  prev.map((s) => s.status === 'active' ? { ...s, status: 'error' as const, detail: d.message } : s)
                )
                Message.error(d.message)
              }
            },
            onDone: () => { clearStreamingTarget('start_question'); resolve() },
            onError: () => { clearStreamingTarget('start_question'); fallbackREST().then(resolve) },
          },
          { maxRetries: 3, timeoutMs: 60000 }
        )
      })
    } catch {
      await fallbackREST()
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

  // 知识库 reload 已由管理员路由处理，学生端不再提供

  // ── TTS：面试官语音朗读问题 ──

  const speakQuestion = async (text: string, sessionId?: number, turnId?: number): Promise<void> => {
    // P1: 优先尝试服务端 TTS
    if (sessionId && turnId) {
      try {
        const ttsData = await apiRequest<{
          mode: string
          text: string
          audio_base64: string | null
          content_type: string | null
          provider: string | null
          reason: string | null
        }>(`/api/v1/student/interviews/${sessionId}/turns/${turnId}/voice/reply`)

        if (ttsData.mode === 'server_tts' && ttsData.audio_base64) {
          // 服务端 TTS：播放 base64 音频
          setTtsMode('server_tts')
          const audioSrc = `data:${ttsData.content_type || 'audio/mpeg'};base64,${ttsData.audio_base64}`
          return new Promise((resolve) => {
            const audio = new Audio(audioSrc)
            audio.onplay = () => setVoiceSpeaking(true)
            audio.onended = () => { setVoiceSpeaking(false); resolve() }
            audio.onerror = () => { setVoiceSpeaking(false); resolve() }
            audio.play().catch(() => { setVoiceSpeaking(false); resolve() })
          })
        }
        // browser_tts 模式：继续使用浏览器 SpeechSynthesis
      } catch {
        // 接口失败时降级到浏览器 TTS
      }
    }

    // Fallback: 浏览器 SpeechSynthesis
    setTtsMode('browser_tts')
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        Message.warning('当前浏览器不支持语音合成，请使用文字模式。')
        resolve()
        return
      }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 0.95
      utterance.pitch = 1.0
      utterance.onstart = () => setVoiceSpeaking(true)
      utterance.onend = () => { setVoiceSpeaking(false); resolve() }
      utterance.onerror = () => { setVoiceSpeaking(false); resolve() }
      window.speechSynthesis.speak(utterance)
    })
  }

  // 朗读最新问题并在结束后自动开始录音
  const speakAndAutoRecord = async (questionText: string, sessionId?: number, turnId?: number) => {
    if (interviewMode !== 'voice') return
    setVoicePhase('speaking')
    await speakQuestion(questionText, sessionId, turnId)
    // 朗读结束后自动开始录音
    if (interviewMode === 'voice') {
      await startRecording()
    }
  }

  // ── 语音面试：录音控制（含静音检测）──

  const SPEECH_THRESHOLD = 0.035
  const SILENCE_AFTER_SPEECH_MS = 1500
  const NO_SPEECH_TIMEOUT_MS = 15000
  const MAX_RECORDING_MS = 120000

  const startRecording = async () => {
    // P1: 防重入检查
    if (voicePhase === 'listening' || voicePhase === 'uploading' || voicePhase === 'thinking') return
    try {
      setVoicePhase('listening')
      setSilenceDetected(false)
      setHasSpoken(false)
      speechStartedRef.current = false
      silenceStartRef.current = null

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = pickSupportedAudioMimeType()
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderMimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm'
      audioChunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data)
      }
      recorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop())
      }
      recorder.start(100)
      mediaRecorderRef.current = recorder
      setRecording(true)
      setRecordingDuration(0)
      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1)
      }, 1000)

      // P1: 静音检测 - 使用 Web Audio API
      try {
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext
        const source = audioContext.createMediaStreamSource(stream)
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 2048
        source.connect(analyser)
        analyserRef.current = analyser

        const dataArray = new Float32Array(analyser.fftSize)
        silenceCheckRef.current = setInterval(() => {
          if (!analyserRef.current) return
          analyserRef.current.getFloatTimeDomainData(dataArray)
          let sum = 0
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i] * dataArray[i]
          }
          const rms = Math.sqrt(sum / dataArray.length)

          if (rms > SPEECH_THRESHOLD) {
            // 检测到声音
            if (!speechStartedRef.current) {
              speechStartedRef.current = true
              setHasSpoken(true)
            }
            silenceStartRef.current = null
            setSilenceDetected(false)
          } else if (speechStartedRef.current) {
            // 说话后静音
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now()
            } else if (Date.now() - silenceStartRef.current > SILENCE_AFTER_SPEECH_MS) {
              // 静音超过阈值，自动提交
              setSilenceDetected(true)
              Message.info('检测到静音，自动提交回答。')
              submitVoiceAnswer()
            }
          }
        }, 200)
      } catch {
        // AudioContext 创建失败，降级到无静音检测模式
      }

      // 最长录音自动停止
      maxRecordingTimerRef.current = setTimeout(() => {
        if (recorder.state === 'recording') {
          Message.info('已达到最长录音时长，自动提交。')
          submitVoiceAnswer()
        }
      }, MAX_RECORDING_MS)

      // 无声音超时提示
      noSpeechTimerRef.current = setTimeout(() => {
        if (!speechStartedRef.current && recorder.state === 'recording') {
          Message.info('未检测到声音，请说话或点击"我说完了"手动提交。')
        }
      }, NO_SPEECH_TIMEOUT_MS)
    } catch {
      setVoicePhase('error')
      Message.error('无法访问麦克风，请检查浏览器权限设置。')
    }
  }

  const stopRecording = (): Promise<Blob> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current
      if (!recorder || recorder.state === 'inactive') {
        resolve(new Blob())
        return
      }
      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: recorderMimeTypeRef.current || 'audio/webm' })
        resolve(blob)
      }
      recorder.stop()
      setRecording(false)
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current)
        recordingTimerRef.current = null
      }
      if (maxRecordingTimerRef.current) {
        clearTimeout(maxRecordingTimerRef.current)
        maxRecordingTimerRef.current = null
      }
      if (noSpeechTimerRef.current) {
        clearTimeout(noSpeechTimerRef.current)
        noSpeechTimerRef.current = null
      }
      if (silenceCheckRef.current) {
        clearInterval(silenceCheckRef.current)
        silenceCheckRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {})
        audioContextRef.current = null
        analyserRef.current = null
      }
    })
  }

  // ── 语音面试：提交录音（multipart/form-data）──

  const submitVoiceAnswer = async () => {
    if (!session || !pendingTurn || loading) return
    // P1: 防重入检查
    if (voicePhase === 'uploading' || voicePhase === 'thinking') return
    setVoicePhase('uploading')
    setLoading(true)
    setReportProgress([])
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)

    try {
      const audioBlob = await stopRecording()
      if (audioBlob.size === 0) {
        Message.warning('录音为空，请重新录音。')
        setVoicePhase('idle')
        return
      }

      setVoicePhase('thinking')
      // 使用 FormData 上传（不用 base64 JSON）
      const audioMimeType = audioBlob.type || recorderMimeTypeRef.current || 'audio/webm'
      const audioExtension = extensionForAudioMimeType(audioMimeType)
      const formData = new FormData()
      formData.append('file', audioBlob, `recording.${audioExtension}`)
      formData.append('turn_id', String(pendingTurn.id))
      formData.append('request_id', crypto.randomUUID())

      const fallbackREST = async () => {
        const res = await apiRequest<{
          turn_id: number
          transcript: { text: string; language: string; confidence: number; audio_format?: string; audio_size_bytes?: number }
        }>(`/api/v1/student/interviews/${session.id}/turns/voice/transcribe`, {
          method: 'POST',
          body: formData,
        })
        return res
      }

      clearStreamingTarget('followup')
      let transcriptResult: {
        turn_id: number
        transcript: { text: string; language: string; confidence: number; audio_format?: string; audio_size_bytes?: number }
      } | null = null

      try {
        const runRes = await apiRequest<{ run_id: string }>(`/api/v1/student/interviews/${session.id}/turns/voice/run`, {
          method: 'POST',
          body: formData,
        })

        await new Promise<void>((resolve) => {
          subscribeInterviewRun(
            runRes.run_id,
            {
              onEvent: (event, data) => {
                if (event === 'runtime.status') {
                  const d = data as { label?: string }
                  const label = d.label
                  if (label) setReportProgress((prev) => [...prev, label])
                } else if (event === 'interviewer.delta') {
                  const d = data as { target: string; delta: string }
                  if (d.target === 'followup') appendStreamingText('followup', d.delta)
                } else if (event === 'interviewer.snapshot') {
                  const d = data as { target: string; text: string }
                  if (d.target === 'followup') setStreamingSnapshot('followup', d.text)
                } else if (event === 'interviewer.completed') {
                  const d = data as { target: string; text: string }
                  if (d.target === 'followup') setStreamingSnapshot('followup', d.text)
                } else if (event === 'interview.voice.transcribed') {
                  transcriptResult = data as typeof transcriptResult
                  clearStreamingTarget('followup')
                } else if (event === 'runtime.error') {
                  const d = data as { message: string }
                  clearStreamingTarget('followup')
                  Message.error(d.message)
                }
              },
              onDone: () => { clearStreamingTarget('followup'); resolve() },
              onError: () => {
                clearStreamingTarget('followup')
                Message.warning('事件流中断，正在刷新面试记录。')
                fallbackREST().then((res) => { transcriptResult = res }).finally(resolve)
              },
            },
            { maxRetries: 3, timeoutMs: 120000 }
          )
        })
      } catch {
        transcriptResult = await fallbackREST()
      }

      if (!transcriptResult?.transcript?.text?.trim()) {
        setVoicePhase('idle')
        return
      }

      const draft: VoiceTranscriptDraft = {
        turnId: transcriptResult.turn_id || pendingTurn.id,
        text: transcriptResult.transcript.text.trim(),
        language: transcriptResult.transcript.language,
        confidence: transcriptResult.transcript.confidence,
        audioFormat: transcriptResult.transcript.audio_format,
        audioSizeBytes: transcriptResult.transcript.audio_size_bytes,
      }
      setVoiceDraft(draft)
      setVoiceDraftText(draft.text)
      setVoicePhase('idle')
      Message.success('语音已转成文字，请确认后提交。')
      return
      /*

      const turnResult = null as {
        current_turn: InterviewTurn
        next_turn: InterviewTurn | null
        is_finished: boolean
        report_id: number | null
      } | null
      const res = turnResult as {
          current_turn: InterviewTurn
          next_turn: InterviewTurn | null
          is_finished: boolean
          report_id: number | null
      }

      // 更新 turns
      setTurns((prev) => {
        const updated = prev.map((t) => (t.id === res.current_turn.id ? res.current_turn : t))
        return res.next_turn ? [...updated, res.next_turn] : updated
      })

      if (res.is_finished) {
        setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        setVoicePhase('idle')
        await loadReport(session.id, true)
      } else if (res.next_turn && interviewMode === 'voice') {
        // 自动朗读下一问
        setVoicePhase('speaking')
        await speakAndAutoRecord(res.next_turn.question, session.id, res.next_turn.id)
      } else {
        setVoicePhase('idle')
      }
      await loadInterviewSessions()
      */
    } catch (error) {
      setVoicePhase('error')
      Message.error(error instanceof Error ? error.message : '语音提交失败')
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

  const submitAnswer = async (overrideAnswer?: string, overrideTurn?: InterviewTurn | null) => {
    const targetTurn = overrideTurn ?? pendingTurn
    const currentAnswer = (overrideAnswer ?? answer).trim()
    if (!session || !targetTurn || !currentAnswer) return
    setOptimisticAnswer({ turnId: targetTurn.id, text: currentAnswer })
    setAnswer('')
    setLoading(true)
    setAnswerProgressStages(createAnswerProgressStages().map((stage, idx) => idx === 0 ? { ...stage, status: 'active' as const } : stage))
    clearStreamingTarget('followup')
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)

    const fallbackREST = async () => {
      try {
        const res = await apiRequest<{
          current_turn: InterviewTurn
          next_turn: InterviewTurn | null
          is_finished: boolean
        }>(`/api/v1/student/interviews/${session.id}/turns`, {
          method: 'POST',
          body: JSON.stringify({ answer: currentAnswer, turn_id: targetTurn.id, request_id: crypto.randomUUID() }),
        })
        setTurns((prev) => {
          const updated = prev.map((turn) => (turn.id === res.current_turn.id ? res.current_turn : turn))
          return res.next_turn ? [...updated, res.next_turn] : updated
        })
        setOptimisticAnswer(null)
        setAnswer('')
        if (res.is_finished) {
          setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
          await loadReport(session.id, true)
        }
        await loadInterviewSessions()
      } catch (error) {
        setOptimisticAnswer(null)
        setAnswer(currentAnswer)
        Message.error(error instanceof Error ? error.message : '提交回答失败')
      }
    }

    try {
      const runRes = await apiRequest<{ run_id: string }>(`/api/v1/student/interviews/${session.id}/turns/runs/submit`, {
        method: 'POST',
        body: JSON.stringify({ answer: currentAnswer, turn_id: targetTurn.id, request_id: crypto.randomUUID() }),
      })

      let resultData: { current_turn: InterviewTurn; next_turn: InterviewTurn | null; is_finished: boolean; report_id?: number | null } | null = null

      await new Promise<void>((resolve) => {
        subscribeInterviewRun(
          runRes.run_id,
          {
            onEvent: (event, data) => {
              if (event === 'interview.turn.completed') {
                resultData = data as typeof resultData
                updateAnswerProgress('completed')
                clearStreamingTarget('followup')
              } else if (event === 'runtime.status') {
                const d = data as { phase?: string; label?: string }
                if (d.phase) updateAnswerProgress(d.phase, d.label)
              } else if (event === 'interviewer.delta') {
                const d = data as { target: string; delta: string }
                if (d.target === 'followup') appendStreamingText('followup', d.delta)
              } else if (event === 'interviewer.snapshot') {
                const d = data as { target: string; text: string }
                if (d.target === 'followup') setStreamingSnapshot('followup', d.text)
              } else if (event === 'interviewer.completed') {
                const d = data as { target: string; text: string }
                if (d.target === 'followup') setStreamingSnapshot('followup', d.text)
              } else if (event === 'runtime.error') {
                const d = data as { message: string }
                clearStreamingTarget('followup')
                Message.error(d.message)
              }
            },
            onDone: () => { clearStreamingTarget('followup'); resolve() },
            onError: () => { clearStreamingTarget('followup'); fallbackREST().then(resolve) },
          },
          { maxRetries: 3, timeoutMs: 60000 }
        )
      })

      if (resultData) {
        const res = resultData as { current_turn: InterviewTurn; next_turn: InterviewTurn | null; is_finished: boolean }
        setTurns((prev) => {
          const updated = prev.map((turn) => (turn.id === res.current_turn.id ? res.current_turn : turn))
          return res.next_turn ? [...updated, res.next_turn] : updated
        })
        setOptimisticAnswer(null)
        setAnswer('')
        if (res.is_finished) {
          setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
          await loadReport(session.id, true)
        }
        await loadInterviewSessions()
      } else {
        setOptimisticAnswer(null)
        setAnswer(currentAnswer)
      }
    } catch {
      await fallbackREST()
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

  const confirmVoiceDraft = async () => {
    if (!voiceDraft || !voiceDraftText.trim()) return
    const targetTurn = turns.find((turn) => turn.id === voiceDraft.turnId) ?? pendingTurn
    setVoiceDraft(null)
    setVoiceDraftText('')
    await submitAnswer(voiceDraftText.trim(), targetTurn)
  }

  const editVoiceDraftAsText = () => {
    if (!voiceDraftText.trim()) return
    setAnswer(voiceDraftText.trim())
    setInterviewMode('text')
    setVoiceDraft(null)
    setVoiceDraftText('')
    setVoicePhase('idle')
  }

  const retryVoiceDraft = async () => {
    setVoiceDraft(null)
    setVoiceDraftText('')
    setVoicePhase('idle')
    await startRecording()
  }

  const handleAnswerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!loading && answer.trim()) submitAnswer()
  }

  const loadReport = async (sessionId = session?.id, forceGenerate = false) => {
    if (!sessionId) return
    setLoading(true)
    clearStreamingTarget('report')
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)
    setReportProgress([
      '感谢你参加本轮面试，现在我会把你的回答、题库命中和评分维度整理成报告。',
      '正在回看你的项目细节和技术回答。',
      '正在生成维度评分，并与历史表现做对比。',
    ])

    const isActive = session?.status === 'active' || forceGenerate
    if (isActive) {
      try {
        const runRes = await apiRequest<{ run_id: string }>(`/api/v1/student/interviews/${sessionId}/report/run`, {
          method: 'POST',
        })

        let reportData: Report | null = null

        await new Promise<void>((resolve) => {
          subscribeInterviewRun(
            runRes.run_id,
            {
              onEvent: (event, data) => {
                if (event === 'runtime.status') {
                  const d = data as { phase: string; label: string }
                  setReportProgress((prev) => [...prev, d.label])
                } else if (event === 'interviewer.delta') {
                  const d = data as { target: string; delta: string }
                  if (d.target === 'report') appendStreamingText('report', d.delta)
                } else if (event === 'interviewer.snapshot') {
                  const d = data as { target: string; text: string }
                  if (d.target === 'report') setStreamingSnapshot('report', d.text)
                } else if (event === 'interviewer.completed') {
                  const d = data as { target: string; text: string }
                  if (d.target === 'report') setStreamingSnapshot('report', d.text)
                } else if (event === 'interview.report.created') {
                  reportData = data as Report
                  clearStreamingTarget('report')
                } else if (event === 'runtime.error') {
                  const d = data as { message: string }
                  clearStreamingTarget('report')
                  Message.error(d.message)
                }
              },
              onDone: () => { clearStreamingTarget('report'); resolve() },
              onError: () => {
                clearStreamingTarget('report')
                apiRequest<Report>(`/api/v1/student/interviews/${sessionId}/finish`, { method: 'POST' })
                  .then((data) => { reportData = data; resolve() })
                  .catch((err) => { Message.error(err instanceof Error ? err.message : '生成报告失败'); resolve() })
              },
            },
            { maxRetries: 3, timeoutMs: 120000 }
          )
        })

        if (reportData && isReport(reportData as ReportLookupResponse)) {
          setReport(reportData)
          setReportCollapsed(false)
          setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
          await loadInterviewSessions()
        }
      } catch (error) {
        Message.error(error instanceof Error ? error.message : '生成报告失败')
      } finally {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current)
          progressTimerRef.current = null
        }
        setLoading(false)
      }
    } else {
      try {
        const data = await apiRequest<ReportLookupResponse>(`/api/v1/student/interviews/${sessionId}/report`)
        if (isReport(data)) {
          setReport(data)
          setReportCollapsed(false)
        } else {
          Message.info(data.message || '报告尚未生成')
        }
        await loadInterviewSessions()
      } catch (error) {
        Message.error(error instanceof Error ? error.message : '加载报告失败')
      } finally {
        if (progressTimerRef.current) {
          clearInterval(progressTimerRef.current)
          progressTimerRef.current = null
        }
        setLoading(false)
      }
    }
  }

  const activeProgressIndex = Math.max(0, progressStages.findIndex((stage) => stage.status === 'active'))
  const doneProgressCount = progressStages.filter((stage) => stage.status === 'done').length
  const progressPercent = progressStages.length > 0
    ? Math.min(100, Math.round(((doneProgressCount + (activeProgressIndex >= 0 ? 0.5 : 0)) / progressStages.length) * 100))
    : 0
  const activeAnswerStageIndex = Math.max(0, answerProgressStages.findIndex((stage) => stage.status === 'active'))
  const doneAnswerStageCount = answerProgressStages.filter((stage) => stage.status === 'done').length
  const answerProgressPercent = answerProgressStages.length > 0
    ? Math.min(100, Math.round(((doneAnswerStageCount + (activeAnswerStageIndex >= 0 ? 0.5 : 0)) / answerProgressStages.length) * 100))
    : 0
  const activeAnswerStage = answerProgressStages.find((stage) => stage.status === 'active') ?? answerProgressStages.at(-1)

  return (
    <>
    <main className={`interview-page${configCollapsed ? ' interview-page--immersive' : ''}`}>
      <section className="interview-config-panel">
        <div className="interview-mode-strip">
          <button
            type="button"
            className={`interview-mode-card${interviewMode === 'text' ? ' active' : ''}`}
            onClick={() => setInterviewMode('text')}
          >
            <img className="interview-inline-icon" src={voiceIcon} alt="" aria-hidden="true" />
            <span>文字面试</span>
            <small>{interviewMode === 'text' ? '当前' : '切换'}</small>
          </button>
          <button
            type="button"
            className={`interview-mode-card${interviewMode === 'voice' ? ' active' : ''}`}
            onClick={() => setInterviewMode('voice')}
            disabled={session?.status === 'active' && interviewMode === 'text'}
            title={session?.status === 'active' && interviewMode === 'text' ? '面试进行中无法切换模式' : '语音面试需要浏览器麦克风权限'}
          >
            <IconVideoCamera />
            <span>语音面试</span>
            <small>{interviewMode === 'voice' ? '当前' : '需麦克风'}</small>
          </button>
        </div>

        <div className="interview-field">
          <span>大模型</span>
          <Select
            value={selectedModelId ? String(selectedModelId) : undefined}
            onChange={(val) => setSelectedModelId(Number(val) || undefined)}
            placeholder="选择面试官大脑"
            disabled={session?.status === 'active'}
            style={{ width: '100%' }}
          >
            {modelOptions.map((m) => (
              <Select.Option key={m.id} value={String(m.id)} title={`${m.display_name} · ${m.model_identifier}`}>{m.display_name}</Select.Option>
            ))}
          </Select>
          {modelError && <small className="interview-warning-text">{modelError}</small>}
          {modelOptions.length === 0 && !modelError && (
            <small className="interview-warning-text">暂无对学生开放的模型，请管理员在模型广场开启「对学生开放」并配置 API Key。</small>
          )}
        </div>

        <div className="interview-field">
          <span>目标岗位 <em className="interview-field-required">*</em></span>
          <Input value={targetRole} onChange={setTargetRole} disabled={session?.status === 'active'} placeholder="Java 后端开发工程师 / 产品经理 / 算法实习生" />
        </div>

        <div className="interview-field">
          <span>岗位 JD <em className="interview-field-required">*</em></span>
          <Input.TextArea value={jobDescription} onChange={setJobDescription} autoSize={{ minRows: 4, maxRows: 8 }} disabled={session?.status === 'active'} placeholder="粘贴目标岗位要求、职责描述、技术栈或公司招聘 JD。" />
        </div>

        <div className="interview-resume-source">
          <span>简历来源</span>
          <div className="interview-resume-picker">
            <button
              type="button"
              className={`attachment-chip interview-resume-select${resumePickerVisible ? ' active' : ''}`}
              disabled={session?.status === 'active'}
              onClick={() => {
                setResumePickerVisible((visible) => {
                  const next = !visible
                  if (next) void loadResumes()
                  return next
                })
              }}
            >
              <img className="interview-inline-icon" src={resumeIcon} alt="" aria-hidden="true" />
              <span>{resumeSourceLabel}</span>
            </button>
            {resumePickerVisible && (
              <div className="composer-settings-menu interview-resume-menu" onClick={(event) => event.stopPropagation()}>
                <div className="composer-settings-heading">
                  <img className="interview-inline-icon interview-inline-icon--sm" src={resumeIcon} alt="" aria-hidden="true" />
                  <span>选择简历来源</span>
                </div>
                <div className="composer-settings-options">
                  <button
                    type="button"
                    className={`composer-settings-option${resumeSource === 'online' ? ' selected' : ''}`}
                    onClick={() => {
                      setResumeSource('online')
                      void loadResumes()
                    }}
                  >
                    <span>在线简历</span>
                    {resumeSource === 'online' && <IconCheck />}
                  </button>
                  {resumeSource === 'online' && (
                    <div className="interview-resume-list">
                      {loadingResumes && <div className="interview-resume-list-loading"><Spin size={12} /><span>加载中...</span></div>}
                      {!loadingResumes && resumes.length === 0 && <div className="interview-resume-list-empty">暂无在线简历</div>}
                      {!loadingResumes && resumes.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          className={`interview-resume-list-item${selectedResumeId === r.id ? ' selected' : ''}`}
                          onClick={() => {
                            setResumeSource('online')
                            setSelectedResumeId(r.id)
                            setResumePickerVisible(false)
                          }}
                        >
                          <span className="interview-resume-list-title">{r.title || `简历 #${r.id}`}</span>
                          {r.updated_at && <span className="interview-resume-list-time">{new Date(r.updated_at).toLocaleDateString()}</span>}
                          {selectedResumeId === r.id && <IconCheck />}
                        </button>
                      ))}
                      {!loadingResumes && resumes.length > 0 && (
                        <button
                          type="button"
                          className={`interview-resume-list-item${selectedResumeId === null ? ' selected' : ''}`}
                          onClick={() => {
                            setResumeSource('online')
                            setSelectedResumeId(null)
                            setResumePickerVisible(false)
                          }}
                        >
                          <span className="interview-resume-list-title">自动选择（优先可读取简历）</span>
                          {selectedResumeId === null && <IconCheck />}
                        </button>
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`composer-settings-option${resumeSource === 'upload' ? ' selected' : ''}`}
                    onClick={() => {
                      setResumeSource('upload')
                      setResumePickerVisible(false)
                    }}
                    style={{ display: uploadedResumeText ? undefined : 'none' }}
                  >
                    <span>{uploadedResumeName ? `使用已上传：《${uploadedResumeName}》` : '使用已上传简历'}</span>
                    {resumeSource === 'upload' && <IconCheck />}
                  </button>
                </div>
                <div className="composer-settings-divider" />
                <Button
                  icon={<IconRefresh />}
                  loading={uploadingResume}
                  disabled={session?.status === 'active'}
                  onClick={() => resumeInputRef.current?.click()}
                  long
                >
                  上传并读取简历
                </Button>
              </div>
            )}
          </div>
          <input
            ref={resumeInputRef}
            type="file"
            hidden
            accept=".pdf,.docx,.txt,.md"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void handleResumeUpload(file)
            }}
          />
          {resumeSource === 'upload' && uploadedResumeText && (
            <Tag color="green">已解析约 {uploadedResumeText.length.toLocaleString()} 字符</Tag>
          )}
          <p className="interview-field-hint">
            在线简历会优先读取「简历制作」中勾选了「智能体可读取」的简历；未勾选时回退到最新保存版本。选择上传时，仅使用本次解析出的简历文本。
          </p>
        </div>

        <div className="interview-field-row">
          <div className="interview-field">
            <span>面试类型</span>
            <Select value={interviewType} onChange={setInterviewType} disabled={session?.status === 'active'} style={{ width: '100%' }}>
              {INTERVIEW_TYPE_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
            </Select>
          </div>
          <div className="interview-field">
            <span>轮次</span>
            <InputNumber
              value={Number(roundLimit) || 8}
              min={3}
              max={20}
              step={1}
              precision={0}
              disabled={session?.status === 'active'}
              onChange={(value) => setRoundLimit(String(value ?? 8))}
            />
            {normalizedRoundLimit < 8 && <small className="interview-warning-text">少于 8 轮时，综合评分报告可能不够准确。</small>}
          </div>
        </div>

        <div className="interview-field">
          <span>面试风格</span>
          <Select value={interviewStyle} onChange={setInterviewStyle} disabled={session?.status === 'active'} style={{ width: '100%' }}>
            <Select.Option value="strict">严格追问</Select.Option>
            <Select.Option value="stress">压力面试</Select.Option>
            <Select.Option value="friendly">温和训练</Select.Option>
            <Select.Option value="coach">教练式引导</Select.Option>
            <Select.Option value="executive">高管式审视</Select.Option>
          </Select>
        </div>

        <div className="interview-field">
          <span>面试重点（可多选）</span>
          <Select mode="multiple" value={focusTags} onChange={setFocusTags} disabled={session?.status === 'active'} placeholder="选择你希望重点练习的方向" style={{ width: '100%' }}>
            {FOCUS_OPTIONS.map((o) => <Select.Option key={o.value} value={o.value}>{o.label}</Select.Option>)}
          </Select>
        </div>

        <Button type="primary" icon={session?.status === 'active' ? <IconRefresh /> : <IconPlayArrow />} loading={loading && !pendingTurn} onClick={startInterview} long>
          {session?.status === 'active' ? '重新开始一场' : '开始面试'}
        </Button>

        <details className="interview-advanced-settings">
          <summary>
            <IconSettings />
            <span>高级设置</span>
            <small>追问要求、策略、知识库与记录</small>
          </summary>
          <div className="interview-advanced-body">
            <div className="interview-field">
              <span>自定义追问要求</span>
              <Input.TextArea value={customInstruction} onChange={setCustomInstruction} autoSize={{ minRows: 2, maxRows: 5 }} disabled={session?.status === 'active'} placeholder="例如：多问数据库事务；少问八股；每轮都要追问量化结果。" />
            </div>

            <div className="interview-prompt-preview">
              <div>
                <strong>当前提示词策略</strong>
                <p>{promptPreview}</p>
              </div>
              <Tag color={interviewStyle === 'friendly' ? 'green' : interviewStyle === 'stress' ? 'red' : 'blue'}>
                {INTERVIEW_STYLE_LABELS[interviewStyle] ?? '严格追问'}
              </Tag>
            </div>


            <div className="knowledge-status">
              <img className="interview-card-icon" src={knowledgeIcon} alt="" aria-hidden="true" />
              <div>
                <strong>RAG 知识库</strong>
                <p>{knowledge ? `${knowledge.document_count} 个文档，${knowledge.chunk_count} 个知识块` : '正在检查知识库'}</p>
              </div>
              <Tag color={knowledge?.vector_ready ? 'green' : 'orange'}>{knowledge?.retriever ?? 'checking'}</Tag>
            </div>

            <div className="interview-history-panel">
              <div className="interview-history-head">
                <strong>面试记录</strong>
                <button type="button" onClick={() => void loadInterviewSessions()}>刷新</button>
              </div>
              {historyGroups.length === 0 ? (
                <p className="interview-history-empty">暂无历史面试</p>
              ) : (
                historyGroups.map(([date, items]) => (
                  <div key={date} className="interview-history-day">
                    <button type="button" className="interview-history-date" onClick={() => toggleHistoryDate(date)}>
                      <span>{collapsedHistoryDates.has(date) ? '›' : '⌄'}</span>
                      <strong>{date}</strong>
                      <small>{items.length}</small>
                    </button>
                    {!collapsedHistoryDates.has(date) && items.map((item) => (
                      <div key={item.id} className="interview-history-item-wrap">
                        <button
                          type="button"
                          className={`interview-history-item${session?.id === item.id ? ' active' : ''}`}
                          onClick={() => void loadInterviewDetail(item.id)}
                        >
                          <b>{formatTimeLabel(item.created_at)}</b>
                          <em>{item.target_role || '未填写目标岗位'}</em>
                          <small>{item.status === 'active' ? '进行中' : '已结束'} · {item.status === 'completed' ? `${item.round_limit}/${item.round_limit}` : `0/${item.round_limit}`} 轮</small>
                        </button>
                        <button
                          type="button"
                          className="interview-history-delete"
                          aria-label="删除面试记录"
                          title="删除面试记录"
                          onClick={(event) => void deleteInterviewSession(event, item)}
                        >
                          <IconDelete />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        </details>
      </section>

      <section className={`interview-room${report && !reportCollapsed ? ' interview-room--report-expanded' : ''}`}>
        <div className="interview-room-header">
          <div>
            <h2>{session ? session.target_role : '准备进入面试房间'}</h2>
            <p>{session ? `${formatDateLabel(session.created_at)} ${formatTimeLabel(session.created_at)} · 第 ${turns.length}/${session.round_limit} 轮 · ${session.status === 'active' ? '面试中' : '已结束'}` : '选择岗位、模型和风格后进入沉浸式训练。Enter 发送，Shift + Enter 换行。'}</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {report && (
              <Button type={reportCollapsed ? 'outline' : 'primary'} size="small" onClick={() => setReportCollapsed((c) => !c)}>
                {reportCollapsed ? '展开报告' : '收起报告'}
              </Button>
            )}
            <Button type="text" icon={<IconHistory />} onClick={() => {
              if (configCollapsed) {
                setTargetRole(''); setJobDescription(''); setInterviewType('first_round')
                setInterviewStyle('strict'); setRoundLimit('8'); setSelectedResumeId(null)
                setFocusTags(['resume_project']); setCustomInstruction('')
                setUploadedResumeName(''); setUploadedResumeText(''); setResumeSource('online')
              }
              setConfigCollapsed((c) => !c)
            }}>{configCollapsed ? '再试一次' : '收起设置'}</Button>
          </div>
        </div>

        <div className="interview-dialogue">
          {turns.length === 0 && (
            <div className="interview-empty">
              <div className="interview-empty-orbit">
                <img src={aiInterviewerIcon} alt="" aria-hidden="true" />
              </div>
              <h3>面试官已就位</h3>
              <p>从岗位目标开始，系统会按“证据、细节、指标、取舍”逐步追问。</p>
              <div className="interview-empty-checks">
                <span><IconCheckCircle /> {INTERVIEW_TYPE_META[interviewType]}</span>
                <span><IconThunderbolt /> {normalizedRoundLimit} 轮训练</span>
                <span><IconBulb /> 会后定位最薄弱项</span>
              </div>
            </div>
          )}

          {progressStages.length > 0 && turns.length === 0 && (
            <div className="interview-progress-stream">
              <div className="interview-progress-head">
                <Spin size={16} />
                <strong>面试准备中</strong>
              </div>
              <div className="interview-runtime-statusline">
                <span>思考 {formatDuration(progressElapsed)}</span>
                <span>{INTERVIEW_STYLE_TONE[interviewStyle]}</span>
              </div>
              <div className="interview-progress-bar" aria-label={`准备进度 ${progressPercent}%`}>
                <div className="interview-progress-bar-track">
                  <div className="interview-progress-bar-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <span>{progressPercent}%</span>
              </div>
              <div className="interview-progress-stages">
                {progressStages.map((stage, idx) => {
                  const stageKey = stageOrder[idx] as PrepareStageKey
                  return (
                    <button
                      key={idx}
                      type="button"
                      className={`interview-progress-stage interview-progress-stage--${stage.status}${activePrepareStage === stageKey ? ' interview-progress-stage--selected' : ''}`}
                      onClick={() => setActivePrepareStage(stageKey)}
                    >
                      {stage.status === 'done' && <IconCheckCircle />}
                      {stage.status === 'active' && <Spin size={12} />}
                      {stage.status === 'error' && <IconExclamationCircle />}
                      {stage.status === 'pending' && <span className="stage-dot" />}
                      <span>{stage.label}</span>
                      {stage.detail && <small className="stage-error-detail">{stage.detail}</small>}
                    </button>
                  )
                })}
              </div>
              {prepareStageReports[activePrepareStage] && (
                <div className="interview-stage-report" style={{ animation: 'fadeIn 0.25s ease-in' }}>
                  <strong>{prepareStageReports[activePrepareStage]!.title}</strong>
                  <p>{prepareStageReports[activePrepareStage]!.summary}</p>
                  {prepareStageReports[activePrepareStage]!.details.length > 0 && (
                    <ul>
                      {prepareStageReports[activePrepareStage]!.details.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  )}
                  {prepareStageReports[activePrepareStage]!.evidence && prepareStageReports[activePrepareStage]!.evidence!.length > 0 && (
                    <div className="stage-report-evidence">
                      <small>证据：</small>
                      {prepareStageReports[activePrepareStage]!.evidence!.map((e, i) => <small key={i}>"{e}"</small>)}
                    </div>
                  )}
                </div>
              )}
              {streamingBlocks.start_question && (
                <div className="interview-streaming-text">
                  <MarkdownMessage content={streamingBlocks.start_question} />
                </div>
              )}
              {progressStages.some((s) => s.status === 'error') && (
                <Button
                  type="outline"
                  size="small"
                  icon={<IconRefresh />}
                  onClick={() => { setProgressStages([]); startInterview() }}
                  style={{ marginTop: 8 }}
                >
                  重试
                </Button>
              )}
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="interview-turn">
              <div className="interview-message interviewer">
                <div className="bubble-title">AI 面试官 · Q{turn.turn_index}</div>
                <div className="bubble-content"><MarkdownMessage content={normalizeQuestionMarkdown(turn.question)} /></div>
                {turn.knowledge_points && turn.knowledge_points.length > 0 && (
                  <div className="knowledge-tags">
                    {turn.knowledge_points.slice(0, 4).map((item) => <Tag key={item}>{item}</Tag>)}
                  </div>
                )}
                {/* P1-3: 考察点和追问原因 */}
                {turn.question_reason && (
                  <div className="interview-question-meta">
                    <span className="interview-question-meta-label">考察意图</span>
                    <span>{turn.question_reason}</span>
                  </div>
                )}
                {turn.capability_tags && turn.capability_tags.length > 0 && (
                  <div className="interview-question-meta">
                    <span className="interview-question-meta-label">考察点</span>
                    {turn.capability_tags.map((tag) => <Tag key={tag} color="blue" style={{ fontSize: 11 }}>{tag}</Tag>)}
                  </div>
                )}
                {turn.top_sources && turn.top_sources.length > 0 && (
                  <div className="interview-question-meta">
                    <span className="interview-question-meta-label">题库来源</span>
                    <span style={{ fontSize: 11, color: '#86909c' }}>
                      {turn.top_sources.map((s) => s.topic || s.title).filter(Boolean).join('、')}
                    </span>
                  </div>
                )}
              </div>
              {((turn.answer) || (optimisticAnswer && optimisticAnswer.turnId === turn.id)) && (
                <div className="interview-message candidate">
                  <div className="bubble-title">我的回答</div>
                  <div className="bubble-content"><MarkdownMessage content={turn.answer || (optimisticAnswer?.text ?? '')} /></div>
                  {optimisticAnswer && optimisticAnswer.turnId === turn.id && !turn.answer && (
                    <small style={{ color: '#86909c' }}>提交中…</small>
                  )}
                </div>
              )}
              {turn.answer_assessment && (
                <div className="interview-feedback">
                  {turn.answer_assessment.llm?.fallback_used && (
                    <div className="interview-feedback-section" style={{ background: '#fff7e6', borderLeft: '3px solid #faad14', padding: '8px 12px', marginBottom: 8, borderRadius: 4 }}>
                      <span style={{ color: '#d46b08', fontWeight: 500 }}>
                        ⚠ 模型已调用但未通过校验
                        {turn.answer_assessment.llm?.fallback_reason && `：${({
                          no_model_available: '无可用模型',
                          llm_timeout: '模型响应超时',
                          llm_stream_error: '模型流式输出异常',
                          json_parse_failed: '模型输出格式异常',
                          harness_validation_failed: 'Harness 校验失败',
                          question_quality_failed: '问题质量不达标',
                          unknown_error: '未知错误',
                        } as Record<string, string>)[turn.answer_assessment.llm.fallback_reason] || turn.answer_assessment.llm.fallback_reason}`}
                        。系统已使用保守追问策略。
                      </span>
                      {turn.answer_assessment.llm?.fallback_detail && (
                        <small style={{ display: 'block', color: '#86909c', marginTop: 4, fontSize: 11 }}>{turn.answer_assessment.llm.fallback_detail}</small>
                      )}
                    </div>
                  )}
                  <div className="interview-feedback-section">
                    <strong>本轮反馈</strong>
                    <p>{turn.answer_assessment.summary}</p>
                  </div>
                  {(turn.answer_assessment.positive_points ?? []).length > 0 && (
                    <div className="interview-feedback-section">
                      <span className="feedback-label good">✓ 回答亮点</span>
                      <ul>
                        {(turn.answer_assessment.positive_points ?? []).map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                      </ul>
                    </div>
                  )}
                  {(turn.answer_assessment.risk_points ?? []).length > 0 && (
                    <div className="interview-feedback-section">
                      <span className="feedback-label risk">△ 需要补充</span>
                      <ul>
                        {(turn.answer_assessment.risk_points ?? []).map((pt: string, i: number) => <li key={i}>{pt}</li>)}
                      </ul>
                    </div>
                  )}
                  {turn.followup_reason && (
                    <div className="interview-feedback-section">
                      <span className="feedback-label next">→ 追问方向</span>
                      <p>{turn.followup_reason}</p>
                    </div>
                  )}
                  {/* P1-3: 维度扣分原因 */}
                  {turn.score_reasons && Object.keys(turn.score_reasons).length > 0 && (
                    <div className="interview-feedback-section">
                      <span className="feedback-label detail">📊 维度评语</span>
                      <div className="interview-score-reasons">
                        {Object.entries(turn.score_reasons).map(([key, reason]) => (
                          <div key={key} className="interview-score-reason-item">
                            <span className="interview-score-reason-dim">{DIMENSION_LABELS[key] ?? key}</span>
                            <span>{reason as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* P1-3: 证据引用 */}
                  {turn.evidence_quotes && turn.evidence_quotes.length > 0 && (
                    <div className="interview-feedback-section">
                      <span className="feedback-label evidence">💬 引用了你的原话</span>
                      <ul className="interview-evidence-quotes">
                        {turn.evidence_quotes.map((eq: { quote?: string; dimension?: string }, i: number) => (
                          <li key={i}>
                            <em>"{eq.quote}"</em>
                            {eq.dimension && <small> — {DIMENSION_LABELS[eq.dimension] ?? eq.dimension}</small>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {reportProgress.length > 0 && !report && (
            <div className="interview-message interviewer">
              <div className="bubble-title">AI 面试官 · Report</div>
              <div className="bubble-content">
                {reportProgress.map((item) => <p key={item}>{item}</p>)}
              </div>
            </div>
          )}

          {loading && (
            <div className="interview-loading">
              <Spin />
              <span>{answerProgressStages.length > 0 ? (activeAnswerStage?.label ?? '处理回答') : (reportProgress.length > 0 ? reportProgress[reportProgress.length - 1] : '面试官正在检索题库、评价回答并组织追问。')}</span>
              <small>思考 {formatDuration(progressElapsed)} · {INTERVIEW_STYLE_LABELS[interviewStyle]}</small>
              {answerProgressStages.length > 0 && (
                <div className="interview-answer-progress">
                  <div className="interview-progress-bar" aria-label={`答题处理进度 ${answerProgressPercent}%`}>
                    <div className="interview-progress-bar-track">
                      <div className="interview-progress-bar-fill" style={{ width: `${answerProgressPercent}%` }} />
                    </div>
                    <span>{answerProgressPercent}%</span>
                  </div>
                  <div className="interview-answer-progress-steps">
                    {answerProgressStages.map((stage) => (
                      <span key={stage.label} className={`interview-answer-progress-step interview-answer-progress-step--${stage.status}`}>
                        {stage.status === 'done' && <IconCheckCircle />}
                        {stage.status === 'active' && <Spin size={10} />}
                        {stage.status === 'pending' && <i />}
                        {stage.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {(streamingBlocks.followup || streamingBlocks.report) && (
                <div style={{ marginTop: 8 }}>
                  <MarkdownMessage content={streamingBlocks.followup || streamingBlocks.report} />
                </div>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {session?.status === 'active' && pendingTurn && (
          <div className="interview-answer-box">
            {interviewMode === 'text' ? (
              <>
                <Input.TextArea
                  value={answer}
                  onChange={setAnswer}
                  onKeyDown={handleAnswerKeyDown}
                  placeholder="输入你的回答。建议用：背景 -> 我的职责 -> 方案 -> 结果数据。Enter 发送，Shift + Enter 换行。"
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  disabled={loading}
                />
                <div className="interview-answer-actions">
                  <div className="interview-answer-actions-row">
                    <Button type="primary" icon={<IconSend />} loading={loading} disabled={!answer.trim()} onClick={() => void submitAnswer()}>
                      提交回答
                    </Button>
                    <Button icon={<img className="interview-button-icon" src={retryIcon} alt="" aria-hidden="true" />} onClick={() => setConfigCollapsed((collapsed) => !collapsed)}>
                      {configCollapsed ? '再试一次' : '隐藏设置'}
                    </Button>
                    <Button icon={<img className="interview-button-icon" src={reportIcon} alt="" aria-hidden="true" />} onClick={() => loadReport()} disabled={loading}>
                      结束并生成报告
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="interview-voice-box">
                {voiceSpeaking && (
                  <div className="interview-voice-speaking">
                    <div className="interview-voice-wave">
                      <span className="voice-dot voice-dot--1" />
                      <span className="voice-dot voice-dot--2" />
                      <span className="voice-dot voice-dot--3" />
                      <span className="voice-dot voice-dot--4" />
                      <span className="voice-dot voice-dot--5" />
                    </div>
                    <p>{ttsMode === 'server_tts' ? '面试官正在语音提问…' : '正在使用浏览器朗读问题…'}</p>
                  </div>
                )}
                {voiceDraft && (
                  <div className="interview-voice-draft">
                    <div className="interview-voice-draft-head">
                      <strong>请确认语音转写</strong>
                      <span>{voiceDraft.language} · {Math.round(voiceDraft.confidence * 100)}%</span>
                    </div>
                    <Input.TextArea
                      value={voiceDraftText}
                      onChange={setVoiceDraftText}
                      autoSize={{ minRows: 3, maxRows: 7 }}
                      disabled={loading}
                    />
                    <div className="interview-voice-draft-actions">
                      <Button type="primary" icon={<IconSend />} loading={loading} disabled={!voiceDraftText.trim()} onClick={confirmVoiceDraft}>
                        提交转写文本
                      </Button>
                      <Button onClick={editVoiceDraftAsText} disabled={loading || !voiceDraftText.trim()}>
                        改为文字编辑
                      </Button>
                      <Button onClick={retryVoiceDraft} disabled={loading}>
                        重录
                      </Button>
                    </div>
                  </div>
                )}
                {recording && !voiceSpeaking && (
                  <div className="interview-voice-recording">
                    <div className="interview-voice-wave">
                      <span className="voice-dot voice-dot--1" />
                      <span className="voice-dot voice-dot--2" />
                      <span className="voice-dot voice-dot--3" />
                      <span className="voice-dot voice-dot--4" />
                      <span className="voice-dot voice-dot--5" />
                    </div>
                    <p>
                      {hasSpoken
                        ? (silenceDetected ? '检测到静音，正在提交…' : '正在聆听你的回答…')
                        : '等待你开口说话…'}
                      {' '}{Math.floor(recordingDuration / 60)}:{String(recordingDuration % 60).padStart(2, '0')}
                    </p>
                    <div className="interview-voice-recording-actions">
                      <Button type="primary" icon={<IconThunderbolt />} onClick={submitVoiceAnswer} loading={loading}>
                        我说完了
                      </Button>
                    </div>
                  </div>
                )}
                {!voiceDraft && !recording && !voiceSpeaking && !loading && (
                  <div className="interview-voice-idle">
                    <p>{voicePhase === 'error' ? '录音出错，请重试。' : '等待面试官提问，或点击下方按钮开始回答。'}</p>
                    <Button type="primary" size="large" icon={<img className="interview-button-icon" src={voiceIcon} alt="" aria-hidden="true" />} onClick={startRecording} disabled={loading || voicePhase === 'uploading' || voicePhase === 'thinking'}>
                      开始回答
                    </Button>
                  </div>
                )}
                {loading && !voiceDraft && !recording && !voiceSpeaking && (
                  <div className="interview-voice-idle">
                    <Spin />
                    <p>正在转写和评估你的回答…</p>
                  </div>
                )}
                <div className="interview-answer-actions">
                  <div className="interview-answer-actions-row">
                    <Button icon={<img className="interview-button-icon" src={retryIcon} alt="" aria-hidden="true" />} onClick={() => setConfigCollapsed((collapsed) => !collapsed)}>
                      {configCollapsed ? '再试一次' : '隐藏设置'}
                    </Button>
                    <Button icon={<img className="interview-button-icon" src={reportIcon} alt="" aria-hidden="true" />} onClick={() => loadReport()} disabled={loading}>
                      结束并生成报告
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {report && !reportCollapsed && (
          <section className="interview-report">
            <div className="report-score-panel">
              <div className="report-score-ring">
                <span>{Math.round(report.overall_score)}</span>
                <p>综合评分</p>
              </div>
              {weakestDimension && (
                <div className="report-weakest">
                  <IconExclamationCircle />
                  <span>最薄弱</span>
                  <strong>{DIMENSION_LABELS[weakestDimension[0]] ?? weakestDimension[0]}</strong>
                  <small>{Math.round(weakestDimension[1])} 分，下一轮优先补这里</small>
                </div>
              )}
            </div>
            <div className="report-body">
              <div className="report-body-head">
                <div>
                  <h3>面试复盘</h3>
                  <p>先看最低分，再看怎么练。报告会把“最容易被面试官继续追”的地方放在前面。</p>
                  {report.comparison?.scoring && (
                    <p className="report-scoring-meta">
                      {report.comparison.scoring.mode === 'llm_rubric' ? '大模型 Rubric 终评' : 'Rubric 本地兜底'}
                      {report.comparison.scoring.model ? ` · ${report.comparison.scoring.model}` : ''}
                      {report.comparison.scoring.usage?.total_tokens ? ` · ${report.comparison.scoring.usage.total_tokens.toLocaleString()} tokens` : ''}
                    </p>
                  )}
                </div>
                {report.comparison?.overall_delta !== undefined && (
                  <Tag color={report.comparison.overall_delta >= 0 ? 'green' : 'red'}>
                    {report.comparison.overall_delta >= 0 ? '+' : ''}{report.comparison.overall_delta} 分
                  </Tag>
                )}
              </div>
              <div className="report-summary-card">{report.report_text}</div>
              {report.comparison?.message && <div className="report-comparison">{report.comparison.message}</div>}
              <div className="score-grid">
                {Object.entries(report.dimension_scores).map(([key, value]) => (
                  <div key={key} className={`score-item score-item--${scoreLevel(value)}`}>
                    <div>
                      <span>{DIMENSION_LABELS[key] ?? key}</span>
                      <small>{DIMENSION_DESCRIPTIONS[key] ?? '按面试回答证据评分'}</small>
                      {weakestDimension?.[0] === key && <em>重点突破</em>}
                    </div>
                    <strong>{Math.round(value)}</strong>
                    <i style={{ width: `${Math.max(8, Math.min(100, value))}%` }} />
                  </div>
                ))}
              </div>
              <div className="report-columns">
                <ReportList title="优势" tone="good" items={report.strengths} />
                <ReportList title="待改进" tone="risk" items={report.weaknesses} />
                <ReportList title="训练建议" tone="coach" items={report.suggestions} />
                <ReportList title="下一轮题目" tone="next" items={report.next_questions} />
              </div>
            </div>
          </section>
        )}
      </section>
    </main>
    </>
  )
}

function ReportList({ title, tone, items }: { title: string; tone: 'good' | 'risk' | 'coach' | 'next'; items: string[] }) {
  return (
    <div className={`report-list report-list--${tone}`}>
      <h4>{title}</h4>
      {items.slice(0, 5).map((item, idx) => <p key={`${title}-${idx}`}><b>{idx + 1}</b>{item}</p>)}
    </div>
  )
}
