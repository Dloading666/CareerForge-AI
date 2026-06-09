import { Message, Result, Spin } from '@arco-design/web-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { createEmptyResumeDocument } from './constants'
import { ResumeEditorProvider, useResumeEditor } from './ResumeEditorContext'
import { createResume, getResume, updateResume } from './api'
import { EditPanel } from './components/EditPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { ResumeToolbar } from './components/ResumeToolbar'
import { SectionNav } from './components/SectionNav'
import { TemplatePicker } from './components/TemplatePicker'
import { TEMPLATE_REGISTRY } from './templates/registry'
import { printResumeElement } from './utils/printResume'

function ResumeEditorInner() {
  const navigate = useNavigate()
  const params = useParams()
  const previewRef = useRef<HTMLDivElement | null>(null)
  const {
    resume,
    activeSection,
    dirty,
    saveStatus,
    setResume,
    setActiveSection,
    updateTitle,
    setTemplateId,
    setVisibility,
    markSaving,
    markSaved,
    markError,
  } = useResumeEditor()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false)

  const resumeId = params.resumeId

  useEffect(() => {
    let alive = true

    async function bootstrap() {
      setLoading(true)
      setMissing(false)
      try {
        if (resumeId === 'new' || !resumeId) {
          const created = await createResume(createEmptyResumeDocument())
          if (!alive) return
          setResume(created)
          navigate(`/student/resumes/${created.id}`, { replace: true })
          return
        }

        const detail = await getResume(Number(resumeId))
        if (!alive) return
        setResume(detail)
      } catch {
        if (alive) setMissing(true)
      } finally {
        if (alive) setLoading(false)
      }
    }

    void bootstrap()
    return () => {
      alive = false
    }
  }, [navigate, resumeId, setResume])

  useEffect(() => {
    if (!resume || !dirty) return
    const timer = window.setTimeout(async () => {
      try {
        markSaving()
        const saved = await updateResume(resume)
        markSaved(saved)
      } catch {
        markError()
      }
    }, 1500)
    return () => window.clearTimeout(timer)
  }, [dirty, markError, markSaved, markSaving, resume])

  const handleSaveNow = async () => {
    if (!resume) return
    try {
      markSaving()
      const saved = await updateResume(resume)
      markSaved(saved)
      Message.success('保存成功')
    } catch {
      markError()
      Message.error('保存失败')
    }
  }

  if (loading) {
    return (
      <div className="resume-loading">
        <Spin size={34} tip="正在加载简历编辑器..." />
      </div>
    )
  }

  if (missing || !resume) {
    return <Result status="404" title="简历不存在" subTitle="这份简历可能已被删除。" />
  }

  return (
    <div className="resume-editor-page">
      <ResumeToolbar
        title={resume.title}
        templateId={resume.templateId}
        visibility={resume.visibility}
        saveStatus={saveStatus}
        onBack={() => navigate('/student/resumes')}
        onTitleChange={updateTitle}
        onVisibilityChange={setVisibility}
        onOpenTemplatePicker={() => setTemplatePickerVisible(true)}
        onExport={() => {
          const node = previewRef.current?.querySelector('[data-resume-print-root]')
          if (node instanceof HTMLElement) {
            printResumeElement(node)
          }
        }}
        onSave={() => void handleSaveNow()}
      />

      <div className="resume-template-inline-bar">
        {TEMPLATE_REGISTRY.map((template) => {
          const active = template.id === resume.templateId
          return (
            <button
              key={template.id}
              type="button"
              className={`resume-template-inline-item${active ? ' active' : ''}`}
              onClick={() => setTemplateId(template.id)}
            >
              <div className="resume-template-inline-thumb">
                <img src={template.thumbnailSrc} alt={template.name} className="resume-template-inline-thumb-image" />
              </div>
              <span className="resume-template-inline-dot" style={{ background: template.accentColor }} />
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
          )
        })}
      </div>

      <div className="resume-editor-layout">
        <SectionNav sections={resume.menuSections} activeSection={activeSection} onChange={setActiveSection} />
        <EditPanel />
        <PreviewPanel resume={resume} previewRef={previewRef} />
      </div>

      <TemplatePicker
        visible={templatePickerVisible}
        value={resume.templateId}
        onChange={setTemplateId}
        onClose={() => setTemplatePickerVisible(false)}
      />
    </div>
  )
}

export function ResumeEditorPage() {
  return (
    <ResumeEditorProvider>
      <ResumeEditorInner />
    </ResumeEditorProvider>
  )
}
