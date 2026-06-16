import { useEffect, useState, useMemo, useCallback } from 'react'
import { Drawer, Popconfirm, Message } from '@arco-design/web-react'
import { IconDelete, IconRefresh } from '@arco-design/web-react/icon'
import { apiRequest } from '../shared/api'

type InterviewSession = {
  id: number
  target_role: string
  interview_type: string
  interview_style: string
  difficulty: string
  round_limit: number
  status: string
  created_at?: string | null
  ended_at?: string | null
}

interface InterviewHistoryDrawerProps {
  visible: boolean
  onClose: () => void
  onSelect: (sessionId: number) => void
  activeSessionId?: number | null
  onSessionDeleted?: (sessionId: number) => void
}

function formatDateLabel(ts?: string | null): string {
  if (!ts) return '未知日期'
  const d = new Date(ts)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = Math.floor((today.getTime() - target.getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 7) return `${diff} 天前`
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTimeLabel(ts?: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function InterviewHistoryDrawer({
  visible,
  onClose,
  onSelect,
  activeSessionId,
  onSessionDeleted,
}: InterviewHistoryDrawerProps) {
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [collapsedDates, setCollapsedDates] = useState<Set<string>>(new Set())

  const loadSessions = useCallback(async () => {
    try {
      const list = await apiRequest<InterviewSession[]>('/api/v1/student/interviews')
      setSessions(Array.isArray(list) ? list : [])
    } catch {
      setSessions([])
    }
  }, [])

  useEffect(() => {
    if (visible) loadSessions()
  }, [visible, loadSessions])

  const groups = useMemo(() => {
    const map: Record<string, InterviewSession[]> = {}
    for (const s of sessions) {
      const key = formatDateLabel(s.created_at)
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return Object.entries(map).sort((a, b) => {
      const aFirst = a[1][0]?.created_at ?? ''
      const bFirst = b[1][0]?.created_at ?? ''
      return bFirst.localeCompare(aFirst)
    })
  }, [sessions])

  const toggleDate = (date: string) => {
    setCollapsedDates((prev) => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const handleDelete = async (item: InterviewSession) => {
    try {
      await apiRequest(`/api/v1/student/interviews/${item.id}`, { method: 'DELETE' })
      Message.success('已删除')
      setSessions((prev) => prev.filter((s) => s.id !== item.id))
      onSessionDeleted?.(item.id)
    } catch {
      Message.error('删除失败')
    }
  }

  return (
    <Drawer
      title="面试记录"
      visible={visible}
      onCancel={onClose}
      placement="left"
      width={360}
      footer={null}
      className="interview-history-drawer"
    >
      <div style={{ marginBottom: 12, textAlign: 'right' }}>
        <button
          type="button"
          onClick={() => void loadSessions()}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#165DFF',
            cursor: 'pointer',
            fontSize: 13,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <IconRefresh /> 刷新
        </button>
      </div>

      {groups.length === 0 ? (
        <p style={{ textAlign: 'center', color: '#86909C', padding: '40px 0' }}>
          暂无历史面试
        </p>
      ) : (
        groups.map(([date, items]) => (
          <div key={date} style={{ marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => toggleDate(date)}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '6px 0',
                color: '#1D2129',
                fontSize: 13,
                fontWeight: 600,
                textAlign: 'left',
              }}
            >
              <span style={{ fontSize: 12, color: '#86909C' }}>
                {collapsedDates.has(date) ? '›' : '⌄'}
              </span>
              <span>{date}</span>
              <span style={{
                fontSize: 11, color: '#86909C', background: '#F2F3F5',
                padding: '1px 8px', borderRadius: 10, fontWeight: 400,
              }}>
                {items.length}
              </span>
            </button>

            {!collapsedDates.has(date) && items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '8px 10px', borderRadius: 8, marginBottom: 2,
                  background: activeSessionId === item.id ? 'rgba(22,93,255,0.08)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <button
                  type="button"
                  onClick={() => { onSelect(item.id); onClose() }}
                  style={{
                    flex: 1, border: 'none', background: 'transparent',
                    cursor: 'pointer', textAlign: 'left', padding: 0,
                  }}
                >
                  <b style={{
                    display: 'block', fontSize: 13, color: '#1D2129',
                    fontWeight: activeSessionId === item.id ? 700 : 500,
                  }}>
                    {formatTimeLabel(item.created_at)}
                  </b>
                  <span style={{ fontSize: 12, color: '#4E5969' }}>
                    {item.target_role || '未填写目标岗位'}
                  </span>
                  <small style={{ display: 'block', fontSize: 11, color: '#86909C' }}>
                    {item.status === 'active' ? '进行中' : '已结束'} · {item.round_limit} 轮
                  </small>
                </button>
                <Popconfirm
                  title="确定删除这条面试记录？"
                  onOk={() => handleDelete(item)}
                >
                  <button
                    type="button"
                    style={{
                      border: 'none', background: 'transparent',
                      color: '#C9CDD4', cursor: 'pointer', padding: 4,
                      borderRadius: 4, flexShrink: 0,
                    }}
                    aria-label="删除面试记录"
                  >
                    <IconDelete style={{ fontSize: 14 }} />
                  </button>
                </Popconfirm>
              </div>
            ))}
          </div>
        ))
      )}
    </Drawer>
  )
}
