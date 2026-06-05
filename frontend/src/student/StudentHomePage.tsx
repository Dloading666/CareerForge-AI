import { Button, Card, Popconfirm, Typography } from '@arco-design/web-react'
import { IconApps, IconHistory, IconPoweroff, IconPlus, IconRobot, IconUser } from '@arco-design/web-react/icon'
import { useState } from 'react'
import { useAuth } from '../shared/auth'
import { StudentAgentChat } from './StudentAgentChat'
import { StudentAgentSquare } from './StudentAgentSquare'

interface AgentItem { id: number; name: string; description: string | null; icon_name: string | null; icon_color_from: string | null; icon_color_to: string | null; model_config: { display_name: string } | null; welcome_message: string | null; suggested_questions: string[] | null; prompt_variables: { name: string; label: string; required: boolean; default: string }[] | null; is_enabled: boolean; is_published: boolean }

type NavKey = 'agent' | 'square' | 'history' | 'profile'

export function StudentHomePage() {
  const { session, logout } = useAuth()
  const studentName = (session?.profile.name as string) || '同学'
  const [activeNav, setActiveNav] = useState<NavKey>('agent')
  const [selectedAgent, setSelectedAgent] = useState<AgentItem | null>(null)

  const navItems: { key: NavKey; icon: React.ReactNode; label: string }[] = [
    { key: 'agent', icon: <IconRobot />, label: '主智能体' },
    { key: 'square', icon: <IconApps />, label: '智能体广场' },
    { key: 'history', icon: <IconHistory />, label: '我的记录' },
    { key: 'profile', icon: <IconUser />, label: '个人中心' },
  ]

  // If chatting with a specific agent
  if (selectedAgent) {
    return (
      <div className="app-shell" style={{ background: '#faf8ff' }}>
        <aside className="side-nav">
          <div className="brand-mark"><span className="brand-mark-badge">智</span><div><h1>智培职联</h1><p>学生端</p></div></div>
          <Button type="primary" size="large" icon={<IconPlus />} long>新建对话</Button>
          <div className="side-nav-menu">
            {navItems.map(({ key, icon, label }) => (
              <Button key={key} className="side-nav-item" type={activeNav === key ? 'primary' : 'text'} icon={icon}
                onClick={() => { setActiveNav(key); setSelectedAgent(null) }}>{label}</Button>
            ))}
          </div>
        </aside>
        <section className="content-panel">
          <StudentAgentChat agent={selectedAgent} onBack={() => setSelectedAgent(null)} />
        </section>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <aside className="side-nav">
        <div className="brand-mark"><span className="brand-mark-badge">智</span><div><h1>智培职联</h1><p>学生端</p></div></div>
        <Button type="primary" size="large" icon={<IconPlus />} long>新建对话</Button>
        <div className="side-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button key={key} className="side-nav-item" type={activeNav === key ? 'primary' : 'text'} icon={icon}
              onClick={() => { setActiveNav(key); setSelectedAgent(null) }}>{label}</Button>
          ))}
        </div>
        <div className="side-nav-footer">
          <div style={{ fontWeight: 600 }}>{studentName}</div>
          <Popconfirm title="确定退出登录？" okText="退出" cancelText="取消" onOk={logout}>
            <Button type="text" size="small" icon={<IconPoweroff />} style={{ paddingLeft: 0, color: '#f53f3f' }}>退出登录</Button>
          </Popconfirm>
        </div>
      </aside>

      <section className="content-panel">
        {activeNav === 'square' && <StudentAgentSquare onSelect={a => setSelectedAgent(a)} />}
        {activeNav === 'agent' && (
          <main className="page-content">
            <section className="hero-panel">
              <div className="hero-icon"><IconRobot /></div>
              <h3>你好，{studentName}</h3>
              <p>我是你的就业总助手，可以帮你模拟面试、分析岗位匹配度、优化简历。</p>
            </section>
            <section className="suggestion-grid">
              {['帮我模拟一次面试', '看看我和某岗位的匹配度', '优化我的简历项目经历', '应届生求职常见问题'].map(t => (
                <Card key={t} className="info-card" hoverable style={{ cursor: 'pointer' }}>
                  <Typography.Title heading={6}>{t}</Typography.Title>
                </Card>
              ))}
            </section>
          </main>
        )}
        {activeNav === 'history' && <div style={{ textAlign: 'center', padding: 80, color: '#86909C' }}>暂无记录</div>}
        {activeNav === 'profile' && <div style={{ textAlign: 'center', padding: 80, color: '#86909C' }}>个人中心开发中</div>}
      </section>
    </div>
  )
}
