import { Button, Card, Form, Input, Switch } from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'

import { useResumeEditor } from '../../useResumeEditor'
import { FieldAiAssist } from '../FieldAiAssist'
import { RichTextEditor } from '../RichTextEditor'

export function ExperienceSection() {
  const { resume, addExperience, removeExperience, updateExperience } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Button type="outline" icon={<IconPlus />} onClick={addExperience}>
        新增工作经历
      </Button>
      {resume.experience.map((item, index) => (
        <Card
          key={item.id}
          size="small"
          title={`工作经历 ${index + 1}`}
          extra={
            <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeExperience(item.id)}>
              删除
            </Button>
          }
        >
          <Form layout="vertical">
            <Form.Item label="公司">
              <Input value={item.company} onChange={(value) => updateExperience(item.id, { company: value })} />
            </Form.Item>
            <Form.Item label="岗位">
              <Input value={item.position} onChange={(value) => updateExperience(item.id, { position: value })} />
            </Form.Item>
            <Form.Item label="时间">
              <Input value={item.date} onChange={(value) => updateExperience(item.id, { date: value })} placeholder="如 2023-06 - 至今" />
            </Form.Item>
            <Form.Item label="工作内容与成果">
              <FieldAiAssist
                section="experience"
                value={item.details ?? ""}
                onApply={(value) => updateExperience(item.id, { details: value })}
                applyLabel="应用到本条工作经历"
              >
                {(trigger) => (
                  <RichTextEditor
                    value={item.details ?? ""}
                    onChange={(value) => updateExperience(item.id, { details: value })}
                placeholder="每行一条，保存后会按魔方简历的列表结构写入"
                minRows={5}
                                  onAiAssist={trigger}
                  />
                )}
              </FieldAiAssist>
</Form.Item>
            <Form.Item label="显示在简历中">
              <Switch checked={item.visible} onChange={(checked) => updateExperience(item.id, { visible: checked })} />
            </Form.Item>
          </Form>
        </Card>
      ))}
    </div>
  )
}
