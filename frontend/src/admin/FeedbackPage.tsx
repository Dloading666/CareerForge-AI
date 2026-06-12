import { Button, Card, Drawer, Image, Message, Select, Space, Table, Tag, Typography } from '@arco-design/web-react'
import { IconBug, IconCheckCircle, IconEye } from '@arco-design/web-react/icon'
import { useEffect, useState } from 'react'
import { apiRequest } from '../shared/api'

interface FeedbackItem {
  id: number
  student_id: number
  student_name: string | null
  student_email: string | null
  description: string
  category: string
  screenshot_path: string | null
  created_at: string | null
  status: string
}

const categoryLabels: Record<string, { text: string; color: string }> = {
  bug: { text: 'Bug', color: 'red' },
  feature: { text: '功能建议', color: 'blue' },
  other: { text: '其他', color: 'gray' },
}

export function FeedbackPage() {
  const [list, setList] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(false)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined)
  const [detailItem, setDetailItem] = useState<FeedbackItem | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ page: String(page), size: "20" })
        if (statusFilter) params.set("status", statusFilter)
        const res = await apiRequest<{ list: FeedbackItem[]; total: number }>(`/api/v1/admin/feedback?${params}`)
        if (alive) { setList(res.list); setTotal(res.total) }
      } catch { if (alive) Message.error('加载失败') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [page, statusFilter])

  const fetchList = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), size: "20" })
      if (statusFilter) params.set("status", statusFilter)
      const res = await apiRequest<{ list: FeedbackItem[]; total: number }>(`/api/v1/admin/feedback?${params}`)
      setList(res.list)
      setTotal(res.total)
    } catch { Message.error('加载失败') }
    finally { setLoading(false) }
  }

  const handleResolve = async (id: number) => {
    try {
      await apiRequest(`/api/v1/admin/feedback/${id}`, { method: "PATCH", body: JSON.stringify({ status: "resolved" }) })
      Message.success('已标记为已解决')
      if (detailItem && detailItem.id === id) {
        setDetailItem({ ...detailItem, status: 'resolved' })
      }
      fetchList()
    } catch { Message.error('操作失败') }
  }

  const columns = [
    { title: '用户', width: 140, render: (_: unknown, r: FeedbackItem) => <span>{r.student_name || r.student_email || '匿名'}</span> },
    { title: '类型', width: 90, render: (_: unknown, r: FeedbackItem) => {
        const cl = categoryLabels[r.category] || { text: r.category, color: 'gray' }
        return <Tag color={cl.color}>{cl.text}</Tag>
    }},
    { title: '时间', width: 160, render: (_: unknown, r: FeedbackItem) => r.created_at ? new Date(r.created_at).toLocaleString('zh-CN') : '-' },
    { title: '状态', width: 80, render: (_: unknown, r: FeedbackItem) => <Tag color={r.status === 'open' ? 'orangered' : 'green'}>{r.status === 'open' ? '待处理' : '已解决'}</Tag> },
    {
      title: '操作', width: 70,
      render: (_: unknown, r: FeedbackItem) => (
        <Button type="text" size="small" icon={<IconEye />} onClick={() => setDetailItem(r)}>详情</Button>
      ),
    },
  ]

  return (
    <div style={{ padding: "20px 0" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <IconBug style={{ fontSize: 24, color: "#f53f3f" }} />
          <h2 style={{ margin: 0 }}>用户反馈</h2>
          <Tag>{total} 条</Tag>
        </div>
        <Select value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(1) }} placeholder="状态筛选" allowClear style={{ width: 140 }}>
          <Select.Option value="open">待处理</Select.Option>
          <Select.Option value="resolved">已解决</Select.Option>
        </Select>
      </div>
      <Card>
        <Table
          columns={columns}
          data={list}
          loading={loading}
          rowKey="id"
          pagination={{ current: page, total, pageSize: 20, onChange: (p) => setPage(p), showTotal: true }}
        />
      </Card>

      <Drawer
        title="反馈详情"
        visible={!!detailItem}
        width={520}
        onCancel={() => setDetailItem(null)}
        footer={null}
      >
        {detailItem && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>用户信息</Typography.Text>
              <div style={{ marginTop: 4 }}>
                <Typography.Text bold>{detailItem.student_name || '未知'}</Typography.Text>
                <Typography.Text type="secondary" style={{ marginLeft: 12 }}>{detailItem.student_email || '无邮箱'}</Typography.Text>
              </div>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>类型 & 状态</Typography.Text>
              <Space style={{ marginTop: 4 }}>
                <Tag color={categoryLabels[detailItem.category]?.color || 'gray'}>{categoryLabels[detailItem.category]?.text || detailItem.category}</Tag>
                <Tag color={detailItem.status === 'open' ? 'orangered' : 'green'}>{detailItem.status === 'open' ? '待处理' : '已解决'}</Tag>
              </Space>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>时间</Typography.Text>
              <div style={{ marginTop: 4 }}>{detailItem.created_at ? new Date(detailItem.created_at).toLocaleString('zh-CN') : '-'}</div>
            </div>
            <div>
              <Typography.Text type="secondary" style={{ fontSize: 13 }}>问题描述</Typography.Text>
              <div style={{ marginTop: 4, padding: 12, background: "#f7f8fa", borderRadius: 8, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{detailItem.description}</div>
            </div>
            {detailItem.screenshot_path && (
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>截图</Typography.Text>
                <div style={{ marginTop: 4 }}>
                  <Image
                    src={`/feedback-images/${detailItem.screenshot_path.replace('feedbacks/', '')}`}
                    style={{ maxWidth: '100%', borderRadius: 8, cursor: 'pointer' }}
                  />
                </div>
              </div>
            )}
            {detailItem.status === 'open' && (
              <Button type="primary" status="success" icon={<IconCheckCircle />} long onClick={() => handleResolve(detailItem.id)}>
                标记为已解决
              </Button>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}