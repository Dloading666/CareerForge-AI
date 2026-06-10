import { useEffect, useRef, useState, type RefObject } from 'react'

import { useResumeEditor } from '../ResumeEditorContext'
import { ResumeTemplatePreview } from '../templates/registry'
import type { ResumeData } from '../types'

export function PreviewPanel({
  resume,
  previewRef,
}: {
  resume: ResumeData
  previewRef: RefObject<HTMLDivElement | null>
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(0.78)
  const [canvasMode, setCanvasMode] = useState(false)
  const { updateGlobalSettings } = useResumeEditor()

  // drag state stored in a ref to avoid triggering re-renders during drag
  const dragRef = useRef<{
    sectionId: string
    startX: number
    startY: number
    initOffsetX: number
    initOffsetY: number
    el: HTMLElement
  } | null>(null)

  useEffect(() => {
    const node = hostRef.current
    if (!node) return

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (!width) return
      setScale(Math.min(1, Math.max(0.48, (width - 24) / 794)))
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canvasMode) return
    // Find the innermost draggable element — article items take priority over section wrappers
    const target = (e.target as HTMLElement).closest('[data-drag-id]') as HTMLElement | null
    if (!target) return
    const dragId = target.getAttribute('data-drag-id')
    if (!dragId) return
    e.preventDefault()

    const offsets = resume.globalSettings.sectionOffsets ?? {}
    const current = offsets[dragId] ?? { x: 0, y: 0 }

    dragRef.current = {
      sectionId: dragId,
      startX: e.clientX,
      startY: e.clientY,
      initOffsetX: current.x,
      initOffsetY: current.y,
      el: target,
    }
    target.style.zIndex = '50'

    const handleMouseMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const dx = (me.clientX - dragRef.current.startX) / scale
      const dy = (me.clientY - dragRef.current.startY) / scale
      const nx = dragRef.current.initOffsetX + dx
      const ny = dragRef.current.initOffsetY + dy
      dragRef.current.el.style.transform = `translate(${nx}px, ${ny}px)`
    }

    const handleMouseUp = (me: MouseEvent) => {
      if (!dragRef.current) return
      const dx = (me.clientX - dragRef.current.startX) / scale
      const dy = (me.clientY - dragRef.current.startY) / scale
      const nx = dragRef.current.initOffsetX + dx
      const ny = dragRef.current.initOffsetY + dy
      const sid = dragRef.current.sectionId
      dragRef.current.el.style.zIndex = ''
      dragRef.current = null

      const prev = resume.globalSettings.sectionOffsets ?? {}
      updateGlobalSettings({ sectionOffsets: { ...prev, [sid]: { x: nx, y: ny } } })

      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <div className="resume-preview-panel" ref={hostRef}>
      <div className="preview-panel-toolbar">
        <button
          type="button"
          className={`canvas-mode-btn${canvasMode ? ' active' : ''}`}
          onClick={() => setCanvasMode((v) => !v)}
          title={canvasMode ? '退出画布模式' : '开启画布模式（自由拖拽各内容块位置）'}
        >
          {canvasMode ? '🖱️ 画布模式（点击退出）' : '🖱️ 画布模式'}
        </button>
        {canvasMode && (
          <button
            type="button"
            className="canvas-reset-btn"
            onClick={() => updateGlobalSettings({ sectionOffsets: {} })}
            title="将所有内容块复位至默认位置"
          >
            重置位置
          </button>
        )}
      </div>
      <div
        className={`resume-preview-stage${canvasMode ? ' canvas-mode' : ''}`}
        onMouseDown={handleMouseDown}
      >
        <div className="resume-preview-scale" style={{ transform: `scale(${scale})` }}>
          <div ref={previewRef}>
            <ResumeTemplatePreview resume={resume} />
          </div>
        </div>
      </div>
    </div>
  )
}
