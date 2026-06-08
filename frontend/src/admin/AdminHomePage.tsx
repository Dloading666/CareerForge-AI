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
  IconArrowLeft,
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
    location: '浜戠',
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
    location: '浜戠',
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
    location: '浜戠',
    protocols: ['Anthropic'],
    enabled: false,
  },
]

const AGENTS = [
  {
    id: 'interview',
    name: 'AI 闈㈣瘯瀹?,
    desc: '妯℃嫙鐪熷疄闈㈣瘯杩介棶锛岀敓鎴愰€愰鐐硅瘎涓庡鐩樻姤鍛娿€?,
    status: '宸插彂甯?,
    iconTone: 'blue',
    skills: ['闈㈣瘯鍏ㄦ祦绋嬪垎鏋?, '鑳藉姏鐢诲儚'],
    mcps: [],
    kbs: ['闈㈣瘯棰樺簱'],
    models: ['DeepSeek V3', 'GPT-4o Mini'],
    callable: true,
    route: '妯℃嫙闈㈣瘯 / 闈㈣瘯澶嶇洏',
  },
  {
    id: 'matching',
    name: '宀椾綅鍖归厤',
    desc: '瀵圭畝鍘嗕笌 JD 杩涜鍙屽悜鍖归厤锛岃В閲婃妧鑳藉樊璺濆拰鎻愬崌璺緞銆?,
    status: '宸插彂甯?,
    iconTone: 'green',
    skills: ['宀椾綅鍖归厤鎵撳垎', '绠€鍘嗚В鏋?],
    mcps: [],
    kbs: ['宀椾綅搴?, '浼佷笟璧勬枡搴?],
    models: ['DeepSeek V3'],
    callable: true,
    route: '宀椾綅鍖归厤 / JD 鍒嗘瀽',
  },
  {
    id: 'resume',
    name: '绠€鍘嗕紭鍖?,
    desc: '鍩轰簬宀椾綅鐩爣閲嶅啓椤圭洰缁忓巻锛岃ˉ榻?STAR 缁撴瀯涓庨噺鍖栬〃杈俱€?,
    status: '鑽夌',
    iconTone: 'orange',
    skills: ['绠€鍘嗗叏鐢熷懡鍛ㄦ湡澶勭悊'],
    mcps: [],
    kbs: ['绠€鍘嗚寖渚嬪簱'],
    models: ['GPT-4o Mini'],
    callable: false,
    route: '绠€鍘嗗缓璁?/ 椤圭洰缁忓巻',
  },
]

const FALLBACK_AGENT_OPTIONS: AgentOption[] = [
  { id: 'master', name: '涓绘櫤鑳戒綋', status: '宸插惎鐢?, kind: 'master' },
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
name: 绠€鍘嗕寒鐐规彁鐐?
description: 浠庡鐢熺畝鍘嗕腑鎻愮偧鍙敤浜庢眰鑱屾矡閫氱殑椤圭洰浜偣銆侀噺鍖栨垚鏋滃拰椋庨櫓鐐广€?
version: 1.0.0
category: 绠€鍘?
tags: 绠€鍘? 椤圭洰缁忓巻, STAR
---

# 绠€鍘嗕寒鐐规彁鐐?

## 閫傜敤鍦烘櫙
褰撲富 Agent 鎴栧瓙 Agent 闇€瑕佸府鍔╁鐢熸妸缁忓巻鏀瑰啓鎴愭洿娓呮櫚鐨勬眰鑱岃〃杈炬椂锛屼娇鐢ㄨ繖涓?Skill銆?

## 杈撳叆
- 瀛︾敓鍘熷绠€鍘嗘垨椤圭洰缁忓巻
- 鐩爣宀椾綅鎴?JD锛屽彲閫?

## 宸ヤ綔姝ラ
1. 璇嗗埆缁忓巻涓殑浠诲姟銆佽鍔ㄣ€佺粨鏋滃拰閲忓寲璇佹嵁銆?
2. 鍒ゆ柇琛ㄨ揪鏄惁瀛樺湪绌烘硾銆佸じ澶с€佺己灏戜笂涓嬫枃鐨勯棶棰樸€?
3. 杈撳嚭 3-5 鏉℃洿閫傚悎鎶曢€掓垨闈㈣瘯浣跨敤鐨勪寒鐐硅〃杈俱€?

## 杈撳嚭鏍煎紡
- 浜偣鏍囬
- 鏀瑰啓鍚庣殑琛ㄨ揪
- 鍙拷闂瘉鎹?
- 椋庨櫓鎻愰啋
`

const KNOWLEDGE_BASES = [
  {
    name: '灏变笟鏀跨瓥鐭ヨ瘑搴?,
    docs: 128,
    chunks: '12.4k',
    vectorStatus: '宸插悜閲忓寲',
    authorized: ['涓绘櫤鑳戒綋', '灏变笟闂瓟'],
    update: '浠婂ぉ 10:24',
    progress: 100,
  },
  {
    name: '宀椾綅搴?,
    docs: 864,
    chunks: '38.9k',
    vectorStatus: '鍚屾涓?,
    authorized: ['涓绘櫤鑳戒綋', '宀椾綅鍖归厤'],
    update: '浠婂ぉ 09:12',
    progress: 72,
  },
  {
    name: '闈㈣瘯棰樺簱',
    docs: 312,
    chunks: '18.1k',
    vectorStatus: '宸插悜閲忓寲',
    authorized: ['AI 闈㈣瘯瀹?],
    update: '鏄ㄥぉ 18:40',
    progress: 100,
  },
]

const ROUTES = [
  { intent: '妯℃嫙闈㈣瘯 / 闈㈣瘯澶嶇洏', agent: 'AI 闈㈣瘯瀹?, memory: '鐙珛绾跨▼锛屼粎鍥炰紶缁撴灉鎽樿' },
  { intent: '宀椾綅鍖归厤 / JD 鍒嗘瀽', agent: '宀椾綅鍖归厤', memory: '鐙珛绾跨▼锛屼粎鍥炰紶鍖归厤鎶ュ憡' },
  { intent: '绠€鍘嗗缓璁?/ 椤圭洰缁忓巻', agent: '绠€鍘嗕紭鍖?, memory: '鑽夌鏈燂紝鏆備笉瀵瑰鐢熷紑鏀? },
]

const pageMeta: Record<NavKey, { title: string; desc: string; action?: string; drawer: DrawerMode }> = {
  agents: {
    title: '鏅鸿兘浣撶鐞?,
    desc: '缁勮瀛愭櫤鑳戒綋鐨勬ā鍨嬭寖鍥淬€丼kills銆丮CP 涓庝笓灞炵煡璇嗗簱锛屽苟鎺у埗鏄惁鍏佽琚富鏅鸿兘浣撹皟鐢ㄣ€?,
    action: '鏂板缓鏅鸿兘浣?,
    drawer: 'agent',
  },
  master: {
    title: '涓绘櫤鑳戒綋閰嶇疆',
    desc: '閰嶇疆灏变笟鎬诲姪鎵嬬殑榛樿妯″瀷銆佺郴缁熸彁绀鸿瘝銆佸叏閲忚兘鍔涜寖鍥淬€佽矾鐢辩瓥鐣ュ拰璁板繂闅旂瑙勫垯銆?,
    drawer: 'master',
  },
  models: {
    title: '妯″瀷骞垮満',
    desc: '鎺ュ叆銆佹祴閫熷苟鎺у埗鍝簺妯″瀷鍏佽瀛︾敓绔拰鏅鸿兘浣撹皟鐢ㄣ€?,
    action: '娣诲姞妯″瀷',
    drawer: 'model',
  },
  mcp: {
    title: 'MCP 骞垮満',
    desc: '缁熶竴鎺ュ叆澶栭儴宸ュ叿鍜屾暟鎹湇鍔★紝绠＄悊閴存潈銆佹巿鏉冦€佸伐鍏锋毚闇层€佸仴搴锋娴嬩笌瀹¤娌荤悊銆?,
    action: '娣诲姞 MCP 鏈嶅姟',
    drawer: 'mcp',
  },
  skills: {
    title: 'Skills 骞垮満',
    desc: '绠＄悊鍙鐢ㄥ師瀛愯兘鍔涳紝浣滀负鏅鸿兘浣撹閰嶆椂鐨勬妧鑳芥睜銆?,
    action: '鏂板缓 Skill',
    drawer: 'skill',
  },
  knowledge: {
    title: '鐭ヨ瘑搴?,
    desc: '涓婁紶鏂囨。銆佽В鏋愬垏鐗囥€佸悜閲忓寲锛屽苟鎸夋櫤鑳戒綋鎺堟潈妫€绱㈣寖鍥淬€?,
    action: '鏂板缓鐭ヨ瘑搴?,
    drawer: 'knowledge',
  },
  settings: {
    title: '绯荤粺璁剧疆',
    desc: '绠＄悊璐﹀彿銆佹潈闄愬拰骞冲彴杩愯鍋忓ソ銆?,
    action: '淇濆瓨璁剧疆',
    drawer: 'master',
  },
}

function createEmptySkillDraft(): SkillDraft {
  return {
    name: '',
    description: '',
    version: '1.0.0',
    category: '閫氱敤',
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
    .split(/[,锛孿n]/)
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
    authType: '鏃犻壌鏉?,
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
    category: draft.category.trim() || '閫氱敤',
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
        risk: tool.risk || '浣庨闄?,
        input_schema: tool.input_schema ?? {},
        enabled: tool.enabled,
      })),
  }
}

function statusLabel(status: McpServiceRecord['status']) {
  const labels = { enabled: '宸插惎鐢?, disabled: '宸插仠鐢?, error: '寮傚父' }
  return labels[status]
}

function statusColor(status: McpServiceRecord['status']) {
  if (status === 'enabled') return 'green'
  if (status === 'error') return 'red'
  return 'gray'
}

function formatDateTime(value: string | null) {
  if (!value) return '鏈娴?
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
  return service.owner ? `寮€鍙戣€咃細${service.owner}` : '鏈缃紑鍙戣€?
}

export function AdminHomePage() {
  const { session, logout } = useAuth()
  const displayName = (session?.profile.display_name as string) || '骞冲彴绠＄悊鍛?
  const avatarUrl = (session?.profile.avatar_url as string) || ''
  const [avatarKey, setAvatarKey] = useState(0)
  const [settingsTab, setSettingsTab] = useState<string>('')
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
      setAdminFeedback({ type: 'warning', content: '璇峰厛閫夋嫨 MCP 鏈嶅姟鍜屽伐鍏? })
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
      setAdminFeedback({ type: 'success', content: 'MCP 璋冪敤宸插畬鎴愬苟鍐欏叆鏃ュ織' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '璋冪敤 MCP 澶辫触'
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
    { key: 'agents', icon: <IconRobot />, label: '鏅鸿兘浣撶鐞? },
    { key: 'master', icon: <IconDashboard />, label: '涓绘櫤鑳戒綋閰嶇疆' },
    { key: 'models', icon: <IconExperiment />, label: '妯″瀷骞垮満' },
    { key: 'mcp', icon: <IconSafe />, label: 'MCP 骞垮満' },
    { key: 'skills', icon: <IconApps />, label: 'Skills 骞垮満' },
    { key: 'knowledge', icon: <IconHistory />, label: '鐭ヨ瘑搴? },
    { key: 'settings', icon: <IconSettings />, label: '绯荤粺璁剧疆' },
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
        const message = error instanceof ApiError ? error.message : '鍔犺浇 Skills 澶辫触'
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
      const message = error instanceof ApiError ? error.message : '鍔犺浇 MCP 鏁版嵁澶辫触'
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
      setAdminFeedback({ type: 'warning', content: '璇峰～鍐?MCP 鍚嶇О鍜屽懡浠ゆ垨 URL' })
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
      setAdminFeedback({ type: 'success', content: editingMcpId ? 'MCP 鏈嶅姟宸叉洿鏂? : 'MCP 鏈嶅姟宸叉坊鍔? })
      setDrawerVisible(false)
      setEditingMcpId(null)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '淇濆瓨 MCP 鏈嶅姟澶辫触'
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
      setAdminFeedback({ type: 'success', content: 'MCP 鏈嶅姟宸蹭笅鏋? })
      loadMcpData()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '涓嬫灦 MCP 鏈嶅姟澶辫触'
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
      setAdminFeedback({ type: 'success', content: '杩炴帴娴嬭瘯宸插畬鎴? })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '杩炴帴娴嬭瘯澶辫触'
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
      setAdminFeedback({ type: 'success', content: '宸ュ叿鍙戠幇宸插啓鍏ユ暟鎹簱' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '宸ュ叿鍙戠幇澶辫触'
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
      setAdminFeedback({ type: 'warning', content: '璇峰厛濉啓鎴栦笂浼?Skill 鏂囦欢鍐呭' })
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
        content: editingSkillId ? 'Skill 鏂囦欢宸叉洿鏂? : 'Skill 宸叉坊鍔犲埌骞垮満',
      })
      setDrawerVisible(false)
      setEditingSkillId(null)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '淇濆瓨 Skill 澶辫触'
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
      setAdminFeedback({ type: 'success', content: nextStatus === 'enabled' ? 'Skill 宸插惎鐢? : 'Skill 宸插仠鐢? })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '鏇存柊 Skill 鐘舵€佸け璐?
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
      setAdminFeedback({ type: 'success', content: 'Skill 宸蹭粠骞垮満绉婚櫎' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '鍒犻櫎 Skill 澶辫触'
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
          <span>鏈湴澶фā鍨?路 鍦ㄧ嚎</span>
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
                    閫€鍑虹櫥褰?
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
{activeNav !== 'master' && activeNav !== 'models' && (
              <Button icon={<IconPlus />} type="primary" onClick={() => openDrawer()}>
                {meta.action}
              </Button>
            )}
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
          {activeNav === 'settings' ? renderSettingsPage(displayName, email, avatarUrl, avatarKey, setAvatarKey, settingsTab, setSettingsTab, logout) : null}
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
          <h3>鍏ㄥ眬缂栨帓鑰?/h3>
          <p>涓绘櫤鑳戒綋榛樿鎷ユ湁鍏ㄩ噺鑳藉姏锛屼絾鍙互鍦ㄨ繖閲屾敹绐勮闂寖鍥淬€?/p>
        </div>
        <div className="form-surface">
          <label>
            绯荤粺鎻愮ず璇?
            <Input.TextArea
              defaultValue="浣犳槸 CareerForge 灏变笟鎬诲姪鎵嬶紝璐熻矗璺敱瀛愭櫤鑳戒綋銆佽皟鐢ㄥ伐鍏峰拰鐭ヨ瘑搴擄紝骞朵互娓呮櫚銆佸彲鎵ц鐨勫缓璁府鍔╁鐢熷畬鎴愭眰鑱屽噯澶囥€?
              autoSize={{ minRows: 4, maxRows: 6 }}
            />
          </label>
          <div className="switch-list">
            <Switch defaultChecked />
            <span>妯″瀷鍒囨崲鍚庡悓姝ヤ紶閫掔粰琚皟鐢ㄧ殑瀛愭櫤鑳戒綋</span>
          </div>
          <div className="switch-list">
            <Switch defaultChecked />
            <span>瀛愭櫤鑳戒綋璁板繂鐙珛闅旂锛屼粎缁撴灉鎽樿鍥炴祦涓诲璇?/span>
          </div>
          <Button type="primary" onClick={() => openDrawer('master')}>
            淇濆瓨缂栨帓閰嶇疆
          </Button>
        </div>
      </section>

      <section className="route-panel">
        <div className="admin-section-title">
          <h3>璺敱绛栫暐</h3>
          <p>褰撳鐢熸剰鍥惧懡涓椂锛屼富鏅鸿兘浣撳皢娲惧彂缁欏搴斿瓙鏅鸿兘浣撱€?/p>
        </div>
        <div className="route-list">
          {ROUTES.map((route) => (
            <div key={route.intent} className="route-row">
              <div>
                <strong>{route.intent}</strong>
                <p>{route.memory}</p>
              </div>
              <Tag color={route.agent === '绠€鍘嗕紭鍖? ? 'orange' : 'arcoblue'}>{route.agent}</Tag>
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
  const categoryOptions = Array.from(new Set(mcps.map((service) => service.category || '閫氱敤').filter(Boolean)))
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
                <p>{detailService.description || '绠＄悊鍛樺皻鏈～鍐欐湇鍔′粙缁嶃€?}</p>
                <div className="mcp-detail-tags">
                  <Tag color={statusColor(detailService.status)}>{statusLabel(detailService.status)}</Tag>
                  <Tag color={detailService.transport === 'Streamable HTTP' ? 'arcoblue' : 'green'}>{detailService.transport}</Tag>
                  <Tag bordered>{detailService.category || '閫氱敤'}</Tag>
                  <Tag bordered>{detailService.owner || '鏈缃礋璐ｄ汉'}</Tag>
                </div>
              </div>
            </div>
            <Button className="mcp-back-button" type="outline" onClick={() => setMcpDetailId(null)}>
              鈫?杩斿洖 MCP 骞垮満
            </Button>
          </div>
          <div className="mcp-detail-actions">
            <Button type="outline" icon={<IconSettings />} onClick={() => onEdit(detailService)}>
              缂栬緫閰嶇疆
            </Button>
            <Popconfirm title={`纭畾涓嬫灦 ${detailService.name} 鍚楋紵`} okText="涓嬫灦" cancelText="鍙栨秷" onOk={() => onDelete(detailService)}>
              <Button type="outline" status="danger" icon={<IconPoweroff />}>
                涓嬫灦
              </Button>
            </Popconfirm>
            <Button type="primary" icon={<IconRobot />} onClick={() => setMcpDetailTab('test')}>
              宸ュ叿娴嬭瘯
            </Button>
          </div>
        </section>

        <Tabs className="mcp-detail-tabs" activeTab={mcpDetailTab} onChange={setMcpDetailTab}>
          <Tabs.TabPane key="detail" title="鏈嶅姟璇︽儏">
            <section className="mcp-detail-layout">
              <article className="mcp-doc-panel">
                <h3>鑾峰彇 MCP 鏈嶅姟鍣?/h3>
                <p>{detailService.description || '璇?MCP 鏈嶅姟宸叉帴鍏ユ暟鎹簱锛屽彲琚巿鏉冩櫤鑳戒綋鎸夊伐鍏锋竻鍗曡皟鐢ㄣ€?}</p>
                <h3>鍙敤宸ュ叿</h3>
                {detailService.tools.length > 0 ? (
                  <div className="mcp-doc-tool-list">
                    {detailService.tools.map((tool) => (
                      <div key={tool.name}>
                        <strong>{tool.name}</strong>
                        <span>{tool.description || '鏆傛棤宸ュ叿璇存槑'}</span>
                        <Tag color={tool.risk === '楂橀闄? ? 'red' : tool.risk === '涓闄? ? 'orange' : 'green'}>{tool.risk}</Tag>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mcp-empty-mini">杩樻病鏈夊伐鍏枫€傜鐞嗗憳鍙互鐐瑰嚮鈥滃彂鐜扳€濇垨鈥滅紪杈戦厤缃€濈淮鎶ゅ伐鍏锋竻鍗曘€?/div>
                )}
                <h3>Agent 璋冪敤杈圭晫</h3>
                <p>鍙湁涓嬫柟鏈嶅姟閰嶇疆涓巿鏉冪殑涓?Agent 鎴栧瓙鏅鸿兘浣撳彲浠ヨ皟鐢ㄨ MCP銆備繚瀛樺悗锛屽伐鍏蜂細杩涘叆缁熶竴宸ュ叿姹狅紝鐢变富 Agent 缂栨帓鏃舵敞鍏ユā鍨嬨€?/p>
              </article>

              <aside className="mcp-config-panel">
                <div className="mcp-config-head">
                  <strong>鏈嶅姟閰嶇疆</strong>
                  <Tag color="green">鍙儴缃?/Tag>
                </div>
                <div className="mcp-config-card">
                  <span>浼犺緭绫诲瀷</span>
                  <strong>{detailService.transport}</strong>
                </div>
                <div className="mcp-config-card">
                  <span>杩炴帴鍦板潃</span>
                  <strong>{detailService.endpoint}</strong>
                </div>
                <div className="mcp-config-grid">
                  <div>
                    <span>閴存潈绫诲瀷</span>
                    <strong>{detailService.auth_type}</strong>
                  </div>
                  <div>
                    <span>鏈€杩戞娴?/span>
                    <strong>{formatDateTime(detailService.last_checked_at)}</strong>
                  </div>
                </div>
                <Button type="primary" long onClick={() => onTest(detailService)}>
                  杩炴帴娴嬭瘯
                </Button>
                <Button long type="outline" onClick={() => onDiscover(detailService)}>
                  宸ュ叿鍙戠幇
                </Button>
              </aside>
            </section>
          </Tabs.TabPane>

          <Tabs.TabPane key="test" title="宸ュ叿娴嬭瘯">
            <section className="mcp-detail-layout">
              <article className="mcp-doc-panel">
                <div className="mcp-call-form is-horizontal">
                  <Select value={mcpCallDraft.agentId} placeholder="璋冪敤鏅鸿兘浣? onChange={(value) => patchMcpCallDraft({ agentId: value })}>
                    {agentOptions.map((agent) => (
                      <Select.Option key={agent.id} value={agent.id}>
                        {agent.name}
                      </Select.Option>
                    ))}
                  </Select>
                  <Select value={mcpCallDraft.toolName || undefined} placeholder="宸ュ叿" onChange={(value) => patchMcpCallDraft({ toolName: value })}>
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
                  placeholder="杈撳叆宸ュ叿鍙傛暟锛屼緥濡傚矖浣嶅叧閿瘝銆佸煄甯傘€佽柂璧勮寖鍥?
                  onChange={(value) => patchMcpCallDraft({ input: value })}
                />
                <Button type="primary" icon={<IconRobot />} disabled={!detailService.tools.length} onClick={runMcpCall}>
                  鎵ц璋冪敤
                </Button>
                <pre className="mcp-call-result is-detail">
                  {mcpCallDraft.result || '鎵ц缁撴灉浼氭樉绀烘櫤鑳戒綋銆佸伐鍏枫€佽姹傚弬鏁般€佺粨鏋勫寲鍝嶅簲鍜?trace銆?}
                </pre>
              </article>
              <aside className="mcp-config-panel">
                <div className="mcp-config-head">
                  <strong>宸叉巿鏉冩櫤鑳戒綋</strong>
                </div>
                <div className="mcp-agent-chip-list">
                  {detailService.agent_ids.length ? (
                    detailService.agent_ids.map((agentId) => {
                      const agent = agentOptions.find((item) => item.id === agentId)
                      return <Tag key={agentId} color="arcoblue">{agent?.name ?? agentId}</Tag>
                    })
                  ) : (
                    <Tag color="orange">鏈巿鏉?/Tag>
                  )}
                </div>
                <div className="mcp-tool-pool">
                  <div className="mcp-tool-pool-head">
                    <strong>Agent 宸ュ叿姹?/strong>
                    <span>鍐呯疆宸ュ叿浼樺厛锛屽叾娆?Skill锛屾渶鍚庡悎骞跺凡鍚敤 MCP 宸ュ叿銆?/span>
                  </div>
                  {mcpToolPool.tools.map((tool) => (
                    <div key={`${tool.source}-${tool.name}`} className="mcp-tool-pool-row">
                      <div>
                        <strong>{tool.name}</strong>
                        <span>{tool.provider}</span>
                      </div>
                      <Tag color={tool.source === 'builtin' ? 'green' : tool.source === 'skill' ? 'arcoblue' : 'orange'} bordered>
                        {tool.source === 'builtin' ? '鍐呯疆' : tool.source === 'skill' ? 'Skill' : 'MCP'}
                      </Tag>
                    </div>
                  ))}
                </div>
              </aside>
            </section>
          </Tabs.TabPane>

          <Tabs.TabPane key="logs" title={`璋冪敤鏃ュ織 ${serviceLogs.length}`}>
            <section className="mcp-doc-panel">
              {serviceLogs.length > 0 ? (
                serviceLogs.map((log) => (
                  <div key={log.id} className="mcp-log-row">
                    <div>
                      <strong>{log.agent_name}</strong>
                      <span>
                        {log.service_name} / {log.tool_name} 路 {formatDateTime(log.created_at)}
                      </span>
                    </div>
                    <Tag color={log.success ? 'green' : 'red'}>{log.success ? `${log.latency_ms ?? 0}ms` : '澶辫触'}</Tag>
                  </div>
                ))
              ) : (
                <div className="mcp-empty-mini">鏆傛棤璋冪敤鏃ュ織</div>
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
          <strong>MCP 鏈嶅姟</strong>
          <Tag bordered>MCP 浣撻獙</Tag>
        </div>
        <Input
          className="mcp-market-search"
          allowClear
          placeholder={`鎼滅储 MCP 鏈嶅姟锛堝叡 ${mcps.length} 涓級`}
          value={mcpSearch}
          onChange={setMcpSearch}
        />
        <div className="mcp-type-filter">
          <span>鏈嶅姟绫诲瀷锛?/span>
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
            <span>鍏ㄩ儴鏈嶅姟</span>
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
              <b>{mcps.filter((service) => (service.category || '閫氱敤') === category).length}</b>
            </button>
          ))}
        </aside>

        <div className="mcp-market-main">
          <div className="mcp-market-toolbar">
            <div className="mcp-result-line">
              <span>
                鍏辨壘鍒?<b>{filteredMcps.length}</b> 涓粨鏋?
              </span>
              {mcpCategoryFilter !== 'all' ? (
                <Tag closable onClose={() => setMcpCategoryFilter('all')}>
                  {mcpCategoryFilter}
                </Tag>
              ) : null}
            </div>
            <Select value={mcpStatusFilter} onChange={setMcpStatusFilter}>
              <Select.Option value="all">鍏ㄩ儴鐘舵€?/Select.Option>
              <Select.Option value="enabled">宸插惎鐢?/Select.Option>
              <Select.Option value="disabled">宸插仠鐢?/Select.Option>
              <Select.Option value="error">寮傚父</Select.Option>
            </Select>
            <Button type="outline" icon={<IconHistory />} onClick={() => setShowMcpLogs(!showMcpLogs)}>
              {showMcpLogs ? '鍥炲埌鏈嶅姟' : '瀹¤璁板綍'}
            </Button>
            <Button type="primary" icon={<IconPlus />} onClick={() => openDrawer('mcp')}>
              娣诲姞鏈嶅姟
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
                        {log.service_name} / {log.tool_name} 路 {formatDateTime(log.created_at)}
                      </span>
                    </div>
                    <Tag color={log.success ? 'green' : 'red'}>{log.success ? `${log.latency_ms ?? 0}ms` : '澶辫触'}</Tag>
                  </div>
                ))
              ) : (
                <div className="mcp-empty-mini">鏆傛棤璋冪敤鏃ュ織</div>
              )}
            </section>
          ) : (
            <section className="mcp-card-grid">
              {mcpLoading ? <div className="mcp-empty-state">姝ｅ湪璇诲彇鏁版嵁搴?MCP 鏈嶅姟...</div> : null}
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
                  <p>{service.description || '绠＄悊鍛樺皻鏈～鍐欐湇鍔′粙缁嶃€?}</p>
                  <div className="mcp-market-card-tags">
                    <Tag bordered>{service.category || '閫氱敤'}</Tag>
                    <Tag bordered>{detailOwnerLabel(service)}</Tag>
                    <Tag bordered>{service.tools.length} 宸ュ叿</Tag>
                  </div>
                  <div className="mcp-market-card-foot">
                    <span>@{service.slug}</span>
                    <span>{service.latency_ms ? `${service.latency_ms}ms` : '鏈祴璇?}</span>
                    <span>{formatDateTime(service.last_checked_at)}</span>
                  </div>
                </article>
              ))}
              {!mcpLoading && filteredMcps.length === 0 ? (
                <div className="mcp-empty-state">
                  <IconSafe />
                  <strong>{mcps.length === 0 ? '杩樻病鏈?MCP 鏈嶅姟' : '娌℃湁鍖归厤鐨?MCP 鏈嶅姟'}</strong>
                  <span>{mcps.length === 0 ? '鏁版嵁搴撲腑鏆傛棤璁板綍锛岃鎵嬪姩娣诲姞绗竴涓?MCP 鏈嶅姟銆? : '璋冩暣绛涢€夋潯浠舵垨鏂板缓涓€涓湇鍔℃帴鍏ラ厤缃€?}</span>
                  <Button type="primary" icon={<IconPlus />} onClick={() => openDrawer('mcp')}>
                    娣诲姞 MCP 鏈嶅姟
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
        <Tabs.TabPane key="all" title="鍏ㄩ儴" />
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
                <h3>姝ｅ湪鍔犺浇 Skills</h3>
                <Tag color="arcoblue">File Based</Tag>
              </div>
            </div>
            <p>姝ｅ湪浠庡悗绔鍙?Skill 鏂囦欢璧勪骇銆?/p>
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
            <p>{skill.description || '杩欎釜 Skill 鏆傛湭濉啓璇存槑锛孉gent 浼氱洿鎺ユ寜鏂囦欢鍐呭浣跨敤銆?}</p>
            <div className="meta-list">
              <span>鍒嗙被锛歿skill.category}</span>
              <span>鐗堟湰锛歿skill.version}</span>
              <span>Slug锛歿skill.slug}</span>
              <span>Hash锛歿skill.content_hash.slice(0, 12)}</span>
            </div>
            {skill.tags.length > 0 ? <AbilityChips title="鏍囩" items={skill.tags} compact /> : null}
            <div className="admin-card-footer">
              <Tag color={skill.status === 'enabled' ? 'green' : 'gray'}>
                {skill.status === 'enabled' ? '鍚敤' : '鍋滅敤'}
              </Tag>
              <Space size={4}>
                <Button type="text" size="small" onClick={() => onEdit(skill)}>
                  缂栬緫鏂囦欢
                </Button>
                <Button type="text" size="small" onClick={() => onToggleStatus(skill)}>
                  {skill.status === 'enabled' ? '鍋滅敤' : '鍚敤'}
                </Button>
                <Popconfirm title="纭畾鍒犻櫎杩欎釜 Skill 鍚楋紵" okText="鍒犻櫎" cancelText="鍙栨秷" onOk={() => onDelete(skill)}>
                  <Button type="text" status="danger" size="small">
                    鍒犻櫎
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
                <h3>杩樻病鏈?Skill 鏂囦欢</h3>
                <Tag color="orange">绛夊緟娣诲姞</Tag>
              </div>
            </div>
            <p>鍙互涓婁紶鎴栫矘璐?Skill 鏂囦欢锛屽惎鐢ㄥ悗浼氳繘鍏ュ彲澶嶇敤鑳藉姏姹犮€?/p>
          </Card>
        ) : null}
        <button className="admin-add-card" type="button" onClick={() => openDrawer('skill')}>
          <IconPlus />
          <strong>娣诲姞 Skill 鏂囦欢</strong>
          <span>涓婁紶鎴栫矘璐?SKILL.md / .txt</span>
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
              <p>{kb.docs} 鏂囨。 路 {kb.chunks} chunks 路 鏇存柊 {kb.update}</p>
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
            鎺堟潈閰嶇疆
          </Button>
        </div>
      ))}
      <button className="kb-add-row" type="button" onClick={() => openDrawer('knowledge')}>
        <IconPlus />
        <span>鏂板缓鐭ヨ瘑搴?/ 涓婁紶鏂囨。</span>
      </button>
    </section>
  )
}

function renderSettingsPage(displayName: string, email: string, avatarUrl: string, avatarKey: number, setAvatarKey: (v: number | ((prev: number) => number)) => void, settingsTab: string, setSettingsTab: (v: string | ((prev: string) => string)) => void, logout: () => void) {

  if (settingsTab === 'account') return renderAccountSection(displayName, email, avatarUrl, avatarKey, setAvatarKey, logout, () => setSettingsTab(''))
  if (settingsTab === 'system') return <><div style={{ marginBottom: 16 }}><Button type="text" onClick={() => setSettingsTab('')} style={{ padding: 0, color: "#165dff" }}>鈫?杩斿洖</Button></div><SystemSettings /></>

  return (
    <div>
      <div className="admin-section-title" style={{ marginBottom: 24 }}>
        <h3>绯荤粺璁剧疆</h3>
        <p>绠＄悊璐﹀彿銆佺郴缁熼厤缃笌搴旂敤鍋忓ソ銆?/p>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 璐﹀彿淇℃伅鍗＄墖 */}
        <div
          onClick={() => setSettingsTab('account')}
          style={{
            flex: '1 1 180px', minWidth: 160, maxWidth: 220,
            padding: '24px 20px', borderRadius: 16, cursor: 'pointer',
            background: '#fff', border: '1px solid #e5e6eb',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#165dff'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(22,93,255,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e6eb'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.04)' }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #e8f0ff, #d0e0ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <IconUser style={{ fontSize: 24, color: '#165dff' }} />
          </div>
          <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>璐﹀彿淇℃伅</h4>
          <p style={{ margin: 0, fontSize: 13, color: '#86909C' }}>澶村儚銆佹樀绉般€侀偖绠变笌閫€鍑?/p>
        </div>

        {/* 绯荤粺閰嶇疆鍗＄墖 */}
        <div
          onClick={() => setSettingsTab('system')}
          style={{
            flex: '1 1 180px', minWidth: 160, maxWidth: 220,
            padding: '24px 20px', borderRadius: 16, cursor: 'pointer',
            background: '#fff', border: '1px solid #e5e6eb',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#165dff'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(22,93,255,0.12)' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = '#e5e6eb'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.04)' }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #e8fff0, #d0ffe0)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <IconSettings style={{ fontSize: 24, color: '#00b42a' }} />
          </div>
          <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>绯荤粺閰嶇疆</h4>
          <p style={{ margin: 0, fontSize: 13, color: '#86909C' }}>鍏憡銆佺淮鎶ゆā寮忋€佸钩鍙板悕绉?/p>
        </div>

        {/* 杩愯鍋忓ソ鍗＄墖 */}
        <div
          style={{
            flex: '1 1 180px', minWidth: 160, maxWidth: 220,
            padding: '24px 20px', borderRadius: 16,
            background: '#fff', border: '1px solid #e5e6eb',
            boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
            opacity: 0.5,
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg, #fff0e8, #ffe0d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
            <IconSafe style={{ fontSize: 24, color: '#ff7d00' }} />
          </div>
          <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>杩愯鍋忓ソ</h4>
          <p style={{ margin: 0, fontSize: 13, color: '#86909C' }}>鍗冲皢鎺ㄥ嚭 路 瀹¤涓庨€氱煡绛栫暐</p>
        </div>
      </div>
    </div>
  )
}

function renderAccountSection(displayName: string, email: string, avatarUrl: string, avatarKey: number, setAvatarKey: (v: number | ((prev: number) => number)) => void, logout: () => void, onBack: () => void) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Button type="text" icon={<IconArrowLeft />} onClick={onBack} />
        <h3 style={{ margin: 0 }}>璐﹀彿淇℃伅</h3>
      </div>
      <section className="form-surface">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <Avatar size={80} style={{ marginBottom: 12 }}>
            {avatarUrl ? (
              <img key={avatarKey} src={avatarUrl} alt="avatar" />
            ) : (
              <IconUser />
            )}
          </Avatar>
          <div style={{ marginTop: 12 }}>
            <Upload
              showUploadList={false}
              accept=".png,.jpg,.jpeg,.gif,.webp"
              customRequest={async (option) => {
                const formData = new FormData()
                formData.append('file', option.file)
                try {
                  await apiRequest<{ avatar_url: string }>('/api/v1/auth/avatar', {
                    method: 'POST',
                    body: formData,
                  })
                  setAvatarKey(k => k + 1)
                  Message.success('澶村儚涓婁紶鎴愬姛')
                  setTimeout(() => window.location.reload(), 500)
                } catch (err) {
                  Message.error(err instanceof ApiError ? err.message : '涓婁紶澶辫触')
                }
              }}
            >
              <Button size="small" type="outline">涓婁紶澶村儚</Button>
            </Upload>
          </div>
        </div>
        <div className="setting-field">
          <span>褰撳墠璐﹀彿</span>
          <strong>{displayName}</strong>
        </div>
        <div className="setting-field">
          <span>閭</span>
          <strong>{email || '鏈粦瀹?}</strong>
        </div>
      </section>
      <section className="form-surface" style={{ marginTop: 16 }}>
        <Popconfirm title="纭畾瑕侀€€鍑虹櫥褰曞悧锛? okText="閫€鍑? cancelText="鍙栨秷" onOk={logout}>
          <Button type="outline" status="danger" icon={<IconPoweroff />} long>
            閫€鍑虹櫥褰?
          </Button>
        </Popconfirm>
      </section>
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
    agent: `閰嶇疆鏅鸿兘浣?路 ${selectedAgent.name}`,
    master: '缂栬緫涓绘櫤鑳戒綋閰嶇疆',
    model: '娣诲姞妯″瀷',
    mcp: editingMcpId ? '缂栬緫 MCP 鏈嶅姟' : '娣诲姞 MCP 鏈嶅姟',
    skill: editingSkillId ? '缂栬緫 Skill 鏂囦欢' : '娣诲姞 Skill 鏂囦欢',
    knowledge: '鏂板缓鐭ヨ瘑搴?,
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
          <Button onClick={onClose}>鍙栨秷</Button>
          <Button type="primary" loading={isSaving} onClick={onSave}>
            淇濆瓨
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
      <Input defaultValue={agent.name} addBefore="鍚嶇О" />
      <Input.TextArea defaultValue={agent.desc} autoSize={{ minRows: 3, maxRows: 4 }} />
      <Select mode="multiple" defaultValue={agent.models} placeholder="鍙敤妯″瀷鑼冨洿">
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
        <span>鍏佽琚富鏅鸿兘浣撹皟鐢?/span>
      </div>
      <div className="switch-list">
        <Switch defaultChecked={agent.status === '宸插彂甯?} />
        <span>鍙戝竷鍒板鐢熺鏅鸿兘浣撳箍鍦?/span>
      </div>
    </Space>
  )
}

function MasterDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Select defaultValue="DeepSeek V3" placeholder="榛樿妯″瀷">
        {MODELS.filter((model) => model.enabled).map((model) => (
          <Select.Option key={model.name} value={model.name}>
            {model.name}
          </Select.Option>
        ))}
      </Select>
      <Input.TextArea
        defaultValue="涓绘櫤鑳戒綋璐熻矗鎬绘帶銆佽矾鐢便€佸厹搴曢棶绛斿拰缁撴灉姹囨€汇€傝皟鐢ㄥ瓙鏅鸿兘浣撴椂浼犻€掑綋鍓嶆ā鍨嬶紝浣嗕繚鎸佷細璇濊蹇嗛殧绂汇€?
        autoSize={{ minRows: 5, maxRows: 8 }}
      />
      <Checkbox.Group
        defaultValue={['鍏ㄩ儴 Skills', '鍏ㄩ儴 MCP', '鍏ㄩ儴鐭ヨ瘑搴?]}
        options={['鍏ㄩ儴 Skills', '鍏ㄩ儴 MCP', '鍏ㄩ儴鐭ヨ瘑搴?]}
      />
    </Space>
  )
}

function ModelDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Select defaultValue="DeepSeek" placeholder="妯″瀷渚涘簲鍟?>
        {['DeepSeek', 'OpenAI 鍏煎', 'Anthropic', 'Ollama路鏈湴', '鑷畾涔?].map((item) => (
          <Select.Option key={item} value={item}>
            {item}
          </Select.Option>
        ))}
      </Select>
      <Input defaultValue="DeepSeek 瀵硅瘽-鐢熶骇" addBefore="鏄剧ず鍚嶇О" />
      <Input defaultValue="https://api.deepseek.com/v1" addBefore="Base URL" />
      <Input.Password defaultValue="sk-0000000000000000" addBefore="API Key" />
      <Input defaultValue="deepseek-chat" addBefore="妯″瀷鏍囪瘑" />
      <div className="test-result success">杩炴帴鎴愬姛 路 寤惰繜 420ms 路 妯″瀷宸插氨缁?/div>
      <div className="switch-list">
        <Switch defaultChecked />
        <span>瀵瑰鐢熷紑鏀?/span>
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
      tools: [...draft.tools, { name: '', description: '', risk: '浣庨闄?, enabled: true, input_schema: {} }],
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
          <h3>娣诲姞鍙鏅鸿兘浣撹皟鐢ㄧ殑宸ュ叿鏈嶅姟</h3>
        </div>
        <Tag color="arcoblue" bordered>
          Database
        </Tag>
      </div>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>鏈嶅姟韬唤</strong>
          <span>鎵嬪姩褰曞叆鍚庝繚瀛樺埌鏁版嵁搴擄紝鐢ㄤ簬骞垮満妫€绱㈠拰鏅鸿兘浣撹矾鐢?/span>
        </div>
        <Input value={draft.name} placeholder="MCP 鏈嶅姟鍚嶇О" addBefore="鍚嶇О" onChange={(value) => onChange({ name: value })} />
        <Input.TextArea
          value={draft.description}
          placeholder="鎻忚堪杩欎釜 MCP 鍙互鎻愪緵鍝簺涓氬姟鑳藉姏"
          autoSize={{ minRows: 3, maxRows: 4 }}
          onChange={(value) => onChange({ description: value })}
        />
        <div className="mcp-apple-grid">
          <Select value={draft.category || undefined} placeholder="鏈嶅姟鍒嗙被" onChange={(value) => onChange({ category: value })}>
            {['鎷涜仒鏁版嵁', '瀛︾敓鏈嶅姟', '鎼滅储宸ュ叿', '浼佷笟璧勬枡', '鍐呭閲囬泦', '鏂囨。澶勭悊', '鏃ョ▼鍗忓悓', '骞冲彴娌荤悊', '閫氱敤'].map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Input value={draft.owner} placeholder="璐熻矗浜烘垨鍥㈤槦" addBefore="璐熻矗浜? onChange={(value) => onChange({ owner: value })} />
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>杩炴帴鍗忚</strong>
          <span>鏀寔 stdio / SSE / Streamable HTTP锛屼繚瀛樺悗鍙繘琛岃繛鎺ユ祴璇?/span>
        </div>
        <Select value={draft.transport} placeholder="浼犺緭鏂瑰紡" onChange={(value) => onChange({ transport: value })}>
          {['stdio', 'SSE', 'Streamable HTTP'].map((item) => (
            <Select.Option key={item} value={item}>
              {item}
            </Select.Option>
          ))}
        </Select>
        <Input value={draft.endpoint} placeholder="鍛戒护鎴?URL" addBefore="鍦板潃" onChange={(value) => onChange({ endpoint: value })} />
        <div className="mcp-apple-grid">
          <Select value={draft.authType} placeholder="閴存潈鏂瑰紡" onChange={(value) => onChange({ authType: value })}>
            {['鏃犻壌鏉?, 'Bearer Token', 'API Key', 'OAuth 2.0', '鏈湴娌欑'].map((item) => (
              <Select.Option key={item} value={item}>
                {item}
              </Select.Option>
            ))}
          </Select>
          <Input value={draft.authConfig} placeholder="閴存潈閰嶇疆" addBefore="閴存潈" onChange={(value) => onChange({ authConfig: value })} />
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>鏅鸿兘浣撴巿鏉?/strong>
          <span>杩欓噷璇诲彇鐪熷疄鏅鸿兘浣撴帴鍙ｏ紱鍙湁琚巿鏉冪殑鏅鸿兘浣撴墠鑳借皟鐢?/span>
        </div>
        <Select
          mode="multiple"
          value={draft.agentIds}
          loading={agentOptionsLoading}
          placeholder="閫夋嫨鍙皟鐢ㄨ MCP 鐨勬櫤鑳戒綋"
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
          <strong>宸ュ叿鏆撮湶</strong>
          <span>鎵嬪姩缁存姢 MCP 鏆撮湶鐨勫伐鍏凤紱淇濆瓨鍚庤繘鍏?Agent 宸ュ叿姹?/span>
        </div>
        <div className="mcp-tool-editor">
          {draft.tools.map((tool, index) => (
            <div key={index} className="mcp-tool-editor-row">
              <Input value={tool.name} placeholder="宸ュ叿鍚嶏紝濡?web_search" onChange={(value) => updateTool(index, { name: value })} />
              <Input value={tool.description} placeholder="宸ュ叿璇存槑" onChange={(value) => updateTool(index, { description: value })} />
              <Select value={tool.risk} onChange={(value) => updateTool(index, { risk: value })}>
                <Select.Option value="浣庨闄?>浣庨闄?/Select.Option>
                <Select.Option value="涓闄?>涓闄?/Select.Option>
                <Select.Option value="楂橀闄?>楂橀闄?/Select.Option>
              </Select>
              <Button type="text" status="danger" onClick={() => removeTool(index)}>
                鍒犻櫎
              </Button>
            </div>
          ))}
          {draft.tools.length === 0 ? <div className="mcp-empty-mini">杩樻病鏈夊伐鍏凤紝淇濆瓨鏈嶅姟鍚庝篃鍙互绋嶅悗鍙戠幇鎴栫紪杈戙€?/div> : null}
          <Button type="outline" icon={<IconPlus />} onClick={addTool}>
            娣诲姞宸ュ叿
          </Button>
        </div>
      </section>

      <section className="mcp-apple-card">
        <div className="mcp-apple-card-head">
          <strong>宸ュ叿姹犵瓥鐣?/strong>
          <span>鍙戝竷鍚庢寜浼樺厛绾ф敞鍏ョ粰妯″瀷锛岄伩鍏嶅悓鍚嶅伐鍏峰啿绐?/span>
        </div>
        <div className="mcp-priority-flow">
          {[
            ['1', '鍐呯疆宸ュ叿', '纭紪鐮佽兘鍔涳紝鏈€楂樹紭鍏堢骇'],
            ['2', 'Skill 宸ュ叿', '浠庢暟鎹簱鍔ㄦ€佸姞杞?],
            ['3', 'MCP 宸ュ叿', '杩愯鏃跺彂鐜板苟鍚堝苟'],
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
          <span>鍚敤鏈嶅姟</span>
        </div>
        <div className="switch-list">
          <Switch checked={draft.autoDisableOnError} onChange={(checked) => onChange({ autoDisableOnError: checked })} />
          <span>寮傚父鏃惰嚜鍔ㄤ粠鏅鸿兘浣撹矾鐢变腑鎽橀櫎</span>
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
          <strong>鏂囦欢鍖?Skill</strong>
          <p>涓婁紶 SKILL.md 鏂囦欢锛屾垨鐩存帴缂栬緫涓嬫柟鍐呭銆?/p>
        </div>
        <Button type="outline" onClick={() => fileInputRef.current?.click()}>
          涓婁紶鏂囦欢
        </Button>
        <input ref={fileInputRef} type="file" accept=".md,.txt" hidden onChange={handleFileChange} />
      </div>
      <div className="skill-editor-meta">
        <Input value={draft.name} addBefore="Skill 鍚嶇О" placeholder="鐣欑┖鍒欎粠鏂囦欢瑙ｆ瀽" onChange={(value) => onChange({ name: value })} />
        <Input value={draft.category} addBefore="鍒嗙被" placeholder="渚嬪锛氱畝鍘?/ 姹傝亴 / 闈㈣瘯" onChange={(value) => onChange({ category: value })} />
        <Input value={draft.version} addBefore="鐗堟湰" placeholder="1.0.0" onChange={(value) => onChange({ version: value })} />
      </div>
      <Input.TextArea
        value={draft.description}
        placeholder="涓€鍙ヨ瘽璇存槑杩欎釜 Skill 鑳藉仛浠€涔堬紱涔熷彲鐣欑┖锛屼粠 frontmatter 瑙ｆ瀽"
        autoSize={{ minRows: 3, maxRows: 4 }}
        onChange={(value) => onChange({ description: value })}
      />
      <Input value={draft.tagsText} addBefore="鏍囩" placeholder="鐢ㄩ€楀彿鍒嗛殧锛屼緥濡傦細绠€鍘? STAR, 璇勫垎" onChange={(value) => onChange({ tagsText: value })} />
      <Input value={draft.fileName} addBefore="鏂囦欢鍚? placeholder="SKILL.md" onChange={(value) => onChange({ fileName: value })} />
      <Input.TextArea
        className="skill-code-editor"
        value={draft.content}
        placeholder="鍦ㄨ繖閲岀矘璐?SKILL.md 鍐呭"
        autoSize={{ minRows: 14, maxRows: 22 }}
        onChange={(value) => onChange({ content: value })}
      />
      <div className="switch-list">
        <Switch checked={draft.status === 'enabled'} onChange={(checked) => onChange({ status: checked ? 'enabled' : 'disabled' })} />
        <span>鍚敤 Skill</span>
      </div>
    </Space>
  )
}

function KnowledgeDrawerContent() {
  return (
    <Space direction="vertical" size={18} style={{ width: '100%' }}>
      <Input defaultValue="浼佷笟璧勬枡搴? addBefore="鐭ヨ瘑搴撳悕绉? />
      <Input.TextArea placeholder="鎻忚堪鐭ヨ瘑搴撶敤閫斻€佹暟鎹潵婧愪笌鏇存柊鑺傚" autoSize={{ minRows: 3, maxRows: 4 }} />
      <Checkbox.Group defaultValue={['涓绘櫤鑳戒綋']} options={['涓绘櫤鑳戒綋', ...AGENTS.map((agent) => agent.name)]} />
      <div className="upload-dropzone">
        <IconPlus />
        <span>鎷栨嫿鎴栫偣鍑讳笂浼犳枃妗ｏ紝闅忓悗杩涜瑙ｆ瀽銆佸垏鐗囦笌鍚戦噺鍖?/span>
      </div>
      <div className="switch-list">
        <Switch defaultChecked />
        <span>鍏佽涓绘櫤鑳戒綋鎸夐渶璁块棶宸叉巿鏉冨唴瀹?/span>
      </div>
    </Space>
  )
}
