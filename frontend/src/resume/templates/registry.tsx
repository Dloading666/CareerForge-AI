import type { CSSProperties } from 'react'

import type { ResumeData, ResumeTemplateConfig, TemplateId, TemplateViewModel, ViewListItem } from '../types'

export const TEMPLATE_REGISTRY: ResumeTemplateConfig[] = [
  {
    id: 'classic',
    name: '经典',
    description: '简洁稳重，适合大多数正式投递场景。',
    accentColor: '#0f172a',
    secondaryColor: '#475569',
    background: '#ffffff',
    textColor: '#0f172a',
    thumbnailSrc: '/resume-template-thumbs/classic.png',
    layout: 'single',
  },
  {
    id: 'modern',
    name: '现代',
    description: '左侧强调基础信息，右侧突出经历与项目亮点。',
    accentColor: '#111111',
    secondaryColor: '#d4d4d8',
    background: '#ffffff',
    textColor: '#18181b',
    thumbnailSrc: '/resume-template-thumbs/modern.png',
    layout: 'split',
  },
  {
    id: 'elegant',
    name: '优雅',
    description: '留白更充足，版面更柔和，适合综合型岗位。',
    accentColor: '#18181b',
    secondaryColor: '#d4d4d8',
    background: '#ffffff',
    textColor: '#18181b',
    thumbnailSrc: '/resume-template-thumbs/elegant.png',
    layout: 'center',
  },
]

export function getTemplateConfig(templateId: TemplateId) {
  return TEMPLATE_REGISTRY.find((item) => item.id === templateId) ?? TEMPLATE_REGISTRY[0]
}

function lines(text: string) {
  return text
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

function mapItems<T extends { visible?: boolean }>(
  items: T[],
  mapItem: (item: T) => ViewListItem,
) {
  return items.filter((item) => item.visible !== false).map(mapItem)
}

export function buildTemplateViewModel(resume: ResumeData): TemplateViewModel {
  return {
    header: {
      name: resume.basic.name || '未命名简历',
      title: resume.basic.title,
      contacts: [resume.basic.phone, resume.basic.email, resume.basic.location, resume.basic.birthDate].filter(Boolean),
    },
    skills: resume.skills.filter((item) => item.name).map((item) => ({
      title: item.name,
      subtitle: `熟练度 Lv.${item.level}`,
      lines: [],
    })),
    education: mapItems(resume.education, (item) => ({
      title: item.school || '学校',
      subtitle: [item.major, item.degree].filter(Boolean).join(' · '),
      meta: [item.startDate, item.endDate].filter(Boolean).join(' - '),
      lines: lines(item.description),
    })),
    experience: mapItems(resume.experience, (item) => ({
      title: item.company || '公司',
      subtitle: item.position,
      meta: item.date,
      lines: lines(item.details),
    })),
    projects: mapItems(resume.projects, (item) => ({
      title: item.name || '项目',
      subtitle: item.role,
      meta: item.date,
      lines: lines(item.description),
    })),
    selfEvaluation: lines(resume.selfEvaluation),
  }
}

function getPhotoInitials(name: string) {
  if (!name) return '简历'
  return name.length <= 2 ? name : name.slice(-2)
}

function ResumePhoto({
  src,
  name,
  size,
  rounded = false,
  dark = false,
}: {
  src?: string
  name: string
  size: number
  rounded?: boolean
  dark?: boolean
}) {
  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: rounded ? 999 : 12,
    objectFit: 'cover',
    overflow: 'hidden',
    flexShrink: 0,
  }

  if (src) {
    return <img src={src} alt={name || '头像'} style={{ ...baseStyle, display: 'block' }} />
  }

  return (
    <div
      style={{
        ...baseStyle,
        display: 'grid',
        placeItems: 'center',
        background: dark ? 'rgba(255,255,255,0.1)' : 'linear-gradient(180deg, #e5e7eb, #f8fafc)',
        color: dark ? '#ffffff' : '#475569',
        fontSize: Math.max(18, Math.round(size / 4.2)),
        fontWeight: 700,
        letterSpacing: '0.08em',
        border: dark ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(148,163,184,0.18)',
      }}
    >
      {getPhotoInitials(name)}
    </div>
  )
}

