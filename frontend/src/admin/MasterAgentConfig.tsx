import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconQuestionCircle } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useState } from 'react'

import { ApiError, apiRequest } from '../shared/api'
import { useAuth } from '../shared/auth'

// ── Types ─────────────────────────────────────────────────────────────

interface MasterConfig {
  id: number
  model_id: number | null
  system_prompt: string | null
  temperature: number | null
  max_tokens: number | null
  max_iterations: number
  permission_mode: string
  memory_isolation: boolean
  model_passthrough: boolean
  fallback_mode: string
  fallback_message: string | null
}

interface RouteRule {
  id: number
  intent: string
  target_agent_key: string
  target_agent_name: string
  target_provider: TargetProvider
  provider_config_json: string | null
  memory_strategy: string
  priority: number
  enabled: boolean
}

type TargetProvider = 'builtin' | 'dify'

interface RouteRuleDraft {
  intent: string
  target_agent_key: string
  target_agent_name: string
  target_provider: TargetProvider
  provider_config_json: string | null
  memory_strategy: string
  priority: number
  enabled: boolean
}

interface ModelOption {
  id: number
  display_name: string
  capability?: string
}

interface AgentOption {
  id: string
  name: string
}

const FALLBACK_AGENT_OPTIONS: AgentOption[] = [
  { id: 'interview', name: 'AI 面试官' },
  { id: 'matching', name: '岗位匹配' },
  { id: 'resume', name: '简历优化' },
]

const MEMORY_STRATEGY_LABELS: Record<string, string> = {
  isolated: '独立隔离',
  passthrough: '完整透传',
  summary_only: '仅摘要回流',
}

const PERMISSION_MODE_OPTIONS = [
  { value: 'ask', label: 'Ask（默认）', desc: '高风险操作暂停，等用户确认' },
  { value: 'auto', label: 'Auto', desc: '所有工具直接执行，适合测试环境' },
  { value: 'strict', label: 'Strict', desc: '仅白名单工具可执行，其余拒绝' },
]

const FALLBACK_MODE_OPTIONS = [
  { value: 'direct_answer', label: '直接回答', desc: '无子智能体命中时，主智能体直接作答' },
  { value: 'guide_message', label: '引导文案', desc: '返回自定义引导语' },
  { value: 'error', label: '返回错误', desc: '明确告知无法处理' },
]

const EMPTY_RULE: RouteRuleDraft = {
  intent: '',
  target_agent_key: '',
  target_agent_name: '',
  target_provider: 'builtin',
  provider_config_json: '',
  memory_strategy: 'isolated',
  priority: 0,
  enabled: true,
}

// ── Component ─────────────────────────────────────────────────────────

