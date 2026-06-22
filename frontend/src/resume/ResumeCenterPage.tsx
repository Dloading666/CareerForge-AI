import { Button, Empty, Input, Message, Modal, Popconfirm, Progress, Spin, Tag } from '@arco-design/web-react'
import { IconCopy, IconDelete, IconDownload, IconEdit, IconPlus, IconRefresh, IconUpload } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'


import { ApiError } from '../shared/api'
import { deleteResume, duplicateResume, getResume, importResumeFile, listResumes, updateResume } from './api'
import { TEMPLATE_LABELS } from './constants'
import { ResumeTemplatePreview } from './templates/registry'
import { TEMPLATE_REGISTRY } from './templates/registry'
import type { ResumeData, ResumeSummary, TemplateId } from './types'
import { exportResumeElementToPdf } from './utils/exportResumePdf'

const MAX_RESUMES = 6

export function ResumeCenterPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [resumeDataMap, setResumeDataMap] = useState<Record<number, ResumeData>>({})
  const [previewingId, setPreviewingId] = useState<number | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [newResumeModalVisible, setNewResumeModalVisible] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>('classic')
  const importRef = useRef<HTMLInputElement | null>(null)
  const [importModalVisible, setImportModalVisible] = useState(
    () => new URLSearchParams(window.location.search).get('import') === '1',
  )
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [importStage, setImportStage] = useState<'idle' | 'uploading' | 'parsing' | 'saving' | 'done'>('idle')
  const importTimerRef = useRef<number | null>(null)
  const importDoneRef = useRef(false)
  const [editingTitleId, setEditingTitleId] = useState<number | null>(null)
  const exportContainerRef = useRef<HTMLDivElement | null>(null)
  const [exportingId, setExportingId] = useState<number | null>(null)

  const mode = searchParams.get('mode')

  const countLabel = useMemo(() => `${resumes.length}/${MAX_RESUMES}`, [resumes.length])



  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await listResumes()
      setResumes(list)
      const results = await Promise.allSettled(list.map((r) => getResume(r.id)))
      const next: Record<number, ResumeData> = {}
      list.forEach((r, idx) => {
        const res = results[idx]
        if (res.status === 'fulfilled') next[r.id] = res.value
      })
      setResumeDataMap(next)
    } catch {
      Message.error('加载简历列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const list = await listResumes()
        if (cancelled) return
        setResumes(list)
        const results = await Promise.allSettled(list.map((r) => getResume(r.id)))
        if (cancelled) return
        const next: Record<number, ResumeData> = {}
        list.forEach((r, idx) => {
          const res = results[idx]
          if (res.status === 'fulfilled') next[r.id] = res.value
        })
        setResumeDataMap(next)
      } catch {
        if (!cancelled) Message.error('加载简历列表失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // ?import=1 自动打开导入弹窗（F1/G2 跳转入口）
  useEffect(() => {
    if (searchParams.get('import') === '1') {
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // ---- Resume preview modal: user-controlled zoom (default = fit viewport) ----
  const A4_W = 794
  const A4_H = 1123
  const previewCanvasRef = useRef<HTMLDivElement | null>(null)
  const [previewScale, setPreviewScale] = useState(1)
  const fitScaleRef = useRef(1)

  const computeFitScale = () => {
    const maxH = Math.max(320, window.innerHeight - 24 * 2 - 57 - 24)
    const maxW = Math.max(320, window.innerWidth - 24 * 2)
    return Math.min(maxW / A4_W, maxH / A4_H)
  }

  const recomputeOnResize = useCallback(() => {
    const fit = computeFitScale()
    fitScaleRef.current = fit
    setPreviewScale((prev) => (prev === fitScaleRef.current ? fit : prev))
  }, [])

  useEffect(() => {
    if (previewingId === null) return
    const fit = computeFitScale()
    fitScaleRef.current = fit
    queueMicrotask(() => setPreviewScale(fit))
    window.addEventListener('resize', recomputeOnResize)
    return () => window.removeEventListener('resize', recomputeOnResize)
  }, [previewingId, recomputeOnResize])

  const zoomIn = () => setPreviewScale((s) => Math.min(2, +(s + 0.1).toFixed(3)))
  const zoomOut = () => setPreviewScale((s) => Math.max(0.2, +(s - 0.1).toFixed(3)))
  const zoomReset = () => setPreviewScale(fitScaleRef.current)

  const handleDuplicate = async (resumeId: number) => {
    setBusyId(resumeId)
    try {
      await duplicateResume(resumeId)
      Message.success('已复制副本')
      await refresh()
    } catch {
      Message.error('复制失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (resumeId: number) => {
    setBusyId(resumeId)
    try {
      await deleteResume(resumeId)
      Message.success('已删除')
      await refresh()
    } catch {
      Message.error('删除失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleCreateFromTemplate = () => {
    setNewResumeModalVisible(false)
    const url = selectedTemplateId === 'blank'
      ? '/student/resumes/new'
      : `/student/resumes/new?template=${selectedTemplateId}`
    navigate(url)
  }

  const handleInlineTitleSave = async (resumeId: number, newTitle: string) => {
    const trimmed = newTitle.trim()
    if (!trimmed) {
      Message.warning('标题不能为空')
      return
    }
    const detail = resumeDataMap[resumeId]
    if (!detail || detail.title === trimmed) return
    setBusyId(resumeId)
    try {
      await updateResume({ ...detail, title: trimmed })
      Message.success('已重命名')
      await refresh()
    } catch {
      Message.error('重命名失败')
    } finally {
      setBusyId(null)
    }
  }

  const stopImportTimer = () => {
    if (importTimerRef.current !== null) {
      window.clearInterval(importTimerRef.current)
      importTimerRef.current = null
    }
  }

  const resetImportProgress = () => {
    stopImportTimer()
    importDoneRef.current = false
    setImportProgress(0)
    setImportStage('idle')
  }

  const handleImport = async (file: File) => {
    if (resumes.length >= MAX_RESUMES) {
      Message.warning(`简历数量已达上限（${MAX_RESUMES} 份），请先删除一份简历`)
      return
    }
    setImporting(true)
    setImportStage('uploading')
    setImportProgress(1)
    importDoneRef.current = false
    try {
      // Stage 1: upload (0-30%) via XHR onprogress
      const res = await importResumeFile(file, undefined, (evt) => {
        if (importDoneRef.current) return
        if (evt.total > 0) {
          setImportStage('uploading')
          setImportProgress(Math.max(1, Math.round(evt.percent * 0.3)))
        }
      })
      // Stage 2: parsing (30-90%) — backend is sync, animate progress
      setImportStage('parsing')
      setImportProgress(30)
      stopImportTimer()
      importTimerRef.current = window.setInterval(() => {
        setImportProgress((prev) => {
          if (prev >= 88) {
            stopImportTimer()
            return prev
          }
          const step = prev < 50 ? 4 : prev < 75 ? 2 : 1
          return Math.min(88, prev + step)
        })
      }, 220)
      // importResumeFile already returned; stop simulating parsing
      stopImportTimer()
      // Stage 3: saving (90-100%)
      setImportStage('saving')
      setImportProgress(92)
      importDoneRef.current = true
      importTimerRef.current = window.setInterval(() => {
        setImportProgress((prev) => {
          if (prev >= 100) {
            stopImportTimer()
            return 100
          }
          return Math.min(100, prev + 2)
        })
      }, 60)
      await refresh()
      window.setTimeout(() => {
        setImportProgress(100)
        setImportStage('done')
        Message.success(`已导入「${res.title}」，请核对内容后保存`)
        setImportModalVisible(false)
        navigate(`/student/resumes/${res.resume_id}?imported=1`)
      }, 350)
    } catch (error) {
      stopImportTimer()
      importDoneRef.current = true
      Message.error(error instanceof ApiError ? error.message : '导入失败，请检查文件格式')
      setImportStage('idle')
      setImportProgress(0)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="resume-center-page">
      <div className="resume-center-header">

        <div className="resume-center-actions">
          <Button icon={<IconRefresh />} onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button icon={<IconUpload />} onClick={() => { resetImportProgress(); setImportModalVisible(true) }}>
            导入简历
          </Button>
          <Button
            type="primary"
            icon={<IconPlus />}
            onClick={() => {
              if (resumes.length >= MAX_RESUMES) {
                Message.warning(`简历数量已达上限（${MAX_RESUMES} 份），请先删除一份简历`)
                return
              }
              setNewResumeModalVisible(true)
            }}
          >

            新建简历
          </Button>
        </div>
      </div>

      {/* 导入简历 Modal */}
      <Modal
        title="导入简历"
        visible={importModalVisible}
        onCancel={() => {
          if (importing) return
          setImportModalVisible(false)
          resetImportProgress()
        }}
        footer={null}
        style={{ width: 480 }}
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: '#86909C', fontSize: 13, marginBottom: 16 }}>
            支持 PDF、DOCX、JSON 格式，文件不超过 10MB。AI 将自动解析简历内容，解析后请核对无误再保存。
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
            <Button
              type="primary"
              loading={importing}
              onClick={() => importRef.current?.click()}
              style={{ flex: 1 }}
            >
              选择文件（PDF / DOCX / JSON）
            </Button>
          </div>

          {importStage !== 'idle' ? (
            <div style={{ marginBottom: 16, padding: '12px 14px', background: '#f7f8fa', borderRadius: 6, border: '1px solid #e5e6eb' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, fontSize: 13, color: '#4b5563' }}>
                <span>
                  {importStage === 'uploading' ? '正在上传文件…' :
                   importStage === 'parsing' ? 'AI 正在解析简历内容…' :
                   importStage === 'saving' ? '正在保存到云端…' :
                   importStage === 'done' ? '导入完成' : ''}
                </span>
                <span style={{ fontVariantNumeric: 'tabular-nums', color: '#165DFF', fontWeight: 500 }}>{importProgress}%</span>
              </div>
              <Progress
                percent={importProgress}
                showText={false}
                size="small"
                status={importStage === 'done' ? 'success' : 'normal'}
                color={importStage === 'parsing' ? '#7c3aed' : '#165DFF'}
              />
              {importStage === 'parsing' ? (
                <div style={{ marginTop: 6, fontSize: 12, color: '#86909C' }}>PDF / DOCX 解析通常需要 10-30 秒，请稍候</div>
              ) : null}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: '#86909C', lineHeight: 1.8 }}>
            <p style={{ margin: 0 }}>• <b>PDF / DOCX</b>：自动识别简历内容并结构化，约需 10-30 秒</p>
            <p style={{ margin: 0 }}>• <b>JSON</b>：直接导入，无需等待</p>
            <p style={{ margin: 0 }}>
              • 没有 JSON？<a
                href="#"
                onClick={(e) => {
                  e.preventDefault()
                  const template = { basic: { name: '', target_position: '', email: '', phone: '', location: '', birth_date: '' }, education: [], experience: [], projects: [], skills: '', self_evaluation: '' }
                  const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url; a.download = '简历模板.json'; a.click()
                  URL.revokeObjectURL(url)
                }}
                style={{ color: '#165dff' }}
              >下载 JSON 模板</a>
            </p>
          </div>
        </div>
      </Modal>

      <input
        ref={importRef}
        type="file"
        hidden
        accept=".pdf,.docx,.json"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void handleImport(file)
          event.target.value = ''
        }}
      />

      {mode === 'optimize' ? (
        <div className="resume-center-banner">
          简历优化入口已为你打开。你可以先在下方上传已有 PDF / Word，也可以直接编辑在线简历。
        </div>
      ) : null}


      <section className="resume-center-block">
        <div className="resume-center-block-head">
          <div>
            <h3>我的简历</h3>
          </div>
          <Tag color="blue">已创建 {countLabel}</Tag>
        </div>

        {loading ? (
          <div className="resume-center-empty">
            <Spin />
          </div>
        ) : resumes.length === 0 ? (
          <div className="resume-center-empty">
            <Empty description="还没有在线简历，点击右上角「新建简历」开始。" />
          </div>
        ) : (
          <div className="resume-card-grid">
            {resumes.map((resume) => (
              <article key={resume.id} className="resume-card-item">
                <div
                  className="resume-card-item-thumb"
                  role="button"
                  tabIndex={0}
                  onClick={() => setPreviewingId(resume.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setPreviewingId(resume.id)
                  }}
                >
                  {resumeDataMap[resume.id] ? (
                    <div className="resume-card-item-thumb-frame">
                      {(() => {
                        // A4 portrait: 210mm x 297mm @ 96dpi ~= 794 x 1123 px
                        // Card frame is 360 x 510 (CSS px). Scale uniformly so the full A4 fits inside.
                        const A4_W = 794
                        const A4_H = 1123
                        const scale = Math.min(360 / A4_W, 510 / A4_H)
                        return (
                          <div
                            className="resume-card-item-thumb-scaler"
                            style={{
                              width: A4_W,
                              height: A4_H,
                              transform: `scale(${scale})`,
                              transformOrigin: 'top left',
                            }}
                          >
                            <ResumeTemplatePreview resume={resumeDataMap[resume.id]} />
                          </div>
                        )
                      })()}
                    </div>
                  ) : (
                    <div className="resume-card-item-thumb-loading">
                      <Spin />
                    </div>
                  )}
                  <div className="resume-card-item-thumb-hint">点击放大查看</div>
                </div>
                <div className="resume-card-item-head">
                  <div>
                    {editingTitleId === resume.id ? (
                    <Input
                      autoFocus
                      size="small"
                      defaultValue={resume.title}
                      onBlur={(e) => { setEditingTitleId(null); void handleInlineTitleSave(resume.id, e.target.value) }}
                      onKeyDown={(e) => { if (e.key === "Enter") { (e.target as HTMLInputElement).blur() } else if (e.key === "Escape") { setEditingTitleId(null) } }}
                      style={{ width: 200 }}
                    />
                  ) : (
                    <h3
                      onDoubleClick={() => setEditingTitleId(resume.id)}
                      title="双击重命名"
                      style={{ cursor: "text", margin: 0 }}
                    >
                      {resume.title}
                    </h3>
                  )}
                    <p>
                      <Tag color="arcoblue">{TEMPLATE_LABELS[resume.templateId]}</Tag>
                      <span>更新于 {new Date(resume.updatedAt).toLocaleDateString('zh-CN')}</span>
                    </p>
                  </div>
                </div>
                <div className="resume-card-item-footer">
                  <Button icon={<IconEdit />} onClick={() => navigate(`/student/resumes/${resume.id}`)}>
                    编辑
                  </Button>
                  <Button
                    icon={<IconCopy />}
                    onClick={() => void handleDuplicate(resume.id)}
                    loading={busyId === resume.id}
                    title="复制为新简历"
                  >
                    复制
                  </Button>
                  <Button
                    icon={<IconDownload />}
                    onClick={async () => {
                      const data = resumeDataMap[resume.id]
                      if (!data) { Message.warning('简历数据未加载'); return }
                      setExportingId(resume.id)
                      try {
                        const container = exportContainerRef.current
                        if (!container) throw new Error('导出容器未就绪')
                        // 渲染简历到隐藏容器
                        const { createRoot } = await import('react-dom/client')
                        const { createElement } = await import('react')
                        const root = createRoot(container)
                        root.render(createElement(ResumeTemplatePreview, { resume: data }))
                        await new Promise(r => setTimeout(r, 500))
                        await exportResumeElementToPdf(container, { filename: resume.title, scale: 2 })
                        root.unmount()
                        Message.success('导出成功')
                      } catch (err) {
                        Message.error((err as Error)?.message || '导出失败')
                      } finally {
                        setExportingId(null)
                      }
                    }}
                    loading={exportingId === resume.id}
                  >
                    导出
                  </Button>
                  <Popconfirm title="确定删除这份简历吗？" onOk={() => void handleDelete(resume.id)}>
                    <Button status="danger" icon={<IconDelete />} loading={busyId === resume.id}>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>


      {/* 新建简历 — 选择模板弹窗 */}
      <Modal
        className="new-resume-template-modal"
        visible={newResumeModalVisible}
        title="选择简历模板"
        footer={null}
        onCancel={() => setNewResumeModalVisible(false)}
        style={{ width: 900 }}
      >
        <div className="new-resume-modal-head">
          <p className="new-resume-modal-desc">
            选择一个模板开始创作，包括从空白开始。
          </p>
          <div className="new-resume-modal-actions">
            <Button shape="round" onClick={() => setNewResumeModalVisible(false)}>取消</Button>
            <Button shape="round" type="primary" onClick={handleCreateFromTemplate}>开始创作</Button>
          </div>
        </div>
        <div className="new-resume-template-grid">
          {TEMPLATE_REGISTRY.map((template) => (
            <button
              key={template.id}
              type="button"
              className={`new-resume-template-card${selectedTemplateId === template.id ? ' selected' : ''}`}
              onClick={() => setSelectedTemplateId(template.id)}
            >
              <div className="new-resume-template-thumb">
                <img src={template.thumbnailSrc} alt={template.name} />
              </div>
              <div className="new-resume-template-info">
                <span className="new-resume-template-name">{template.name}</span>
                <span className="new-resume-template-desc">{template.description}</span>
              </div>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        visible={previewingId !== null}
        title={previewingId !== null ? resumes.find((r) => r.id === previewingId)?.title || '简历预览' : '简历预览'}
        footer={null}
        onCancel={() => setPreviewingId(null)}
        className="resume-preview-modal"
        style={{ width: 'auto', maxWidth: 'none', top: 24, paddingBottom: 24 }}
      >
        <div className="resume-preview-modal-toolbar">
          <Button size="mini" onClick={zoomOut} disabled={previewScale <= 0.2} aria-label="缩小">
            −
          </Button>
          <span className="resume-preview-modal-scale-label">{Math.round(previewScale * 100)}%</span>
          <Button size="mini" onClick={zoomIn} disabled={previewScale >= 2} aria-label="放大">
            +
          </Button>
          <Button size="mini" type="secondary" onClick={zoomReset}>
            适窗
          </Button>
        </div>
        {previewingId !== null && resumeDataMap[previewingId] ? (
          <div className="resume-preview-modal-canvas" ref={previewCanvasRef}>
            <div
              className="resume-preview-modal-scaler"
              style={{
                width: A4_W,
                height: A4_H,
                transform: `scale(${previewScale})`,
                transformOrigin: 'top left',
                marginBottom: -((A4_H) * (1 - previewScale)),
                marginRight: -((A4_W) * (1 - previewScale)),
              }}
            >
              <ResumeTemplatePreview resume={resumeDataMap[previewingId]} />
            </div>
          </div>
        ) : (
          <div style={{ padding: 48, textAlign: 'center' }}><Spin /></div>
        )}
      </Modal>

      {/* 隐藏的导出容器：用于客户端 PDF 导出，与编辑器导出保持一致 */}
      <div
        ref={exportContainerRef}
        style={{
          position: 'fixed',
          left: '-9999px',
          top: 0,
          width: '210mm',
          minWidth: '210mm',
          background: '#fff',
          zIndex: -1,
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