function DotMeta({
  items,
  color,
  align = 'flex-start',
}: {
  items: string[]
  color: string
  align?: CSSProperties['justifyContent']
}) {
  if (items.length === 0) return null
  return (
    <div
      style={{
        marginTop: 12,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 10,
        justifyContent: align,
        color,
        fontSize: 11.8,
      }}
    >
      {items.map((item) => (
        <span key={item} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 4, height: 4, borderRadius: 999, background: color, opacity: 0.6 }} />
          {item}
        </span>
      ))}
    </div>
  )
}

function ClassicSectionTitle({ title }: { title: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111111' }}>{title}</h3>
      <div style={{ height: 1.5, background: '#111111', marginTop: 10 }} />
    </div>
  )
}

function ElegantSectionTitle({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginBottom: 18 }}>
      <div style={{ flex: 1, height: 1, background: '#d4d4d8' }} />
      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#18181b', letterSpacing: '0.02em' }}>{title}</h3>
      <div style={{ flex: 1, height: 1, background: '#d4d4d8' }} />
    </div>
  )
}

function TimelineList({
  items,
  textColor,
  metaColor,
  lineColor,
  compact = false,
}: {
  items: ViewListItem[]
  textColor: string
  metaColor: string
  lineColor: string
  compact?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: compact ? 14 : 18 }}>
      {items.map((item, index) => (
        <div key={`${item.title}-${index}`}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: item.subtitle ? 'minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto',
              gap: 12,
              alignItems: 'baseline',
            }}
          >
            <strong style={{ fontSize: 13.5, color: textColor }}>{item.title}</strong>
            {item.subtitle ? <span style={{ fontSize: 13, color: textColor, fontWeight: 600 }}>{item.subtitle}</span> : null}
            {item.meta ? <span style={{ fontSize: 11.8, color: metaColor }}>{item.meta}</span> : null}
          </div>
          {item.lines.length > 0 ? (
            <div
              style={{
                marginTop: compact ? 8 : 10,
                display: 'grid',
                gap: 4,
                color: lineColor,
                fontSize: 12.2,
                lineHeight: 1.72,
              }}
            >
              {item.lines.map((line) => (
                <p key={line} style={{ margin: 0 }}>
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function SkillSummary({
  items,
  textColor,
  mutedColor,
  dark = false,
}: {
  items: ViewListItem[]
  textColor: string
  mutedColor: string
  dark?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {items.map((item) => (
        <div
          key={item.title}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 10,
            alignItems: 'baseline',
            color: textColor,
            borderBottom: dark ? '1px solid rgba(255,255,255,0.1)' : '1px solid rgba(228,228,231,0.75)',
            paddingBottom: 6,
          }}
        >
          <strong style={{ fontSize: 12.8 }}>{item.title}</strong>
          {item.subtitle ? <span style={{ fontSize: 11.5, color: mutedColor }}>{item.subtitle}</span> : null}
        </div>
      ))}
    </div>
  )
}

function SidebarSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginTop: 26 }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#ffffff' }}>{title}</h3>
      <div style={{ height: 1, margin: '12px 0 14px', background: 'rgba(255,255,255,0.18)' }} />
      {children}
    </section>
  )
}

export function ResumeTemplatePreview({ resume }: { resume: ResumeData }) {
  const template = getTemplateConfig(resume.templateId)
  const model = buildTemplateViewModel(resume)
  const headerMeta = [resume.basic.birthDate, resume.basic.gender].filter(Boolean)
  const contactMeta = [resume.basic.email, resume.basic.phone, resume.basic.location].filter(Boolean)
  const baseStyle: CSSProperties = {
    width: '210mm',
    minHeight: '297mm',
    background: template.background,
    color: template.textColor,
    padding: `${resume.globalSettings.pagePadding}px`,
    fontSize: resume.globalSettings.baseFontSize,
    lineHeight: resume.globalSettings.lineHeight,
    boxShadow: '0 18px 46px rgba(15, 23, 42, 0.08)',
  }

  if (template.layout === 'split') {
    return (
      <div data-resume-print-root style={{ ...baseStyle, display: 'grid', gridTemplateColumns: '31% 69%', padding: 0, overflow: 'hidden' }}>
        <aside style={{ background: '#0a0a0a', color: '#fff', padding: '34px 26px 28px' }}>
          <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center' }}>
            <ResumePhoto src={resume.basic.photo} name={model.header.name} size={110} dark />
            <h1 style={{ margin: '18px 0 0', fontSize: 28, lineHeight: 1.14, color: '#ffffff' }}>{model.header.name}</h1>
            {model.header.title ? (
              <div style={{ marginTop: 12, fontSize: 15, fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>{model.header.title}</div>
            ) : null}
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 28 }}>
            {[...headerMeta, ...contactMeta].map((item) => (
              <div key={item} style={{ fontSize: 12.8, lineHeight: 1.6, color: 'rgba(255,255,255,0.92)' }}>
                {item}
              </div>
            ))}
          </div>

          {model.education.length > 0 ? (
            <SidebarSection title="教育经历">
              <div style={{ display: 'grid', gap: 14 }}>
                {model.education.map((item, index) => (
                  <div key={`${item.title}-${index}`}>
                    <strong style={{ display: 'block', fontSize: 14, color: '#ffffff' }}>{item.title}</strong>
                    {item.meta ? <div style={{ marginTop: 6, fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>{item.meta}</div> : null}
                    {item.subtitle ? <div style={{ marginTop: 4, fontSize: 13, color: 'rgba(255,255,255,0.9)' }}>{item.subtitle}</div> : null}
                    {item.lines.length > 0 ? (
                      <div style={{ marginTop: 6, display: 'grid', gap: 4, fontSize: 12, color: 'rgba(255,255,255,0.86)', lineHeight: 1.68 }}>
                        {item.lines.map((line) => (
                          <p key={line} style={{ margin: 0 }}>
                            {line}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </SidebarSection>
          ) : null}

          {model.selfEvaluation.length > 0 ? (
            <SidebarSection title="自我评价">
              <div style={{ display: 'grid', gap: 5, fontSize: 12, color: 'rgba(255,255,255,0.88)', lineHeight: 1.68 }}>
                {model.selfEvaluation.map((line) => (
                  <p key={line} style={{ margin: 0 }}>
                    {line}
                  </p>
                ))}
              </div>
            </SidebarSection>
          ) : null}
        </aside>
        <div style={{ padding: '34px 30px 30px' }}>
          {model.skills.length > 0 ? (
            <section style={{ marginBottom: 24 }}>
              <ClassicSectionTitle title="专业技能" />
              <SkillSummary items={model.skills} textColor="#111111" mutedColor="#52525b" />
            </section>
          ) : null}

          {model.experience.length > 0 ? (
            <section style={{ marginTop: model.skills.length > 0 ? 28 : 0 }}>
              <ClassicSectionTitle title="工作经历" />
              <TimelineList items={model.experience} textColor="#111111" metaColor="#3f3f46" lineColor="#27272a" />
            </section>
          ) : null}

          {model.projects.length > 0 ? (
            <section style={{ marginTop: 28 }}>
              <ClassicSectionTitle title="项目经历" />
              <TimelineList items={model.projects} textColor="#111111" metaColor="#3f3f46" lineColor="#27272a" />
            </section>
          ) : null}
        </div>
      </div>
    )
  }

  if (template.layout === 'center') {
    return (
      <div data-resume-print-root style={{ ...baseStyle, padding: '34px 40px 40px', background: '#ffffff' }}>
        <div style={{ maxWidth: 640, margin: '0 auto' }}>
          <div style={{ display: 'grid', justifyItems: 'center', textAlign: 'center' }}>
            <ResumePhoto src={resume.basic.photo} name={model.header.name} size={116} />
            <h1 style={{ margin: '18px 0 0', fontSize: 31, lineHeight: 1.15, color: '#18181b' }}>{model.header.name}</h1>
            {model.header.title ? (
              <div style={{ marginTop: 10, fontSize: 15, fontWeight: 600, color: '#27272a' }}>{model.header.title}</div>
            ) : null}
            <DotMeta items={[...headerMeta, ...contactMeta]} color="#3f3f46" align="center" />
          </div>

          {model.skills.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <ElegantSectionTitle title="专业技能" />
              <SkillSummary items={model.skills} textColor="#18181b" mutedColor="#52525b" />
            </section>
          ) : null}

          {model.experience.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <ElegantSectionTitle title="工作经历" />
              <TimelineList items={model.experience} textColor="#18181b" metaColor="#3f3f46" lineColor="#27272a" />
            </section>
          ) : null}

          {model.projects.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <ElegantSectionTitle title="项目经历" />
              <TimelineList items={model.projects} textColor="#18181b" metaColor="#3f3f46" lineColor="#27272a" />
            </section>
          ) : null}

          {model.education.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <ElegantSectionTitle title="教育经历" />
              <TimelineList items={model.education} textColor="#18181b" metaColor="#3f3f46" lineColor="#27272a" compact />
            </section>
          ) : null}

          {model.selfEvaluation.length > 0 ? (
            <section style={{ marginTop: 34 }}>
              <ElegantSectionTitle title="自我评价" />
              <div style={{ display: 'grid', gap: 6, color: '#27272a', fontSize: 12.2, lineHeight: 1.72 }}>
                {model.selfEvaluation.map((line) => (
                  <p key={line} style={{ margin: 0 }}>
                    {line}
                  </p>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div data-resume-print-root style={{ ...baseStyle }}>
      <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(0, 1fr) minmax(220px, 250px)', gap: 18, alignItems: 'center' }}>
        <ResumePhoto src={resume.basic.photo} name={model.header.name} size={120} />
        <div>
          <h1 style={{ margin: 0, fontSize: 33, lineHeight: 1.12, color: '#111111' }}>{model.header.name}</h1>
          {model.header.title ? <div style={{ marginTop: 10, fontSize: 16, fontWeight: 600, color: '#27272a' }}>{model.header.title}</div> : null}
        </div>
        <div style={{ display: 'grid', gap: 8, justifyItems: 'start' }}>
          {[...headerMeta, ...contactMeta].map((item) => (
            <span key={item} style={{ fontSize: 12.8, color: '#27272a' }}>
              {item}
            </span>
          ))}
        </div>
      </div>

      {model.skills.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <ClassicSectionTitle title="专业技能" />
          <SkillSummary items={model.skills} textColor="#111111" mutedColor="#52525b" />
        </section>
      ) : null}

      {model.experience.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <ClassicSectionTitle title="工作经历" />
          <TimelineList items={model.experience} textColor="#111111" metaColor="#3f3f46" lineColor="#27272a" />
        </section>
      ) : null}

      {model.projects.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <ClassicSectionTitle title="项目经历" />
          <TimelineList items={model.projects} textColor="#111111" metaColor="#3f3f46" lineColor="#27272a" />
        </section>
      ) : null}

      {model.education.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <ClassicSectionTitle title="教育经历" />
          <TimelineList items={model.education} textColor="#111111" metaColor="#3f3f46" lineColor="#27272a" compact />
        </section>
      ) : null}

      {model.selfEvaluation.length > 0 ? (
        <section style={{ marginTop: 28 }}>
          <ClassicSectionTitle title="自我评价" />
          <div style={{ display: 'grid', gap: 6, color: '#27272a', fontSize: 12.2, lineHeight: 1.72 }}>
            {model.selfEvaluation.map((line) => (
              <p key={line} style={{ margin: 0 }}>
                {line}
              </p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
