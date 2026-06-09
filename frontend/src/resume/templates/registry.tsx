import type { CSSProperties, ReactNode } from 'react'

import type {
  CustomItem,
  ResumeData,
  ResumeTemplateConfig,
  TemplateId,
  TemplateViewModel,
  ViewListItem,
} from '../types'
import { richTextToLines } from '../utils/content'

export const TEMPLATE_REGISTRY: ResumeTemplateConfig[] = [
  {
    id: 'classic',
    name: '经典',
    description: '传统简约的简历布局，适合大多数求职场景。',
    accentColor: '#000000',
    secondaryColor: '#4b5563',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/classic.png',
    layout: 'single',
  },
  {
    id: 'modern',
    name: '现代',
    description: '经典两栏布局，突出个人特色。',
    accentColor: '#000000',
    secondaryColor: '#6b7280',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/modern.png',
    layout: 'split',
  },
  {
    id: 'elegant',
    name: '优雅',
    description: '居中标题单列设计，具有高级感的分隔线。',
    accentColor: '#18181b',
    secondaryColor: '#71717a',
    background: '#ffffff',
    textColor: '#27272a',
    thumbnailSrc: '/resume-template-thumbs/elegant.png',
    layout: 'center',
  },
]

export function getTemplateConfig(templateId: TemplateId) {
  return TEMPLATE_REGISTRY.find((item) => item.id === templateId) ?? TEMPLATE_REGISTRY[0]
}

function mapItems<T extends { visible?: boolean }>(items: T[], mapItem: (item: T) => ViewListItem) {
  return items.filter((item) => item.visible !== false).map(mapItem)
}

function getBasicFieldValue(resume: ResumeData, key: string) {
  const value = resume.basic[key as keyof ResumeData['basic']]
  return typeof value === 'string' ? value.trim() : ''
}

function getContacts(resume: ResumeData) {
  const ordered = (resume.basic.fieldOrder ?? [])
    .filter((field) => field.visible !== false && field.key !== 'name' && field.key !== 'title')
    .map((field) => ({
      key: String(field.key),
      label: field.label,
      value: getBasicFieldValue(resume, String(field.key)),
      custom: false,
    }))
    .filter((field) => field.value)

  const custom = (resume.basic.customFields ?? [])
    .filter((field) => field.visible !== false && field.value.trim())
    .map((field) => ({
      key: field.id,
      label: field.label,
      value: field.displayLabel && field.label ? `${field.label}: ${field.value}` : field.value,
      custom: true,
    }))

  return [...ordered, ...custom]
}

export function buildTemplateViewModel(resume: ResumeData): TemplateViewModel {
  return {
    header: {
      name: resume.basic.name || '未命名简历',
      title: resume.basic.title,
      contacts: getContacts(resume).map((item) => item.value),
    },
    skills: richTextToLines(resume.skillContent),
    education: mapItems(resume.education, (item) => ({
      title: item.school || '学校',
      subtitle: [item.major, item.degree, item.gpa ? `GPA ${item.gpa}` : ''].filter(Boolean).join(' · '),
      meta: [item.startDate, item.endDate].filter(Boolean).join(' - '),
      lines: richTextToLines(item.description ?? ''),
    })),
    experience: mapItems(resume.experience, (item) => ({
      title: item.company || '公司',
      subtitle: item.position,
      meta: item.date,
      lines: richTextToLines(item.details),
    })),
    projects: mapItems(resume.projects, (item) => ({
      title: item.name || '项目',
      subtitle: item.role,
      meta: item.date,
      lines: richTextToLines(item.description),
    })),
    selfEvaluation: richTextToLines(resume.selfEvaluationContent),
  }
}

function ContactIcon({ type }: { type: string }) {
  const paths: Record<string, ReactNode> = {
    email: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </>
    ),
    phone: <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.69 2.8a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.33 1.84.56 2.8.69A2 2 0 0 1 22 16.92Z" />,
    location: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    birthDate: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M16 3v4M8 3v4M3 10h18" />
      </>
    ),
    employementStatus: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </>
    ),
  }

  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ display: 'block', width: 16, height: 16, minWidth: 16, minHeight: 16, flex: '0 0 16px', marginTop: 2 }}
    >
      {paths[type] ?? paths.link}
    </svg>
  )
}

