import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from "@arco-design/web-react"
import type { TableColumnProps } from "@arco-design/web-react"
import {
  IconDelete,
  IconEdit,
  IconLock,
  IconNotification,
  IconPlus,

  IconSettings,
} from "@arco-design/web-react/icon"
import { useEffect, useState } from "react"
import { apiRequest, ApiError } from "../shared/api"

// ── types ──────────────────────────────────────

interface SystemConfigData {
  platform_name: string
  maintenance_mode: string
  maintenance_message: string
}

type AnnounceType = "info" | "warning" | "success" | "error"

interface Announcement {
  id: number
  title: string
  content: string
  announcement_type: AnnounceType
  priority: number
  is_active: boolean
  start_time: string | null
  end_time: string | null
  created_by: number | null
  created_at: string
  updated_at: string
}

interface AnnounceListResponse {
  list: Announcement[]
  total: number
}

interface AnnounceDraft {
  title: string
  content: string
  announcement_type: AnnounceType
  priority: number
  is_active: boolean
  start_time: string | null
  end_time: string | null
}

const EMPTY_DRAFT: AnnounceDraft = {
  title: "",
  content: "",
  announcement_type: "info",
  priority: 0,
  is_active: true,
  start_time: null,
  end_time: null,
}

const EMPTY_CONFIG: SystemConfigData = {
  platform_name: "CareerForge",
  maintenance_mode: "false",
  maintenance_message: "系统维护中，请稍后再试",
}

const TYPE_LABELS: Record<AnnounceType, string> = {
  info: "信息",
  warning: "警告",
  success: "成功",
  error: "错误",
}

const TYPE_COLORS: Record<AnnounceType, string> = {
  info: "blue",
  warning: "orange",
  success: "green",
  error: "red",
}

// ── helpers ────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function isoToDate(iso: string | null): Date | undefined {
  if (!iso) return undefined
  const d = new Date(iso)
  return isNaN(d.getTime()) ? undefined : d
}

// ── sub-component: MenuCard ────────────────────

function MenuCard({
  icon,
  title,
  desc,
  accentColor,
  onClick,
  badge,
}: {
  icon: React.ReactNode
  title: string
  desc: string
  accentColor: string
  onClick: () => void
  badge?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "20px 28px",
        background: "#fff",
        borderRadius: 16,
        cursor: "pointer",
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
        border: "1px solid transparent",
        transition: "all 0.2s ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = "0 4px 20px rgba(0,0,0,0.06)"
        e.currentTarget.style.borderColor = `${accentColor}20`
        e.currentTarget.style.transform = "translateY(-1px)"
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = "0 1px 2px rgba(0,0,0,0.03)"
        e.currentTarget.style.borderColor = "transparent"
        e.currentTarget.style.transform = "translateY(0)"
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: 14,
          background: `${accentColor}12`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 20,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-1)" }}>
            {title}
          </span>
          {badge}
        </div>
        <div style={{ fontSize: 14, color: "var(--color-text-3)", marginTop: 3, lineHeight: "20px" }}>
          {desc}
        </div>
      </div>
      <span style={{ fontSize: 18, color: "#c9cdd4", marginLeft: 12 }}>›</span>
    </div>
  )
}

// ── component ──────────────────────────────────

