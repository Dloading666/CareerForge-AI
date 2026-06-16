import { Select, Slider } from '@arco-design/web-react'
import { Reorder, useDragControls } from 'framer-motion'

import { useResumeEditor } from '../useResumeEditor'
import type { MenuSection, ResumeSectionId } from '../types'

const FONT_OPTIONS = [
  { label: '阿里巴巴普惠体', value: '"Alibaba PuHuiTi", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif' },
  { label: '苹方/微软雅黑', value: '"PingFang SC", "Microsoft YaHei", -apple-system, BlinkMacSystemFont, sans-serif' },
  { label: '思源黑体', value: '"Source Han Sans SC", "Noto Sans SC", -apple-system, sans-serif' },
  { label: '宋体', value: 'SimSun, "Songti SC", "Source Han Serif SC", serif' },
  { label: '等宽', value: 'ui-monospace, "SF Mono", Monaco, Consolas, "Liberation Mono", monospace' },
]

const PRESET_COLORS = [
  '#000000', '#0f172a', '#1e40af', '#0369a1',
  '#065f46', '#7c2d12', '#6b21a8', '#9f1239',
]

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="7" r="1.5" /><circle cx="15" cy="7" r="1.5" />
      <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="17" r="1.5" /><circle cx="15" cy="17" r="1.5" />
    </svg>
  )
}

function EyeOnIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOffIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  )
}

