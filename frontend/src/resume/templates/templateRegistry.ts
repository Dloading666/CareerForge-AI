import type { ResumeData, TemplateId, ResumeTemplateConfig, TemplateViewModel, ViewListItem } from '../types'
import { richTextToLines } from '../utils/content'

export function getTemplateConfig(id: TemplateId | null | undefined): ResumeTemplateConfig {
  return {
    id: (id || 'classic') as TemplateId,
    name: 'Classic',
    description: 'Classic',
    accentColor: '#0f172a',
    secondaryColor: '#475569',
    background: '#ffffff',
    textColor: '#0e172b',
    thumbnailSrc: '',
    layout: 'single',
  } as ResumeTemplateConfig
}

export function getContacts(resume: ResumeData): { key: string; value: string; custom: boolean; label: string }[] {
  const basic = resume.basic || ({ } as any)
  const parts: { key: string; value: string; custom: boolean; label: string }[] = []
  if (basic.email) parts.push({ key: 'email', value: basic.email, custom: false, label: '邮箱' })
  if (basic.phone) parts.push({ key: 'phone', value: basic.phone, custom: false, label: '电话' })
  if (basic.location) parts.push({ key: 'location', value: basic.location, custom: false, label: '地址' })
  if (basic.githubKey) parts.push({ key: 'github', value: basic.githubKey, custom: false, label: 'GitHub' })
  return parts
}

export function buildTemplateViewModel(resume: ResumeData): TemplateViewModel {
  const basic = resume.basic || ({ } as any)
  const mapToList = (items: any[]): ViewListItem[] =>
    items.map((it: any) => {
      const date = it.date || [(it.date ?? ''), (it.endDate ?? '')].filter(Boolean).join(' - ')
      return {
        itemId: it.id,
        title: it.school || it.company || it.name || '',
        subtitle: it.major || it.position || it.role || '',
        meta: date,
        lines: richTextToLines(it.description || it.details || ''),
      }
    })
 return {
    header: {
      name: basic.name || '',
      title: basic.title || '',
      contacts: getContacts(resume).map(c => c.value),
    },
    skills: richTextToLines(resume.skillContent || ''),
    education: mapToList(resume.education || []),
    experience: mapToList(resume.experience || []),
    projects: mapToList(resume.projects || []),
    selfEvaluation: richTextToLines(resume.selfEvaluationContent || ''),
  }
}

export const TEMPLATE_REGISTRY: ResumeTemplateConfig[] = [
  { id: 'classic', name: 'Classic', description: 'Classic', accentColor: '#0f172a', secondaryColor: '#475569', background: '#ffffff', textColor: '#0e172b', thumbnailSrc: '', layout: 'single' },
  { id: 'modern', name: 'Modern', description: 'Modern', accentColor: '#165dff', secondaryColor: '#64748b', background: '#ffffff', textColor: '#0e172b', thumbnailSrc: '', layout: 'single' },
  { id: 'elegant', name: 'Elegant', description: 'Elegant', accentColor: '#7c3aed', secondaryColor: '#475569', background: '#ffffff', textColor: '#0e172b', thumbnailSrc: '', layout: 'single' },
]

