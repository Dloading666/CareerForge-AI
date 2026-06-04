import {
  Alert,
  Button,
  Card,
  Checkbox,
  Drawer,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tabs,
} from '@arco-design/web-react'
import {
  IconApps,
  IconDashboard,
  IconExperiment,
  IconHistory,
  IconNotification,
  IconPlus,
  IconPoweroff,
  IconRobot,
  IconSafe,
  IconSettings,
  IconUser,
} from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'

import { apiRequest, ApiError } from '../shared/api'
import { useAuth } from '../shared/auth'
import { ModelPlaza } from './ModelPlaza'
import { SystemSettings } from './SystemSettings'

type NavKey = 'agents' | 'master' | 'models' | 'mcp' | 'skills' | 'knowledge' | 'settings'
type DrawerMode = 'agent' | 'master' | 'model' | 'mcp' | 'skill' | 'knowledge'
type SkillStatus = 'enabled' | 'disabled'

type SkillRecord = {
  id: number
  slug: string
  name: string
  description: string
  version: string
  category: string
  tags: string[]
  status: SkillStatus
  file_name: string
  content: string
  content_hash: string
  created_at: string
  updated_at: string
}

type SkillDraft = {
  name: string
  description: string
  version: string
  category: string
  tagsText: string
  status: SkillStatus
  fileName: string
  content: string
}

const MODELS = [
  {
    name: 'DeepSeek V3',
    id: 'deepseek-chat',
    host: 'api.deepseek.com/v1',
    latency: 380,
    latencyColor: '#00b42a',
    provider: 'DeepSeek',
    location: '云端',
    protocols: ['OpenAI'],
    enabled: true,
  },
  {
    name: 'GPT-4o Mini',
    id: 'gpt-4o-mini',
    host: 'api.openai.com/v1',
    latency: 850,
    latencyColor: '#ff7d00',
    provider: 'OpenAI',
    location: '云端',
    protocols: ['OpenAI'],
    enabled: true,
  },
  {
    name: 'Claude 3.5 Sonnet',
    id: 'claude-3-5-sonnet',
    host: 'api.anthropic.com/v1',
    latency: 1200,
    latencyColor: '#f53f3f',
    provider: 'Anthropic',
    location: '云端',
    protocols: ['Anthropic'],
    enabled: false,
  },
]

const AGENTS = [
  {
    id: 'interview',
    name: 'AI 面试官',
    desc: '模拟真实面试追问，生成逐题点评与复盘报告。',
    status: '已发布',
    iconTone: 'blue',
    skills: ['面试全流程分析', '能力画像'],
    mcps: ['就业日历 MCP'],
    kbs: ['面试题库'],
    models: ['DeepSeek V3', 'GPT-4o Mini'],
    callable: true,
    route: '模拟面试 / 面试复盘',
  },
  {
    id: 'matching',
    name: '岗位匹配',
    desc: '对简历与 JD 进行双向匹配，解释技能差距和提升路径。',
    status: '已发布',
    iconTone: 'green',
    skills: ['岗位匹配打分', '简历解析'],
    mcps: ['岗位检索 MCP'],
    kbs: ['岗位库', '企业资料库'],
    models: ['DeepSeek V3'],
    callable: true,
    route: '岗位匹配 / JD 分析',
  },
  {
    id: 'resume',
    name: '简历优化',
    desc: '基于岗位目标重写项目经历，补齐 STAR 结构与量化表达。',
    status: '草稿',
    iconTone: 'orange',
    skills: ['简历全生命周期处理'],
    mcps: ['网页抓取 MCP'],
    kbs: ['简历范例库'],
    models: ['GPT-4o Mini'],
    callable: false,
    route: '简历建议 / 项目经历',
  },
]

const MCP_SERVICES = [
  {
    name: '岗位数据检索 MCP',
    transport: 'Streamable HTTP',
    endpoint: 'https://jobs-api.local/mcp',
    status: '已连接',
    tools: ['search_jobs', 'read_job_detail', 'compare_salary'],
    usedBy: 2,
    latency: '146ms',
  },
  {
    name: '就业日历 MCP',
    transport: 'SSE',
    endpoint: 'https://calendar.local/events',
    status: '已连接',
    tools: ['get_events', 'create_reminder'],
    usedBy: 1,
    latency: '98ms',
  },
  {
    name: '网页抓取 MCP',
    transport: 'stdio',
    endpoint: 'node crawler-mcp/server.js',
    status: '异常',
    tools: ['fetch_page', 'extract_links'],
    usedBy: 1,
    latency: '超时',
  },
]

