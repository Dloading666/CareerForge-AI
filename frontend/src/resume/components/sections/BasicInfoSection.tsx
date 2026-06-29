import { Button, Card, Form, Input, Switch, Message } from '@arco-design/web-react'
import { IconCamera, IconDelete, IconPlus } from '@arco-design/web-react/icon'
import { useRef, useState } from 'react'

import { useResumeEditor } from '../../useResumeEditor'
import { createCustomField, RESUME_PHOTO_HEIGHT, RESUME_PHOTO_WIDTH } from '../../constants'
import { updateResume, uploadResumeAvatar } from '../../api'
import { MonthPickerInput } from '../MonthPickerInput'

const AVATAR_ACCEPT = '.jpg,.jpeg,.png,.gif,.webp,image/jpeg,image/png,image/gif,image/webp'
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

export function BasicInfoSection() {
  const { resume, updateBasic, markSaving, markSaved, markError } = useResumeEditor()

  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  if (!resume) return null

  const handleAvatarFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const isImageType = file.type.startsWith('image/')
    const isImageExt = AVATAR_ACCEPT.split(',').some((ext) => file.name.toLowerCase().endsWith(ext.trim()))
    if (!isImageType && !isImageExt) {
      Message.error('仅支持 jpg / jpeg / png / gif / webp 格式')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      Message.error('头像文件不能超过 2MB')
      return
    }
    setUploadingAvatar(true)
    markSaving()
    try {
      const { avatar_url } = await uploadResumeAvatar(resume.id, file)
      const nextResume = { ...resume, basic: { ...resume.basic, photo: avatar_url } }
      updateBasic({ photo: avatar_url })
      await updateResume(nextResume)
      markSaved(nextResume)
      Message.success('头像已上传')
    } catch (err) {
      markError()
      const detail = err instanceof Error ? err.message : '上传失败，请稍后重试'
      Message.error(detail)
    } finally {
      setUploadingAvatar(false)
    }
  }

  const clearAvatar = () => {
    updateBasic({ photo: '' })
  }

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
        <Form.Item label="出生月份">
          <MonthPickerInput
            value={resume.basic.birthDate}
            onChange={(value) => updateBasic({ birthDate: value })}
            placeholder="选择月份"
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
        <Form.Item label="简历头像">
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: RESUME_PHOTO_WIDTH * 0.8,
                height: RESUME_PHOTO_HEIGHT * 0.8,
                borderRadius: 8,
                border: "1px dashed #cbd5e1",
                background: "#f8fafc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flexShrink: 0,
              }}
            >
              {resume.basic.photo ? (
                <img
                  src={resume.basic.photo}
                  alt="头像预览"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <IconCamera style={{ fontSize: 24, color: "#94a3b8" }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              <Input
                value={resume.basic.photo}
                onChange={(value) => updateBasic({ photo: value })}
                placeholder="可粘贴证件照或头像链接，用于模板预览"
              />
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  type="outline"
                  size="mini"
                  icon={<IconCamera />}
                  loading={uploadingAvatar}
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {resume.basic.photo ? "替换头像" : "上传头像"}
                </Button>
                {resume.basic.photo ? (
                  <Button type="text" status="danger" size="mini" icon={<IconDelete />} onClick={clearAvatar}>
                    清空
                  </Button>
                ) : null}
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept={AVATAR_ACCEPT}
                  style={{ display: "none" }}
                  onChange={handleAvatarFile}
                />
              </div>
            </div>
          </div>
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
