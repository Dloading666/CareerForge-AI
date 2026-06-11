import { Button, Checkbox, Dropdown, Modal, Popconfirm } from '@arco-design/web-react'
import {
  IconBook,
  IconBug,
  IconCalendar,
  IconClose,
  IconDelete,
  IconFile,
  IconHistory,
  IconInfoCircle,
  IconLoading,
  IconMenuFold,
  IconMenuUnfold,
  IconPlus,
  IconPoweroff,
  IconRobot,
  IconSafe,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, apiRequest } from '../shared/api'
import { useAuth } from '../shared/auth'
import { UserAvatar } from '../shared/UserAvatar'
import { AnnouncementBellDropdown } from './StudentAnnouncementBar'
import { chatRuntimeStore } from './chatRuntimeStore'
import { AgentChatView, type AgentChatSession, type AgentModelOption } from './AgentChatView'
import { ProfilePage } from './ProfilePage'
import { ResumeCenterPage } from '../resume/ResumeCenterPage'
import { ResumeEditorPage } from '../resume/ResumeEditorPage'

// ── Types ──────────────────────────────────────────────────────────────────────

type NavKey = 'resume-agent' | 'interviewer' | 'resume' | 'profile'

// ── Session history panel ──────────────────────────────────────────────────────

function SessionHistoryPanel({
  sessions,
  currentSessionId,
  onSelect,
  onDelete,
}: {
  sessions: AgentChatSession[]
  currentSessionId: number | null
  onSelect: (session: AgentChatSession) => void
  onDelete: (session: AgentChatSession) => void
}) {
  // 并行对话：订阅 store 获取运行状态
  const [, forceUpdate] = useState(0)
  useEffect(() => {
    return chatRuntimeStore.subscribe(() => forceUpdate((v) => v + 1))
  }, [])

  if (sessions.length === 0) {
    return <div className="side-nav-history-empty">暂无历史</div>
  }
  return (
    <div className="side-nav-history-list">
      {sessions.map((s) => {
        const isRunning = chatRuntimeStore.isRunning(s.id)
        const isActive = s.id === currentSessionId
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`side-nav-history-item${isActive ? ' active' : ''}${isRunning && !isActive ? ' side-nav-history-item--running' : ''}`}
            onClick={() => onSelect(s)}
            title={s.title}
          >
            {isRunning ? (
              <IconLoading className="side-nav-history-item-icon side-nav-history-item-icon--spin" />
            ) : (
              <IconHistory className="side-nav-history-item-icon" />
            )}
            <span className="side-nav-history-item-title">
              {s.title}
              {isRunning && !isActive && <span className="side-nav-running-badge">运行中</span>}
            </span>
            <Popconfirm
              title="删除这条对话记录？"
              okText="删除"
              cancelText="取消"
              onOk={() => onDelete(s)}
            >
              <span className="side-nav-history-del" title="删除" onClick={(e) => e.stopPropagation()}>
                <IconDelete />
              </span>
            </Popconfirm>
          </div>
        )
      })}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export function StudentHomePage() {
  const { session, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'
  const studentAvatar = (session?.profile.avatar_url as string) || ''
  const studentEmail = (session?.profile.email as string) || ''

  const [announcement, setAnnouncement] = useState<{ text: string; visible: boolean }>({ text: '', visible: false })
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('railCollapsed') === 'true')
  const [profileModalVisible, setProfileModalVisible] = useState(false)
  const [profileTab, setProfileTab] = useState('profile')
  const [notice, setNotice] = useState<string | null>(null)

  // Resizable module panel (简历助手对话历史栏)
  const [panelWidth, setPanelWidth] = useState(() =>
    Number(localStorage.getItem('sideNavWidth') || 248),
  )
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // 刷新后恢复活跃 run 的 SSE 订阅
  useEffect(() => {
    chatRuntimeStore.resumeActiveRuns()
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      const next = Math.min(480, Math.max(180, dragStartWidthRef.current + delta))
      setPanelWidth(next)
    }
    const onMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setPanelWidth((w) => {
        localStorage.setItem('sideNavWidth', String(w))
        return w
      })
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
  }, [])

  // Models (shared between both agents)
  const [modelOptions, setModelOptions] = useState<AgentModelOption[]>([])

  // 简历助手会话列表（面试官历史由其模块内部管理，不在首页展示）
  const [resumeSessions, setResumeSessions] = useState<AgentChatSession[]>([])
  const [resumeActiveId, setResumeActiveId] = useState<number | null>(null)

  // Triggers for AgentChatView children
  const [resumeLoadTrigger, setResumeLoadTrigger] = useState(0)
  const [resumeSessionToLoad, setResumeSessionToLoad] = useState<AgentChatSession | null>(null)
  const [resumeNewChatTrigger, setResumeNewChatTrigger] = useState(0)

  // Today's events / reminders (shared)
  const [todayEvents, setTodayEvents] = useState<{ id: number; title: string; event_time: string | null }[]>([])
  const [remindersDismissed, setRemindersDismissed] = useState(false)

  const activeNav = useMemo<NavKey>(() => {
    if (location.pathname.startsWith('/student/resumes')) return 'resume'
    if (location.pathname.startsWith('/student/interviewer')) return 'interviewer'
    return 'resume-agent'
  }, [location.pathname])

  const railItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'resume-agent', icon: <IconRobot />, label: '简历助手' },
    { key: 'interviewer', icon: <IconBook />, label: '面试官' },
    { key: 'resume', icon: <IconFile />, label: '简历制作' },
  ]

  const topbarMeta = useMemo(() => {
    if (activeNav === 'resume') {
      return {
        title: '简历中心',
        subtitle: location.pathname.includes('/student/resumes/') ? '在线编辑、模板切换与实时预览' : '管理在线简历',
      }
    }
    if (activeNav === 'interviewer') {
      return { title: 'AI面试官', subtitle: '一对一模拟面试训练，针对性提升面试表现' }
    }
return { title: 'AI简历助手', subtitle: '智能辅助简历制作、优化表达与岗位匹配' }
  }, [activeNav, location.pathname])

  const navigateToNav = (key: NavKey) => {
    if (key === 'resume-agent') navigate('/student')
    else if (key === 'interviewer') navigate('/student/interviewer')
    else if (key === 'resume') navigate('/student/resumes')
    else { setProfileModalVisible(true) }
  }

  // Load today's events
  useEffect(() => {
    if (!session?.access) return
    let alive = true
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    apiRequest<{ id: number; title: string; event_time: string | null }[]>(
      `/api/v1/student/events?date_from=${today}&date_to=${today}`,
    )
      .then((list) => { if (alive) { setTodayEvents(list ?? []); setRemindersDismissed(false) } })
      .catch(() => {})
    return () => { alive = false }
  }, [session?.access])

  // Announcement
  useEffect(() => {
    if (!session?.access) return
    const dismissed = localStorage.getItem('announcement_dismissed')
    apiRequest<{ announcement: string; enabled: boolean }>('/api/v1/student/announcement')
      .then((res) => {
        if (res.enabled && res.announcement && res.announcement !== dismissed) {
          setDontShowAgain(false)
          setAnnouncement({ text: res.announcement, visible: true })
        }
      })
      .catch(() => {})
  }, [session?.access])

  // Boot: load models + sessions
  useEffect(() => {
    if (!session?.access) return
    let alive = true
    const timer = window.setTimeout(async () => {
      setNotice(null)
      setResumeSessions([])
      try {
        const [list, sessions] = await Promise.all([
          apiRequest<AgentModelOption[]>('/api/v1/student/master/models'),
          apiRequest<AgentChatSession[]>('/api/v1/student/master/sessions'),
        ])
        if (!alive) return
        setModelOptions(list)
        if (list.length === 0) setNotice('当前没有可用模型，请管理员先在模型广场开启「对学生开放」。')
        setResumeSessions(sessions.filter((s) => !s.agent_type || s.agent_type === 'resume'))
      } catch (error) {
        if (alive) setNotice(error instanceof ApiError ? error.message : '初始化失败')
      }
    }, 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [session])

  // ── Session management callbacks ──

  const handleNewResumeChat = () => {
    setResumeNewChatTrigger((v) => v + 1)
    navigate('/student')
  }

  const handleSelectSession = (s: AgentChatSession) => {
    setResumeSessionToLoad(s)
    setResumeLoadTrigger((v) => v + 1)
    navigate('/student')
  }

  const handleDeleteSession = async (target: AgentChatSession) => {
    try {
      await apiRequest(`/api/v1/student/master/sessions/${target.id}`, { method: 'DELETE' })
      setResumeSessions((prev) => prev.filter((s) => s.id !== target.id))
      if (resumeActiveId === target.id) {
        setResumeNewChatTrigger((v) => v + 1)
      }
    } catch {
      setNotice('删除对话失败')
    }
  }

  const handleResumeSessionUpdated = useCallback((s: AgentChatSession) => {
    setResumeSessions((prev) => {
      const existing = prev.find((x) => x.id === s.id)
      const entry: AgentChatSession = { ...s, title: existing?.title || s.title }
      return [entry, ...prev.filter((x) => x.id !== s.id)]
    })
  }, [])

  // 面试官历史由其模块内部管理（团队成员开发中），首页侧栏不再跟踪
  const noopSessionUpdated = useCallback(() => {}, [])
  const noopActiveSessionChange = useCallback(() => {}, [])

  const userMenu = (
    <div className="user-card-menu">
      <div className="user-card-menu-header">
        <IconUser className="user-card-menu-avatar-icon" />
        <span className="user-card-menu-email">{studentEmail}</span>
      </div>
      <div className="user-card-menu-divider" />
      <button type="button" className="user-card-menu-item" onClick={() => setProfileModalVisible(true)}>
        <IconUser />
        <span>个人资料</span>
      </button>
      <div className="user-card-menu-divider" />
      <Popconfirm title="确定要退出登录吗？" okText="退出" cancelText="取消" onOk={logout} position="tl">
        <button type="button" className="user-card-menu-item user-card-menu-item--danger">
          <IconPoweroff />
          <span>退出登录</span>
        </button>
      </Popconfirm>
    </div>
  )

  return (
    <div className="app-shell student-shell">
      {/* 第一栏：全局侧边栏导航 */}
      <nav className={`global-rail${railCollapsed ? ' global-rail--collapsed' : ''}`}>
        <div className="global-rail-brand">
          <img
            className="global-rail-logo"
            src="/baidi.png"
            alt="CareerForge"
            role="button"
            title={railCollapsed ? '展开侧栏' : '收起侧栏'}
            style={{ cursor: 'pointer' }}
            onClick={() => {
              const next = !railCollapsed
              setRailCollapsed(next)
              localStorage.setItem('railCollapsed', String(next))
            }}
          />
          {!railCollapsed && (
            <div className="global-rail-brand-text">
              <span className="global-rail-brand-name">CareerForge</span>
              <span className="global-rail-brand-sub">学生端</span>
            </div>
          )}
        </div>

        <div className="global-rail-menu">
          {railItems.map(({ key, icon, label }) => (
            <button
              key={key}
              type="button"
              className={`global-rail-item${activeNav === key ? ' active' : ''}`}
              onClick={() => navigateToNav(key)}
              title={label}
            >
              <span className="global-rail-item-icon">{icon}</span>
              {!railCollapsed && <span className="global-rail-item-label">{label}</span>}
            </button>
          ))}

        </div>

        <Dropdown trigger="click" position="tl" droplist={userMenu}>
          <div className="global-rail-user" title={studentName}>
            <UserAvatar src={studentAvatar} name={studentName} size={railCollapsed ? 32 : 36} />
            {!railCollapsed && (
              <div className="global-rail-user-info">
                <span className="global-rail-user-name">{studentName}</span>
                <span className="global-rail-user-email">{studentEmail}</span>
              </div>
            )}
          </div>
        </Dropdown>
      </nav>

      {/* 第二栏：简历助手的模块面板（新对话 + 历史）。面试官的二栏由其模块自行实现 */}
      {activeNav === 'resume-agent' && (
        <aside
          className={`module-panel${panelCollapsed ? ' module-panel--collapsed' : ''}`}
          style={panelCollapsed ? undefined : { width: panelWidth }}
        >
          <Button
            type="primary"
            long
            icon={<IconPlus />}
            className="module-panel-new"
            onClick={handleNewResumeChat}
          >
            新对话
          </Button>
          <div className="side-nav-history-label">对话历史</div>
          <div className="module-panel-list">
            <SessionHistoryPanel
              sessions={resumeSessions}
              currentSessionId={resumeActiveId}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
            />
          </div>
          {!panelCollapsed && (
            <div className="side-nav-resize-handle" onMouseDown={handleResizeMouseDown} />
          )}
        </aside>
      )}

      <section className="content-panel">
        <header className="topbar">
          <div className="topbar-left">
            {activeNav === 'resume-agent' && (
              <button
                className="side-nav-toggle-btn"
                onClick={() => setPanelCollapsed((v) => !v)}
                title={panelCollapsed ? '展开对话历史' : '收起对话历史'}
              >
                {panelCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
              </button>
            )}
            <div className="topbar-title">
              <h2>{topbarMeta.title}</h2>
              <p>{topbarMeta.subtitle}</p>
            </div>
          </div>
          <div className="topbar-actions">
            {notice && (
              <span style={{ fontSize: 12, color: '#f53f3f', marginRight: 12 }}>
                {notice}
                <button
                  type="button"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', marginLeft: 4 }}
                  onClick={() => setNotice(null)}
                >
                  <IconClose />
                </button>
              </span>
            )}
            <AnnouncementBellDropdown />
          </div>
        </header>

        <Routes>
          <Route
            index
            element={
              <AgentChatView
                agentType="resume"
                modelOptions={modelOptions}
                loadTrigger={resumeLoadTrigger}
                sessionToLoad={resumeSessionToLoad}
                newChatTrigger={resumeNewChatTrigger}
                onSessionUpdated={handleResumeSessionUpdated}
                onActiveSessionChange={setResumeActiveId}
                todayEvents={todayEvents}
                remindersDismissed={remindersDismissed}
                onDismissReminders={() => setRemindersDismissed(true)}
              />
            }
          />
          <Route
            path="interviewer"
            element={
              <AgentChatView
                agentType="interviewer"
                modelOptions={modelOptions}
                loadTrigger={0}
                sessionToLoad={null}
                newChatTrigger={0}
                onSessionUpdated={noopSessionUpdated}
                onActiveSessionChange={noopActiveSessionChange}
                todayEvents={todayEvents}
                remindersDismissed={remindersDismissed}
                onDismissReminders={() => setRemindersDismissed(true)}
              />
            }
          />

          <Route path="resumes" element={<main className="page-content"><ResumeCenterPage /></main>} />
          <Route path="resumes/new" element={<main className="page-content resume-editor-route"><ResumeEditorPage /></main>} />
          <Route path="resumes/:resumeId" element={<main className="page-content resume-editor-route"><ResumeEditorPage /></main>} />
          <Route path="*" element={<Navigate to="/student" replace />} />
        </Routes>
      </section>

      <Modal
        title={<span style={{ color: '#fff', fontSize: 18, fontWeight: 600 }}>系统公告</span>}
        visible={announcement.visible}
        onCancel={() => setAnnouncement((prev) => ({ ...prev, visible: false }))}
        footer={null}
        closable
        maskClosable={false}
        className="announcement-modal"
      >
        <style>{`
          .announcement-modal { margin-top: -80px; margin-left: 80px; }
          .announcement-modal .arco-modal-header {
            background: linear-gradient(135deg, #165dff, #2c73ff);
            border-radius: 8px 8px 0 0;
            padding: 16px 24px;
            border-bottom: none;
          }
          .announcement-modal .arco-modal-close-btn { color: #fff; }
          .announcement-modal .arco-modal-content {
            padding: 24px;
            background: #fff;
            border-radius: 0 0 8px 8px;
          }
        `}</style>
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 15, lineHeight: 1.8, padding: '12px 0', color: '#1D2129' }}>
          {announcement.text}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
          <Checkbox checked={dontShowAgain} onChange={setDontShowAgain}>
            <span style={{ fontSize: 13, color: '#86909C' }}>我已知晓，不再提醒</span>
          </Checkbox>
          <Button
            type="primary"
            size="small"
            onClick={() => {
              if (dontShowAgain) localStorage.setItem('announcement_dismissed', announcement.text)
              setAnnouncement((prev) => ({ ...prev, visible: false }))
            }}
          >
            关闭
          </Button>
        </div>
      </Modal>

      {/* 个人中心 Modal */}
      <Modal
        visible={profileModalVisible}
        onCancel={() => setProfileModalVisible(false)}
        footer={null}
        closable
        maskClosable={false}
        className="profile-modal"
        style={{ top: '6vh' }}
        maskStyle={{ background: 'rgba(23, 30, 48, 0.28)', backdropFilter: 'blur(2px)' }}
        unmountOnExit
      >
        <div className="profile-modal-layout">
          <div className="profile-modal-nav">
            <div className="profile-modal-nav-header">设置</div>
            {[
              { key: 'profile', icon: <IconUser style={{ fontSize: 18, color: '#165dff' }} />, label: '个人资料', color: '#e8f0fe' },
              { key: 'calendar', icon: <IconCalendar style={{ fontSize: 18, color: '#722ed1' }} />, label: '日程管理', color: '#f3e8ff' },
              { key: 'security', icon: <IconSafe style={{ fontSize: 18, color: '#00b42a' }} />, label: '账号安全', color: '#e8ffea' },
              { key: 'feedback', icon: <IconBug style={{ fontSize: 18, color: '#f53f3f' }} />, label: '意见反馈', color: '#ffece8' },
              { key: 'about', icon: <IconInfoCircle style={{ fontSize: 18, color: '#ff7d00' }} />, label: '关于', color: '#fff7e8' },
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                className={`profile-modal-nav-item${profileTab === item.key ? ' active' : ''}`}
                onClick={() => setProfileTab(item.key)}
                aria-label={item.label}
                title={item.label}
              >
                <span className="profile-modal-nav-icon" style={{ background: item.color }}>{item.icon}</span>
                <span className="profile-modal-nav-label">{item.label}</span>
              </button>
            ))}
          </div>
          <div className="profile-modal-content">
            <ProfilePage activeTab={profileTab} onTabChange={setProfileTab} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
