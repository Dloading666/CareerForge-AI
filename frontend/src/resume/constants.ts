import type {
  BasicFieldType,
  BasicFieldKey,
  Certificate,
  CustomFieldType,
  CustomItem,
  Education,
  Experience,
  GlobalSettings,
  MenuSection,
  PhotoConfig,
  Project,
  ResumeData,
  ResumeSectionId,
} from './types'
import { textareaToListHtml, textareaToParagraphHtml } from './utils/content'

const DEFAULT_SECTIONS: MenuSection[] = [
  { id: 'basic', title: '基本信息', icon: '👤', enabled: true, order: 0 },
  { id: 'skills', title: '专业技能', icon: '⚡', enabled: true, order: 1 },
  { id: 'experience', title: '工作经历', icon: '💼', enabled: true, order: 2 },
  { id: 'projects', title: '项目经历', icon: '🚀', enabled: true, order: 3 },
  { id: 'education', title: '教育经历', icon: '🎓', enabled: true, order: 4 },
  { id: 'selfEvaluation', title: '自我评价', icon: '📝', enabled: true, order: 5 },
]

export const TEMPLATE_LABELS: Record<string, string> = {
  classic: '经典模板',
  modern: '两栏布局',
  elegant: '优雅模板',
  'left-right': '模块标题背景色',
  timeline: '时间轴布局',
  minimalist: '极简模板',
  creative: '创意模板',
  editorial: '画报风',
  swiss: '瑞士美学',
}

export const DEFAULT_BASIC_FIELD_ORDER: BasicFieldType[] = [
  { id: 'name', key: 'name', label: '姓名', type: 'text', visible: true },
  { id: 'title', key: 'title', label: '职位', type: 'text', visible: true },
  { id: 'birthDate', key: 'birthDate', label: '生日', type: 'date', visible: true },
  { id: 'employementStatus', key: 'employementStatus', label: '状态', type: 'text', visible: true },
  { id: 'email', key: 'email', label: '邮箱', type: 'text', visible: true },
  { id: 'phone', key: 'phone', label: '电话', type: 'text', visible: true },
  { id: 'location', key: 'location', label: '地址', type: 'text', visible: true },
]

export const DEFAULT_BASIC_ICONS: Partial<Record<BasicFieldKey, string>> = {
  birthDate: 'calendar',
  employementStatus: 'briefcase',
  email: 'mail',
  phone: 'phone',
  location: 'location',
}

export const RESUME_PHOTO_WIDTH = 100
export const RESUME_PHOTO_HEIGHT = 125

