export type ApiEnvelope<T> = {
  code: number
  msg: string
  data: T
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  })

  let payload: (ApiEnvelope<T> & { detail?: unknown }) | undefined
  try {
    payload = (await response.json()) as ApiEnvelope<T> & { detail?: unknown }
  } catch {
    throw new ApiError('服务返回了不可识别的内容', response.status)
  }

  if (!response.ok || payload.code !== 0) {
    throw new ApiError(extractErrorMessage(payload), response.status)
  }

  return payload.data
}

// 后端正常返回 { code, msg, data }，但 FastAPI 抛 HTTPException 时返回 { detail }，
// 校验错误（422）时 detail 是数组。这里统一提取出可读的错误文案。
function extractErrorMessage(payload: { msg?: string; detail?: unknown }): string {
  if (payload.msg) {
    return payload.msg
  }
  const detail = payload.detail
  if (typeof detail === 'string') {
    return detail
  }
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0] as { msg?: string }
    if (first?.msg) {
      return first.msg
    }
  }
  return '请求失败'
}

