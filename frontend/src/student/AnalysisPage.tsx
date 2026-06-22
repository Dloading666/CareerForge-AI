import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Skeleton, Spin, Tag, Tooltip, Message } from '@arco-design/web-react'
import {
  IconClockCircle,
  IconCommon,
  IconQuestionCircle,
  IconStar,
  IconSync,
  IconTrophy,
  IconUser,
  IconRefresh,
} from '@arco-design/web-react/icon'
import { apiRequest, ApiError } from '../shared/api'
import { RadarChart, type RadarPoint } from './components/RadarChart'
import { KnowledgeBarChart, type KnowledgeItem } from './components/KnowledgeBarChart'
import { StatCard } from './components/StatCard'

const RADAR_LABELS: Record<string, string> = {
  algorithm: '算法',
  fundamentals: '基础知识',
  ai_specialty: 'AI 专业',
  ai_awareness: 'AI 认知',
  coding: '编码能力',
  communication: '沟通表达',
  engineering: '工程能力',
  infrastructure: '基础架构',
}

type AnalysisPayload = {
  status: 'empty' | 'ready' | 'generating' | 'failed'
  radar: Record<string, number> | null
  knowledge: KnowledgeItem[]
  weaknesses: string[]
  summary: {
    avg_score: number
    pass_count: number
    total_interviews: number
    question_count: number
    skill_count: number
  }
  report_count: number
  trigger_type: 'auto' | 'manual' | null
  created_at: string | null
  updated_at: string | null
  error_message: string | null
}

const EMPTY_PAYLOAD: AnalysisPayload = {
  status: 'empty',
  radar: null,
  knowledge: [],
  weaknesses: [],
  summary: { avg_score: 0, pass_count: 0, total_interviews: 0, question_count: 0, skill_count: 0 },
  report_count: 0,
  trigger_type: null,
  created_at: null,
  updated_at: null,
  error_message: null,
}