export const DEFAULT_PHOTO_CONFIG: PhotoConfig = {
  width: RESUME_PHOTO_WIDTH,
  height: RESUME_PHOTO_HEIGHT,
  aspectRatio: '4:5',
  borderRadius: 'none',
  customBorderRadius: 0,
  visible: true,
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function cloneBasicFieldOrder() {
  return DEFAULT_BASIC_FIELD_ORDER.map((field) => ({ ...field }))
}

export function createCustomField(): CustomFieldType {
  return {
    id: createId('custom'),
    label: '',
    value: '',
    icon: 'globe',
    visible: true,
    custom: true,
    displayLabel: false,
  }
}

export function createEducation(): Education {
  return {
    id: createId('edu'),
    school: '',
    major: '',
    degree: '',
    startDate: '',
    endDate: '',
    gpa: '',
    description: '',
    visible: true,
  }
}

export function createExperience(): Experience {
  return {
    id: createId('exp'),
    company: '',
    position: '',
    date: '',
    details: '',
    visible: true,
  }
}

export function createProject(): Project {
  return {
    id: createId('proj'),
    name: '',
    role: '',
    date: '',
    description: '',
    visible: true,
    link: '',
    linkLabel: '',
  }
}

export function createCertificate(): Certificate {
  return {
    id: createId('cert'),
    url: '',
    width: 100,
  }
}

export function createCustomItem(): CustomItem {
  return {
    id: createId('section'),
    title: '',
    subtitle: '',
    dateRange: '',
    description: '',
    visible: true,
  }
}

export function getDefaultGlobalSettings(templateId: ResumeData['templateId'] = 'classic'): GlobalSettings {
  if (templateId === 'blank') {
    return {
      themeColor: '#111827',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 14,
      pagePadding: 32,
      lineHeight: 1.55,
      sectionSpacing: 12,
      paragraphSpacing: 8,
      headerSize: 18,
      subheaderSize: 14,
      useIconMode: false,
      centerSubtitle: false,
    }
  }
  if (templateId === 'modern') {
    return {
      themeColor: '#000000',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 0,
      lineHeight: 1.5,
      sectionSpacing: 8,
      paragraphSpacing: 4,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'elegant') {
    return {
      themeColor: '#18181b',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 32,
      lineHeight: 1.5,
      sectionSpacing: 28,
      paragraphSpacing: 18,
      headerSize: 20,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'left-right') {
    return {
      themeColor: '#2563eb',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 32,
      lineHeight: 1.5,
      sectionSpacing: 24,
      paragraphSpacing: 16,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'timeline') {
    return {
      themeColor: '#18181b',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 24,
      lineHeight: 1.5,
      sectionSpacing: 1,
      paragraphSpacing: 12,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'minimalist') {
    return {
      themeColor: '#171717',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 40,
      lineHeight: 1.5,
      sectionSpacing: 32,
      paragraphSpacing: 24,
      headerSize: 16,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: true,
    }
  }
  if (templateId === 'creative') {
    return {
      themeColor: '#7c3aed',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 14,
      lineHeight: 1.5,
      sectionSpacing: 16,
      paragraphSpacing: 16,
      headerSize: 16,
      subheaderSize: 16,
      useIconMode: false,
      centerSubtitle: false,
    }
  }
  if (templateId === 'editorial') {
    return {
      themeColor: '#8e8e8e',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 36,
      lineHeight: 1.5,
      sectionSpacing: 32,
      paragraphSpacing: 16,
      headerSize: 13,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  if (templateId === 'swiss') {
    return {
      themeColor: '#E31C24',
      fontFamily: '"Alibaba PuHuiTi", sans-serif',
      baseFontSize: 16,
      pagePadding: 36,
      lineHeight: 1.5,
      sectionSpacing: 36,
      paragraphSpacing: 12,
      headerSize: 18,
      subheaderSize: 16,
      useIconMode: true,
      centerSubtitle: false,
    }
  }
  return {
    themeColor: '#000000',
    fontFamily: '"Alibaba PuHuiTi", sans-serif',
    baseFontSize: 16,
    pagePadding: 32,
    lineHeight: 1.5,
    sectionSpacing: 16,
    paragraphSpacing: 12,
    headerSize: 18,
    subheaderSize: 16,
    useIconMode: true,
    centerSubtitle: true,
  }
}

export function createEmptyResumeDocument(templateId: ResumeData['templateId'] = 'classic'): Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: '新建简历',
    templateId,
    visibility: false,
    basic: {
      name: '',
      title: '',
      employementStatus: '',
      email: '',
      phone: '',
      location: '',
      birthDate: '',
      icons: DEFAULT_BASIC_ICONS as Record<string, string>,
      photo: '',
      photoConfig: { ...DEFAULT_PHOTO_CONFIG },
      fieldOrder: cloneBasicFieldOrder(),
      customFields: [],
      githubKey: '',
      githubUseName: '',
      githubContributionsVisible: false,
    },
    education: [createEducation()],
    experience: [],
    projects: [],
    certificates: [],
    customData: {},
    skillContent: '',
    selfEvaluationContent: '',
    activeSection: 'basic',
    draggingProjectId: null,
    globalSettings: getDefaultGlobalSettings(templateId),
    menuSections: DEFAULT_SECTIONS,
  }
}

export function createTemplateResumeDocument(templateId: ResumeData['templateId'] = 'classic'): Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'> {
  return createEmptyResumeDocument(templateId)
}

export function ensureResumeDefaults<T extends ResumeData | Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'>>(resume: T): T {
  const fieldOrder = resume.basic.fieldOrder?.length ? resume.basic.fieldOrder : cloneBasicFieldOrder()
  const icons = (resume.basic.icons ?? DEFAULT_BASIC_ICONS) as Record<string, string>
  const defaultSettings = getDefaultGlobalSettings(resume.templateId)
  const usesLegacyPlatformTypography =
    !resume.globalSettings?.fontFamily &&
    resume.globalSettings?.baseFontSize === 13
  const customFields = (resume.basic.customFields ?? []).map((field) => ({
    ...field,
    visible: field.visible ?? true,
    custom: field.custom ?? true,
    displayLabel: field.displayLabel ?? false,
  }))
  const legacy = resume as T & {
    basic?: T extends { basic: infer B } ? B & { gender?: string } : never
    skills?: Array<{ name?: string }>
    selfEvaluation?: string
  }
  const legacySkillContent =
    typeof (resume as ResumeData).skillContent === 'string'
      ? (resume as ResumeData).skillContent
      : legacy.skills?.length
        ? textareaToListHtml(legacy.skills.map((item) => item.name ?? '').filter(Boolean).join('\n'))
        : ''
  const legacySelfEvaluation =
    typeof (resume as ResumeData).selfEvaluationContent === 'string'
      ? (resume as ResumeData).selfEvaluationContent
      : typeof legacy.selfEvaluation === 'string'
        ? textareaToParagraphHtml(legacy.selfEvaluation)
        : ''

  return {
    ...resume,
    basic: {
      ...resume.basic,
      employementStatus: resume.basic.employementStatus ?? '',
      birthDate: resume.basic.birthDate ?? '',
      email: resume.basic.email ?? '',
      phone: resume.basic.phone ?? '',
      location: resume.basic.location ?? '',
      fieldOrder,
      icons,
      customFields,
      photo: resume.basic.photo ?? '',
      photoConfig: resume.basic.photoConfig ?? { ...DEFAULT_PHOTO_CONFIG },
      githubKey: resume.basic.githubKey ?? '',
      githubUseName: resume.basic.githubUseName ?? '',
      githubContributionsVisible: resume.basic.githubContributionsVisible ?? false,
    },
    certificates: (resume as ResumeData).certificates ?? [],
    customData: (resume as ResumeData).customData ?? {},
    skillContent: legacySkillContent,
    selfEvaluationContent: legacySelfEvaluation,
    activeSection: (resume as ResumeData).activeSection ?? 'basic',
    draggingProjectId: (resume as ResumeData).draggingProjectId ?? null,
    globalSettings: usesLegacyPlatformTypography
      ? {
          ...defaultSettings,
          themeColor: resume.globalSettings.themeColor ?? defaultSettings.themeColor,
        }
      : {
          ...defaultSettings,
          ...resume.globalSettings,
        },
    menuSections: resume.menuSections?.length ? resume.menuSections : DEFAULT_SECTIONS,
  }
}

export const SECTION_LABELS: Record<ResumeSectionId, string> = {
  basic: '基本信息',
  skills: '专业技能',
  experience: '工作经历',
  projects: '项目经历',
  education: '教育经历',
  selfEvaluation: '自我评价',
}
