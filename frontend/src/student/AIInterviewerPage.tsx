import { Button, Input, InputNumber, Message, Popconfirm, Spin, Tag } from '@arco-design/web-react'
import {
  IconBulb,
  IconCheckCircle,
  IconDelete,
  IconExclamationCircle,
  IconFile,
  IconPlayArrow,
  IconRefresh,
  IconRobot,
  IconSafe,
  IconSend,
  IconSettings,
  IconStop,
  IconThunderbolt,
  IconVideoCamera,
  IconVoice,
} from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'
import { MarkdownMessage } from '../shared/MarkdownMessage'
import { NativeMultiSelect, NativeSelect } from '../shared/NativeSelect'

type KnowledgeStatus = {
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
  company_name?: string | null
  seniority_level?: string | null
  job_skills?: string[]
  current_stage?: string
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
    llm?: { used?: boolean; model?: string | null; error?: string; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } }
    retrieval?: { hit_count?: number; top_sources?: string[] }
  } | null
  score?: Record<string, number> | null
  followup_reason?: string | null
  retrieved_chunks?: Array<{ title: string; topic: string; source_file: string; score: number }>
  knowledge_points?: string[]
  stage?: string | null
  question_type?: string | null
  question_reason?: string | null
  capability_tags?: string[]
  score_reasons?: Record<string, string>
  evidence_quotes?: Array<{ quote: string; reason: string }>
  top_sources?: Array<{ title: string; topic: string; source_file: string; score: number }>
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
  training_plan?: Array<{ day: number; focus: string; tasks: string[]; expected_output: string }>
  rewrite_examples?: Array<{ original_answer: string; better_answer: string; why_better: string }>
  next_session_preset?: { target_role?: string; interview_type?: string; interview_style?: string; focus_tags?: string[] }
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
  { value: 'first_round', label: '📋 一面' },
  { value: 'second_round', label: '📋 二面' },
  { value: 'technical', label: '💻 技术面试' },
  { value: 'project', label: '📂 项目深挖' },
  { value: 'hr', label: '🤝 HR 面' },
  { value: 'manager', label: '👔 总经理面试' },
  { value: 'final_round', label: '🏁 终面' },
  { value: 'stress', label: '🔥 压力面' },
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

const STAGE_LABELS: Record<string, string> = {
  opening: '开场',
  self_intro: '自我介绍',
  resume_deep_dive: '简历深挖',
  technical_core: '核心技术',
  scenario: '场景题',
  pressure: '压力追问',
  reverse_question: '反问环节',
  wrap_up: '收束复盘',
  completed: '已完成',
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
  // 压缩多余空行
  let result = text.replace(/\n{3,}/g, '\n\n').trim()
  // 编号列表：用单换行保持紧凑，避免段落间距过大
  if (/(^|\s)\d+[.）)]/.test(result)) {
    result = result
      .replace(/([：:。！？?；;])\s*(\d+[.）)])\s*/g, '$1\n$2 ')
      .replace(/\s+(\d+[.）)])\s*/g, '\n$1 ')
      .replace(/\n{2,}/g, '\n')
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

