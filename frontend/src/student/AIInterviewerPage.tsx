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
  technical: '技术准确性、原理解释、工程实现、异常场景',
  manager: '总经理面：业务理解、长期潜力、价值观匹配、关键决策',
  project: '个人职责、关键决策、量化结果、项目真实性',
  hr: '动机表达、稳定性、职业规划、团队协作',
  final_round: '终面：综合判断、岗位匹配、风险确认、录用建议',
  stress: '证据意识、临场修正、抗压表达',
}

const INTERVIEW_TYPE_OPTIONS = [
  { value: 'first_round', label: '一面' },
  { value: 'second_round', label: '二面' },
  { value: 'technical', label: '技术面试' },
  { value: 'project', label: '项目深挖' },
  { value: 'hr', label: 'HR 面' },
  { value: 'manager', label: '总经理面试' },
  { value: 'final_round', label: '终面' },
  { value: 'stress', label: '压力面' },
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
  const [interviewType, setInterviewType] = useState('technical')
  const [interviewStyle, setInterviewStyle] = useState('strict')
  const [roundLimit, setRoundLimit] = useState('8')
  const [resumeSource, setResumeSource] = useState<'online' | 'upload'>('online')
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
  const [listening, setListening] = useState(false)
  const [reportProgress, setReportProgress] = useState<string[]>([])
  const [interviewProgress, setInterviewProgress] = useState<string[]>([])
  const [interviewSessions, setInterviewSessions] = useState<InterviewSession[]>([])
  const [progressElapsed, setProgressElapsed] = useState(0)
  const [collapsedHistoryDates, setCollapsedHistoryDates] = useState<Set<string>>(() => new Set())
  const [modelError, setModelError] = useState<string | null>(null)
  const [optimisticAnswer, setOptimisticAnswer] = useState<{ turnId: number; text: string } | null>(null)
  const [resumePickerVisible, setResumePickerVisible] = useState(false)
  const recognitionRef = useRef<unknown>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const progressStartRef = useRef<number | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeInputRef = useRef<HTMLInputElement | null>(null)

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
    setInterviewProgress([`正在读取${resumeSource === 'upload' ? '本次上传简历' : '智能体可读取的在线简历'}，分析关键经历和技能匹配点…`])
    const progressTimers = [
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, '正在检索岗位相关题库，筛选与简历经历匹配的追问素材。']), 500),
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, `模型：${selectedModel?.display_name ?? '默认'}；风格：${INTERVIEW_STYLE_LABELS[interviewStyle] ?? '严格追问'}；正在生成第一轮问题…`]), 1000),
    ]
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
          uploaded_resume_text: resumeSource === 'upload' ? uploadedResumeText : undefined,
          focus_tags: focusTags,
          custom_instruction: customInstruction,
        }),
      })
      setSession(res.session)
      setTurns([res.first_turn])
      setKnowledge(res.knowledge_status)
      setAnswer('')
      setConfigCollapsed(true)
      setInterviewProgress((prev) => [...prev, '第一轮问题已生成，面试开始。'])
      await loadInterviewSessions()
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '创建面试失败')
    } finally {
      progressTimers.forEach((timer) => window.clearTimeout(timer))
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
      setLoading(false)
    }
  }

  const reloadKnowledge = async () => {
    setLoading(true)
    try {
      const next = await apiRequest<KnowledgeStatus>('/api/v1/student/interviews/knowledge/reload', { method: 'POST' })
      setKnowledge(next)
      Message.success('知识库已重新索引')
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '重新索引失败')
    } finally {
      setLoading(false)
    }
  }

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as unknown as Record<string, unknown>).SpeechRecognition
      || (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!SpeechRecognition) {
      Message.warning('当前浏览器不支持语音识别，可以先用文字回答。')
      return
    }
    if (listening && recognitionRef.current) {
      ;(recognitionRef.current as { stop: () => void }).stop()
      setListening(false)
      return
    }
    const recognition = new (SpeechRecognition as new () => {
      lang: string; continuous: boolean; interimResults: boolean;
      onresult: ((ev: unknown) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void; stop: () => void;
    })()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: unknown) => {
      const ev = event as { resultIndex: number; results: { length: number; [i: number]: { 0: { transcript?: string }; isFinal: boolean } } }
      let finalText = ''
      let interimText = ''
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const transcript = ev.results[i][0]?.transcript ?? ''
        if (ev.results[i].isFinal) finalText += transcript
        else interimText += transcript
      }
      if (finalText) setAnswer((prev) => `${prev}${prev ? ' ' : ''}${finalText}`.trim())
      else if (interimText && !answer) setAnswer(interimText)
    }
    recognition.onerror = () => {
      setListening(false)
      Message.error('语音识别中断了，请检查麦克风权限。')
    }
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
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
        await loadReport(session.id)
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

  const loadReport = async (sessionId = session?.id) => {
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
      const data = await apiRequest<Report>(`/api/v1/student/interviews/${sessionId}/report`)
      setReport(data)
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
    <main className={`interview-page${configCollapsed ? ' interview-page--immersive' : ''}`}>
      <section className="interview-config-panel">
        <div className="interview-mode-strip">
          <button type="button" className="interview-mode-card active">
            <img className="interview-inline-icon" src={voiceIcon} alt="" aria-hidden="true" />
            <span>文字面试</span>
            <small>当前可用</small>
          </button>
          <button type="button" className="interview-mode-card" disabled title="语音面试需要服务端 ASR 和 TTS 支持，暂未上线">
            <IconVideoCamera />
            <span>语音面试：暂未上线</span>
            <small>暂未上线</small>
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
                      setResumePickerVisible(false)
                    }}
                  >
                    <span>在线简历</span>
                    {resumeSource === 'online' && <IconCheck />}
                  </button>
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

            <Button icon={<IconRefresh />} onClick={reloadKnowledge} long style={{ marginBottom: 12 }}>
              重新索引知识库
            </Button>

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

          {interviewProgress.length > 0 && turns.length === 0 && (
            <div className="interview-progress-stream">
              <div className="interview-progress-head">
                <Spin size={16} />
                <strong>面试准备中</strong>
              </div>
              <div className="interview-runtime-statusline">
                <span>思考 {formatDuration(progressElapsed)}</span>
                <span>{INTERVIEW_STYLE_TONE[interviewStyle]}</span>
              </div>
              {interviewProgress.map((item, idx) => (
                <p key={`${item}-${idx}`}><IconCheckCircle />{item}</p>
              ))}
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
                <Button className={listening ? 'voice-button voice-button--active' : 'voice-button'} icon={<img className="interview-button-icon" src={voiceIcon} alt="" aria-hidden="true" />} disabled={loading} onClick={toggleVoiceInput}>
                  {listening ? '停止语音输入' : '语音输入辅助'}
                </Button>
              </div>
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

        {report && (
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
