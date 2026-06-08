import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Drawer,
  Dropdown,
  Input,
  Menu,
  Message,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tabs,
  Upload,
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
import { AgentManagementPage } from './AgentManagementPage'
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

type AgentOption = {
  id: string
  name: string
  status?: string
  kind?: string
}
type AgentOptionsResponse = AgentOption[] | { items?: AgentOption[]; records?: AgentOption[]; list?: AgentOption[] }
type McpCallDraft = {
  serviceId: number | null
  toolName: string
  agentId: string
  input: string
  result: string
}

type McpToolRecord = {
  id?: number
  name: string
  description: string
  risk: string
  input_schema?: Record<string, unknown>
  enabled: boolean
}

type McpServiceRecord = {
  id: number
  slug: string
  name: string
  description: string
  category: string
  transport: string
  endpoint: string
  auth_type: string
  auth_config: string
  owner: string
  version: string
  status: 'enabled' | 'disabled' | 'error'
  agent_ids: string[]
  auto_disable_on_error: boolean
  latency_ms: number | null
  success_rate: number | null
  last_checked_at: string | null
  tools: McpToolRecord[]
  created_at: string
  updated_at: string
}

type McpDraft = {
  name: string
  description: string
  category: string
  transport: string
  endpoint: string
  authType: string
  authConfig: string
  owner: string
  version: string
  status: 'enabled' | 'disabled' | 'error'
  agentIds: string[]
  autoDisableOnError: boolean
  tools: McpToolRecord[]
}

type McpCallLogRecord = {
  id: number
  service_id: number | null
  service_name: string
  tool_name: string
  agent_id: string
  agent_name: string
  request_text: string
  response: Record<string, unknown>
  success: boolean
  latency_ms: number | null
  error_message: string
  created_at: string
}

type ToolPoolItem = {
  name: string
  source: 'builtin' | 'skill' | 'mcp'
  provider: string
  priority: number
}

type ToolPoolResponse = {
  tools: ToolPoolItem[]
  collisions: Array<{ name: string; kept: string; removed: string }>
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
    mcps: [],
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
    mcps: [],
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
    mcps: [],
    kbs: ['简历范例库'],
    models: ['GPT-4o Mini'],
    callable: false,
    route: '简历建议 / 项目经历',
  },
]

const FALLBACK_AGENT_OPTIONS: AgentOption[] = [
  { id: 'master', name: '主智能体', status: '已启用', kind: 'master' },
  ...AGENTS.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    kind: 'agent',
  })),
]

function normalizeAgentOptions(payload: AgentOptionsResponse): AgentOption[] {
  const list = Array.isArray(payload) ? payload : payload.items ?? payload.records ?? payload.list ?? []
  return list
    .filter((agent) => agent.id && agent.name)
    .map((agent) => ({
      id: String(agent.id),
      name: agent.name,
      status: agent.status,
      kind: agent.kind,
    }))
}

async function fetchAgentOptions(access: string): Promise<AgentOption[]> {
  const paths = ['/api/v1/admin/agents/options', '/api/v1/admin/agents']

  for (const path of paths) {
    try {
      const data = await apiRequest<AgentOptionsResponse>(path, {
        headers: {
          Authorization: `Bearer ${access}`,
        },
      })
      const options = normalizeAgentOptions(data)
      if (options.length > 0) {
        return options
      }
    } catch {
      // The agent module may be developed independently. Keep the MCP form usable until the endpoint is ready.
    }
  }

  return FALLBACK_AGENT_OPTIONS
}

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

