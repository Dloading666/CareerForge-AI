import { Alert, Button, Input, Modal, Radio, Space, Spin, Tag, Typography } from '@arco-design/web-react'
import { IconCheck, IconClose, IconRefresh } from '@arco-design/web-react/icon'
import { useEffect, useMemo, useState } from 'react'

import { apiRequest, ApiError } from '../../shared/api'

export type AiAssistSection =
  | 'experience'
  | 'project'
  | 'education'
  | 'skill'
  | 'selfEvaluation'
  | 'summary'

const SECTION_LABELS: Record<AiAssistSection, string> = {
  experience: '工作内容与成果',
  project: '项目亮点',
  education: '教育经历亮点',
  skill: '专业技能',
  selfEvaluation: '自我评价',
  summary: '个人简介',
}

const INSTRUCTIONS: { value: string; label: string; description: string }[] = [
  { value: 'polish', label: '润色', description: '让表达更专业、流畅，不新增信息' },
  { value: 'quantify', label: '加量化', description: '在保留原意基础上补入可量化占位' },
  { value: 'concise', label: '精简', description: '在不丢失关键信息的前提下缩短表达' },
  { value: 'expand', label: '展开', description: '适度补充同类工作场景的常见关键动作' },
  { value: 'translate_en', label: '译为英文', description: '翻译成简洁的英文简历表达' },
]

type AssistResponse = { suggested: string; model: string; instruction: string }

export function AiAssistPanel({
  visible,
  onClose,
  section,
  currentText,
  jdText,
  resumeId,
  onApply,
  applyLabel,
}: {
  visible: boolean
  onClose: () => void
  section: AiAssistSection
  currentText: string
  jdText?: string
  resumeId: number
  onApply: (text: string) => void
  applyLabel?: string
}) {
  const [instruction, setInstruction] = useState<string>('polish')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssistResponse | null>(null)
  const [edited, setEdited] = useState<string>('')

  // Reset state when reopened or section/text changes
  useEffect(() => {
    if (visible) {
      setInstruction('polish')
      setResult(null)
      setError(null)
      setEdited('')
    }
  }, [visible, section, resumeId])

  const plainCurrent = useMemo(() => {
    return (currentText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }, [currentText])

  const callApi = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiRequest<AssistResponse>(
        `/api/v1/student/resumes/${resumeId}/ai-assist`,
        {
          method: 'POST',
          body: JSON.stringify({
            section,
            instruction,
            currentText: currentText || '',
            jdText: jdText || undefined,
          }),
        },
      )
      setResult(resp)
      setEdited(resp.suggested)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || `请求失败 (${err.status})`)
      } else {
        setError((err as Error)?.message || '请求失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleApply = () => {
    if (!edited) return
    onApply(edited)
    onClose()
  }

  return (
    <Modal
      title={'AI 助手 · ' + SECTION_LABELS[section]}
      visible={visible}
      onCancel={onClose}
      footer={null}
      style={{ width: 880 }}
      unmountOnExit
    >
      <div className="ai-assist-panel">
        <div className="ai-assist-panel-row">
          <div className="ai-assist-panel-side">
            <Typography.Title heading={6} style={{ margin: '0 0 8px' }}>原文</Typography.Title>
            <div className="ai-assist-panel-original">
              {plainCurrent ? (
                <pre className="ai-assist-panel-pre">{plainCurrent}</pre>
              ) : (
                <Typography.Text type="secondary">（该字段暂无内容）</Typography.Text>
              )}
            </div>
          </div>
          <div className="ai-assist-panel-side">
            <Typography.Title heading={6} style={{ margin: '0 0 8px' }}>建议结果</Typography.Title>
            <Input.TextArea
              value={edited}
              onChange={setEdited}
              autoSize={{ minRows: 8, maxRows: 20 }}
              placeholder={loading ? 'AI 正在生成建议...' : '点击下方"生成建议"开始'}
              disabled={loading}
              allowClear
            />
            {result ? (
              <div className="ai-assist-panel-meta">
                <Tag color="arcoblue">模型：{result.model}</Tag>
                <Tag color="green">指令：{INSTRUCTIONS.find((it) => it.value === result.instruction)?.label || result.instruction}</Tag>
              </div>
            ) : null}
          </div>
        </div>

        <div className="ai-assist-panel-controls">
          <Typography.Text bold style={{ marginRight: 8 }}>改写指令</Typography.Text>
          <Radio.Group
            type="button"
            value={instruction}
            onChange={setInstruction}
            disabled={loading}
          >
            {INSTRUCTIONS.map((it) => (
              <Radio key={it.value} value={it.value}>{it.label}</Radio>
            ))}
          </Radio.Group>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {INSTRUCTIONS.find((it) => it.value === instruction)?.description}
          </Typography.Text>
        </div>

        {error ? (
          <Alert type="error" content={error} style={{ marginTop: 12 }} />
        ) : null}

        <div className="ai-assist-panel-footer">
          <Space>
            <Button onClick={onClose} icon={<IconClose />}>取消</Button>
            <Button
              type="secondary"
              onClick={callApi}
              loading={loading}
              icon={<IconRefresh />}
              disabled={loading}
            >
              {result ? '重新生成' : '生成建议'}
            </Button>
          </Space>
          <Button
            type="primary"
            onClick={handleApply}
            disabled={!result || loading || !edited}
            icon={<IconCheck />}
          >
            {applyLabel || '应用到字段'}
          </Button>
        </div>

        {loading ? (
          <div className="ai-assist-panel-loading">
            <Spin tip="AI 正在改写..." />
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
