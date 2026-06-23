import { Button, Message, Modal, Result, Spin, Switch, Tooltip } from '@arco-design/web-react'
import { IconArrowLeft, IconExport, IconSave, IconSelectAll, IconStar } from '@arco-design/web-react/icon'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { createEmptyResumeDocument, createTemplateResumeDocument } from './constants'
import { ResumeEditorProvider } from './ResumeEditorContext'
import { useResumeEditor } from './useResumeEditor'
import { TEMPLATE_REGISTRY } from './templates/registry'
import { createResume, getResume, updateResume } from './api'
import { EditPanel } from './components/EditPanel'
import { PreviewPanel } from './components/PreviewPanel'
import { SidePanel } from './components/SectionNav'
import { AiAssistPanel, type AiAssistSection } from './components/AiAssistPanel'
import { TemplatePicker } from './components/TemplatePicker'
import { ApiError } from '../shared/api'
import type { TemplateId } from './types'
import { exportResumeElementToPdf } from './utils/exportResumePdf'

// → 简历编辑器自动保存 debounce：半分钟。改动后重置定时器，到期才推送 updateResume。
const AUTOSAVE_DEBOUNCE_MS = 30_000

function PanelLeftIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" strokeOpacity={active ? 1 : 0.4} />
    </svg>
  )
}

function PencilIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" strokeOpacity={active ? 1 : 0.4} />
    </svg>
  )
}

function EyeIcon({ active }: { active: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" strokeOpacity={active ? 1 : 0.4} />
    </svg>
  )
}

function ResumeEditorInner() {
  const navigate = useNavigate()
  const params = useParams()
  const [searchParams] = useSearchParams()
  const previewRef = useRef<HTMLDivElement | null>(null)
  const {
    resume,
    dirty,
    saveStatus,
    activeSection,
    setResume,
    setActiveSection,
    updateTitle,
    setTemplateId,
    setVisibility,
    updateExperience,
    updateProject,
    updateEducation,
    setSkillContent,
    setSelfEvaluationContent,
    markSaving,
    markSaved,
    markError,
  } = useResumeEditor()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)
  const [authExpired, setAuthExpired] = useState(false)
  const [templatePickerVisible, setTemplatePickerVisible] = useState(false)
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false)
  const [editPanelCollapsed, setEditPanelCollapsed] = useState(false)
  const [previewPanelCollapsed, setPreviewPanelCollapsed] = useState(false)
  const [confirmLeaveVisible, setConfirmLeaveVisible] = useState(false)

  const resumeId = params.resumeId
  const templateParam = searchParams.get('template')
  // → 以 TEMPLATE_REGISTRY 为准验证 templateParam：避免硬编码白名单遗漏新模板。
  const draftTemplateId: TemplateId =
    templateParam && TEMPLATE_REGISTRY.some((t) => t.id === templateParam)
      ? (templateParam as TemplateId)
      : 'blank'

  useEffect(() => {
    let alive = true
    async function bootstrap() {
      setLoading(true)
      setMissing(false)
      setAuthExpired(false)
      try {
        if (resumeId === 'new' || !resumeId) {
          const created = await createResume(
            draftTemplateId !== 'blank' ? createTemplateResumeDocument(draftTemplateId) : createEmptyResumeDocument(draftTemplateId),
          )
          if (!alive) return
          setResume(created)
          navigate(`/student/resumes/${created.id}`, { replace: true })
          return
        }
        const detail = await getResume(Number(resumeId))
        if (!alive) return
        setResume(detail)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (!alive) return
          setAuthExpired(true)
          return
        }
        if (alive) setMissing(true)
      } finally {
        if (alive) setLoading(false)
      }
    }
    void bootstrap()
    return () => { alive = false }
  }, [draftTemplateId, navigate, resumeId, setResume])

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
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [dirty, markError, markSaved, markSaving, resume])

  const handleSaveNow = async () => {
    if (!resume) return
    try {
      markSaving()
      const saved = await updateResume(resume)
      markSaved(saved)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAuthExpired(true)
        return
      }
      markError()
    }
  }

  const handleBackClick = () => {
    if (dirty) {
      setConfirmLeaveVisible(true)
      return
    }
    navigate('/student/resumes')
  }

  const handleSaveAndLeave = async () => {
    if (!resume) return
    try {
      markSaving()
      const saved = await updateResume(resume)
      markSaved(saved)
      setConfirmLeaveVisible(false)
      navigate('/student/resumes')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setConfirmLeaveVisible(false)
        setAuthExpired(true)
        return
      }
      markError()
    }
  }

  const handleLeaveWithoutSaving = () => {
    setConfirmLeaveVisible(false)
    navigate('/student/resumes')
  }

  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [aiAssistOpen, setAiAssistOpen] = useState(false)
    const [exportMessage, setExportMessage] = useState('generating')
  // Auto-pick target field for toolbar AI assist based on active section
  const aiAssistConfig: { section: AiAssistSection; value: string; onApply: (v: string) => void } | null = (() => {
    if (!resume) return null
    const section = String(activeSection)
    if (section === "skills") {
      return { section: "skill", value: resume.skillContent, onApply: (v: string) => setSkillContent(v) }
    }
    if (section === "selfEvaluation") {
      return { section: "selfEvaluation", value: resume.selfEvaluationContent, onApply: (v: string) => setSelfEvaluationContent(v) }
    }
    const list = (section === "experience" ? resume.experience : section === "projects" ? resume.projects : section === "education" ? resume.education : null)
    if (list && list.length > 0) {
      const first = list[0]
      const value = ((first as any).details ?? (first as any).description ?? "") as string
      const sectionKey = (section === "experience" ? "experience" : section === "projects" ? "project" : "education") as AiAssistSection
      const fieldKey = section === "experience" ? "details" : "description"
      const update = section === "experience" ? updateExperience : section === "projects" ? updateProject : updateEducation
      return { section: sectionKey, value, onApply: (v: string) => update(first.id, { [fieldKey]: v } as any) }
    }
    return null
  })()

  const handleAiAssistApply = (text: string) => {
    if (aiAssistConfig) aiAssistConfig.onApply(text)
  }
