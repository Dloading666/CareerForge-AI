import { Button, Tag } from '@arco-design/web-react'
import { IconApps, IconDashboard, IconExperiment, IconHistory,
  IconNotification, IconPlus, IconRobot, IconSafe, IconSettings, IconUser,
} from '@arco-design/web-react/icon'
import { useState, type ReactNode } from 'react'
import { useAuth } from '../shared/auth'
import { AgentManagementPage } from './AgentManagementPage'
import { ModelPlaza } from './ModelPlaza'
import { SystemSettings } from './SystemSettings'

type NavKey = 'agents' | 'master' | 'models' | 'mcp' | 'skills' | 'knowledge' | 'settings'

export function AdminHomePage() {
  useAuth()
  const [activeNav, setActiveNav] = useState<NavKey>('agents')

  const navItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'agents', icon: <IconRobot />, label: '智能体管理' },
    { key: 'master', icon: <IconDashboard />, label: '主智能体配置' },
    { key: 'models', icon: <IconExperiment />, label: '模型广场' },
    { key: 'mcp', icon: <IconSafe />, label: 'MCP 广场' },
    { key: 'skills', icon: <IconApps />, label: 'Skills 广场' },
    { key: 'knowledge', icon: <IconHistory />, label: '知识库' },
    { key: 'settings', icon: <IconSettings />, label: '系统设置' },
  ]

  const currentLabel = navItems.find(n => n.key === activeNav)?.label || ''

  return (
    <div className="app-shell admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="admin-brand-badge">管</span>
          <div><h1>智培职联</h1><p>Admin Console</p></div>
        </div>
        <div className="admin-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button key={key} className="admin-nav-item"
              type={activeNav === key ? 'primary' : 'text'} icon={icon}
              onClick={() => setActiveNav(key)}>{label}</Button>
          ))}
        </div>
        <div className="admin-sidebar-status">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00b42a', display: 'inline-block' }} />
          平台运行中
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <strong>{currentLabel}</strong>
          <div className="admin-topbar-actions">
            {activeNav === 'agents' && (
              <Button type="primary" icon={<IconPlus />}
                onClick={() => window.dispatchEvent(new CustomEvent('agent-create'))}>创建智能体</Button>
            )}
            <Button icon={<IconNotification />} type="text" />
            <span className="admin-avatar"><IconUser /></span>
          </div>
        </header>

        <div className="admin-page">
          <div className="admin-page-head">
            <div>
              <h2>{currentLabel}</h2>
            </div>
          </div>

          {activeNav === 'agents' && <AgentManagementPage />}
          {activeNav === 'models' && <ModelPlaza />}
          {activeNav === 'settings' && <SystemSettings />}
          {!['agents', 'models', 'settings'].includes(activeNav) && (
            <div style={{ textAlign: 'center', padding: 80, color: '#86909C' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, marginBottom: 16, display: 'block' }}>construction</span>
              <h3 style={{ color: '#1D2129' }}>{currentLabel}</h3>
              <p>该模块即将上线，敬请期待</p>
              <Tag color="arcoblue" style={{ marginTop: 16 }}>即将上线</Tag>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
