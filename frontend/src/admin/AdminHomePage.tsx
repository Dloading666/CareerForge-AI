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
  Tooltip,
  Upload,
  Modal,
  Badge,
} from '@arco-design/web-react'
import {
  IconApps,
  IconExperiment,
  IconImage,
  IconMessage,
  IconNotification,
  IconPlus,
  IconPoweroff,
  IconSettings,
  IconUser,
} from '@arco-design/web-react/icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { apiRequest, ApiError } from '../shared/api'
import { useAuth } from '../shared/auth'
import { ModelPlaza } from './ModelPlaza'
import { AgentManagementPage } from './AgentManagementPage'
import { SystemSettings } from './SystemSettings'
import { FeedbackPage } from './FeedbackPage'

type NavKey = 'agents' | 'master' | 'models' | 'vision' | 'skills' | 'settings' | 'feedback'
type DrawerMode = 'agent' | 'master' | 'model' | 'skill'
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

type VisionProtocol = 'openai' | 'anthropic'

type VisionConfig = {
  id: number
  tenant_id: number
  enabled: boolean
  protocol: VisionProtocol
  base_url: string | null
  model_name: string | null
  has_api_key: boolean
  max_tokens: number
  updated_at: string
}

type VisionDraft = {
  enabled: boolean
  protocol: VisionProtocol
  base_url: string
  model_name: string
  api_key: string
  max_tokens: number
}