('正在生成 PDF...')

  const handleExport = async () => {
    const node = previewRef.current?.querySelector('[data-resume-print-root]')
    if (!(node instanceof HTMLElement)) return
    setExporting(true)
    setExportProgress(5)
    setExportMessage('正在准备资源…')
    try {
      await exportResumeElementToPdf(node, {
        filename: resume?.title || '简历',
        scale: 2,
        onProgress: (state) => {
          setExportMessage(state.message)
          setExportProgress(Math.round((state.current / state.total) * 100))
        },
      })
      setExportProgress(100)
      setExportMessage('已下载')
      window.setTimeout(() => setExporting(false), 600)
    } catch (err) {
      console.error('export pdf failed', err)
      setExporting(false)
      Modal.error({ title: '导出 PDF 失败', content: (err as Error)?.message || '请重试' })
    }
  }

  if (loading) {
    return (
      <div className="resume-loading">
        <Spin size={34} tip="正在加载简历编辑器..." />
      </div>
    )
  }

  if (authExpired) {
    return <Result status="403" title="登录状态已失效" subTitle="请重新登录后再继续创建或编辑简历。" />
  }

  if (missing || !resume) {
    return <Result status="404" title="简历不存在" subTitle="这份简历可能已被删除。" />
  }

  const saveLabel =
    saveStatus === 'saving' ? '保存中…'
    : saveStatus === 'saved' ? '已保存'
    : saveStatus === 'error' ? '保存失败'
    : '未保存'

  return (
    <div className="wb-root">
      {/* 导入提醒 banner */}
      {searchParams.get('imported') === '1' && (
        <div style={{
          background: '#FFF7E6', border: '1px solid #FFD591', borderRadius: 8,
          padding: '8px 16px', margin: '8px 16px 0', fontSize: 13, color: '#D46B08',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span>以下内容由 AI 从你上传的文件解析而来，请核对无误后保存。</span>
          <button
            type="button"
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#D46B08', fontSize: 16, padding: 0 }}
            onClick={() => {
              const url = new URL(window.location.href)
              url.searchParams.delete('imported')
              window.history.replaceState(null, '', url.toString())
            }}
          >×</button>
        </div>
      )}
      {/* Header */}
      <header className="wb-header">
        <div className="wb-header-left">
          <button type="button" className="wb-back-btn" onClick={handleBackClick}>
            <IconArrowLeft />
            <span>返回</span>
          </button>
          <span className="wb-breadcrumb-sep">/</span>
          <input
            className="wb-title-input"
            value={resume.title}
            onChange={(e) => updateTitle(e.target.value)}
            placeholder="简历标题"
          />
          <span className={`wb-save-chip wb-save-chip--${saveStatus}`}>{saveLabel}</span>
        </div>

        <div className="wb-header-center">
          <button
            type="button"
            className={`wb-panel-toggle${!sidePanelCollapsed ? ' on' : ''}`}
            onClick={() => setSidePanelCollapsed((v) => !v)}
            title={sidePanelCollapsed ? '展开布局面板' : '收起布局面板'}
          >
            <PanelLeftIcon active={!sidePanelCollapsed} />
          </button>
          <button
            type="button"
            className={`wb-panel-toggle${!editPanelCollapsed ? ' on' : ''}`}
            onClick={() => setEditPanelCollapsed((v) => !v)}
            title={editPanelCollapsed ? '展开编辑面板' : '收起编辑面板'}
          >
            <PencilIcon active={!editPanelCollapsed} />
          </button>
          <button
            type="button"
            className={`wb-panel-toggle${!previewPanelCollapsed ? ' on' : ''}`}
            onClick={() => setPreviewPanelCollapsed((v) => !v)}
            title={previewPanelCollapsed ? '展开预览面板' : '收起预览面板'}
          >
            <EyeIcon active={!previewPanelCollapsed} />
          </button>
        </div>

        <div className="wb-header-right">
          <label className="wb-visibility-row">
            <Tooltip content="同一时间只能勾选一份简历供 AI 读取，勾选后其他简历将自动取消">
              <span>智能体可读取</span>
            </Tooltip>
            <Switch checked={resume.visibility} onChange={setVisibility} size="small" />
          </label>
          <span className="wb-header-divider" />
          <Button size="small" icon={<IconSelectAll />} onClick={() => setTemplatePickerVisible(true)}>切换模板</Button>
          <Tooltip content={aiAssistConfig ? "开启 AI 辅助盘" : "当前板块暂不支持 AI 辅助"}>
            <Button
              size="small"
              icon={<IconStar />}
              disabled={!aiAssistConfig}
              onClick={() => {
                if (!aiAssistConfig) {
                  Message.warning("当前板块暂无内容可优化，请切换到工作经历/项目经历/教育经历/专业技能/自我评价")
                  return
                }
                setAiAssistOpen(true)
              }}
            >
              AI 辅助
            </Button>
          </Tooltip>
          <Button size="small" icon={<IconExport />} onClick={handleExport}>导出 PDF</Button>
          <Button size="small" type="primary" icon={<IconSave />} onClick={() => void handleSaveNow()}>保存</Button>
        </div>
      </header>

      {/* Three-panel body */}
      <div className="wb-body">
        {!sidePanelCollapsed && (
          <aside className="wb-side">
            <SidePanel />
          </aside>
        )}
        {!editPanelCollapsed && (
          <div className="wb-edit">
            <EditPanel />
          </div>
        )}
        <div className="wb-preview" style={previewPanelCollapsed ? { display: 'none' } : {}}>
          <PreviewPanel resume={resume} previewRef={previewRef} />
        </div>
      </div>

      <TemplatePicker
        visible={templatePickerVisible}
        value={resume.templateId}
        onChange={(id) => { setTemplateId(id); setActiveSection('basic') }}
        onClose={() => setTemplatePickerVisible(false)}
      />

      <Modal
        title="是否保存当前简历的修改后再返回？"
        visible={confirmLeaveVisible}
        onCancel={() => setConfirmLeaveVisible(false)}
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => setConfirmLeaveVisible(false)}>取消</Button>
            <Button onClick={handleLeaveWithoutSaving}>不保存</Button>
            <Button type="primary" loading={saveStatus === 'saving'} onClick={() => void handleSaveAndLeave()}>
              保存并返回
            </Button>
          </div>
        }
      >
        <p style={{ margin: 0, color: '#4b5563' }}>
          检测到当前简历还有未保存的修改，返回前请选择是否保存。也可以点「取消」继续编辑。
        </p>
      </Modal>

      <Modal
        visible={exporting}
        title={null}
        footer={null}
        closable={false}
        maskClosable={false}
        style={{ width: 420 }}
        className="resume-export-modal"
      >
        <div className="resume-export-modal-body">
          <div className="resume-export-modal-icon" aria-hidden>
            <IconExport />
          </div>
          <div className="resume-export-modal-title">正在生成 PDF</div>
          <div className="resume-export-modal-sub">{exportMessage}</div>
          <div className="resume-export-modal-progress">
            <div
              className="resume-export-modal-progress-bar"
              style={{ width: `${exportProgress}%` }}
            />
          </div>
          <div className="resume-export-modal-percent">{exportProgress}%</div>
        </div>
      </Modal>

      <AiAssistPanel
        visible={aiAssistOpen && !!aiAssistConfig}
        onClose={() => setAiAssistOpen(false)}
        section={(aiAssistConfig?.section ?? "skill") as AiAssistSection}
        currentText={aiAssistConfig?.value ?? ""}
        resumeId={resume.id}
        onApply={handleAiAssistApply}
        applyLabel="应用到当前字段?"
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
