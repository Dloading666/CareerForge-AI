import { useId, useMemo } from 'react'
import { Tag, Button } from '@arco-design/web-react'
import {
  IconExclamationCircle,
  IconTrophy,
  IconSun,
  IconQuestion,
  IconArrowRise,
  IconArrowFall,
  IconRefresh,
} from '@arco-design/web-react/icon'

export type InterviewReportData = {
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
    scoring?: { mode?: string; model?: string; usage?: { total_tokens?: number } }
  } | null
  report_text: string
  training_plan?: Array<{ day?: number; focus?: string; tasks?: string[]; expected_output?: string }>
  rewrite_examples?: Array<{ original?: string; rewritten?: string; explanation?: string }>
  next_session_preset?: { target_role?: string; interview_type?: string; interview_style?: string }
}

interface InterviewReportProps {
  report: InterviewReportData
  onPracticeAgain?: (preset?: InterviewReportData['next_session_preset']) => void
}

const DIM_LABELS: Record<string, string> = {
  technical_accuracy: '技术准确性', project_evidence: '项目证据',
  problem_solving: '问题解决', communication: '表达逻辑',
  job_fit: '岗位匹配', pressure_handling: '压力应对',
}

const DIM_DESC: Record<string, string> = {
  technical_accuracy: '概念、原理、边界、工程实现',
  project_evidence: '个人职责、落地细节、量化结果',
  problem_solving: '澄清问题、拆解方案、说明取舍',
  communication: '表达结构化、聚焦问题、前后连贯',
  job_fit: '贴合目标岗位 JD 和核心能力要求',
  pressure_handling: '被追问时稳定、诚实、能补充证据',
}

const DIM_ORDER = ['technical_accuracy', 'project_evidence', 'problem_solving', 'communication', 'job_fit', 'pressure_handling']

function scoreColor(score: number): string {
  if (score >= 80) return '#22C55E'
  if (score >= 60) return '#F59E0B'
  return '#EF4444'
}

function scoreGradient(score: number): [string, string] {
  if (score >= 80) return ['#22C55E', '#16A34A']
  if (score >= 60) return ['#F59E0B', '#D97706']
  return ['#EF4444', '#DC2626']
}

function ArrowIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
      <path d="M6 14h14M15 9l5 5-5 5" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ScoreRing({ score, delta, scoringMeta }: {
  score: number; delta?: number; scoringMeta?: { mode?: string; model?: string }
}) {
  const [gradStart, gradEnd] = scoreGradient(score)
  const gradientId = useId()
  const circumference = 2 * Math.PI * 64
  const offset = circumference * (1 - score / 100)

  return (
    <div className="ir-score-hero">
      <svg width="180" height="180" viewBox="0 0 180 180" className="ir-score-ring">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={gradStart} />
            <stop offset="100%" stopColor={gradEnd} />
          </linearGradient>
        </defs>
        <circle cx="90" cy="90" r="64" fill="none" stroke="rgba(0,0,0,0.04)" strokeWidth="12" />
        <circle cx="90" cy="90" r="64" fill="none"
          stroke={`url(#${gradientId})`} strokeWidth="12"
          strokeLinecap="round" strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 90 90)"
          style={{ transition: 'stroke-dashoffset 0.8s cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
        <text x="90" y="84" textAnchor="middle" fill="#1D2129"
          fontSize="44" fontWeight="800"
          style={{ fontVariantNumeric: 'tabular-nums' } as React.CSSProperties}>
          {Math.round(score)}
        </text>
        <text x="90" y="106" textAnchor="middle" fill="#86909C" fontSize="13">综合评分</text>
      </svg>
      <div className="ir-score-meta">
        {delta !== undefined && (
          <Tag color={delta >= 0 ? 'green' : 'red'} size="small">
            {delta >= 0 ? <IconArrowRise /> : <IconArrowFall />}
            {delta >= 0 ? '+' : ''}{delta} 分
          </Tag>
        )}
        {scoringMeta?.mode && (
          <span className="ir-scoring-src">
            {scoringMeta.mode === 'llm_rubric' ? 'LLM Rubric 终评' : 'Rubric 本地兜底'}
            {scoringMeta.model ? ` · ${scoringMeta.model}` : ''}
          </span>
        )}
      </div>
    </div>
  )
}

function DimensionBars({ scores, weakestKey }: {
  scores: Record<string, number>; weakestKey?: string
}) {
  const avgScore = useMemo(() => {
    const vals = Object.values(scores).filter((v) => v > 0)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
  }, [scores])
  const coveredCount = Object.values(scores).filter((v) => v > 0).length

  return (
    <>
      <div className="ir-dim-summary">
        <div className="ir-dim-summary-stat">
          <span className="stat-value">{coveredCount}/6</span>
          <span className="stat-label">已覆盖维度</span>
        </div>
        <div className="ir-dim-summary-stat">
          <span className="stat-value">{avgScore}</span>
          <span className="stat-label">平均得分</span>
        </div>
      </div>
      <div className="ir-dim-bars">
        {DIM_ORDER.map((key) => {
          const value = scores[key] ?? 0
          const color = scoreColor(value)
          const isWeakest = key === weakestKey
          return (
            <div key={key} className={`ir-dim-row${isWeakest ? ' ir-dim-row--weakest' : ''}`}>
              <div className="ir-dim-row-head">
                <span className="ir-dim-name">
                  {DIM_LABELS[key] ?? key}
                  {isWeakest && <em className="ir-dim-focus">重点突破</em>}
                </span>
                <span className="ir-dim-val" style={{ color }}>{Math.round(value)}</span>
              </div>
              <div className="ir-dim-track">
                <div className="ir-dim-fill"
                  style={{
                    width: `${Math.max(4, Math.min(100, value))}%`,
                    background: `linear-gradient(90deg, ${color}, ${color}cc)`,
                  }}
                />
              </div>
              <span className="ir-dim-hint">{DIM_DESC[key] ?? ''}</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

function InsightCard({ title, icon, tone, items }: {
  title: string; icon: React.ReactNode; tone: 'green' | 'red' | 'blue' | 'orange'; items: string[]
}) {
  if (!items?.length) return null
  const c = {
    green:  { text: '#16A34A', dot: '#22C55E', bar: '#22C55E' },
    red:    { text: '#DC2626', dot: '#EF4444', bar: '#EF4444' },
    blue:   { text: '#165DFF', dot: '#3B82F6', bar: '#3B82F6' },
    orange: { text: '#D97706', dot: '#F59E0B', bar: '#F59E0B' },
  }[tone]
  return (
    <div className="ir-insight-card" style={{ ['--dot-color' as string]: c.dot }}>
      <span style={{ background: c.bar }} />
      <h4 style={{ color: c.text }}>
        <span className="ir-insight-icon">{icon}</span>
        {title}
      </h4>
      <ul>
        {items.slice(0, 6).map((item, i) => <li key={i}>{item}</li>)}
      </ul>
    </div>
  )
}

function TrainingPlan({ plan }: { plan: NonNullable<InterviewReportData['training_plan']> }) {
  if (!plan?.length) return null
  return (
    <div className="ir-training">
      <h3>训练计划</h3>
      <div className="ir-training-timeline">
        {plan.map((p, i) => (
          <div key={i} className="ir-training-step">
            <div className="ir-training-badge">{p.day ? `Day ${p.day}` : `Step ${i + 1}`}</div>
            <div className="ir-training-body">
              <strong>{p.focus || '训练任务'}</strong>
              {p.tasks?.length ? <ul>{p.tasks.map((t, j) => <li key={j}>{t}</li>)}</ul> : null}
              {p.expected_output && <p className="ir-training-output">预期产出：{p.expected_output}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function RewriteExamples({ examples }: { examples: NonNullable<InterviewReportData['rewrite_examples']> }) {
  if (!examples?.length) return null
  return (
    <div className="ir-rewrite">
      <h3>回答改写示例</h3>
      {examples.map((ex, i) => (
        <div key={i} className="ir-rewrite-item">
          {ex.original && (
            <div className="ir-rewrite-col ir-rewrite--before">
              <span className="ir-rewrite-label">原回答</span>
              <p>{ex.original}</p>
            </div>
          )}
          <div className="ir-rewrite-arrow"><ArrowIcon /></div>
          {ex.rewritten && (
            <div className="ir-rewrite-col ir-rewrite--after">
              <span className="ir-rewrite-label">优化后</span>
              <p>{ex.rewritten}</p>
            </div>
          )}
          {ex.explanation && <p className="ir-rewrite-note">{ex.explanation}</p>}
        </div>
      ))}
    </div>
  )
}

export function InterviewReport({ report, onPracticeAgain }: InterviewReportProps) {
  const weakestKey = useMemo(() => {
    const entries = Object.entries(report.dimension_scores ?? {})
    if (!entries.length) return undefined
    return entries.sort((a, b) => a[1] - b[1])[0][0]
  }, [report.dimension_scores])

  const delta = report.comparison?.overall_delta

  return (
    <section className="ir-root">
      <div className="ir-hero">
        <ScoreRing score={report.overall_score} delta={delta} scoringMeta={report.comparison?.scoring} />
        <div className="ir-hero-body">
          <h2>面试复盘</h2>
          <div className="ir-summary">{report.report_text}</div>
          {report.comparison?.message && <div className="ir-compare-msg">{report.comparison.message}</div>}
          {weakestKey && (
            <div className="ir-weakest-tip">
              <IconExclamationCircle style={{ color: '#DC2626' }} />
              <span>最薄弱维度：<strong>{DIM_LABELS[weakestKey]}</strong>
                <small>（{Math.round(report.dimension_scores[weakestKey] ?? 0)} 分），下一轮优先补这里</small>
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="ir-section">
        <h3>六维评分</h3>
        <DimensionBars scores={report.dimension_scores} weakestKey={weakestKey} />
      </div>

      <div className="ir-insights">
        <InsightCard title="优势" tone="green" icon={<IconTrophy />} items={report.strengths} />
        <InsightCard title="待改进" tone="red" icon={<IconExclamationCircle />} items={report.weaknesses} />
        <InsightCard title="训练建议" tone="blue" icon={<IconSun />} items={report.suggestions} />
        <InsightCard title="下一轮题目" tone="orange" icon={<IconQuestion />} items={report.next_questions} />
      </div>

      <TrainingPlan plan={report.training_plan || []} />
      <RewriteExamples examples={report.rewrite_examples || []} />

      {report.next_session_preset && (
        <div className="ir-again">
          <Button type="primary" icon={<IconRefresh />}
            onClick={() => onPracticeAgain?.(report.next_session_preset)}>
            按此计划再练一场
          </Button>
          <span className="ir-again-preset">
            {[report.next_session_preset.target_role, report.next_session_preset.interview_type, report.next_session_preset.interview_style].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}
    </section>
  )
}
