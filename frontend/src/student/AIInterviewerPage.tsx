import { Button, Input, Message, Select, Spin, Tag } from '@arco-design/web-react'
import {
  IconBulb,
  IconCheckCircle,
  IconExclamationCircle,
  IconLeft,
  IconPlayArrow,
  IconRefresh,
  IconRobot,
  IconSend,
  IconSettings,
  IconStop,
  IconThunderbolt,
  IconVideoCamera,
  IconVoice,
} from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'

type KnowledgeStatus = {
  root: string
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
    llm?: { used?: boolean; model?: string | null; error?: string }
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

const DEFAULT_JD = '要求熟悉 Java、Spring Boot、MySQL、Redis，具备接口设计和高并发问题排查能力。'

const INTERVIEW_TYPE_META: Record<string, string> = {
  technical: '技术准确性、原理解释、工程实现、异常场景',
  project: '个人职责、关键决策、量化结果、项目真实性',
  hr: '动机表达、稳定性、职业规划、团队协作',
  stress: '证据意识、临场修正、抗压表达',
}

const scoreLevel = (value: number) => {
  if (value >= 85) return 'excellent'
  if (value >= 70) return 'steady'
  return 'weak'
}

export function AIInterviewerPage() {
  const [knowledge, setKnowledge] = useState<KnowledgeStatus | null>(null)
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>(undefined)
  const [targetRole, setTargetRole] = useState('Java 后端开发工程师')
  const [jobDescription, setJobDescription] = useState(DEFAULT_JD)
  const [interviewType, setInterviewType] = useState('technical')
  const [interviewStyle, setInterviewStyle] = useState('strict')
  const [roundLimit, setRoundLimit] = useState('8')
  const [session, setSession] = useState<InterviewSession | null>(null)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [answer, setAnswer] = useState('')
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [configCollapsed, setConfigCollapsed] = useState(false)
  const [listening, setListening] = useState(false)
  const [reportProgress, setReportProgress] = useState<string[]>([])
  const [interviewProgress, setInterviewProgress] = useState<string[]>([])
  const recognitionRef = useRef<any>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const pendingTurn = useMemo(() => turns.find((turn) => !turn.answer) ?? null, [turns])
  const sortedDimensions = useMemo(
    () => Object.entries(report?.dimension_scores ?? {}).sort((a, b) => a[1] - b[1]),
    [report],
  )
  const weakestDimension = sortedDimensions[0]

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
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, loading, report, reportProgress.length, interviewProgress.length])

  const startInterview = async () => {
    setLoading(true)
    setReport(null)
    setReportProgress([])
    setInterviewProgress(['Harness 正在读取你的学生档案和最新在线简历。'])
    const progressTimers = [
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, '正在检索岗位相关题库与知识块，筛选本轮可追问素材。']), 450),
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, '正在把简历、档案、JD 和面试风格注入给大模型。']), 900),
      window.setTimeout(() => setInterviewProgress((prev) => [...prev, '大模型正在判断最值得验证的经历，并生成第一轮问题。']), 1350),
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
          round_limit: Number(roundLimit) || 8,
          model_id: selectedModelId,
        }),
      })
      setSession(res.session)
      setTurns([res.first_turn])
      setKnowledge(res.knowledge_status)
      setAnswer('')
      setConfigCollapsed(true)
      setInterviewProgress((prev) => [...prev, '第一轮问题已生成，面试开始。'])
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '创建面试失败')
    } finally {
      progressTimers.forEach((timer) => window.clearTimeout(timer))
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
    setLoading(true)
    try {
      const res = await apiRequest<{
        current_turn: InterviewTurn
        next_turn: InterviewTurn | null
        is_finished: boolean
      }>(`/api/v1/student/interviews/${session.id}/turns`, {
        method: 'POST',
        body: JSON.stringify({ answer: answer.trim() }),
      })
      setTurns((prev) => {
        const updated = prev.map((turn) => (turn.id === res.current_turn.id ? res.current_turn : turn))
        return res.next_turn ? [...updated, res.next_turn] : updated
      })
      setAnswer('')
      if (res.is_finished) {
        setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
        await loadReport(session.id)
      }
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '提交回答失败')
    } finally {
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
    setReportProgress([
      '感谢你参加本轮面试，现在我会把你的回答、题库命中和评分维度整理成报告。',
      '正在回看你的项目细节和技术回答。',
      '正在生成维度评分，并与历史表现做对比。',
    ])
    try {
      const data = await apiRequest<Report>(`/api/v1/student/interviews/${sessionId}/report`)
      setReport(data)
      setSession((prev) => prev ? { ...prev, status: 'completed' } : prev)
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '生成报告失败')
    } finally {
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
            <p>Model 负责追问与评分，Harness 负责流程、证据、边界和复盘。</p>
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

        <label className="interview-field">
          <span>大模型</span>
          <Select value={selectedModelId} onChange={setSelectedModelId} disabled={session?.status === 'active'} placeholder="选择面试官大脑">
            {modelOptions.map((model) => (
              <Select.Option key={model.id} value={model.id}>
                {model.display_name} · {model.model_identifier}
              </Select.Option>
            ))}
          </Select>
        </label>

        <label className="interview-field">
          <span>目标岗位</span>
          <Input value={targetRole} onChange={setTargetRole} disabled={session?.status === 'active'} />
        </label>

        <label className="interview-field">
          <span>岗位 JD</span>
          <Input.TextArea value={jobDescription} onChange={setJobDescription} autoSize={{ minRows: 4, maxRows: 8 }} disabled={session?.status === 'active'} />
        </label>

        <div className="interview-field-row">
          <label className="interview-field">
            <span>面试类型</span>
            <Select value={interviewType} onChange={setInterviewType} disabled={session?.status === 'active'}>
              <Select.Option value="technical">技术面</Select.Option>
              <Select.Option value="project">项目深挖</Select.Option>
              <Select.Option value="hr">HR 面</Select.Option>
              <Select.Option value="stress">压力面</Select.Option>
            </Select>
          </label>
          <label className="interview-field">
            <span>轮次</span>
            <Select value={roundLimit} onChange={setRoundLimit} disabled={session?.status === 'active'}>
              <Select.Option value="5">5</Select.Option>
              <Select.Option value="8">8</Select.Option>
              <Select.Option value="10">10</Select.Option>
              <Select.Option value="12">12</Select.Option>
            </Select>
          </label>
        </div>

        <label className="interview-field">
          <span>面试风格</span>
          <Select value={interviewStyle} onChange={setInterviewStyle} disabled={session?.status === 'active'}>
            <Select.Option value="strict">严格追问</Select.Option>
            <Select.Option value="stress">压力面试</Select.Option>
            <Select.Option value="friendly">温和训练</Select.Option>
          </Select>
        </label>

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

        <Button icon={<IconRefresh />} onClick={reloadKnowledge} long style={{ marginBottom: 12 }}>
          重新索引知识库
        </Button>

        <Button type="primary" icon={session?.status === 'active' ? <IconRefresh /> : <IconPlayArrow />} loading={loading && !pendingTurn} onClick={startInterview} long>
          {session?.status === 'active' ? '重新开始一场' : '开始面试'}
        </Button>
      </section>

      <section className="interview-room">
        <div className="interview-room-header">
          {configCollapsed && (
            <Button className="interview-config-toggle" icon={<IconLeft />} onClick={() => setConfigCollapsed(false)}>
              设置
            </Button>
          )}
          <div>
            <h2>{session ? session.target_role : '准备进入面试房间'}</h2>
            <p>{session ? `第 ${turns.length}/${session.round_limit} 轮 · ${session.status === 'active' ? '面试中' : '已结束'}` : '选择岗位、模型和风格后进入沉浸式训练。Enter 发送，Shift + Enter 换行。'}</p>
          </div>
          {session?.status === 'active' && (
            <Button icon={<IconStop />} onClick={() => loadReport()} disabled={loading}>
              结束并生成报告
            </Button>
          )}
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
                <span><IconThunderbolt /> {roundLimit} 轮训练</span>
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
              {interviewProgress.map((item, idx) => (
                <p key={`${item}-${idx}`}><IconCheckCircle />{item}</p>
              ))}
            </div>
          )}

          {turns.map((turn) => (
            <div key={turn.id} className="interview-turn">
              <div className="interview-message interviewer">
                <div className="bubble-title">AI 面试官 · Q{turn.turn_index}</div>
                <div className="bubble-content">{turn.question}</div>
                {turn.knowledge_points && turn.knowledge_points.length > 0 && (
                  <div className="knowledge-tags">
                    {turn.knowledge_points.slice(0, 4).map((item) => <Tag key={item}>{item}</Tag>)}
                  </div>
                )}
              </div>
              {turn.answer && (
                <div className="interview-message candidate">
                  <div className="bubble-title">我的回答</div>
                  <div className="bubble-content">{turn.answer}</div>
                </div>
              )}
              {turn.answer_assessment && (
                <div className="interview-feedback">
                  <strong>本轮反馈：</strong>{turn.answer_assessment.summary}
                  {turn.followup_reason && <span> · 追问策略：{turn.followup_reason}</span>}
                  <div className="interview-runtime-meta">
                    {turn.answer_assessment.llm?.used
                      ? `大模型思考：${turn.answer_assessment.llm.model ?? '已启用'}`
                      : `大模型未启用：${turn.answer_assessment.llm?.error ?? '使用本地降级逻辑'}`}
                    {turn.answer_assessment.retrieval?.hit_count ? ` · 检索命中：${turn.answer_assessment.retrieval.hit_count} 条` : ''}
                  </div>
                  {turn.answer_assessment.retrieval?.top_sources?.length ? (
                    <div className="interview-runtime-sources">
                      {turn.answer_assessment.retrieval.top_sources.slice(0, 3).map((src) => <Tag key={src}>{src}</Tag>)}
                    </div>
                  ) : null}
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
              <Spin /> {reportProgress.length > 0 ? reportProgress[reportProgress.length - 1] : '面试官正在检索题库、评价回答并组织追问。'}
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
            <Button type="primary" icon={<IconSend />} loading={loading} disabled={!answer.trim()} onClick={submitAnswer}>
              提交回答
            </Button>
            <Button className={listening ? 'voice-button voice-button--active' : 'voice-button'} icon={<IconVoice />} disabled={loading} onClick={toggleVoiceInput}>
              {listening ? '停止语音' : '语音接入'}
            </Button>
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
