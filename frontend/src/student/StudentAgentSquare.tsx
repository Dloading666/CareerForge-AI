import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Space, Tag, Typography } from '@arco-design/web-react'
import { IconSearch } from '@arco-design/web-react/icon'
import { apiRequest } from '../shared/api'

const { Text } = Typography
const CAT_META: Record<string, { label: string; color: string }> = {
  interview: { label: '面试', color: '#165DFF' }, job_search: { label: '求职', color: '#FF6D00' },
  tools: { label: '工具', color: '#00B42A' }, other: { label: '其他', color: '#86909C' },
}
const FLT = [{ key: 'all', label: '全部' }, { key: 'interview', label: '面试' }, { key: 'job_search', label: '求职' }, { key: 'tools', label: '工具' }]
const tc = (c: string) => { if (c === 'interview') return 'blue'; if (c === 'job_search') return 'orange'; if (c === 'tools') return 'green'; return 'purple' }

interface AgentItem { id: number; name: string; description: string | null; category: string; icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null; model_config_id: number | null; model_config: { id: number; display_name: string; provider: string; model_identifier: string; base_url: string; protocols: string; open_to_student: boolean } | null; welcome_message: string | null; suggested_questions: string[] | null; prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null; system_prompt: string | null; temperature: number; max_tokens: number; is_enabled: boolean; is_published: boolean }

export function StudentAgentSquare({ onSelect }: { onSelect: (a: AgentItem) => void }) {
  const [agents, setAgents] = useState<AgentItem[]>([])
  const [flt, setFlt] = useState('all'); const [srch, setSrch] = useState('')
  const fetch = useCallback(async () => {
    try {
      const sp = new URLSearchParams()
      if (flt && flt !== 'all') sp.set('category', flt)
      if (srch) sp.set('search', srch)
      const qs = sp.toString()
      const r = await apiRequest<AgentItem[]>(`/api/v1/agents${qs ? `?${qs}` : ''}`)
      setAgents(Array.isArray(r) ? r : [])
    } catch { /* */ }
  }, [flt, srch])
  useEffect(() => { fetch() }, [fetch])

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 28, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.02em' }}>智能体广场</h2>
        <p style={{ color: '#86909C', fontSize: 14, margin: 0 }}>选一个智能体，挑一个模型，立即开始</p>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Space size={8}>{FLT.map(f => (
          <Button key={f.key} type={flt === f.key ? 'primary' : 'text'} size="small" shape="round" onClick={() => setFlt(f.key)}>{f.label}</Button>
        ))}</Space>
        <Input style={{ width: 220 }} placeholder="搜索智能体..." value={srch} onChange={v => setSrch(v)} allowClear
          prefix={<IconSearch style={{ color: '#86909C' }} />} />
      </div>
      <div className="admin-card-grid">
        {agents.map(a => {
          const meta = CAT_META[a.category] || CAT_META.other
          return (
            <div key={a.id} className="admin-card" onClick={() => onSelect(a)} style={{ cursor: 'pointer' }}>
              <div className="arco-card-body" style={{ padding: '22px 24px', display: 'flex', flexDirection: 'column' }}>
                <div className="agent-card-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={`resource-icon ${tc(a.category)}`}>
                      <span className="material-symbols-outlined" style={{ fontSize: 20, fontVariationSettings: "'FILL' 1" }}>{a.icon_name || 'smart_toy'}</span>
                    </span>
                    <h3>{a.name}</h3>
                  </div>
                </div>
                <p>{a.description || '暂无描述'}</p>
                <div className="ability-summary">
                  <span><Tag size="small" style={{ background: `${meta.color}14`, color: meta.color, border: 'none', borderRadius: 2, fontSize: 11 }}>{meta.label}</Tag></span>
                  <span style={{ fontSize: 12, color: '#646b7c' }}>{a.model_config?.display_name || '未绑定模型'}</span>
                </div>
                <div className="admin-card-footer">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00b42a' }} />
                    <Text style={{ fontSize: 12, color: '#86909C' }}>可用</Text>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