function getContactIcon(key: string): ReactNode {
  return <ContactIcon type={key} />
}

function photoRadius(resume: ResumeData) {
  const config = resume.basic.photoConfig
  if (config.borderRadius === 'full') return 999
  if (config.borderRadius === 'medium') return 8
  if (config.borderRadius === 'custom') return config.customBorderRadius
  return 0
}

function ResumePhoto({ resume }: { resume: ResumeData }) {
  const config = resume.basic.photoConfig
  if (!resume.basic.photo || config.visible === false) return null
  return (
    <img
      src={resume.basic.photo}
      alt={resume.basic.name || '头像'}
      style={{
        display: 'block',
        width: config.width || 90,
        height: config.height || 120,
        borderRadius: photoRadius(resume),
        objectFit: 'cover',
        flex: '0 0 auto',
      }}
    />
  )
}

function ContactFields({ resume, inverse = false, sidebar = false }: { resume: ResumeData; inverse?: boolean; sidebar?: boolean }) {
  const fields = getContacts(resume)
  const useIcons = resume.globalSettings.useIconMode ?? false

  return (
    <div
      style={{
        display: sidebar ? 'flex' : 'grid',
        flexDirection: 'column',
        gridTemplateColumns: sidebar ? undefined : 'repeat(2, minmax(0, 1fr))',
        gap: sidebar ? 8 : '8px 24px',
        width: '100%',
        minWidth: 0,
        color: inverse ? '#ffffff' : '#4b5563',
        fontSize: Math.max(12, (resume.globalSettings.baseFontSize ?? 16) - 3),
      }}
    >
      {fields.map((field) => (
        <div key={field.key} style={{ display: 'flex', alignItems: 'flex-start', gap: useIcons ? 6 : 8, minWidth: 0 }}>
          {useIcons ? getContactIcon(field.key) : !field.custom ? <span style={{ flex: '0 0 auto' }}>{field.label}:</span> : null}
          <span style={{ overflowWrap: 'anywhere', lineHeight: 1.45, textDecoration: field.key === 'email' || field.custom ? 'underline' : undefined }}>
            {field.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function ClassicHeader({ resume, centered = false }: { resume: ResumeData; centered?: boolean }) {
  if (centered) {
    return (
      <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
        <ResumePhoto resume={resume} />
        <div>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.25, fontWeight: 700 }}>{resume.basic.name}</h1>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, lineHeight: 1.5, fontWeight: 400 }}>{resume.basic.title}</h2>
        </div>
        <div style={{ maxWidth: 650 }}>
          <ContactFields resume={resume} />
        </div>
      </section>
    )
  }

  return (
    <section style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, flex: '0 1 42%', minWidth: 0 }}>
        <ResumePhoto resume={resume} />
        <div style={{ minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 30, lineHeight: 1.25, fontWeight: 700 }}>{resume.basic.name}</h1>
          <h2 style={{ margin: '2px 0 0', fontSize: 18, lineHeight: 1.5, fontWeight: 400 }}>{resume.basic.title}</h2>
        </div>
      </div>
      <div style={{ flex: 1, maxWidth: 600 }}>
        <ContactFields resume={resume} />
      </div>
    </section>
  )
}

function ModernHeader({ resume }: { resume: ResumeData }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center' }}>
      <ResumePhoto resume={resume} />
      <div style={{ color: '#ffffff' }}>
        <h1 style={{ margin: 0, color: '#ffffff', fontSize: 30, lineHeight: 1.25, fontWeight: 700 }}>{resume.basic.name}</h1>
        <h2 style={{ margin: '2px 0 0', color: '#ffffff', fontSize: 18, lineHeight: 1.5, fontWeight: 400 }}>{resume.basic.title}</h2>
      </div>
      <ContactFields resume={resume} inverse sidebar />
    </section>
  )
}

