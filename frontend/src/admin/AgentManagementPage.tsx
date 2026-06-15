import {
  Button, Drawer, Form, Input, InputNumber, Popconfirm,
  Select, Slider, Switch, Tabs, Tag, Typography, Message,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSend } from '@arco-design/web-react/icon'
import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'
import { useDebouncedValue } from '../shared/useDebouncedValue'

const { Text, Title } = Typography
const { TextArea } = Input

interface ModelItem { id: number; display_name: string; provider: string; model_identifier: string; base_url: string; api_key_cipher: string | null; capability: string; protocols: string; status: string; open_to_student: boolean }

interface AgentItem {
  id: number; name: string; description: string | null; category: string
  icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null
  model_config_id: number | null; model_config: ModelItem | null
  welcome_message: string | null; suggested_questions: string[] | null
  prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null
  system_prompt: string | null; temperature: number; max_tokens: number
  top_p: number; frequency_penalty: number; presence_penalty: number
  memory_window: number
  use_dify: boolean; dify_api_key_cipher: string | null; dify_api_base_url: string | null
  is_enabled: boolean; is_published: boolean; created_at: string; updated_at: string
}

const CAT_META: Record<string, { label: string; color: string; emoji: string }> = {
  interview: { label: '面试', color: '#6366F1', emoji: '🎙️' },
  job_search: { label: '求职', color: '#F59E0B', emoji: '💼' },
  tools: { label: '工具', color: '#10B981', emoji: '🛠️' },
  other: { label: '其他', color: '#8B5CF6', emoji: '🤖' },
}

const CAT_OPT = Object.entries(CAT_META).map(([k, v]) => ({ value: k, label: v.emoji + ' ' + v.label }))

const ICONS = [
  { value: 'smart_toy', label: '智能体' },
  { value: 'record_voice_over', label: '面试' },
  { value: 'join_inner', label: '匹配' },
  { value: 'description', label: '简历' },
  { value: 'psychology', label: '测评' },
  { value: 'support_agent', label: '客服' },
  { value: 'school', label: '学业' },
  { value: 'work', label: '职业' },
  { value: 'trending_up', label: '成长' },
  { value: 'auto_awesome', label: '创意' },
]

const GRADIENT_PRESETS = [
  { from: '#6366F1', to: '#8B5CF6' },
  { from: '#3B82F6', to: '#06B6D4' },
  { from: '#10B981', to: '#34D399' },
  { from: '#F59E0B', to: '#EF4444' },
  { from: '#EC4899', to: '#8B5CF6' },
  { from: '#6366F1', to: '#EC4899' },
]

interface ChatMsg { role: 'user' | 'assistant'; content: string }
interface DifyTestAttempt { path: string; status: number; message?: string }
interface DifyTestResponse { success: boolean; message: string; attempts?: DifyTestAttempt[] }

