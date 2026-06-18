import { ApiError, apiRequest, authenticatedFetch, getAccessToken } from '../shared/api'

const API_BASE_URL_FOR_XHR = (import.meta as any).env?.VITE_API_BASE_URL ?? ''
import { ensureResumeDefaults } from './constants'
import type { ResumeData, ResumeSummary } from './types'

type ResumeDetailEnvelope = {
  id: number
  title: string
  templateId: ResumeData['templateId']
  visibility: boolean
  data: ResumeData
  createdAt: string
  updatedAt: string
}

function normalizeResume(payload: ResumeDetailEnvelope): ResumeData {
  return ensureResumeDefaults({
    ...payload.data,
    id: payload.id,
    title: payload.title,
    templateId: payload.templateId,
    visibility: payload.visibility,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  })
}

export async function listResumes() {
  return apiRequest<ResumeSummary[]>('/api/v1/student/resumes')
}

export async function createResume(payload?: Pick<ResumeData, 'templateId'>) {
  const detail = await apiRequest<ResumeDetailEnvelope>('/api/v1/student/resumes', {
    method: 'POST',
    body: JSON.stringify({
      templateId: payload?.templateId,
      visibility: false,
    }),
  })
  return normalizeResume(detail)
}

export async function importResume(data: ResumeData) {
  const detail = await apiRequest<ResumeDetailEnvelope>('/api/v1/student/resumes/import', {
    method: 'POST',
    body: JSON.stringify({
      title: data.title,
      templateId: data.templateId,
      visibility: data.visibility,
      data,
    }),
  })
  return normalizeResume(detail)
}

export async function uploadResume(file: File) {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<{ id: number; title: string; chars: number }>('/api/v1/student/resumes/upload', {
    method: 'POST',
    body: form,
  })
}

export type ImportResumeFileResult = {
  resume_id: number
  title: string
  sections_summary: Record<string, number | boolean>
  /** 导入时从原简历识别出的头像 URL；未识别到则为 undefined。 */
  photo_url?: string
}

export type ImportProgressEvent = {
  loaded: number
  total: number
  percent: number  // 0-100, only valid when total > 0
}

export function importResumeFile(
  file: File,
  title?: string,
  onProgress?: (event: ImportProgressEvent) => void,
): Promise<ImportResumeFileResult> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    form.append('file', file)
    if (title) form.append('title', title)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE_URL_FOR_XHR}/api/v1/student/resumes/import/file`, true)
    const token = getAccessToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)

    xhr.upload.onprogress = (evt) => {
      if (!onProgress) return
      if (evt.lengthComputable && evt.total > 0) {
        onProgress({ loaded: evt.loaded, total: evt.total, percent: Math.round((evt.loaded / evt.total) * 100) })
      } else {
        onProgress({ loaded: evt.loaded, total: 0, percent: 0 })
      }
    }

    xhr.onerror = () => reject(new ApiError('网络异常，导入失败', 0))
    xhr.onabort = () => reject(new ApiError('已取消导入', 0))

    xhr.onload = () => {
      const status = xhr.status
      let body: any = null
      try { body = xhr.responseText ? JSON.parse(xhr.responseText) : null } catch { body = null }

      if (status >= 200 && status < 300) {
        // 后端 ApiEnvelope: { code, msg, data: {...} }
        const data = body?.data ?? body
        if (data && typeof data === 'object' && 'resume_id' in data) {
          resolve(data as ImportResumeFileResult)
        } else {
          reject(new ApiError('后端返回数据格式异常', status))
        }
        return
      }

      // 401: try refresh once and retry
      if (status === 401) {
        import('../shared/api').then(async ({ tryRefreshAccessToken }) => {
          const newAccess = await tryRefreshAccessToken()
          if (!newAccess) {
            reject(new ApiError('登录已过期，请重新登录', 401))
            return
          }
          const retry = new XMLHttpRequest()
          retry.open('POST', `${API_BASE_URL_FOR_XHR}/api/v1/student/resumes/import/file`, true)
          retry.setRequestHeader('Authorization', `Bearer ${newAccess}`)
          retry.upload.onprogress = xhr.upload.onprogress
          retry.onerror = () => reject(new ApiError('网络异常，导入失败', 0))
          retry.onload = () => {
            if (retry.status >= 200 && retry.status < 300) {
              try {
                const rbody = JSON.parse(retry.responseText)
                const rdata = rbody?.data ?? rbody
                resolve(rdata as ImportResumeFileResult)
              } catch {
                reject(new ApiError('后端返回数据格式异常', retry.status))
              }
            } else {
              const msg = (() => { try { return JSON.parse(retry.responseText)?.msg } catch { return null } })()
              reject(new ApiError(msg || `导入失败 (HTTP ${retry.status})`, retry.status))
            }
          }
          retry.send(form)
        })
        return
      }

      const msg = (() => { try { return body?.msg } catch { return null } })()
      reject(new ApiError(msg || `导入失败 (HTTP ${status})`, status))
    }

    xhr.send(form)
  })
}

export async function getResume(resumeId: number) {
  const detail = await apiRequest<ResumeDetailEnvelope>(`/api/v1/student/resumes/${resumeId}`)
  return normalizeResume(detail)
}

export async function updateResume(resume: ResumeData) {
  const detail = await apiRequest<ResumeDetailEnvelope>(`/api/v1/student/resumes/${resume.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      title: resume.title,
      templateId: resume.templateId,
      visibility: resume.visibility,
      data: resume,
    }),
  })
  return normalizeResume(detail)
}

