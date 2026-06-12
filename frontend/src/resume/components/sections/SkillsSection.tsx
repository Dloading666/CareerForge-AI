import { Form } from '@arco-design/web-react'

import { useResumeEditor } from '../../useResumeEditor'
import { RichTextEditor } from '../RichTextEditor'

export function SkillsSection() {
  const { resume, setSkillContent } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="专业技能">
          <RichTextEditor
                value={resume.skillContent}
                onChange={(value) => setSkillContent(value)}
                placeholder="每行一条，例如：前端框架：熟悉 React、Vue.js、Next.js"
                minRows={10}
              />
        </Form.Item>
      </Form>
    </div>
  )
}
