import { apiRequest } from '../shared/api'
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

export async function downloadResumePdf(resumeId: number, filename: string) {
  const stored = localStorage.getItem('zhipei-auth-session')
  const access = stored ? JSON.parse(stored)?.access : null
  const response = await fetch(`/api/v1/student/resumes/${resumeId}/export-pdf`, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  })
  if (!response.ok) {
    throw new Error('导出失败')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename || '简历'}.pdf`
  link.click()
  URL.revokeObjectURL(url)
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
