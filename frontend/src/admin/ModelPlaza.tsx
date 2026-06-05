import {
  Alert, Button, Card, Drawer, Form, Input, InputNumber,
  Popconfirm, Select, Space, Switch, Tag,
} from '@arco-design/web-react'
import { IconEdit, IconDelete, IconPlayArrow, IconPlus, IconThunderbolt } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useState } from 'react'
import { apiRequest, ApiError } from '../shared/api'

interface ModelItem { id: number; display_name: string; provider: string; deploy_type: string; capability: string; protocols: string; base_url: string; api_key_cipher: string | null; model_identifier: string; context_length: number | null; default_temp: number | null; max_output: number | null; timeout_sec: number | null; open_to_student: boolean; status: string }
interface ModelFormData { display_name: string; provider: string; deploy_type: string; capability: string; protocols: string | string[]; base_url: string; api_key: string; model_identifier: string; context_length?: number; default_temp?: number; max_output?: number; timeout_sec?: number; open_to_student: boolean }
const EMPTY_MODEL: ModelFormData = { display_name: '', provider: '', deploy_type: 'cloud', capability: 'text', protocols: ['openai'], base_url: '', api_key: '', model_identifier: '', open_to_student: false }
const DEPLOY_LABELS: Record<string, { text: string; color: string }> = { cloud: { text: '云端', color: 'arcoblue' }, local: { text: '本地', color: 'green' }, third_party: { text: '第三方', color: 'orange' } }
const CAPABILITY_LABELS: Record<string, { text: string; color: string }> = { multimodal: { text: '多模态', color: 'purple' }, text: { text: '纯文本', color: 'blue' } }

