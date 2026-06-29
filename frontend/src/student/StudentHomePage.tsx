import { Button, Checkbox, Dropdown, Modal, Popconfirm } from '@arco-design/web-react'
import {
  IconBook,
  IconDashboard,
  IconCamera,
  IconCalendar,
  IconClose,
  IconDelete,
  IconFile,
  IconHistory,
  IconInfoCircle,
  IconLoading,
  IconMenuFold,
  IconMenuUnfold,
  IconMessage,
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
import { AIInterviewerPage } from './AIInterviewerPage'
import { InterviewReportPage } from './InterviewReportPage'
import { ResumeCenterPage } from '../resume/ResumeCenterPage'
import { AnalysisPage } from './AnalysisPage'
import { ResumeEditorPage } from '../resume/ResumeEditorPage'

// ── Types ──────────────────────────────────────────────────────────────────────

type NavKey = 'resume-agent' | 'interviewer' | 'resume' | 'analysis' | 'profile'

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
  const { session, logout, refreshProfile } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const studentName = (session?.profile.name as string) || '同学'
  const studentNickname = (session?.profile.nickname as string) || studentName
  const studentAvatar = (session?.profile.avatar_url as string) || ''
  const studentEmail = (session?.profile.email as string) || ''

  // Pull the latest profile on mount so fields added after login (e.g. nickname)
  // are populated without requiring the user to manually re-login.
  useEffect(() => {
    if (session) void refreshProfile()
  }, [])

  const [announcement, setAnnouncement] = useState<{ text: string; visible: boolean }>({ text: '', visible: false })
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [railCollapsed, setRailCollapsed] = useState(() => localStorage.getItem('railCollapsed') === 'true')
  const [profileModalVisible, setProfileModalVisible] = useState(false)
  const [profileTab, setProfileTab] = useState('account')
  const [notice, setNotice] = useState<string | null>(null)

  // Resizable module panel (简历助手对话历史栏)
  const [panelWidth, setPanelWidth] = useState(() =>
    Number(localStorage.getItem('sideNavWidth') || 248),
  )
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  // 简历助手右侧实时预览窗：由标题栏右上角按钮控制开/关（状态提升到首页，
  // 因为按钮在 topbar，预览窗在 AgentChatView，两者需共享开关状态）
  const [resumePreviewVisible, setResumePreviewVisible] = useState(false)
  const [resumePreviewWidth, setResumePreviewWidth] = useState(() =>
    Number(localStorage.getItem('zhipei-resume-preview-width') || 420),
  )
  // 当前简历助手选中的工作简历 id（用于决定「预览」按钮是否显示）
  const [resumeActiveResumeId, setResumeActiveResumeId] = useState<number | null>(null)

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = panelWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.body.classList.add('is-resizing')
  }

  const handleToggleResumePreview = useCallback(() => {
    setResumePreviewVisible((v) => !v)
  }, [])

  // 预览窗宽度变化时更新并持久化
  const handleResumePreviewWidthChange = useCallback((width: number) => {
    setResumePreviewWidth(width)
    localStorage.setItem('zhipei-resume-preview-width', String(width))
  }, [])

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
      document.body.classList.remove('is-resizing')
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
    if (location.pathname.startsWith('/student/analysis')) return 'analysis'
    if (location.pathname.startsWith('/student/interviewer')) return 'interviewer'
    return 'resume-agent'
  }, [location.pathname])

  const railItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'resume-agent', icon: <IconRobot />, label: '简历助手' },
    { key: 'interviewer', icon: <IconBook />, label: '面试官' },
    { key: 'resume', icon: <IconFile />, label: '简历制作' },
    { key: 'analysis', icon: <IconDashboard />, label: '能力分析' },
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
    if (activeNav === 'analysis') {
      return { title: '能力分析', subtitle: '基于多场面试的智能画像，发现你的强项与短板' }
    }