function SectionTitle({
  title,
  resume,
  elegant = false,
  inverse = false,
}: {
  title: string
  resume: ResumeData
  elegant?: boolean
  inverse?: boolean
}) {
  const color = inverse ? '#ffffff' : resume.globalSettings.themeColor || '#000000'
  const size = elegant ? resume.globalSettings.headerSize || 20 : resume.globalSettings.headerSize || 18

  if (elegant) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, borderTop: `1px solid ${color}`, opacity: 0.3 }} />
        <h3 style={{ position: 'relative', margin: 0, padding: '0 16px', background: '#ffffff', color, fontSize: size, lineHeight: 1.4, fontWeight: 700 }}>
          {title}
        </h3>
      </div>
    )
  }

  return (
    <h3
      style={{
        margin: 0,
        marginBottom: inverse ? 12 : resume.globalSettings.paragraphSpacing ?? 12,
        paddingBottom: inverse ? 4 : 8,
        borderBottom: `1px solid ${inverse ? 'rgba(255,255,255,.2)' : color}`,
        color,
        fontSize: inverse ? size - 2 : size,
        lineHeight: 1.4,
        fontWeight: 700,
        letterSpacing: inverse ? '0.08em' : undefined,
      }}
    >
      {title}
    </h3>
  )
}

function RichList({ lines, resume, inverse = false }: { lines: string[]; resume: ResumeData; inverse?: boolean }) {
  if (!lines.length) return null
  return (
    <ul
      style={{
        margin: '4px 0 0',
        paddingLeft: '1.45em',
        color: inverse ? 'rgba(255,255,255,.86)' : '#212529',
        fontSize: resume.globalSettings.baseFontSize ?? 14,
        lineHeight: resume.globalSettings.lineHeight ?? 1.6,
      }}
    >
      {lines.map((line, index) => (
        <li key={`${line}-${index}`} style={{ paddingLeft: 2 }}>
          {line}
        </li>
      ))}
    </ul>
  )
}

function Paragraphs({ lines, resume }: { lines: string[]; resume: ResumeData }) {
  if (!lines.length) return null
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        marginTop: 4,
        color: '#212529',
        fontSize: resume.globalSettings.baseFontSize ?? 14,
        lineHeight: resume.globalSettings.lineHeight ?? 1.6,
      }}
    >
      {lines.map((line, index) => (
        <p key={`${line}-${index}`} style={{ margin: 0 }}>
          {line}
        </p>
      ))}
    </div>
  )
}

function EntryList({ items, resume }: { items: ViewListItem[]; resume: ResumeData }) {
  const centerSubtitle = resume.globalSettings.centerSubtitle ?? false
  const subheaderSize = resume.globalSettings.subheaderSize ?? 16
  return (
    <>
      {items.map((item, index) => (
        <article
          key={`${item.title}-${index}`}
          style={{
            marginTop: resume.globalSettings.paragraphSpacing ?? 12,
            breakInside: 'avoid',
            pageBreakInside: 'avoid',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: centerSubtitle ? '1.5fr 1fr 1fr' : '1.5fr 1fr',
              alignItems: 'center',
              gap: 8,
              fontSize: subheaderSize,
              lineHeight: 1.45,
            }}
          >
            <strong>{item.title}</strong>
            {centerSubtitle ? <span>{item.subtitle}</span> : null}
            <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{item.meta}</span>
          </div>
          {!centerSubtitle && item.subtitle ? <div style={{ marginTop: 2, fontSize: subheaderSize }}>{item.subtitle}</div> : null}
          <RichList lines={item.lines} resume={resume} />
        </article>
      ))}
    </>
  )
}

function SidebarEducation({ resume, items }: { resume: ResumeData; items: ViewListItem[] }) {
  if (!items.length) return null
  return (
    <section style={{ marginTop: 24 }}>
      <SectionTitle title="教育经历" resume={resume} inverse />
      {items.map((item, index) => (
        <article key={`${item.title}-${index}`} style={{ marginTop: 12, color: '#ffffff' }}>
          <strong style={{ display: 'block', fontSize: (resume.globalSettings.baseFontSize ?? 14) + 2 }}>{item.title}</strong>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12, opacity: 0.8 }}>{item.meta}</span>
          <span style={{ display: 'block', marginTop: 2, fontSize: 12, opacity: 0.9 }}>{item.subtitle}</span>
          <RichList lines={item.lines} resume={resume} inverse />
        </article>
      ))}
    </section>
  )
}

function CustomEntries({ items, resume }: { items: CustomItem[]; resume: ResumeData }) {
  return (
    <EntryList
      resume={resume}
      items={items.filter((item) => item.visible !== false).map((item) => ({
        title: item.title,
        subtitle: item.subtitle,
        meta: item.dateRange,
        lines: richTextToLines(item.description),
      }))}
    />
  )
}

