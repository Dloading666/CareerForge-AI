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
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { apiRequest, ApiError, ssoLogin } from '../shared/api'
import { useAuth } from '../shared/auth'

type StudentMode = 'login' | 'register' | 'reset'
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
  const { session, login, bootstrapping } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [role, setRole] = useState<Role>('student')
  const [studentMode, setStudentMode] = useState<StudentMode>('login')
  const [studentEmail, setStudentEmail] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [studentPassword, setStudentPassword] = useState('')
  const [studentConfirmPassword, setStudentConfirmPassword] = useState('')
  const [adminAccount, setAdminAccount] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [debugCode, setDebugCode] = useState<string | null>(null)
  const [captchaId, setCaptchaId] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
  const [studentCaptcha, setStudentCaptcha] = useState('')
  const [ssoToken, setSsoToken] = useState('')
  const [ssoSubmitting, setSsoSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    content: string
  } | null>(null)
  const ssoAutoTriedRef = useRef(false)

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

  // 中台跳回 ?token=xxx：自动登录一次，成功后清掉 URL 上的 token 防泄漏
  // 注意：URL 上有 token 时 SSO 优先于 localStorage 会话（避免 A 用户的会话挡住 B 用户从
  // 中台跳过来登录）。等待 AuthProvider bootstrap 完成后再做，避免与本地会话并发竞态。
  useEffect(() => {
    if (ssoAutoTriedRef.current) return
    const params = new URLSearchParams(location.search)
    const token = params.get('token')?.trim()
    if (!token) return
    if (bootstrapping) return
    ssoAutoTriedRef.current = true

    void (async () => {
      setSsoSubmitting(true)
      try {
        const data = await ssoLogin(token)
        login(data)
        setFeedback({ type: 'success', content: '中台登录成功，正在进入学生端' })
        navigate('/student', { replace: true })
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '中台 token 无效'
        setFeedback({
          type: 'error',
          content: `中台 token 无效：${message}。请重新登录中台后重试，或用邮箱登录`,
        })
        navigate('/auth', { replace: true })
      } finally {
        setSsoSubmitting(false)
      }
    })()
  }, [location.pathname, location.search, login, bootstrapping, navigate])

  // URL 上有 token 时不要用旧 session 跳走，等 SSO 处理完
  // feedback 是 error 时也不跳（让 SSO 失败提示留在登录页）
  const urlHasToken = !!new URLSearchParams(location.search).get('token')?.trim()
  const hasErrorFeedback = feedback?.type === 'error'
  if (session && !urlHasToken && !hasErrorFeedback) {
    return <Navigate to={session.role === 'admin' ? '/admin' : '/student'} replace />
  }

  async function loadCaptcha() {
    try {
      const data = await apiRequest<{ captcha_id: string; image: string }>('/api/v1/auth/captcha')
      setCaptchaId(data.captcha_id)
      setCaptchaImage(data.image)
      setStudentCaptcha('')
    } catch {
      // 图形验证码加载失败时忽略，用户可点击图片重试
    }
  }

  async function handleSendCode() {
    if (!studentEmail.trim()) {
      notify.warning('请先输入邮箱地址')
      return
    }
    const scene = studentMode === 'reset' ? 'reset' : 'register'
    if (scene === 'reset' && !studentCaptcha.trim()) {
      notify.warning('请先完成图形验证码')
      return
    }
    setSendingCode(true)
    try {
      const body: Record<string, string> = { email: studentEmail.trim(), scene }
      if (scene === 'reset') {
        body.captcha_id = captchaId
        body.captcha_code = studentCaptcha.trim()
      }
      const data = await apiRequest<{ cooldown_sec: number; debug_code?: string }>(
        '/api/v1/auth/student/email/send-code',
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
      )
      setCountdown(data.cooldown_sec)
      setDebugCode(data.debug_code ?? null)
      notify.success('验证码已发送，请查收邮箱')
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '发送验证码失败'
      notify.error(message)
      if (scene === 'reset') void loadCaptcha() // 失败后刷新图形验证码
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

  function backToLogin() {
    setStudentMode('login')
    setStudentCode('')
    setStudentPassword('')
    setStudentConfirmPassword('')
    setDebugCode(null)
    setCountdown(0)
    setFeedback(null)
  }

  async function handleResetPassword() {
    if (!studentEmail.trim()) {
      notify.warning('请填写邮箱')
      return
    }
    if (!studentCode.trim() || !studentPassword || !studentConfirmPassword) {
      notify.warning('请完整填写验证码和新密码')
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

    setSubmitting(true)
    try {
      await apiRequest('/api/v1/auth/student/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: studentEmail.trim(),
          code: studentCode.trim(),
          password: studentPassword,
          confirm_password: studentConfirmPassword,
        }),
      })
      notify.success('密码重置成功，请使用新密码登录')
      setStudentMode('login')
      setStudentCode('')
      setStudentPassword('')
      setStudentConfirmPassword('')
      setDebugCode(null)
      setCountdown(0)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '密码重置失败'
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

  async function handleSSOSubmit() {
    const token = ssoToken.trim()
    if (!token) {
      notify.warning('请粘贴中台 token')
      return
    }
    setSsoSubmitting(true)
    try {
      const data = await ssoLogin(token)
      login(data)
      notify.success('中台登录成功，正在进入学生端')
      navigate('/student', { replace: true })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '中台登录失败'
      notify.error(`中台 token 无效：${message}。请重新登录中台后重试，或用邮箱登录`)
    } finally {
      setSsoSubmitting(false)
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
              {studentMode === 'reset' ? (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <button type="button" className="auth-link-btn" onClick={backToLogin}>
                    ← 返回登录
                  </button>
                  <Typography.Title heading={6} style={{ margin: 0 }}>
                    重置密码
                  </Typography.Title>
                  <Typography.Text type="secondary">
                    输入绑定的邮箱，获取验证码后设置新密码。
                  </Typography.Text>

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
                    placeholder="输入绑定的邮箱"
                    value={studentEmail}
                    onChange={setStudentEmail}
                  />
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Input
                      size="large"
                      prefix={<IconSafe />}
                      placeholder="输入图形验证码"
                      value={studentCaptcha}
                      onChange={setStudentCaptcha}
                      style={{ flex: 1 }}
                    />
                    <img
                      src={captchaImage || undefined}
                      alt="图形验证码"
                      title="点击刷新"
                      onClick={() => void loadCaptcha()}
                      style={{
                        height: 40,
                        width: 112,
                        borderRadius: 8,
                        cursor: 'pointer',
                        border: '1px solid var(--surface-border)',
                        objectFit: 'cover',
                        flexShrink: 0,
                        background: '#f5f7fc',
                      }}
                    />
                  </div>
                  <Input
                    size="large"
                    prefix={<IconSafe />}
                    placeholder="输入邮箱验证码"
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
                    placeholder="输入新密码"
                    value={studentPassword}
                    onChange={setStudentPassword}
                    onPressEnter={handleResetPassword}
                  />
                  <Input.Password
                    size="large"
                    prefix={<IconUser />}
                    placeholder="再次输入新密码"
                    value={studentConfirmPassword}
                    onChange={setStudentConfirmPassword}
                    onPressEnter={handleResetPassword}
                  />
                  <Typography.Text type="secondary">
                    密码至少 8 位，且需包含大写字母、小写字母和数字。
                  </Typography.Text>
                  <Button type="primary" size="large" long loading={submitting} onClick={handleResetPassword}>
                    重置密码
                  </Button>
                </Space>
              ) : (
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
                    onPressEnter={handleStudentSubmit}
                  />
                  {studentMode === 'register' ? (
                    <>
                      <Input
                        size="large"
                        prefix={<IconSafe />}
                        placeholder="输入验证码"
                        value={studentCode}
                        onChange={setStudentCode}
                        onPressEnter={handleStudentSubmit}
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
                        onPressEnter={handleStudentSubmit}
                      />
                      <Input.Password
                        size="large"
                        prefix={<IconUser />}
                        placeholder="再次输入密码"
                        value={studentConfirmPassword}
                        onChange={setStudentConfirmPassword}
                        onPressEnter={handleStudentSubmit}
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
                      onPressEnter={handleStudentSubmit}
                    />
                  )}
                  <Button type="primary" size="large" long loading={submitting} onClick={handleStudentSubmit}>
                    {studentMode === 'register' ? '注册并进入学生端' : '登录学生端'}
                  </Button>
                  {studentMode === 'login' ? (
                    <div style={{ textAlign: 'right', marginTop: -6 }}>
                      <button
                        type="button"
                        className="auth-link-btn"
                        onClick={() => {
                          setStudentMode('reset')
                          setStudentPassword('')
                          setStudentConfirmPassword('')
                          setStudentCode('')
                          setDebugCode(null)
                          setCountdown(0)
                          setFeedback(null)
                          void loadCaptcha()
                        }}
                      >
                        忘记密码？
                      </button>
                    </div>
                  ) : null}
                </Space>
              )}
            </Tabs.TabPane>

            <Tabs.TabPane key="admin" title="管理员">
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Input
                  size="large"
                  prefix={<IconUser />}
                  placeholder="输入管理员账号"
                  value={adminAccount}
                  onChange={setAdminAccount}
                  onPressEnter={handleAdminSubmit}
                />
                <Input.Password
                  size="large"
                  prefix={<IconLock />}
                  placeholder="输入管理员密码"
                  value={adminPassword}
                  onChange={setAdminPassword}
                  onPressEnter={handleAdminSubmit}
                />
                <Button type="primary" size="large" long loading={submitting} onClick={handleAdminSubmit}>
                  登录管理员端
                </Button>
              </Space>
            </Tabs.TabPane>
          </Tabs>

          <Divider style={{ margin: '20px 0 16px' }}>其他登录方式</Divider>

          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              已在中台登录？粘贴中台 token 直接进入学生端。
            </Typography.Text>
            <Input
              size="large"
              placeholder="粘贴中台 token"
              value={ssoToken}
              onChange={setSsoToken}
              onPressEnter={handleSSOSubmit}
            />
            <Button
              type="secondary"
              size="large"
              long
              loading={ssoSubmitting}
              onClick={handleSSOSubmit}
            >
              用中台账号登录
            </Button>
          </Space>

        </Card>
      </section>
    </div>
  )
}
