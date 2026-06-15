import { useEffect, useRef, useState, type RefObject } from 'react'

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

  return (
    <div className="resume-preview-panel" ref={hostRef}>
      <div className="resume-preview-stage">
        <div className="resume-preview-scale" style={{ transform: `scale(${scale})` }}>
          <div ref={previewRef}>
            <ResumeTemplatePreview resume={resume} />
          </div>
        </div>
      </div>
    </div>
  )
}