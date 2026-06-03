import { Button, Card, Grid, Popconfirm, Space, Switch, Tag, Typography } from '@arco-design/web-react'
import {
  IconDashboard,
  IconExperiment,
  IconPoweroff,
  IconNotification,
  IconPlus,
  IconRobot,
  IconSafe,
  IconSettings,
} from '@arco-design/web-react/icon'
import { useState } from 'react'

import { useAuth } from '../shared/auth'

const { Row, Col } = Grid

type NavKey = 'agents' | 'config' | 'models' | 'extensions' | 'settings'

const MODELS = [
  { name: 'DeepSeek V3', id: 'deepseek-chat', host: 'api.deepseek.com/v1', latency: 380, latencyColor: '#00b42a', provider: 'DeepSeek', enabled: true },
  { name: 'GPT-4o Mini', id: 'gpt-4o-mini', host: 'api.openai.com/v1', latency: 850, latencyColor: '#ff7d00', provider: 'OpenAI', enabled: true },
  { name: 'Claude 3.5 Sonnet', id: 'claude-3-5-sonnet', host: 'api.anthropic.com/v1', latency: 1200, latencyColor: '#f53f3f', provider: 'Anthropic', enabled: false },
]

export function AdminHomePage() {
  const { session, logout } = useAuth()
  const displayName = (session?.profile.display_name as string) || '平台管理员'
  const email = (session?.profile.email as string) || ''
  const [activeNav, setActiveNav] = useState<NavKey>('models')

  const navItems: { key: NavKey; icon: React.ReactNode; label: string }[] = [
    { key: 'agents', icon: <IconRobot />, label: '智能体管理' },
    { key: 'config', icon: <IconDashboard />, label: '主智能体配置' },
    { key: 'models', icon: <IconExperiment />, label: '模型广场' },
    { key: 'extensions', icon: <IconSafe />, label: 'MCP / Skills / 知识库' },
    { key: 'settings', icon: <IconSettings />, label: '系统设置' },
  ]

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <span className="brand-mark-badge">管</span>
          <div>
            <h1>智培职联</h1>
            <p>Admin Console</p>
          </div>
        </div>

        <div className="side-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button
              key={key}
              className="side-nav-item"
              type={activeNav === key ? 'primary' : 'text'}
              icon={icon}
              onClick={() => setActiveNav(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="side-nav-footer">
          <div style={{ fontWeight: 600 }}>{displayName}</div>
          <div className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>{email}</div>
          <Popconfirm
            title="确定要退出登录吗？"
            okText="退出"
            cancelText="取消"
            onOk={logout}
          >
            <Button type="text" size="small" icon={<IconPoweroff />} style={{ paddingLeft: 0, color: '#f53f3f' }}>
              退出登录
            </Button>
          </Popconfirm>
        </div>
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div className="topbar-title">
            <h2>模型广场</h2>
            <p>管理平台接入的 AI 模型，配置开关与优先级</p>
          </div>
          <div className="topbar-actions">
            <Button icon={<IconNotification />} type="text" />
            <Button icon={<IconPlus />} type="primary">添加模型</Button>
          </div>
        </header>

        <main className="page-content">
          <div className="dashboard-heading">
            <h3>模型广场</h3>
            <p>已接入 {MODELS.filter(m => m.enabled).length} 个模型，共 {MODELS.length} 个</p>
          </div>

          <div className="dashboard-panel">
            <section>
              <div className="model-grid">
                {MODELS.map(m => (
                  <Card key={m.id} className="info-card" title={m.name} hoverable>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                      <Tag color="arcoblue">云端</Tag>
                      <Typography.Text>模型：{m.id}</Typography.Text>
                      <Typography.Text className="muted-text">来源：{m.host}</Typography.Text>
                      <Typography.Text>
                        延迟：<span style={{ color: m.latencyColor }}>{m.latency}ms</span>
                      </Typography.Text>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Tag>{m.provider}</Tag>
                        <Switch defaultChecked={m.enabled} />
                      </div>
                    </Space>
                  </Card>
                ))}
                <div className="ghost-add-card">
                  <Space direction="vertical" align="center">
                    <Button type="outline" shape="circle" icon={<IconPlus />} />
                    <Typography.Text>添加模型</Typography.Text>
                  </Space>
                </div>
              </div>
            </section>

            <section>
              <Card className="info-card" title="账号信息">
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                  <Row gutter={12}>
                    <Col span={12}>
                      <Card bordered={false} style={{ background: '#f7f8fa' }}>
                        <Typography.Text className="muted-text">当前账号</Typography.Text>
                        <Typography.Title heading={6} style={{ marginTop: 8 }}>{displayName}</Typography.Title>
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card bordered={false} style={{ background: '#f7f8fa' }}>
                        <Typography.Text className="muted-text">邮箱</Typography.Text>
                        <Typography.Title heading={6} style={{ marginTop: 8, fontSize: 13 }}>{email}</Typography.Title>
                      </Card>
                    </Col>
                  </Row>
                  <Popconfirm
                    title="确定要退出登录吗？"
                    okText="退出"
                    cancelText="取消"
                    onOk={logout}
                  >
                    <Button type="outline" status="danger" icon={<IconPoweroff />} long>
                      退出登录
                    </Button>
                  </Popconfirm>
                </Space>
              </Card>
            </section>
          </div>
        </main>
      </section>
    </div>
  )
}
