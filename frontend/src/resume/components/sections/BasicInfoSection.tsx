import { Button, Card, Form, Input, Switch } from '@arco-design/web-react'
import { IconDelete, IconPlus } from '@arco-design/web-react/icon'

import { useResumeEditor } from '../../ResumeEditorContext'
import { createCustomField } from '../../constants'

export function BasicInfoSection() {
  const { resume, updateBasic } = useResumeEditor()
  if (!resume) return null

  const customFields = resume.basic.customFields ?? []

  const updateCustomField = (id: string, patch: Partial<(typeof customFields)[number]>) => {
    updateBasic({
      customFields: customFields.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    })
  }

  const removeCustomField = (id: string) => {
    updateBasic({
      customFields: customFields.filter((item) => item.id !== id),
    })
  }

  const addCustomField = () => {
    updateBasic({
      customFields: [...customFields, createCustomField()],
    })
  }

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="姓名">
          <Input value={resume.basic.name} onChange={(value) => updateBasic({ name: value })} />
        </Form.Item>
        <Form.Item label="期望岗位">
          <Input value={resume.basic.title} onChange={(value) => updateBasic({ title: value })} />
        </Form.Item>
        <Form.Item label="求职状态">
          <Input value={resume.basic.employementStatus} onChange={(value) => updateBasic({ employementStatus: value })} />
        </Form.Item>
        <Form.Item label="邮箱">
          <Input value={resume.basic.email} onChange={(value) => updateBasic({ email: value })} />
        </Form.Item>
        <Form.Item label="电话">
          <Input value={resume.basic.phone} onChange={(value) => updateBasic({ phone: value })} />
        </Form.Item>
        <Form.Item label="期望城市">
          <Input value={resume.basic.location} onChange={(value) => updateBasic({ location: value })} />
        </Form.Item>
        <Form.Item label="出生日期">
          <Input
            value={resume.basic.birthDate}
            onChange={(value) => updateBasic({ birthDate: value })}
            placeholder="YYYY-MM-DD"
            maxLength={10}
          />
        </Form.Item>
        <Form.Item label="GitHub Key">
          <Input value={resume.basic.githubKey} onChange={(value) => updateBasic({ githubKey: value })} placeholder="如 octocat" />
        </Form.Item>
        <Form.Item label="GitHub 显示名">
          <Input value={resume.basic.githubUseName} onChange={(value) => updateBasic({ githubUseName: value })} placeholder="留空则使用 Key" />
        </Form.Item>
        <Form.Item label="显示 GitHub 贡献图">
          <Switch checked={resume.basic.githubContributionsVisible} onChange={(checked) => updateBasic({ githubContributionsVisible: checked })} />
        </Form.Item>
        <Form.Item label="简历头像 URL">
          <Input
            value={resume.basic.photo}
            onChange={(value) => updateBasic({ photo: value })}
            placeholder="可粘贴证件照或头像链接，用于模板预览"
          />
        </Form.Item>
      </Form>

      <div className="resume-form-stack">
        <div className="resume-section-header-inline">
          <strong>自定义字段</strong>
          <Button type="outline" icon={<IconPlus />} onClick={addCustomField}>
            新增字段
          </Button>
        </div>
        {customFields.map((item, index) => (
          <Card
            key={item.id}
            size="small"
            title={`字段 ${index + 1}`}
            extra={
              <Button type="text" status="danger" icon={<IconDelete />} onClick={() => removeCustomField(item.id)}>
                删除
              </Button>
            }
          >
            <Form layout="vertical">
              <Form.Item label="标签">
                <Input value={item.label} onChange={(value) => updateCustomField(item.id, { label: value })} />
              </Form.Item>
              <Form.Item label="内容">
                <Input value={item.value} onChange={(value) => updateCustomField(item.id, { value: value })} />
              </Form.Item>
              <Form.Item label="图标名">
                <Input value={item.icon} onChange={(value) => updateCustomField(item.id, { icon: value })} placeholder="如 Globe" />
              </Form.Item>
              <Form.Item label="显示标签">
                <Switch checked={item.displayLabel ?? false} onChange={(checked) => updateCustomField(item.id, { displayLabel: checked })} />
              </Form.Item>
              <Form.Item label="显示在简历中">
                <Switch checked={item.visible ?? true} onChange={(checked) => updateCustomField(item.id, { visible: checked })} />
              </Form.Item>
            </Form>
          </Card>
        ))}
      </div>
    </div>
  )
}
