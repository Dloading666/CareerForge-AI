import { useEffect, useRef, useState } from 'react'
import { Button, Input, Tag, Typography } from '@arco-design/web-react'
import { IconArrowLeft, IconRefresh, IconSend, IconPause } from '@arco-design/web-react/icon'

import { MarkdownMessage } from '../shared/MarkdownMessage'
import { useAuth } from '../shared/auth'

const { Text, Title } = Typography
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

interface ChatMsg { role: 'user' | 'assistant'; content: string }

export interface AgentItem {
  id: number
  name: string
  description: string | null
  icon_name: string | null
  icon_color_from: string | null
  icon_color_to: string | null
  model_config: { display_name: string } | null
  welcome_message: string | null
  suggested_questions: string[] | null
  prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null
}

function parseSseBlock(block: string): { event: string; data: Record<string, unknown> } | null {
  let event = 'message'
  const dataLines: string[] = []
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (dataLines.length === 0) return null
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) as Record<string, unknown> }
  } catch {
    return null
  }
}

export function StudentAgentChat({ agent, onBack }: { agent: AgentItem; onBack: () => void }) {
  const { session } = useAuth()
  const [msgs, setMsgs] = useState<ChatMsg[]>([])
  const [inp, setInp] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [vVals, setVVals] = useState<Record<string, string>>({})
  const endRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const v: Record<string, string> = {}
    if (agent.prompt_variables) for (const pv of agent.prompt_variables) v[pv.name] = pv.default || ''
    setVVals(v)
  }, [agent])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, streaming])

  const streamSend = async (text: string) => {
    const message = text.trim()
    if (!message || streaming) return
    setInp('')
    setMsgs((prev) => [...prev, { role: 'user', content: message }, { role: 'assistant', content: '' }])
    setStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller

    const apply = (block: string) => {
      const parsed = parseSseBlock(block)
      if (!parsed) return
      const { event, data } = parsed
      if (event === 'delta' && data.text) {
        setMsgs((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + String(data.text) }
          return next
        })
      } else if (event === 'error') {
        setMsgs((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          next[next.length - 1] = { ...last, content: last.content + `\n\n❌ ${String(data.message ?? '调用失败')}` }
          return next
        })
      }
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/agents/${agent.id}/chat/stream`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access ?? ''}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, variables: Object.keys(vVals).length > 0 ? vVals : {} }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) throw new Error(`请求失败（${response.status}）`)
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const b of blocks) apply(b)
      }
      if (buffer.trim()) apply(buffer)
    } catch (err: unknown) {
      if (!controller.signal.aborted) {
        setMsgs((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last && last.role === 'assistant' && !last.content) {
            next[next.length - 1] = { ...last, content: `❌ ${err instanceof Error ? err.message : '调用失败'}` }
          }
          return next
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }

  const handleRegenerate = () => {
    if (streaming) return
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { lastUserIdx = i; break }
    }
    if (lastUserIdx < 0) return
    const text = msgs[lastUserIdx].content
    setMsgs((prev) => prev.slice(0, lastUserIdx))
    void streamSend(text)
  }

  const stop = () => {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组词中（如中文输入法打拼音）按 Enter 是「确认候选」，不能当作发送
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void streamSend(inp)
    }
  }

  const gradient = `linear-gradient(135deg, ${agent.icon_color_from || '#7C4DFF'}, ${agent.icon_color_to || '#2962FF'})`
  const lastIsAssistant = msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '16px 24px', borderBottom: '1px solid #E5E6EB', background: 'rgba(255,255,255,0.9)' }}>
        <Button type="text" icon={<IconArrowLeft />} onClick={onBack} />
        <span className="resource-icon" style={{ background: gradient, color: '#fff', width: 36, height: 36 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18, fontVariationSettings: "'FILL' 1" }}>{agent.icon_name || 'smart_toy'}</span>
        </span>
        <div>
          <Title heading={6} style={{ margin: 0 }}>{agent.name}</Title>
          {agent.model_config && <Text style={{ fontSize: 11, color: '#86909C' }}>模型：{agent.model_config.display_name}</Text>}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
        {msgs.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 40 }}>
            <img src="/baidi.png" alt="CareerForge" style={{ width: 56, height: 56, borderRadius: 16, margin: '0 auto 16px', display: 'block', objectFit: 'contain' }} />
            <h3 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 6px' }}>{agent.welcome_message || `你好！我是 ${agent.name}`}</h3>
            <p style={{ color: '#86909C', fontSize: 14, marginBottom: 20 }}>{agent.description}</p>
            {agent.suggested_questions && agent.suggested_questions.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, maxWidth: 500, margin: '0 auto' }}>
                {agent.suggested_questions.map((q, i) => (
                  <div key={i} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #E5E6EB', background: '#fff', cursor: 'pointer', fontSize: 13, color: '#1D2129' }}
                    onClick={() => void streamSend(q)} onMouseEnter={(e) => (e.currentTarget.style.borderColor = '#165DFF')} onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#E5E6EB')}>{q}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
            {m.role === 'assistant' && (
              <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, marginRight: 10, marginTop: 4, background: gradient, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="material-symbols-outlined" style={{ color: '#fff', fontSize: 16, fontVariationSettings: "'FILL' 1" }}>{agent.icon_name || 'smart_toy'}</span>
              </div>
            )}
            <div style={{ maxWidth: '78%', padding: '10px 16px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.role === 'user' ? '#165DFF' : '#fff', color: m.role === 'user' ? '#fff' : '#1D2129', border: m.role === 'assistant' ? '1px solid #E5E6EB' : 'none', fontSize: 14, lineHeight: '1.7' }}>
              {m.role === 'assistant'
                ? (m.content
                    ? <MarkdownMessage content={m.content} />
                    : <span style={{ color: '#86909C' }}>正在思考…</span>)
                : <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>}
            </div>
          </div>
        ))}
        {!streaming && lastIsAssistant && msgs[msgs.length - 1].content && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginLeft: 42, marginTop: -6, marginBottom: 14 }}>
            <Button size="mini" type="text" icon={<IconRefresh />} onClick={handleRegenerate} style={{ color: '#86909C' }}>
              重新生成
            </Button>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {agent.prompt_variables && agent.prompt_variables.length > 0 && msgs.length === 0 && (
        <div style={{ padding: '8px 24px', background: '#f7f8fa', borderTop: '1px solid #E5E6EB' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agent.prompt_variables.map((v) => (
              <div key={v.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size="small" style={{ borderRadius: 2 }}>{v.label || v.name}{v.required ? ' *' : ''}</Tag>
                <Input size="mini" style={{ width: 140 }} placeholder={v.default || `输入${v.label || v.name}`} value={vVals[v.name] || ''} onChange={(val) => setVVals((prev) => ({ ...prev, [v.name]: val }))} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ padding: '16px 24px', borderTop: '1px solid #E5E6EB', background: '#fff' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', border: '1px solid #E5E6EB', borderRadius: 18, padding: '6px 6px 6px 16px', background: '#faf8ff' }}>
          <Input.TextArea
            style={{ flex: 1, border: 'none', background: 'transparent', boxShadow: 'none', resize: 'none' }}
            autoSize={{ minRows: 1, maxRows: 6 }}
            placeholder="输入消息，Enter 发送 / Shift+Enter 换行…"
            value={inp}
            onChange={setInp}
            onKeyDown={handleKeyDown}
          />
          {streaming ? (
            <Button type="primary" status="danger" shape="circle" icon={<IconPause />} onClick={stop} style={{ width: 36, height: 36, minWidth: 36, flexShrink: 0 }} />
          ) : (
            <Button type="primary" shape="circle" icon={<IconSend />} disabled={!inp.trim()} onClick={() => void streamSend(inp)} style={{ width: 36, height: 36, minWidth: 36, flexShrink: 0 }} />
          )}
        </div>
      </div>
    </div>
  )
}
