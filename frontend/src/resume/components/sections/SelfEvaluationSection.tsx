import { Form } from '@arco-design/web-react'

import { useResumeEditor } from '../../useResumeEditor'
import { RichTextEditor } from '../RichTextEditor'

export function SelfEvaluationSection() {
  const { resume, setSelfEvaluationContent } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="自我评价">
          <RichTextEditor
                value={resume.selfEvaluationContent}
                onChange={(value) => setSelfEvaluationContent(value)}
                placeholder="每行一条，例如：前端框架：熟悉 React、Vue.js、Next.js"
                minRows={8}
              />
        </Form.Item>
      </Form>
    </div>
  )
}
