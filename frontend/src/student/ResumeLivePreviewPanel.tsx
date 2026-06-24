import { useEffect, useRef, useState } from 'react'

import { IconEdit, IconClose } from '@arco-design/web-react/icon'
import { Spin } from '@arco-design/web-react'

import { ResumeTemplatePreview } from '../resume/templates/registry'
import type { ResumeData } from '../resume/types'

/**
 * 简历助手右侧实时预览面板。
 *
 * 只读展示当前工作简历，复用简历中心的同一套渲染组件（ResumeTemplatePreview）。
 * 当 AI 在对话中生成/优化/更新简历时，父组件会用最新的 ResumeData 重新渲染本面板，
 * 实现「右侧简历随 AI 操作实时变化」的效果。
 */
export function ResumeLivePreviewPanel({
  resume,
  loading,
  resumeTitle,
  onOpenEditor,
  onClose,
}: {
  resume: ResumeData | null
  loading: boolean
  resumeTitle: string
  onOpenEditor: () => void
  onClose: () => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0.5)

  // 根据预览窗宽度自适应缩放（A4 宽度 794px 为基准）
  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (!width) return
      setScale(Math.min(1, Math.max(0.34, (width - 16) / 794)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="resume-live-preview">
      <div className="resume-live-preview-header">
        <span className="resume-live-preview-title" title={resumeTitle}>
          {resumeTitle || '简历预览'}
        </span>
        <div className="resume-live-preview-actions">
          <button
            type="button"
            className="resume-live-preview-btn"
            onClick={onOpenEditor}
            title="在简历中心编辑"
          >
            <IconEdit />
            <span>编辑</span>
          </button>
          <button
            type="button"
            className="resume-live-preview-btn icon-only"
            onClick={onClose}
            title="收起预览"
            aria-label="收起预览"
          >
            <IconClose />
          </button>
        </div>
      </div>

      <div className="resume-live-preview-body" ref={hostRef}>
        {loading && (
          <div className="resume-live-preview-loading">
            <Spin tip="正在加载简历…" />
          </div>
        )}
        {!loading && !resume && (
          <div className="resume-live-preview-empty">暂无简历内容</div>
        )}
        {!loading && resume && (
          <div className="resume-live-preview-stage">
            <div className="resume-live-preview-scale" style={{ transform: `scale(${scale})` }}>
              <ResumeTemplatePreview resume={resume} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
