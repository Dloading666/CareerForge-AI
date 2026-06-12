import { useState } from 'react'

import { useResumeEditor } from '../useResumeEditor'
import { AiAssistPanel, type AiAssistSection } from './AiAssistPanel'

/**
 * Per-section wrapper that renders the AI assist panel triggered by RichTextEditor's onAiAssist.
 * The host (e.g. ExperienceSection) wraps each editor with this component.
 */
export function FieldAiAssist({
  section,
  value,
  onApply,
  applyLabel,
  jdText,
  children,
}: {
  section: AiAssistSection
  value: string
  onApply: (text: string) => void
  applyLabel?: string
  jdText?: string
  children: (trigger: () => void) => React.ReactNode
}) {
  const { resume } = useResumeEditor()
  const [open, setOpen] = useState(false)
  const resumeId = resume?.id ?? 0
  if (resumeId <= 0) {
    // No resume yet (e.g. loading); just render children without AI trigger.
    return <>{children(() => undefined)}</>
  }
  return (
    <>
      {children(() => setOpen(true))}
      <AiAssistPanel
        visible={open}
        onClose={() => setOpen(false)}
        section={section}
        currentText={value}
        jdText={jdText}
        resumeId={resumeId}
        onApply={onApply}
        applyLabel={applyLabel}
      />
    </>
  )
}
