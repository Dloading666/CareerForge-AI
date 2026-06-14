import { useMemo } from 'react'
import { Drawer, Tag, Spin, Button } from '@arco-design/web-react'
import { IconExclamationCircle, IconTrophy, IconSun, IconQuestion } from '@arco-design/web-react/icon'

// ── Types ──────────────────────────────────────────────────────────────────────

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
    scoring?: {
      mode?: string
      model?: string
    }
  } | null
  report_text: string
  training_plan?: Array<{
    day?: number
    focus?: string
    tasks?: string[]
    expected_output?: string
  }>
  rewrite_examples?: Array<{
    original?: string
    rewritten?: string
    explanation?: string
  }>
  next_session_preset?: {
    target_role?: string
    interview_type?: string
    interview_style?: string
  }
}

interface InterviewReportDrawerProps {
  visible: boolean
  onClose: () => void
  report: InterviewReportData | null
  loading?: boolean
  onPracticeAgain?: (preset?: InterviewReportData['next_session_preset']) => void
}

// ── Constants ──────────────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreLevel(score: number): string {
  if (score >= 80) return 'good'
  if (score >= 60) return 'ok'
  return 'risk'
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ReportList({
  title,
  tone,
  items,
  icon,
}: {
  title: string
  tone: 'good' | 'risk' | 'coach' | 'next'
  items: string[]
  icon: React.ReactNode
}) {
  if (!items || items.length === 0) return null
  return (
    <div className={`drawer-report-list drawer-report-list--${tone}`}>
      <h4>
        {icon}
        {title}
      </h4>
      <ul>
        {items.slice(0, 6).map((item, idx) => (
          <li key={`${tone}-${idx}`}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function InterviewReportDrawer({
  visible,
  onClose,
  report,
  loading = false,
  onPracticeAgain,
}: InterviewReportDrawerProps) {
  const sortedDimensions = useMemo(
    () =>
      Object.entries(report?.dimension_scores ?? {})
        .sort((a, b) => a[1] - b[1]),
    [report],
  )

  const weakestDimension = sortedDimensions[0]

  return (
    <Drawer
      title="面试报告"
      visible={visible}
      onCancel={onClose}
      width={560}
      footer={null}
      className="interview-report-drawer"
    >
      {loading && (
        <div className="drawer-loading">
          <Spin />
          <span>正在生成报告...</span>
        </div>
      )}

      {!loading && !report && (
        <div className="drawer-empty">暂无报告数据</div>
      )}

      {!loading && report && (
        <div className="drawer-report-content">
          {/* 总分面板 */}
          <div className="drawer-score-panel">
            <div className="drawer-score-ring">
              <span>{Math.round(report.overall_score)}</span>
              <p>综合评分</p>
            </div>
            <div className="drawer-score-meta">
              {report.comparison?.scoring && (
                <p className="drawer-scoring-meta">
                  {report.comparison.scoring.mode === 'llm_rubric' ? '大模型 Rubric 终评' : 'Rubric 本地兜底'}
                  {report.comparison.scoring.model ? ` · ${report.comparison.scoring.model}` : ''}
                </p>
              )}
              {report.comparison?.overall_delta !== undefined && (
                <Tag
                  color={report.comparison.overall_delta >= 0 ? 'green' : 'red'}
                  style={{ marginTop: 8 }}
                >
                  {report.comparison.overall_delta >= 0 ? '+' : ''}
                  {report.comparison.overall_delta} 分
                </Tag>
              )}
              {weakestDimension && (
                <div className="drawer-weakest">
                  <IconExclamationCircle />
                  <span>
                    最薄弱：<strong>{DIMENSION_LABELS[weakestDimension[0]] ?? weakestDimension[0]}</strong>
                    <small>（{Math.round(weakestDimension[1])} 分）</small>
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 报告正文 */}
          <div className="drawer-report-text">{report.report_text}</div>
          {report.comparison?.message && (
            <div className="drawer-comparison">{report.comparison.message}</div>
          )}

          {/* 六维评分 */}
          <div className="drawer-dimension-section">
            <h3>维度评分</h3>
            <div className="drawer-dimension-grid">
              {sortedDimensions.map(([key, value]) => (
                <div key={key} className={`drawer-dimension-item drawer-dimension-item--${scoreLevel(value)}`}>
                  <div className="drawer-dimension-info">
                    <span className="drawer-dimension-label">
                      {DIMENSION_LABELS[key] ?? key}
                    </span>
                    <small className="drawer-dimension-desc">
                      {DIMENSION_DESCRIPTIONS[key] ?? ''}
                    </small>
                    {weakestDimension?.[0] === key && (
                      <em className="drawer-dimension-focus">重点突破</em>
                    )}
                  </div>
                  <strong className="drawer-dimension-score">{Math.round(value)}</strong>
                  <div className="drawer-dimension-bar">
                    <div
                      className="drawer-dimension-bar-fill"
                      style={{ width: `${Math.max(8, Math.min(100, value))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 优势 / 不足 / 建议 / 下轮题目 */}
          <div className="drawer-lists-section">
            <ReportList
              title="优势"
              tone="good"
              items={report.strengths}
              icon={<IconTrophy />}
            />
            <ReportList
              title="待改进"
              tone="risk"
              items={report.weaknesses}
              icon={<IconExclamationCircle />}
            />
            <ReportList
              title="训练建议"
              tone="coach"
              items={report.suggestions}
              icon={<IconSun />}
            />
            <ReportList
              title="下一轮题目"
              tone="next"
              items={report.next_questions}
              icon={<IconQuestion />}
            />
          </div>

          {/* 训练计划 */}
          {report.training_plan && report.training_plan.length > 0 && (
            <div className="drawer-training-section">
              <h3>训练计划</h3>
              <div className="drawer-training-timeline">
                {report.training_plan.map((plan, idx) => (
                  <div key={idx} className="drawer-training-day">
                    <div className="drawer-training-day-badge">
                      {plan.day ? `Day ${plan.day}` : `Step ${idx + 1}`}
                    </div>
                    <div className="drawer-training-day-content">
                      <strong>{plan.focus || '训练任务'}</strong>
                      {plan.tasks && plan.tasks.length > 0 && (
                        <ul>
                          {plan.tasks.map((task, tidx) => (
                            <li key={tidx}>{task}</li>
                          ))}
                        </ul>
                      )}
                      {plan.expected_output && (
                        <p className="drawer-training-output">
                          预期产出：{plan.expected_output}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 改写示例 */}
          {report.rewrite_examples && report.rewrite_examples.length > 0 && (
            <div className="drawer-rewrite-section">
              <h3>回答改写示例</h3>
              {report.rewrite_examples.map((ex, idx) => (
                <div key={idx} className="drawer-rewrite-item">
                  {ex.original && (
                    <div className="drawer-rewrite-before">
                      <span className="drawer-rewrite-label">原回答</span>
                      <p>{ex.original}</p>
                    </div>
                  )}
                  {ex.rewritten && (
                    <div className="drawer-rewrite-after">
                      <span className="drawer-rewrite-label">优化后</span>
                      <p>{ex.rewritten}</p>
                    </div>
                  )}
                  {ex.explanation && (
                    <p className="drawer-rewrite-explanation">{ex.explanation}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* P1-4: 按此计划再练一场 */}
          <div className="drawer-practice-again">
            <Button
              type="primary"
              long
              onClick={() => {
                onPracticeAgain?.(report.next_session_preset)
                onClose()
              }}
            >
              按此计划再练一场
            </Button>
            {report.next_session_preset?.target_role && (
              <p className="drawer-preset-info">
                预设：{report.next_session_preset.target_role}
                {report.next_session_preset.interview_type ? ` · ${report.next_session_preset.interview_type}` : ''}
                {report.next_session_preset.interview_style ? ` · ${report.next_session_preset.interview_style}` : ''}
              </p>
            )}
          </div>
        </div>
      )}
    </Drawer>
  )
}
