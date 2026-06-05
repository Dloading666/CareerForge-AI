import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag, Typography } from '@arco-design/web-react'
import { IconArrowLeft, IconSend } from '@arco-design/web-react/icon'
import { apiRequest } from '../shared/api'

const { Text, Title } = Typography
interface ChatMsg { role: 'user' | 'assistant'; content: string }

interface AgentItem { id: number; name: string; description: string | null; icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null; model_config: { display_name: string } | null; welcome_message: string | null; suggested_questions: string[] | null; prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null }

export function StudentAgentChat({ agent, onBack }: { agent: AgentItem; onBack: () => void }) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [inp, setInp] = useState(''); const [sending, setSending] = useState(false)
  const [vVals, setVVals] = useState<Record<string, string>>({})
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const v: Record<string, string> = {}
    if (agent.prompt_variables) for (const pv of agent.prompt_variables) v[pv.name] = pv.default || ''
    setVVals(v)
  }, [agent])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])

  const handleSend = async () => {
    const m = inp.trim(); if (!m || sending) return
    setInp(''); setMsgs(prev => [...prev, { role: 'user', content: m }]); setSending(true)
    try {
      const r = await apiRequest<{ reply: string }>(`/api/v1/agents/${agent.id}/chat`, {
        method: 'POST', body: JSON.stringify({ message: m, variables: Object.keys(vVals).length > 0 ? vVals : {} }),
      })
      setMsgs(prev => [...prev, { role: 'assistant', content: r.reply }])
    } catch (err: unknown) {
      setMsgs(prev => [...prev, { role: 'assistant', content: `❌ ${err instanceof Error ? err.message : '调用失败'}` }])
    } finally { setSending(false) }
  }

  const quick = (q: string) => {
    setMsgs(prev => [...prev, { role: 'user', content: q }]); setSending(true)
    apiRequest<{ reply: string }>(`/api/v1/agents/${agent.id}/chat`, {
      method: 'POST', body: JSON.stringify({ message: q, variables: Object.keys(vVals).length > 0 ? vVals : {} }),
    }).then(r => setMsgs(prev => [...prev, { role: 'assistant', content: r.reply }]))
      .catch(e => setMsgs(prev => [...prev, { role: 'assistant', content: `❌ ${e instanceof Error ? e.message : '调用失败'}` }]))
      .finally(() => setSending(false))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: '1px solid #E5E6EB', background: 'rgba(255,255,255,0.9)' }}>
        <Button type="text" icon={<IconArrowLeft />} onClick={onBack} />
        <span className="resource-icon" style={{ background: `linear-gradient(135deg, ${agent.icon_color_from || '#7C4DFF'}, ${agent.icon_color_to || '#2962FF'})`, color: '#fff', width: 36, height: 36 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>{agent.icon_name || 'smart_toy'}</span>
        </span>
        <div><Title heading={6} style={{ margin: 0 }}>{agent.name}</Title>
          {agent.model_config && <Text style={{ fontSize: 11, color: '#86909C' }}>模型：{agent.model_config.display_name}</Text>}</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {msgs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <img src="/baidi.png" alt="CareerForge" style={{ width: 56, height: 56, borderRadius: 16, margin: "0 auto 16px", display: "block", objectFit: "contain" }} />
            <h3 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{agent.welcome_message || `你好！我是 ${agent.name}`}</h3>
            <p style={{ color: '#86909C', fontSize: 14, marginBottom: 20 }}>{agent.description}</p>
            {agent.suggested_questions && agent.suggested_questions.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 500, margin: '0 auto' }}>
                {agent.suggested_questions.map((q, i) => (
                  <div key={i} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #E5E6EB', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#1D2129' }}
                    onClick={() => quick(q)} onMouseEnter={e => (e.currentTarget.style.borderColor = '#165DFF')} onMouseLeave={e => (e.currentTarget.style.borderColor = '#E5E6EB')}>{q}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
            {m.role === 'assistant' && (
              <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginRight: 10, marginTop: 4, background: `linear-gradient(135deg, ${agent.icon_color_from || '#7C4DFF'}, ${agent.icon_color_to || '#2962FF'})`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{agent.icon_name || 'smart_toy'}</span>
              </div>
            )}
            <div style={{ maxWidth: '75%', padding: '10px 16px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#165DFF' : '#fff', color: m.role === 'user' ? '#fff' : '#1D2129', border: m.role === 'assistant' ? '1px solid #E5E6EB' : 'none', fontSize: 14, lineHeight: '22px', whiteSpace: 'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {sending && <Text style={{ color: '#86909C', fontSize: 12, display: 'block', textAlign: 'center' }}>AI 正在思考...</Text>}
        <div ref={endRef} />
      </div>
      {agent.prompt_variables && agent.prompt_variables.length > 0 && msgs.length === 0 && (
        <div style={{ padding: '8px 24px', background: '#f7f8fa', borderTop: '1px solid #E5E6EB' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agent.prompt_variables.map(v => (
              <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size="small" style={{ borderRadius: 2 }}>{v.label || v.name}{v.required ? ' *' : ''}</Tag>
                <Input size="mini" style={{ width: 140 }} placeholder={v.default || `输入${v.label || v.name}`} value={vVals[v.name] || ''} onChange={val => setVVals(prev => ({ ...prev, [v.name]: val }))} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E6EB', background: '#fff' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid #E5E6EB', borderRadius: 24, padding: '4px 4px 4px 16px', background: '#faf8ff' }}>
          <Input style={{ flex: 1, border: 'none', background: 'transparent', boxShadow: 'none' }} placeholder="输入消息..." value={inp} onChange={v => setInp(v)} onPressEnter={handleSend} />
          <Button type="primary" shape="circle" icon={<IconSend />} loading={sending} onClick={handleSend} style={{ width: 36, height: 36, minWidth: 36 }} />
        </div>
      </div>
    </div>
  )
}
