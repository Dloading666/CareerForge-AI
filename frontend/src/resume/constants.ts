import type {
  Education,
  Experience,
  GlobalSettings,
  MenuSection,
  Project,
  ResumeData,
  ResumeSectionId,
  Skill,
} from './types'

const DEFAULT_SECTIONS: MenuSection[] = [
  { id: 'basic', title: '基本信息', icon: '👤', enabled: true, order: 0 },
  { id: 'skills', title: '专业技能', icon: '⚡', enabled: true, order: 1 },
  { id: 'experience', title: '工作经历', icon: '💼', enabled: true, order: 2 },
  { id: 'projects', title: '项目经历', icon: '🚀', enabled: true, order: 3 },
  { id: 'education', title: '教育经历', icon: '🎓', enabled: true, order: 4 },
  { id: 'selfEvaluation', title: '自我评价', icon: '📝', enabled: true, order: 5 },
]

export const TEMPLATE_LABELS = {
  classic: '经典',
  modern: '现代',
  elegant: '优雅',
} as const

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
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
  }
}

export function createSkill(): Skill {
  return {
    id: createId('skill'),
    name: '',
    level: 3,
  }
}

export function getDefaultGlobalSettings(templateId: ResumeData['templateId'] = 'classic'): GlobalSettings {
  if (templateId === 'modern') {
    return {
      themeColor: '#111111',
      baseFontSize: 13,
      pagePadding: 0,
      lineHeight: 1.68,
      sectionSpacing: 22,
    }
  }
  if (templateId === 'elegant') {
    return {
      themeColor: '#18181b',
      baseFontSize: 13,
      pagePadding: 36,
      lineHeight: 1.72,
      sectionSpacing: 28,
    }
  }
  return {
    themeColor: '#111111',
    baseFontSize: 13,
    pagePadding: 36,
    lineHeight: 1.68,
    sectionSpacing: 22,
  }
}

export function createEmptyResumeDocument(): Omit<ResumeData, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: '新建简历',
    templateId: 'classic',
    visibility: false,
    basic: {
      name: '',
      title: '',
      email: '',
      phone: '',
      location: '',
      birthDate: '',
      gender: '',
      photo: '',
    },
    education: [createEducation()],
    experience: [],
    projects: [],
    skills: [],
    selfEvaluation: '',
    globalSettings: getDefaultGlobalSettings('classic'),
    menuSections: DEFAULT_SECTIONS,
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