const DEFAULT_SKILL_CONTENT = `---
name: 简历亮点提炼
description: 从学生简历中提炼可用于求职沟通的项目亮点、量化成果和风险点。
version: 1.0.0
category: 简历
tags: 简历, 项目经历, STAR
---

# 简历亮点提炼

## 适用场景
当主 Agent 或子 Agent 需要帮助学生把经历改写成更清晰的求职表达时，使用这个 Skill。

## 输入
- 学生原始简历或项目经历
- 目标岗位或 JD，可选

## 工作步骤
1. 识别经历中的任务、行动、结果和量化证据。
2. 判断表达是否存在空泛、夸大、缺少上下文的问题。
3. 输出 3-5 条更适合投递或面试使用的亮点表达。

## 输出格式
- 亮点标题
- 改写后的表达
- 可追问证据
- 风险提醒
`

const KNOWLEDGE_BASES = [
  {
    name: '就业政策知识库',
    docs: 128,
    chunks: '12.4k',
    vectorStatus: '已向量化',
    authorized: ['主智能体', '就业问答'],
    update: '今天 10:24',
    progress: 100,
  },
  {
    name: '岗位库',
    docs: 864,
    chunks: '38.9k',
    vectorStatus: '同步中',
    authorized: ['主智能体', '岗位匹配'],
    update: '今天 09:12',
    progress: 72,
  },
  {
    name: '面试题库',
    docs: 312,
    chunks: '18.1k',
    vectorStatus: '已向量化',
    authorized: ['AI 面试官'],
    update: '昨天 18:40',
    progress: 100,
  },
]

const ROUTES = [
  { intent: '模拟面试 / 面试复盘', agent: 'AI 面试官', memory: '独立线程，仅回传结果摘要' },
  { intent: '岗位匹配 / JD 分析', agent: '岗位匹配', memory: '独立线程，仅回传匹配报告' },
  { intent: '简历建议 / 项目经历', agent: '简历优化', memory: '草稿期，暂不对学生开放' },
]

const pageMeta: Record<NavKey, { title: string; desc: string; action: string; drawer: DrawerMode }> = {
  agents: {
    title: '智能体管理',
    desc: '组装子智能体的模型范围、Skills、MCP 与专属知识库，并控制是否允许被主智能体调用。',
    action: '新建智能体',
    drawer: 'agent',
  },
  master: {
    title: '主智能体配置',
    desc: '配置就业总助手的默认模型、系统提示词、全量能力范围、路由策略和记忆隔离规则。',
    action: '编辑配置',
    drawer: 'master',
  },
  models: {
    title: '模型广场',
    desc: '接入、测速并控制哪些模型允许学生端和智能体调用。',
    action: '添加模型',
    drawer: 'model',
  },
  mcp: {
    title: 'MCP 广场',
    desc: '接入外部工具和数据服务，测试连接并查看暴露工具。',
    action: '添加 MCP 服务',
    drawer: 'mcp',
  },
  skills: {
    title: 'Skills 广场',
    desc: '管理可复用原子能力，作为智能体装配时的技能池。',
    action: '新建 Skill',
    drawer: 'skill',
  },
  knowledge: {
    title: '知识库',
    desc: '上传文档、解析切片、向量化，并按智能体授权检索范围。',
    action: '新建知识库',
    drawer: 'knowledge',
  },
  settings: {
    title: '系统设置',
    desc: '管理账号、权限和平台运行偏好。',
    action: '保存设置',
    drawer: 'master',
  },
}

function createEmptySkillDraft(): SkillDraft {
  return {
    name: '',
    description: '',
    version: '1.0.0',
    category: '通用',
    tagsText: '',
    status: 'enabled',
    fileName: 'SKILL.md',
    content: DEFAULT_SKILL_CONTENT,
  }
}

function skillToDraft(skill: SkillRecord): SkillDraft {
  return {
    name: skill.name,
    description: skill.description,
    version: skill.version,
    category: skill.category,
    tagsText: skill.tags.join(', '),
    status: skill.status,
    fileName: skill.file_name,
    content: skill.content,
  }
}

