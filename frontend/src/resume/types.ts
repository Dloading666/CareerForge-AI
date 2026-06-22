export type TemplateId = 'blank' | 'classic' | 'modern' | 'elegant' | 'left-right' | 'timeline' | 'minimalist' | 'creative' | 'editorial' | 'swiss'
export type ResumeSectionId = string
export type BasicFieldKey = 'name' | 'title' | 'birthDate' | 'employementStatus' | 'email' | 'phone' | 'location'

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
  themeColor?: string
  fontFamily?: string
  baseFontSize?: number
  pagePadding?: number
  paragraphSpacing?: number
  lineHeight?: number
  sectionSpacing?: number
  headerSize?: number
  subheaderSize?: number
  useIconMode?: boolean
  centerSubtitle?: boolean
  flexibleHeaderLayout?: boolean
  autoOnePage?: boolean
}

export type PhotoConfig = {
  width: number
  height: number
  aspectRatio: '1:1' | '4:3' | '3:4' | '4:5' | '16:9' | 'custom'
  borderRadius: 'none' | 'medium' | 'full' | 'custom'
  customBorderRadius: number
  visible?: boolean
}

export type BasicFieldType = {
  id: string
  key: keyof BasicInfo
  label: string
  type?: 'text' | 'date' | 'textarea' | 'editor'
  visible: boolean
  custom?: boolean
}

export type CustomFieldType = {
  id: string
  label: string
  value: string
  icon?: string
  visible?: boolean
  custom?: boolean
  displayLabel?: boolean
}

export type BasicInfo = {
  birthDate: string
  name: string
  title: string
  employementStatus: string
  email: string
  phone: string
  location: string
  icons: Record<string, string>
  photo: string
  photoConfig: PhotoConfig
  fieldOrder?: BasicFieldType[]
  customFields: CustomFieldType[]
  githubKey: string
  githubUseName: string
  githubContributionsVisible: boolean
  layout?: 'left' | 'center' | 'right'
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
  link?: string
  linkLabel?: string
}

export type Certificate = {
  id: string
  url: string
  width: number
}

export type CustomItem = {
  id: string
  title: string
  subtitle: string
  dateRange: string
  description: string
  visible: boolean
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
  certificates: Certificate[]
  customData: Record<string, CustomItem[]>
  skillContent: string
  selfEvaluationContent: string
  activeSection: string
  draggingProjectId: string | null
  menuSections: MenuSection[]
  globalSettings: GlobalSettings
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

import type { RichInlineBlock } from './utils/content'

export type ViewListItem = {
  /** 原始数据项的 id，用于画布拖拽定位 */
  itemId?: string
  title: string
  subtitle?: string
  meta?: string
  blocks: RichInlineBlock[]
}

export type TemplateViewModel = {
  header: {
    name: string
    title: string
    contacts: string[]
  }
  skills: RichInlineBlock[]
  education: ViewListItem[]
  experience: ViewListItem[]
  projects: ViewListItem[]
  selfEvaluation: RichInlineBlock[]
}
