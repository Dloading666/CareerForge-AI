import type { ResumeSectionId } from '../types'

export function SectionNav({
  sections,
  activeSection,
  onChange,
}: {
  sections: Array<{ id: ResumeSectionId; title: string; icon: string; enabled: boolean; order: number }>
  activeSection: ResumeSectionId
  onChange: (section: ResumeSectionId) => void
}) {
  return (
    <aside className="resume-editor-nav">
      {sections
        .filter((section) => section.enabled)
        .sort((a, b) => a.order - b.order)
        .map((section) => (
          <button
            key={section.id}
            type="button"
            className={`resume-editor-nav-item${activeSection === section.id ? ' active' : ''}`}
            onClick={() => onChange(section.id)}
          >
            <span>{section.icon}</span>
            <span>{section.title}</span>
          </button>
        ))}
    </aside>
  )
}