export function MasterAgentConfig() {
  const { session } = useAuth()

  const [config, setConfig] = useState<MasterConfig | null>(null)
  const [routes, setRoutes] = useState<RouteRule[]>([])
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([])
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>(FALLBACK_AGENT_OPTIONS)

  const [configSaving, setConfigSaving] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<RouteRule | null>(null)
  const [ruleDraft, setRuleDraft] = useState({ ...EMPTY_RULE })
  const [ruleSaving, setRuleSaving] = useState(false)

  const [notify, setNotify] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const showNotify = (type: 'success' | 'error', text: string) => {
    setNotify({ type, text })
    setTimeout(() => setNotify(null), 3000)
  }

  // ── Data Fetching ────────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      const data = await apiRequest<MasterConfig>('/api/v1/admin/master/config')
      setConfig(data)
    } catch {
      showNotify('error', '加载主智能体配置失败')
    }
  }, [])

  const fetchRoutes = useCallback(async () => {
    try {
      const data = await apiRequest<RouteRule[]>('/api/v1/admin/master/routes')
      setRoutes(data)
    } catch {
      showNotify('error', '加载路由规则失败')
    }
  }, [])

  useEffect(() => {
    let alive = true
    const timer = window.setTimeout(() => {
      void fetchConfig()
      void fetchRoutes()

      // 加载模型列表（用于模型选择器）
      void apiRequest<{ list: ModelOption[] }>('/api/v1/admin/models?size=100')
        .then((r) => {
          if (alive) {
            // 主智能体不可使用 TTS 模型，过滤掉
            setModelOptions(r.list.filter((m) => m.capability !== 'tts'))
          }
        })
        .catch(() => {})

      // 加载子智能体选项
      if (!session?.access) return
      void apiRequest<AgentOption[] | { items?: AgentOption[] }>('/api/v1/admin/agents/options', {
        headers: { Authorization: `Bearer ${session.access}` },
      })
        .then((data) => {
          const list = Array.isArray(data) ? data : (data.items ?? [])
          if (alive && list.length > 0) setAgentOptions(list)
        })
        .catch(() => {})
    }, 0)

    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [fetchConfig, fetchRoutes, session?.access])

  // ── Config Save ──────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    if (!config) return
    setConfigSaving(true)
    try {
      const updated = await apiRequest<MasterConfig>('/api/v1/admin/master/config', {
        method: 'PUT',
        body: JSON.stringify({
          model_id: config.model_id,
          system_prompt: config.system_prompt,
          temperature: config.temperature,
          max_tokens: config.max_tokens,
          max_iterations: config.max_iterations,
          permission_mode: config.permission_mode,
          memory_isolation: config.memory_isolation,
          model_passthrough: config.model_passthrough,
          fallback_mode: config.fallback_mode,
          fallback_message: config.fallback_message,
        }),
      })
      setConfig(updated)
      showNotify('success', '配置已保存')
    } catch (e) {
      showNotify('error', e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setConfigSaving(false)
    }
  }

  const patchConfig = (patch: Partial<MasterConfig>) =>
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))

  // ── Route Rules ──────────────────────────────────────────────────

  const openRuleDrawer = (rule?: RouteRule) => {
    setEditingRule(rule ?? null)
    if (rule) {
      setRuleDraft({
        intent: rule.intent,
        target_agent_key: rule.target_agent_key,
        target_agent_name: rule.target_agent_name,
        target_provider: rule.target_provider ?? 'builtin',
        provider_config_json: rule.provider_config_json ?? '',
        memory_strategy: rule.memory_strategy,
        priority: rule.priority,
        enabled: rule.enabled,
      })
    } else {
      setRuleDraft({ ...EMPTY_RULE })
    }
    setDrawerOpen(true)
  }

  const handleSaveRule = async () => {
    if (!ruleDraft.intent.trim() || !ruleDraft.target_agent_key.trim() || !ruleDraft.target_agent_name.trim()) {
      showNotify('error', '意图描述和目标子智能体为必填项')
      return
    }
    if (ruleDraft.target_provider === 'dify') {
      if (!ruleDraft.provider_config_json?.trim()) {
        showNotify('error', 'Dify 子智能体需要填写 API 配置 JSON')
        return
      }
      try {
        JSON.parse(ruleDraft.provider_config_json)
      } catch {
        showNotify('error', 'Dify API 配置必须是合法 JSON')
        return
      }
    }
    setRuleSaving(true)
    try {
      const payload = {
        ...ruleDraft,
        intent: ruleDraft.intent.trim(),
        target_agent_key: ruleDraft.target_agent_key.trim(),
        target_agent_name: ruleDraft.target_agent_name.trim(),
        provider_config_json: ruleDraft.provider_config_json?.trim() || null,
      }
      if (editingRule) {
        await apiRequest(`/api/v1/admin/master/routes/${editingRule.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
        showNotify('success', '规则已更新')
      } else {
        await apiRequest('/api/v1/admin/master/routes', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        showNotify('success', '规则已创建')
      }
      setDrawerOpen(false)
      fetchRoutes()
    } catch (e) {
      showNotify('error', e instanceof ApiError ? e.message : '操作失败')
    } finally {
      setRuleSaving(false)
    }
  }

  const handleDeleteRule = async (id: number) => {
    try {
      await apiRequest(`/api/v1/admin/master/routes/${id}`, { method: 'DELETE' })
      showNotify('success', '已删除')
      fetchRoutes()
    } catch {
      showNotify('error', '删除失败')
    }
  }

  const handleToggleRule = async (rule: RouteRule, enabled: boolean) => {
    try {
      await apiRequest(`/api/v1/admin/master/routes/${rule.id}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled }),
      })
      setRoutes((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled } : r)))
    } catch {
      showNotify('error', '操作失败')
    }
  }

  const onAgentSelect = (key: string) => {
    const opt = agentOptions.find((a) => a.id === key)
    setRuleDraft((d) => ({
      ...d,
      target_agent_key: key,
      target_agent_name: opt?.name ?? key,
    }))
  }

  // ── Render ───────────────────────────────────────────────────────

  if (!config) {
    return <div style={{ padding: 32, color: '#86909c' }}>加载中...</div>
  }

  const enabledCount = routes.filter((r) => r.enabled).length

  return (
    <>
      {notify && (
        <Alert
          type={notify.type}
          content={notify.text}
          closable
          onClose={() => setNotify(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <div className="master-grid">
        {/* ── 左列：Harness 配置 ── */}
        <section className="master-config-panel">
          <div className="admin-section-title">
            <h3>Harness 配置</h3>
            <p>配置主智能体的认知层参数和 Harness 管控策略。</p>
          </div>

          <div className="form-surface">
            {/* 认知层 */}
            <label>
              默认模型（仅文本/多模态，TTS 不可用）
              <Select
                value={config.model_id ?? undefined}
                placeholder="继承系统默认"
                allowClear
                onChange={(v) => patchConfig({ model_id: v ?? null })}
              >
                {modelOptions.map((m) => (
                  <Select.Option key={m.id} value={m.id}>
                    {m.display_name}
                  </Select.Option>
                ))}
              </Select>
            </label>

            <label>
              Coordinator System Prompt
              <Input.TextArea
                value={config.system_prompt ?? ''}
                onChange={(v) => patchConfig({ system_prompt: v })}
                autoSize={{ minRows: 5, maxRows: 10 }}
                placeholder="定义主智能体的调度身份和 ReAct 行为规范..."
              />
            </label>

            {/* Harness 管控层 */}
            <div style={{ borderTop: '1px solid var(--color-border-2)', paddingTop: 16, marginTop: 4 }}>
              <p style={{ fontSize: 12, color: '#86909c', marginBottom: 12 }}>Harness 管控层</p>

              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Agent Loop 最大轮次
                  <Tooltip content="Harness 硬边界：ReAct 循环最多执行 N 次工具调用，防止死循环消耗 token">
                    <IconQuestionCircle style={{ color: '#86909c', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <InputNumber
                  value={config.max_iterations}
                  min={1}
                  max={100}
                  onChange={(v) => patchConfig({ max_iterations: v ?? 10 })}
                  style={{ width: '100%' }}
                />
              </label>

              <label>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  权限模式
                  <Tooltip content="全局四态权限默认策略，工具级配置可覆盖">
                    <IconQuestionCircle style={{ color: '#86909c', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Select
                  value={config.permission_mode}
                  onChange={(v) => patchConfig({ permission_mode: v })}
                >
                  {PERMISSION_MODE_OPTIONS.map((o) => (
                    <Select.Option key={o.value} value={o.value}>
                      <span>{o.label}</span>
                      <span style={{ fontSize: 11, color: '#86909c', marginLeft: 8 }}>{o.desc}</span>
                    </Select.Option>
                  ))}
                </Select>
              </label>

              <div className="switch-list">
                <Switch
                  checked={config.memory_isolation}
                  onChange={(v) => patchConfig({ memory_isolation: v })}
                />
                <span>
                  子智能体记忆独立隔离
                  <span style={{ fontSize: 11, color: '#86909c', marginLeft: 6 }}>
                    仅结果摘要回流主对话
                  </span>
                </span>
              </div>

              <div className="switch-list">
                <Switch
                  checked={config.model_passthrough}
                  onChange={(v) => patchConfig({ model_passthrough: v })}
                />
                <span>
                  向子智能体透传当前模型
                  <span style={{ fontSize: 11, color: '#86909c', marginLeft: 6 }}>
                    子智能体使用与主智能体相同的模型
                  </span>
                </span>
              </div>
            </div>

            {/* 兜底策略 */}
            <div style={{ borderTop: '1px solid var(--color-border-2)', paddingTop: 16, marginTop: 4 }}>
              <p style={{ fontSize: 12, color: '#86909c', marginBottom: 12 }}>兜底策略</p>

              <label>
                无工具命中时
                <Select
                  value={config.fallback_mode}
                  onChange={(v) => patchConfig({ fallback_mode: v })}
                >
                  {FALLBACK_MODE_OPTIONS.map((o) => (
                    <Select.Option key={o.value} value={o.value}>
                      <span>{o.label}</span>
                      <span style={{ fontSize: 11, color: '#86909c', marginLeft: 8 }}>{o.desc}</span>
                    </Select.Option>
                  ))}
                </Select>
              </label>

              {config.fallback_mode === 'guide_message' && (
                <label>
                  引导文案
                  <Input.TextArea
                    value={config.fallback_message ?? ''}
                    onChange={(v) => patchConfig({ fallback_message: v })}
                    autoSize={{ minRows: 2, maxRows: 4 }}
                    placeholder="抱歉，暂无合适的功能处理您的请求，请描述更具体的求职需求..."
                  />
                </label>
              )}
            </div>

            <Button type="primary" loading={configSaving} onClick={handleSaveConfig}>
              保存配置
            </Button>
          </div>
        </section>

        {/* ── 右列：工具注册表 ── */}
        <section className="route-panel">
          <div className="admin-section-title">
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <h3>子智能体工具注册表</h3>
                <p>
                  {enabledCount} 个工具已启用 · Model 在 ReAct 循环中自主决定调用时机
                </p>
              </div>
              <Button
                type="primary"
                size="small"
                icon={<IconPlus />}
                onClick={() => openRuleDrawer()}
              >
                添加
              </Button>
            </div>
          </div>

          <div className="route-list">
            {routes.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', color: '#86909c', fontSize: 13 }}>
                暂无子智能体工具，点击"添加"注册第一个
              </div>
            )}
            {routes.map((rule) => (
              <div key={rule.id} className="route-row" style={{ opacity: rule.enabled ? 1 : 0.45 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 13 }}>{rule.intent}</strong>
                    {rule.priority > 0 && (
                      <Tag size="small" color="arcoblue">
                        优先级 {rule.priority}
                      </Tag>
                    )}
                    <Tag size="small" color={rule.target_provider === 'dify' ? 'green' : 'gray'}>
                      {rule.target_provider === 'dify' ? 'Dify' : '内置'}
                    </Tag>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color="orange" size="small">
                      {rule.target_agent_name}
                    </Tag>
                    <span style={{ fontSize: 11, color: '#86909c' }}>
                      {MEMORY_STRATEGY_LABELS[rule.memory_strategy] ?? rule.memory_strategy}
                    </span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <Switch
                    size="small"
                    checked={rule.enabled}
                    onChange={(v) => handleToggleRule(rule, v)}
                  />
                  <Button
                    type="text"
                    size="mini"
                    icon={<IconEdit />}
                    onClick={() => openRuleDrawer(rule)}
                  />
                  <Popconfirm title="确定删除该工具规则？" onOk={() => handleDeleteRule(rule.id)}>
                    <Button type="text" size="mini" status="danger" icon={<IconDelete />} />
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ── 规则编辑 Drawer ── */}
      <Drawer
        title={editingRule ? '编辑子智能体工具' : '添加子智能体工具'}
        visible={drawerOpen}
        width={480}
        onCancel={() => setDrawerOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={ruleSaving} onClick={handleSaveRule}>
              {editingRule ? '保存' : '创建'}
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" style={{ paddingRight: 8 }}>
          <Form.Item
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                意图描述
                <Tooltip content="Model 读取此描述来决定何时调用该子智能体工具，写得越清晰，Model 的判断越准确">
                  <IconQuestionCircle style={{ color: '#86909c', cursor: 'help' }} />
                </Tooltip>
              </span>
            }
            required
          >
            <Input.TextArea
              value={ruleDraft.intent}
              onChange={(v) => setRuleDraft((d) => ({ ...d, intent: v }))}
              placeholder="例如：学生需要模拟面试、面试复盘或面试准备时调用"
              autoSize={{ minRows: 2, maxRows: 4 }}
            />
          </Form.Item>

          <Form.Item label="子智能体来源" required>
            <Select
              value={ruleDraft.target_provider}
              onChange={(v) => setRuleDraft((d) => ({ ...d, target_provider: v as TargetProvider }))}
            >
              <Select.Option value="builtin">平台内置子智能体</Select.Option>
              <Select.Option value="dify">Dify 子智能体</Select.Option>
            </Select>
          </Form.Item>

          {ruleDraft.target_provider === 'builtin' ? (
            <Form.Item label="平台子智能体" required>
              <Select
                value={ruleDraft.target_agent_key || undefined}
                placeholder="选择子智能体"
                onChange={onAgentSelect}
              >
                {agentOptions.map((a) => (
                  <Select.Option key={a.id} value={a.id}>
                    {a.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : (
            <>
              <Form.Item label="Dify 子智能体 Key" required>
                <Input
                  value={ruleDraft.target_agent_key}
                  onChange={(v) => setRuleDraft((d) => ({ ...d, target_agent_key: v }))}
                  placeholder="例如：dify-interview-coach"
                />
              </Form.Item>

              <Form.Item label="Dify 子智能体名称" required>
                <Input
                  value={ruleDraft.target_agent_name}
                  onChange={(v) => setRuleDraft((d) => ({ ...d, target_agent_name: v }))}
                  placeholder="例如：Dify 面试官"
                />
              </Form.Item>

              <Form.Item
                label={
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    Dify API 配置 JSON
                    <Tooltip content="主智能体调用 invoke_agent 时会读取这里的配置，向 Dify /chat-messages 发起 blocking 请求">
                      <IconQuestionCircle style={{ color: '#86909c', cursor: 'help' }} />
                    </Tooltip>
                  </span>
                }
                required
              >
                <Input.TextArea
                  value={ruleDraft.provider_config_json ?? ''}
                  onChange={(v) => setRuleDraft((d) => ({ ...d, provider_config_json: v }))}
                  autoSize={{ minRows: 5, maxRows: 9 }}
                  placeholder='{"api_base_url":"http://dify-api:5001/v1","api_key":"app-xxx","inputs":{},"timeout_sec":45}'
                />
              </Form.Item>
            </>
          )}

          <Form.Item label="记忆策略">
            <Select
              value={ruleDraft.memory_strategy}
              onChange={(v) => setRuleDraft((d) => ({ ...d, memory_strategy: v }))}
            >
              <Select.Option value="isolated">独立隔离 — 仅结果摘要回流主对话</Select.Option>
              <Select.Option value="summary_only">摘要回流 — 压缩后的执行摘要</Select.Option>
              <Select.Option value="passthrough">完整透传 — 子智能体上下文完整回流</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            label={
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                优先级
                <Tooltip content="数字越大越靠前显示在 Model 的工具列表中">
                  <IconQuestionCircle style={{ color: '#86909c', cursor: 'help' }} />
                </Tooltip>
              </span>
            }
          >
            <InputNumber
              value={ruleDraft.priority}
              min={0}
              max={999}
              onChange={(v) => setRuleDraft((d) => ({ ...d, priority: v ?? 0 }))}
              style={{ width: '100%' }}
              placeholder="0"
            />
          </Form.Item>

          <Form.Item label="启用状态">
            <Switch
              checked={ruleDraft.enabled}
              onChange={(v) => setRuleDraft((d) => ({ ...d, enabled: v }))}
              checkedText="已启用"
              uncheckedText="已禁用"
            />
          </Form.Item>
        </Form>
      </Drawer>
    </>
  )
}
