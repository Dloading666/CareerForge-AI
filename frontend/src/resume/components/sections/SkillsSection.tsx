import { Form } from '@arco-design/web-react'

import { useResumeEditor } from '../../useResumeEditor'
import { FieldAiAssist } from '../FieldAiAssist'
import { RichTextEditor } from '../RichTextEditor'

export function SkillsSection() {
  const { resume, setSkillContent } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="专业技能">
          <FieldAiAssist
                section="skill"
                value={resume.skillContent}
                onApply={(value) => setSkillContent(value)}
                applyLabel="应用到专业技能"
              >
                {(trigger) => (
                  <RichTextEditor
                    value={resume.skillContent}
                    onChange={(value) => setSkillContent(value)}
                placeholder="每行一条，例如：前端框架：熟悉 React、Vue.js、Next.js"
                minRows={10}
                                  onAiAssist={trigger}
                  />
                )}
              </FieldAiAssist>
</Form.Item>
      </Form>
    </div>
  )
}
