import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'

import type {
  CustomItem,
  ResumeData,
  ResumeTemplateConfig,
  TemplateId,
  TemplateViewModel,
  ViewListItem,
} from '../types'
import { RESUME_PHOTO_HEIGHT, RESUME_PHOTO_WIDTH } from '../constants'
import { richTextToInlineBlocks, type RichInlineBlock } from '../utils/content'
import { formatResumeDateRange, formatResumeDateText } from '../utils/dateFormat'

export const TEMPLATE_REGISTRY: ResumeTemplateConfig[] = [
  {
    id: 'blank',
    name: '空白模板',
    description: '不使用任何样式，从零开始编辑。',
    accentColor: '#000000',
    secondaryColor: '#6b7280',
    background: '#ffffff',
    textColor: '#000000',
    thumbnailSrc: '/resume-template-thumbs/blank.png',
    layout: 'single',
  },
  {
    id: 'classic',
    name: '经典模板',
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
    name: '两栏布局',
    description: '经典两栏，突出个人特色。',
    accentColor: '#000000',
    secondaryColor: '#6b7280',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/modern.png',
    layout: 'split',
  },
  {
    id: 'left-right',
    name: '模块标题背景色',
    description: '模块标题背景鲜明，突出美观特色。',
    accentColor: '#2563eb',
    secondaryColor: '#9ca3af',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/left-right.png',
    layout: 'single',
  },
  {
    id: 'timeline',
    name: '时间轴布局',
    description: '时间线布局，突出经历的时间顺序。',
    accentColor: '#18181b',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#212529',
    thumbnailSrc: '/resume-template-thumbs/timeline.png',
    layout: 'single',
  },
  {
    id: 'minimalist',
    name: '极简模板',
    description: '大面积留白，干净纯粹的排版风格。',
    accentColor: '#171717',
    secondaryColor: '#737373',
    background: '#ffffff',
    textColor: '#171717',
    thumbnailSrc: '/resume-template-thumbs/minimalist.png',
    layout: 'center',
  },
  {
    id: 'elegant',
    name: '优雅模板',
    description: '居中标题单列设计，具有高级感的分隔线。',
    accentColor: '#18181b',
    secondaryColor: '#71717a',
    background: '#ffffff',
    textColor: '#27272a',
    thumbnailSrc: '/resume-template-thumbs/elegant.png',
    layout: 'center',
  },
  {
    id: 'creative',
    name: '创意模板',
    description: '视觉错落设计，灵动活泼展现个性。',
    accentColor: '#7c3aed',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#1e293b',
    thumbnailSrc: '/resume-template-thumbs/creative.png',
    layout: 'single',
  },
  {
    id: 'editorial',
    name: '画报风',
    description: '高端画报风，精美衬线体与专属侧边时光轴设计。',
    accentColor: '#000000',
    secondaryColor: '#666666',
    background: '#ffffff',
    textColor: '#1a1a1a',
    thumbnailSrc: '/resume-template-thumbs/editorial.png',
    layout: 'single',
  },
  {
    id: 'swiss',
    name: '瑞士美学',
    description: '包豪斯国际排版，超粗字重对比与几何色块点缀。',
    accentColor: '#E31C24',
    secondaryColor: '#64748b',
    background: '#ffffff',
    textColor: '#0f172a',
    thumbnailSrc: '/resume-template-thumbs/swiss.png',
    layout: 'single',
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

export function getContacts(resume: ResumeData) {
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
    skills: richTextToInlineBlocks(resume.skillContent),
    education: mapItems(resume.education, (item) => ({
      itemId: item.id,
      title: item.school || '学校',
      subtitle: [item.major, item.degree, item.gpa ? `GPA ${item.gpa}` : ''].filter(Boolean).join(' · '),
      meta: formatResumeDateRange(item.startDate, item.endDate),
      blocks: richTextToInlineBlocks(item.description ?? ''),
    })),
    experience: mapItems(resume.experience, (item) => ({
      itemId: item.id,
      title: item.company || '公司',
      subtitle: item.position,
      meta: formatResumeDateText(item.date),
      blocks: richTextToInlineBlocks(item.details),
    })),
    projects: mapItems(resume.projects, (item) => ({
      itemId: item.id,
      title: item.name || '项目',
      subtitle: item.role,
      meta: formatResumeDateText(item.date),
      blocks: richTextToInlineBlocks(item.description),
    })),
    selfEvaluation: richTextToInlineBlocks(resume.selfEvaluationContent),
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
  const [failed, setFailed] = useState(false)
  if (!resume.basic.photo || config.visible === false || failed) return null
  return (
    <img
      src={resume.basic.photo}
      alt={resume.basic.name || '头像'}
      onError={() => setFailed(true)}
      style={{
        display: 'block',
        width: RESUME_PHOTO_WIDTH,
        height: RESUME_PHOTO_HEIGHT,
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

type TitleVariant = 'classic' | 'elegant' | 'left-right' | 'minimalist' | 'creative' | 'editorial' | 'swiss' | 'timeline'

/** Creative template: header on colored background, text all white */
function ClassicHeaderInverse({ resume }: { resume: ResumeData }) {
  const basicFontSize = resume.globalSettings.baseFontSize ?? 16
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <ResumePhoto resume={resume} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.25, fontWeight: 700, color: '#ffffff' }}>{resume.basic.name}</h1>
        <h2 style={{ margin: '4px 0 8px', fontSize: 16, lineHeight: 1.5, fontWeight: 400, color: 'rgba(255,255,255,.85)' }}>{resume.basic.title}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', fontSize: Math.max(12, basicFontSize - 3), color: 'rgba(255,255,255,.8)' }}>
          {getContacts(resume).map((f) => (
            <span key={f.key}>{f.value}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Editorial template: large name + divider bar header */
function EditorialHeader({ resume }: { resume: ResumeData }) {
  const themeColor = resume.globalSettings.themeColor || '#000000'
  return (
    <div style={{ marginBottom: resume.globalSettings.sectionSpacing ?? 32 }}>
      <h1 style={{ margin: 0, fontSize: 44, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.02em', color: '#1a1a1a' }}>
        {resume.basic.name || '姓名'}
      </h1>
      {resume.basic.title && (
        <h2 style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 400, color: themeColor, letterSpacing: '0.04em' }}>
          {resume.basic.title}
        </h2>
      )}
      <div
        style={{
          margin: '14px 0 10px',
          height: 3,
          background: `linear-gradient(90deg, ${themeColor} 0%, transparent 100%)`,
        }}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 20px', fontSize: 13, color: '#555' }}>
        {getContacts(resume).map((f) => (
          <span key={f.key}>{f.value}</span>
        ))}
      </div>
    </div>
  )
}

function SectionTitle({
  title,
  resume,
  variant = 'classic',
  inverse = false,
}: {
  title: string
  resume: ResumeData
  variant?: TitleVariant
  inverse?: boolean
}) {
  const color = inverse ? '#ffffff' : resume.globalSettings.themeColor || '#000000'
  const size = resume.globalSettings.headerSize || 18
  const paragraphSpacing = resume.globalSettings.paragraphSpacing ?? 12

  if (inverse) {
    return (
      <h3
        style={{
          margin: 0,
          marginBottom: 12,
          paddingBottom: 4,
          borderBottom: '1px solid rgba(255,255,255,.2)',
          color: '#ffffff',
          fontSize: size - 2,
          lineHeight: 1.4,
          fontWeight: 700,
          letterSpacing: '0.08em',
        }}
      >
        {title}
      </h3>
    )
  }

  if (variant === 'elegant') {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
        <div style={{ position: 'absolute', left: 0, right: 0, borderTop: `1px solid ${color}`, opacity: 0.3 }} />
        <h3 style={{ position: 'relative', margin: 0, padding: '0 16px', background: '#ffffff', color, fontSize: size + 2, lineHeight: 1.4, fontWeight: 700 }}>
          {title}
        </h3>
      </div>
    )
  }

  if (variant === 'left-right') {
    return (
      <div style={{ position: 'relative', marginBottom: paragraphSpacing }}>
        <div style={{ position: 'absolute', inset: 0, background: color, opacity: 0.08, borderRadius: 2 }} />
        <h3
          style={{
            position: 'relative',
            margin: 0,
            padding: '6px 12px 6px 16px',
            borderLeft: `3px solid ${color}`,
            color,
            fontSize: size,
            lineHeight: 1.4,
            fontWeight: 700,
          }}
        >
          {title}
        </h3>
      </div>
    )
  }

  if (variant === 'minimalist') {
    return (
      <h3
        style={{
          margin: 0,
          marginBottom: paragraphSpacing,
          color,
          fontSize: Math.max(12, size - 2),
          lineHeight: 1.4,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </h3>
    )
  }

  if (variant === 'creative') {
    return (
      <h3
        style={{
          display: 'inline-block',
          margin: 0,
          marginBottom: paragraphSpacing,
          padding: '4px 12px',
          borderRadius: 6,
          background: color,
          color: '#ffffff',
          fontSize: size,
          lineHeight: 1.4,
          fontWeight: 700,
        }}
      >
        {title}
      </h3>
    )
  }

  if (variant === 'editorial') {
    return (
      <div style={{ marginBottom: paragraphSpacing }}>
        <h3
          style={{
            margin: 0,
            color: color || '#8e8e8e',
            fontSize: Math.max(11, size - 2),
            lineHeight: 1.4,
            fontWeight: 700,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
          }}
        >
          {title}
        </h3>
      </div>
    )
  }

  if (variant === 'swiss') {
    return (
      <div style={{ marginBottom: paragraphSpacing }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 6,
              height: size * 1.1,
              background: color,
              borderRadius: 2,
              flexShrink: 0,
            }}
          />
          <h3
            style={{
              margin: 0,
              fontSize: size,
              fontWeight: 900,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#0f172a',
            }}
          >
            {title}
          </h3>
        </div>
        <div style={{ height: 1, background: '#0f172a', opacity: 0.15, marginTop: 8 }} />
      </div>
    )
  }

  // default classic
  return (
    <h3
      style={{
        margin: 0,
        marginBottom: paragraphSpacing,
        paddingBottom: 8,
        borderBottom: `1px solid ${color}`,
        color,
        fontSize: size,
        lineHeight: 1.4,
        fontWeight: 700,
      }}
    >
      {title}
    </h3>
  )
}

function RichList({ blocks, resume, inverse = false }: { blocks: RichInlineBlock[]; resume: ResumeData; inverse?: boolean }) {
  // Render bullet/ordered lists AND any free-text paragraph lines.
  // The paragraph fallback keeps legacy plain-text skill content visible
  // (e.g. a single line "Java, Python" still renders as a bullet item).
  const listBlocks = blocks.filter((b) => b.type === 'bullet' || b.type === 'ordered')
  const paraLines = blocks.filter((b) => b.type === 'paragraph').flatMap((b) => b.lines)
  if (!listBlocks.length && !paraLines.length) return null
  const baseColor = inverse ? 'rgba(255,255,255,.86)' : '#212529'
  const fontSize = resume.globalSettings.baseFontSize ?? 14
  const lineHeight = resume.globalSettings.lineHeight ?? 1.6
  return (
    <div style={{ marginTop: 4 }}>
      {listBlocks.map((block, idx) => {
        const Tag = block.type === 'ordered' ? 'ol' : 'ul'
        return (
          <Tag
            // eslint-disable-next-line react/no-array-index-key
            key={`${block.type}-${idx}`}
            style={{
              margin: '4px 0 0',
              paddingLeft: '1.45em',
              color: baseColor,
              fontSize,
              lineHeight,
            }}
          >
            {block.lines.map((line, index) => (
              <li key={`${line}-${index}`} style={{ paddingLeft: 2 }}>
                <span dangerouslySetInnerHTML={{ __html: line }} />
              </li>
            ))}
          </Tag>
        )
      })}
      {paraLines.length > 0 ? (
        // Paragraph fallback: render as plain text blocks (NO bullet points)
        // so the preview matches what the user sees in the editor when they
        // haven't explicitly used list syntax (e.g. typed free-text skills).
        <div
          style={{
            margin: '4px 0 0',
            color: baseColor,
            fontSize,
            lineHeight,
            whiteSpace: 'pre-wrap',
          }}
        >
          {paraLines.map((line, index) => (
            <p
              key={`para-${line}-${index}`}
              style={{ margin: 0 }}
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Paragraphs({ blocks, resume }: { blocks: RichInlineBlock[]; resume: ResumeData }) {
  const paragraphs = blocks.filter((b) => b.type === 'paragraph')
  if (!paragraphs.length) return null
  // Flatten back to one line per paragraph (each block may have multiple lines)
  const lines = paragraphs.flatMap((b) => b.lines)
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
          <span dangerouslySetInnerHTML={{ __html: line }} />
        </p>
      ))}
    </div>
  )
}

function MixedBlocks({ blocks, resume }: { blocks: RichInlineBlock[]; resume: ResumeData }) {
  // Render an arbitrary mix of paragraph / bullet / ordered blocks in order.
  if (!blocks.length) return null
  const baseStyle: CSSProperties = {
    color: '#212529',
    fontSize: resume.globalSettings.baseFontSize ?? 14,
    lineHeight: resume.globalSettings.lineHeight ?? 1.6,
  }
  return (
    <div style={{ marginTop: 4 }}>
      {blocks.map((block, idx) => {
        if (block.type === 'paragraph') {
          return (
            <div
              // eslint-disable-next-line react/no-array-index-key
              key={`p-${idx}`}
              style={{ ...baseStyle, marginBottom: 4 }}
            >
              {block.lines.map((line, j) => (
                <p
                  // eslint-disable-next-line react/no-array-index-key
                  key={`p-${idx}-${j}`}
                  style={{ margin: 0 }}
                >
                  <span dangerouslySetInnerHTML={{ __html: line }} />
                </p>
              ))}
            </div>
          )
        }
        const Tag = block.type === 'ordered' ? 'ol' : 'ul'
        return (
          <Tag
            // eslint-disable-next-line react/no-array-index-key
            key={`${block.type}-${idx}`}
            style={{
              ...baseStyle,
              margin: '4px 0',
              paddingLeft: '1.45em',
            }}
          >
            {block.lines.map((line, j) => (
              <li key={`${line}-${j}`} style={{ paddingLeft: 2 }}>
                <span dangerouslySetInnerHTML={{ __html: line }} />
              </li>
            ))}
          </Tag>
        )
      })}
    </div>
  )
}

function EntryList({
  items,
  resume,
}: {
  items: ViewListItem[]
  resume: ResumeData
}) {
  const centerSubtitle = resume.globalSettings.centerSubtitle ?? false
  const subheaderSize = resume.globalSettings.subheaderSize ?? 16
  return (
    <>
      {items.map((item, index) => {
        return (
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
            <MixedBlocks blocks={item.blocks} resume={resume} />
          </article>
        )
      })}
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
          <RichList blocks={item.blocks} resume={resume} inverse />
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
        blocks: richTextToInlineBlocks(item.description),
      }))}
    />
  )
}

function StandardSection({
  id,
  title,
  resume,
  model,
  variant = 'classic',
}: {
  id: string
  title: string
  resume: ResumeData
  model: TemplateViewModel
  variant?: TitleVariant
}) {
  let content: ReactNode = null
  if (id === 'skills') content = <RichList blocks={model.skills} resume={resume} />
  if (id === 'experience') content = <EntryList items={model.experience} resume={resume} />
  if (id === 'projects') content = <EntryList items={model.projects} resume={resume} />
  if (id === 'education') content = <EntryList items={model.education} resume={resume} />
  if (id === 'selfEvaluation') content = <Paragraphs blocks={model.selfEvaluation} resume={resume} />
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
      <SectionTitle title={title} resume={resume} variant={variant} />
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
  const themeColor = resume.globalSettings.themeColor || '#000000'

  // ── modern: two-column with dark sidebar ──────────────────────────────
  // ── blank: no template chrome, plain section headers stacked ───────────────────────────────
  if (resume.templateId === 'blank') {
    const blankSectionTitle = (id: string, fallback: string) => {
      const sec = sections.find((s) => s.id === id)
      return sec?.title || fallback
    }
    const base = basePageStyle(resume, template)
    const sectionTitleStyle: CSSProperties = {
      fontSize: 15,
      fontWeight: 600,
      color: '#111827',
      margin: '18px 0 8px',
      paddingBottom: 4,
      borderBottom: '1px solid #e5e7eb',
    }
    const renderLines = (blocks: RichInlineBlock[]) => {
      if (!blocks.length) return null
      return blocks.map((block, i) => {
        if (block.type === 'paragraph') {
          return (
            <div key={`p-${i}`} style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 2 }}>
              {block.lines.map((line, j) => (
                <div key={`p-${i}-${j}`}>
                  <span dangerouslySetInnerHTML={{ __html: line }} />
                </div>
              ))}
            </div>
          )
        }
        const Tag = block.type === 'ordered' ? 'ol' : 'ul'
        return (
          <Tag key={`${block.type}-${i}`} style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, marginBottom: 2, paddingLeft: 18 }}>
            {block.lines.map((line, j) => (
              <li key={`${line}-${j}`}>
                <span dangerouslySetInnerHTML={{ __html: line }} />
              </li>
            ))}
          </Tag>
        )
      })
    }
    const renderItem = (it: typeof model.experience[number]) => (
      <div key={it.itemId} style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>
          {it.title}
          {it.meta ? <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 8 }}>{it.meta}</span> : null}
        </div>
        {it.subtitle ? <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>{it.subtitle}</div> : null}
        {renderLines(it.blocks)}
      </div>
    )
    return (
      <div data-resume-print-root className="resume-document" style={base}>
        <div >
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
            {model.header.name || '未命名简历'}
          </div>
          {model.header.title ? (
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 6 }}>{model.header.title}</div>
          ) : null}
          {model.header.contacts.length > 0 ? (
            <div style={{ fontSize: 12, color: '#6b7280' }}>{model.header.contacts.join('  ·  ')}</div>
          ) : null}
        </div>
        <div >
          <div style={sectionTitleStyle}>{blankSectionTitle('skills', '专业技能')}</div>
          {renderLines(model.skills)}
        </div>
        <div >
          <div style={sectionTitleStyle}>{blankSectionTitle('experience', '工作经历')}</div>
          {model.experience.map(renderItem)}
        </div>
        <div >
          <div style={sectionTitleStyle}>{blankSectionTitle('projects', '项目经历')}</div>
          {model.projects.map(renderItem)}
        </div>
        <div >
          <div style={sectionTitleStyle}>{blankSectionTitle('education', '教育经历')}</div>
          {model.education.map(renderItem)}
        </div>
        <div >
          <div style={sectionTitleStyle}>{blankSectionTitle('selfEvaluation', '自我评价')}</div>
          {renderLines(model.selfEvaluation)}
        </div>
      </div>
    )
  }

  if (resume.templateId === 'modern') {
    const rightSections = sections.filter((s) => s.id !== 'basic' && s.id !== 'education')
    return (
      <div
        data-resume-print-root
        className="resume-document"
        style={{ ...basePageStyle(resume, template), display: 'grid', gridTemplateColumns: '33.333333% 66.666667%', padding: 0, overflow: 'hidden' }}
      >
        <aside style={{ minHeight: '297mm', padding: 16, paddingTop: resume.globalSettings.sectionSpacing ?? 8, background: themeColor, color: '#ffffff' }}>
          <div >
            <ModernHeader resume={resume} />
          </div>
          <div >
            <SidebarEducation resume={resume} items={model.education} />
          </div>
        </aside>
        <main style={{ padding: '0 16px 24px', background: '#ffffff' }}>
          {rightSections.map((section) => (
            <div key={section.id} >
              <StandardSection id={section.id} title={section.title} resume={resume} model={model} />
            </div>
          ))}
        </main>
      </div>
    )
  }

  // ── timeline: left-side vertical line with dot markers ────────────────
  if (resume.templateId === 'timeline') {
    const nonBasicSections = sections.filter((s) => s.id !== 'basic')
    return (
      <div data-resume-print-root className="resume-document" style={basePageStyle(resume, template)}>
        {sections.find((s) => s.id === 'basic') && (
          <div style={{  marginBottom: 16 }}>
            <ClassicHeader resume={resume} />
          </div>
        )}
        <div style={{ paddingLeft: 6 }}>
          {nonBasicSections.map((section) => (
            <div
              key={section.id}style={{
                
                position: 'relative',
                paddingLeft: 28,
                marginTop: resume.globalSettings.sectionSpacing ?? 16,
              }}
            >
              {/* vertical line */}
              <div style={{ position: 'absolute', left: 6, top: 14, bottom: -8, width: 2, background: '#e5e7eb' }} />
              {/* dot */}
              <div style={{
                position: 'absolute',
                left: 0,
                top: 14,
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: themeColor,
                border: '2px solid #ffffff',
                boxShadow: `0 0 0 2px ${themeColor}`,
              }} />
              {/* section title & content */}
              <div
                style={{
                  fontSize: resume.globalSettings.headerSize || 18,
                  fontWeight: 700,
                  color: themeColor,
                  marginBottom: 10,
                  lineHeight: 1.4,
                }}
              >
                {section.title}
              </div>
              {/* reuse StandardSection without its own title */}
              <div style={{ fontSize: resume.globalSettings.baseFontSize ?? 14 }}>
                {section.id === 'skills' && <RichList blocks={model.skills} resume={resume} />}
                {section.id === 'experience' && <EntryList items={model.experience} resume={resume} />}
                {section.id === 'projects' && <EntryList items={model.projects} resume={resume} />}
                {section.id === 'education' && <EntryList items={model.education} resume={resume} />}
                {section.id === 'selfEvaluation' && <Paragraphs blocks={model.selfEvaluation} resume={resume} />}
                {section.id === 'certificates' && resume.certificates.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                    {resume.certificates.map((cert) => (
                      <img key={cert.id} src={cert.url} alt="证书" style={{ width: `${cert.width}%`, maxWidth: '100%' }} />
                    ))}
                  </div>
                )}
                {section.id in resume.customData && <CustomEntries items={resume.customData[section.id]} resume={resume} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── creative: full-width colored header block ──────────────────────────
  if (resume.templateId === 'creative') {
    const otherSections = sections.filter((s) => s.id !== 'basic')
    const padding = resume.globalSettings.pagePadding ?? 14
    return (
      <div
        data-resume-print-root
        className="resume-document"
        style={{ ...basePageStyle(resume, template), padding: 0, overflow: 'hidden' }}
      >
        {/* colored header block */}
        <div style={{
            
            background: themeColor,
            color: '#ffffff',
            padding: `24px ${padding}px`,
            borderBottomRightRadius: 32,
          }}
        >
          <ClassicHeaderInverse resume={resume} />
        </div>
        {/* content area */}
        <div style={{ padding: `0 ${padding}px ${padding}px` }}>
          {otherSections.map((section) => (
            <div key={section.id} >
              <StandardSection id={section.id} title={section.title} resume={resume} model={model} variant="creative" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── editorial: magazine-style header + uppercase gray section titles ───
  if (resume.templateId === 'editorial') {
    return (
      <div data-resume-print-root className="resume-document" style={basePageStyle(resume, template)}>
        {sections.map((section) =>
          section.id === 'basic' ? (
            <div key={section.id} >
              <EditorialHeader resume={resume} />
            </div>
          ) : (
            <div key={section.id} >
              <StandardSection id={section.id} title={section.title} resume={resume} model={model} variant="editorial" />
            </div>
          ),
        )}
      </div>
    )
  }

  // ── single-column variants: left-right / minimalist / elegant / swiss / classic ──
  const variantMap: Partial<Record<string, TitleVariant>> = {
    'left-right': 'left-right',
    minimalist: 'minimalist',
    elegant: 'elegant',
    swiss: 'swiss',
    classic: 'classic',
  }
  const titleVariant: TitleVariant = variantMap[resume.templateId] ?? 'classic'
  const isCentered = resume.templateId === 'elegant' || resume.templateId === 'minimalist'

  return (
    <div data-resume-print-root className="resume-document" style={basePageStyle(resume, template)}>
      <div style={isCentered ? { width: '100%', maxWidth: 896, margin: '0 auto' } : undefined}>
        {sections.map((section) =>
          section.id === 'basic' ? (
            <div key={section.id} >
              <ClassicHeader resume={resume} centered={isCentered} />
            </div>
          ) : (
            <div key={section.id} >
              <StandardSection id={section.id} title={section.title} resume={resume} model={model} variant={titleVariant} />
            </div>
          ),
        )}
      </div>
    </div>
  )
}