return { title: 'AI简历助手', subtitle: '智能辅助简历制作、优化表达与岗位匹配' }
  }, [activeNav, location.pathname])

  const navigateToNav = (key: NavKey) => {
    if (key === 'resume-agent') navigate('/student')
    else if (key === 'interviewer') navigate('/student/interviewer')
    else if (key === 'resume') navigate('/student/resumes')
    else if (key === 'analysis') navigate('/student/analysis')
    else { setProfileModalVisible(true) }
  }

  const toggleRailCollapsed = () => {
    const next = !railCollapsed
    setRailCollapsed(next)
    localStorage.setItem('railCollapsed', String(next))
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
      // 先取消后端正在跑的 run，避免会话已删但 AI 继续改简历
      await chatRuntimeStore.cancelSessionRun(target.id)
      await apiRequest(`/api/v1/student/master/sessions/${target.id}`, { method: 'DELETE' })
      chatRuntimeStore.clearSession(target.id)
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
      const title = (!s.title || s.title === '新对话') && existing?.title ? existing.title : s.title
      const entry: AgentChatSession = { ...s, title }
      return [entry, ...prev.filter((x) => x.id !== s.id)]
    })
  }, [])

  const userMenu = (
    <div className="user-card-menu">
      <div className="user-card-menu-header">
        <UserAvatar src={studentAvatar} name={studentNickname} size={40} />
        <div className="user-card-menu-info">
          <span className="user-card-menu-name">{studentNickname}</span>
          <span className="user-card-menu-email">{studentEmail}</span>
        </div>
      </div>
      <div className="user-card-menu-divider" />
      <button type="button" className="user-card-menu-item" onClick={() => setProfileModalVisible(true)}>
        <IconUser />
        <span>个人资料</span>
      </button>
      <div className="user-card-menu-divider" />
      <button type="button" className="user-card-menu-item user-card-menu-item--danger" onClick={logout}>
        <IconPoweroff />
        <span>退出登录</span>
      </button>
    </div>
  )

  return (
    <div className={`app-shell student-shell${activeNav === 'interviewer' ? ' student-shell--interview-focus' : ''}`}>
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
            onClick={toggleRailCollapsed}
          />
          {!railCollapsed && (
            <div className="global-rail-brand-text">
              <span className="global-rail-brand-name">CareerForge</span>
              <span className="global-rail-brand-sub">学生端</span>
            </div>
          )}
        </div>

        <button
          type="button"
          className="global-rail-collapse-btn"
          onClick={toggleRailCollapsed}
          title={railCollapsed ? '展开导航' : '收起导航'}
          aria-label={railCollapsed ? '展开导航' : '收起导航'}
        >
          {railCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
        </button>

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
          <div className="global-rail-user" title={studentNickname}>
            <UserAvatar src={studentAvatar} name={studentNickname} size={railCollapsed ? 32 : 36} />
            {!railCollapsed && (
              <div className="global-rail-user-info">
                <span className="global-rail-user-name">{studentNickname}</span>
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
            {activeNav === 'resume-agent' && resumeActiveResumeId != null && (
              <button
                type="button"
                className={`topbar-preview-btn${resumePreviewVisible ? ' active' : ''}`}
                onClick={handleToggleResumePreview}
                title={resumePreviewVisible ? '收起简历预览' : '打开简历预览'}
                aria-label={resumePreviewVisible ? '收起简历预览' : '打开简历预览'}
              >
                <IconFile />
                <span>{resumePreviewVisible ? '收起预览' : '简历预览'}</span>
              </button>
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
                onOpenProfile={() => { setProfileTab('profile'); setProfileModalVisible(true) }}
                resumePreviewVisible={resumePreviewVisible}
                resumePreviewWidth={resumePreviewWidth}
                onResumePreviewWidthChange={handleResumePreviewWidthChange}
                onActiveResumeIdChange={setResumeActiveResumeId}
                onResumePreviewClose={() => setResumePreviewVisible(false)}
              />
            }
          />
          <Route
            path="interviewer/report/:sessionId"
            element={<main className="page-content"><InterviewReportPage /></main>}
          />
          <Route
            path="interviewer"
            element={<AIInterviewerPage />}
          />

          <Route path="analysis" element={<main className="page-content"><AnalysisPage /></main>} />
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
        maskClosable
        className="profile-modal"
        style={{ top: '6vh' }}
        maskStyle={{ background: 'rgba(23, 30, 48, 0.28)', backdropFilter: 'blur(2px)' }}
        unmountOnExit
      >
        <div className="profile-modal-layout">
          <div className="profile-modal-nav">
            <div className="profile-modal-nav-header">设置</div>
            {[
              { key: 'account', icon: <IconCamera style={{ fontSize: 18, color: '#0fc6c2' }} />, label: '账号管理', color: '#e6fffa' },
              { key: 'profile', icon: <IconUser style={{ fontSize: 18, color: '#165dff' }} />, label: '个人资料', color: '#e8f0fe' },
              { key: 'calendar', icon: <IconCalendar style={{ fontSize: 18, color: '#722ed1' }} />, label: '日程管理', color: '#f3e8ff' },
              { key: 'security', icon: <IconSafe style={{ fontSize: 18, color: '#00b42a' }} />, label: '账号安全', color: '#e8ffea' },
              { key: 'feedback', icon: <IconMessage style={{ fontSize: 18, color: '#eb6b00' }} />, label: '意见反馈', color: '#fff3e8' },
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