export async function deleteResume(resumeId: number) {
  return apiRequest<{ id: number }>(`/api/v1/student/resumes/${resumeId}`, { method: 'DELETE' })
}

﻿export type ExportJobStatus = {
  job_id: string
  status: 'queued' | 'started' | 'finished' | 'failed' | 'deferred'
  phase?: string
  progress?: number
  result_path?: string
  download_url?: string
  error?: string
}

export type ExportProgress = {
  phase: 'queued' | 'rendering' | 'writing' | 'done' | 'failed'
  message: string
  percent: number
}

/**
 * Enqueue a server-side PDF render. The backend enqueues an RQ job and
 * returns its id; the actual rendering happens in a background worker
 * so the API request thread is never blocked by ReportLab.
 */
export async function enqueueResumePdf(resumeId: number): Promise<{ job_id: string }> {
  let response: Response
  try {
    response = await authenticatedFetch(
      `/api/v1/student/resumes/${resumeId}/export-pdf`,
      { method: 'POST' },
    )
  } catch (err) {
    throw new ApiError(`网络错误: ${String((err as Error)?.message ?? err)}`, 0)
  }
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.text()).slice(0, 200) } catch { /* ignore */ }
    throw new ApiError(`提交导出任务失败 (HTTP ${response.status}): ${detail}`, response.status)
  }
  const body = await response.json()
  return (body?.data ?? body) as { job_id: string }
}

export async function getResumeExportJob(jobId: string): Promise<ExportJobStatus> {
  return apiRequest<ExportJobStatus>(`/api/v1/jobs/${jobId}`)
}

function phaseMessage(status: ExportJobStatus, fallback: string): string {
  if (status.phase === 'loading') return '正在加载简历数据...'
  if (status.phase === 'rendering') return '正在生成 PDF...'
  if (status.phase === 'writing') return '正在写入文件...'
  if (status.phase === 'done') return '已完成'
  if (status.status === 'queued') return '等待 worker 处理...'
  return fallback
}

/**
 * Full export flow with progress callback. Polls every 1.5s up to 5 minutes.
 * On success, triggers a browser download of the produced PDF.
 */
export async function downloadResumePdf(
  resumeId: number,
  filename: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const safeName = (filename || '简历').replace(/[\\/:*?"<>|]/g, '_')

  onProgress?.({ phase: 'queued', message: '提交任务...', percent: 5 })

  const { job_id } = await enqueueResumePdf(resumeId)
  const deadline = Date.now() + 5 * 60_000
  let status: ExportJobStatus

  while (true) {
    status = await getResumeExportJob(job_id)
    const percent = Math.min(95, Math.max(10, Math.round((status.progress ?? 0.1) * 100)))
    onProgress?.({
      phase: status.status === 'finished' ? 'done' : ((status.phase as ExportProgress['phase']) ?? 'queued'),
      message: phaseMessage(status, '处理中...'),
      percent,
    })
    if (status.status === 'finished') break
    if (status.status === 'failed') {
      throw new ApiError(status.error || '导出失败', 500)
    }
    if (Date.now() > deadline) {
      throw new ApiError('导出超时，请稍后重试', 504)
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  onProgress?.({ phase: 'done', message: '下载中...', percent: 98 })

  const downloadUrl = status.download_url ?? `/api/v1/jobs/${job_id}/download`
  const resp = await authenticatedFetch(downloadUrl)
  if (!resp.ok) {
    let detail = ''
    try { detail = (await resp.text()).slice(0, 200) } catch { /* ignore */ }
    throw new ApiError(`下载失败 (HTTP ${resp.status}): ${detail}`, resp.status)
  }
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeName}.pdf`
  link.click()
  URL.revokeObjectURL(url)

  onProgress?.({ phase: 'done', message: '已下载', percent: 100 })
}

export async function duplicateResume(resumeId: number) {
  return apiRequest<ResumeData>(`/api/v1/student/resumes/${resumeId}/duplicate`, { method: 'POST' })
}

export type UploadAvatarResult = { avatar_url: string }

/**
 * 上传 / 替换某个简历的头像。返回的 URL 需要前端再调用 updateResume
 * 写入 resume.basic.photo 才会持久化。
 */
export async function uploadResumeAvatar(
  resumeId: number,
  file: File,
): Promise<UploadAvatarResult> {
  const form = new FormData()
  form.append('file', file)
  return apiRequest<UploadAvatarResult>(
    `/api/v1/student/resumes/${resumeId}/avatar`,
    { method: 'POST', body: form },
  )
}

export type AiAssistSection = 'experience' | 'project' | 'education' | 'skill' | 'selfEvaluation' | 'summary'

export type AiAssistResult = { suggested: string; model: string; instruction: string }

export async function aiAssistResumeField(
  resumeId: number,
  payload: { section: AiAssistSection; instruction: string; currentText: string; jdText?: string },
) {
  return apiRequest<AiAssistResult>(`/api/v1/student/resumes/${resumeId}/ai-assist`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function getResumeThumbnailUrl(resumeId: number): string {
  const base = '/api/v1/student/resumes/' + resumeId + '/thumbnail'
  if (typeof window === "undefined") return base
  try {
    const raw = window.localStorage.getItem("zhipei-auth-session")
    if (!raw) return base
    const session = JSON.parse(raw) as { access?: string }
    if (!session.access) return base
    return base + '?access=' + encodeURIComponent(session.access)
  } catch {
    return base
  }
}
