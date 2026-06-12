import { useMemo, useReducer, type ReactNode } from 'react'

import {
  createEducation,
  createExperience,
  createProject,
  getDefaultGlobalSettings,
} from './constants'
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
import { ResumeEditorContext, type ResumeEditorContextValue } from './useResumeEditor'

export type { ResumeEditorContextValue }

type ResumeEditorState = {
  resume: ResumeData | null
  activeSection: ResumeSectionId
  dirty: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
}

type Action =
  | { type: 'set_resume'; resume: ResumeData }
  | { type: 'set_active_section'; section: ResumeSectionId }
  | { type: 'update_title'; title: string }
  | { type: 'set_template'; templateId: TemplateId }
  | { type: 'set_visibility'; visibility: boolean }
  | { type: 'update_basic'; patch: Partial<BasicInfo> }
  | { type: 'update_education'; id: string; patch: Partial<Education> }
  | { type: 'add_education' }
  | { type: 'remove_education'; id: string }
  | { type: 'update_experience'; id: string; patch: Partial<Experience> }
  | { type: 'add_experience' }
  | { type: 'remove_experience'; id: string }
  | { type: 'update_project'; id: string; patch: Partial<Project> }
  | { type: 'add_project' }
  | { type: 'remove_project'; id: string }
  | { type: 'set_skill_content'; value: string }
  | { type: 'set_self_evaluation_content'; value: string }
  | { type: 'update_global_settings'; patch: Partial<GlobalSettings> }
  | { type: 'toggle_section_visibility'; sectionId: string }
  | { type: 'reorder_sections'; sections: import('./types').MenuSection[] }
  | { type: 'mark_saving' }
  | { type: 'mark_saved'; resume: ResumeData }
  | { type: 'mark_error' }

const initialState: ResumeEditorState = {
  resume: null,
  activeSection: 'basic',
  dirty: false,
  saveStatus: 'idle',
}

function updateListItem<T extends { id: string }>(items: T[], id: string, patch: Partial<T>) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item))
}

function reducer(state: ResumeEditorState, action: Action): ResumeEditorState {
  switch (action.type) {
    case 'set_resume':
      return {
        ...state,
        resume: action.resume,
        activeSection: action.resume.activeSection || 'basic',
        dirty: false,
        saveStatus: 'idle',
      }
    case 'set_active_section':
      return state.resume
        ? {
            ...state,
            activeSection: action.section,
            resume: {
              ...state.resume,
              activeSection: action.section,
            },
          }
        : { ...state, activeSection: action.section }
    case 'update_title':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, title: action.title } } : state
    case 'set_template':
      return state.resume
        ? {
            ...state,
            dirty: true,
            saveStatus: 'idle',
            resume: {
              ...state.resume,
              templateId: action.templateId,
              globalSettings: getDefaultGlobalSettings(action.templateId),
            },
          }
        : state
    case 'set_visibility':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, visibility: action.visibility } } : state
    case 'update_basic':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, basic: { ...state.resume.basic, ...action.patch } } }
        : state
    case 'update_education':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, education: updateListItem(state.resume.education, action.id, action.patch) } }
        : state
    case 'add_education':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, education: [...state.resume.education, createEducation()] } } : state
    case 'remove_education':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, education: state.resume.education.filter((item) => item.id !== action.id) } }
        : state
    case 'update_experience':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, experience: updateListItem(state.resume.experience, action.id, action.patch) } }
        : state
    case 'add_experience':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, experience: [...state.resume.experience, createExperience()] } } : state
    case 'remove_experience':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, experience: state.resume.experience.filter((item) => item.id !== action.id) } }
        : state
    case 'update_project':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, projects: updateListItem(state.resume.projects, action.id, action.patch) } }
        : state
    case 'add_project':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, projects: [...state.resume.projects, createProject()] } } : state
    case 'remove_project':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, projects: state.resume.projects.filter((item) => item.id !== action.id) } }
        : state
    case 'set_skill_content':
      return state.resume ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, skillContent: action.value } } : state
    case 'set_self_evaluation_content':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, selfEvaluationContent: action.value } }
        : state
    case 'update_global_settings':
      return state.resume
        ? { ...state, dirty: true, saveStatus: 'idle', resume: { ...state.resume, globalSettings: { ...state.resume.globalSettings, ...action.patch } } }
        : state
    case 'toggle_section_visibility':
      return state.resume
        ? {
            ...state,
            dirty: true,
            saveStatus: 'idle',
            resume: {
              ...state.resume,
              menuSections: state.resume.menuSections.map((s) =>
                s.id === action.sectionId ? { ...s, enabled: !s.enabled } : s,
              ),
            },
          }
        : state
    case 'reorder_sections':
      return state.resume
        ? {
            ...state,
            dirty: true,
            saveStatus: 'idle',
            resume: {
              ...state.resume,
              menuSections: action.sections.map((s, idx) => ({ ...s, order: idx })),
            },
          }
        : state
    case 'mark_saving':
      return { ...state, saveStatus: 'saving' }
    case 'mark_saved':
      return { ...state, resume: action.resume, dirty: false, saveStatus: 'saved' }
    case 'mark_error':
      return { ...state, saveStatus: 'error' }
    default:
      return state
  }
}