type VisionTestResult = {
  success: boolean
  latency_ms: number | null
  error: string | null
  preview: string | null
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
    models: ['GPT-4o Mini'],
    callable: false,
    route: '简历建议 / 项目经历',
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

const ROUTES = [
  { intent: '模拟面试 / 面试复盘', agent: 'AI 面试官', memory: '独立线程，仅回传结果摘要' },
  { intent: '岗位匹配 / JD 分析', agent: '岗位匹配', memory: '独立线程，仅回传匹配报告' },
  { intent: '简历建议 / 项目经历', agent: '简历优化', memory: '草稿期，暂不对学生开放' },
]

const pageMeta: Record<NavKey, { title: string; desc: string; action?: string; drawer?: DrawerMode }> = {
  agents: {
    title: '智能体管理',
    desc: '组装子智能体的模型范围、Skills 与专属知识库，并控制是否允许被主智能体调用。',
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
  vision: {
    title: '视觉配置',
    desc: '配置视觉模型，让学生对话中发送的图片能被 AI 理解。填写接口地址、密钥、模型名与协议即可。',
  },
  skills: {
    title: 'Skills 广场',
    desc: '管理可复用原子能力，作为智能体装配时的技能池。',
    action: '新建 Skill',
    drawer: 'skill',
  },
  feedback: {
    title: '用户反馈',
    desc: '查看和处理学生提交的Bug反馈与功能建议。',
    action: '',
    drawer: '' as DrawerMode,
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

function createEmptyVisionDraft(): VisionDraft {
  return {
    enabled: true,
    protocol: 'openai',
    base_url: '',
    model_name: '',
    api_key: '',
    max_tokens: 1024,
  }
}

function visionConfigToDraft(config: VisionConfig): VisionDraft {
  return {
    enabled: config.enabled,
    protocol: config.protocol,
    base_url: config.base_url ?? '',
    model_name: config.model_name ?? '',
    // api_key 永不回显明文；留空表示「不修改」
    api_key: '',
    max_tokens: config.max_tokens,
  }
}

function visionDraftPayload(draft: VisionDraft) {
  const payload: Record<string, unknown> = {
    enabled: draft.enabled,
    protocol: draft.protocol,
    base_url: draft.base_url.trim(),
    model_name: draft.model_name.trim(),
    max_tokens: draft.max_tokens,
  }
  // 只有当管理员填了新 key 时才提交；留空 = 保留原值（后端按字段是否出现判断）
  if (draft.api_key.trim()) {
    payload.api_key = draft.api_key.trim()
  }
  return payload
}

export function AdminHomePage() {
  const { session, logout } = useAuth()
  const displayName = (session?.profile.display_name as string) || '平台管理员'
  const avatarUrl = (session?.profile.avatar_url as string) || ''
  const [avatarKey, setAvatarKey] = useState(0)
  const email = (session?.profile.email as string) || ''
  const [activeNav, setActiveNav] = useState<NavKey>('models')

  // 用户反馈通知：铃铛徽章 + 新反馈弹窗
  const [openFeedbackCount, setOpenFeedbackCount] = useState(0)
  const [latestFeedbackId, setLatestFeedbackId] = useState(0)
  const [showNewFeedbackModal, setShowNewFeedbackModal] = useState(false)
  const [latestFeedbackPreview, setLatestFeedbackPreview] = useState<{ id: number; student_name: string | null; description: string; category: string; created_at: string | null } | null>(null)
  const FEEDBACK_LAST_SEEN_KEY = 'admin-feedback-last-seen-id'
  
  useEffect(() => {
    let cancelled = false
    async function pollFeedbackStats() {
      try {
        const data = await apiRequest<{ open_count: number; latest_id: number }>('/api/v1/admin/feedback/stats')
        if (cancelled) return
        setOpenFeedbackCount(data.open_count)
        setLatestFeedbackId(data.latest_id)
        const lastSeen = Number(localStorage.getItem(FEEDBACK_LAST_SEEN_KEY) || '0')
        if (data.latest_id > lastSeen && data.latest_id > 0) {
          try {
            const detail = await apiRequest<{ list: { id: number; student_name: string | null; description: string; category: string; created_at: string | null }[] }>(
              '/api/v1/admin/feedback?page=1&size=1',
            )
            const first = detail.list[0]
            if (first && !cancelled) {
              setLatestFeedbackPreview(first)
              setShowNewFeedbackModal(true)
            }
          } catch {
            // 仅在无法取到详情时静默失败，不影响铃铛徽章
          }
        }
      } catch {
        // 静默失败
      }
    }
    pollFeedbackStats()
    const id = setInterval(pollFeedbackStats, 20000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  function markFeedbackSeen() {
    localStorage.setItem(FEEDBACK_LAST_SEEN_KEY, String(latestFeedbackId))
  }

  function goToFeedbackPage() {
    setActiveNav('feedback')
    setShowNewFeedbackModal(false)
    markFeedbackSeen()
  }

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
  const [visionDraft, setVisionDraft] = useState<VisionDraft>(() => createEmptyVisionDraft())
  const [visionSaving, setVisionSaving] = useState(false)
  const [visionTesting, setVisionTesting] = useState(false)
  const [visionTestResult, setVisionTestResult] = useState<VisionTestResult | null>(null)
  const [visionHasApiKey, setVisionHasApiKey] = useState(false)
  const [visionLoaded, setVisionLoaded] = useState(false)
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
  const loadVisionConfig = useCallback(async () => {
    try {
      const config = await apiRequest<VisionConfig>('/api/v1/admin/vision/config', { headers: authHeaders() })
      setVisionDraft(visionConfigToDraft(config))
      setVisionHasApiKey(config.has_api_key)
      setVisionTestResult(null)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '加载视觉配置失败'
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setVisionLoaded(true)
    }
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function saveVisionConfig() {
    if (!visionDraft.base_url.trim() || !visionDraft.model_name.trim()) {
      setAdminFeedback({ type: 'warning', content: '请填写 Base URL 和模型名' })
      return
    }
    setVisionSaving(true)
    try {
      const config = await apiRequest<VisionConfig>('/api/v1/admin/vision/config', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(visionDraftPayload(visionDraft)),
      })
      // 保存后用服务端最新值重置 draft（清空已提交的 api_key 输入框）
      setVisionDraft(visionConfigToDraft(config))
      setVisionHasApiKey(config.has_api_key)
      setVisionTestResult(null)
      setAdminFeedback({ type: 'success', content: '视觉配置已保存' })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '保存视觉配置失败'
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setVisionSaving(false)
    }
  }

  async function testVisionConfig() {
    setVisionTesting(true)
    setVisionTestResult(null)
    try {
      const result = await apiRequest<VisionTestResult>('/api/v1/admin/vision/test', {
        method: 'POST',
        headers: authHeaders(),
      })
      setVisionTestResult(result)
      if (!result.success) {
        setAdminFeedback({ type: 'error', content: result.error || '连接测试失败' })
      }
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '连接测试失败'
      setVisionTestResult({ success: false, latency_ms: null, error: message, preview: null })
      setAdminFeedback({ type: 'error', content: message })
    } finally {
      setVisionTesting(false)
    }
  }

  const navItems: { key: NavKey; icon: React.ReactNode; label: string }[] = [
    { key: 'models', icon: <IconExperiment />, label: '模型广场' },
    { key: 'vision', icon: <IconImage />, label: '视觉配置' },
    { key: 'skills', icon: <IconApps />, label: 'Skills 广场' },
    { key: 'feedback', icon: <IconMessage />, label: '用户反馈' },
    { key: 'settings', icon: <IconSettings />, label: '系统设置' },
  ]

  function openDrawer(mode: DrawerMode = 'skill') {
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

  useEffect(() => {
    if (session?.role !== 'admin' || !session.access) return
    const timer = setTimeout(() => { loadVisionConfig() }, 0)
    return () => { clearTimeout(timer) }
  }, [session?.access, session?.role, loadVisionConfig])

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
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <strong>CareerForge</strong>
          <div className="admin-topbar-actions">
            <Tooltip content="通知"><Badge count={openFeedbackCount} maxCount={99} offset={[-2, 2]}>
              <Button
                icon={<IconNotification />}
                type="text"
                className="admin-bell"
                onClick={() => { setActiveNav('feedback'); markFeedbackSeen() }}
              />
            </Badge></Tooltip>
            <Tooltip content="系统设置"><Button icon={<IconSettings />} type="text" onClick={() => setActiveNav("settings")} /></Tooltip>
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
              <Tooltip content={displayName}>
                <div className="admin-avatar" style={{ cursor: 'pointer' }}>
                  {avatarUrl ? (
                    <img
                      key={avatarKey}
                      src={avatarUrl}
                      alt="avatar"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  ) : (
                    <span>{(displayName || 'A').charAt(0).toUpperCase()}</span>
                  )}
                </div>
              </Tooltip>
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
          {activeNav === 'vision'
            ? renderVisionPage({
                draft: visionDraft,
                loaded: visionLoaded,
                hasApiKey: visionHasApiKey,
                saving: visionSaving,
                testing: visionTesting,
                testResult: visionTestResult,
                onChange: (patch) => setVisionDraft((current) => ({ ...current, ...patch })),
                onSave: saveVisionConfig,
                onTest: testVisionConfig,
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
          {activeNav === 'feedback' ? <FeedbackPage /> : null}
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
        onClose={() => setDrawerVisible(false)}
      />
      <Modal
        title="收到新的用户反馈"
        visible={showNewFeedbackModal}
        onCancel={() => { setShowNewFeedbackModal(false); markFeedbackSeen() }}
        onOk={goToFeedbackPage}
        okText="前往查看"
        cancelText="稍后处理"
        maskClosable={false}
      >
        {latestFeedbackPreview ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ color: '#4e5969' }}>
              <strong>{latestFeedbackPreview.student_name || '匿名用户'}</strong>
              <span style={{ marginLeft: 8 }}>提交了新的反馈</span>
            </div>
            <div style={{ padding: 12, background: '#f7f8fa', borderRadius: 8, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {latestFeedbackPreview.description}
            </div>
            {latestFeedbackPreview.created_at ? (
              <div style={{ color: '#86909c', fontSize: 12 }}>
                {new Date(latestFeedbackPreview.created_at).toLocaleString('zh-CN')}
              </div>
            ) : null}
          </div>
        ) : (
          <div>有新的用户反馈待处理</div>
        )}
      </Modal>
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

function renderVisionPage({
  draft,
  loaded,
  hasApiKey,
  saving,
  testing,
  testResult,
  onChange,
  onSave,
  onTest,
}: {
  draft: VisionDraft
  loaded: boolean
  hasApiKey: boolean
  saving: boolean
  testing: boolean
  testResult: VisionTestResult | null
  onChange: (patch: Partial<VisionDraft>) => void
  onSave: () => void
  onTest: () => void
}) {
  return (
    <div className="vision-config-wrap">
      <section className="vision-config-card">
        <div className="vision-config-head">
          <div>
            <strong>视觉模型</strong>
            <span>学生对话中发送图片时，由该模型理解图片内容并返回文字描述。当主模型不支持图片输入时自动启用。</span>
          </div>
          <div className="vision-config-switch">
            <Switch
              checked={draft.enabled}
              onChange={(checked) => onChange({ enabled: checked })}
            />
            <span>{draft.enabled ? '已启用' : '已停用'}</span>
          </div>
        </div>

        {!loaded ? (
          <div className="vision-empty">正在读取视觉配置…</div>
        ) : (
          <>
            <div className="vision-field">
              <label>接口协议</label>
              <Select
                value={draft.protocol}
                onChange={(value) => onChange({ protocol: value as VisionProtocol })}
              >
                <Select.Option value="openai">OpenAI（/chat/completions）</Select.Option>
                <Select.Option value="anthropic">Anthropic（/v1/messages）</Select.Option>
              </Select>
            </div>

            <div className="vision-field">
              <label>Base URL</label>
              <Input
                value={draft.base_url}
                placeholder="如 https://api.openai.com/v1"
                onChange={(value) => onChange({ base_url: value })}
              />
            </div>

            <div className="vision-field">
              <label>模型名</label>
              <Input
                value={draft.model_name}
                placeholder="如 gpt-4o / claude-3-5-sonnet-20241022"
                onChange={(value) => onChange({ model_name: value })}
              />
            </div>

            <div className="vision-field">
              <label>API Key</label>
              <Input
                value={draft.api_key}
                placeholder={hasApiKey ? '已配置（留空则不修改）' : '请输入视觉模型的 API Key'}
                onChange={(value) => onChange({ api_key: value })}
              />
              {hasApiKey ? (
                <span className="vision-hint">当前已保存密钥。如需更新请在此填写新值，留空表示保持不变。</span>
              ) : null}
            </div>

            <div className="vision-field">
              <label>最大输出 Tokens</label>
              <Input
                value={String(draft.max_tokens)}
                placeholder="1024"
                onChange={(value) => {
                  const num = Number.parseInt(value, 10)
                  if (!Number.isNaN(num)) onChange({ max_tokens: num })
                }}
              />
            </div>

            <div className="vision-actions">
              <Button type="primary" loading={saving} onClick={onSave}>
                保存配置
              </Button>
              <Button
                type="outline"
                loading={testing}
                disabled={!draft.base_url || !draft.model_name || !hasApiKey}
                onClick={onTest}
              >
                测试连接
              </Button>
            </div>

            {testResult ? (
              <div className={`vision-test-result ${testResult.success ? 'ok' : 'fail'}`}>
                {testResult.success ? (
                  <>
                    <Tag color="green">连接成功</Tag>
                    {testResult.latency_ms != null ? <span>延迟 {testResult.latency_ms}ms</span> : null}
                    {testResult.preview ? <p className="vision-test-preview">{testResult.preview}</p> : null}
                  </>
                ) : (
                  <>
                    <Tag color="red">连接失败</Tag>
                    <span>{testResult.error}</span>
                  </>
                )}
              </div>
            ) : null}
          </>
        )}
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
          <Button type="outline" status="danger" icon={<IconPoweroff />} long onClick={logout}>
            退出登录
          </Button>
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
        defaultValue={['全部 Skills', '全部知识库']}
        options={['全部 Skills', '全部知识库']}
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
    skill: editingSkillId ? '编辑 Skill 文件' : '添加 Skill 文件',
  }
  const isSaving = mode === 'skill' ? skillSaving : false
  const onSave = mode === 'skill' ? onSaveSkill : onClose

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
      {mode === 'skill' ? (
        <SkillDrawerContent draft={skillDraft} onChange={onSkillDraftChange} onFileUpload={onSkillFileUpload} />
      ) : null}
    </Drawer>
  )
}