export function AIInterviewerPage({ onInterviewActiveChange }: { onInterviewActiveChange?: (active: boolean) => void }) {
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
  const [companyName, setCompanyName] = useState('')
  const [seniorityLevel, setSeniorityLevel] = useState('')
  const [jobSkills, _setJobSkills] = useState<string[]>([])
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [answer, setAnswer] = useState('')
  const [optimisticAnswers, setOptimisticAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const [listening, setListening] = useState(false)
  const [reportProgress, setReportProgress] = useState<string[]>([])
  const [interviewProgress, setInterviewProgress] = useState<string[]>([])
  const [interviewSessions, setInterviewSessions] = useState<InterviewSession[]>([])
  const [progressTick, setProgressTick] = useState(0)
  const [collapsedHistoryDates, setCollapsedHistoryDates] = useState<Set<string>>(() => new Set())
  const recognitionRef = useRef<any>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const progressStartRef = useRef<number | null>(null)
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeInputRef = useRef<HTMLInputElement | null>(null)

  const pendingTurn = useMemo(() => turns.find((turn) => !turn.answer) ?? null, [turns])
  const sortedDimensions = useMemo(
    () => Object.entries(report?.dimension_scores ?? {}).sort((a, b) => a[1] - b[1]),
    [report],
  )
  const weakestDimension = sortedDimensions[0]
  const selectedModel = modelOptions.find((model) => model.id === selectedModelId)
  const normalizedRoundLimit = Math.max(3, Math.min(20, Number(roundLimit) || 8))
  const promptPreview = `${selectedModel?.display_name ?? '默认模型'} · ${INTERVIEW_TYPE_META[interviewType] ?? '综合能力'} · ${INTERVIEW_STYLE_TONE[interviewStyle] ?? ''} · ${focusTags.map((tag) => FOCUS_OPTIONS.find((item) => item.value === tag)?.label ?? tag).join('、') || '默认'} · ${normalizedRoundLimit} 轮`
  const modelSelectOptions = modelOptions.map((model) => ({
    value: String(model.id),
    label: `${model.display_name} · ${model.model_identifier}`,
  }))
  const seniorityOptions = ['实习', '校招', '初级', '中级', '高级'].map((level) => ({ value: level, label: level }))
  const interviewStyleOptions = [
    { value: 'strict', label: '🎯 严格追问' },
    { value: 'stress', label: '🔥 压力面试' },
    { value: 'friendly', label: '🌱 温和训练' },
    { value: 'coach', label: '🧭 教练式引导' },
    { value: 'executive', label: '👔 高管式审视' },
  ]
  const historyGroups = useMemo(() => {
    const groups: Record<string, InterviewSession[]> = {}
    for (const item of interviewSessions) {
      const key = formatDateLabel(item.created_at)
      groups[key] = [...(groups[key] ?? []), item]
    }
    return Object.entries(groups)
  }, [interviewSessions])
  void progressTick
  const progressElapsed = progressStartRef.current ? Date.now() - progressStartRef.current : 0

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

  const handleDeleteInterview = async (sessionId: number) => {
    try {
      await apiRequest(`/api/v1/student/interviews/${sessionId}`, { method: 'DELETE' })
      setInterviewSessions((prev) => prev.filter((s) => s.id !== sessionId))
      if (session?.id === sessionId) {
        setSession(null)
        setTurns([])
        setReport(null)
        setConfigCollapsed(false)
        onInterviewActiveChange?.(false)
      }
      Message.success('已删除')
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '删除失败')
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

  useEffect(() => {
    apiRequest<KnowledgeStatus>('/api/v1/student/interviews/knowledge/status')
      .then(setKnowledge)
      .catch(() => setKnowledge(null))
    apiRequest<AgentModelOption[]>('/api/v1/student/master/models')
      .then((list) => {
        setModelOptions(list)
        if (list.length > 0) setSelectedModelId((prev) => prev ?? list[0].id)
      })
      .catch(() => setModelOptions([]))
    void loadInterviewSessions()
  }, [])

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    }
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, loading, report, reportProgress.length, interviewProgress.length])

  useEffect(() => {
    onInterviewActiveChange?.(session?.status === 'active' || loading)
  }, [loading, onInterviewActiveChange, session?.status])

  const startInterview = async () => {
    if (!targetRole.trim()) {
      Message.warning('请先填写目标岗位')
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
    setConfigCollapsed(true)
    onInterviewActiveChange?.(true)
    progressStartRef.current = Date.now()
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => setProgressTick((tick) => tick + 1), 1000)
    setInterviewProgress([`正在为你整理${resumeSource === 'upload' ? '本次上传的简历' : '在线简历'}，把经历、技能和目标岗位放到同一张画像里。`])
    const progressTimers = [
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, '正在结合你的项目表达、岗位要求和面试重点，准备一组更贴近你当前状态的问题。']), 500),
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, `正在用${INTERVIEW_STYLE_LABELS[interviewStyle] ?? '严格追问'}的节奏校准第一轮开场，让追问既有压力也有帮助。`]), 1000),
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
          company_name: companyName || undefined,
          seniority_level: seniorityLevel || undefined,
          job_skills: jobSkills.length > 0 ? jobSkills : undefined,
        }),
      })
      setSession(res.session)
      setTurns([res.first_turn])
      setKnowledge(res.knowledge_status)
      setAnswer('')
      setInterviewProgress((prev) => [...prev, '第一轮问题已准备好，我们从你最值得展开的经历开始。'])
      await loadInterviewSessions()
    } catch (error) {
      setConfigCollapsed(false)
      onInterviewActiveChange?.(false)
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

  const toggleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      Message.warning('当前浏览器不支持语音识别，可以先用文字回答。')
      return
    }
    if (listening && recognitionRef.current) {
      recognitionRef.current.stop()
      setListening(false)
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = 'zh-CN'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript ?? ''
        if (event.results[i].isFinal) finalText += transcript
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
    const submittedAnswer = answer.trim()
    const submittedTurnId = pendingTurn.id
    setOptimisticAnswers((prev) => ({ ...prev, [submittedTurnId]: submittedAnswer }))
    setAnswer('')
    setLoading(true)
    progressStartRef.current = Date.now()
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => setProgressTick((tick) => tick + 1), 1000)
    try {
      const res = await apiRequest<{
        current_turn: InterviewTurn
        next_turn: InterviewTurn | null
        is_finished: boolean
      }>(`/api/v1/student/interviews/${session.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ answer: submittedAnswer }),
      })
      setOptimisticAnswers((prev) => {
        const next = { ...prev }
        delete next[submittedTurnId]
        return next
      })
      setTurns((prev) => {
        const updated = prev.map((turn) => (turn.id === res.current_turn.id ? res.current_turn : turn))
        return res.next_turn ? [...updated, res.next_turn] : updated
      })
      if (res.is_finished) {
        setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        await loadReport(session.id)
      }
      await loadInterviewSessions()
    } catch (error) {
      setOptimisticAnswers((prev) => {
        const next = { ...prev }
        delete next[submittedTurnId]
        return next
      })
      setAnswer(submittedAnswer)
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
    progressStartRef.current = Date.now()
    if (progressTimerRef.current) clearInterval(progressTimerRef.current)
    progressTimerRef.current = setInterval(() => setProgressTick((tick) => tick + 1), 1000)
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
        <div className="interview-brand">
          <div className="interview-avatar"><IconRobot /></div>
          <div>
            <h3>AI 面试官</h3>
            <p>围绕你的简历、岗位和回答动态追问，结束后给出可复练的复盘。</p>
          </div>
        </div>

        <div className="interview-mode-strip">
          <button type="button" className="interview-mode-card active">
            <IconVoice />
            <span>文字面试</span>
            <small>当前可用</small>
          </button>
          <button type="button" className="interview-mode-card" disabled>
            <IconVideoCamera />
            <span>通话面试</span>
            <small>预留 RTC / 数字人</small>
          </button>
        </div>

        {/* ── 基本信息 ── */}
        <div className="interview-section-header">
          <IconRobot />
          <span>基本信息</span>
        </div>

        <label className="interview-field">
          <span>🧠 大模型</span>
          <NativeSelect
            value={selectedModelId ? String(selectedModelId) : ''}
            onChange={(val) => setSelectedModelId(Number(val) || undefined)}
            options={modelSelectOptions}
            placeholder="选择面试官大脑"
            disabled={session?.status === 'active'}
          />
        </label>

        <label className="interview-field">
          <span>🎯 目标岗位 <b style={{ color: '#f53f3f' }}>*</b></span>
          <Input value={targetRole} onChange={setTargetRole} disabled={session?.status === 'active'} placeholder="Java 后端开发工程师 / 产品经理 / 算法实习生" />
        </label>

        <label className="interview-field">
          <span>📄 岗位 JD</span>
          <Input.TextArea value={jobDescription} onChange={setJobDescription} autoSize={{ minRows: 4, maxRows: 8 }} disabled={session?.status === 'active'} placeholder="粘贴目标岗位要求、职责描述、技术栈或公司招聘 JD。留空时会按目标岗位做通用模拟。" />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <label className="interview-field" style={{ flex: 1 }}>
            <span>🏢 公司/组织</span>
            <Input value={companyName} onChange={setCompanyName} disabled={session?.status === 'active'} placeholder="如：字节跳动" />
          </label>
          <label className="interview-field" style={{ flex: 1 }}>
            <span>📊 岗位级别</span>
            <NativeSelect
              value={seniorityLevel}
              onChange={(val) => setSeniorityLevel(val || '')}
              options={seniorityOptions}
              placeholder="选择级别"
              disabled={session?.status === 'active'}
            />
          </label>
        </div>

        {/* ── 简历来源 ── */}
        <div className="interview-section-header">
          <IconFile />
          <span>简历来源</span>
        </div>

        <div className="interview-resume-source">
          <span>简历来源</span>
          <div className="interview-resume-cards">
            <button
              type="button"
              className={`interview-resume-card${resumeSource === 'online' ? ' active' : ''}`}
              disabled={session?.status === 'active'}
              onClick={() => setResumeSource('online')}
            >
              <span className="interview-resume-card-radio" />
              <div className="interview-resume-card-body">
                <strong>智能体可读取简历</strong>
                <small>读取「简历制作」中勾选了「智能体可读取」的简历</small>
              </div>
              <span className="interview-resume-card-badge">在线</span>
            </button>
            <button
              type="button"
              className={`interview-resume-card${resumeSource === 'upload' ? ' active' : ''}`}
              disabled={session?.status === 'active'}
              onClick={() => setResumeSource('upload')}
            >
              <span className="interview-resume-card-radio" />
              <div className="interview-resume-card-body">
                <strong>本次上传简历</strong>
                <small>{uploadedResumeName || '支持 PDF / DOCX / TXT / MD'}</small>
              </div>
              {uploadedResumeText && (
                <span className="interview-resume-card-badge success">
                  已解析
                </span>
              )}
            </button>
          </div>
          {resumeSource === 'upload' && (
            <div className="interview-upload-row">
              <Button
                icon={<IconRefresh />}
                loading={uploadingResume}
                disabled={session?.status === 'active'}
                onClick={() => resumeInputRef.current?.click()}
              >
                上传并读取简历
              </Button>
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
              {uploadedResumeText && <Tag color="green">已解析约 {uploadedResumeText.length.toLocaleString()} 字符</Tag>}
            </div>
          )}
          <p className="interview-field-hint">
            在线简历会优先读取「简历制作」中勾选了「智能体可读取」的简历；未勾选时回退到最新保存版本。选择上传时，仅使用本次解析出的简历文本。
          </p>
        </div>

        {/* ── 面试设置 ── */}
        <div className="interview-section-header">
          <IconSafe />
          <span>面试设置</span>
        </div>

        <div className="interview-field-row">
          <label className="interview-field">
            <span>📋 面试类型</span>
            <NativeSelect
              value={interviewType}
              onChange={setInterviewType}
              options={INTERVIEW_TYPE_OPTIONS}
              disabled={session?.status === 'active'}
            />
          </label>
          <label className="interview-field">
            <span>🔄 轮次</span>
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
          </label>
        </div>

        <label className="interview-field">
          <span>🎭 面试风格</span>
          <NativeSelect
            value={interviewStyle}
            onChange={setInterviewStyle}
            options={interviewStyleOptions}
            disabled={session?.status === 'active'}
          />
        </label>

        <label className="interview-field">
          <span>🔍 面试重点（可多选）</span>
          <NativeMultiSelect
            value={focusTags}
            onChange={setFocusTags}
            options={FOCUS_OPTIONS}
            disabled={session?.status === 'active'}
            placeholder="选择你希望重点练习的方向"
          />
        </label>

        {/* ── 高级设置（可折叠） ── */}
        <details className="interview-advanced-settings">
          <summary>
            <IconSettings />
            <span>高级设置</span>
            <small>自定义追问要求 · 提示词策略 · Harness · 知识库</small>
          </summary>
          <div className="interview-advanced-body">
            <label className="interview-field">
              <span>✏️ 自定义追问要求</span>
              <Input.TextArea value={customInstruction} onChange={setCustomInstruction} autoSize={{ minRows: 2, maxRows: 5 }} disabled={session?.status === 'active'} placeholder="例如：多问数据库事务；少问八股；每轮都要追问量化结果。" />
            </label>

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
                <IconSettings />
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
              <div>
                <strong>RAG 知识库</strong>
                <p>{knowledge ? `${knowledge.document_count} 个文档，${knowledge.chunk_count} 个知识块` : '正在检查知识库'}</p>
              </div>
              <Tag color={knowledge?.vector_ready ? 'green' : 'orange'}>{knowledge?.retriever ?? 'checking'}</Tag>
            </div>
          </div>
        </details>

        <Button type="primary" icon={session?.status === 'active' ? <IconRefresh /> : <IconPlayArrow />} loading={loading && !pendingTurn} onClick={startInterview} long>
          {session?.status === 'active' ? '重新开始一场' : '开始面试'}
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
                      <Popconfirm
                        title="确定删除这条面试记录？"
                        onOk={() => void handleDeleteInterview(item.id)}
                        okText="删除"
                        cancelText="取消"
                      >
                        <button
                          type="button"
                          className="interview-history-delete"
                          onClick={(e) => e.stopPropagation()}
                          title="删除"
                        >
                          <IconDelete />
                        </button>
                      </Popconfirm>
                    </div>
                  ))}
              </div>
            ))
          )}
        </div>
      </section>

      <section className="interview-room">
        <div className={`interview-room-header${session ? ' interview-room-header--session' : ''}`}>
          <div>
            <h2>{session ? session.target_role : '准备进入面试房间'}</h2>
            <p>{session ? `${formatDateLabel(session.created_at)} ${formatTimeLabel(session.created_at)} · 第 ${turns.length}/${session.round_limit} 轮 · ${session.current_stage ? STAGE_LABELS[session.current_stage] ?? session.current_stage : ''} · ${session.status === 'active' ? '面试中' : '已结束'}` : '选择岗位、模型和风格后进入沉浸式训练。Enter 发送，Shift + Enter 换行。'}</p>
          </div>
        </div>

        <div className="interview-dialogue">
          {turns.length === 0 && (
            <div className="interview-empty">
              <div className="interview-empty-orbit">
                <IconRobot />
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
                {/* 考察点 */}
                {turn.capability_tags && turn.capability_tags.length > 0 && (
                  <div className="knowledge-tags" style={{ marginTop: 4 }}>
                    <span style={{ fontSize: 12, color: '#86909c', marginRight: 4 }}>考察点：</span>
                    {turn.capability_tags.map((tag) => <Tag key={tag} color="blue" style={{ fontSize: 11 }}>{tag}</Tag>)}
                  </div>
                )}
                {/* 追问原因 */}
                {turn.question_reason && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#86909c', lineHeight: 1.6 }}>
                    💡 {turn.question_reason}
                  </div>
                )}
                {/* 题库命中来源 */}
                {turn.top_sources && turn.top_sources.length > 0 && (
                  <details style={{ marginTop: 6, fontSize: 12, color: '#86909c' }}>
                    <summary style={{ cursor: 'pointer' }}>📚 题库命中来源（{turn.top_sources.length}）</summary>
                    <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                      {turn.top_sources.map((src, i) => (
                        <li key={i}>{src.source_file} / {src.topic} / score {(src.score ?? 0).toFixed(2)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {(!turn.top_sources || turn.top_sources.length === 0) && turn.turn_index > 1 && turn.answer && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#c9cdd4' }}>未命中题库，当前问题按简历和岗位要求自适应生成。</div>
                )}
              </div>
              {(turn.answer || optimisticAnswers[turn.id]) && (
                <div className="interview-message candidate">
                  <div className="bubble-title">我的回答</div>
                  <div className="bubble-content"><MarkdownMessage content={turn.answer ?? optimisticAnswers[turn.id]} /></div>
                </div>
              )}
              {turn.answer_assessment && (
                <div className="interview-feedback">
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
                  {/* 扣分原因 */}
                  {turn.score_reasons && Object.keys(turn.score_reasons).length > 0 && (
                    <details className="interview-feedback-section" style={{ marginTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>📊 各维度扣分原因</summary>
                      <ul style={{ margin: '6px 0 0 16px', padding: 0, fontSize: 12, lineHeight: 1.8 }}>
                        {DIMENSION_LABELS[Object.keys(turn.score_reasons)[0]] !== undefined
                          ? Object.entries(turn.score_reasons).map(([dim, reason]) => (
                              <li key={dim}><strong>{DIMENSION_LABELS[dim] ?? dim}：</strong>{reason}</li>
                            ))
                          : Object.entries(turn.score_reasons).map(([dim, reason]) => (
                              <li key={dim}><strong>{dim}：</strong>{reason}</li>
                            ))
                        }
                      </ul>
                    </details>
                  )}
                  {/* 证据引用 */}
                  {turn.evidence_quotes && turn.evidence_quotes.length > 0 && (
                    <div className="interview-feedback-section" style={{ marginTop: 6 }}>
                      <span className="feedback-label" style={{ color: '#722ed1' }}>💬 证据引用</span>
                      {turn.evidence_quotes.map((eq, i) => (
                        <div key={i} style={{ margin: '4px 0', padding: '4px 8px', background: '#f9f0ff', borderRadius: 4, fontSize: 12 }}>
                          <span style={{ color: '#722ed1' }}>"{eq.quote}"</span>
                          {eq.reason && <span style={{ color: '#86909c', marginLeft: 6 }}>— {eq.reason}</span>}
                        </div>
                      ))}
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
              <span>{reportProgress.length > 0 ? reportProgress[reportProgress.length - 1] : '我已经看到你的回答，正在从证据完整度、表达结构和岗位匹配度三个维度做分析。'}</span>
              <small>{reportProgress.length > 0 ? '正在生成可复练的面试报告' : '分析完成后会先总结亮点，再指出下一轮最值得补强的地方'} · {formatDuration(progressElapsed)}</small>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {session?.status === 'active' && pendingTurn && (
          <div className="interview-answer-box">
            <Input.TextArea
              className="interview-answer-input"
              value={answer}
              onChange={setAnswer}
              onKeyDown={handleAnswerKeyDown}
              placeholder="输入你的回答。建议用：背景 -> 我的职责 -> 方案 -> 结果数据。Enter 发送，Shift + Enter 换行。"
              autoSize={{ minRows: 3, maxRows: 8 }}
              disabled={loading}
            />
            <div className="interview-answer-actions">
              <div className="interview-answer-actions-row interview-answer-actions-row--secondary">
                <Button icon={<IconRefresh />} disabled={loading} onClick={() => setConfigCollapsed((prev) => !prev)}>
                  {configCollapsed ? '再试一次' : '回到房间'}
                </Button>
                <Button icon={<IconStop />} onClick={() => loadReport()} disabled={loading}>
                  结束并生成报告
                </Button>
              </div>
              <div className="interview-answer-actions-row interview-answer-actions-row--primary">
                <Button type="primary" icon={<IconSend />} loading={loading} disabled={!answer.trim()} onClick={submitAnswer}>
                  提交回答
                </Button>
                <Button className={listening ? 'voice-button voice-button--active' : 'voice-button'} icon={<IconVoice />} disabled={loading} onClick={toggleVoiceInput}>
                  {listening ? '停止语音' : '语音接入'}
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
                    <>
                    <p className="report-scoring-meta">
                      {report.comparison.scoring.mode === 'llm_rubric' ? '大模型 Rubric 终评' : 'Rubric 本地兜底'}
                      {report.comparison.scoring.model ? ` · ${report.comparison.scoring.model}` : ''}
                      {report.comparison.scoring.usage?.total_tokens ? ` · ${report.comparison.scoring.usage.total_tokens.toLocaleString()} tokens` : ''}
                    </p>
                    {report.comparison.scoring.mode !== 'llm_rubric' && session?.id && (
                      <Button
                        size="mini"
                        type="outline"
                        style={{ marginTop: 4 }}
                        loading={loading}
                        onClick={async () => {
                          try {
                            setLoading(true)
                            const data = await apiRequest<Report>(`/api/v1/student/interviews/${session.id}/report/regenerate`, { method: 'POST' })
                            setReport(data)
                            Message.success('报告已重新生成')
                          } catch (error) {
                            Message.error(error instanceof Error ? error.message : '重新生成失败')
                          } finally {
                            setLoading(false)
                          }
                        }}
                      >
                        重新生成报告
                      </Button>
                    )}
                    </>
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

              {/* 训练计划 */}
              {report.training_plan && report.training_plan.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ marginBottom: 8 }}>📅 训练计划</h4>
                  {report.training_plan.map((day, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: '#f7f8fa', borderRadius: 6, marginBottom: 8 }}>
                      <strong>Day {day.day}：{day.focus}</strong>
                      <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 13, lineHeight: 1.8 }}>
                        {day.tasks.map((task, j) => <li key={j}>{task}</li>)}
                      </ul>
                      {day.expected_output && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#86909c' }}>预期产出：{day.expected_output}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* 回答改写示例 */}
              {report.rewrite_examples && report.rewrite_examples.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <h4 style={{ marginBottom: 8 }}>✍️ 回答改写示例</h4>
                  {report.rewrite_examples.map((ex, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: '#f7f8fa', borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                      <p style={{ margin: 0, color: '#86909c' }}><s>{ex.original_answer}</s></p>
                      <p style={{ margin: '6px 0 0', color: '#00b42a' }}>→ {ex.better_answer}</p>
                      {ex.why_better && <p style={{ margin: '4px 0 0', fontSize: 12, color: '#86909c' }}>改进点：{ex.why_better}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* 下一场预设 + 再练一场 */}
              {report.next_session_preset && report.next_session_preset.target_role && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: '#e8f3ff', borderRadius: 6 }}>
                  <h4 style={{ marginBottom: 6 }}>🎯 下一场建议</h4>
                  <p style={{ margin: 0, fontSize: 13 }}>
                    岗位：{report.next_session_preset.target_role}
                    {report.next_session_preset.interview_type && <> · 类型：{INTERVIEW_TYPE_META[report.next_session_preset.interview_type] ?? report.next_session_preset.interview_type}</>}
                    {report.next_session_preset.interview_style && <> · 风格：{INTERVIEW_STYLE_LABELS[report.next_session_preset.interview_style] ?? report.next_session_preset.interview_style}</>}
                  </p>
                  <Button
                    size="small"
                    type="outline"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      setTargetRole(report.next_session_preset?.target_role ?? '')
                      if (report.next_session_preset?.interview_type) setInterviewType(report.next_session_preset.interview_type)
                      if (report.next_session_preset?.interview_style) setInterviewStyle(report.next_session_preset.interview_style)
                      if (report.next_session_preset?.focus_tags) setFocusTags(report.next_session_preset.focus_tags)
                      setSession(null)
                      setTurns([])
                      setReport(null)
                      setConfigCollapsed(false)
                      onInterviewActiveChange?.(false)
                    }}
                  >
                    按此计划再练一场
                  </Button>
                </div>
              )}
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