export function SystemSettings() {
  // system config
  const [config, setConfig] = useState<SystemConfigData>({ ...EMPTY_CONFIG })
  const [configLoading, setConfigLoading] = useState(true)
  const [configSaving, setConfigSaving] = useState(false)
  const [configModalVisible, setConfigModalVisible] = useState(false)

  // announcements
  const [anns, setAnns] = useState<Announcement[]>([])
  const [annTotal, setAnnTotal] = useState(0)
  const [annPage, setAnnPage] = useState(1)
  const [annSize] = useState(10)
  const [annLoading, setAnnLoading] = useState(true)
  const [annActiveOnly, setAnnActiveOnly] = useState(false)
  const [annModalVisible, setAnnModalVisible] = useState(false)

  // announcement edit modal
  const [editModalVisible, setEditModalVisible] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState<AnnounceDraft>({ ...EMPTY_DRAFT })
  const [modalSaving, setModalSaving] = useState(false)

  // notify
  const [notify, setNotify] = useState<{
    type: "success" | "error"
    text: string
  } | null>(null)

  const showNotify = (type: "success" | "error", text: string) => {
    setNotify({ type, text })
    setTimeout(() => setNotify(null), 3000)
  }

  // ── fetch system config ─────────────────────

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const data = await apiRequest<SystemConfigData & Record<string, string>>(
          "/api/v1/admin/system/config"
        )
        if (alive) setConfig({
          platform_name: data.platform_name || "CareerForge",
          maintenance_mode: data.maintenance_mode || "false",
          maintenance_message: data.maintenance_message || "系统维护中，请稍后再试",
        })
      } catch {
        if (alive) showNotify("error", "加载系统配置失败")
      } finally {
        if (alive) setConfigLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  const fetchConfig = async () => {
    try {
      const data = await apiRequest<SystemConfigData & Record<string, string>>(
        "/api/v1/admin/system/config"
      )
      setConfig({
        platform_name: data.platform_name || "CareerForge",
        maintenance_mode: data.maintenance_mode || "false",
        maintenance_message: data.maintenance_message || "系统维护中，请稍后再试",
      })
    } catch {
      showNotify("error", "加载系统配置失败")
    } finally {
      setConfigLoading(false)
    }
  }

  // ── fetch announcements ─────────────────────

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (alive) setAnnLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(annPage),
          size: String(annSize),
          active_only: String(annActiveOnly),
        })
        const data = await apiRequest<AnnounceListResponse>(
          `/api/v1/admin/announcements?${params}`
        )
        if (alive) { setAnns(data.list); setAnnTotal(data.total) }
      } catch {
        if (alive) showNotify("error", "加载公告列表失败")
      } finally {
        if (alive) setAnnLoading(false)
      }
    })()
    return () => { alive = false }
  }, [annPage, annSize, annActiveOnly])

  const fetchAnns = async () => {
    setAnnLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(annPage),
        size: String(annSize),
        active_only: String(annActiveOnly),
      })
      const data = await apiRequest<AnnounceListResponse>(
        `/api/v1/admin/announcements?${params}`
      )
      setAnns(data.list)
      setAnnTotal(data.total)
    } catch {
      showNotify("error", "加载公告列表失败")
    } finally {
      setAnnLoading(false)
    }
  }

  // ── save config ─────────────────────────────

  const handleSaveConfig = async () => {
    setConfigSaving(true)
    try {
      const items = [
        { config_key: "platform_name", config_value: config.platform_name },
        { config_key: "maintenance_mode", config_value: config.maintenance_mode },
        { config_key: "maintenance_message", config_value: config.maintenance_message },
      ]
      await apiRequest("/api/v1/admin/system/config", {
        method: "PUT",
        body: JSON.stringify({ items }),
      })
      showNotify("success", "系统配置已保存")
      setConfigModalVisible(false)
    } catch (err) {
      showNotify("error", err instanceof ApiError ? err.message : "保存失败")
    } finally {
      setConfigSaving(false)
    }
  }

  // ── announcement CRUD ───────────────────────

  const openCreateModal = () => {
    setEditingId(null)
    setDraft({ ...EMPTY_DRAFT })
    setEditModalVisible(true)
  }

  const openEditModal = (ann: Announcement) => {
    setEditingId(ann.id)
    setDraft({
      title: ann.title,
      content: ann.content,
      announcement_type: ann.announcement_type,
      priority: ann.priority,
      is_active: ann.is_active,
      start_time: ann.start_time,
      end_time: ann.end_time,
    })
    setEditModalVisible(true)
  }

  const handleSaveAnn = async () => {
    if (!draft.title.trim()) {
      showNotify("error", "请输入公告标题")
      return
    }
    if (!draft.content.trim()) {
      showNotify("error", "请输入公告内容")
      return
    }
    setModalSaving(true)
    try {
      const body: Record<string, unknown> = {
        title: draft.title.trim(),
        content: draft.content.trim(),
        announcement_type: draft.announcement_type,
        priority: draft.priority,
        is_active: draft.is_active,
        start_time: draft.start_time || null,
        end_time: draft.end_time || null,
      }
      if (editingId) {
        await apiRequest(`/api/v1/admin/announcements/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(body),
        })
        showNotify("success", "公告已更新")
      } else {
        await apiRequest("/api/v1/admin/announcements", {
          method: "POST",
          body: JSON.stringify(body),
        })
        showNotify("success", "公告已创建")
      }
      setEditModalVisible(false)
      void fetchAnns()
    } catch (err) {
      showNotify("error", err instanceof ApiError ? err.message : "保存失败")
    } finally {
      setModalSaving(false)
    }
  }

  const handleDeleteAnn = async (id: number) => {
    try {
      await apiRequest(`/api/v1/admin/announcements/${id}`, { method: "DELETE" })
      showNotify("success", "公告已删除")
      void fetchAnns()
    } catch (err) {
      showNotify("error", err instanceof ApiError ? err.message : "删除失败")
    }
  }

  const handleToggleActive = async (ann: Announcement, checked: boolean) => {
    try {
      await apiRequest(`/api/v1/admin/announcements/${ann.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: checked }),
      })
      void fetchAnns()
    } catch {
      showNotify("error", "操作失败")
    }
  }

  // ── table columns ───────────────────────────

  const columns: TableColumnProps<Announcement>[] = [
    {
      title: "类型",
      dataIndex: "announcement_type",
      width: 80,
      render: (_col: unknown, record: Announcement) => (
        <Tag color={TYPE_COLORS[record.announcement_type]} bordered>
          {TYPE_LABELS[record.announcement_type]}
        </Tag>
      ),
    },
    {
      title: "标题",
      dataIndex: "title",
      ellipsis: true,
      render: (_col: unknown, record: Announcement) => (
        <span style={{ fontWeight: 500 }}>{record.title}</span>
      ),
    },
    {
      title: "优先级",
      dataIndex: "priority",
      width: 80,
      align: "center" as const,
      render: (_col: unknown, record: Announcement) => (
        <Tag bordered={false}>{record.priority}</Tag>
      ),
    },
    {
      title: "状态",
      dataIndex: "is_active",
      width: 80,
      align: "center" as const,
      render: (_col: unknown, record: Announcement) => (
        <Switch
          size="small"
          checked={record.is_active}
          onChange={(checked: boolean) => handleToggleActive(record, checked)}
        />
      ),
    },
    {
      title: "生效时间",
      dataIndex: "start_time",
      width: 160,
      render: (_col: unknown, record: Announcement) => (
        <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
          {formatDate(record.start_time)}
        </span>
      ),
    },
    {
      title: "失效时间",
      dataIndex: "end_time",
      width: 160,
      render: (_col: unknown, record: Announcement) => (
        <span style={{ fontSize: 12, color: "var(--color-text-2)" }}>
          {formatDate(record.end_time)}
        </span>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updated_at",
      width: 160,
      render: (_col: unknown, record: Announcement) => (
        <span style={{ fontSize: 12, color: "var(--color-text-3)" }}>
          {formatDate(record.updated_at)}
        </span>
      ),
    },
    {
      title: "操作",
      width: 120,
      align: "center" as const,
      render: (_col: unknown, record: Announcement) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<IconEdit />}
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除这条公告吗？"
            okText="删除"
            cancelText="取消"
            onOk={() => handleDeleteAnn(record.id)}
          >
            <Button type="text" size="small" status="danger" icon={<IconDelete />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const activeCount = anns.filter((a) => a.is_active).length

  // ── render ──────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {notify && (
        <Alert
          type={notify.type}
          content={notify.text}
          closable
          style={{ marginBottom: 0 }}
          onClose={() => setNotify(null)}
        />
      )}

      {/* ── 系统设置卡片 ────────────────────── */}
      <MenuCard
        icon={<IconSettings style={{ fontSize: 26, color: "#165dff" }} />}
        title="系统设置"
        desc="平台名称、维护模式等全局配置"
        accentColor="#165dff"
        onClick={() => {
          void fetchConfig()
          setConfigModalVisible(true)
        }}
      />

      {/* ── 公告管理卡片 ────────────────────── */}
      <MenuCard
        icon={<IconNotification style={{ fontSize: 26, color: "#f53f3f" }} />}
        title="公告管理"
        desc={
          annTotal > 0
            ? `共 ${annTotal} 条公告，${activeCount} 条生效中`
            : "创建和维护平台公告"
        }
        accentColor="#f53f3f"
        onClick={() => {
          void fetchAnns()
          setAnnModalVisible(true)
        }}
        badge={
          activeCount > 0 ? (
            <Tag color="red" size="small">
              {activeCount}
            </Tag>
          ) : undefined
        }
      />

      {/* ── 运行偏好卡片 ────────────────────── */}
      <MenuCard
        icon={<IconLock style={{ fontSize: 26, color: "#722ed1" }} />}
        title="运行偏好"
        desc="管理端操作审计、异常通知与安全策略"
        accentColor="#722ed1"
        onClick={() => showNotify("success", "运行偏好功能开发中")}
      />

      {/* ═══════════════════════════════════════════
          Modal: 系统配置
          ═══════════════════════════════════════════ */}
      <Modal
        title="系统设置"
        visible={configModalVisible}
        onCancel={() => setConfigModalVisible(false)}
        onOk={handleSaveConfig}
        confirmLoading={configSaving}
        okText="保存"
        cancelText="取消"
        style={{ width: 500 }}
      >
        {configLoading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-3)" }}>
            加载中...
          </div>
        ) : (
          <Form layout="vertical" style={{ marginTop: 8 }}>
            <Form.Item label="平台名称">
              <Input
                size="large"
                value={config.platform_name}
                onChange={(val: string) =>
                  setConfig((c) => ({ ...c, platform_name: val }))
                }
                placeholder="CareerForge"
              />
            </Form.Item>

            <Form.Item>
              <Space size={12}>
                <Switch
                  checked={config.maintenance_mode === "true"}
                  onChange={(val: boolean) =>
                    setConfig((c) => ({
                      ...c,
                      maintenance_mode: val ? "true" : "false",
                    }))
                  }
                />
                <span style={{ fontSize: 14, color: "var(--color-text-2)" }}>
                  维护模式
                </span>
              </Space>
            </Form.Item>
            {config.maintenance_mode === "true" && (
              <Form.Item label="维护提示语">
                <Input.TextArea
                  value={config.maintenance_message}
                  onChange={(val: string) =>
                    setConfig((c) => ({ ...c, maintenance_message: val }))
                  }
                  placeholder="系统维护中，请稍后再试"
                  autoSize={{ minRows: 2, maxRows: 4 }}
                />
              </Form.Item>
            )}
          </Form>
        )}
      </Modal>

      {/* ═══════════════════════════════════════════
          Modal: 公告管理
          ═══════════════════════════════════════════ */}
      <Modal
        title="公告管理"
        visible={annModalVisible}
        onCancel={() => setAnnModalVisible(false)}
        footer={null}
        style={{ width: 960 }}
      >
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Space size={12}>
            <span style={{ fontSize: 13, color: "var(--color-text-2)" }}>
              仅显示生效中
            </span>
            <Switch
              size="small"
              checked={annActiveOnly}
              onChange={(val: boolean) => {
                setAnnActiveOnly(val)
                setAnnPage(1)
              }}
            />
          </Space>
          <Button type="primary" size="small" icon={<IconPlus />} onClick={openCreateModal}>
            新建公告
          </Button>
        </div>

        <Table<Announcement>
          columns={columns}
          data={anns}
          loading={annLoading}
          rowKey="id"
          pagination={false}
          stripe={false}
          size="middle"
          noDataElement={
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-text-3)" }}>
              暂无公告，点击右上角"新建公告"开始
            </div>
          }
        />

        {annTotal > annSize && (
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <Pagination
              current={annPage}
              total={annTotal}
              pageSize={annSize}
              size="small"
              onChange={(page: number) => setAnnPage(page)}
              showTotal
            />
          </div>
        )}
      </Modal>

      {/* ═══════════════════════════════════════════
          Modal: 新建/编辑公告
          ═══════════════════════════════════════════ */}
      <Modal
        title={editingId ? "编辑公告" : "新建公告"}
        visible={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        onOk={handleSaveAnn}
        confirmLoading={modalSaving}
        okText={editingId ? "更新" : "创建"}
        cancelText="取消"
        style={{ width: 560 }}
      >
        <Form layout="vertical" style={{ marginTop: 8 }}>
          <Form.Item label="公告标题" required>
            <Input
              value={draft.title}
              onChange={(val: string) =>
                setDraft((d) => ({ ...d, title: val }))
              }
              placeholder="输入公告标题"
              maxLength={256}
            />
          </Form.Item>

          <Form.Item label="公告内容" required>
            <Input.TextArea
              value={draft.content}
              onChange={(val: string) =>
                setDraft((d) => ({ ...d, content: val }))
              }
              placeholder="输入公告内容..."
              autoSize={{ minRows: 3, maxRows: 8 }}
            />
          </Form.Item>

          <Space size={16} wrap>
            <Form.Item label="公告类型">
              <Select
                value={draft.announcement_type}
                onChange={(val) =>
                  setDraft((d) => ({
                    ...d,
                    announcement_type: val as AnnounceType,
                  }))
                }
                style={{ width: 140 }}
              >
                {(
                  ["info", "warning", "success", "error"] as AnnounceType[]
                ).map((t) => (
                  <Select.Option key={t} value={t}>
                    <Tag color={TYPE_COLORS[t]} bordered size="small">
                      {TYPE_LABELS[t]}
                    </Tag>
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item label="优先级">
              <InputNumber
                value={draft.priority}
                onChange={(val: number | undefined) =>
                  setDraft((d) => ({ ...d, priority: val ?? 0 }))
                }
                min={0}
                max={99}
                style={{ width: 100 }}
              />
            </Form.Item>

            <Form.Item label="启用">
              <Switch
                checked={draft.is_active}
                onChange={(val: boolean) =>
                  setDraft((d) => ({ ...d, is_active: val }))
                }
              />
            </Form.Item>
          </Space>

          <Space size={16}>
            <Form.Item label="生效时间">
              <DatePicker
                showTime
                value={isoToDate(draft.start_time)}
                onChange={(_: string, d: unknown) =>
                  setDraft((prev) => ({
                    ...prev,
                    start_time: d
                      ? new Date(d as string).toISOString()
                      : null,
                  }))
                }
                placeholder="不限"
                allowClear
              />
            </Form.Item>

            <Form.Item label="失效时间">
              <DatePicker
                showTime
                value={isoToDate(draft.end_time)}
                onChange={(_: string, d: unknown) =>
                  setDraft((prev) => ({
                    ...prev,
                    end_time: d
                      ? new Date(d as string).toISOString()
                      : null,
                  }))
                }
                placeholder="不限"
                allowClear
              />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  )
}
