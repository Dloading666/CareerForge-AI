import type {
  ResumeData,
  ResumeTemplateConfig,
  TemplateId,
  TemplateViewModel,
  ViewListItem,
} from '../types'
import { richTextToInlineBlocks } from '../utils/content'
import { formatResumeDateRange, formatResumeDateText } from '../utils/dateFormat'

export const TEMPLATE_REGISTRY: ResumeTemplateConfig[] = [
  {
    id: 'blank',
    name: '空白模板',
    description: '不使用任何样式，从零开始编辑。',
    accentColor: '#000000',
    secondaryColor: '#6b7280',
    background: '#ffffff',
    textColor: '#000000',
    thumbnailSrc: '/resume-template-thumbs/blank.png',
    layout: 'single',
  },
  {
    id: 'classic',
    name: '经典模板',
    description: '传统简约的简历布局，适合大多数求职场景。',
    accentColor: '#000000',
    secondaryColor: '#4b5563',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/classic.png',
    layout: 'single',
  },
  {
    id: 'modern',
    name: '两栏布局',
    description: '经典两栏，突出个人特色。',
    accentColor: '#000000',
    secondaryColor: '#6b7280',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/modern.png',
    layout: 'split',
  },
  {
    id: 'left-right',
    name: '模块标题背景色',
    description: '模块标题背景鲜明，突出美观特色。',
    accentColor: '#2563eb',
    secondaryColor: '#9ca3af',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/left-right.png',
    layout: 'single',
  },
  {
    id: 'timeline',
    name: '时间轴布局',
    description: '时间线布局，突出经历的时间顺序。',
    accentColor: '#18181b',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/timeline.png',
    layout: 'single',
  },
  {
    id: 'minimalist',
    name: '极简模板',
    description: '大面积留白，干净纯粹的排版风格。',
    accentColor: '#171717',
    secondaryColor: '#737373',
    background: '#ffffff',
    textColor: '#171717',
    thumbnailSrc: '/resume-template-thumbs/minimalist.png',
    layout: 'center',
  },
  {
    id: 'elegant',
    name: '优雅模板',
    description: '居中标题单列设计，具有高级感的分隔线。',
    accentColor: '#18181b',
    secondaryColor: '#71717a',
    background: '#ffffff',
    textColor: '#27272a',
    thumbnailSrc: '/resume-template-thumbs/elegant.png',
    layout: 'center',
  },
  {
    id: 'creative',
    name: '创意模板',
    description: '视觉错落设计，灵动活泼展现个性。',
    accentColor: '#7c3aed',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#1e293b',
    thumbnailSrc: '/resume-template-thumbs/creative.png',
    layout: 'single',
  },
  {
    id: 'editorial',
    name: '画报风',
    description: '高端画报风，精美衬线体与专属侧边时光轴设计。',
    accentColor: '#000000',
    secondaryColor: '#666666',
    background: '#ffffff',
    textColor: '#1a1a1a',
    thumbnailSrc: '/resume-template-thumbs/editorial.png',
    layout: 'single',
  },
  {
    id: 'swiss',
    name: '瑞士美学',
    description: '包豪斯国际排版，超粗字重对比与几何色块点缀。',
    accentColor: '#E31C24',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#0f172a',
    thumbnailSrc: '/resume-template-thumbs/swiss.png',
    layout: 'single',
  },
]

export function getTemplateConfig(templateId: TemplateId) {
  return TEMPLATE_REGISTRY.find((item) => item.id === templateId) ?? TEMPLATE_REGISTRY[0]
}

function mapItems<T extends { visible?: boolean }>(items: T[], mapItem: (item: T) => ViewListItem) {
  return items.filter((item) => item.visible !== false).map(mapItem)
}

function getBasicFieldValue(resume: ResumeData, key: string) {
  const value = resume.basic[key as keyof ResumeData['basic']]
  return typeof value === 'string' ? value.trim() : ''
}

export function getContacts(resume: ResumeData) {
  const ordered = (resume.basic.fieldOrder ?? [])
    .filter((field) => field.visible !== false && field.key !== 'name' && field.key !== 'title')
    .map((field) => ({
      key: String(field.key),
      label: field.label,
      value: getBasicFieldValue(resume, String(field.key)),
      custom: false,
    }))
    .filter((field) => field.value)

  const custom = (resume.basic.customFields ?? [])
    .filter((field) => field.visible !== false && field.value.trim())
    .map((field) => ({
      key: field.id,
      label: field.label,
      value: field.displayLabel && field.label ? `${field.label}: ${field.value}` : field.value,
      custom: true,
    }))

  return [...ordered, ...custom]
}

export function buildTemplateViewModel(resume: ResumeData): TemplateViewModel {
  return {
    header: {
      name: resume.basic.name || '未命名简历',
      title: resume.basic.title,
      contacts: getContacts(resume).map((item) => item.value),
    },
    skills: richTextToInlineBlocks(resume.skillContent),
    education: mapItems(resume.education, (item) => ({
      itemId: item.id,
      title: item.school || '学校',
      subtitle: [item.major, item.degree, item.gpa ? `GPA ${item.gpa}` : ''].filter(Boolean).join(' · '),
      meta: formatResumeDateRange(item.startDate, item.endDate),
      blocks: richTextToInlineBlocks(item.description ?? ''),
    })),
    experience: mapItems(resume.experience, (item) => ({
      itemId: item.id,
      title: item.company || '公司',
      subtitle: item.position,
      meta: formatResumeDateText(item.date),
      blocks: richTextToInlineBlocks(item.details),
    })),
    projects: mapItems(resume.projects, (item) => ({
      itemId: item.id,
      title: item.name || '项目',
      subtitle: item.role,
      meta: formatResumeDateText(item.date),
      blocks: richTextToInlineBlocks(item.description),
    })),
    selfEvaluation: richTextToInlineBlocks(resume.selfEvaluationContent),
  }
}
