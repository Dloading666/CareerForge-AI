import { Button, Card, Form, Input, Switch } from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'

import { useResumeEditor } from '../../useResumeEditor'
import { FieldAiAssist } from '../FieldAiAssist'
import { RichTextEditor } from '../RichTextEditor'

export function ProjectsSection() {
  const { resume, addProject, removeProject, updateProject } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Button type="outline" icon={<IconPlus />} onClick={addProject}>
        新增项目经历
      </Button>
      {resume.projects.map((item, index) => (
        <Card
          key={item.id}
          size="small"
          title={`项目经历 ${index + 1}`}
          extra={
            <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeProject(item.id)}>
              删除
            </Button>
          }
        >
          <Form layout="vertical">
            <Form.Item label="项目名称">
              <Input value={item.name} onChange={(value) => updateProject(item.id, { name: value })} />
            </Form.Item>
            <Form.Item label="担任角色">
              <Input value={item.role} onChange={(value) => updateProject(item.id, { role: value })} />
            </Form.Item>
            <Form.Item label="时间">
              <Input value={item.date} onChange={(value) => updateProject(item.id, { date: value })} placeholder="如 2024-03 - 2024-08" />
            </Form.Item>
            <Form.Item label="项目链接">
              <Input value={item.link} onChange={(value) => updateProject(item.id, { link: value })} placeholder="如 https://project.demo" />
            </Form.Item>
            <Form.Item label="链接文案">
              <Input value={item.linkLabel} onChange={(value) => updateProject(item.id, { linkLabel: value })} placeholder="如 在线访问" />
            </Form.Item>
            <Form.Item label="项目亮点">
              <FieldAiAssist
                section="project"
                value={item.description ?? ""}
                onApply={(value) => updateProject(item.id, { description: value })}
                applyLabel="应用到本条项目"
              >
                {(trigger) => (
                  <RichTextEditor
                    value={item.description ?? ""}
                    onChange={(value) => updateProject(item.id, { description: value })}
                placeholder="每行一条，保存后会按魔方简历的列表结构写入"
                minRows={5}
                                  onAiAssist={trigger}
                  />
                )}
              </FieldAiAssist>
</Form.Item>
            <Form.Item label="显示在简历中">
              <Switch checked={item.visible} onChange={(checked) => updateProject(item.id, { visible: checked })} />
            </Form.Item>
          </Form>
        </Card>
      ))}
    </div>
  )
}