function StandardSection({
  id,
  title,
  resume,
  model,
  elegant = false,
}: {
  id: string
  title: string
  resume: ResumeData
  model: TemplateViewModel
  elegant?: boolean
}) {
  let content: ReactNode = null
  if (id === 'skills') content = <RichList lines={model.skills} resume={resume} />
  if (id === 'experience') content = <EntryList items={model.experience} resume={resume} />
  if (id === 'projects') content = <EntryList items={model.projects} resume={resume} />
  if (id === 'education') content = <EntryList items={model.education} resume={resume} />
  if (id === 'selfEvaluation') content = <Paragraphs lines={model.selfEvaluation} resume={resume} />
  if (id === 'certificates' && resume.certificates.length) {
    content = (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {resume.certificates.map((certificate) => (
          <img key={certificate.id} src={certificate.url} alt="证书" style={{ width: `${certificate.width}%`, maxWidth: '100%' }} />
        ))}
      </div>
    )
  }
  if (id in resume.customData) content = <CustomEntries items={resume.customData[id]} resume={resume} />
  if (!content) return null

  return (
    <section
      style={{
        marginTop: resume.globalSettings.sectionSpacing ?? 24,
        breakInside: 'avoid',
        pageBreakInside: 'avoid',
      }}
    >
      <SectionTitle title={title} resume={resume} elegant={elegant} />
      {content}
    </section>
  )
}

function enabledSections(resume: ResumeData) {
  return [...resume.menuSections].filter((section) => section.enabled).sort((a, b) => a.order - b.order)
}

function basePageStyle(resume: ResumeData, template: ResumeTemplateConfig): CSSProperties {
  return {
    width: '210mm',
    minWidth: '210mm',
    minHeight: '297mm',
    boxSizing: 'border-box',
    background: template.background,
    color: template.textColor,
    padding: resume.globalSettings.pagePadding ?? 32,
    fontFamily: resume.globalSettings.fontFamily || '"Alibaba PuHuiTi", sans-serif',
    fontSize: resume.globalSettings.baseFontSize ?? 16,
    lineHeight: resume.globalSettings.lineHeight ?? 1.5,
    fontWeight: 400,
    WebkitFontSmoothing: 'antialiased',
    textRendering: 'optimizeLegibility',
    boxShadow: '0 10px 30px rgba(15, 23, 42, 0.10)',
  }
}

export function ResumeTemplatePreview({ resume }: { resume: ResumeData }) {
  const template = getTemplateConfig(resume.templateId)
  const model = buildTemplateViewModel(resume)
  const sections = enabledSections(resume)

  if (resume.templateId === 'modern') {
    const rightSections = sections.filter((section) => section.id !== 'basic' && section.id !== 'education')
    return (
      <div
        data-resume-print-root
        className="resume-document"
        style={{ ...basePageStyle(resume, template), display: 'grid', gridTemplateColumns: '33.333333% 66.666667%', padding: 0, overflow: 'hidden' }}
      >
        <aside style={{ minHeight: '297mm', padding: 16, paddingTop: resume.globalSettings.sectionSpacing ?? 8, background: resume.globalSettings.themeColor || '#000000', color: '#ffffff' }}>
          <ModernHeader resume={resume} />
          <SidebarEducation resume={resume} items={model.education} />
        </aside>
        <main style={{ padding: '0 16px 24px', background: '#ffffff' }}>
          {rightSections.map((section) => (
            <StandardSection key={section.id} id={section.id} title={section.title} resume={resume} model={model} />
          ))}
        </main>
      </div>
    )
  }

  const isElegant = resume.templateId === 'elegant'
  return (
    <div data-resume-print-root className="resume-document" style={basePageStyle(resume, template)}>
      <div style={isElegant ? { width: '100%', maxWidth: 896, margin: '0 auto' } : undefined}>
        {sections.map((section) =>
          section.id === 'basic' ? (
            <ClassicHeader key={section.id} resume={resume} centered={isElegant} />
          ) : (
            <StandardSection key={section.id} id={section.id} title={section.title} resume={resume} model={model} elegant={isElegant} />
          ),
        )}
      </div>
    </div>
  )
}
