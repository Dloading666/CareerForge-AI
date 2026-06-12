import { Form, Input } from '@arco-design/web-react'

import { useResumeEditor } from '../../useResumeEditor'
import { richTextToTextarea, textareaToParagraphHtml } from '../../utils/content'

export function SelfEvaluationSection() {
  const { resume, setSelfEvaluationContent } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="自我评价">
          <Input.TextArea
            value={richTextToTextarea(resume.selfEvaluationContent)}
            onChange={(value) => setSelfEvaluationContent(textareaToParagraphHtml(value))}
            autoSize={{ minRows: 8 }}
            placeholder="建议按一行一个观点填写，例如：沟通协作强、执行力强、学习速度快。"
          />
        </Form.Item>
      </Form>
    </div>
  )
}
