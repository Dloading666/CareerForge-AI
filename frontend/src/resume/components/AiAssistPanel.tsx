import { Alert, Button, Input, Modal, Radio, Select, Space, Spin, Tag, Typography } from '@arco-design/web-react'
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

type InstructionKey = 'polish' | 'quantify' | 'concise' | 'expand' | 'translate_en' | 'custom'

const INSTRUCTIONS: { value: InstructionKey; label: string; description: string }[] = [
  { value: 'polish', label: '润色', description: '让表述更专业、流畅，不新增信息' },
  { value: 'quantify', label: '加量化', description: '在保留原意基础上补足可量化占位' },
  { value: 'concise', label: '精简', description: '在不丢失关键信息的前提下缩短表述' },
  { value: 'expand', label: '展开', description: '适度补充同类工作场景的常见关键动作' },
  { value: 'translate_en', label: '译为英文', description: '翻译成简洁的英文简历表述' },
  { value: 'custom', label: '自定义', description: '按你输入的具体指令改写' },
]

type AvailableModel = {
  id: number
  displayName: string
  provider: string
  capability: string
  modelIdentifier: string
}

type AssistResponse = { suggested: string; model: string; modelId: number; instruction: string }

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
  const [instruction, setInstruction] = useState<InstructionKey>('polish')
  const [customInstruction, setCustomInstruction] = useState<string>('')
  const [modelId, setModelId] = useState<number | null>(null)
  const [models, setModels] = useState<AvailableModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssistResponse | null>(null)
  const [edited, setEdited] = useState<string>('')

  // Reset state when reopened or section/text changes
  useEffect(() => {
    if (visible) {
      setInstruction('polish')
      setCustomInstruction('')
      setResult(null)
      setError(null)
      setEdited('')
    }
  }, [visible, section, resumeId])

  // Load student-visible models whenever the panel opens
  useEffect(() => {
    if (!visible) return
    let cancelled = false
    setModelsLoading(true)
    setModelsError(null)
    apiRequest<AvailableModel[]>('/api/v1/student/resumes/ai-assist/models')
      .then((list) => {
        if (cancelled) return
        setModels(list)
        if (list.length > 0) {
          setModelId((prev) => (prev && list.some((m) => m.id === prev) ? prev : list[0].id))
        } else {
          setModelId(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setModelsError((err as Error)?.message || '获取模型列表失败')
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [visible, resumeId])

  const plainCurrent = useMemo(() => {
    return (currentText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }, [currentText])

  const callApi = async () => {
    if (!modelId) {
      setError('暂无可用模型，请联系管理员在模型广场开启')
      return
    }
    if (instruction === 'custom' && !customInstruction.trim()) {
      setError('请输入自定义改写指令')
      return
    }
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
            modelId,
            customInstruction: instruction === 'custom' ? customInstruction : undefined,
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

  const instructionHelp = INSTRUCTIONS.find((it) => it.value === instruction)?.description

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
                <Tag color="green">指令：{INSTRUCTIONS.find((it) => it.value === (result.instruction as InstructionKey))?.label || result.instruction}</Tag>
              </div>
            ) : null}
          </div>
        </div>

        <div className="ai-assist-panel-controls">
          <Typography.Text bold style={{ marginRight: 8 }}>模型</Typography.Text>
          {modelsLoading ? (
            <Typography.Text type="secondary">加载中...</Typography.Text>
          ) : modelsError ? (
            <Typography.Text type="error">{modelsError}</Typography.Text>
          ) : models.length === 0 ? (
            <Typography.Text type="error">暂无可用模型，请联系管理员在模型广场开启</Typography.Text>
          ) : (
            <Select
              value={modelId ?? undefined}
              onChange={(v) => setModelId(typeof v === 'number' ? v : Number(v))}
              style={{ minWidth: 260 }}
              disabled={loading}
              placeholder="选择模型"
            >
              {models.map((m) => (
                <Select.Option key={m.id} value={m.id}>
                  {m.displayName} <span style={{ color: '#86909c', marginLeft: 4 }}>({m.provider})</span>
                </Select.Option>
              ))}
            </Select>
          )}
        </div>

        <div className="ai-assist-panel-controls">
          <Typography.Text bold style={{ marginRight: 8 }}>改写指令</Typography.Text>
          <Radio.Group
            type="button"
            value={instruction}
            onChange={(v) => setInstruction(v as InstructionKey)}
            disabled={loading}
          >
            {INSTRUCTIONS.map((it) => (
              <Radio key={it.value} value={it.value}>{it.label}</Radio>
            ))}
          </Radio.Group>
          <Typography.Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
            {instructionHelp}
          </Typography.Text>
        </div>

        {instruction === 'custom' ? (
          <div className="ai-assist-panel-controls">
            <Typography.Text bold style={{ marginRight: 8 }}>自定义指令</Typography.Text>
            <Input.TextArea
              value={customInstruction}
              onChange={setCustomInstruction}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder="例如：把这段改写成 3 个短句，每句不超过 20 字，并保持 STAR 结构"
              disabled={loading}
              style={{ flex: 1 }}
            />
          </div>
        ) : null}

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
              disabled={loading || !modelId}
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
