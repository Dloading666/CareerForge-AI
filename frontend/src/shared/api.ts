export type ApiEnvelope<T> = { code: number; msg: string; data: T }

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.name = "ApiError"; this.status = status }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ""
const STORAGE_KEY = "zhipei-auth-session"

type StoredSession = {
  access?: string
  refresh?: string
}

function getStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredSession
  } catch {
    return null
  }
}

export function getAccessToken(): string | null {
  return getStoredSession()?.access ?? null
}

function updateStoredAccessToken(access: string) {
  const session = getStoredSession()
  if (!session) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...session, access }))
}

let refreshPromise: Promise<string | null> | null = null

async function performRefreshAccessToken(): Promise<string | null> {
  const refresh = getStoredSession()?.refresh
  if (!refresh) return null

  const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  })

  let payload: { code?: number; data?: { access?: string } }
  try {
    payload = (await response.json()) as { code?: number; data?: { access?: string } }
  } catch {
    return null
  }

  const access = response.ok && payload?.code === 0 ? payload.data?.access ?? null : null
  if (access) updateStoredAccessToken(access)
  return access
}

export async function tryRefreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = performRefreshAccessToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function authenticatedFetch(path: string, init?: RequestInit): Promise<Response> {
  const send = async (access: string | null) => {
    const headers = new Headers(init?.headers)
    if (access) headers.set("Authorization", `Bearer ${access}`)
    return fetch(`${API_BASE_URL}${path}`, { ...init, headers })
  }

  let response = await send(getAccessToken())
  if (response.status === 401) {
    const access = await tryRefreshAccessToken()
    if (access) response = await send(access)
  }
  return response
}

const FIELD_LABELS: Record<string, string> = {
  display_name: "展示名称", provider: "供应商", deploy_type: "部署位置", capability: "能力类型",
  protocols: "协议", base_url: "Base URL", api_key: "API Key", model_identifier: "模型标识",
  context_length: "上下文长度", default_temp: "默认温度", max_output: "最大输出", timeout_sec: "超时时间",
  open_to_student: "对学生开放", config_key: "配置键", config_value: "配置值", items: "配置项",
}

const ERROR_TYPES: Record<string, string> = {
  "value_error.missing": "必填字段", "string_too_short": "内容过短", "string_too_long": "内容过长",
  "value_error.any_str.min_length": "不能为空", "type_error.integer": "必须为整数",
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  return requestWithRetry<T>(path, init, false)
}

export type SSOLoginResponse = {
  access: string
  refresh: string
  role: 'student'
  profile: Record<string, string | null | undefined>
}

export async function ssoLogin(token: string): Promise<SSOLoginResponse> {
  return apiRequest<SSOLoginResponse>('/api/v1/auth/sso/login', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

async function requestWithRetry<T>(path: string, init: RequestInit | undefined, retried: boolean): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has("Content-Type") && init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json")
  if (!headers.has("Authorization")) { const token = getAccessToken(); if (token) headers.set("Authorization", `Bearer ${token}`) }

  let response: Response
  try { response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers }) }
  catch { throw new ApiError("无法连接后端服务", 0) }

  if (
    response.status === 401 &&
    !retried &&
    path !== "/api/v1/auth/refresh" &&
    path !== "/api/v1/auth/login" &&
    path !== "/api/v1/auth/logout" &&
    path !== "/api/v1/auth/sso/login"
  ) {
    const access = await tryRefreshAccessToken()
    if (access) {
      const retryHeaders = new Headers(init?.headers)
      if (!retryHeaders.has("Content-Type") && init?.body && !(init.body instanceof FormData)) retryHeaders.set("Content-Type", "application/json")
      retryHeaders.set("Authorization", `Bearer ${access}`)
      return requestWithRetry<T>(path, { ...init, headers: retryHeaders }, true)
    }
  }

  let payload: (ApiEnvelope<T> & { detail?: unknown }) | undefined
  const responseForPreview = response.clone()
  try { payload = (await response.json()) as ApiEnvelope<T> & { detail?: unknown } }
  catch {
    // Non-JSON response — try to read text for debugging
    let preview = ''
    try {
      preview = (await responseForPreview.text()).slice(0, 300)
    } catch { /* ignore */ }
    console.error('Non-JSON API response', { path, status: response.status, preview })
    throw new ApiError('服务接口异常，请稍后重试或联系管理员', response.status)
  }

  if (!response.ok || payload.code !== 0) throw new ApiError(extractErrorMessage(payload, response.status), response.status)
  return payload.data
}

function extractErrorMessage(payload: { msg?: string; detail?: unknown }, status: number): string {
  if (payload.msg && payload.msg !== "ok") return payload.msg
  const detail = payload.detail
  if (typeof detail === "string") return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const msgs: string[] = []
    for (const err of detail as Array<{ loc: string[]; msg: string; type: string }>) {
      const field = err.loc[err.loc.length - 1] ?? ""
      const label = FIELD_LABELS[field] || field
      const td = ERROR_TYPES[err.type]
      msgs.push(td ? `${label}：${td}` : `${label}：${err.msg}`)
    }
    if (msgs.length > 0) return msgs.join("；")
  }
  const m: Record<number, string> = { 400: "请求参数有误", 401: "登录已过期", 403: "无权操作", 404: "资源不存在", 422: "表单填写有误", 500: "服务器错误" }
  return m[status] || `请求失败（${status}）`
}
