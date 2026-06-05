import {
  Alert,
  Button,
  Card,
  Divider,
  Input,
  Space,
  Tabs,
  Typography,
} from '@arco-design/web-react'
import { IconEmail, IconLock, IconSafe, IconUser } from '@arco-design/web-react/icon'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'

import { apiRequest, ApiError } from '../shared/api'
import { useAuth } from '../shared/auth'

type StudentMode = 'login' | 'register'
type Role = 'student' | 'admin'

type StudentAuthResponse = {
  access: string
  refresh: string
  role: 'student'
  profile: Record<string, string | null | undefined>
}

type AdminAuthResponse = {
  access: string
  refresh: string
  role: 'admin'
  profile: Record<string, string | null | undefined>
}

export function AuthPage() {
  const { session, login } = useAuth()
  const [role, setRole] = useState<Role>('student')
  const [studentMode, setStudentMode] = useState<StudentMode>('login')
  const [studentEmail, setStudentEmail] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [studentPassword, setStudentPassword] = useState('')
  const [studentConfirmPassword, setStudentConfirmPassword] = useState('')
  const [adminAccount, setAdminAccount] = useState('admin')
  const [adminPassword, setAdminPassword] = useState('123456')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [debugCode, setDebugCode] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    content: string
  } | null>(null)

  // Arco 的命令式 Message 在 React 19 下不渲染，这里用受控的内联 Alert 反馈替代。
  const notify = {
    success: (content: string) => setFeedback({ type: 'success', content }),
    error: (content: string) => setFeedback({ type: 'error', content }),
    warning: (content: string) => setFeedback({ type: 'warning', content }),
    info: (content: string) => setFeedback({ type: 'info', content }),
  }

  useEffect(() => {
    if (countdown <= 0) {
      return
    }
    const timer = window.setTimeout(() => setCountdown((current) => current - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  if (session) {
    return <Navigate to={session.role === 'admin' ? '/admin' : '/student'} replace />
  }

  async function handleSendCode() {
    if (!studentEmail.trim()) {
      notify.warning('请先输入邮箱地址')
      return
    }
    setSendingCode(true)
    try {
      const data = await apiRequest<{ cooldown_sec: number; debug_code?: string }>(
        '/api/v1/auth/student/email/send-code',
        {
          method: 'POST',
          body: JSON.stringify({
            email: studentEmail.trim(),
            scene: 'register',
          }),
        },
      )
      setCountdown(data.cooldown_sec)
      setDebugCode(data.debug_code ?? null)
      notify.success('验证码已发送，请查收邮箱')
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '发送验证码失败'
      notify.error(message)
    } finally {
      setSendingCode(false)
    }
  }

  async function handleStudentSubmit() {
    if (!studentEmail.trim()) {
      notify.warning('请填写邮箱')
      return
    }

    if (studentMode === 'register') {
      if (!studentCode.trim() || !studentPassword || !studentConfirmPassword) {
        notify.warning('请完整填写注册信息')
        return
      }
      if (studentPassword !== studentConfirmPassword) {
        notify.warning('两次输入的密码不一致')
        return
      }
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(studentPassword)) {
        notify.warning('密码至少 8 位，且需包含大写字母、小写字母和数字')
        return
      }
    } else if (!studentPassword) {
      notify.warning('请填写登录密码')
      return
    }

    setSubmitting(true)
    try {
      const path = studentMode === 'register' ? '/api/v1/auth/student/register' : '/api/v1/auth/student/login'
      const payload =
        studentMode === 'register'
          ? {
              email: studentEmail.trim(),
              code: studentCode.trim(),
              password: studentPassword,
              confirm_password: studentConfirmPassword,
            }
          : {
              email: studentEmail.trim(),
              password: studentPassword,
            }

      const data = await apiRequest<StudentAuthResponse>(path, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

      login(data)
      notify.success(studentMode === 'register' ? '注册成功，正在进入学生端' : '登录成功，正在进入学生端')
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '学生登录失败'
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleAdminSubmit() {
    if (!adminAccount.trim() || !adminPassword.trim()) {
      notify.warning('请填写管理员账号和密码')
      return
    }

    setSubmitting(true)
    try {
      const data = await apiRequest<AdminAuthResponse>('/api/v1/auth/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          account: adminAccount.trim(),
          password: adminPassword,
        }),
      })
      login(data)
      notify.success('登录成功，正在进入管理员端')
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '管理员登录失败'
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div className="auth-brand-content">
          <img className="auth-brand-logo" src="/baidi.png" alt="CareerForge" />
          <h1 className="auth-brand-title">CareerForge AI</h1>
        </div>
      </section>

      <section className="auth-panel">
        <Card className="auth-card" bodyStyle={{ padding: 28 }}>
          <div className="auth-card-header">
            <h2>登录 / 注册</h2>
            <p>先完成双端身份入口，后续能力在这个骨架上继续扩展。</p>
          </div>

          {feedback ? (
            <Alert
              style={{ marginBottom: 16 }}
              type={feedback.type}
              content={feedback.content}
              showIcon
              closable
              onClose={() => setFeedback(null)}
            />
          ) : null}

          <Tabs
            activeTab={role}
            onChange={(nextRole) => {
              setRole(nextRole as Role)
              setFeedback(null)
            }}
          >
            <Tabs.TabPane key="student" title="学生">
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Tabs
                  activeTab={studentMode}
                  onChange={(value) => {
                    setStudentMode(value as StudentMode)
                    setFeedback(null)
                  }}
                  size="small"
                >
                  <Tabs.TabPane key="login" title="邮箱登录" />
                  <Tabs.TabPane key="register" title="邮箱注册" />
                </Tabs>

                {debugCode ? (
                  <Alert
                    className="debug-code-banner"
                    type="info"
                    content={`开发环境验证码：${debugCode}`}
                    showIcon
                  />
                ) : null}

                <Input
                  size="large"
                  prefix={<IconEmail />}
                  placeholder="输入学生邮箱"
                  value={studentEmail}
                  onChange={setStudentEmail}
                />
                {studentMode === 'register' ? (
                  <>
                    <Input
                      size="large"
                      prefix={<IconSafe />}
                      placeholder="输入验证码"
                      value={studentCode}
                      onChange={setStudentCode}
                      addAfter={
                        <Button
                          type="text"
                          size="small"
                          disabled={countdown > 0}
                          loading={sendingCode}
                          onClick={handleSendCode}
                        >
                          {countdown > 0 ? `${countdown}s` : '发送验证码'}
                        </Button>
                      }
                    />
                    <Input.Password
                      size="large"
                      prefix={<IconLock />}
                      placeholder="输入登录密码"
                      value={studentPassword}
                      onChange={setStudentPassword}
                    />
                    <Input.Password
                      size="large"
                      prefix={<IconUser />}
                      placeholder="再次输入密码"
                      value={studentConfirmPassword}
                      onChange={setStudentConfirmPassword}
                    />
                    <Typography.Text type="secondary">
                      密码至少 8 位，且需包含大写字母、小写字母和数字。
                    </Typography.Text>
                  </>
                ) : (
                  <Input.Password
                    size="large"
                    prefix={<IconLock />}
                    placeholder="输入登录密码"
                    value={studentPassword}
                    onChange={setStudentPassword}
                  />
                )}
                <Button type="primary" size="large" long loading={submitting} onClick={handleStudentSubmit}>
                  {studentMode === 'register' ? '注册并进入学生端' : '登录学生端'}
                </Button>
              </Space>
            </Tabs.TabPane>

            <Tabs.TabPane key="admin" title="管理员">
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="warning"
                  showIcon
                  content="管理员账号当前不开放注册，首次启动会根据后端环境变量自动初始化。"
                />
                <Input
                  size="large"
                  prefix={<IconUser />}
                  placeholder="输入管理员账号"
                  value={adminAccount}
                  onChange={setAdminAccount}
                />
                <Input.Password
                  size="large"
                  prefix={<IconLock />}
                  placeholder="输入管理员密码"
                  value={adminPassword}
                  onChange={setAdminPassword}
                />
                <Button type="primary" size="large" long loading={submitting} onClick={handleAdminSubmit}>
                  登录管理员端
                </Button>
              </Space>
            </Tabs.TabPane>
          </Tabs>

          <Divider />
          <div className="auth-form-footer">默认管理员：admin / 123456</div>
        </Card>
      </section>
    </div>
  )
}
