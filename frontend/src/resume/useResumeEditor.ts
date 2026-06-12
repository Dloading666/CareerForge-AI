import { createContext, useContext } from 'react'

import type {
  BasicInfo,
  Education,
  Experience,
  GlobalSettings,
  Project,
  ResumeData,
  ResumeSectionId,
  TemplateId,
} from './types'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

type ResumeEditorState = {
  resume: ResumeData | null
  activeSection: ResumeSectionId
  dirty: boolean
  saveStatus: SaveStatus
}

export type ResumeEditorContextValue = ResumeEditorState & {
  setResume: (resume: ResumeData) => void
  setActiveSection: (section: ResumeSectionId) => void
  updateTitle: (title: string) => void
  setTemplateId: (templateId: TemplateId) => void
  setVisibility: (visibility: boolean) => void
  updateBasic: (patch: Partial<BasicInfo>) => void
  updateEducation: (id: string, patch: Partial<Education>) => void
  addEducation: () => void
  removeEducation: (id: string) => void
  updateExperience: (id: string, patch: Partial<Experience>) => void
  addExperience: () => void
  removeExperience: (id: string) => void
  updateProject: (id: string, patch: Partial<Project>) => void
  addProject: () => void
  removeProject: (id: string) => void
  setSkillContent: (value: string) => void
  setSelfEvaluationContent: (value: string) => void
  updateGlobalSettings: (patch: Partial<GlobalSettings>) => void
  toggleSectionVisibility: (sectionId: string) => void
  reorderSections: (sections: import('./types').MenuSection[]) => void
  markSaving: () => void
  markSaved: (resume: ResumeData) => void
  markError: () => void
}

const ResumeEditorContext = createContext<ResumeEditorContextValue | null>(null)

export { ResumeEditorContext }

export function useResumeEditor() {
  const context = useContext(ResumeEditorContext)
  if (!context) {
    throw new Error('useResumeEditor must be used within ResumeEditorProvider')
  }
  return context
}
