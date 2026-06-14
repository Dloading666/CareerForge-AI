import { Button, Input, InputNumber, Message, Select, Spin, Tag } from '@arco-design/web-react'
import {
  IconBulb,
  IconCheck,
  IconCheckCircle,
  IconDelete,
  IconExclamationCircle,
  IconPlayArrow,
  IconRefresh,
  IconSend,
  IconSettings,
  IconThunderbolt,
  IconVideoCamera,
} from '@arco-design/web-react/icon'
import type { MouseEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import aiInterviewerIcon from '../assets/interview-icons/cute-ai-interviewer.png'
import harnessIcon from '../assets/interview-icons/cute-harness-shield.png'
import knowledgeIcon from '../assets/interview-icons/cute-knowledge-base.png'
import reportIcon from '../assets/interview-icons/cute-score-report.png'
import resumeIcon from '../assets/interview-icons/cute-resume.png'
import retryIcon from '../assets/interview-icons/cute-retry.png'
import voiceIcon from '../assets/interview-icons/cute-voice.png'
import { InterviewReportDrawer } from './InterviewReportDrawer'
import type { InterviewReportData } from './InterviewReportDrawer'

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
    llm?: { used?: boolean; model?: string | null; error?: string; fallback_used?: boolean; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
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

type ProgressStage = { label: string; status: 'pending' | 'active' | 'done' | 'error'; detail?: string }

type VoicePhase = 'idle' | 'speaking' | 'listening' | 'uploading' | 'thinking' | 'error'

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

export function AIInterviewerPage({ onInterviewActiveChange }: { onInterviewActiveChange?: (active: boolean) => void } = {}) {
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
  const [interviewProgress, setInterviewProgress] = useState<string[]>([])
  const [interviewSessions, setInterviewSessions] = useState<InterviewSession[]>([])
  const [progressElapsed, setProgressElapsed] = useState(0)
  const [collapsedHistoryDates, setCollapsedHistoryDates] = useState<Set<string>>(() => new Set())
  const [modelError, setModelError] = useState<string | null>(null)
  const [optimisticAnswer, setOptimisticAnswer] = useState<{ turnId: number; text: string } | null>(null)
  const [resumePickerVisible, setResumePickerVisible] = useState(false)
  const [reportDrawerVisible, setReportDrawerVisible] = useState(false)
  // 语音面试状态
  const [interviewMode, setInterviewMode] = useState<'text' | 'voice'>('text')
  const [recording, setRecording] = useState(false)
  const [recordingDuration, setRecordingDuration] = useState(0)
  const [progressStages, setProgressStages] = useState<ProgressStage[]>([])
  const [voiceSpeaking, setVoiceSpeaking] = useState(false)
  const [ttsMode, setTtsMode] = useState<'server_tts' | 'browser_tts'>('browser_tts')
  // P1: 语音状态机防重入
  const [voicePhase, setVoicePhase] = useState<VoicePhase>('idle')
  // P1: 静音检测状态
  const [silenceDetected, setSilenceDetected] = useState(false)
  const [hasSpoken, setHasSpoken] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const progressStartRef = useRef<number | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeInputRef = useRef<HTMLInputElement | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
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
    ? (uploadedResumeName ? `本次上传：《${uploadedResumeName}》` : '本次上传简历')
    : '选择在线简历'
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
    setInterviewProgress([])
    try {
      const detail = await apiRequest<{ session: InterviewSession; turns: InterviewTurn[] }>(`/api/v1/student/interviews/${sessionId}`)
      setSession(detail.session)
      setTurns(detail.turns)
      setAnswer('')
      setConfigCollapsed(true)
      if (detail.session.status === 'completed') {
        const data = await apiRequest<Report>(`/api/v1/student/interviews/${sessionId}/report`)
        setReport(data)
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
  }, [turns.length, loading, report, reportProgress.length, interviewProgress.length])

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
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)

    // ── P0: 真实后端进度事件 ──
    const requestId = crypto.randomUUID()
    const stageMap: Record<string, ProgressStage> = {
      resume: { label: '正在读取简历', status: 'active' },
      jd: { label: '正在分析岗位 JD', status: 'pending' },
      match: { label: '正在匹配简历经历与岗位要求', status: 'pending' },
      rag: { label: '正在检索题库/RAG', status: 'pending' },
      llm: { label: '正在生成第一问', status: 'pending' },
      harness: { label: '正在校验问题质量', status: 'pending' },
      done: { label: '第一问已生成', status: 'pending' },
    }
    const stageOrder = ['resume', 'jd', 'match', 'rag', 'llm', 'harness', 'done']
    const initialStages: ProgressStage[] = stageOrder.map((key) => ({ ...stageMap[key] }))
    setProgressStages([...initialStages])

    // 后端进度轮询
    let progressDone = false
    let backendProgressAvailable = false
    const pollProgress = async () => {
      while (!progressDone) {
        await new Promise((r) => setTimeout(r, 800))
        if (progressDone) break
        try {
          const data = await apiRequest<{ stage: string; status: string; message: string; done: boolean; error: string | null }>(
            `/api/v1/student/interviews/progress/${requestId}`,
          )
          if (data.stage !== 'unknown') {
            backendProgressAvailable = true
            const stageIdx = stageOrder.indexOf(data.stage)
            if (stageIdx >= 0) {
              setProgressStages((prev) =>
                prev.map((s, i) => {
                  if (i < stageIdx) return { ...s, status: 'done' as const }
                  if (i === stageIdx) {
                    if (data.status === 'error') return { ...s, status: 'error' as const, detail: data.message }
                    return { ...s, status: 'active' as const }
                  }
                  return s
                })
              )
            }
            if (data.done) {
              if (data.status === 'error') {
                setProgressStages((prev) =>
                  prev.map((s) => s.status === 'active' ? { ...s, status: 'error' as const, detail: data.error || data.message } : s)
                )
              } else {
                setProgressStages((prev) => prev.map((s) => ({ ...s, status: 'done' as const })))
              }
              progressDone = true
            }
          }
        } catch {
          // 静默失败，继续轮询
        }
      }
    }
    const progressPollPromise = pollProgress()

    // Fallback: 如果后端进度 3 秒内没有响应，使用前端模拟
    const fallbackTimer = window.setTimeout(() => {
      if (!backendProgressAvailable && !progressDone) {
        const advanceStage = (index: number) => {
          setProgressStages((prev) =>
            prev.map((s, i) => {
              if (i < index) return { ...s, status: 'done' as const }
              if (i === index) return { ...s, status: 'active' as const }
              return s
            })
          )
        }
        advanceStage(1)
        window.setTimeout(() => advanceStage(2), 600)
        window.setTimeout(() => advanceStage(3), 1200)
        window.setTimeout(() => advanceStage(4), 1800)
        window.setTimeout(() => advanceStage(5), 2500)
      }
    }, 3000)

    try {
      const res = await apiRequest<{
        session: InterviewSession
        first_turn: InterviewTurn
        knowledge_status: KnowledgeStatus
      }>('/api/v1/student/interviews', {
        method: 'POST',
        body: JSON.stringify({
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
          request_id: requestId,
        }),
      })
      progressDone = true
      // 全部阶段完成
      setProgressStages((prev) => prev.map((s) => ({ ...s, status: 'done' as const })))
      setSession(res.session)
      setTurns([res.first_turn])
      setKnowledge(res.knowledge_status)
      setAnswer('')
      setConfigCollapsed(true)
      await loadInterviewSessions()

      // 语音模式：自动朗读第一问
      if (interviewMode === 'voice') {
        await speakAndAutoRecord(res.first_turn.question, res.session.id, res.first_turn.id)
      }
    } catch (error) {
      progressDone = true
      // 标记当前阶段为 error
      setProgressStages((prev) =>
        prev.map((s) => s.status === 'active' ? { ...s, status: 'error' as const, detail: error instanceof Error ? error.message : '创建面试失败' } : s)
      )
      Message.error(error instanceof Error ? error.message : '创建面试失败')
    } finally {
      window.clearTimeout(fallbackTimer)
      await progressPollPromise
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
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
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
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
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
      const formData = new FormData()
      formData.append('file', audioBlob, 'recording.webm')
      formData.append('turn_id', String(pendingTurn.id))
      formData.append('request_id', crypto.randomUUID())

      const res = await apiRequest<{
        transcript: { text: string; language: string; confidence: number }
        turn_result: {
          current_turn: InterviewTurn
          next_turn: InterviewTurn | null
          is_finished: boolean
          report_id: number | null
        }
      }>(`/api/v1/student/interviews/${session.id}/turns/voice`, {
        method: 'POST',
        body: formData,
        // 不设 Content-Type，让浏览器自动加 multipart boundary
      })

      // 更新 turns
      setTurns((prev) => {
        const updated = prev.map((t) => (t.id === res.turn_result.current_turn.id ? res.turn_result.current_turn : t))
        return res.turn_result.next_turn ? [...updated, res.turn_result.next_turn] : updated
      })

      if (res.turn_result.is_finished) {
        setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        setVoicePhase('idle')
        await loadReport(session.id, true)
      } else if (res.turn_result.next_turn && interviewMode === 'voice') {
        // 自动朗读下一问
        setVoicePhase('speaking')
        await speakAndAutoRecord(res.turn_result.next_turn.question, session.id, res.turn_result.next_turn.id)
      } else {
        setVoicePhase('idle')
      }
      await loadInterviewSessions()
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

  const submitAnswer = async () => {
    if (!session || !pendingTurn || !answer.trim()) return
    const currentAnswer = answer.trim()
    // 乐观展示：立即显示用户气泡
    setOptimisticAnswer({ turnId: pendingTurn.id, text: currentAnswer })
    setAnswer('')
    setLoading(true)
    progressStartRef.current = null
    setProgressElapsed(0)
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => {
      if (!progressStartRef.current) progressStartRef.current = performance.now()
      setProgressElapsed(Math.round(performance.now() - progressStartRef.current))
    }, 1000)
    try {
      const res = await apiRequest<{
        current_turn: InterviewTurn
        next_turn: InterviewTurn | null
        is_finished: boolean
      }>(`/api/v1/student/interviews/${session.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({
          answer: currentAnswer,
          turn_id: pendingTurn.id,
          request_id: crypto.randomUUID(),
        }),
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
      setAnswer(currentAnswer) // 恢复答案，允许重试
      Message.error(error instanceof Error ? error.message : '提交回答失败')
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

  const handleAnswerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    if (!loading && answer.trim()) submitAnswer()
  }

  const loadReport = async (sessionId = session?.id, forceGenerate = false) => {
    if (!sessionId) return
    setLoading(true)
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
    try {
      // P0-1: 活跃面试用 POST /finish 生成报告，已完成面试用 GET /report 读取
      const isActive = session?.status === 'active' || forceGenerate
      const url = isActive
        ? `/api/v1/student/interviews/${sessionId}/finish`
        : `/api/v1/student/interviews/${sessionId}/report`
      const method = isActive ? 'POST' : 'GET'
      const data = method === 'POST'
        ? await apiRequest<Report>(url, { method: 'POST' })
        : await apiRequest<Report>(url)
      setReport(data)
      setReportDrawerVisible(true)
      setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
      await loadInterviewSessions()
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '生成报告失败')
    } finally {
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

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
              <Select.Option key={m.id} value={String(m.id)}>{`${m.display_name} · ${m.model_identifier}`}</Select.Option>
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
              onClick={() => setResumePickerVisible((visible) => !visible)}
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
                      loadResumes()
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
                          onClick={() => setSelectedResumeId(r.id)}
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
                          onClick={() => setSelectedResumeId(null)}
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
                  >
                    <span>{uploadedResumeName || '本次上传简历'}</span>
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

            <div className="interview-harness-card">
              <div className="interview-harness-title">
                <img className="interview-card-icon" src={harnessIcon} alt="" aria-hidden="true" />
                <strong>面试 Harness</strong>
              </div>
              <div className="interview-harness-steps">
                <span>开场</span>
                <span>简历深挖</span>
                <span>岗位题</span>
                <span>反问</span>
                <span>复盘</span>
              </div>
              <p>一次只问一个问题，回答越空泛，追问越具体；报告优先指出最低分维度。</p>
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
                          <small>{item.status === 'active' ? '进行中' : '已结束'} · {item.round_limit} 轮</small>
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

      <section className="interview-room">
        <div className="interview-room-header">
          <div>
            <h2>{session ? session.target_role : '准备进入面试房间'}</h2>
            <p>{session ? `${formatDateLabel(session.created_at)} ${formatTimeLabel(session.created_at)} · 第 ${turns.length}/${session.round_limit} 轮 · ${session.status === 'active' ? '面试中' : '已结束'}` : '选择岗位、模型和风格后进入沉浸式训练。Enter 发送，Shift + Enter 换行。'}</p>
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
              <div className="interview-progress-stages">
                {progressStages.map((stage, idx) => (
                  <div key={idx} className={`interview-progress-stage interview-progress-stage--${stage.status}`}>
                    {stage.status === 'done' && <IconCheckCircle />}
                    {stage.status === 'active' && <Spin size={12} />}
                    {stage.status === 'error' && <IconExclamationCircle />}
                    {stage.status === 'pending' && <span className="stage-dot" />}
                    <span>{stage.label}</span>
                    {stage.detail && <small className="stage-error-detail">{stage.detail}</small>}
                  </div>
                ))}
              </div>
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
                      <span style={{ color: '#d46b08', fontWeight: 500 }}>⚠ 本轮模型服务不稳定，系统已使用保守追问策略。</span>
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
              <span>{reportProgress.length > 0 ? reportProgress[reportProgress.length - 1] : '面试官正在检索题库、评价回答并组织追问。'}</span>
              <small>思考 {formatDuration(progressElapsed)} · {INTERVIEW_STYLE_LABELS[interviewStyle]}</small>
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
                    <Button type="primary" icon={<IconSend />} loading={loading} disabled={!answer.trim()} onClick={submitAnswer}>
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
                {!recording && !voiceSpeaking && !loading && (
                  <div className="interview-voice-idle">
                    <p>{voicePhase === 'error' ? '录音出错，请重试。' : '等待面试官提问，或点击下方按钮开始回答。'}</p>
                    <Button type="primary" size="large" icon={<img className="interview-button-icon" src={voiceIcon} alt="" aria-hidden="true" />} onClick={startRecording} disabled={loading || voicePhase === 'uploading' || voicePhase === 'thinking'}>
                      开始回答
                    </Button>
                  </div>
                )}
                {loading && !recording && !voiceSpeaking && (
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

        {report && (
          <section className="interview-report">
            <div className="report-score-panel">
              <div className="report-score-ring">
                <span>{Math.round(report.overall_score)}</span>
                <p>综合评分</p>
              </div>
              <Button
                type="outline"
                size="small"
                style={{ marginTop: 8 }}
                onClick={() => setReportDrawerVisible(true)}
              >
                查看完整报告
              </Button>
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

    <InterviewReportDrawer
      visible={reportDrawerVisible}
      onClose={() => setReportDrawerVisible(false)}
      report={report as InterviewReportData | null}
      onPracticeAgain={(preset) => {
        if (!preset) return
        if (preset.target_role) setTargetRole(preset.target_role)
        if (preset.interview_type) setInterviewType(preset.interview_type)
        if (preset.interview_style) setInterviewStyle(preset.interview_style)
        setSession(null)
        setTurns([])
        setReport(null)
        setAnswer('')
        setConfigCollapsed(false)
        Message.success('已加载预设配置，请检查后开始新一轮面试')
      }}
    />
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
