import { Alert, Button, Form, Input, Space, Switch } from "@arco-design/web-react"
import { IconSave } from "@arco-design/web-react/icon"
import { useCallback, useEffect, useState } from "react"
import { apiRequest, ApiError } from "../shared/api"

interface SystemConfigData {
  platform_name: string
  announcement: string
  announcement_enabled: string
  maintenance_mode: string
  maintenance_message: string
}

const EMPTY_CONFIG: SystemConfigData = {
  platform_name: "智培职联",
  announcement: "",
  announcement_enabled: "false",
  maintenance_mode: "false",
  maintenance_message: "系统维护中，请稍后再试",
}

export function SystemSettings() {
  const [config, setConfig] = useState<SystemConfigData>({ ...EMPTY_CONFIG })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notify, setNotify] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const showNotify = (type: "success" | "error", text: string) => {
    setNotify({ type, text })
    setTimeout(() => setNotify(null), 3000)
  }

  const fetchConfig = useCallback(async () => {
    try {
      const data = await apiRequest<SystemConfigData>("/api/v1/admin/system/config")
      setConfig({ ...EMPTY_CONFIG, ...data })
    } catch {
      showNotify("error", "加载系统配置失败")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchConfig()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [fetchConfig])

  const handleSave = async () => {
    setSaving(true)
    try {
      const items = [
        { config_key: "platform_name", config_value: config.platform_name },
        { config_key: "announcement", config_value: config.announcement },
        { config_key: "announcement_enabled", config_value: config.announcement_enabled },
        { config_key: "maintenance_mode", config_value: config.maintenance_mode },
        { config_key: "maintenance_message", config_value: config.maintenance_message },
      ]
      await apiRequest("/api/v1/admin/system/config", {
        method: "PUT",
        body: JSON.stringify({ items }),
      })
      showNotify("success", "系统配置已保存")
    } catch (err) {
      showNotify("error", err instanceof ApiError ? err.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="form-surface">
      <div className="admin-section-title">
        <h3>系统配置</h3>
        <p>公告、维护模式、平台名称</p>
      </div>
      {notify && (
        <Alert
          type={notify.type}
          content={notify.text}
          closable
          style={{ marginBottom: 16 }}
          onClose={() => setNotify(null)}
        />
      )}
      {loading ? (
        <div style={{ padding: 24, textAlign: "center", color: "var(--color-text-3)" }}>加载中...</div>
      ) : (
        <Form layout="vertical">
          <Form.Item label="平台名称">
            <Input
              value={config.platform_name}
              onChange={(val) => setConfig((c) => ({ ...c, platform_name: val }))}
              placeholder="智培职联"
            />
          </Form.Item>

          <Form.Item label="公告内容">
            <Input.TextArea
              value={config.announcement}
              onChange={(val) => setConfig((c) => ({ ...c, announcement: val }))}
              placeholder="输入公告内容..."
              autoSize={{ minRows: 2, maxRows: 6 }}
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <span>启用公告</span>
              <Switch
                checked={config.announcement_enabled === "true"}
                onChange={(val) =>
                  setConfig((c) => ({ ...c, announcement_enabled: val ? "true" : "false" }))
                }
              />
            </Space>
          </Form.Item>

          <Form.Item>
            <Space>
              <span>维护模式</span>
              <Switch
                checked={config.maintenance_mode === "true"}
                onChange={(val) =>
                  setConfig((c) => ({ ...c, maintenance_mode: val ? "true" : "false" }))
                }
              />
            </Space>
          </Form.Item>
          {config.maintenance_mode === "true" && (
            <Form.Item label="维护提示语">
              <Input
                value={config.maintenance_message}
                onChange={(val) => setConfig((c) => ({ ...c, maintenance_message: val }))}
                placeholder="系统维护中，请稍后再试"
              />
            </Form.Item>
          )}

          <Form.Item>
            <Button
              type="primary"
              icon={<IconSave />}
              loading={saving}
              onClick={handleSave}
            >
              保存配置
            </Button>
          </Form.Item>
        </Form>
      )}
    </section>
  )
}
