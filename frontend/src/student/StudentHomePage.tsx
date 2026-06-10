import { Button, Checkbox, Dropdown, Menu, Modal, Popconfirm } from '@arco-design/web-react'
import {
  IconBook,
  IconClose,
  IconDelete,
  IconFile,
  IconHistory,
  IconMenuFold,
  IconMenuUnfold,
  IconPlus,
  IconPoweroff,
  IconRobot,
  IconUser,
} from '@arco-design/web-react/icon'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, apiRequest } from '../shared/api'
import { useAuth } from '../shared/auth'
import { AnnouncementBellDropdown } from './StudentAnnouncementBar'
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
  if (sessions.length === 0) {
    return <div className="side-nav-history-empty">暂无历史</div>
  }
  return (
    <div className="side-nav-history-list">
      {sessions.map((s) => (
        <div
          key={s.id}
          role="button"
          tabIndex={0}
          className={`side-nav-history-item${s.id === currentSessionId ? ' active' : ''}`}
          onClick={() => onSelect(s)}
          title={s.title}
        >
          <IconHistory className="side-nav-history-item-icon" />
          <span className="side-nav-history-item-title">{s.title}</span>
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
      ))}
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
  const [studentAvatarKey] = useState(0)
  const studentEmail = (session?.profile.email as string) || ''

  const [announcement, setAnnouncement] = useState<{ text: string; visible: boolean }>({ text: '', visible: false })
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Resizable sidebar
  const [sideNavWidth, setSideNavWidth] = useState(() =>
    Number(localStorage.getItem('sideNavWidth') || 248),
  )
  const isDraggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = sideNavWidth
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      const next = Math.min(480, Math.max(180, dragStartWidthRef.current + delta))
      setSideNavWidth(next)
    }
    const onMouseUp = () => {
      if (!isDraggingRef.current) return
      isDraggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setSideNavWidth((w) => {
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

  // Session lists (split by agent_type)
  const [resumeSessions, setResumeSessions] = useState<AgentChatSession[]>([])
  const [interviewerSessions, setInterviewerSessions] = useState<AgentChatSession[]>([])

  // Active session ids (for sidebar highlight)
  const [resumeActiveId, setResumeActiveId] = useState<number | null>(null)
  const [interviewerActiveId, setInterviewerActiveId] = useState<number | null>(null)

  // Triggers for AgentChatView children
  const [resumeLoadTrigger, setResumeLoadTrigger] = useState(0)
  const [resumeSessionToLoad, setResumeSessionToLoad] = useState<AgentChatSession | null>(null)
  const [resumeNewChatTrigger, setResumeNewChatTrigger] = useState(0)

  const [interviewerLoadTrigger, setInterviewerLoadTrigger] = useState(0)
  const [interviewerSessionToLoad, setInterviewerSessionToLoad] = useState<AgentChatSession | null>(null)
  const [interviewerNewChatTrigger, setInterviewerNewChatTrigger] = useState(0)

  // Today's events / reminders (shared)
  const [todayEvents, setTodayEvents] = useState<{ id: number; title: string; event_time: string | null }[]>([])
  const [remindersDismissed, setRemindersDismissed] = useState(false)

  const activeNav = useMemo<NavKey>(() => {
    if (location.pathname.startsWith('/student/resumes')) return 'resume'
    if (location.pathname.startsWith('/student/profile')) return 'profile'
    if (location.pathname.startsWith('/student/interviewer')) return 'interviewer'
    return 'resume-agent'
  }, [location.pathname])

  const navItems: { key: NavKey; icon: ReactNode; label: string }[] = [
    { key: 'resume-agent', icon: <IconRobot />, label: 'AI简历助手' },
    { key: 'interviewer', icon: <IconBook />, label: 'AI面试官' },
    { key: 'resume', icon: <IconFile />, label: '简历制作' },
    { key: 'profile', icon: <IconUser />, label: '个人中心' },
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
    if (activeNav === 'profile') {
      return { title: '个人中心', subtitle: '管理个人资料与账号安全' }
    }
    return { title: 'AI简历助手', subtitle: '智能辅助简历制作、优化表达与岗位匹配' }
  }, [activeNav, location.pathname])

  const navigateToNav = (key: NavKey) => {
    if (key === 'resume-agent') navigate('/student')
    else if (key === 'interviewer') navigate('/student/interviewer')
    else if (key === 'resume') navigate('/student/resumes')
    else navigate('/student/profile')
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
      setInterviewerSessions([])
      try {
        const [list, sessions] = await Promise.all([
          apiRequest<AgentModelOption[]>('/api/v1/student/master/models'),
          apiRequest<AgentChatSession[]>('/api/v1/student/master/sessions'),
        ])
        if (!alive) return
        setModelOptions(list)
        if (list.length === 0) setNotice('当前没有可用模型，请管理员先在模型广场开启「对学生开放」。')
        setResumeSessions(sessions.filter((s) => !s.agent_type || s.agent_type === 'resume'))
        setInterviewerSessions(sessions.filter((s) => s.agent_type === 'interviewer'))
      } catch (error) {
        if (alive) setNotice(error instanceof ApiError ? error.message : '初始化失败')
      }
    }, 0)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [session])

  // ── Session management callbacks ──

  const handleNewChat = (type: 'resume' | 'interviewer') => {
    if (type === 'resume') {
      setResumeNewChatTrigger((v) => v + 1)
      navigate('/student')
    } else {
      setInterviewerNewChatTrigger((v) => v + 1)
      navigate('/student/interviewer')
    }
  }

  const handleSelectSession = (s: AgentChatSession) => {
    if (s.agent_type === 'interviewer') {
      setInterviewerSessionToLoad(s)
      setInterviewerLoadTrigger((v) => v + 1)
      navigate('/student/interviewer')
    } else {
      setResumeSessionToLoad(s)
      setResumeLoadTrigger((v) => v + 1)
      navigate('/student')
    }
  }

  const handleDeleteSession = async (target: AgentChatSession) => {
    try {
      await apiRequest(`/api/v1/student/master/sessions/${target.id}`, { method: 'DELETE' })
      if (target.agent_type === 'interviewer') {
        setInterviewerSessions((prev) => prev.filter((s) => s.id !== target.id))
        if (interviewerActiveId === target.id) {
          setInterviewerNewChatTrigger((v) => v + 1)
        }
      } else {
        setResumeSessions((prev) => prev.filter((s) => s.id !== target.id))
        if (resumeActiveId === target.id) {
          setResumeNewChatTrigger((v) => v + 1)
        }
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

  const handleInterviewerSessionUpdated = useCallback((s: AgentChatSession) => {
    setInterviewerSessions((prev) => {
      const existing = prev.find((x) => x.id === s.id)
      const entry: AgentChatSession = { ...s, title: existing?.title || s.title }
      return [entry, ...prev.filter((x) => x.id !== s.id)]
    })
  }, [])

  return (
    <div className="app-shell student-shell">
      <aside
        className={`side-nav${navCollapsed ? ' side-nav--collapsed' : ''}`}
        style={navCollapsed ? undefined : { width: sideNavWidth }}
      >
        <div className="brand-mark">
          <img className="brand-logo" src="/baidi.png" alt="CareerForge" />
          <div>
            <h1>CareerForge</h1>
            <p>学生端</p>
          </div>
        </div>

        <div className="side-nav-menu">
          {navItems.map(({ key, icon, label }) => (
            <Button
              key={key}
              className="side-nav-item"
              type={activeNav === key ? 'primary' : 'text'}
              icon={icon}
              onClick={() => navigateToNav(key)}
            >
              {label}
            </Button>
          ))}
        </div>

        <div className="side-nav-history">
          {/* AI简历助手 history group */}
          <div className="side-nav-history-group">
            <div className="side-nav-history-group-header">
              <span><IconRobot style={{ fontSize: 12, marginRight: 4 }} />AI简历助手</span>
              <button
                type="button"
                className="side-nav-history-group-new"
                title="新建简历助手对话"
                onClick={() => handleNewChat('resume')}
              >
                <IconPlus />
              </button>
            </div>
            <SessionHistoryPanel
              sessions={resumeSessions}
              currentSessionId={activeNav === 'resume-agent' ? resumeActiveId : null}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
            />
          </div>

          {/* AI面试官 history group */}
          <div className="side-nav-history-group">
            <div className="side-nav-history-group-header">
              <span><IconBook style={{ fontSize: 12, marginRight: 4 }} />AI面试官</span>
              <button
                type="button"
                className="side-nav-history-group-new"
                title="新建面试对话"
                onClick={() => handleNewChat('interviewer')}
              >
                <IconPlus />
              </button>
            </div>
            <SessionHistoryPanel
              sessions={interviewerSessions}
              currentSessionId={activeNav === 'interviewer' ? interviewerActiveId : null}
              onSelect={handleSelectSession}
              onDelete={handleDeleteSession}
            />
          </div>
        </div>

        <div className="side-nav-footer">
          <div style={{ fontWeight: 600 }}>{studentName}</div>
          <div className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>{studentEmail}</div>
          <Popconfirm title="确定要退出登录吗？" okText="退出" cancelText="取消" onOk={logout}>
            <Button type="text" size="small" icon={<IconPoweroff />} style={{ paddingLeft: 0, color: '#f53f3f' }}>
              退出登录
            </Button>
          </Popconfirm>
        </div>

        {/* Drag-to-resize handle */}
        {!navCollapsed && (
          <div className="side-nav-resize-handle" onMouseDown={handleResizeMouseDown} />
        )}
      </aside>

      <section className="content-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="side-nav-toggle-btn"
              onClick={() => setNavCollapsed((v) => !v)}
              title={navCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {navCollapsed ? <IconMenuUnfold /> : <IconMenuFold />}
            </button>
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
            <Dropdown
              droplist={
                <Menu>
                  <Menu.Item key="name" disabled>
                    <span style={{ fontWeight: 600 }}>{studentName}</span>
                  </Menu.Item>
                  <Menu.Item key="email" disabled>
                    <span style={{ color: '#86909C', fontSize: 12 }}>{studentEmail}</span>
                  </Menu.Item>
                  <Menu.Item key="logout" onClick={logout}>
                    <IconPoweroff style={{ marginRight: 8 }} />
                    退出登录
                  </Menu.Item>
                </Menu>
              }
              trigger="click"
              position="br"
            >
              <div style={{ cursor: 'pointer', width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#edf2ff', color: '#0b45d9' }}>
                {studentAvatar ? (
                  <img
                    key={studentAvatarKey}
                    src={studentAvatar}
                    alt="avatar"
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <IconUser />
                )}
              </div>
            </Dropdown>
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
                loadTrigger={interviewerLoadTrigger}
                sessionToLoad={interviewerSessionToLoad}
                newChatTrigger={interviewerNewChatTrigger}
                onSessionUpdated={handleInterviewerSessionUpdated}
                onActiveSessionChange={setInterviewerActiveId}
                todayEvents={todayEvents}
                remindersDismissed={remindersDismissed}
                onDismissReminders={() => setRemindersDismissed(true)}
              />
            }
          />
          <Route path="profile" element={<ProfilePage />} />
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
    </div>
  )
}
