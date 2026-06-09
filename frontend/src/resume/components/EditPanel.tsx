import { Card } from '@arco-design/web-react'

import { useResumeEditor } from '../ResumeEditorContext'
import { BasicInfoSection } from './sections/BasicInfoSection'
import { EducationSection } from './sections/EducationSection'
import { ExperienceSection } from './sections/ExperienceSection'
import { ProjectsSection } from './sections/ProjectsSection'
import { SkillsSection } from './sections/SkillsSection'
import { SelfEvaluationSection } from './sections/SelfEvaluationSection'

export function EditPanel() {
  const { activeSection, resume } = useResumeEditor()
  if (!resume) return null

  const title = resume.menuSections.find((item) => item.id === activeSection)?.title || '编辑'

  let content = <BasicInfoSection />
  if (activeSection === 'education') content = <EducationSection />
  if (activeSection === 'experience') content = <ExperienceSection />
  if (activeSection === 'projects') content = <ProjectsSection />
  if (activeSection === 'skills') content = <SkillsSection />
  if (activeSection === 'selfEvaluation') content = <SelfEvaluationSection />

  return (
    <Card className="resume-editor-panel" title={title}>
      {content}
    </Card>
  )
}
