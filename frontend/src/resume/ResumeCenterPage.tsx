import { Button, Empty, Image, Message, Modal, Popconfirm, Spin, Switch, Tag, Typography } from '@arco-design/web-react'
import { IconDelete, IconDownload, IconEdit, IconPlus, IconRefresh, IconUpload } from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'

import { deleteResume, downloadResumePdf, getResume, importResume, listResumes, updateResume } from './api'
import { TEMPLATE_LABELS } from './constants'
import { TEMPLATE_REGISTRY, getTemplateConfig } from './templates/registry'
import type { ResumeData, ResumeSummary } from './types'

export function ResumeCenterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [previewTemplateId, setPreviewTemplateId] = useState<ResumeSummary['templateId'] | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)

  const mode = searchParams.get('mode')

  const countLabel = useMemo(() => `${resumes.length}/5`, [resumes.length])
  const previewTemplate = useMemo(
    () => TEMPLATE_REGISTRY.find((item) => item.id === previewTemplateId) ?? null,
    [previewTemplateId],
  )

  const refresh = async () => {
    setLoading(true)
    try {
      const list = await listResumes()
      setResumes(list)
    } catch {
      Message.error('加载简历列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

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
    try {
      const raw = await file.text()
      const parsed = JSON.parse(raw) as ResumeData
      await importResume(parsed)
      Message.success('导入成功')
      await refresh()
    } catch {
      Message.error('导入失败，请确认 JSON 结构正确')
    }
  }

  return (
    <div className="resume-center-page">
      <div className="resume-center-header">

        <div className="resume-center-actions">
          <Button icon={<IconRefresh />} onClick={() => void refresh()} loading={loading}>
            刷新
          </Button>
          <Button icon={<IconUpload />} onClick={() => importRef.current?.click()}>
            导入 JSON
          </Button>
          <Button type="primary" icon={<IconPlus />} disabled={resumes.length >= 5} onClick={() => navigate('/student/resumes/new')}>
            新建简历
          </Button>
          <input
            ref={importRef}
            type="file"
            hidden
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleImport(file)
              event.target.value = ''
            }}
          />
        </div>
      </div>

      {mode === 'optimize' ? (
        <div className="resume-center-banner">
          简历优化入口已为你打开。你可以先在下方上传已有 PDF / Word，也可以直接编辑在线简历。
        </div>
      ) : null}

      <section className="resume-template-workbench">
        <div className="resume-template-workbench-head">
          <div>
            <span className="resume-template-workbench-kicker">Template Studio</span>
            <h3>先选模板，再进入创作</h3>
            <p>直接参考 magic-resume 的模板工作台体验，先看完整缩略图和质感，再开始新建简历。</p>
          </div>
          <Tag color="blue">3 套模板已接入</Tag>
        </div>

        <div className="resume-template-workbench-grid">
          {TEMPLATE_REGISTRY.map((template, index) => (
            <motion.article
              key={template.id}
              className="resume-template-workbench-card"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: index * 0.08 }}
              whileHover={{ y: -6, scale: 1.01 }}
            >
              <button
                type="button"
                className="resume-template-workbench-image"
                onClick={() => setPreviewTemplateId(template.id)}
              >
                <img src={template.thumbnailSrc} alt={template.name} />
              </button>
              <div className="resume-template-workbench-body">
                <div>
                  <h4>{template.name}</h4>
                  <p>{template.description}</p>
                </div>
                <div className="resume-template-workbench-actions">
                  <Button onClick={() => setPreviewTemplateId(template.id)}>预览模板</Button>
                  <Button type="primary" onClick={() => navigate(`/student/resumes/new?template=${template.id}`)}>
                    使用模板
                  </Button>
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="resume-center-block">
        <div className="resume-center-block-head">
          <div>
            <h3>我的在线简历</h3>
            
          </div>
          <Tag color="blue">已创建 {countLabel}</Tag>
        </div>

        {loading ? (
          <div className="resume-center-empty">
            <Spin />
          </div>
        ) : resumes.length === 0 ? (
          <div className="resume-center-empty">
            <Empty description="还没有在线简历，点击右上角“新建简历”开始。" />
          </div>
        ) : (
          <div className="resume-card-grid">
            {resumes.map((resume) => (
              <article key={resume.id} className="resume-card-item">
                <div className="resume-card-item-thumb">
                  <Image
                    src={getTemplateConfig(resume.templateId).thumbnailSrc}
                    alt={resume.title}
                    title={resume.title}
                    description='点击图片放大查看'
                    width="100%"
                    height="100%"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
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

      <Modal
        visible={Boolean(previewTemplate)}
        footer={null}
        onCancel={() => setPreviewTemplateId(null)}
        style={{ width: 1040 }}
        title={previewTemplate ? `${previewTemplate.name} 模板预览` : '模板预览'}
      >
        {previewTemplate ? (
          <div className="resume-template-preview-modal">
            <div className="resume-template-preview-modal-image">
              <img src={previewTemplate.thumbnailSrc} alt={previewTemplate.name} />
            </div>
            <div className="resume-template-preview-modal-side">
              <h4>{previewTemplate.name}</h4>
              <p>{previewTemplate.description}</p>
              <div className="resume-template-preview-modal-meta">
                <Tag color="arcoblue">A4 版式</Tag>
                <Tag color="cyan">实时预览</Tag>
                <Tag color="purple">支持导出 PDF</Tag>
              </div>
              <Button type="primary" long onClick={() => navigate(`/student/resumes/new?template=${previewTemplate.id}`)}>
                用这个模板新建简历
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
