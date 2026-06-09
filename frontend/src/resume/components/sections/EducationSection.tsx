import { Button, Card, Form, Input, Switch } from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'

import { useResumeEditor } from '../../ResumeEditorContext'

export function EducationSection() {
  const { resume, addEducation, removeEducation, updateEducation } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Button type="outline" icon={<IconPlus />} onClick={addEducation}>
        新增教育经历
      </Button>
      {resume.education.map((item, index) => (
        <Card
          key={item.id}
          size="small"
          title={`教育经历 ${index + 1}`}
          extra={
            <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeEducation(item.id)}>
              删除
            </Button>
          }
        >
          <Form layout="vertical">
            <Form.Item label="学校">
              <Input value={item.school} onChange={(value) => updateEducation(item.id, { school: value })} />
            </Form.Item>
            <Form.Item label="专业">
              <Input value={item.major} onChange={(value) => updateEducation(item.id, { major: value })} />
            </Form.Item>
            <Form.Item label="学历">
              <Input value={item.degree} onChange={(value) => updateEducation(item.id, { degree: value })} />
            </Form.Item>
            <Form.Item label="起止时间">
              <Input
                value={[item.startDate, item.endDate].filter(Boolean).join(' - ')}
                onChange={(value) => {
                  const [startDate = '', endDate = ''] = value.split('-').map((part) => part.trim())
                  updateEducation(item.id, { startDate, endDate })
                }}
                placeholder="如 2021-09 - 2025-06"
              />
            </Form.Item>
            <Form.Item label="GPA / 排名">
              <Input value={item.gpa} onChange={(value) => updateEducation(item.id, { gpa: value })} />
            </Form.Item>
            <Form.Item label="亮点描述">
              <Input.TextArea value={item.description} onChange={(value) => updateEducation(item.id, { description: value })} autoSize={{ minRows: 4 }} />
            </Form.Item>
            <Form.Item label="显示在简历中">
              <Switch checked={item.visible} onChange={(checked) => updateEducation(item.id, { visible: checked })} />
            </Form.Item>
          </Form>
        </Card>
      ))}
    </div>
  )
}
