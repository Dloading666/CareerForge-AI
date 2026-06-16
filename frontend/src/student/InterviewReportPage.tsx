import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin, Button, Message } from '@arco-design/web-react'
import { IconLeft } from '@arco-design/web-react/icon'
import { InterviewReport, type InterviewReportData } from './InterviewReport'
import { apiRequest } from '../shared/api'

export function InterviewReportPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [report, setReport] = useState<InterviewReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadReport = async () => {
    if (!sessionId) return
    setLoading(true)
    setError(null)
    try {
      const data = await apiRequest<InterviewReportData>(
        `/api/v1/student/interviews/${sessionId}/report`
      )
      if (!data || typeof data.overall_score !== 'number') {
        setError('报告数据不完整')
        return
      }
      setReport(data)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '加载报告失败'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReport()
  }, [sessionId])

  const handlePracticeAgain = (preset?: InterviewReportData['next_session_preset']) => {
    if (!preset) return
    navigate('/student/interviewer', {
      state: {
        practicePreset: {
          targetRole: preset.target_role,
          interviewType: preset.interview_type,
          interviewStyle: preset.interview_style,
        },
      },
    })
    Message.success('已加载预设配置，请检查后开始新一轮面试')
  }

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '24px 28px', background: '#FAFAFF' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        {/* Back button */}
        <Button
          type="text"
          icon={<IconLeft />}
          onClick={() => navigate('/student/interviewer')}
          style={{ marginBottom: 20, color: '#4E5969', fontWeight: 500 }}
        >
          返回面试
        </Button>

        {loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#86909C' }}>
            <Spin size={24} />
            <p style={{ marginTop: 16 }}>正在加载报告...</p>
          </div>
        )}

        {error && !loading && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: '#86909C' }}>
            <p style={{ color: '#DC2626', marginBottom: 16 }}>{error}</p>
            <Button onClick={loadReport}>重新加载</Button>
          </div>
        )}

        {report && !loading && (
          <InterviewReport
            report={report}
            onPracticeAgain={handlePracticeAgain}
          />
        )}
      </div>
    </div>
  )
}
