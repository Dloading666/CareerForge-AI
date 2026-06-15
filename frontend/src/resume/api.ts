import { ApiError, apiRequest, authenticatedFetch } from '../shared/api'
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

export async function importResumeFile(file: File, title?: string) {
  const form = new FormData()
  form.append('file', file)
  if (title) form.append('title', title)
  return apiRequest<{ resume_id: number; title: string; sections_summary: Record<string, number | boolean> }>('/api/v1/student/resumes/import/file', {
    method: 'POST',
    body: form,
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
