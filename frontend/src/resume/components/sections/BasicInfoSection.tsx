import { Form, Input } from '@arco-design/web-react'

import { useResumeEditor } from '../../ResumeEditorContext'

export function BasicInfoSection() {
  const { resume, updateBasic } = useResumeEditor()
  if (!resume) return null

  return (
    <div className="resume-form-stack">
      <Form layout="vertical">
        <Form.Item label="姓名">
          <Input value={resume.basic.name} onChange={(value) => updateBasic({ name: value })} />
        </Form.Item>
        <Form.Item label="目标岗位">
          <Input value={resume.basic.title} onChange={(value) => updateBasic({ title: value })} />
        </Form.Item>
        <Form.Item label="邮箱">
          <Input value={resume.basic.email} onChange={(value) => updateBasic({ email: value })} />
        </Form.Item>
        <Form.Item label="电话">
          <Input value={resume.basic.phone} onChange={(value) => updateBasic({ phone: value })} />
        </Form.Item>
        <Form.Item label="所在城市 / 学校">
          <Input value={resume.basic.location} onChange={(value) => updateBasic({ location: value })} />
        </Form.Item>
        <Form.Item label="出生日期">
          <Input value={resume.basic.birthDate} onChange={(value) => updateBasic({ birthDate: value })} placeholder="如 2002-09" />
        </Form.Item>
        <Form.Item label="性别">
          <Input value={resume.basic.gender} onChange={(value) => updateBasic({ gender: value })} />
        </Form.Item>
        <Form.Item label="头像 URL">
          <Input
            value={resume.basic.photo}
            onChange={(value) => updateBasic({ photo: value })}
            placeholder="可粘贴证件照或头像链接，用于模板预览"
          />
        </Form.Item>
      </Form>
    </div>
  )
}