export function ResumeEditorProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  const actions = useMemo(
    () => ({
      setResume: (resume: ResumeData) => dispatch({ type: 'set_resume', resume }),
      setActiveSection: (section: ResumeSectionId) => dispatch({ type: 'set_active_section', section }),
      updateTitle: (title: string) => dispatch({ type: 'update_title', title }),
      setTemplateId: (templateId: TemplateId) => dispatch({ type: 'set_template', templateId }),
      setVisibility: (visibility: boolean) => dispatch({ type: 'set_visibility', visibility }),
      updateBasic: (patch: Partial<BasicInfo>) => dispatch({ type: 'update_basic', patch }),
      updateEducation: (id: string, patch: Partial<Education>) => dispatch({ type: 'update_education', id, patch }),
      addEducation: () => dispatch({ type: 'add_education' }),
      removeEducation: (id: string) => dispatch({ type: 'remove_education', id }),
      updateExperience: (id: string, patch: Partial<Experience>) => dispatch({ type: 'update_experience', id, patch }),
      addExperience: () => dispatch({ type: 'add_experience' }),
      removeExperience: (id: string) => dispatch({ type: 'remove_experience', id }),
      updateProject: (id: string, patch: Partial<Project>) => dispatch({ type: 'update_project', id, patch }),
      addProject: () => dispatch({ type: 'add_project' }),
      removeProject: (id: string) => dispatch({ type: 'remove_project', id }),
      setSkillContent: (value: string) => dispatch({ type: 'set_skill_content', value }),
      setSelfEvaluationContent: (value: string) => dispatch({ type: 'set_self_evaluation_content', value }),
      updateGlobalSettings: (patch: Partial<GlobalSettings>) => dispatch({ type: 'update_global_settings', patch }),
      toggleSectionVisibility: (sectionId: string) => dispatch({ type: 'toggle_section_visibility', sectionId }),
      reorderSections: (sections: import('./types').MenuSection[]) => dispatch({ type: 'reorder_sections', sections }),
      markSaving: () => dispatch({ type: 'mark_saving' }),
      markSaved: (resume: ResumeData) => dispatch({ type: 'mark_saved', resume }),
      markError: () => dispatch({ type: 'mark_error' }),
    }),
    [],
  )

  const value = useMemo<ResumeEditorContextValue>(
    () => ({
      ...state,
      ...actions,
    }),
    [state, actions],
  )

  return <ResumeEditorContext.Provider value={value}>{children}</ResumeEditorContext.Provider>
}