export function AgentManagementPage() {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [models, setModels] = useState<ModelItem[]>([])
  const [flt, setFlt] = useState('all')
  const [srch, setSrch] = useState('')
  const debouncedSrch = useDebouncedValue(srch, 300)  // 300ms debounce on server-bound search
  const [drawer, setDrawer] = useState(false)
  const [edit, setEdit] = useState<AgentItem | null>(null)
  const [form] = Form.useForm()
  const [sub, setSub] = useState(false)
  const [tab, setTab] = useState('basic')
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [cIn, setCIn] = useState('')
  const [difyTestResult, setDifyTestResult] = useState<string | null>(null)
  const [difyTesting, setDifyTesting] = useState(false)
  const [cLoading, setCLoading] = useState(false)
  const [useDify, setUseDify] = useState(false)
  const [vVals, setVVals] = useState<Record<string, string>>({})
  const cEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try { const r = await apiRequest<{ list: ModelItem[] }>('/api/v1/admin/models?size=100'); if (alive) setModels(r.list) } catch { /* silent */ }
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const sp = new URLSearchParams()
        if (flt && flt !== 'all') sp.set('category', flt)
        if (debouncedSrch) sp.set('search', debouncedSrch)
        const r = await apiRequest<AgentItem[]>(
          `/api/v1/admin/agents${sp.toString() ? '?' + sp.toString() : ''}`,
          { signal: ctrl.signal },
        )
        setAgents(Array.isArray(r) ? r : [])
      } catch (err) {
        // AbortError is expected on rapid typing — ignore silently.
        if (err instanceof DOMException && err.name === 'AbortError') return
        /* silent for other errors */
      }
    })()
    return () => ctrl.abort()
  }, [flt, debouncedSrch])

  useEffect(() => {
    const h = () => { setEdit(null); form.resetFields(); setUseDify(false); setMsgs([]); setTab('basic'); setDrawer(true) }
    window.addEventListener('agent-create', h); return () => window.removeEventListener('agent-create', h)
  }, [form])
  useEffect(() => { cEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const fetchAgents = async () => {
    try {
      const sp = new URLSearchParams()
      if (flt && flt !== 'all') sp.set('category', flt)
      if (srch) sp.set('search', srch)
      const r = await apiRequest<AgentItem[]>(`/api/v1/admin/agents${sp.toString() ? '?' + sp.toString() : ''}`)
      setAgents(Array.isArray(r) ? r : [])
    } catch { /* silent */ }
  }

  const openEdit = (a: AgentItem) => {
    setEdit(a)
    const v: Record<string, string> = {}
    if (a.prompt_variables) for (const pv of a.prompt_variables) v[pv.name] = pv.default || ''
    setVVals(v)
    setMsgs([])
    setUseDify(a.use_dify || false)
    form.setFieldsValue({
      name: a.name, desc: a.description || '', cat: a.category,
      icon: a.icon_name || 'smart_toy', cFrom: a.icon_color_from || '#6366F1', cTo: a.icon_color_to || '#8B5CF6',
      model_id: a.model_config_id || undefined, welcome: a.welcome_message || '',
      use_dify: a.use_dify || false, dify_api_key: '', dify_api_base_url: a.dify_api_base_url || 'https://api.dify.ai/v1',
      sq: a.suggested_questions || [], pv: a.prompt_variables || [], sp: a.system_prompt || '',
      temp: a.temperature ?? 0.7, mt: a.max_tokens ?? 4096, tp: a.top_p ?? 0.9,
      fp: a.frequency_penalty ?? 0, pp: a.presence_penalty ?? 0, mw: a.memory_window ?? 10,
      enabled: a.is_enabled, pub: a.is_published,
    })
    setTab('basic')
    setDrawer(true)
  }

  const handleTestDify = async () => {
    const vals = form.getFieldsValue?.() || {}
    if (!vals.dify_api_base_url || !vals.dify_api_key) {
      setDifyTestResult('请输入 Base URL / API Secret')
      setTimeout(() => setDifyTestResult(null), 4000)
      return
    }
    setDifyTesting(true)
    setDifyTestResult('测试中...')
    try {
      const r = await apiRequest<DifyTestResponse>('/api/v1/admin/agents/test-dify', {
        method: 'POST',
        body: JSON.stringify({ api_base_url: vals.dify_api_base_url, api_key: vals.dify_api_key }),
      })
      if (r.success) {
        setDifyTestResult('OK ' + r.message)
      } else {
        const att = r.attempts?.map((d) => '[' + d.path + ':' + d.status + '] ' + (d.message || '')).join(' / ') || ''
        setDifyTestResult('FAIL ' + r.message + (att ? ' | ' + att : ''))
      }
    } catch {
      setDifyTestResult('网络错误')
    } finally {
      setDifyTesting(false)
      setTimeout(() => setDifyTestResult(null), 15000)
    }
  }

  const handleSubmit = async () => {
    try {
      const vals = await form.validate()
      setSub(true)
      const body = JSON.stringify({
        name: vals.name, description: vals.desc, category: vals.cat,
        icon_name: vals.icon, icon_color_from: vals.cFrom, icon_color_to: vals.cTo,
        model_config_id: vals.model_id || null, welcome_message: vals.welcome,
        use_dify: vals.use_dify || false,
        dify_api_key: vals.use_dify ? (vals.dify_api_key || undefined) : undefined,
        dify_api_base_url: vals.use_dify ? (vals.dify_api_base_url || undefined) : undefined,
        suggested_questions: (vals.sq || []).filter(Boolean),
        prompt_variables: (vals.pv || []).filter((v: { name?: string }) => v.name?.trim()),
        system_prompt: vals.sp, temperature: vals.temp, max_tokens: vals.mt,
        top_p: vals.tp, frequency_penalty: vals.fp, presence_penalty: vals.pp,
        memory_window: vals.mw, is_enabled: vals.enabled, is_published: vals.pub,
      })
      const url = edit ? `/api/v1/admin/agents/${edit.id}` : '/api/v1/admin/agents'
      await apiRequest(url, { method: edit ? 'PUT' : 'POST', body })
      Message.success(edit ? '保存成功' : '创建成功')
      setDrawer(false)
      fetchAgents()
    } catch (e: unknown) {
      if (e instanceof Error && e.message) Message.error(e.message)
    } finally { setSub(false) }
  }

  const handleDelete = async (id: number) => {
    try { await apiRequest(`/api/v1/admin/agents/${id}`, { method: 'DELETE' }); Message.success('已删除'); fetchAgents() }
    catch { Message.error('删除失败') }
  }

  const handleToggle = async (id: number, enabled: boolean) => {
    try { await apiRequest(`/api/v1/admin/agents/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ is_enabled: enabled }) }); fetchAgents() }
    catch { Message.error('操作失败') }
  }

  const handleChat = async () => {
    if (!cIn.trim() || !edit || cLoading) return
    const m = cIn.trim(); setCIn('')
    setMsgs(p => [...p, { role: 'user', content: m }])
    setCLoading(true)
    try {
      const r = await apiRequest<{ reply: string }>(`/api/v1/admin/agents/${edit.id}/chat`, {
        method: 'POST', body: JSON.stringify({ message: m, variables: vVals }),
      })
      setMsgs(p => [...p, { role: 'assistant', content: r.reply }])
    } catch {
      setMsgs(p => [...p, { role: 'assistant', content: '请求失败' }])
    } finally { setCLoading(false) }
  }

  const filtered = agents.filter(a =>
    (flt === 'all' || a.category === flt) &&
    (!srch || a.name.includes(srch) || (a.description || '').includes(srch))
  )

  const watchedCat = Form.useWatch('cat', form)
const isInterviewAgent = watchedCat === 'interview'
const TTS_CAPABILITIES = ['tts']
const CHAT_CAPABILITIES = ['text', 'multimodal', 'chat']
const mOpts = models
  .filter(m => isInterviewAgent ? TTS_CAPABILITIES.includes(m.capability) : CHAT_CAPABILITIES.includes(m.capability))
  .map(m => ({ value: m.id, label: m.display_name + ' (' + m.model_identifier + ')' }))

  const stats = {
    total: agents.length,
    enabled: agents.filter(a => a.is_enabled).length,
    dify: agents.filter(a => a.use_dify).length,
    builtin: agents.filter(a => !a.use_dify).length,
  }

  const allCategories = ['all', ...Object.keys(CAT_META)]

  return (
    <div style={{ padding: '24px 28px', background: '#F8F9FB', minHeight: '100%' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        {[{ label: '全部', value: stats.total, color: '#1F2937' },
          { label: '已启用', value: stats.enabled, color: '#10B981' },
          { label: 'Dify 接入', value: stats.dify, color: '#3B82F6' },
          { label: '内置模型', value: stats.builtin, color: '#6366F1' }].map(s => (
          <div key={s.label} style={{ background: '#FFFFFF', borderRadius: 8, padding: '16px 20px', textAlign: 'center', border: '1px solid #E5E6EB', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', cursor: 'default' }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, marginBottom: 2 }}>{s.value}</div>
            <div style={{ fontSize: 13, color: '#6B7280' }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title heading={5} style={{ margin: 0, color: '#1F2937' }}>智能体列表</Title>
        <Button type='primary' icon={<IconPlus />} size='small'
          onClick={() => { setEdit(null); form.resetFields(); setUseDify(false); setMsgs([]); setTab('basic'); setDrawer(true) }}
          style={{ fontWeight: 500, borderRadius: 6 }}>
          新建智能体
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        {allCategories.map(cat => {
          const meta = cat === 'all' ? { label: '全部', color: '#6366F1' } : CAT_META[cat]
          const active = flt === cat
          return (
            <div key={cat} onClick={() => setFlt(cat)} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: active ? 600 : 400, cursor: 'pointer', border: '1.5px solid ' + (active ? meta.color : '#E5E6EB'), background: active ? meta.color + '12' : '#fff', color: active ? meta.color : '#4E5969', transition: 'all 0.2s', whiteSpace: 'nowrap' }}>
              {meta.label}
            </div>
          )
        })}
        <div style={{ flex: 1 }} />
        <Input.Search placeholder='搜索智能体...' value={srch} onChange={v => setSrch(v)} style={{ width: 220, borderRadius: 8 }} size='large' />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
        {filtered.map(a => {
          const cm = CAT_META[a.category] || CAT_META.other
          const gradFrom = a.icon_color_from || cm.color
          return (
            <div key={a.id} style={{ background: '#FFFFFF', borderRadius: 8, padding: '16px 16px 14px', border: '1px solid #E5E6EB', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'all 0.25s ease', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginTop: 0 }}>
                <div style={{ width: 44, height: 44, borderRadius: 8, background: gradFrom, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 22, flexShrink: 0 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 26, fontVariationSettings: "'FILL' 1" }}>{a.icon_name || 'smart_toy'}</span>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, fontSize: 15, color: '#1F2937' }}>{a.name}</span>
                    {a.use_dify && <Tag size='small' color='arcoblue' style={{ fontSize: 10, borderRadius: 6, padding: '1px 6px' }}>Dify</Tag>}
                  </div>
                  <Text style={{ fontSize: 13, color: '#6B7280', display: 'block', lineHeight: '18px', marginBottom: 8 }} ellipsis={{ rows: 2 }}>{a.description || '暂无描述'}</Text>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <Tag color={cm.color === '#6366F1' ? 'arcoblue' : cm.color === '#F59E0B' ? 'orangered' : cm.color === '#10B981' ? 'green' : 'purple'} size='small' style={{ borderRadius: 8 }}>{cm.label}</Tag>
                    <Tag size='small' color={a.is_enabled ? 'green' : 'gray'} style={{ borderRadius: 8 }}>{a.is_enabled ? '已启用' : '已禁用'}</Tag>
                    {a.is_published && <Tag size='small' color='arcoblue' style={{ borderRadius: 8 }}>🌐 公开</Tag>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid #F3F4F6' }}>
                <Button size='small' type='outline' shape='round' icon={<IconEdit />} onClick={() => openEdit(a)} style={{ flex: 1 }}>编辑</Button>
                <Button size='small' type='outline' shape='round' status={a.is_enabled ? 'warning' : 'success'} onClick={() => handleToggle(a.id, !a.is_enabled)}>{a.is_enabled ? '禁用' : '启用'}</Button>
                <Popconfirm title='确定删除？' onOk={() => handleDelete(a.id)}>
                  <Button size='small' type='outline' shape='round' status='danger' icon={<IconDelete />} />
                </Popconfirm>
              </div>
            </div>
          )
        })}
        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: 60, color: '#D1D5DB' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}></div>
            <Text style={{ fontSize: 15, color: '#9CA3AF' }}>还没有智能体，点击"创建智能体"开始吧</Text>
          </div>
        )}
      </div>

      <Drawer width={560} title={edit ? '编辑 · ' + edit.name : '创建智能体'} visible={drawer} onCancel={() => setDrawer(false)}
        footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button shape='round' onClick={() => setDrawer(false)}>取消</Button>
          <Button type='primary' shape='round' loading={sub} onClick={handleSubmit} style={{ fontWeight: 600 }}>{edit ? '保存' : '创建'}</Button>
        </div>}>
        <Tabs activeTab={tab} onChange={setTab} style={{ marginTop: -4 }}>
          <Tabs.TabPane key='basic' title='基础信息'>
            <Form form={form} layout='vertical'>
              <Form.Item label='智能体名称' field='name' rules={[{ required: true, message: '请输入名称' }]}>
                <Input placeholder='如：AI 面试官' maxLength={64} />
              </Form.Item>
              <Form.Item label='简短描述' field='desc'>
                <TextArea placeholder='说明智能体的功能用途...' maxLength={256} autoSize={{ minRows: 2, maxRows: 3 }} />
              </Form.Item>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Form.Item label='分类' field='cat'>
                  <Select options={CAT_OPT} placeholder='选择分类' />
                </Form.Item>
                <Form.Item label='图标' field='icon'>
                  <Select options={ICONS} placeholder='选择图标' renderFormat={(option) => {
  const icon = ICONS.find(i => i.value === option?.value)
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>{option?.value}</span>
      <span>{icon?.label || option?.value}</span>
    </span>
  )
}} />
                </Form.Item>
              </div>
              <Form.Item label='渐变配色' field='cFrom'>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {GRADIENT_PRESETS.map((g, i) => (
                    <div key={i} style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, ' + g.from + ', ' + g.to + ')', cursor: 'pointer', border: form.getFieldValue?.('cFrom') === g.from ? '3px solid #1F2937' : '2px solid #E5E6EB', transition: 'transform 0.15s' }}
                      onClick={() => { form.setFieldValue('cFrom', g.from); form.setFieldValue('cTo', g.to) }}
                      onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.15)'}
                      onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'} />
                  ))}
                </div>
              </Form.Item>
              <Form.Item label='欢迎语' field='welcome'>
                <TextArea placeholder='用户打开时的首条消息...' maxLength={512} autoSize={{ minRows: 2, maxRows: 3 }} />
              </Form.Item>
            </Form>
          </Tabs.TabPane>

          <Tabs.TabPane key='dify' title='🔗 Dify'>
            <Form form={form} layout='vertical'>
              <Form.Item label='启用 Dify' field='use_dify' triggerPropName='checked'>
                <Switch onChange={(v) => setUseDify(v)} />
              </Form.Item>
              {useDify && (
                <div style={{ background: '#F8F9FB', borderRadius: 8, padding: 16, border: '1px solid #E5E6EB' }}>
                  <Form.Item label='API Base URL' field='dify_api_base_url' rules={[{ required: true, message: '请输入' }]}>
                    <Input placeholder='https://api.dify.ai/v1' />
                  </Form.Item>
                  <Form.Item label='API Secret' field='dify_api_key' rules={[{ required: true, message: '请输入' }]}>
                    <Input.Password placeholder='app-xxxxxxxxxxxxxxxxxxxx' />
                  </Form.Item>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
                    <Button size='small' shape='round' loading={difyTesting} onClick={handleTestDify}
                      style={{ fontWeight: 500 }} type='primary'>测试连接</Button>
                    {difyTestResult && <Tag size='small' color={difyTestResult.startsWith('OK') ? 'green' : 'red'} style={{ borderRadius: 8, maxWidth: 320 }}>{difyTestResult}</Tag>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6B7280', lineHeight: '16px' }}>
                    <p style={{ margin: '0 0 4px', fontWeight: 600 }}>💡 开启后：</p>
                    <p style={{ margin: 0 }}>• Dify 平台 → 应用 → API 访问 中获取 API Secret</p>
                    <p style={{ margin: 0 }}>• 无需绑定模型，Dify 应用本身即为完整智能体</p>
                    <p style={{ margin: 0 }}>• 自动注册为主智能体的可调用子智能体</p>
                  </div>
                </div>
              )}
            </Form>
          </Tabs.TabPane>

          {!useDify && (
            <Tabs.TabPane key='model' title='⚙️ 模型参数'>
              <Form form={form} layout='vertical'>
                <Form.Item label={isInterviewAgent ? '绑定 TTS 模型' : '绑定模型'} field='model_id' extra={isInterviewAgent ? '面试官智能体仅可关联 TTS 模型' : '仅显示文本/多模态模型'}>
                  <Select options={mOpts} placeholder='选择模型（先在模型广场配 API Key）' allowClear />
                </Form.Item>
                <Form.Item
                  label='系统提示词'
                  field='sp'
                  extra='仅配置 Model 层角色、口吻和任务方法；平台会自动叠加 Agent = Model + Harness 边界，权限、执行、审计和高风险确认不依赖提示词。'
                >
                  <TextArea placeholder='定义智能体的角色和行为...' autoSize={{ minRows: 3, maxRows: 6 }} />
                </Form.Item>
                <Form.Item label={'Temperature (' + (form.getFieldValue?.('temp') ?? 0.7) + ')'} field='temp'>
                  <Slider min={0} max={2} step={0.1} />
                </Form.Item>
                <Form.Item label={'Top P (' + (form.getFieldValue?.('tp') ?? 0.9) + ')'} field='tp'>
                  <Slider min={0} max={1} step={0.05} />
                </Form.Item>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Form.Item label='最大 Token' field='mt'>
                    <InputNumber min={1} max={128000} style={{ width: '100%' }} suffix='tokens' />
                  </Form.Item>
                  <Form.Item label='记忆轮数' field='mw'>
                    <InputNumber min={0} max={100} style={{ width: '100%' }} suffix='轮' />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Form.Item label='对学生公开' field='pub' triggerPropName='checked'>
                    <Switch />
                  </Form.Item>
                  <Form.Item label='启用状态' field='enabled' triggerPropName='checked'>
                    <Switch />
                  </Form.Item>
                </div>
              </Form>
            </Tabs.TabPane>
          )}

          <Tabs.TabPane key='test' title='测试对话' disabled={!edit}>
            <div style={{ display: 'flex', flexDirection: 'column', height: 460 }}>
              {edit?.prompt_variables && edit.prompt_variables.length > 0 && (
                <div style={{ marginBottom: 10, padding: 10, borderRadius: 6, background: '#F9FAFB', border: '1px solid #E5E6EB' }}>
                  <Text style={{ fontSize: 11, color: '#9CA3AF', marginBottom: 4, display: 'block' }}>变量输入</Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {edit.prompt_variables.map(v => (
                      <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag size='small' style={{ borderRadius: 6 }}>{v.label || v.name}{v.required ? '*' : ''}</Tag>
                        <Input size='mini' style={{ width: 100 }} placeholder={v.default} value={vVals[v.name] || ''} onChange={val => setVVals(prev => ({ ...prev, [v.name]: val }))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: 10, borderRadius: 12, padding: 12, background: '#F8F9FB' }}>
                {msgs.length === 0 && (
                  <div style={{ textAlign: 'center', color: '#D1D5DB', paddingTop: 80 }}>
                    
                    <Text style={{ fontSize: 14, color: '#9CA3AF' }}>输入消息测试智能体</Text>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{ maxWidth: '85%', padding: '10px 16px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#3B82F6' : '#FFFFFF', color: m.role === 'user' ? '#fff' : '#1F2937', border: m.role === 'assistant' ? '1px solid #E5E6EB' : 'none', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap', boxShadow: m.role === 'assistant' ? '0 1px 2px rgba(0,0,0,0.04)' : '0 1px 2px rgba(0,0,0,0.06)' }}>
                      {m.content}
                    </div>
                  </div>
                ))}
                {cLoading && <Text style={{ fontSize: 13, color: '#6B7280', display: 'block', textAlign: 'center' }}>AI 正在思考...</Text>}
                <div ref={cEnd} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input style={{ flex: 1, borderRadius: 8 }} placeholder='输入测试消息...' value={cIn} onChange={v => setCIn(v)} onPressEnter={handleChat} />
                <Button type='primary' shape='circle' icon={<IconSend />} loading={cLoading} onClick={handleChat} style={{}} />
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Drawer>
    </div>
  )
}