export function ModelPlaza() {
  const [models, setModels] = useState<ModelItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null)
  const [form, setForm] = useState<ModelFormData>({ ...EMPTY_MODEL })
  const [submitting, setSubmitting] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set())
  const [latencyMap, setLatencyMap] = useState<Record<number, { ms: number | null; ok: boolean }>>({})
  const [batchTesting, setBatchTesting] = useState(false)
  const [notify, setNotify] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null)
  const showNotify = (type: 'success' | 'error' | 'warning' | 'info', text: string) => { setNotify({ type, text }); setTimeout(() => setNotify(null), 3000) }

  const fetchModels = useCallback(async () => {
    try { const r = await apiRequest<{ list: ModelItem[] }>('/api/v1/admin/models?size=100'); setModels(r.list) } catch { showNotify('error', '加载失败') }
  }, [])
  useEffect(() => { fetchModels() }, [fetchModels])

  const openForm = (model?: ModelItem) => {
    setEditingModel(model ?? null)
    if (model) {
      setForm({
        display_name: model.display_name, provider: model.provider, deploy_type: model.deploy_type,
        capability: model.capability,
        protocols: model.protocols ? model.protocols.split(',').filter(Boolean) : [],
        base_url: model.base_url, api_key: '', model_identifier: model.model_identifier,
        context_length: model.context_length ?? undefined,
        default_temp: model.default_temp ?? undefined,
        max_output: model.max_output ?? undefined,
        timeout_sec: model.timeout_sec ?? undefined,
        open_to_student: model.open_to_student,
      })
    } else {
      setForm({ ...EMPTY_MODEL })
    }
    setDrawerOpen(true)
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const p: Record<string, unknown> = { ...form, protocols: Array.isArray(form.protocols) ? form.protocols.join(',') : form.protocols }
      if (!p.api_key) delete p.api_key
      if (editingModel) { await apiRequest(`/api/v1/admin/models/${editingModel.id}`, { method: 'PUT', body: JSON.stringify(p) }); showNotify('success', '模型已更新') }
      else { await apiRequest('/api/v1/admin/models', { method: 'POST', body: JSON.stringify(p) }); showNotify('success', '模型已创建') }
      setDrawerOpen(false); fetchModels()
    } catch (e) { showNotify('error', e instanceof ApiError ? e.message : '操作失败') }
    finally { setSubmitting(false) }
  }

  const handleDelete = async (id: number) => { try { await apiRequest(`/api/v1/admin/models/${id}`, { method: 'DELETE' }); showNotify('success', '已删除'); fetchModels() } catch { showNotify('error', '删除失败') } }
  const handleToggleOpen = async (id: number, open: boolean) => { try { await apiRequest(`/api/v1/admin/models/${id}/open`, { method: 'PATCH', body: JSON.stringify({ open }) }); setModels(prev => prev.map(m => m.id === id ? { ...m, open_to_student: open } : m)) } catch { showNotify('error', '操作失败') } }

  const handleTest = async (id: number) => {
    setTestingIds(prev => new Set(prev).add(id))
    try { const r = await apiRequest<{ success: boolean; latency_ms: number | null }>(`/api/v1/admin/models/${id}/test`, { method: 'POST' }); setLatencyMap(prev => ({ ...prev, [id]: { ms: r.latency_ms, ok: r.success } })); showNotify(r.success ? 'success' : 'warning', r.success ? `延迟 ${r.latency_ms}ms` : '连接失败') }
    catch { setLatencyMap(prev => ({ ...prev, [id]: { ms: null, ok: false } })) }
    finally { setTestingIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  const handleBatchTest = async () => { setBatchTesting(true); try { const r = await apiRequest<{ model_id: number; success: boolean; latency_ms: number | null }[]>('/api/v1/admin/models/test-batch', { method: 'POST' }); const m: Record<number, { ms: number | null; ok: boolean }> = {}; r.forEach(x => m[x.model_id] = { ms: x.latency_ms, ok: x.success }); setLatencyMap(m); showNotify('success', `批量：${r.filter(x=>x.success).length}/${r.length} 通过`) } catch { showNotify('error', '批量测试失败') } finally { setBatchTesting(false) } }

  const latencyColor = (ms: number | null, ok: boolean) => { if (!ok || ms === null) return '#f53f3f'; if (ms < 500) return '#00b42a'; if (ms < 1000) return '#ff7d00'; return '#f53f3f' }

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <Button icon={<IconThunderbolt />} loading={batchTesting} onClick={handleBatchTest}>测试速度</Button>
        <Button icon={<IconPlus />} type="primary" onClick={() => openForm()}>添加模型</Button>
      </div>
      {notify && <Alert type={notify.type} content={notify.text} closable onClose={() => setNotify(null)} style={{ marginBottom: 16 }} />}
      <div className="admin-card-grid">
        {models.map(m => { const lat = latencyMap[m.id]; const dl = DEPLOY_LABELS[m.deploy_type] ?? { text: m.deploy_type, color: 'gray' }; return (
          <Card key={m.id} className="admin-card model-card" hoverable>
            <div className="model-card-top"><Space size={6}><Tag color={dl.color}>{dl.text}</Tag>{(() => { const cl = CAPABILITY_LABELS[m.capability]; return cl ? <Tag color={cl.color}>{cl.text}</Tag> : <Tag color='gray'>{m.capability}</Tag> })()}</Space></div>
            <h3>{m.display_name}</h3>
            <div className="meta-list">
              <span>模型：{m.model_identifier}</span>
              <span style={{ fontSize: 12, wordBreak: 'break-all', color: '#5e6475' }}>来源：{m.base_url}</span>
              <span>延迟：{lat ? <strong style={{ color: latencyColor(lat.ms, lat.ok) }}>{lat.ok ? `${lat.ms}ms` : '连接失败'}</strong> : <span style={{ color: '#5e6475' }}>未测试</span>}</span>
            </div>
            <div className="admin-card-footer">
              <Space size={6}>{m.protocols.split(',').filter(Boolean).map(p => <Tag key={p}>{p.trim()}</Tag>)}<Tag>{m.provider}</Tag></Space>
              <div style={{ display: 'flex', gap: 4 }}>
                <Button type="text" size="mini" icon={<IconPlayArrow />} loading={testingIds.has(m.id)} onClick={() => handleTest(m.id)} />
                <Button type="text" size="mini" icon={<IconEdit />} onClick={() => openForm(m)} />
                <Popconfirm title="确定删除？" onOk={() => handleDelete(m.id)}><Button type="text" size="mini" status="danger" icon={<IconDelete />} /></Popconfirm>
              </div>
            </div>
            <div className="student-open-switch"><span>对学生开放</span><Switch checked={m.open_to_student} onChange={v => handleToggleOpen(m.id, v)} /></div>
          </Card>
        )})}
        <button className="admin-add-card" type="button" onClick={() => openForm()}><IconPlus /><strong>添加模型</strong><span>OpenAI / Anthropic / Ollama API</span></button>
      </div>
      <Drawer title={editingModel ? '编辑模型' : '添加模型'} visible={drawerOpen} width={520} onCancel={() => setDrawerOpen(false)}
        footer={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={handleSubmit}>{editingModel ? '保存' : '创建'}</Button></Space>}>
        <Form layout="vertical" style={{ paddingRight: 8 }}>
          <Form.Item label="展示名称" required><Input value={form.display_name} onChange={v => setForm(p => ({...p, display_name: v}))} placeholder="如 DeepSeek 对话-生产" /></Form.Item>
          <Form.Item label="供应商" required><Select value={form.provider} onChange={v => setForm(p => ({...p, provider: v}))} placeholder="选择供应商" allowCreate>{['OpenAI','DeepSeek','Anthropic','通义千问','智谱','月之暗面','Azure','Ollama'].map(v=><Select.Option key={v} value={v}>{v}</Select.Option>)}</Select></Form.Item>
          <Form.Item label="部署位置"><Select value={form.deploy_type} onChange={v => setForm(p => ({...p, deploy_type: v}))}><Select.Option value="cloud">云端</Select.Option><Select.Option value="local">本地</Select.Option><Select.Option value="third_party">第三方</Select.Option></Select></Form.Item>
          <Form.Item label="能力类型"><Select value={form.capability} onChange={v => setForm(p => ({...p, capability: v}))}><Select.Option value="multimodal">多模态</Select.Option><Select.Option value="text">纯文本</Select.Option></Select></Form.Item>
          <Form.Item label="协议"><Select mode="multiple" value={Array.isArray(form.protocols) ? form.protocols : form.protocols.split(',').filter(Boolean)} onChange={v => setForm(p => ({...p, protocols: v}))}>{['openai','anthropic','azure'].map(x=><Select.Option key={x} value={x}>{x}</Select.Option>)}</Select></Form.Item>
          <Form.Item label="Base URL" required><Input value={form.base_url} onChange={v => setForm(p => ({...p, base_url: v}))} placeholder="https://api.deepseek.com/v1" /></Form.Item>
          <Form.Item label="API Key" extra={editingModel?.api_key_cipher ? '已配置密钥，留空保留原值' : '可选'}><Input.Password value={form.api_key} onChange={v => setForm(p => ({...p, api_key: v}))} placeholder={editingModel?.api_key_cipher ? '留空保留原值' : 'sk-xxx'} /></Form.Item>
          <Form.Item label="模型名称" required><Input value={form.model_identifier} onChange={v => setForm(p => ({...p, model_identifier: v}))} placeholder="deepseek-chat" /></Form.Item>
          <Form.Item label="超时(秒)"><InputNumber value={form.timeout_sec} onChange={v => setForm(p => ({...p, timeout_sec: v}))} placeholder="30" style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="对学生开放"><Switch checked={form.open_to_student} onChange={v => setForm(p => ({...p, open_to_student: v}))} /></Form.Item>
        </Form>
      </Drawer>
    </>
  )
}
