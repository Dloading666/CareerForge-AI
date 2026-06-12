import { createContext } from 'react'
import type { ResumeData } from './types'
import type { ResumeSectionId } from './types'
import type { BasicInfo, Education, Experience, Project, MenuSection, GlobalSettings } from './types'

export interface ResumeEditorContextValue {
    resume: ResumeData | null
    dirty: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    activeSection: ResumeSectionId

    setResume: (resume: ResumeData) => void
    setActiveSection: (section: ResumeSectionId) => void
    updateTitle: (title: string) => void
    setTemplateId: (templateId: ResumeData['templateId']) => void
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
    reorderSections: (sections: MenuSection[]) => void
    markSaving: () => void
    markSaved: (resume: ResumeData) => void
    markError: () => void
}

export const ResumeEditorContext = createContext<ResumeEditorContextValue | undefined>(undefined as any)

import { useContext } from 'react'

export function useResumeEditor(): ResumeEditorContextValue {
  const ctx = useContext(ResumeEditorContext)
  if (!ctx) {
    throw new Error('useResumeEditor must be used within ResumeEditorProvider')
  }
  return ctx
}

