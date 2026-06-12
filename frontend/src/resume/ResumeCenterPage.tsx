import { Button, Empty, Message, Modal, Popconfirm, Spin, Switch, Tag } from '@arco-design/web-react'
import { IconDelete, IconDownload, IconEdit, IconPlus, IconRefresh, IconUpload } from '@arco-design/web-react/icon'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'


import { ApiError } from '../shared/api'
import { deleteResume, downloadResumePdf, getResume, importResumeFile, listResumes, updateResume } from './api'
import { TEMPLATE_LABELS } from './constants'
import { ResumeTemplatePreview } from './templates/registry'
import { TEMPLATE_REGISTRY } from './templates/templateRegistry'
import type { ResumeData, ResumeSummary, TemplateId } from './types'

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

  const handleVisibilityChange = async (resumeId: number, visibility: boolean) => {
    setBusyId(resumeId)
    try {
      const detail = await getResume(resumeId)
      await updateResume({ ...detail, visibility })
      Message.success('可读取状态已更新')
      await refresh()
    } catch {
      Message.error('更新失败')
    } finally {
      setBusyId(null)
    }
  }

  const handleImport = async (file: File) => {
    if (resumes.length >= MAX_RESUMES) {
      Message.warning(`简历数量已达上限（${MAX_RESUMES} 份），请先删除一份简历`)
      return
    }
    setImporting(true)
    try {
      const res = await importResumeFile(file)
      Message.success(`已导入「${res.title}」，请核对内容后保存`)
      setImportModalVisible(false)
      await refresh()
      navigate(`/student/resumes/${res.resume_id}?imported=1`)
    } catch (error) {
      Message.error(error instanceof ApiError ? error.message : '导入失败，请检查文件格式')
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
          <Button icon={<IconUpload />} onClick={() => setImportModalVisible(true)}>
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
        onCancel={() => setImportModalVisible(false)}
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
                    <h3>{resume.title}</h3>
                    <p>
                      <Tag color="arcoblue">{TEMPLATE_LABELS[resume.templateId]}</Tag>
                      <span>更新于 {new Date(resume.updatedAt).toLocaleDateString('zh-CN')}</span>
                    </p>
                  </div>
                  <div className="resume-card-switch">
                    <span>智能体可读取</span>
                    <Switch checked={resume.visibility} onChange={(checked) => void handleVisibilityChange(resume.id, checked)} />
                  </div>
                </div>
                <div className="resume-card-item-footer">
                  <Button icon={<IconEdit />} onClick={() => navigate(`/student/resumes/${resume.id}`)}>
                    编辑
                  </Button>
                  <Button
                    icon={<IconDownload />}
                    onClick={() => void downloadResumePdf(resume.id, resume.title)}
                    loading={busyId === resume.id}
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
        visible={newResumeModalVisible}
        title="选择简历模板"
        okText="开始创作"
        cancelText="取消"
        onOk={() => {
          setNewResumeModalVisible(false)
          const url = selectedTemplateId === 'blank'
            ? '/student/resumes/new'
            : `/student/resumes/new?template=${selectedTemplateId}`
          navigate(url)
        }}
        onCancel={() => setNewResumeModalVisible(false)}
        style={{ width: 900 }}
      >
        <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14 }}>
          选择一个模板开始创作，包括从空白开始。
        </p>
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
    </div>
  )
}
