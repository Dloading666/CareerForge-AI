import { Button, Card, Popconfirm, Space, Tag, Typography } from '@arco-design/web-react'
import {
  IconApps,
  IconHistory,
  IconPoweroff,
  IconNotification,
  IconPlus,
  IconRobot,
  IconUser,
} from '@arco-design/web-react/icon'
import { useState } from 'react'

import { useAuth } from '../shared/auth'

type NavKey = 'agent' | 'square' | 'history' | 'profile'

export function StudentHomePage() {
  const { session, logout } = useAuth()
  const studentName = (session?.profile.name as string) || '同学'
  const studentEmail = (session?.profile.email as string) || ''
  const [activeNav, setActiveNav] = useState<NavKey>('agent')

  const navItems: { key: NavKey; icon: React.ReactNode; label: string }[] = [
    { key: 'agent', icon: <IconRobot />, label: '主智能体' },
    { key: 'square', icon: <IconApps />, label: '智能体广场' },
    { key: 'history', icon: <IconHistory />, label: '我的记录' },
    { key: 'profile', icon: <IconUser />, label: '个人中心' },
  ]

  const suggestions = [
    { title: '帮我模拟一次面试', desc: '沉浸式多回合对话，检验真实水平。' },
    { title: '看看我和某岗位的匹配度', desc: '上传 JD 与简历，智能分析优劣势。' },
    { title: '优化我的简历项目经历', desc: '用更有说服力的结构包装你的真实经历。' },
    { title: '应届生求职常见问题', desc: '秋招节奏、三方协议、网申技巧一网打尽。' },
  ]

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark">
          <span className="brand-mark-badge">智</span>
          <div>
            <h1>智培职联</h1>
            <p>学生端</p>
          </div>
        </div>

        <Button type="primary" size="large" icon={<IconPlus />} long>
          新建对话
        </Button>

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
          <div style={{ fontWeight: 600 }}>{studentName}</div>
          <div className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>{studentEmail}</div>
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
            <h2>就业总助手（主智能体）</h2>
            <p>选择下方建议或直接输入，开始你的求职对话</p>
          </div>
          <div className="topbar-actions">
            <Tag color="arcoblue" bordered>DeepSeek-V3</Tag>
            <Button icon={<IconNotification />} type="text" />
          </div>
        </header>

        <main className="page-content">
          <section className="hero-panel">
            <div className="hero-icon">
              <IconRobot />
            </div>
            <h3>你好，{studentName}</h3>
            <p>我是你的就业总助手，可以帮你模拟面试、分析岗位匹配度、优化简历。选一个开始吧：</p>
          </section>

          <section className="suggestion-grid">
            {suggestions.map(({ title, desc }) => (
              <Card key={title} className="info-card" hoverable style={{ cursor: 'pointer' }}>
                <Typography.Title heading={6}>{title}</Typography.Title>
                <Typography.Paragraph className="muted-text">{desc}</Typography.Paragraph>
              </Card>
            ))}
          </section>

          <section className="chat-input-hint">
            <Space style={{ color: 'var(--text-subtle)', fontSize: 13 }}>
              <IconRobot />
              <span>主智能体对话功能即将接入，敬请期待</span>
            </Space>
          </section>
        </main>
      </section>
    </div>
  )
}
