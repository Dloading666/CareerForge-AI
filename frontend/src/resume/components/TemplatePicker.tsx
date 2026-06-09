import { Button, Modal, Typography } from '@arco-design/web-react'

import { TEMPLATE_REGISTRY } from '../templates/registry'
import type { TemplateId } from '../types'

export function TemplatePicker({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean
  value: TemplateId
  onChange: (templateId: TemplateId) => void
  onClose: () => void
}) {
  return (
    <Modal visible={visible} title="选择简历模板" footer={null} onCancel={onClose} style={{ width: 760 }}>
      <div className="resume-template-grid">
        {TEMPLATE_REGISTRY.map((template) => {
          const active = template.id === value
          return (
            <button
              key={template.id}
              type="button"
              className={`resume-template-card${active ? ' active' : ''}`}
              onClick={() => {
                onChange(template.id)
                onClose()
              }}
            >
              <div className="resume-template-thumb">
                <img src={template.thumbnailSrc} alt={template.name} className="resume-template-thumb-image" />
              </div>
              <Typography.Title heading={6} style={{ margin: '12px 0 6px' }}>
                {template.name}
              </Typography.Title>
              <Typography.Paragraph style={{ margin: 0, color: '#6b7280', fontSize: 13 }}>
                {template.description}
              </Typography.Paragraph>
              <Button type={active ? 'primary' : 'outline'} size="small" style={{ marginTop: 14 }}>
                {active ? '当前模板' : '使用此模板'}
              </Button>
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
