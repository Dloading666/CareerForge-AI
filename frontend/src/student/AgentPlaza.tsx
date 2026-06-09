import { Button, Empty, Input, Select, Spin, Tag, Tooltip } from '@arco-design/web-react'
import {
  IconApps,
  IconBook,
  IconFile,
  IconLaunch,
  IconSearch,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import { apiRequest } from '../shared/api'
import { StudentAgentChat, type AgentItem } from './StudentAgentChat'

// ── Types ──────────────────────────────────────────────────────────────────────

// 后端 /api/v1/agents 返回的智能体形状（取用到的字段）
interface RawAgent {
  id: number
  name: string
  description: string | null
  category: string
  use_dify: boolean
  is_enabled: boolean
  suggested_questions: string[] | null
  model_config: { display_name: string } | null
}

interface SubAgent {
  id: number
  name: string
  desc: string
  categoryLabel: string
  provider: 'builtin' | 'dify'
  icon: ReactNode
  iconTone: string
  tags: string[]
  status: 'online' | 'offline'
  modelName: string | null
}

// ── 分类元信息（后端 category 是英文枚举）──────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; icon: ReactNode; tone: string; tags: string[] }> = {
  interview: { label: '面试辅导', icon: <IconUser />, tone: 'blue', tags: ['模拟面试', '复盘'] },
  job_search: { label: '求职分析', icon: <IconSearch />, tone: 'green', tags: ['岗位匹配', '简历'] },
  tools: { label: '实用工具', icon: <IconApps />, tone: 'purple', tags: ['测评', '规划'] },
  other: { label: '其他', icon: <IconBook />, tone: 'cyan', tags: [] },
}

function metaFor(category: string) {
  return CATEGORY_META[category] ?? { label: category || '其他', icon: <IconFile />, tone: 'gray', tags: [] }
}

const CATEGORIES = ['全部', '面试辅导', '求职分析', '简历服务', '职业发展', '实用工具', '其他']

const PROVIDER_LABELS: Record<string, string> = {
  builtin: '平台内置',
  dify: 'Dify 导入',
}

function toSubAgent(raw: RawAgent): SubAgent {
  const meta = metaFor(raw.category)
  const tags = (raw.suggested_questions ?? []).length > 0
    ? (raw.suggested_questions as string[]).slice(0, 3).map((q) => (q.length > 12 ? `${q.slice(0, 12)}…` : q))
    : meta.tags
  return {
    id: raw.id,
    name: raw.name,
    desc: raw.description || '暂无描述',
    categoryLabel: meta.label,
    provider: raw.use_dify ? 'dify' : 'builtin',
    icon: meta.icon,
    iconTone: meta.tone,
    tags,
    status: raw.is_enabled ? 'online' : 'offline',
    modelName: raw.model_config?.display_name ?? null,
  }
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AgentPlaza() {
  const [agents, setAgents] = useState<SubAgent[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [providerFilter, setProviderFilter] = useState<string>('all')
  const [chatAgent, setChatAgent] = useState<AgentItem | null>(null)
  const [opening, setOpening] = useState<number | null>(null)

  const openChat = async (id: number) => {
    setOpening(id)
    try {
      const full = await apiRequest<AgentItem>(`/api/v1/agents/${id}`)
      setChatAgent(full)
    } catch {
      /* 忽略：保持在列表页 */
    } finally {
      setOpening(null)
    }
  }

  useEffect(() => {
    let alive = true
    setLoading(true)
    apiRequest<RawAgent[]>('/api/v1/agents')
      .then((list) => {
        if (alive) setAgents((list ?? []).map(toSubAgent))
      })
      .catch(() => {
        if (alive) setAgents([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const filtered = useMemo(() => {
    return agents.filter((agent) => {
      const matchSearch =
        !search.trim() ||
        agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.desc.toLowerCase().includes(search.toLowerCase()) ||
        agent.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      const matchCategory = category === '全部' || agent.categoryLabel === category
      const matchProvider = providerFilter === 'all' || agent.provider === providerFilter
      return matchSearch && matchCategory && matchProvider
    })
  }, [agents, search, category, providerFilter])

  if (chatAgent) {
    return <StudentAgentChat agent={chatAgent} onBack={() => setChatAgent(null)} />
  }

  return (
    <div className="agent-plaza">
      <div className="admin-section-title">
        <h3>智能体广场</h3>
        <p>发现并使用由管理员配置和 Dify 导入的专业子智能体</p>
      </div>

      <div className="plaza-stats">
        <div className="plaza-stat">
          <span className="plaza-stat-num">{agents.filter((a) => a.status === 'online').length}</span>
          <span className="plaza-stat-label">已上线</span>
        </div>
        <div className="plaza-stat">
          <span className="plaza-stat-num">{agents.filter((a) => a.provider === 'dify').length}</span>
          <span className="plaza-stat-label">Dify 导入</span>
        </div>
        <div className="plaza-stat">
          <span className="plaza-stat-num">{agents.length}</span>
          <span className="plaza-stat-label">总计</span>
        </div>
      </div>

      <div className="plaza-filters">
        <Input
          className="plaza-search"
          prefix={<IconSearch />}
          placeholder="搜索智能体名称、描述或标签…"
          value={search}
          onChange={setSearch}
          allowClear
          style={{ maxWidth: 340 }}
        />
        <div className="plaza-category-bar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`plaza-cat-btn${category === cat ? ' active' : ''}`}
              onClick={() => setCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
        <Select
          className="plaza-provider-select"
          value={providerFilter}
          onChange={setProviderFilter}
          size="small"
          style={{ width: 120 }}
        >
          <Select.Option value="all">全部来源</Select.Option>
          <Select.Option value="builtin">平台内置</Select.Option>
          <Select.Option value="dify">Dify 导入</Select.Option>
        </Select>
      </div>

      {loading ? (
        <div className="plaza-empty-wrap">
          <Spin dot />
        </div>
      ) : filtered.length === 0 ? (
        <div className="plaza-empty-wrap">
          <Empty description={agents.length === 0 ? '暂无已发布的智能体' : '暂无匹配的智能体'} />
        </div>
      ) : (
        <div className="plaza-grid">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} opening={opening === agent.id} onUse={() => void openChat(agent.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent, opening, onUse }: { agent: SubAgent; opening: boolean; onUse: () => void }) {
  const isOnline = agent.status === 'online'

  return (
    <div className="plaza-card">
      <div className="plaza-card-head">
        <span className={`plaza-card-icon tone-${agent.iconTone}`}>{agent.icon}</span>
        <div className="plaza-card-title-group">
          <h3>{agent.name}</h3>
          <span className="plaza-card-provider">{PROVIDER_LABELS[agent.provider]}</span>
        </div>
        <Tag color={isOnline ? 'green' : 'red'} size="small">
          {isOnline ? '在线' : '离线'}
        </Tag>
      </div>

      <p className="plaza-card-desc">{agent.desc}</p>

      <div className="plaza-card-tags">
        {agent.tags.map((tag) => (
          <Tag key={tag} size="small" className="plaza-tag">
            {tag}
          </Tag>
        ))}
      </div>

      <div className="plaza-card-foot">
        <span className="plaza-card-usage">{agent.modelName ?? '—'}</span>
        <Tooltip content={isOnline ? '打开该智能体对话' : '该智能体已下线'}>
          <Button type="primary" size="mini" disabled={!isOnline} loading={opening} icon={<IconLaunch />} onClick={onUse}>
            去使用
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
