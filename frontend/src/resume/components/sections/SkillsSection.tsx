import { Form, Input } from '@arco-design/web-react'

import { useResumeEditor } from '../../useResumeEditor'
import { richTextToTextarea, textareaToListHtml } from '../../utils/content'

export function SkillsSection() {
  const { resume, setSkillContent } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="专业技能">
          <Input.TextArea
            value={richTextToTextarea(resume.skillContent)}
            onChange={(value) => setSkillContent(textareaToListHtml(value))}
            autoSize={{ minRows: 10 }}
            placeholder="每行一条，例如：前端框架：熟悉 React、Vue.js、Next.js"
          />
        </Form.Item>
      </Form>
    </div>
  )
}
