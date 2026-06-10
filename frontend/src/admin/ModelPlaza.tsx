import {
  Alert, Button, Card, Drawer, Form, Input, InputNumber,
  Modal, Popconfirm, Select, Space, Switch, Tag,
} from '@arco-design/web-react'
import { IconEdit, IconDelete, IconPlayArrow, IconPlus, IconThunderbolt, IconSearch } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest, ApiError } from '../shared/api'

interface ModelItem { id: number; display_name: string; provider: string; deploy_type: string; capability: string; protocols: string; base_url: string; api_key_cipher: string | null; model_identifier: string; context_length: number | null; default_temp: number | null; max_output: number | null; timeout_sec: number | null; open_to_student: boolean; status: string }
interface ModelFormData { display_name: string; provider: string; deploy_type: string; capability: string; protocols: string; base_url: string; api_key: string; model_identifier: string; context_length?: number; default_temp?: number; max_output?: number; timeout_sec?: number; open_to_student: boolean }
const EMPTY_MODEL: ModelFormData = { display_name: '', provider: '', deploy_type: 'cloud', capability: 'text', protocols: '', base_url: '', api_key: '', model_identifier: '', open_to_student: false }

// → Base URL 预置映射：选择「供应商 + 协议」后自动填充。所有项可在 UI 手动覆盖。
const BASE_URL_PRESETS: Record<string, Record<string, string>> = {
  OpenAI:     { openai: 'https://api.openai.com/v1' },
  DeepSeek:   { openai: 'https://api.deepseek.com/v1' },
  Anthropic:  { anthropic: 'https://api.anthropic.com/v1' },
  '通义千问':   { openai: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  '智谱':        { openai: 'https://open.bigmodel.cn/api/paas/v4' },
  '月之暗面':    { openai: 'https://api.moonshot.cn/v1' },
  Azure:      { azure: 'https://YOUR_RESOURCE.openai.azure.com' },
  Ollama:     { openai: 'http://localhost:11434/v1' },
  '小米':       { openai: 'https://token-plan-cn.xiaomimimo.com/v1' },
}

function lookupBaseUrl(provider: string, protocols: string): string {
  return BASE_URL_PRESETS[provider]?.[protocols] ?? ''
}
const DEPLOY_LABELS: Record<string, { text: string; color: string }> = { cloud: { text: '云端', color: 'arcoblue' }, local: { text: '本地', color: 'green' }, third_party: { text: '第三方', color: 'orange' } }
const CAPABILITY_LABELS: Record<string, { text: string; color: string }> = { multimodal: { text: '多模态', color: 'purple' }, text: { text: '纯文本', color: 'blue' }, tts: { text: 'TTS 语音', color: 'orange' } }

export function ModelPlaza() {
  const [models, setModels] = useState<ModelItem[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelItem | null>(null)
  const lastAutoFilledUrlRef = useRef<string>('')
  const userTouchedBaseUrlRef = useRef<boolean>(false)
  const [form, setForm] = useState<ModelFormData>({ ...EMPTY_MODEL })
  const [submitting, setSubmitting] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<number>>(new Set())
  const [latencyMap, setLatencyMap] = useState<Record<number, { ms: number | null; ok: boolean }>>({})
  const [batchTesting, setBatchTesting] = useState(false)
  const [notify, setNotify] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ provider: string; modelName: string; success: boolean; latencyMs: number | null; httpStatus: number | null; requestUrl: string; responseBody: string; errorMessage: string | null; errorSummary: string | null } | null>(null)
  const [searchText, setSearchText] = useState('')
  const [filterCapability, setFilterCapability] = useState<string>('all')
  const [filterProvider, setFilterProvider] = useState<string>('all')
  const [filterDeploy, setFilterDeploy] = useState<string>('all')
  const showNotify = (type: 'success' | 'error' | 'warning' | 'info', text: string) => { setNotify({ type, text }); setTimeout(() => setNotify(null), 3000) }

  const fetchModels = useCallback(async () => {
    try { const r = await apiRequest<{ list: ModelItem[] }>('/api/v1/admin/models?size=100'); setModels(r.list) } catch { showNotify('error', '加载失败') }
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchModels()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchModels])

  const providerOptions = useMemo(() => {
    const set = new Set<string>()
    models.forEach((m) => set.add(m.provider))
    return Array.from(set).sort()
  }, [models])

  const filteredModels = useMemo(() => {
    const kw = searchText.trim().toLowerCase()
    return models.filter((m) => {
      if (filterCapability !== 'all' && m.capability !== filterCapability) return false
      if (filterProvider !== 'all' && m.provider !== filterProvider) return false
      if (filterDeploy !== 'all' && m.deploy_type !== filterDeploy) return false
      if (!kw) return true
      return (
        m.display_name.toLowerCase().includes(kw) ||
        m.model_identifier.toLowerCase().includes(kw) ||
        m.provider.toLowerCase().includes(kw) ||
        m.base_url.toLowerCase().includes(kw)
      )
    })
  }, [models, searchText, filterCapability, filterProvider, filterDeploy])

  const resetFilters = () => {
    setSearchText('')
    setFilterCapability('all')
    setFilterProvider('all')
    setFilterDeploy('all')
  }

  const openForm = (model?: ModelItem) => {
    setEditingModel(model ?? null)
    if (model) {
      setForm({
        display_name: model.display_name, provider: model.provider, deploy_type: model.deploy_type,
        capability: model.capability,
        protocols: model.protocols || '',
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

  const handleProviderChange = (v: string) => {
    setForm(p => {
      const suggested = lookupBaseUrl(v, p.protocols)
      const shouldAutoFill = suggested && !userTouchedBaseUrlRef.current && (p.base_url === '' || p.base_url === lastAutoFilledUrlRef.current)
      if (shouldAutoFill) {
        lastAutoFilledUrlRef.current = suggested
        return { ...p, provider: v, base_url: suggested }
      }
      return { ...p, provider: v }
    })
  }

  const handleProtocolsChange = (v: string) => {
    setForm(p => {
      const suggested = lookupBaseUrl(p.provider, v)
      const shouldAutoFill = suggested && !userTouchedBaseUrlRef.current && (p.base_url === '' || p.base_url === lastAutoFilledUrlRef.current)
      if (shouldAutoFill) {
        lastAutoFilledUrlRef.current = suggested
        return { ...p, protocols: v, base_url: suggested }
      }
      return { ...p, protocols: v }
    })
  }

  const handleBaseUrlChange = (v: string) => {
    userTouchedBaseUrlRef.current = true
    setForm(p => ({ ...p, base_url: v }))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      const p: Record<string, unknown> = { ...form }
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
    const model = models.find(m => m.id === id)
    const provider = model?.provider ?? ''
    const modelName = model?.model_identifier ?? ''
    try {
      const r = await apiRequest<{ success: boolean; latency_ms: number | null; http_status: number | null; response_body: string | null; request_url: string | null; error_message: string | null; error_summary: string | null }>(`/api/v1/admin/models/${id}/test`, { method: 'POST' })
      setLatencyMap(prev => ({ ...prev, [id]: { ms: r.latency_ms, ok: r.success } }))
      setTestResult({ provider, modelName, success: r.success, latencyMs: r.latency_ms, httpStatus: r.http_status, requestUrl: r.request_url ?? '', responseBody: r.response_body ?? '', errorMessage: r.error_message, errorSummary: r.error_summary ?? null })
    }
    catch (e) {
      setLatencyMap(prev => ({ ...prev, [id]: { ms: null, ok: false } }))
      setTestResult({ provider, modelName, success: false, latencyMs: null, httpStatus: null, requestUrl: '', responseBody: '', errorMessage: e instanceof Error ? e.message : '请求失败', errorSummary: null })
    }
    finally { setTestingIds(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  const handleBatchTest = async () => { setBatchTesting(true); try { const r = await apiRequest<{ model_id: number; success: boolean; latency_ms: number | null; error_summary: string | null; error_message: string | null }[]>('/api/v1/admin/models/test-batch', { method: 'POST' }); const m: Record<number, { ms: number | null; ok: boolean }> = {}; const failed = r.filter(x => !x.success); r.forEach(x => m[x.model_id] = { ms: x.latency_ms, ok: x.success }); setLatencyMap(m); const passed = r.length - failed.length; if (failed.length === 0) { showNotify('success', `批量测试通过 ${passed}/${r.length}`) } else { const lines = failed.slice(0, 5).map(x => { const mm = models.find(t => t.id === x.model_id); const name = mm?.display_name || ('#' + x.model_id); const reason = x.error_summary || x.error_message || '未知错误'; return `${name}：${reason}` }).join('；'); const more = failed.length > 5 ? ` 等${failed.length}个失败` : ''; showNotify('error', `失败 ${failed.length}/${r.length}：${lines}${more}`) } } catch { showNotify('error', '批量测试失败') } finally { setBatchTesting(false) } }

  return (
    <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button icon={<IconThunderbolt />} loading={batchTesting} onClick={handleBatchTest}>测试速度</Button>
        <Button icon={<IconPlus />} type="primary" onClick={() => openForm()}>添加模型</Button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Input
            allowClear
            placeholder="搜索 名称 / 模型标识 / 供应商 / Base URL"
            prefix={<IconSearch />}
            value={searchText}
            onChange={(v) => setSearchText(v)}
          />
        </div>
        <Select
          value={filterCapability}
          onChange={(v) => setFilterCapability(v)}
          style={{ width: 140 }}
          placeholder="能力类型"
        >
          <Select.Option value="all">全部能力</Select.Option>
          <Select.Option value="text">纯文本</Select.Option>
          <Select.Option value="multimodal">多模态</Select.Option>
          <Select.Option value="tts">TTS 语音</Select.Option>
        </Select>
        <Select
          value={filterProvider}
          onChange={(v) => setFilterProvider(v)}
          style={{ width: 180 }}
          placeholder="供应商"
          allowClear={false}
          disabled={providerOptions.length === 0}
        >
          <Select.Option value="all">全部供应商</Select.Option>
          {providerOptions.map((p) => (
            <Select.Option key={p} value={p}>{p}</Select.Option>
          ))}
        </Select>
        <Select
          value={filterDeploy}
          onChange={(v) => setFilterDeploy(v)}
          style={{ width: 140 }}
          placeholder="部署位置"
          allowClear={false}
        >
          <Select.Option value="all">全部部署</Select.Option>
          <Select.Option value="cloud">云端</Select.Option>
          <Select.Option value="local">本地</Select.Option>
          <Select.Option value="third_party">第三方</Select.Option>
        </Select>
        {(searchText || filterCapability !== 'all' || filterProvider !== 'all' || filterDeploy !== 'all') ? (
          <Button type="text" onClick={resetFilters}>重置</Button>
        ) : null}
      </div>
      <div style={{ marginBottom: 12, color: '#86909c', fontSize: 13 }}>
        共 {filteredModels.length} / {models.length} 个模型
        {(searchText || filterCapability !== 'all' || filterProvider !== 'all' || filterDeploy !== 'all') ? '（已筛选）' : ''}
      </div>
      {notify && <Alert type={notify.type} content={notify.text} closable onClose={() => setNotify(null)} style={{ marginBottom: 16 }} />}
      <div className="admin-card-grid">
        {filteredModels.length === 0 ? (
          <div style={{ gridColumn: '1 / -1', padding: '48px 16px', textAlign: 'center', color: '#86909c', background: '#fafbfc', border: '1px dashed #e2e8f0', borderRadius: 8 }}>
            没有匹配的模型。试试调整搜索或重置筛选。
          </div>
        ) : null}
        {filteredModels.map(m => { const lat = latencyMap[m.id]; const dl = DEPLOY_LABELS[m.deploy_type] ?? { text: m.deploy_type, color: 'gray' }; return (
          <Card key={m.id} className="admin-card model-card" hoverable>
            <div className="model-card-top"><Space size={6}><Tag color={dl.color}>{dl.text}</Tag>{(() => { const cl = CAPABILITY_LABELS[m.capability]; return cl ? <Tag color={cl.color}>{cl.text}</Tag> : <Tag color='gray'>{m.capability}</Tag> })()}</Space></div>
            <h3>{m.display_name}</h3>
            <div className="meta-list">
              <span>模型：{m.model_identifier}</span>
              <span style={{ fontSize: 12, wordBreak: 'break-all', color: '#5e6475' }}>来源：{m.base_url}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>状态：{lat ? (lat.ok ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: '#e8f5e9', color: '#00b42a', border: '1px solid #b7eb8f' }}><span style={{ fontSize: 14, fontWeight: 700 }}>✓</span>已验证 {lat.ms}ms</span> : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: '#ffece8', color: '#f53f3f', border: '1px solid #ffccc7' }}><span style={{ fontSize: 14, fontWeight: 700 }}>✗</span>失败</span>) : <span style={{ color: '#5e6475' }}>未测试</span>}</span>
            </div>
            <div className="admin-card-footer">
              <Space size={6}>{m.protocols.split(',').filter(Boolean).map(p => <Tag key={p}>{p.trim()}</Tag>)}<Tag>{m.provider}</Tag></Space>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button type="text" size="small" icon={<IconPlayArrow />} loading={testingIds.has(m.id)} onClick={() => handleTest(m.id)} />
                <Button type="text" size="small" icon={<IconEdit />} onClick={() => openForm(m)} />
                <Popconfirm title="确定删除？" onOk={() => handleDelete(m.id)}><Button type="text" size="small" status="danger" icon={<IconDelete />} /></Popconfirm>
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
          <Form.Item label="供应商" required><Select value={form.provider} onChange={handleProviderChange} placeholder="选择供应商" allowCreate>{['OpenAI','DeepSeek','Anthropic','通义千问','智谱','月之暗面','Azure','Ollama'].map(v=><Select.Option key={v} value={v}>{v}</Select.Option>)}</Select></Form.Item>
          <Form.Item label="部署位置"><Select value={form.deploy_type} onChange={v => setForm(p => ({...p, deploy_type: v}))}><Select.Option value="cloud">云端</Select.Option><Select.Option value="local">本地</Select.Option><Select.Option value="third_party">第三方</Select.Option></Select></Form.Item>
          <Form.Item label="能力类型"><Select value={form.capability} onChange={v => setForm(p => ({...p, capability: v}))}><Select.Option value="multimodal">多模态</Select.Option><Select.Option value="text">纯文本</Select.Option><Select.Option value="tts">TTS 语音</Select.Option></Select></Form.Item>
          <Form.Item label="协议"><Select value={form.protocols} onChange={handleProtocolsChange}>{['openai','anthropic','azure'].map(x=><Select.Option key={x} value={x}>{x}</Select.Option>)}</Select></Form.Item>
          <Form.Item label="Base URL" required extra={(form.base_url === '' || form.base_url === lastAutoFilledUrlRef.current) ? "根据供应商 + 协议自动填充，可手动修改" : "已手动修改，改变供应商/协议不再覆盖"}><Input value={form.base_url} onChange={handleBaseUrlChange} placeholder="https://api.deepseek.com/v1" /></Form.Item>
          <Form.Item label="API Key" extra={editingModel?.api_key_cipher ? '已配置密钥，留空保留原值' : '可选'}><Input.Password value={form.api_key} onChange={v => setForm(p => ({...p, api_key: v}))} placeholder={editingModel?.api_key_cipher ? '留空保留原值' : 'sk-xxx'} /></Form.Item>
          <Form.Item label="模型名称" required><Input value={form.model_identifier} onChange={v => setForm(p => ({...p, model_identifier: v}))} placeholder="deepseek-chat" /></Form.Item>
          <Form.Item label="超时(秒)"><InputNumber value={form.timeout_sec} onChange={v => setForm(p => ({...p, timeout_sec: v}))} placeholder="30" style={{ width: '100%' }} /></Form.Item>
          <Form.Item label="对学生开放"><Switch checked={form.open_to_student} onChange={v => setForm(p => ({...p, open_to_student: v}))} /></Form.Item>
        </Form>
      </Drawer>
      <Modal
        title="供应商测试"
        visible={Boolean(testResult)}
        onCancel={() => setTestResult(null)}
        footer={null}
        style={{ width: 720 }}
      >
        {testResult ? (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderRadius: 8,
                marginBottom: 16,
                background: testResult.success ? "#e8f5e9" : "#fff1f0",
                color: testResult.success ? "#00b42a" : "#f53f3f",
                border: "1px solid " + (testResult.success ? "#b7eb8f" : "#ffccc7"),
                fontSize: 16,
              }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  fontSize: 22,
                  fontWeight: 700,
                  background: testResult.success ? "#00b42a" : "#f53f3f",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {testResult.success ? "✓" : "✗"}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 2 }}>
                  {testResult.success ? "测试成功" : "测试失败"}
                </div>
                <div style={{ fontSize: 13, color: testResult.success ? "#389e0d" : "#cf1322", opacity: 0.85 }}>
                  已向 <strong>[{testResult.provider}]</strong> 用模型 <strong>[{testResult.modelName}]</strong> 发送 <code>hi</code>，HTTP <strong>{testResult.httpStatus ?? "--"}</strong>
                  {testResult.latencyMs !== null ? `，耗时 ${testResult.latencyMs}ms` : ``}
                </div>
              </div>
            </div>
            {testResult.errorSummary ? (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 6,
                  marginBottom: 12,
                  background: "#fff1f0",
                  border: "1px solid #ffccc7",
                  color: "#cf1322",
                  fontSize: 13,
                }}
              >
                <strong>错误摘要：</strong>{testResult.errorSummary}
              </div>
            ) : null}
            {testResult.errorMessage && testResult.errorMessage !== testResult.errorSummary ? (
              <div style={{ marginBottom: 12, color: "#86909c", fontSize: 12 }}>
                详细信息：{testResult.errorMessage}
              </div>
            ) : null}
            {testResult.requestUrl ? (
              <div style={{ marginBottom: 8, fontSize: 12, color: "#86909c" }}>POST {testResult.requestUrl}</div>
            ) : null}
            <pre style={{ background: "#0f172a", color: "#e6edf3", padding: 16, borderRadius: 8, maxHeight: 420, overflow: "auto", fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all", margin: 0 }}>{(testResult.responseBody || "（无响应体）")}</pre>
          </div>
        ) : null}
      </Modal>
    </>
  )
}