function DraggableItem({
  section,
  isActive,
  onActivate,
  onToggle,
}: {
  section: MenuSection
  isActive: boolean
  onActivate: (id: ResumeSectionId) => void
  onToggle: (id: string) => void
}) {
  const dragControls = useDragControls()

  return (
    <Reorder.Item
      value={section}
      dragListener={false}
      dragControls={dragControls}
      className={`wb-layout-item${isActive ? ' active' : ''}${!section.enabled ? ' hidden-section' : ''}`}
      style={{ listStyle: 'none' }}
    >
      <span className="wb-drag-handle" onPointerDown={(e) => dragControls.start(e)}>
        <GripIcon />
      </span>
      <button type="button" className="wb-section-button" onClick={() => onActivate(section.id)}>
        <span className="wb-section-icon">{section.icon}</span>
        <span className="wb-section-title">{section.title}</span>
      </button>
      <button
        type="button"
        className={`wb-eye-button${!section.enabled ? ' off' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggle(section.id) }}
      >
        {section.enabled ? <EyeOnIcon /> : <EyeOffIcon />}
      </button>
    </Reorder.Item>
  )
}

export function SidePanel() {
  const { resume, activeSection, setActiveSection, toggleSectionVisibility, reorderSections, updateGlobalSettings } = useResumeEditor()
  if (!resume) return null

  const { menuSections, globalSettings } = resume
  const sorted = [...menuSections].sort((a, b) => a.order - b.order)
  const basicSection = sorted.find((s) => s.id === 'basic')
  const draggable = sorted.filter((s) => s.id !== 'basic')

  return (
    <div className="wb-side-inner">
      {/* 布局 */}
      <div className="wb-setting-card">
        <div className="wb-setting-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="10" rx="1" /><rect x="14" y="17" width="7" height="4" rx="1" />
          </svg>
          <span>布局</span>
        </div>
        <div className="wb-layout-list">
          {basicSection && (
            <div
              className={`wb-layout-item${activeSection === 'basic' ? ' active' : ''}${!basicSection.enabled ? ' hidden-section' : ''}`}
              onClick={() => setActiveSection('basic')}
            >
              <span style={{ width: 28, flexShrink: 0 }} />
              <button type="button" className="wb-section-button">
                <span className="wb-section-icon">{basicSection.icon}</span>
                <span className="wb-section-title">{basicSection.title}</span>
              </button>
              <button
                type="button"
                className={`wb-eye-button${!basicSection.enabled ? ' off' : ''}`}
                onClick={(e) => { e.stopPropagation(); toggleSectionVisibility('basic') }}
              >
                {basicSection.enabled ? <EyeOnIcon /> : <EyeOffIcon />}
              </button>
            </div>
          )}
          <Reorder.Group
            axis="y"
            values={draggable}
            onReorder={(newOrder) => {
              const basic = menuSections.find((s) => s.id === 'basic')
              reorderSections([...(basic ? [basic] : []), ...newOrder])
            }}
            style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}
          >
            {draggable.map((section) => (
              <DraggableItem
                key={section.id}
                section={section}
                isActive={activeSection === section.id}
                onActivate={setActiveSection}
                onToggle={toggleSectionVisibility}
              />
            ))}
          </Reorder.Group>
        </div>
      </div>

      {/* 主题色 */}
      <div className="wb-setting-card">
        <div className="wb-setting-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="13.5" cy="6.5" r="2.5" /><circle cx="19" cy="14" r="2" /><circle cx="6" cy="14" r="2" />
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10c1.1 0 2-.9 2-2v-.5c0-.55-.22-1.05-.59-1.41a.996.996 0 0 1 0-1.18c.37-.36.59-.86.59-1.41V15c0-1.1.9-2 2-2h1.5c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8z" />
          </svg>
          <span style={{ flex: 1 }}>主题颜色</span>
          <input
            type="color"
            className="wb-color-custom-input"
            value={globalSettings.themeColor ?? '#000000'}
            onChange={(e) => updateGlobalSettings({ themeColor: e.target.value })}
            title="自定义颜色"
          />
        </div>
        <div className="wb-color-grid">
          {PRESET_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`wb-color-swatch${globalSettings.themeColor === color ? ' active' : ''}`}
              style={{ background: color }}
              onClick={() => updateGlobalSettings({ themeColor: color })}
            />
          ))}
        </div>
      </div>

      {/* 排版 */}
      <div className="wb-setting-card">
        <div className="wb-setting-card-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
            <polyline points="4 7 4 4 20 4 20 7" /><line x1="9" y1="20" x2="15" y2="20" /><line x1="12" y1="4" x2="12" y2="20" />
          </svg>
          <span>排版</span>
        </div>
        <div className="wb-setting-rows">
          <div className="wb-setting-row">
            <div className="wb-setting-row-top">
              <span className="wb-setting-row-label">字体</span>
              <Select
                size="mini"
                style={{ width: 140 }}
                value={globalSettings.fontFamily || FONT_OPTIONS[0].value}
                onChange={(val) => updateGlobalSettings({ fontFamily: val })}
              >
                {FONT_OPTIONS.map((o) => (
                  <Select.Option key={o.value} value={o.value}>
                    <span style={{ fontFamily: o.value }}>{o.label}</span>
                  </Select.Option>
                ))}
              </Select>
            </div>
          </div>
          <div className="wb-setting-row">
            <div className="wb-setting-row-top">
              <span className="wb-setting-row-label">字号</span>
              <span className="wb-setting-value">{globalSettings.baseFontSize ?? 16}px</span>
            </div>
            <Slider value={globalSettings.baseFontSize ?? 16} min={12} max={20} step={1} onChange={(val) => updateGlobalSettings({ baseFontSize: val as number })} />
          </div>
          <div className="wb-setting-row">
            <div className="wb-setting-row-top">
              <span className="wb-setting-row-label">行高</span>
              <span className="wb-setting-value">{(globalSettings.lineHeight ?? 1.5).toFixed(1)}</span>
            </div>
            <Slider value={globalSettings.lineHeight ?? 1.5} min={1.0} max={2.0} step={0.1} onChange={(val) => updateGlobalSettings({ lineHeight: val as number })} />
          </div>
          <div className="wb-setting-row">
            <div className="wb-setting-row-top">
              <span className="wb-setting-row-label">页边距</span>
              <span className="wb-setting-value">{globalSettings.pagePadding ?? 32}px</span>
            </div>
            <Slider value={globalSettings.pagePadding ?? 32} min={0} max={60} step={4} onChange={(val) => updateGlobalSettings({ pagePadding: val as number })} />
          </div>
        </div>
      </div>
    </div>
  )
}
