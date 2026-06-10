import { Button, Empty, Image, Message, Modal, Popconfirm, Spin, Switch, Tag } from '@arco-design/web-react'
import { IconDelete, IconDownload, IconEdit, IconPlus, IconRefresh, IconUpload } from '@arco-design/web-react/icon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'


import { deleteResume, downloadResumePdf, getResume, importResume, listResumes, updateResume } from './api'
import { TEMPLATE_LABELS } from './constants'
import { TEMPLATE_REGISTRY } from './templates/registry'
import type { ResumeData, ResumeSummary, TemplateId } from './types'
import { ResumeGallery } from '../student/ResumeGallery'

export function ResumeCenterPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [busyId, setBusyId] = useState<number | null>(null)
  const [newResumeModalVisible, setNewResumeModalVisible] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>('classic')
  const importRef = useRef<HTMLInputElement | null>(null)

  const mode = searchParams.get('mode')

  const countLabel = useMemo(() => `${resumes.length}/5`, [resumes.length])


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
          <Button type="primary" icon={<IconPlus />} disabled={resumes.length >= 5} onClick={() => setNewResumeModalVisible(true)}>
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


      <section className="resume-gallery-host-section">
        <div className="resume-center-block-head">
          <div>
            <h3>上传的简历</h3>
            <p>支持 PDF / Word（.pdf / .docx / .doc），上传后可在下方查看与下载。</p>
          </div>
        </div>
        <div className="resume-gallery-host">
          <ResumeGallery embedded />
        </div>
      </section>

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
            <Empty description='还没有在线简历，点击右上角"新建简历"开始。' />
          </div>
        ) : (
          <div className="resume-card-grid">
            {resumes.map((resume) => (
              <article key={resume.id} className="resume-card-item">
                <div className="resume-card-item-thumb">
                  <Image
                    src={TEMPLATE_REGISTRY.find((t) => t.id === resume.templateId)?.thumbnailSrc}
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


      {/* 新建简历 — 选择模板弹窗 */}
      <Modal
        visible={newResumeModalVisible}
        title="选择简历模板"
        okText="开始创作"
        cancelText="取消"
        onOk={() => {
          setNewResumeModalVisible(false)
          navigate(`/student/resumes/new?template=${selectedTemplateId}`)
        }}
        onCancel={() => setNewResumeModalVisible(false)}
        style={{ width: 900 }}
      >
        <p style={{ margin: '0 0 16px', color: '#6b7280', fontSize: 14 }}>
          选择一套模板后，编辑器将预填充示例内容，方便你快速修改成自己的简历。
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
    </div>
  )
}
