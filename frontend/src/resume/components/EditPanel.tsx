import { useResumeEditor } from '../useResumeEditor'
import { BasicInfoSection } from './sections/BasicInfoSection'
import { EducationSection } from './sections/EducationSection'
import { ExperienceSection } from './sections/ExperienceSection'
import { ProjectsSection } from './sections/ProjectsSection'
import { SkillsSection } from './sections/SkillsSection'
import { SelfEvaluationSection } from './sections/SelfEvaluationSection'

export function EditPanel() {
  const { activeSection, resume } = useResumeEditor()
  if (!resume) return null

  const activeMenuSection = resume.menuSections.find((s) => s.id === activeSection)

  let content = <BasicInfoSection />
  if (activeSection === 'education') content = <EducationSection />
  if (activeSection === 'experience') content = <ExperienceSection />
  if (activeSection === 'projects') content = <ProjectsSection />
  if (activeSection === 'skills') content = <SkillsSection />
  if (activeSection === 'selfEvaluation') content = <SelfEvaluationSection />

  return (
    <div className="wb-edit-inner">
      <div className="wb-edit-section-header">
        <span className="wb-edit-section-icon">{activeMenuSection?.icon}</span>
        <span className="wb-edit-section-title">{activeMenuSection?.title ?? '编辑'}</span>
      </div>
      <div className="wb-edit-content">
        {content}
      </div>
    </div>
  )
}