function splitTags(tagsText: string) {
  return tagsText
    .split(/[,，\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function skillDraftPayload(draft: SkillDraft) {
  return {
    name: draft.name.trim() || undefined,
    description: draft.description.trim() || undefined,
    version: draft.version.trim() || undefined,
    category: draft.category.trim() || undefined,
    tags: splitTags(draft.tagsText),
    status: draft.status,
    file_name: draft.fileName.trim() || 'SKILL.md',
    content: draft.content,
  }
}

export function AdminHomePage() {
  const { session, logout } = useAuth()
  const displayName = (session?.profile.display_name as string) || '平台管理员'
  const email = (session?.profile.email as string) || ''
  const [activeNav, setActiveNav] = useState<NavKey>('agents')
  const [activeAgent, setActiveAgent] = useState(AGENTS[0].id)
  const [skillFilter, setSkillFilter] = useState('all')
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [skillsLoading, setSkillsLoading] = useState(false)
  const [skillSaving, setSkillSaving] = useState(false)
  const [editingSkillId, setEditingSkillId] = useState<number | null>(null)
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(() => createEmptySkillDraft())
  const [adminFeedback, setAdminFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    content: string
  } | null>(null)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('agent')
  const [drawerVisible, setDrawerVisible] = useState(false)

  const meta = pageMeta[activeNav]
  const selectedAgent = AGENTS.find((agent) => agent.id === activeAgent) ?? AGENTS[0]
  const skillCategories = useMemo(
    () => Array.from(new Set(skills.map((skill) => skill.category).filter(Boolean))),
    [skills],
  )
  const filteredSkills = useMemo(
    () => (skillFilter === 'all' ? skills : skills.filter((skill) => skill.category === skillFilter)),
    [skillFilter, skills],
  )
  const skillNameOptions = useMemo(
    () =>
      skills.length > 0
        ? skills.map((skill) => skill.name)
        : Array.from(new Set(AGENTS.flatMap((agent) => agent.skills))),
    [skills],
  )

  const navItems: { key: NavKey; icon: React.ReactNode; label: string }[] = [
    { key: 'agents', icon: <IconRobot />, label: '智能体管理' },
    { key: 'master', icon: <IconDashboard />, label: '主智能体配置' },
    { key: 'models', icon: <IconExperiment />, label: '模型广场' },
    { key: 'mcp', icon: <IconSafe />, label: 'MCP 广场' },
    { key: 'skills', icon: <IconApps />, label: 'Skills 广场' },
    { key: 'knowledge', icon: <IconHistory />, label: '知识库' },
    { key: 'settings', icon: <IconSettings />, label: '系统设置' },
  ]

  function openDrawer(mode: DrawerMode = meta.drawer) {
    if (mode === 'skill') {
      setEditingSkillId(null)
      setSkillDraft(createEmptySkillDraft())
    }
    setDrawerMode(mode)
    setDrawerVisible(true)
  }

  useEffect(() => {
    if (session?.role !== 'admin' || !session.access) {
      return
    }

    let alive = true
    async function loadSkills() {
      setSkillsLoading(true)
      try {
        const data = await apiRequest<SkillRecord[]>('/api/v1/admin/skills', {
          headers: {
            Authorization: `Bearer ${session?.access}`,
          },
        })
        if (alive) {
          setSkills(data)
        }
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '加载 Skills 失败'
        if (alive) {
          setAdminFeedback({ type: 'error', content: message })
        }
      } finally {
        if (alive) {
          setSkillsLoading(false)
        }
      }
    }

    loadSkills()
    return () => {
      alive = false
    }
  }, [session?.access, session?.role])

  function authHeaders() {
    return {
      Authorization: `Bearer ${session?.access ?? ''}`,
    }
  }

  function editSkill(skill: SkillRecord) {
    setEditingSkillId(skill.id)
    setSkillDraft(skillToDraft(skill))
    setDrawerMode('skill')
    setDrawerVisible(true)
  }

  async function saveSkill() {
    if (!skillDraft.content.trim()) {
      setAdminFeedback({ type: 'warning', content: '请先填写或上传 Skill 文件内容' })
      return
    }

    setSkillSaving(true)
    try {
      const path = editingSkillId ? `/api/v1/admin/skills/${editingSkillId}` : '/api/v1/admin/skills'
      const saved = await apiRequest<SkillRecord>(path, {
        method: editingSkillId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(skillDraftPayload(skillDraft)),
      })
      setSkills((current) =>
        editingSkillId ? current.map((skill) => (skill.id === saved.id ? saved : skill)) : [saved, ...current],
      )
      setAdminFeedback({
        type: 'success',
        content: editingSkillId ? 'Skill 文件已更新' : 'Skill 已添加到广场',
      })
      setDrawerVisible(false)
      setEditingSkillId(null)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '保存 Skill 失败'
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setSkillSaving(false)
    }
  }

  async function toggleSkillStatus(skill: SkillRecord) {
    const nextStatus: SkillStatus = skill.status === 'enabled' ? 'disabled' : 'enabled'
    try {
      const saved = await apiRequest<SkillRecord>(`/api/v1/admin/skills/${skill.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: nextStatus }),
      })
      setSkills((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setAdminFeedback({ type: 'success', content: nextStatus === 'enabled' ? 'Skill 已启用' : 'Skill 已停用' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '更新 Skill 状态失败'
      setAdminFeedback({ type: 'error', content: message })
    }
  }

  async function deleteSkillById(skill: SkillRecord) {
    try {
      await apiRequest(`/api/v1/admin/skills/${skill.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      setSkills((current) => current.filter((item) => item.id !== skill.id))
      setAdminFeedback({ type: 'success', content: 'Skill 已从广场移除' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '删除 Skill 失败'
      setAdminFeedback({ type: 'error', content: message })
    }
  }

  return (
    <div className="app-shell admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-badge">管</span>
          <div>
            <h1>智培职联</h1>
            <p>Admin Console</p>
          </div>
        </div>

        <div className="admin-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button
              key={key}
              className="admin-nav-item"
              type={activeNav === key ? 'primary' : 'text'}
              icon={icon}
              onClick={() => setActiveNav(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="admin-sidebar-status">
          <span className="status-dot" />
          <span>本地大模型 · 在线</span>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <strong>智培职联 AI Platform</strong>
          <div className="admin-topbar-actions">
            <Input className="admin-search" placeholder="Search..." allowClear />
            <Button icon={<IconNotification />} type="text" />
            <Button icon={<IconSettings />} type="text" />
            <div className="admin-avatar">
              <IconUser />
            </div>
          </div>
        </header>

        <main className="admin-page">
          <div className="admin-page-head">
            <div>
              <div className="admin-eyebrow">CONTROL CENTER</div>
              <h2>{meta.title}</h2>
              <p>{meta.desc}</p>
            </div>
            <Button icon={<IconPlus />} type="primary" onClick={() => openDrawer()}>
              {meta.action}
            </Button>
          </div>

          {adminFeedback ? (
            <Alert
              className="admin-feedback"
              type={adminFeedback.type}
              content={adminFeedback.content}
              closable
              showIcon
              onClose={() => setAdminFeedback(null)}
            />
          ) : null}

          {activeNav === 'agents' ? renderAgentsPage(selectedAgent, setActiveAgent, openDrawer) : null}
          {activeNav === 'master' ? renderMasterPage(openDrawer) : null}
          {activeNav === 'models' ? <ModelPlaza /> : null}
          {activeNav === 'mcp' ? renderMcpPage(openDrawer) : null}
          {activeNav === 'skills'
            ? renderSkillsPage({
                skillFilter,
                setSkillFilter,
                categories: skillCategories,
                filteredSkills,
                loading: skillsLoading,
                openDrawer,
                onEdit: editSkill,
                onToggleStatus: toggleSkillStatus,
                onDelete: deleteSkillById,
              })
            : null}
          {activeNav === 'knowledge' ? renderKnowledgePage(openDrawer) : null}
          {activeNav === 'settings' ? renderSettingsPage(displayName, email, logout) : null}
        </main>
      </section>

      <AdminConfigDrawer
        mode={drawerMode}
        visible={drawerVisible}
        selectedAgent={selectedAgent}
        skillNames={skillNameOptions}
        skillDraft={skillDraft}
        editingSkillId={editingSkillId}
        skillSaving={skillSaving}
        onSkillDraftChange={(patch) => setSkillDraft((current) => ({ ...current, ...patch }))}
        onSkillFileUpload={(fileName, content) =>
          setSkillDraft((current) => ({
            ...current,
            fileName,
            content,
          }))
        }
        onSaveSkill={saveSkill}
        onClose={() => setDrawerVisible(false)}
      />
    </div>
  )
}

function renderAgentsPage(
  selectedAgent: (typeof AGENTS)[number],
  setActiveAgent: (id: string) => void,
  openDrawer: (mode: DrawerMode) => void,
) {
  return (
    <div className="admin-layout-grid">
      <section className="admin-card-grid">
        {AGENTS.map((agent) => (
          <Card
            key={agent.id}
            className={`admin-card agent-card ${selectedAgent.id === agent.id ? 'is-selected' : ''}`}
            hoverable
            onClick={() => setActiveAgent(agent.id)}
          >
            <div className="agent-card-head">
              <span className={`resource-icon ${agent.iconTone}`}>
                <IconRobot />
              </span>
              <div>
                <h3>{agent.name}</h3>
                <Tag color={agent.status === '已发布' ? 'green' : 'orange'}>{agent.status}</Tag>
              </div>
            </div>
            <p>{agent.desc}</p>
            <div className="ability-summary">
              <span>{agent.models.length} 模型</span>
              <span>{agent.skills.length} Skills</span>
              <span>{agent.mcps.length} MCP</span>
              <span>{agent.kbs.length} 知识库</span>
            </div>
            <div className="admin-card-footer">
              <Tag bordered color={agent.callable ? 'arcoblue' : 'gray'}>
                {agent.callable ? '允许主智能体调用' : '仅草稿配置'}
              </Tag>
              <Button type="text" size="small" onClick={() => openDrawer('agent')}>
                配置能力
              </Button>
            </div>
          </Card>
        ))}
      </section>

      <aside className="admin-detail-panel">
        <div className="detail-panel-head">
          <span className={`resource-icon ${selectedAgent.iconTone}`}>
            <IconRobot />
          </span>
          <div>
            <h3>{selectedAgent.name}</h3>
            <p>{selectedAgent.route}</p>
          </div>
        </div>
        <div className="binding-block">
          <h4>执行绑定</h4>
          <div className="binding-row">
            <span>Dify / LangGraph</span>
            <strong>{selectedAgent.id === 'matching' ? 'job_match_graph_v1' : `${selectedAgent.id}_agent_v1`}</strong>
          </div>
          <div className="binding-row">
            <span>默认模型</span>
            <strong>{selectedAgent.models[0]}</strong>
          </div>
        </div>
        <AbilityChips title="模型范围" items={selectedAgent.models} />
        <AbilityChips title="编排的 Skills" items={selectedAgent.skills} />
        <AbilityChips title="授权 MCP 工具" items={selectedAgent.mcps} />
        <AbilityChips title="专属知识库" items={selectedAgent.kbs} />
      </aside>
    </div>
  )
}

function renderMasterPage(openDrawer: (mode: DrawerMode) => void) {
  return (
    <div className="master-grid">
      <section className="master-config-panel">
        <div className="admin-section-title">
          <h3>全局编排者</h3>
          <p>主智能体默认拥有全量能力，但可以在这里收窄访问范围。</p>
        </div>
        <div className="form-surface">
          <label>
            默认模型
            <Select defaultValue="DeepSeek V3">
              {MODELS.filter((model) => model.enabled).map((model) => (
                <Select.Option key={model.name} value={model.name}>
                  {model.name}
                </Select.Option>
              ))}
            </Select>
          </label>
          <label>
            系统提示词
            <Input.TextArea
              defaultValue="你是智培职联就业总助手，负责路由子智能体、调用工具和知识库，并以清晰、可执行的建议帮助学生完成求职准备。"
              autoSize={{ minRows: 4, maxRows: 6 }}
            />
          </label>
          <div className="switch-list">
            <Switch defaultChecked />
            <span>模型切换后同步传递给被调用的子智能体</span>
          </div>
          <div className="switch-list">
            <Switch defaultChecked />
            <span>子智能体记忆独立隔离，仅结果摘要回流主对话</span>
          </div>
          <Button type="primary" onClick={() => openDrawer('master')}>
            保存编排配置
          </Button>
        </div>
      </section>

      <section className="route-panel">
        <div className="admin-section-title">
          <h3>路由策略</h3>
          <p>当学生意图命中时，主智能体将派发给对应子智能体。</p>
        </div>
        <div className="route-list">
          {ROUTES.map((route) => (
            <div key={route.intent} className="route-row">
              <div>
                <strong>{route.intent}</strong>
                <p>{route.memory}</p>
              </div>
              <Tag color={route.agent === '简历优化' ? 'orange' : 'arcoblue'}>{route.agent}</Tag>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function renderMcpPage(openDrawer: (mode: DrawerMode) => void) {
  return (
    <div className="admin-card-grid">
      {MCP_SERVICES.map((service) => (
        <Card key={service.name} className="admin-card mcp-card" hoverable>
          <div className="agent-card-head">
            <span className={`resource-icon ${service.status === '已连接' ? 'green' : 'orange'}`}>
              <IconSafe />
            </span>
            <div>
              <h3>{service.name}</h3>
              <Tag color={service.status === '已连接' ? 'green' : 'red'}>{service.status}</Tag>
            </div>
          </div>
          <div className="meta-list">
            <span>传输方式：{service.transport}</span>
            <span>Endpoint：{service.endpoint}</span>
            <span>测试延迟：{service.latency}</span>
          </div>
          <AbilityChips title={`${service.tools.length} tools`} items={service.tools} compact />
          <div className="admin-card-footer">
            <Tag bordered>被 {service.usedBy} 个智能体引用</Tag>
            <Button type="text" size="small">
              测试连接
            </Button>
          </div>
        </Card>
      ))}
      <button className="admin-add-card" type="button" onClick={() => openDrawer('mcp')}>
        <IconPlus />
        <strong>添加 MCP 服务</strong>
        <span>stdio / SSE / Streamable HTTP</span>
      </button>
    </div>
  )
}

function renderSkillsPage({
  skillFilter,
  setSkillFilter,
  categories,
  filteredSkills,
  loading,
  openDrawer,
  onEdit,
  onToggleStatus,
  onDelete,
}: {
  skillFilter: string
  setSkillFilter: (category: string) => void
  categories: string[]
  filteredSkills: SkillRecord[]
  loading: boolean
  openDrawer: (mode: DrawerMode) => void
  onEdit: (skill: SkillRecord) => void
  onToggleStatus: (skill: SkillRecord) => void
  onDelete: (skill: SkillRecord) => void
}) {
  return (
    <>
      <Tabs activeTab={skillFilter} onChange={setSkillFilter} className="admin-tabs">
        <Tabs.TabPane key="all" title="全部" />
        {categories.map((category) => (
          <Tabs.TabPane key={category} title={category} />
        ))}
      </Tabs>
      <div className="admin-card-grid">
        {loading ? (
          <Card className="admin-card skill-card">
            <div className="agent-card-head">
              <span className="resource-icon purple">
                <IconApps />
              </span>
              <div>
                <h3>正在加载 Skills</h3>
                <Tag color="arcoblue">File Based</Tag>
              </div>
            </div>
            <p>正在从后端读取 Skill 文件资产。</p>
          </Card>
        ) : null}
        {filteredSkills.map((skill) => (
          <Card key={skill.id} className="admin-card skill-card" hoverable>
            <div className="agent-card-head">
              <span className="resource-icon purple">
                <IconApps />
              </span>
              <div>
                <h3>{skill.name}</h3>
                <Tag color="arcoblue">{skill.file_name}</Tag>
              </div>
            </div>
            <p>{skill.description || '这个 Skill 暂未填写说明，Agent 会直接按文件内容使用。'}</p>
            <div className="meta-list">
              <span>分类：{skill.category}</span>
              <span>版本：{skill.version}</span>
              <span>Slug：{skill.slug}</span>
              <span>Hash：{skill.content_hash.slice(0, 12)}</span>
            </div>
            {skill.tags.length > 0 ? <AbilityChips title="标签" items={skill.tags} compact /> : null}
            <div className="admin-card-footer">
              <Tag color={skill.status === 'enabled' ? 'green' : 'gray'}>
                {skill.status === 'enabled' ? '启用' : '停用'}
              </Tag>
              <Space size={4}>
                <Button type="text" size="small" onClick={() => onEdit(skill)}>
                  编辑文件
                </Button>
                <Button type="text" size="small" onClick={() => onToggleStatus(skill)}>
                  {skill.status === 'enabled' ? '停用' : '启用'}
                </Button>
                <Popconfirm title="确定删除这个 Skill 吗？" okText="删除" cancelText="取消" onOk={() => onDelete(skill)}>
                  <Button type="text" status="danger" size="small">
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            </div>
          </Card>
        ))}
        {!loading && filteredSkills.length === 0 ? (
          <Card className="admin-card skill-card">
            <div className="agent-card-head">
              <span className="resource-icon purple">
                <IconApps />
              </span>
              <div>
                <h3>还没有 Skill 文件</h3>
                <Tag color="orange">等待添加</Tag>
              </div>
            </div>
            <p>可以上传或粘贴 Skill 文件，启用后会进入可复用能力池。</p>
          </Card>
        ) : null}
        <button className="admin-add-card" type="button" onClick={() => openDrawer('skill')}>
          <IconPlus />
          <strong>添加 Skill 文件</strong>
          <span>上传或粘贴 SKILL.md / .txt</span>
        </button>
      </div>
    </>
  )
}

function renderKnowledgePage(openDrawer: (mode: DrawerMode) => void) {
  return (
    <section className="kb-list">
      {KNOWLEDGE_BASES.map((kb) => (
        <div key={kb.name} className="kb-row">
          <div className="kb-name-cell">
            <span className="resource-icon cyan">
              <IconHistory />
            </span>
            <div>
              <h3>{kb.name}</h3>
              <p>{kb.docs} 文档 · {kb.chunks} chunks · 更新 {kb.update}</p>
            </div>
          </div>
          <div className="kb-progress">
            <span>{kb.vectorStatus}</span>
            <div className="progress-track">
              <i style={{ width: `${kb.progress}%` }} />
            </div>
          </div>
          <div className="tag-row">
            {kb.authorized.map((item) => (
              <Tag key={item} color="arcoblue" bordered>
                {item}
              </Tag>
            ))}
          </div>
          <Button type="text" onClick={() => openDrawer('knowledge')}>
            授权配置
          </Button>
        </div>
      ))}
      <button className="kb-add-row" type="button" onClick={() => openDrawer('knowledge')}>
        <IconPlus />
        <span>新建知识库 / 上传文档</span>
      </button>
    </section>
  )
}

function renderSettingsPage(displayName: string, email: string, logout: () => void) {
  return (
    <div className="settings-grid">
      <section className="form-surface">
        <div className="admin-section-title">
          <h3>账号信息</h3>
          <p>当前登录管理员信息。</p>
        </div>
        <div className="setting-field">
          <span>当前账号</span>
          <strong>{displayName}</strong>
        </div>
        <div className="setting-field">
          <span>邮箱</span>
          <strong>{email || '未绑定'}</strong>
        </div>
      </section>
      <section className="form-surface">
        <div className="admin-section-title">
          <h3>运行偏好</h3>
          <p>保留给权限、审计、计费与安全策略。</p>
        </div>
        <div className="switch-list">
          <Switch defaultChecked />
          <span>启用管理端操作审计</span>
        </div>
        <div className="switch-list">
          <Switch defaultChecked />
          <span>能力资源异常时通知管理员</span>
        </div>
        <Popconfirm title="确定要退出登录吗？" okText="退出" cancelText="取消" onOk={logout}>
          <Button type="outline" status="danger" icon={<IconPoweroff />}>
            退出登录
          </Button>
        </Popconfirm>
      </section>
      <SystemSettings />
    </div>
  )
}

function AbilityChips({ title, items, compact = false }: { title: string; items: string[]; compact?: boolean }) {
  return (
    <div className={compact ? 'ability-chips is-compact' : 'ability-chips'}>
      <span>{title}</span>
      <div>
        {items.map((item) => (
          <Tag key={item} bordered>
            {item}
          </Tag>
        ))}
      </div>
    </div>
  )
}

function AdminConfigDrawer({
  mode,
  visible,
  selectedAgent,
  skillNames,
  skillDraft,
  editingSkillId,
  skillSaving,
  onSkillDraftChange,
  onSkillFileUpload,
  onSaveSkill,
  onClose,
}: {
  mode: DrawerMode
  visible: boolean
  selectedAgent: (typeof AGENTS)[number]
  skillNames: string[]
  skillDraft: SkillDraft
  editingSkillId: number | null
  skillSaving: boolean
  onSkillDraftChange: (patch: Partial<SkillDraft>) => void
  onSkillFileUpload: (fileName: string, content: string) => void
  onSaveSkill: () => void
  onClose: () => void
}) {
  const titleMap: Record<DrawerMode, string> = {
    agent: `配置智能体 · ${selectedAgent.name}`,
    master: '编辑主智能体配置',
    model: '添加模型',
    mcp: '添加 MCP 服务',
    skill: editingSkillId ? '编辑 Skill 文件' : '添加 Skill 文件',
    knowledge: '新建知识库',
  }

  return (
    <Drawer
      className="admin-config-drawer"
      title={titleMap[mode]}
      visible={visible}
      width={560}
      onCancel={onClose}
      footer={
        <div className="drawer-footer">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={mode === 'skill' ? skillSaving : false} onClick={mode === 'skill' ? onSaveSkill : onClose}>
            保存
          </Button>
        </div>
      }
    >
      {mode === 'agent' ? <AgentDrawerContent agent={selectedAgent} skillNames={skillNames} /> : null}
      {mode === 'master' ? <MasterDrawerContent /> : null}
      {mode === 'model' ? <ModelDrawerContent /> : null}
      {mode === 'mcp' ? <McpDrawerContent /> : null}
      {mode === 'skill' ? (
        <SkillDrawerContent draft={skillDraft} onChange={onSkillDraftChange} onFileUpload={onSkillFileUpload} />
      ) : null}
      {mode === 'knowledge' ? <KnowledgeDrawerContent /> : null}
    </Drawer>
  )
}

function AgentDrawerContent({ agent, skillNames }: { agent: (typeof AGENTS)[number]; skillNames: string[] }) {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Input defaultValue={agent.name} addBefore="名称" />
      <Input.TextArea defaultValue={agent.desc} autoSize={{ minRows: 3, maxRows: 4 }} />
      <Select mode="multiple" defaultValue={agent.models} placeholder="可用模型范围">
        {MODELS.map((model) => (
          <Select.Option key={model.name} value={model.name}>
            {model.name}
          </Select.Option>
        ))}
      </Select>
      <Checkbox.Group defaultValue={agent.skills} options={skillNames} />
      <Checkbox.Group defaultValue={agent.mcps} options={MCP_SERVICES.map((service) => service.name)} />
      <Checkbox.Group defaultValue={agent.kbs} options={KNOWLEDGE_BASES.map((kb) => kb.name)} />
      <div className="switch-list">
        <Switch defaultChecked={agent.callable} />
        <span>允许被主智能体调用</span>
      </div>
      <div className="switch-list">
        <Switch defaultChecked={agent.status === '已发布'} />
        <span>发布到学生端智能体广场</span>
      </div>
    </Space>
  )
}

function MasterDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Select defaultValue="DeepSeek V3" placeholder="默认模型">
        {MODELS.filter((model) => model.enabled).map((model) => (
          <Select.Option key={model.name} value={model.name}>
            {model.name}
          </Select.Option>
        ))}
      </Select>
      <Input.TextArea
        defaultValue="主智能体负责总控、路由、兜底问答和结果汇总。调用子智能体时传递当前模型，但保持会话记忆隔离。"
        autoSize={{ minRows: 5, maxRows: 8 }}
      />
      <Checkbox.Group
        defaultValue={['全部 Skills', '全部 MCP', '全部知识库']}
        options={['全部 Skills', '全部 MCP', '全部知识库']}
      />
    </Space>
  )
}

function ModelDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Select defaultValue="DeepSeek" placeholder="模型供应商">
        {['DeepSeek', 'OpenAI 兼容', 'Anthropic', 'Ollama·本地', '自定义'].map((item) => (
          <Select.Option key={item} value={item}>
            {item}
          </Select.Option>
        ))}
      </Select>
      <Input defaultValue="DeepSeek 对话-生产" addBefore="显示名称" />
      <Input defaultValue="https://api.deepseek.com/v1" addBefore="Base URL" />
      <Input.Password defaultValue="sk-0000000000000000" addBefore="API Key" />
      <Input defaultValue="deepseek-chat" addBefore="模型标识" />
      <div className="test-result success">连接成功 · 延迟 420ms · 模型已就绪</div>
      <div className="switch-list">
        <Switch defaultChecked />
        <span>对学生开放</span>
      </div>
    </Space>
  )
}

function McpDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Input defaultValue="岗位数据检索 MCP" addBefore="名称" />
      <Select defaultValue="Streamable HTTP" placeholder="传输方式">
        {['stdio', 'SSE', 'Streamable HTTP'].map((item) => (
          <Select.Option key={item} value={item}>
            {item}
          </Select.Option>
        ))}
      </Select>
      <Input defaultValue="https://jobs-api.local/mcp" addBefore="命令或 URL" />
      <Input defaultValue="Authorization: Bearer ${JOB_MCP_TOKEN}" addBefore="鉴权" />
      <div className="test-result success">发现 3 个工具：search_jobs / read_job_detail / compare_salary</div>
      <div className="switch-list">
        <Switch defaultChecked />
        <span>启用服务</span>
      </div>
    </Space>
  )
}

function SkillDrawerContent({
  draft,
  onChange,
  onFileUpload,
}: {
  draft: SkillDraft
  onChange: (patch: Partial<SkillDraft>) => void
  onFileUpload: (fileName: string, content: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }
    const content = await file.text()
    onFileUpload(file.name, content)
    event.target.value = ''
  }

  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <div className="skill-file-tools">
        <div>
          <strong>文件化 Skill</strong>
          <p>上传 SKILL.md 文件，或直接编辑下方内容。</p>
        </div>
        <Button type="outline" onClick={() => fileInputRef.current?.click()}>
          上传文件
        </Button>
        <input ref={fileInputRef} type="file" accept=".md,.txt" hidden onChange={handleFileChange} />
      </div>
      <div className="skill-editor-meta">
        <Input value={draft.name} addBefore="Skill 名称" placeholder="留空则从文件解析" onChange={(value) => onChange({ name: value })} />
        <Input value={draft.category} addBefore="分类" placeholder="例如：简历 / 求职 / 面试" onChange={(value) => onChange({ category: value })} />
        <Input value={draft.version} addBefore="版本" placeholder="1.0.0" onChange={(value) => onChange({ version: value })} />
      </div>
      <Input.TextArea
        value={draft.description}
        placeholder="一句话说明这个 Skill 能做什么；也可留空，从 frontmatter 解析"
        autoSize={{ minRows: 3, maxRows: 4 }}
        onChange={(value) => onChange({ description: value })}
      />
      <Input value={draft.tagsText} addBefore="标签" placeholder="用逗号分隔，例如：简历, STAR, 评分" onChange={(value) => onChange({ tagsText: value })} />
      <Input value={draft.fileName} addBefore="文件名" placeholder="SKILL.md" onChange={(value) => onChange({ fileName: value })} />
      <Input.TextArea
        className="skill-code-editor"
        value={draft.content}
        placeholder="在这里粘贴 SKILL.md 内容"
        autoSize={{ minRows: 14, maxRows: 22 }}
        onChange={(value) => onChange({ content: value })}
      />
      <div className="switch-list">
        <Switch checked={draft.status === 'enabled'} onChange={(checked) => onChange({ status: checked ? 'enabled' : 'disabled' })} />
        <span>启用 Skill</span>
      </div>
    </Space>
  )
}

function KnowledgeDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Input defaultValue="企业资料库" addBefore="知识库名称" />
      <Input.TextArea placeholder="描述知识库用途、数据来源与更新节奏" autoSize={{ minRows: 3, maxRows: 4 }} />
      <Checkbox.Group defaultValue={['主智能体']} options={['主智能体', ...AGENTS.map((agent) => agent.name)]} />
      <div className="upload-dropzone">
        <IconPlus />
        <span>拖拽或点击上传文档，随后进行解析、切片与向量化</span>
      </div>
      <div className="switch-list">
        <Switch defaultChecked />
        <span>允许主智能体按需访问已授权内容</span>
      </div>
    </Space>
  )
}
