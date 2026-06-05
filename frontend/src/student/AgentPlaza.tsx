import { Button, Empty, Input, Select, Tag, Tooltip } from '@arco-design/web-react'
import {
  IconApps,
  IconBook,
  IconCode,
  IconFile,
  IconLaunch,
  IconSearch,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ReactNode } from 'react'
import { useMemo, useState } from 'react'

// ── Types ──────────────────────────────────────────────────────────────────────

interface SubAgent {
  id: string
  name: string
  desc: string
  category: string
  provider: 'builtin' | 'dify'
  icon: ReactNode
  iconTone: string
  tags: string[]
  status: 'online' | 'offline' | 'coming_soon'
  usageCount?: number
}

// ── Mock data ──────────────────────────────────────────────────────────────────
// TODO: 后续对接后端 /api/v1/student/agents/plaza 接口

const MOCK_AGENTS: SubAgent[] = [
  {
    id: 'interview',
    name: 'AI 面试官',
    desc: '模拟真实面试场景，提供多轮追问、逐题点评与复盘报告，帮你提前适应高压面试节奏。',
    category: '面试辅导',
    provider: 'builtin',
    icon: <IconUser />,
    iconTone: 'blue',
    tags: ['模拟面试', '行为面试', '复盘报告'],
    status: 'online',
    usageCount: 1280,
  },
  {
    id: 'matching',
    name: '岗位匹配',
    desc: '对简历与 JD 进行双向匹配，分析技能差距并给出针对性提升路径。',
    category: '求职分析',
    provider: 'builtin',
    icon: <IconSearch />,
    iconTone: 'green',
    tags: ['JD 分析', '匹配打分', '差距诊断'],
    status: 'online',
    usageCount: 960,
  },
  {
    id: 'resume',
    name: '简历优化',
    desc: '基于目标岗位重写项目经历，补齐 STAR 结构与量化表达，让简历更有说服力。',
    category: '简历服务',
    provider: 'builtin',
    icon: <IconFile />,
    iconTone: 'orange',
    tags: ['STAR 重写', '量化表达', '排版建议'],
    status: 'online',
    usageCount: 740,
  },
  {
    id: 'career-planner',
    name: '职业规划师',
    desc: '根据你的专业背景、兴趣和市场需求，定制个性化职业发展路线图。',
    category: '职业发展',
    provider: 'dify',
    icon: <IconApps />,
    iconTone: 'purple',
    tags: ['职业路线', '行业分析', '技能规划'],
    status: 'online',
    usageCount: 520,
  },
  {
    id: 'cover-letter',
    name: '求职信生成',
    desc: '针对目标公司和岗位，生成专业、个性化的求职信与自荐邮件。',
    category: '简历服务',
    provider: 'dify',
    icon: <IconBook />,
    iconTone: 'cyan',
    tags: ['求职信', '自荐邮件', '个性化'],
    status: 'online',
    usageCount: 380,
  },
  {
    id: 'salary-negotiator',
    name: '薪资谈判教练',
    desc: '提供薪资市场数据参考，模拟薪资谈判场景，帮你争取最优 offer。',
    category: '面试辅导',
    provider: 'dify',
    icon: <IconCode />,
    iconTone: 'gold',
    tags: ['薪资数据', '谈判话术', 'Offer 对比'],
    status: 'coming_soon',
  },
  {
    id: 'industry-insight',
    name: '行业洞察助手',
    desc: '深度解读目标行业趋势、头部企业动态、人才需求变化，助你把握求职方向。',
    category: '求职分析',
    provider: 'dify',
    icon: <IconBook />,
    iconTone: 'lime',
    tags: ['行业趋势', '企业分析', '赛道研判'],
    status: 'coming_soon',
  },
]

const CATEGORIES = ['全部', '面试辅导', '求职分析', '简历服务', '职业发展']

const PROVIDER_LABELS: Record<string, string> = {
  builtin: '平台内置',
  dify: 'Dify 导入',
}

// ── Component ──────────────────────────────────────────────────────────────────

export function AgentPlaza() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('全部')
  const [providerFilter, setProviderFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    return MOCK_AGENTS.filter((agent) => {
      const matchSearch =
        !search.trim() ||
        agent.name.toLowerCase().includes(search.toLowerCase()) ||
        agent.desc.toLowerCase().includes(search.toLowerCase()) ||
        agent.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
      const matchCategory = category === '全部' || agent.category === category
      const matchProvider = providerFilter === 'all' || agent.provider === providerFilter
      return matchSearch && matchCategory && matchProvider
    })
  }, [search, category, providerFilter])

  return (
    <div className="agent-plaza">
      {/* ── Header ──────────────────────────────────────────── */}
      <div className="admin-section-title">
        <h3>智能体广场</h3>
        <p>发现并使用由管理员配置和 Dify 导入的专业子智能体</p>
      </div>

      {/* ── Stats strip ─────────────────────────────────────── */}
      <div className="plaza-stats">
        <div className="plaza-stat">
          <span className="plaza-stat-num">{MOCK_AGENTS.filter((a) => a.status === 'online').length}</span>
          <span className="plaza-stat-label">已上线</span>
        </div>
        <div className="plaza-stat">
          <span className="plaza-stat-num">{MOCK_AGENTS.filter((a) => a.provider === 'dify').length}</span>
          <span className="plaza-stat-label">Dify 导入</span>
        </div>
        <div className="plaza-stat">
          <span className="plaza-stat-num">{MOCK_AGENTS.length}</span>
          <span className="plaza-stat-label">总计</span>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────── */}
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

      {/* ── Card Grid ───────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="plaza-empty-wrap">
          <Empty description="暂无匹配的智能体" />
        </div>
      ) : (
        <div className="plaza-grid">
          {filtered.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Agent Card ─────────────────────────────────────────────────────────────────

function AgentCard({ agent }: { agent: SubAgent }) {
  const isOnline = agent.status === 'online'
  const isComingSoon = agent.status === 'coming_soon'

  return (
    <div className={`plaza-card${isComingSoon ? ' coming-soon' : ''}`}>
      <div className="plaza-card-head">
        <span className={`plaza-card-icon tone-${agent.iconTone}`}>{agent.icon}</span>
        <div className="plaza-card-title-group">
          <h3>{agent.name}</h3>
          <span className="plaza-card-provider">{PROVIDER_LABELS[agent.provider]}</span>
        </div>
        <Tag
          color={isOnline ? 'green' : isComingSoon ? 'gray' : 'red'}
          size="small"
        >
          {isOnline ? '在线' : isComingSoon ? '即将上线' : '离线'}
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
        <span className="plaza-card-usage">
          {agent.usageCount != null ? `${agent.usageCount.toLocaleString()} 次调用` : '—'}
        </span>
        <Tooltip content={isComingSoon ? '该智能体即将上线，敬请期待' : '点击在主智能体对话中调用'}>
          <Button
            type="primary"
            size="mini"
            disabled={!isOnline}
            icon={<IconLaunch />}
          >
            {isComingSoon ? '即将上线' : '去使用'}
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
