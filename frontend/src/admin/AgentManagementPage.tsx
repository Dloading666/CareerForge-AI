import {
  Button, Drawer, Form, Input, InputNumber, Popconfirm,
  Select, Slider, Space, Switch, Tabs, Tag, Typography,
} from '@arco-design/web-react'
import { IconDelete, IconEdit, IconPlus, IconSend } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../shared/api'

const { Text } = Typography
const { TextArea } = Input

interface ModelItem { id: number; display_name: string; provider: string; model_identifier: string; base_url: string; api_key_cipher: string | null; capability: string; protocols: string; status: string; open_to_student: boolean }
interface AgentItem { id: number; name: string; description: string | null; category: string; icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null; model_config_id: number | null; model_config: ModelItem | null; welcome_message: string | null; suggested_questions: string[] | null; prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null; system_prompt: string | null; temperature: number; max_tokens: number; top_p: number; frequency_penalty: number; presence_penalty: number; memory_window: number; use_dify: boolean; dify_api_key_cipher: string | null; dify_api_base_url: string | null; dify_app_id: string | null; is_enabled: boolean; is_published: boolean }

const CAT_META: Record<string, { label: string; color: string }> = {
  interview: { label: '面试', color: '#165DFF' }, job_search: { label: '求职', color: '#FF6D00' },
  tools: { label: '工具', color: '#00B42A' }, other: { label: '其他', color: '#86909C' },
}
const CAT_FLT = [{ key: 'all', label: '全部' }, ...Object.entries(CAT_META).map(([k, v]) => ({ key: k, label: v.label }))]
const CAT_OPT = Object.entries(CAT_META).map(([k, v]) => ({ value: k, label: v.label }))
const ICONS = [
  { value: 'smart_toy', label: '🤖 智能体' }, { value: 'record_voice_over', label: '🎤 面试' },
  { value: 'join_inner', label: '🔗 匹配' }, { value: 'description', label: '📄 简历' },
  { value: 'psychology', label: '🧠 测评' }, { value: 'support_agent', label: '🎧 客服' },
  { value: 'school', label: '🏫 学业' }, { value: 'work', label: '💼 职业' },
  { value: 'trending_up', label: '📈 成长' }, { value: 'auto_awesome', label: '✨ 创意' },
]
const tc = (c: string) => { if (c === 'interview') return 'blue'; if (c === 'job_search') return 'orange'; if (c === 'tools') return 'green'; return 'purple' }
interface ChatMsg { role: 'user' | 'assistant'; content: string }

