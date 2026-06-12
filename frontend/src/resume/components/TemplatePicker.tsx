import { Button, Drawer, Typography } from '@arco-design/web-react'
import { motion } from 'framer-motion'

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
    <Drawer
      visible={visible}
      title="切换简历模板"
      footer={null}
      onCancel={onClose}
      placement="left"
      width={980}
      className="resume-template-drawer"
    >
      <div className="resume-template-drawer-head">
        <div>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            选择模板
          </Typography.Title>
          <Typography.Paragraph style={{ margin: '8px 0 0', color: '#6b7280' }}>
            直接按 `magic-resume` 的模板切换体验来做，先看整页缩略图，再决定是否切换。
          </Typography.Paragraph>
        </div>
      </div>

      <div className="resume-template-grid workbench">
        {TEMPLATE_REGISTRY.map((template) => {
          const active = template.id === value
          const isBlank = template.id === 'blank'
          return (
            <motion.button
              key={template.id}
              type="button"
              className={`resume-template-card${active ? ' active' : ''}${isBlank ? ' is-blank' : ''}`}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.26 }}
              whileHover={{ y: -4, scale: 1.01 }}
              whileTap={{ scale: 0.985 }}
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
            </motion.button>
          )
        })}
      </div>
    </Drawer>
  )
}
