import { apiRequest } from '../shared/api'
import { readStoredSession } from '../shared/auth'

export type ModelRecord = {
  id: number; display_name: string; provider: string; model_identifier: string
  base_url: string | null; api_key_cipher: string | null
  capability: string; protocols: string; status: string; open_to_student: boolean
  name: string; model_id: string; is_enabled: boolean; is_student_visible: boolean
}

export type AgentRecord = {
  id: number; name: string; description: string | null; category: string
  icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null
  model_config_id: number | null; model_config: ModelRecord | null
  welcome_message: string | null; suggested_questions: string[] | null
  prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null
  system_prompt: string | null; temperature: number; max_tokens: number
  top_p: number; frequency_penalty: number; presence_penalty: number
  memory_window: number; is_enabled: boolean; is_published: boolean
  created_at: string; updated_at: string
}

export type AgentPayload = {
  name: string; description?: string; category?: string
  icon_name?: string; icon_color_from?: string; icon_color_to?: string
  model_config_id?: number | null; welcome_message?: string
  suggested_questions?: string[]; prompt_variables?: { name: string; label: string; required: boolean; default: string }[]
  system_prompt?: string; temperature?: number; max_tokens?: number
  top_p?: number; frequency_penalty?: number; presence_penalty?: number
  memory_window?: number; is_enabled?: boolean; is_published?: boolean
}

export type AgentChatResult = { reply: string; model_name: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null }

// api.ts auto-injects Authorization header from localStorage, no need for authInit
export function listModels(): Promise<ModelRecord[]> {
  return apiRequest<{ list: ModelRecord[] }>('/api/v1/admin/models?size=100').then(r => r.list)
}

export function listAgents(params?: { category?: string; search?: string }): Promise<AgentRecord[]> {
  const sp = new URLSearchParams()
  if (params?.category && params.category !== 'all') sp.set('category', params.category)
  if (params?.search) sp.set('search', params.search)
  return apiRequest<AgentRecord[]>(`/api/v1/admin/agents${sp.toString() ? `?${sp}` : ''}`)
}

export function createAgent(p: AgentPayload): Promise<AgentRecord> {
  return apiRequest<AgentRecord>('/api/v1/admin/agents', { method: 'POST', body: JSON.stringify(p) })
}
export function updateAgent(id: number, p: Partial<AgentPayload>): Promise<AgentRecord> {
  return apiRequest<AgentRecord>(`/api/v1/admin/agents/${id}`, { method: 'PUT', body: JSON.stringify(p) })
}
export function deleteAgent(id: number): Promise<void> {
  return apiRequest<void>(`/api/v1/admin/agents/${id}`, { method: 'DELETE' })
}
export function toggleAgent(id: number, e: boolean): Promise<AgentRecord> {
  return apiRequest<AgentRecord>(`/api/v1/admin/agents/${id}/toggle`, { method: 'PATCH', body: JSON.stringify({ is_enabled: e }) })
}
export function agentChat(id: number, msg: string, vars?: Record<string, string>): Promise<AgentChatResult> {
  return apiRequest<AgentChatResult>(`/api/v1/admin/agents/${id}/chat`, { method: 'POST', body: JSON.stringify({ message: msg, variables: vars || {} }) })
}

export function listPublicAgents(params?: { category?: string; search?: string }): Promise<AgentRecord[]> {
  const sp = new URLSearchParams()
  if (params?.category && params.category !== 'all') sp.set('category', params.category)
  if (params?.search) sp.set('search', params.search)
  return apiRequest<AgentRecord[]>(`/api/v1/agents${sp.toString() ? `?${sp}` : ''}`)
}

export function studentAgentChat(id: number, msg: string, vars?: Record<string, string>): Promise<AgentChatResult> {
  const s = readStoredSession()
  return apiRequest<AgentChatResult>(`/api/v1/agents/${id}/chat`, {
    method: 'POST', body: JSON.stringify({ message: msg, variables: vars || {} }),
    headers: s?.access ? { Authorization: `Bearer ${s.access}` } : {},
  })
}
