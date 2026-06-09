import { Button, Input, Switch, Tag } from '@arco-design/web-react'
import { IconArrowLeft, IconExport, IconSave, IconSelectAll } from '@arco-design/web-react/icon'
import { TEMPLATE_LABELS } from '../constants'
import type { TemplateId } from '../types'

export function ResumeToolbar({
  title,
  templateId,
  visibility,
  saveStatus,
  onBack,
  onTitleChange,
  onVisibilityChange,
  onOpenTemplatePicker,
  onExport,
  onSave,
}: {
  title: string
  templateId: TemplateId
  visibility: boolean
  saveStatus: 'idle' | 'saving' | 'saved' | 'error'
  onBack: () => void
  onTitleChange: (value: string) => void
  onVisibilityChange: (checked: boolean) => void
  onOpenTemplatePicker: () => void
  onExport: () => void
  onSave: () => void
}) {
  const saveLabel =
    saveStatus === 'saving' ? '保存中...' : saveStatus === 'saved' ? '已保存' : saveStatus === 'error' ? '保存失败' : '未保存'

  return (
    <div className="resume-toolbar">
      <div className="resume-toolbar-left">
        <Button type="text" icon={<IconArrowLeft />} onClick={onBack}>
          返回
        </Button>
        <Input
          value={title}
          onChange={onTitleChange}
          placeholder="输入简历标题"
          style={{ width: 240 }}
        />
        <Tag color="purple">模板：{TEMPLATE_LABELS[templateId]}</Tag>
        <Tag color={saveStatus === 'error' ? 'red' : saveStatus === 'saved' ? 'green' : 'arcoblue'}>{saveLabel}</Tag>
      </div>

      <div className="resume-toolbar-right">
        <span className="resume-toolbar-switch">
          智能体可读取
          <Switch checked={visibility} onChange={onVisibilityChange} />
        </span>
        <Button icon={<IconSelectAll />} onClick={onOpenTemplatePicker}>
          切换模板
        </Button>
        <Button icon={<IconExport />} onClick={onExport}>
          导出 PDF
        </Button>
        <Button type="primary" icon={<IconSave />} onClick={onSave}>
          保存
        </Button>
      </div>
    </div>
  )
}