export function AgentManagementPage() {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [models, setModels] = useState<ModelItem[]>([])
  const [flt, setFlt] = useState('all'); const [srch, setSrch] = useState('')
  const [drawer, setDrawer] = useState(false)
  const [edit, setEdit] = useState<AgentItem | null>(null)
  const [form] = Form.useForm(); const [sub, setSub] = useState(false)
  const [tab, setTab] = useState('basic')
  const [msgs, setMsgs] = useState<ChatMsg[]>([]); const [cIn, setCIn] = useState(''); const [difyTestResult, setDifyTestResult] = useState<string | null>(null); const [cLoading, setCLoading] = useState(false)
  const [vVals, setVVals] = useState<Record<string, string>>({}); const cEnd = useRef<HTMLDivElement>(null)

  // ── fetch ──
  const fetchModels = useCallback(async () => {
    try {
      const r = await apiRequest<{ list: ModelItem[] }>('/api/v1/admin/models?size=100')
      setModels(r.list)
    } catch { /* silent */ }
  }, [])

  const fetchAgents = useCallback(async () => {
    try {
      const sp = new URLSearchParams()
      if (flt && flt !== 'all') sp.set('category', flt)
      if (srch) sp.set('search', srch)
      const qs = sp.toString()
      const r = await apiRequest<AgentItem[]>(`/api/v1/admin/agents${qs ? `?${qs}` : ''}`)
      setAgents(Array.isArray(r) ? r : [])
    } catch { /* silent */ }
  }, [flt, srch])

  useEffect(() => { fetchAgents() }, [fetchAgents])
  useEffect(() => { fetchModels() }, [fetchModels])
  useEffect(() => {
    const h = () => { setEdit(null); form.resetFields(); setMsgs([]); setTab('basic'); setDrawer(true) }
    window.addEventListener('agent-create', h); return () => window.removeEventListener('agent-create', h)
  }, [])
  useEffect(() => { cEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  // ── drawer ──
  const openEdit = (a: AgentItem) => {
    setEdit(a); const v: Record<string, string> = {}
    if (a.prompt_variables) for (const pv of a.prompt_variables) v[pv.name] = pv.default || ''
    setVVals(v); setMsgs([])
    form.setFieldsValue({
      name: a.name, desc: a.description || '', cat: a.category, icon: a.icon_name || 'smart_toy',
      cFrom: a.icon_color_from || '#7C4DFF', cTo: a.icon_color_to || '#2962FF',
      model_id: a.model_config_id || undefined, welcome: a.welcome_message || '',
      use_dify: a.use_dify || false, dify_api_key: '', dify_api_base_url: a.dify_api_base_url || 'https://api.dify.ai/v1', dify_app_id: a.dify_app_id || '',
      sq: a.suggested_questions || [], pv: a.prompt_variables || [], sp: a.system_prompt || '',
      temp: a.temperature ?? 0.7, mt: a.max_tokens ?? 4096, tp: a.top_p ?? 0.9,
      fp: a.frequency_penalty ?? 0, pp: a.presence_penalty ?? 0, mw: a.memory_window ?? 10,
      enabled: a.is_enabled, pub: a.is_published,
    }); setTab('basic'); setDrawer(true)
  }

  const handleTestDify = async () => {
    const vals = form.getFieldsValue?.() || {}
    if (!vals.dify_api_base_url || !vals.dify_api_key) {
      setDifyTestResult("???? Base URL ? API Secret")
      return
    }
    setDifyTestResult("???...")
    try {
      const r = await apiRequest<{ success: boolean; message: string; diagnostics?: { path: string; status: number; message: string }[]; hint?: string }>("/api/v1/admin/agents/test-dify", {
        method: "POST",
        body: JSON.stringify({ api_base_url: vals.dify_api_base_url, api_key: vals.dify_api_key, app_id: vals.dify_app_id || "" }),
      })
      if (r.success) {
        setDifyTestResult("OK " + r.message)
      } else {
        const diag = r.diagnostics?.map(d => `${d.path}: ${d.status} ${d.message}`).join(" | ") || ""
        setDifyTestResult("FAIL " + r.message + (diag ? " [" + diag + "]" : ""))
      }
      setTimeout(() => setDifyTestResult(null), 10000)
    } catch {
      setDifyTestResult("FAIL ????")
      setTimeout(() => setDifyTestResult(null), 5000)
    }
  }

  const handleSubmit = async () => {
    try {
      const vals = await form.validate(); setSub(true)
      const body = JSON.stringify({
        name: vals.name, description: vals.desc, category: vals.cat,
        icon_name: vals.icon, icon_color_from: vals.cFrom, icon_color_to: vals.cTo,
        model_config_id: vals.model_id || null, welcome_message: vals.welcome,
      use_dify: vals.use_dify || false, dify_api_key: vals.dify_api_key || undefined, dify_api_base_url: vals.dify_api_base_url || undefined, dify_app_id: vals.dify_app_id || undefined,
        suggested_questions: (vals.sq || []).filter(Boolean),
        prompt_variables: (vals.pv || []).filter((v: { name: string }) => v.name?.trim()),
        system_prompt: vals.sp, temperature: vals.temp, max_tokens: vals.mt,
        top_p: vals.tp, frequency_penalty: vals.fp, presence_penalty: vals.pp,
        memory_window: vals.mw, is_enabled: vals.enabled, is_published: vals.pub,
      })
      if (edit) {
        await apiRequest(`/api/v1/admin/agents/${edit.id}`, { method: 'PUT', body })
      } else {
        await apiRequest('/api/v1/admin/agents', { method: 'POST', body })
      }
      setDrawer(false); fetchAgents()
    } catch (err: unknown) { if (err && typeof err === 'object' && 'isFieldError' in err) return }
    finally { setSub(false) }
  }

  const handleToggle = async (a: AgentItem, chk: boolean) => {
    try {
      await apiRequest(`/api/v1/admin/agents/${a.id}/toggle`, { method: 'PATCH', body: JSON.stringify({ is_enabled: chk }) })
      setAgents(prev => prev.map(x => x.id === a.id ? { ...x, is_enabled: chk } : x))
    } catch { /* */ }
  }
  const handleDelete = async (a: AgentItem) => {
    try { await apiRequest(`/api/v1/admin/agents/${a.id}`, { method: 'DELETE' }); setAgents(prev => prev.filter(x => x.id !== a.id)) } catch { /* */ }
  }
  const handleChat = async () => {
    const m = cIn.trim(); if (!m || !edit || cLoading) return
    setCIn(''); setMsgs(prev => [...prev, { role: 'user', content: m }]); setCLoading(true)
    try {
      const r = await apiRequest<{ reply: string; model_name: string; usage: unknown }>(`/api/v1/admin/agents/${edit.id}/chat`, {
        method: 'POST', body: JSON.stringify({ message: m, variables: Object.keys(vVals).length > 0 ? vVals : {} }),
      })
      setMsgs(prev => [...prev, { role: 'assistant', content: r.reply }])
    } catch (err: unknown) {
      setMsgs(prev => [...prev, { role: 'assistant', content: `❌ ${err instanceof Error ? err.message : '调用失败'}` }])
    } finally { setCLoading(false) }
  }

  const mOpts = models.filter(m => m.status === 'active').map(m => ({ value: m.id, label: `${m.display_name} (${m.model_identifier})` }))

  // ── render ──
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 22 }}>
        <Space size={8}>
          {CAT_FLT.map(f => (
            <Button key={f.key} type={flt === f.key ? 'primary' : 'text'} size="small" shape="round" onClick={() => setFlt(f.key)}>{f.label}</Button>
          ))}
        </Space>
        <Input style={{ width: 240 }} placeholder="搜索智能体..." value={srch} onChange={v => setSrch(v)} allowClear
          prefix={<span className="material-symbols-outlined" style={{ fontSize: 18, color: '#86909C' }}>search</span>} />
      </div>

      <div className="admin-card-grid">
        {agents.map(a => {
          const meta = CAT_META[a.category] || CAT_META.other
          return (
            <div key={a.id} className="admin-card" onClick={() => openEdit(a)} style={{ cursor: 'pointer' }}>
              <div className="arco-card-body" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
                <div className="agent-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`resource-icon ${tc(a.category)}`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>{a.icon_name || 'smart_toy'}</span>
                    </span>
                    <h3>{a.name}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button type="text" size="small" icon={<IconEdit />} onClick={e => { e.stopPropagation(); openEdit(a) }} />
                    <Popconfirm title="确定删除？" onOk={() => handleDelete(a)}>
                      <Button type="text" size="small" status="danger" icon={<IconDelete />} onClick={e => e.stopPropagation()} />
                    </Popconfirm>
                  </div>
                </div>
                <p>{a.description || '暂无描述'}</p>
                <div className="ability-summary">
                  <span><Tag size="small" style={{ background: `${meta.color}14`, color: meta.color, border: 'none', borderRadius: 2, fontSize: 11 }}>{meta.label}</Tag></span>
                  <span style={{ fontSize: 12, color: '#646b7c' }}>{a.model_config?.display_name || '未绑定模型'}</span>
                </div>
                <div className="admin-card-footer">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.is_enabled ? '#00b42a' : '#c9cdd4' }} />
                    <Text style={{ fontSize: 12, color: '#86909C' }}>{a.is_enabled ? '已启用' : '已禁用'}</Text>
                  </div>
                  <Switch size="small" checked={a.is_enabled} onChange={checked => { handleToggle(a, checked) }} />
                </div>
              </div>
            </div>
          )
        })}
        <div className="admin-add-card" onClick={() => { setEdit(null); form.resetFields(); setMsgs([]); setVVals({}); setTab('basic'); setDrawer(true) }}>
          <IconPlus style={{ fontSize: 28 }} /><span>创建智能体</span>
        </div>
      </div>

      <Drawer width={640} title={edit ? `编辑 · ${edit.name}` : '创建智能体'} visible={drawer} onCancel={() => setDrawer(false)}
        footer={<div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
          <Button onClick={() => setDrawer(false)}>取消</Button>
          <Button type="primary" loading={sub} onClick={handleSubmit}>{edit ? '保存' : '创建'}</Button>
        </div>}>
        <Tabs activeTab={tab} onChange={setTab} style={{ marginTop: -8 }}>
          <Tabs.TabPane key="basic" title="基础信息">
            <Form form={form} layout="vertical">
              <Form.Item label="名称" field="name" rules={[{ required: true }]}><Input placeholder="如：AI 面试官" maxLength={64} /></Form.Item>
              <Form.Item label="分类" field="cat"><Select options={CAT_OPT} /></Form.Item>
              <Form.Item label="描述" field="desc"><Input placeholder="一句话描述用途" maxLength={256} /></Form.Item>
              <Form.Item label="图标" field="icon"><Select options={ICONS} style={{ width: 200 }} /></Form.Item>
              <Space>
                <Form.Item label="渐变色起始" field="cFrom"><Input style={{ width: 105 }} /></Form.Item>
                <Form.Item label="渐变色结束" field="cTo"><Input style={{ width: 105 }} /></Form.Item>
              </Space>
              <Form.Item label="欢迎语" field="welcome"><TextArea placeholder="开场白..." rows={2} maxLength={512} /></Form.Item>
              <Form.Item label="建议问题（一行一个）" field="sq">
                {(() => {
                  const v: string[] = form.getFieldValue?.('sq') || []
                  return <div>{v.concat('').map((q, i) => (
                    <Input key={i} style={{ marginBottom: 6 }} placeholder={i >= v.length ? '+ 添加' : `问题 ${i + 1}`}
                      value={q} allowClear={i < v.length}
                      onChange={val => { const n = [...v]; if (i < v.length) { if (val) n[i] = val; else n.splice(i, 1) } else if (val) n.push(val); form.setFieldValue('sq', n.filter(Boolean)) }} />
                  ))}</div>
                })()}
              </Form.Item>
            </Form>
          </Tabs.TabPane>
          <Tabs.TabPane key="prompt" title="提示词与变量">
            <Form form={form} layout="vertical">
              <Form.Item label="系统提示词" field="sp">
                <TextArea placeholder="使用 {{变量名}} 注入上下文..." rows={6} maxLength={4000} showWordLimit />
              </Form.Item>
              <Form.Item label="变量定义" field="pv">
                {(() => {
                  const vars: Array<{ name: string; label: string; required: boolean; default: string }> = form.getFieldValue?.('pv') || []
                  return <div>
                    {vars.map((v, i) => (
                      <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                        <Input size="mini" style={{ width: 90 }} placeholder="变量名" value={v.name}
                          onChange={vv => { const n = [...vars]; n[i] = { ...n[i], name: vv }; form.setFieldValue('pv', n) }} />
                        <Input size="mini" style={{ width: 90 }} placeholder="标签" value={v.label}
                          onChange={vv => { const n = [...vars]; n[i] = { ...n[i], label: vv }; form.setFieldValue('pv', n) }} />
                        <Switch size="small" checked={v.required}
                          onChange={vv => { const n = [...vars]; n[i] = { ...n[i], required: vv }; form.setFieldValue('pv', n) }} />
                        <span style={{ fontSize: 11, color: '#86909C' }}>必填</span>
                        <Input size="mini" style={{ flex: 1 }} placeholder="默认值" value={v.default}
                          onChange={vv => { const n = [...vars]; n[i] = { ...n[i], default: vv }; form.setFieldValue('pv', n) }} />
                        <Button type="text" size="small" status="danger" icon={<IconDelete />}
                          onClick={() => { const n = vars.filter((_, j) => j !== i); form.setFieldValue('pv', n) }} />
                      </div>
                    ))}
                    <Button size="small" icon={<IconPlus />} onClick={() => {
                      form.setFieldValue('pv', [...vars, { name: '', label: '', required: false, default: '' }])
                    }}>添加变量</Button>
                  </div>
                })()}
              </Form.Item>
            </Form>
          </Tabs.TabPane>
          <Tabs.TabPane key="dify" title="Dify 配置">
            <Form form={form} layout="vertical">
              <Form.Item label="启用 Dify 智能体" field="use_dify" triggerPropName="checked">
                <Switch />
              </Form.Item>
              {(() => {
                const useDify = form.getFieldValue?.("use_dify")
                if (!useDify) return null
                return <>
                  <Form.Item label="Dify API Base URL" field="dify_api_base_url" required>
                    <Input placeholder="https://api.dify.ai/v1" />
                  </Form.Item>
                  <Form.Item label="Dify API Secret" field="dify_api_key" required>
                    <Input.Password placeholder="app-xxxxxxxxxxxxxxxxxxxx" />
                  </Form.Item>
                  <Form.Item label="Dify App ID" field="dify_app_id">
                    <Input placeholder="可选，用于标识 Dify 应用" />
                  </Form.Item>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <Button size="small" onClick={handleTestDify}>测试连接</Button>
                    {difyTestResult && (
                      <Tag size="small" color={difyTestResult.startsWith("OK") ? "green" : "red"}>
                        {difyTestResult}
                      </Tag>
                    )}
                  </div>
                  <div style={{ padding: "10px 14px", background: "#f0f5ff", borderRadius: 6, fontSize: 12, color: "#4e5969", lineHeight: "18px", marginTop: 8 }}>
                    <p style={{ margin: 0, fontWeight: 600, marginBottom: 4 }}>开启后：</p>
                    <p style={{ margin: 0 }}>1. 请在 Dify 平台 → 应用 → API 访问 中获取 API Secret（非 App ID）</p>
                    <p style={{ margin: 0 }}>2. 该智能体的对话将直接调用 Dify chat-messages API</p>
                    <p style={{ margin: 0 }}>3. 自动注册为主智能体的可调用子智能体</p>
                    <p style={{ margin: 0, marginTop: 4, color: "#165DFF", fontWeight: 500 }}>注意：启用 Dify 后无需选择模型和配置参数，Dify 应用本身即为完整的智能体。</p>
                  </div>
                </>
              })()}
            </Form>
          </Tabs.TabPane>
          {!form.getFieldValue?.("use_dify") && (
          <Tabs.TabPane key="model" title="模型与参数">
            <Form form={form} layout="vertical">
              <Form.Item label="绑定模型" field="model_id">
                <Select options={mOpts} placeholder="选择模型（需先在模型广场配置 API Key）" allowClear />
              </Form.Item>
              <Form.Item label={`Temperature (${form.getFieldValue?.('temp') ?? 0.7})`} field="temp"><Slider min={0} max={2} step={0.1} /></Form.Item>
              <Form.Item label={`Top P (${form.getFieldValue?.('tp') ?? 0.9})`} field="tp"><Slider min={0} max={1} step={0.05} /></Form.Item>
              <Form.Item label="Frequency Penalty" field="fp"><Slider min={-2} max={2} step={0.1} /></Form.Item>
              <Form.Item label="Presence Penalty" field="pp"><Slider min={-2} max={2} step={0.1} /></Form.Item>
              <Form.Item label="最大 Token" field="mt"><InputNumber min={1} max={128000} style={{ width: 140 }} suffix="tokens" /></Form.Item>
              <Form.Item label="记忆轮数" field="mw"><InputNumber min={0} max={100} style={{ width: 140 }} suffix="轮" /></Form.Item>
              <Form.Item label="对学生开放" field="pub" triggerPropName="checked"><Switch /></Form.Item>
              <Form.Item label="启用状态" field="enabled" triggerPropName="checked"><Switch /></Form.Item>
            </Form>
          </Tabs.TabPane>
          )}
          <Tabs.TabPane key="test" title="测试对话" disabled={!edit}>
            <div style={{ display: 'flex', flexDirection: 'column', height: 500 }}>
              {edit?.prompt_variables && edit.prompt_variables.length > 0 && (
                <div style={{ marginBottom: 10, padding: 10, background: '#f7f8fa', borderRadius: 6 }}>
                  <Text style={{ fontSize: 11, color: '#86909C', marginBottom: 4, display: 'block' }}>变量输入</Text>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {edit.prompt_variables.map(v => (
                      <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag size="small" style={{ borderRadius: 2 }}>{v.label || v.name}{v.required ? '*' : ''}</Tag>
                        <Input size="mini" style={{ width: 100 }} placeholder={v.default}
                          value={vVals[v.name] || ''} onChange={val => setVVals(prev => ({ ...prev, [v.name]: val }))} />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ flex: 1, overflowY: 'auto', marginBottom: 10, background: '#faf8ff', borderRadius: 8, padding: 10 }}>
                {msgs.length === 0 && <div style={{ textAlign: 'center', color: '#c9cdd4', paddingTop: 60 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 36 }}>chat</span>
                  <p style={{ fontSize: 13 }}>输入消息测试智能体</p>
                </div>}
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{ maxWidth: '85%', padding: '8px 14px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: m.role === 'user' ? '#165DFF' : '#fff', color: m.role === 'user' ? '#fff' : '#1D2129',
                      border: m.role === 'assistant' ? '1px solid #E5E6EB' : 'none', fontSize: 13, lineHeight: '20px', whiteSpace: 'pre-wrap',
                    }}>{m.content}</div>
                  </div>
                ))}
                {cLoading && <Text style={{ fontSize: 12, color: '#86909C', display: 'block', textAlign: 'center' }}>AI 正在思考...</Text>}
                <div ref={cEnd} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input style={{ flex: 1 }} placeholder="输入测试消息..." value={cIn} onChange={v => setCIn(v)} onPressEnter={handleChat} />
                <Button type="primary" icon={<IconSend />} loading={cLoading} onClick={handleChat}>发送</Button>
              </div>
            </div>
          </Tabs.TabPane>
        </Tabs>
      </Drawer>
    </>
  )
}