export function AnalysisPage() {
  const [data, setData] = useState<AnalysisPayload>(EMPTY_PAYLOAD)
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)

  const fetchLatest = useCallback(async () => {
    try {
      const res = await apiRequest<AnalysisPayload>('/api/v1/student/interviews/analysis/latest')
      setData(res)
    } catch (e) {
      if (e instanceof ApiError) {
        Message.error(e.message || '获取分析数据失败')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchLatest()
  }, [fetchLatest])

  const onRegenerate = useCallback(async () => {
    setRegenerating(true)
    try {
      const res = await apiRequest<AnalysisPayload>('/api/v1/student/interviews/analysis/regenerate', {
        method: 'POST',
      })
      setData(res)
      Message.success('重新生成完成')
    } catch (e) {
      if (e instanceof ApiError) {
        Message.error(e.message || '重新生成失败')
      }
    } finally {
      setRegenerating(false)
    }
  }, [])

  const radarPoints: RadarPoint[] = useMemo(() => {
    if (!data.radar) return []
    return Object.keys(RADAR_LABELS).map((k) => ({
      key: k,
      label: RADAR_LABELS[k],
      value: data.radar?.[k] ?? 0,
    }))
  }, [data.radar])

  const weaknessKey = useMemo(() => {
    if (!data.radar) return undefined
    let minK: string | undefined
    let minV = 101
    for (const [k, v] of Object.entries(data.radar)) {
      if (v < minV) { minV = v; minK = k }
    }
    return minK
  }, [data.radar])

  const isEmpty = data.status === 'empty' || data.report_count === 0

  if (loading) {
    return (
      <div className="analysis-page">
        <div className="analysis-loading">
          <Spin size={32} />
          <span>加载中...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="analysis-page">
      <div className="analysis-page-header">
        <div>
          <h2 className="analysis-page-title">能力分析</h2>
          <p className="analysis-page-subtitle">
            基于你近期的面试报告生成的能力画像
            {data.report_count > 0 && (
              <>· 已包含 <strong>{data.report_count}</strong> 场面试</>
            )}
            {data.trigger_type && (
              <Tag color={data.trigger_type === 'manual' ? 'arcoblue' : 'gray'} style={{ marginLeft: 8 }}>
                {data.trigger_type === 'manual' ? '手动生成' : '自动生成'}
              </Tag>
            )}
            {data.updated_at && (
              <span className="analysis-page-time">
                <IconClockCircle /> {formatTime(data.updated_at)}
              </span>
            )}
          </p>
        </div>
        <Button
          type="primary"
          icon={<IconSync />}
          loading={regenerating}
          onClick={onRegenerate}
        >
          重新生成
        </Button>
      </div>

      <div className="analysis-stats">
        <StatCard
          icon={<IconTrophy />}
          label="评价分率"
          value={data.summary.total_interviews > 0 ? data.summary.avg_score.toFixed(1) : '--'}
          unit={data.summary.total_interviews > 0 ? '分' : ''}
          hint={data.summary.total_interviews > 0 ? '基于 ' + data.summary.total_interviews + ' 场面试的平均分' : '完成首场面试后生成'}
          tone="success"
        />
        <StatCard
          icon={<IconStar />}
          label="面试通过次数"
          value={data.summary.pass_count}
          unit="次"
          hint={data.summary.total_interviews > 0 ? '总共 ' + data.summary.total_interviews + ' 场 · 评分 ≥ 80 为通过' : '尚未参加面试'}
          tone="warning"
        />
        <StatCard
          icon={<IconQuestionCircle />}
          label="面试提问次数"
          value={data.summary.question_count}
          unit="次"
          hint="累计面试中的提问数"
          tone="info"
        />
        <StatCard
          icon={<IconCommon />}
          label="掌握技能数"
          value={data.summary.skill_count}
          unit="个"
          hint="面试中被问过的不同知识点"
          tone="default"
        />
      </div>

      {isEmpty ? (
        <div className="analysis-empty">
          <Empty
            description={
              <div className="analysis-empty-text">
                <p>还没有面试数据，完成首场面试后会自动生成能力画像</p>
                <p>可以点击下方按钮手动生成一份空报告</p>
              </div>
            }
          />
          <Button type="primary" icon={<IconRefresh />} loading={regenerating} onClick={onRegenerate}>
            生成一份空报告
          </Button>
        </div>
      ) : (
        <>
          <div className="analysis-grid">
            <section className="analysis-card analysis-card--radar">
              <header className="analysis-card-head">
                <div>
                  <h3>能力雷达</h3>
                  <p>基于多场面试的能力画像，越靠近外环越强</p>
                </div>
                {weaknessKey && (
                  <Tooltip content={'最弱: ' + RADAR_LABELS[weaknessKey] + ' ' + Math.round(data.radar?.[weaknessKey] ?? 0) + ' 分'}>
                    <Tag color="red">最弱: {RADAR_LABELS[weaknessKey]}</Tag>
                  </Tooltip>
                )}
              </header>
              <div className="analysis-card-body analysis-card-body--centered">
                {data.radar ? (
                  <RadarChart points={radarPoints} highlightKey={weaknessKey} />
                ) : (
                  <Skeleton text={{ rows: 4 }} />
                )}
              </div>
            </section>

            <section className="analysis-card analysis-card--knowledge">
              <header className="analysis-card-head">
                <div>
                  <h3>知识点掌握分布</h3>
                  <p>面试中被问过的知识点，掌握度越高越熟</p>
                </div>
              </header>
              <div className="analysis-card-body">
                <KnowledgeBarChart items={data.knowledge} max={10} />
              </div>
            </section>
          </div>

          {data.weaknesses && data.weaknesses.length > 0 && (
            <section className="analysis-card analysis-card--weakness">
              <header className="analysis-card-head">
                <div>
                  <h3>弱点提示</h3>
                  <p>你可以从这里开始补强</p>
                </div>
                <Tag color="red">{data.weaknesses.length} 项</Tag>
              </header>
              <div className="analysis-card-body">
                <ul className="weakness-list">
                  {data.weaknesses.map((w, i) => (
                    <li key={i} className="weakness-item">
                      <IconUser style={{ color: '#DC2626', flexShrink: 0 }} />
                      <span>{w}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {data.error_message && (
            <div className="analysis-error">
              <Tag color="red">生成失败: {data.error_message}</Tag>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前'
    if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前'
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}
