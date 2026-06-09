export type TemplateId = 'classic' | 'modern' | 'elegant'
export type ResumeSectionId = 'basic' | 'skills' | 'experience' | 'projects' | 'education' | 'selfEvaluation'

export type ResumeSummary = {
  id: number
  title: string
  templateId: TemplateId
  visibility: boolean
  createdAt: string
  updatedAt: string
}

export type MenuSection = {
  id: ResumeSectionId
  title: string
  icon: string
  enabled: boolean
  order: number
}

export type GlobalSettings = {
  themeColor: string
  baseFontSize: number
  pagePadding: number
  lineHeight: number
  sectionSpacing: number
}

export type BasicInfo = {
  name: string
  title: string
  email: string
  phone: string
  location: string
  birthDate: string
  gender: string
  photo: string
}

export type Education = {
  id: string
  school: string
  major: string
  degree: string
  startDate: string
  endDate: string
  gpa: string
  description: string
  visible: boolean
}

export type Experience = {
  id: string
  company: string
  position: string
  date: string
  details: string
  visible: boolean
}

export type Project = {
  id: string
  name: string
  role: string
  date: string
  description: string
  visible: boolean
}

export type Skill = {
  id: string
  name: string
  level: number
}

export type ResumeData = {
  id: number
  title: string
  templateId: TemplateId
  visibility: boolean
  basic: BasicInfo
  education: Education[]
  experience: Experience[]
  projects: Project[]
  skills: Skill[]
  selfEvaluation: string
  globalSettings: GlobalSettings
  menuSections: MenuSection[]
  createdAt: string
  updatedAt: string
}

export type ResumeTemplateConfig = {
  id: TemplateId
  name: string
  description: string
  accentColor: string
  secondaryColor: string
  background: string
  textColor: string
  thumbnailSrc: string
  layout: 'single' | 'split' | 'center'
}

export type ViewListItem = {
  title: string
  subtitle?: string
  meta?: string
  lines: string[]
}

export type TemplateViewModel = {
  header: {
    name: string
    title: string
    contacts: string[]
  }
  skills: ViewListItem[]
  education: ViewListItem[]
  experience: ViewListItem[]
  projects: ViewListItem[]
  selfEvaluation: string[]
}
