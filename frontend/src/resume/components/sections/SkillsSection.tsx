import { Button, Card, Form, Input, InputNumber } from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'

import { useResumeEditor } from '../../ResumeEditorContext'

export function SkillsSection() {
  const { resume, addSkill, removeSkill, updateSkill } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Button type="outline" icon={<IconPlus />} onClick={addSkill}>
        新增技能
      </Button>
      {resume.skills.map((item, index) => (
        <Card
          key={item.id}
          size="small"
          title={`技能 ${index + 1}`}
          extra={
            <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeSkill(item.id)}>
              删除
            </Button>
          }
        >
          <Form layout="vertical">
            <Form.Item label="技能名称">
              <Input value={item.name} onChange={(value) => updateSkill(item.id, { name: value })} />
            </Form.Item>
            <Form.Item label="熟练度（1-5）">
              <InputNumber min={1} max={5} value={item.level} onChange={(value) => updateSkill(item.id, { level: Number(value) || 3 })} />
            </Form.Item>
          </Form>
        </Card>
      ))}
    </div>
  )
}