const pageMeta: Record<NavKey, { title: string; desc: string; action?: string; drawer: DrawerMode }> = {
  agents: {
    title: '智能体管理',
    desc: '组装子智能体的模型范围、Skills、MCP 与专属知识库，并控制是否允许被主智能体调用。',
    action: '新建智能体',
    drawer: 'agent',
  },
  master: {
    title: '主智能体配置',
    desc: '配置就业总助手的默认模型、系统提示词、全量能力范围、路由策略和记忆隔离规则。',
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
    desc: '统一接入外部工具和数据服务，管理鉴权、授权、工具暴露、健康检测与审计治理。',
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

function createEmptyMcpDraft(): McpDraft {
  return {
    name: '',
    description: '',
    category: '',
    transport: 'Streamable HTTP',
    endpoint: '',
    authType: '无鉴权',
    authConfig: '',
    owner: '',
    version: 'v1.0.0',
    status: 'enabled',
    agentIds: [],
    autoDisableOnError: true,
    tools: [],
  }
}

function mcpToDraft(service: McpServiceRecord): McpDraft {
  return {
    name: service.name,
    description: service.description,
    category: service.category,
    transport: service.transport,
    endpoint: service.endpoint,
    authType: service.auth_type,
    authConfig: service.auth_config,
    owner: service.owner,
    version: service.version,
    status: service.status,
    agentIds: service.agent_ids,
    autoDisableOnError: service.auto_disable_on_error,
    tools: service.tools.length > 0 ? service.tools : [],
  }
}

function mcpDraftPayload(draft: McpDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    category: draft.category.trim() || '通用',
    transport: draft.transport,
    endpoint: draft.endpoint.trim(),
    auth_type: draft.authType,
    auth_config: draft.authConfig.trim(),
    owner: draft.owner.trim(),
    version: draft.version.trim() || 'v1.0.0',
    status: draft.status,
    agent_ids: draft.agentIds,
    auto_disable_on_error: draft.autoDisableOnError,
    tools: draft.tools
      .filter((tool) => tool.name.trim())
      .map((tool) => ({
        name: tool.name.trim(),
        description: tool.description.trim(),
        risk: tool.risk || '低风险',
        input_schema: tool.input_schema ?? {},
        enabled: tool.enabled,
      })),
  }
}

function statusLabel(status: McpServiceRecord['status']) {
  const labels = { enabled: '已启用', disabled: '已停用', error: '异常' }
  return labels[status]
}

function statusColor(status: McpServiceRecord['status']) {
  if (status === 'enabled') return 'green'
  if (status === 'error') return 'red'
  return 'gray'
}

function formatDateTime(value: string | null) {
  if (!value) return '未检测'
  return new Date(value).toLocaleString('zh-CN', {
    hour12: false,
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function detailOwnerLabel(service: McpServiceRecord) {
  return service.owner ? `开发者：${service.owner}` : '未设置开发者'
}

export function AdminHomePage() {
  const { session, logout } = useAuth()
  const displayName = (session?.profile.display_name as string) || '平台管理员'
  const avatarUrl = (session?.profile.avatar_url as string) || ''
  const [avatarKey, setAvatarKey] = useState(0)
  const email = (session?.profile.email as string) || ''
  const [activeNav, setActiveNav] = useState<NavKey>('agents')
  
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
  const [mcpSearch, setMcpSearch] = useState('')
  const [mcpStatusFilter, setMcpStatusFilter] = useState('all')
  const [mcpCategoryFilter, setMcpCategoryFilter] = useState('all')
  const [mcpServiceTypeFilter, setMcpServiceTypeFilter] = useState<'all' | 'hosted' | 'local'>('all')
  const [mcps, setMcps] = useState<McpServiceRecord[]>([])
  const [mcpLogs, setMcpLogs] = useState<McpCallLogRecord[]>([])
  const [mcpToolPool, setMcpToolPool] = useState<ToolPoolResponse>({ tools: [], collisions: [] })
  const [mcpLoading, setMcpLoading] = useState(false)
  const [mcpSaving, setMcpSaving] = useState(false)
  const [editingMcpId, setEditingMcpId] = useState<number | null>(null)
  const [showMcpLogs, setShowMcpLogs] = useState(false)
  const [mcpDetailId, setMcpDetailId] = useState<number | null>(null)
  const [mcpDetailTab, setMcpDetailTab] = useState('detail')
  const [mcpDraft, setMcpDraft] = useState<McpDraft>(() => createEmptyMcpDraft())
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>(FALLBACK_AGENT_OPTIONS)
  const [agentOptionsLoading, setAgentOptionsLoading] = useState(false)
  const [mcpCallDraft, setMcpCallDraft] = useState<McpCallDraft>({
    serviceId: null,
    toolName: '',
    agentId: 'matching',
    input: '',
    result: '',
  })
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('agent')
  const [drawerVisible, setDrawerVisible] = useState(false)

  const meta = pageMeta[activeNav]
  const selectedAgent = AGENTS[0]
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
  const filteredMcps = useMemo(() => {
    const keyword = mcpSearch.trim().toLowerCase()
    return mcps.filter((service) => {
      const matchesKeyword =
        !keyword ||
        [
          service.name,
          service.description,
          service.endpoint,
          service.owner,
          service.category,
          ...service.tools.map((tool) => tool.name),
        ]
          .join(' ')
          .toLowerCase()
          .includes(keyword)
      const matchesStatus = mcpStatusFilter === 'all' || service.status === mcpStatusFilter
      const matchesCategory = mcpCategoryFilter === 'all' || service.category === mcpCategoryFilter
      const serviceType = service.transport === 'stdio' ? 'local' : 'hosted'
      const matchesServiceType = mcpServiceTypeFilter === 'all' || serviceType === mcpServiceTypeFilter
      return matchesKeyword && matchesStatus && matchesCategory && matchesServiceType
    })
  }, [mcpCategoryFilter, mcpSearch, mcpServiceTypeFilter, mcpStatusFilter, mcps])

  function patchMcpCallDraft(patch: Partial<McpCallDraft>) {
    setMcpCallDraft((current) => {
      const next = { ...current, ...patch }
      if (patch.serviceId) {
        const service = mcps.find((item) => item.id === patch.serviceId)
        next.toolName = service?.tools[0]?.name ?? ''
      }
      return { ...next, result: patch.result ?? '' }
    })
  }

  async function runMcpCall() {
    if (!mcpCallDraft.serviceId || !mcpCallDraft.toolName) {
      setAdminFeedback({ type: 'warning', content: '请先选择 MCP 服务和工具' })
      return
    }
    const agent = agentOptions.find((item) => item.id === mcpCallDraft.agentId)
    try {
      const log = await apiRequest<McpCallLogRecord>('/api/v1/admin/mcp-call', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          service_id: mcpCallDraft.serviceId,
          tool_name: mcpCallDraft.toolName,
          agent_id: mcpCallDraft.agentId,
          agent_name: agent?.name ?? mcpCallDraft.agentId,
          input: mcpCallDraft.input,
        }),
      })
      setMcpCallDraft((current) => ({ ...current, result: JSON.stringify(log.response, null, 2) }))
      setMcpLogs((current) => [log, ...current])
      setAdminFeedback({ type: 'success', content: 'MCP 调用已完成并写入日志' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '调用 MCP 失败'
      setAdminFeedback({ type: 'error', content: message })
    }
  }

  useEffect(() => {
    if (!session?.access) {
      setAgentOptions(FALLBACK_AGENT_OPTIONS)
      return
    }

    let alive = true
    setAgentOptionsLoading(true)
    fetchAgentOptions(session.access)
      .then((options) => {
        if (alive) {
          setAgentOptions(options)
        }
      })
      .finally(() => {
        if (alive) {
          setAgentOptionsLoading(false)
        }
      })

    return () => {
      alive = false
    }
  }, [session?.access])

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
    if (mode === 'mcp') {
      openNewMcpDrawer()
      return
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

  useEffect(() => {
    if (session?.role !== 'admin' || !session.access) {
      return
    }
    loadMcpData()
  }, [session?.access, session?.role])

  function authHeaders() {
    return {
      Authorization: `Bearer ${session?.access ?? ''}`,
    }
  }

  async function loadMcpData() {
    setMcpLoading(true)
    try {
      const [serviceData, logData, poolData] = await Promise.all([
        apiRequest<McpServiceRecord[]>('/api/v1/admin/mcp-services', { headers: authHeaders() }),
        apiRequest<McpCallLogRecord[]>('/api/v1/admin/mcp-call-logs?limit=50', { headers: authHeaders() }),
        apiRequest<ToolPoolResponse>('/api/v1/admin/mcp-tool-pool', { headers: authHeaders() }),
      ])
      setMcps(serviceData)
      setMcpLogs(logData)
      setMcpToolPool(poolData)
      setMcpCallDraft((current) => {
        if (current.serviceId && serviceData.some((item) => item.id === current.serviceId)) {
          return current
        }
        const first = serviceData[0]
        return {
          ...current,
          serviceId: first?.id ?? null,
          toolName: first?.tools[0]?.name ?? '',
          result: '',
        }
      })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '加载 MCP 数据失败'
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setMcpLoading(false)
    }
  }

  function openNewMcpDrawer() {
    setEditingMcpId(null)
    setMcpDraft(createEmptyMcpDraft())
    setDrawerMode('mcp')
    setDrawerVisible(true)
  }

  function editMcp(service: McpServiceRecord) {
    setEditingMcpId(service.id)
    setMcpDraft(mcpToDraft(service))
    setDrawerMode('mcp')
    setDrawerVisible(true)
  }

  async function saveMcp() {
    if (!mcpDraft.name.trim() || !mcpDraft.endpoint.trim()) {
      setAdminFeedback({ type: 'warning', content: '请填写 MCP 名称和命令或 URL' })
      return
    }
    setMcpSaving(true)
    try {
      const path = editingMcpId ? `/api/v1/admin/mcp-services/${editingMcpId}` : '/api/v1/admin/mcp-services'
      const saved = await apiRequest<McpServiceRecord>(path, {
        method: editingMcpId ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(mcpDraftPayload(mcpDraft)),
      })
      setMcps((current) =>
        editingMcpId ? current.map((item) => (item.id === saved.id ? saved : item)) : [saved, ...current],
      )
      const pool = await apiRequest<ToolPoolResponse>('/api/v1/admin/mcp-tool-pool', { headers: authHeaders() })
      setMcpToolPool(pool)
      setMcpCallDraft((current) => ({
        ...current,
        serviceId: saved.id,
        toolName: saved.tools[0]?.name ?? '',
        result: '',
      }))
      setAdminFeedback({ type: 'success', content: editingMcpId ? 'MCP 服务已更新' : 'MCP 服务已添加' })
      setDrawerVisible(false)
      setEditingMcpId(null)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '保存 MCP 服务失败'
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setMcpSaving(false)
    }
  }

  async function deleteMcp(service: McpServiceRecord) {
    try {
      await apiRequest(`/api/v1/admin/mcp-services/${service.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      setMcps((current) => current.filter((item) => item.id !== service.id))
      setAdminFeedback({ type: 'success', content: 'MCP 服务已下架' })
      loadMcpData()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '下架 MCP 服务失败'
      setAdminFeedback({ type: 'error', content: message })
    }
  }

  async function testMcp(service: McpServiceRecord) {
    try {
      const saved = await apiRequest<McpServiceRecord>(`/api/v1/admin/mcp-services/${service.id}/test`, {
        method: 'POST',
        headers: authHeaders(),
      })
      setMcps((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      setAdminFeedback({ type: 'success', content: '连接测试已完成' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '连接测试失败'
      setAdminFeedback({ type: 'error', content: message })
    }
  }

  async function discoverMcp(service: McpServiceRecord) {
    try {
      const saved = await apiRequest<McpServiceRecord>(`/api/v1/admin/mcp-services/${service.id}/discover`, {
        method: 'POST',
        headers: authHeaders(),
      })
      setMcps((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      const pool = await apiRequest<ToolPoolResponse>('/api/v1/admin/mcp-tool-pool', { headers: authHeaders() })
      setMcpToolPool(pool)
      setAdminFeedback({ type: 'success', content: '工具发现已写入数据库' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '工具发现失败'
      setAdminFeedback({ type: 'error', content: message })
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
          <img className="admin-brand-logo" src="/baidi.png" alt="CareerForge" />
          <div>
            <h1>CareerForge</h1>
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
          <strong>CareerForge AI Platform</strong>
          <div className="admin-topbar-actions">
            <Input className="admin-search" placeholder="Search..." allowClear />
            <Button icon={<IconNotification />} type="text" />
            <Button icon={<IconSettings />} type="text" onClick={() => setActiveNav("settings")} />
            <Dropdown
              droplist={
                <Menu>
                  <Menu.Item key="name" disabled>
                    <span style={{ fontWeight: 600 }}>{displayName}</span>
                  </Menu.Item>
                  <Menu.Item key="email" disabled>
                    <span style={{ color: '#86909C', fontSize: 12 }}>{email}</span>
                  </Menu.Item>
                  <Menu.Item key="logout" onClick={logout}>
                    <IconPoweroff style={{ marginRight: 8 }} />
                    退出登录
                  </Menu.Item>
                </Menu>
              }
              trigger="click"
              position="br"
            >
              <div className="admin-avatar" style={{ cursor: 'pointer', overflow: 'hidden' }}>
                {avatarUrl ? (
                  <img
                    key={avatarKey}
                    src={avatarUrl}
                    alt="avatar"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <IconUser />
                )}
              </div>
            </Dropdown>
          </div>
        </header>

        <main className="admin-page">
          <div className="admin-page-head">
            <div>
              <div className="admin-eyebrow">CONTROL CENTER</div>
              <h2>{meta.title}</h2>
              <p>{meta.desc}</p>
            </div>

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

          {activeNav === 'agents' ? <AgentManagementPage /> : null}
          {activeNav === 'master' ? renderMasterPage(openDrawer) : null}
          {activeNav === 'models' ? <ModelPlaza /> : null}
          {activeNav === 'mcp'
            ? renderMcpPage({
                openDrawer,
                mcpSearch,
                setMcpSearch,
                mcpStatusFilter,
                setMcpStatusFilter,
                mcpCategoryFilter,
                setMcpCategoryFilter,
                mcpServiceTypeFilter,
                setMcpServiceTypeFilter,
                filteredMcps,
                mcps,
                mcpLogs,
                mcpToolPool,
                mcpLoading,
                showMcpLogs,
                setShowMcpLogs,
                mcpDetailId,
                setMcpDetailId,
                mcpDetailTab,
                setMcpDetailTab,
                agentOptions,
                mcpCallDraft,
                patchMcpCallDraft,
                runMcpCall,
                onEdit: editMcp,
                onDelete: deleteMcp,
                onTest: testMcp,
                onDiscover: discoverMcp,
              })
            : null}
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
          {activeNav === 'settings' ? renderSettingsPage(displayName, email, avatarUrl, avatarKey, setAvatarKey, logout) : null}
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
        mcpDraft={mcpDraft}
        editingMcpId={editingMcpId}
        mcpSaving={mcpSaving}
        onMcpDraftChange={(patch) => setMcpDraft((current) => ({ ...current, ...patch }))}
        onSaveMcp={saveMcp}
        agentOptions={agentOptions}
        agentOptionsLoading={agentOptionsLoading}
        onClose={() => setDrawerVisible(false)}
      />
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
            系统提示词
            <Input.TextArea
              defaultValue="你是 CareerForge 就业总助手，负责路由子智能体、调用工具和知识库，并以清晰、可执行的建议帮助学生完成求职准备。"
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
          <Button type="primary" onClick={() => openDrawer('master')} style={{ alignSelf: 'flex-start' }}>
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

function renderMcpPage({
  openDrawer,
  mcpSearch,
  setMcpSearch,
  mcpStatusFilter,
  setMcpStatusFilter,
  mcpCategoryFilter,
  setMcpCategoryFilter,
  mcpServiceTypeFilter,
  setMcpServiceTypeFilter,
  filteredMcps,
  mcps,
  mcpLogs,
  mcpToolPool,
  mcpLoading,
  showMcpLogs,
  setShowMcpLogs,
  mcpDetailId,
  setMcpDetailId,
  mcpDetailTab,
  setMcpDetailTab,
  agentOptions,
  mcpCallDraft,
  patchMcpCallDraft,
  runMcpCall,
  onEdit,
  onDelete,
  onTest,
  onDiscover,
}: {
  openDrawer: (mode: DrawerMode) => void
  mcpSearch: string
  setMcpSearch: (value: string) => void
  mcpStatusFilter: string
  setMcpStatusFilter: (value: string) => void
  mcpCategoryFilter: string
  setMcpCategoryFilter: (value: string) => void
  mcpServiceTypeFilter: 'all' | 'hosted' | 'local'
  setMcpServiceTypeFilter: (value: 'all' | 'hosted' | 'local') => void
  filteredMcps: McpServiceRecord[]
  mcps: McpServiceRecord[]
  mcpLogs: McpCallLogRecord[]
  mcpToolPool: ToolPoolResponse
  mcpLoading: boolean
  showMcpLogs: boolean
  setShowMcpLogs: (value: boolean) => void
  mcpDetailId: number | null
  setMcpDetailId: (value: number | null) => void
  mcpDetailTab: string
  setMcpDetailTab: (value: string) => void
  agentOptions: AgentOption[]
  mcpCallDraft: McpCallDraft
  patchMcpCallDraft: (patch: Partial<McpCallDraft>) => void
  runMcpCall: () => void
  onEdit: (service: McpServiceRecord) => void
  onDelete: (service: McpServiceRecord) => void
  onTest: (service: McpServiceRecord) => void
  onDiscover: (service: McpServiceRecord) => void
}) {
  const categoryOptions = Array.from(new Set(mcps.map((service) => service.category || '通用').filter(Boolean)))
  const detailService = mcps.find((service) => service.id === mcpDetailId) ?? null
  const serviceLogs = detailService ? mcpLogs.filter((log) => log.service_id === detailService.id) : mcpLogs

  function openDetail(service: McpServiceRecord) {
    setMcpDetailId(service.id)
    setMcpDetailTab('detail')
    patchMcpCallDraft({ serviceId: service.id })
  }

  if (detailService) {
    return (
      <div className="mcp-workspace mcp-detail-page">
        <section className="mcp-detail-hero">
          <div className="mcp-detail-topline">
            <div className="mcp-detail-title">
              <span className="resource-icon blue">
                <IconSafe />
              </span>
              <div>
                <h2>{detailService.name}</h2>
                <p>{detailService.description || '管理员尚未填写服务介绍。'}</p>
                <div className="mcp-detail-tags">
                  <Tag color={statusColor(detailService.status)}>{statusLabel(detailService.status)}</Tag>
                  <Tag color={detailService.transport === 'Streamable HTTP' ? 'arcoblue' : 'green'}>{detailService.transport}</Tag>
                  <Tag bordered>{detailService.category || '通用'}</Tag>
                  <Tag bordered>{detailService.owner || '未设置负责人'}</Tag>
                </div>
              </div>
            </div>
            <Button className="mcp-back-button" type="outline" onClick={() => setMcpDetailId(null)}>
              ← 返回 MCP 广场
            </Button>
          </div>
          <div className="mcp-detail-actions">
            <Button type="outline" icon={<IconSettings />} onClick={() => onEdit(detailService)}>
              编辑配置
            </Button>
            <Popconfirm title={`确定下架 ${detailService.name} 吗？`} okText="下架" cancelText="取消" onOk={() => onDelete(detailService)}>
              <Button type="outline" status="danger" icon={<IconPoweroff />}>
                下架
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<IconRobot />} onClick={() => setMcpDetailTab('test')}>
              工具测试
            </Button>
          </div>
        </section>

        <Tabs className="mcp-detail-tabs" activeTab={mcpDetailTab} onChange={setMcpDetailTab}>
          <Tabs.TabPane key="detail" title="服务详情">
            <section className="mcp-detail-layout">
              <article className="mcp-doc-panel">
                <h3>获取 MCP 服务器</h3>
                <p>{detailService.description || '该 MCP 服务已接入数据库，可被授权智能体按工具清单调用。'}</p>
                <h3>可用工具</h3>
                {detailService.tools.length > 0 ? (
                  <div className="mcp-doc-tool-list">
                    {detailService.tools.map((tool) => (
                      <div key={tool.name}>
                        <strong>{tool.name}</strong>
                        <span>{tool.description || '暂无工具说明'}</span>
                        <Tag color={tool.risk === '高风险' ? 'red' : tool.risk === '中风险' ? 'orange' : 'green'}>{tool.risk}</Tag>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mcp-empty-mini">还没有工具。管理员可以点击“发现”或“编辑配置”维护工具清单。</div>
                )}
                <h3>Agent 调用边界</h3>
                <p>只有下方服务配置中授权的主 Agent 或子智能体可以调用该 MCP。保存后，工具会进入统一工具池，由主 Agent 编排时注入模型。</p>
              </article>

              <aside className="mcp-config-panel">
                <div className="mcp-config-head">
                  <strong>服务配置</strong>
                  <Tag color="green">可部署</Tag>
                </div>
                <div className="mcp-config-card">
                  <span>传输类型</span>
                  <strong>{detailService.transport}</strong>
                </div>
                <div className="mcp-config-card">
                  <span>连接地址</span>
                  <strong>{detailService.endpoint}</strong>
                </div>
                <div className="mcp-config-grid">
                  <div>
                    <span>鉴权类型</span>
                    <strong>{detailService.auth_type}</strong>
                  </div>
                  <div>
                    <span>最近检测</span>
                    <strong>{formatDateTime(detailService.last_checked_at)}</strong>
                  </div>
                </div>
                <Button type="primary" long onClick={() => onTest(detailService)}>
                  连接测试
                </Button>
                <Button long type="outline" onClick={() => onDiscover(detailService)}>
                  工具发现
                </Button>
              </aside>
            </section>
          </Tabs.TabPane>

          <Tabs.TabPane key="test" title="工具测试">
            <section className="mcp-detail-layout">
              <article className="mcp-doc-panel">
                <div className="mcp-call-form is-horizontal">
                  <Select value={mcpCallDraft.agentId} placeholder="调用智能体" onChange={(value) => patchMcpCallDraft({ agentId: value })}>
                    {agentOptions.map((agent) => (
                      <Select.Option key={agent.id} value={agent.id}>
                        {agent.name}
                      </Select.Option>
                    ))}
                  </Select>
                  <Select value={mcpCallDraft.toolName || undefined} placeholder="工具" onChange={(value) => patchMcpCallDraft({ toolName: value })}>
                    {detailService.tools.map((tool) => (
                      <Select.Option key={tool.name} value={tool.name}>
                        {tool.name}
                      </Select.Option>
                    ))}
                  </Select>
                </div>
                <Input.TextArea
                  value={mcpCallDraft.input}
                  autoSize={{ minRows: 5, maxRows: 8 }}
                  placeholder="输入工具参数，例如岗位关键词、城市、薪资范围"
                  onChange={(value) => patchMcpCallDraft({ input: value })}
                />
                <Button type="primary" icon={<IconRobot />} disabled={!detailService.tools.length} onClick={runMcpCall}>
                  执行调用
                </Button>
                <pre className="mcp-call-result is-detail">
                  {mcpCallDraft.result || '执行结果会显示智能体、工具、请求参数、结构化响应和 trace。'}
                </pre>
              </article>
              <aside className="mcp-config-panel">
                <div className="mcp-config-head">
                  <strong>已授权智能体</strong>
                </div>
                <div className="mcp-agent-chip-list">
                  {detailService.agent_ids.length ? (
                    detailService.agent_ids.map((agentId) => {
                      const agent = agentOptions.find((item) => item.id === agentId)
                      return <Tag key={agentId} color="arcoblue">{agent?.name ?? agentId}</Tag>
                    })
                  ) : (
                    <Tag color="orange">未授权</Tag>
                  )}
                </div>
                <div className="mcp-tool-pool">
                  <div className="mcp-tool-pool-head">
                    <strong>Agent 工具池</strong>
                    <span>内置工具优先，其次 Skill，最后合并已启用 MCP 工具。</span>
                  </div>
                  {mcpToolPool.tools.map((tool) => (
                    <div key={`${tool.source}-${tool.name}`} className="mcp-tool-pool-row">
                      <div>
                        <strong>{tool.name}</strong>
                        <span>{tool.provider}</span>
                      </div>
                      <Tag color={tool.source === 'builtin' ? 'green' : tool.source === 'skill' ? 'arcoblue' : 'orange'} bordered>
                        {tool.source === 'builtin' ? '内置' : tool.source === 'skill' ? 'Skill' : 'MCP'}
                      </Tag>
                    </div>
                  ))}
                </div>
              </aside>
            </section>
          </Tabs.TabPane>

          <Tabs.TabPane key="logs" title={`调用日志 ${serviceLogs.length}`}>
            <section className="mcp-doc-panel">
              {serviceLogs.length > 0 ? (
                serviceLogs.map((log) => (
                  <div key={log.id} className="mcp-log-row">
                    <div>
                      <strong>{log.agent_name}</strong>
                      <span>
                        {log.service_name} / {log.tool_name} · {formatDateTime(log.created_at)}
                      </span>
                    </div>
                    <Tag color={log.success ? 'green' : 'red'}>{log.success ? `${log.latency_ms ?? 0}ms` : '失败'}</Tag>
                  </div>
                ))
              ) : (
                <div className="mcp-empty-mini">暂无调用日志</div>
              )}
            </section>
          </Tabs.TabPane>
        </Tabs>
      </div>
    )
  }

  return (
    <div className="mcp-workspace">
      <section className="mcp-market-top">
        <div className="mcp-market-title">
          <strong>MCP 服务</strong>
          <Tag bordered>MCP 体验</Tag>
        </div>
        <Input
          className="mcp-market-search"
          allowClear
          placeholder={`搜索 MCP 服务（共 ${mcps.length} 个）`}
          value={mcpSearch}
          onChange={setMcpSearch}
        />
        <div className="mcp-type-filter">
          <span>服务类型：</span>
          <Button type={mcpServiceTypeFilter === 'hosted' ? 'primary' : 'outline'} onClick={() => setMcpServiceTypeFilter(mcpServiceTypeFilter === 'hosted' ? 'all' : 'hosted')}>
            Hosted
          </Button>
          <Button type={mcpServiceTypeFilter === 'local' ? 'primary' : 'outline'} onClick={() => setMcpServiceTypeFilter(mcpServiceTypeFilter === 'local' ? 'all' : 'local')}>
            Local
          </Button>
        </div>
      </section>

      <section className="mcp-market-shell">
        <aside className="mcp-category-rail">
          <button className={mcpCategoryFilter === 'all' ? 'active' : ''} type="button" onClick={() => setMcpCategoryFilter('all')}>
            <span>全部服务</span>
            <b>{mcps.length}</b>
          </button>
          {categoryOptions.map((category) => (
            <button
              key={category}
              className={mcpCategoryFilter === category ? 'active' : ''}
              type="button"
              onClick={() => setMcpCategoryFilter(category)}
            >
              <span>{category}</span>
              <b>{mcps.filter((service) => (service.category || '通用') === category).length}</b>
            </button>
          ))}
        </aside>

        <div className="mcp-market-main">
          <div className="mcp-market-toolbar">
            <div className="mcp-result-line">
              <span>
                共找到 <b>{filteredMcps.length}</b> 个结果
              </span>
              {mcpCategoryFilter !== 'all' ? (
                <Tag closable onClose={() => setMcpCategoryFilter('all')}>
                  {mcpCategoryFilter}
                </Tag>
              ) : null}
            </div>
            <Select value={mcpStatusFilter} onChange={setMcpStatusFilter}>
              <Select.Option value="all">全部状态</Select.Option>
              <Select.Option value="enabled">已启用</Select.Option>
              <Select.Option value="disabled">已停用</Select.Option>
              <Select.Option value="error">异常</Select.Option>
            </Select>
            <Button type="outline" icon={<IconHistory />} onClick={() => setShowMcpLogs(!showMcpLogs)}>
              {showMcpLogs ? '回到服务' : '审计记录'}
            </Button>
            <Button type="primary" icon={<IconPlus />} onClick={() => openDrawer("mcp")} style={{ background: "linear-gradient(135deg, #165dff, #2c73ff)", border: "none", borderRadius: 8, boxShadow: "0 4px 14px rgba(22,93,255,0.3)", fontWeight: 500 }}>
              添加服务
            </Button>
          </div>

          {showMcpLogs ? (
            <section className="mcp-doc-panel">
              {mcpLogs.length > 0 ? (
                mcpLogs.map((log) => (
                  <div key={log.id} className="mcp-log-row">
                    <div>
                      <strong>{log.agent_name}</strong>
                      <span>
                        {log.service_name} / {log.tool_name} · {formatDateTime(log.created_at)}
                      </span>
                    </div>
                    <Tag color={log.success ? 'green' : 'red'}>{log.success ? `${log.latency_ms ?? 0}ms` : '失败'}</Tag>
                  </div>
                ))
              ) : (
                <div className="mcp-empty-mini">暂无调用日志</div>
              )}
            </section>
          ) : (
            <section className="mcp-card-grid">
              {mcpLoading ? <div className="mcp-empty-state">正在读取数据库 MCP 服务...</div> : null}
              {!mcpLoading && filteredMcps.map((service) => (
                <article key={service.id} className="mcp-market-card" onClick={() => openDetail(service)}>
                  <div className="mcp-market-card-head">
                    <div>
                      <h3>{service.name}</h3>
                      <div>
                        <Tag color={service.transport === 'Streamable HTTP' ? 'arcoblue' : 'green'}>{service.transport}</Tag>
                        <Tag color={statusColor(service.status)}>{statusLabel(service.status)}</Tag>
                      </div>
                    </div>
                    <span className="mcp-card-logo">{service.name.slice(0, 1).toUpperCase()}</span>
                  </div>
                  <p>{service.description || '管理员尚未填写服务介绍。'}</p>
                  <div className="mcp-market-card-tags">
                    <Tag bordered>{service.category || '通用'}</Tag>
                    <Tag bordered>{detailOwnerLabel(service)}</Tag>
                    <Tag bordered>{service.tools.length} 工具</Tag>
                  </div>
                  <div className="mcp-market-card-foot">
                    <span>@{service.slug}</span>
                    <span>{service.latency_ms ? `${service.latency_ms}ms` : '未测试'}</span>
                    <span>{formatDateTime(service.last_checked_at)}</span>
                  </div>
                </article>
              ))}
              {!mcpLoading && filteredMcps.length === 0 ? (
                <div className="mcp-empty-state">
                  <IconSafe />
                  <strong>{mcps.length === 0 ? '还没有 MCP 服务' : '没有匹配的 MCP 服务'}</strong>
                  <span>{mcps.length === 0 ? '数据库中暂无记录，请手动添加第一个 MCP 服务。' : '调整筛选条件或新建一个服务接入配置。'}</span>
                  <Button type="primary" icon={<IconPlus />} onClick={() => openDrawer('mcp')}>
                    添加 MCP 服务
                  </Button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </section>
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

function renderSettingsPage(displayName: string, email: string, avatarUrl: string, avatarKey: number, setAvatarKey: (v: number | ((prev: number) => number)) => void, logout: () => void) {
  return (
    <div style={{ display: "flex", gap: 24, height: "100%", overflow: "hidden" }}>
      {/* Left: Account Info */}
      <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{
          background: "#fff", borderRadius: 16, padding: "28px 24px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)", border: "1px solid transparent",
          textAlign: "center",
        }}>
          <Avatar size={88} style={{ marginBottom: 16, boxShadow: "0 4px 16px rgba(0,0,0,0.08)" }}>
            {avatarUrl ? (
              <img key={avatarKey} src={avatarUrl} alt="avatar" />
            ) : (
              <IconUser style={{ fontSize: 36 }} />
            )}
          </Avatar>
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--color-text-1)", marginBottom: 4 }}>
            {displayName}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-3)", marginBottom: 16 }}>
            {email || "未绑定邮箱"}
          </div>
          <Upload
            showUploadList={false}
            accept=".png,.jpg,.jpeg,.gif,.webp"
            customRequest={async (option) => {
              const formData = new FormData()
              formData.append("file", option.file)
              try {
                await apiRequest<{ avatar_url: string }>("/api/v1/auth/avatar", {
                  method: "POST",
                  body: formData,
                })
                setAvatarKey(k => k + 1)
                Message.success("头像上传成功")
                setTimeout(() => window.location.reload(), 500)
              } catch (err) {
                Message.error(err instanceof ApiError ? err.message : "上传失败")
              }
            }}
          >
            <Button size="small" type="outline" long>更换头像</Button>
          </Upload>
        </div>

        <div style={{
          background: "#fff", borderRadius: 16, padding: "16px 24px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)", border: "1px solid transparent",
        }}>
          <div style={{ fontSize: 13, color: "var(--color-text-3)", marginBottom: 8 }}>运行偏好</div>
          <div className="switch-list" style={{ marginBottom: 10 }}>
            <Switch defaultChecked size="small" />
            <span style={{ fontSize: 13 }}>操作审计</span>
          </div>
          <div className="switch-list" style={{ marginBottom: 16 }}>
            <Switch defaultChecked size="small" />
            <span style={{ fontSize: 13 }}>异常通知</span>
          </div>
          <Popconfirm title="确定要退出登录吗？" okText="退出" cancelText="取消" onOk={logout}>
            <Button type="outline" status="danger" icon={<IconPoweroff />} long>
              退出登录
            </Button>
          </Popconfirm>
        </div>
      </div>

      {/* Right: Settings Cards */}
      <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
        <SystemSettings />
      </div>
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
  mcpDraft,
  editingMcpId,
  mcpSaving,
  onSkillDraftChange,
  onSkillFileUpload,
  onSaveSkill,
  onMcpDraftChange,
  onSaveMcp,
  agentOptions,
  agentOptionsLoading,
  onClose,
}: {
  mode: DrawerMode
  visible: boolean
  selectedAgent: (typeof AGENTS)[number]
  skillNames: string[]
  skillDraft: SkillDraft
  editingSkillId: number | null
  skillSaving: boolean
  mcpDraft: McpDraft
  editingMcpId: number | null
  mcpSaving: boolean
  onSkillDraftChange: (patch: Partial<SkillDraft>) => void
  onSkillFileUpload: (fileName: string, content: string) => void
  onSaveSkill: () => void
  onMcpDraftChange: (patch: Partial<McpDraft>) => void
  onSaveMcp: () => void
  agentOptions: AgentOption[]
  agentOptionsLoading: boolean
  onClose: () => void
}) {
  const titleMap: Record<DrawerMode, string> = {
    agent: `配置智能体 · ${selectedAgent.name}`,
    master: '编辑主智能体配置',
    model: '添加模型',
    mcp: editingMcpId ? '编辑 MCP 服务' : '添加 MCP 服务',
    skill: editingSkillId ? '编辑 Skill 文件' : '添加 Skill 文件',
    knowledge: '新建知识库',
  }
  const isSaving = mode === 'skill' ? skillSaving : mode === 'mcp' ? mcpSaving : false
  const onSave = mode === 'skill' ? onSaveSkill : mode === 'mcp' ? onSaveMcp : onClose

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
          <Button type="primary" loading={isSaving} onClick={onSave}>
            保存
          </Button>
        </div>
      }
    >
      {mode === 'agent' ? <AgentDrawerContent agent={selectedAgent} skillNames={skillNames} /> : null}
      {mode === 'master' ? <MasterDrawerContent /> : null}
      {mode === 'model' ? <ModelDrawerContent /> : null}
      {mode === 'mcp' ? (
        <McpDrawerContent
          draft={mcpDraft}
          onChange={onMcpDraftChange}
          agentOptions={agentOptions}
          agentOptionsLoading={agentOptionsLoading}
        />
      ) : null}
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
      <Checkbox.Group defaultValue={agent.mcps} options={Array.from(new Set(AGENTS.flatMap((item) => item.mcps)))} />
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

function McpDrawerContent({
  draft,
  onChange,
  agentOptions,
  agentOptionsLoading,
}: {
  draft: McpDraft
  onChange: (patch: Partial<McpDraft>) => void
  agentOptions: AgentOption[]
  agentOptionsLoading: boolean
}) {
  function updateTool(index: number, patch: Partial<McpToolRecord>) {
    onChange({
      tools: draft.tools.map((tool, itemIndex) => (itemIndex === index ? { ...tool, ...patch } : tool)),
    })
  }

  function addTool() {
    onChange({
      tools: [...draft.tools, { name: '', description: '', risk: '低风险', enabled: true, input_schema: {} }],
    })
  }

  function removeTool(index: number) {
    onChange({ tools: draft.tools.filter((_, itemIndex) => itemIndex !== index) })
  }

  return (
    <div className="mcp-apple-form">
      <div className="mcp-apple-hero">
        <div>
          <span>MCP Service</span>
          <h3>添加可被智能体调用的工具服务</h3>
        </div>
        <Tag color="arcoblue" bordered>
          Database
        </Tag>
      </div>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>服务身份</strong>
          <span>手动录入后保存到数据库，用于广场检索和智能体路由</span>
        </div>
        <Input value={draft.name} placeholder="MCP 服务名称" addBefore="名称" onChange={(value) => onChange({ name: value })} />
        <Input.TextArea
          value={draft.description}
          placeholder="描述这个 MCP 可以提供哪些业务能力"
          autoSize={{ minRows: 3, maxRows: 4 }}
          onChange={(value) => onChange({ description: value })}
        />
        <div className="mcp-apple-grid">
          <Select value={draft.category || undefined} placeholder="服务分类" onChange={(value) => onChange({ category: value })}>
            {['招聘数据', '学生服务', '搜索工具', '企业资料', '内容采集', '文档处理', '日程协同', '平台治理', '通用'].map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Input value={draft.owner} placeholder="负责人或团队" addBefore="负责人" onChange={(value) => onChange({ owner: value })} />
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>连接协议</strong>
          <span>支持 stdio / SSE / Streamable HTTP，保存后可进行连接测试</span>
        </div>
        <Select value={draft.transport} placeholder="传输方式" onChange={(value) => onChange({ transport: value })}>
          {['stdio', 'SSE', 'Streamable HTTP'].map((item) => (
            <Select.Option key={item} value={item}>
              {item}
            </Select.Option>
          ))}
        </Select>
        <Input value={draft.endpoint} placeholder="命令或 URL" addBefore="地址" onChange={(value) => onChange({ endpoint: value })} />
        <div className="mcp-apple-grid">
          <Select value={draft.authType} placeholder="鉴权方式" onChange={(value) => onChange({ authType: value })}>
            {['无鉴权', 'Bearer Token', 'API Key', 'OAuth 2.0', '本地沙箱'].map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Input value={draft.authConfig} placeholder="鉴权配置" addBefore="鉴权" onChange={(value) => onChange({ authConfig: value })} />
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>智能体授权</strong>
          <span>这里读取真实智能体接口；只有被授权的智能体才能调用</span>
        </div>
        <Select
          mode="multiple"
          value={draft.agentIds}
          loading={agentOptionsLoading}
          placeholder="选择可调用该 MCP 的智能体"
          showSearch
          onChange={(value) => onChange({ agentIds: value })}
        >
          {agentOptions.map((agent) => (
            <Select.Option key={agent.id} value={agent.id}>
              {agent.name}
            </Select.Option>
          ))}
        </Select>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>工具暴露</strong>
          <span>手动维护 MCP 暴露的工具；保存后进入 Agent 工具池</span>
        </div>
        <div className="mcp-tool-editor">
          {draft.tools.map((tool, index) => (
            <div key={index} className="mcp-tool-editor-row">
              <Input value={tool.name} placeholder="工具名，如 web_search" onChange={(value) => updateTool(index, { name: value })} />
              <Input value={tool.description} placeholder="工具说明" onChange={(value) => updateTool(index, { description: value })} />
              <Select value={tool.risk} onChange={(value) => updateTool(index, { risk: value })}>
                <Select.Option value="低风险">低风险</Select.Option>
                <Select.Option value="中风险">中风险</Select.Option>
                <Select.Option value="高风险">高风险</Select.Option>
              </Select>
              <Button type="text" status="danger" onClick={() => removeTool(index)}>
                删除
              </Button>
            </div>
          ))}
          {draft.tools.length === 0 ? <div className="mcp-empty-mini">还没有工具，保存服务后也可以稍后发现或编辑。</div> : null}
          <Button type="outline" icon={<IconPlus />} onClick={addTool}>
            添加工具
          </Button>
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>工具池策略</strong>
          <span>发布后按优先级注入给模型，避免同名工具冲突</span>
        </div>
        <div className="mcp-priority-flow">
          {[
            ['1', '内置工具', '硬编码能力，最高优先级'],
            ['2', 'Skill 工具', '从数据库动态加载'],
            ['3', 'MCP 工具', '运行时发现并合并'],
          ].map(([step, title, desc]) => (
            <div key={title}>
              <b>{step}</b>
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="mcp-apple-switches">
        <div className="switch-list">
          <Switch checked={draft.status === 'enabled'} onChange={(checked) => onChange({ status: checked ? 'enabled' : 'disabled' })} />
          <span>启用服务</span>
        </div>
        <div className="switch-list">
          <Switch checked={draft.autoDisableOnError} onChange={(checked) => onChange({ autoDisableOnError: checked })} />
          <span>异常时自动从智能体路由中摘除</span>
        </div>
      </div>
    </div>
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
