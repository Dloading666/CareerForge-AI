import {
  Alert,
  Button,
  Card,
  Input,
  Tabs,
  Typography,
} from '@arco-design/web-react'
import { IconEmail, IconLock, IconSafe, IconUser } from '@arco-design/web-react/icon'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { apiRequest, ApiError, ssoLogin } from '../shared/api'
import { useAuth } from '../shared/auth'

type StudentMode = 'login' | 'register' | 'reset'

type LoginResponse = {
  access: string
  refresh: string
  role: 'student' | 'admin'
  profile: Record<string, string | null | undefined>
}

export function AuthPage() {
  const { session, login, bootstrapping } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [studentMode, setStudentMode] = useState<StudentMode>('login')
  const [account, setAccount] = useState('')
  const [studentCode, setStudentCode] = useState('')
  const [password, setPassword] = useState('')
  const [studentConfirmPassword, setStudentConfirmPassword] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [captchaId, setCaptchaId] = useState('')
  const [captchaImage, setCaptchaImage] = useState('')
  const [studentCaptcha, setStudentCaptcha] = useState('')
  const [captchaError, setCaptchaError] = useState(false)
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | 'info'
    content: string
  } | null>(null)
  const ssoAutoTriedRef = useRef(false)
  const prevEmailRef = useRef('')

  const notify = {
    success: (content: string) => setFeedback({ type: 'success', content }),
    error: (content: string) => setFeedback({ type: 'error', content }),
    warning: (content: string) => setFeedback({ type: 'warning', content }),
    info: (content: string) => setFeedback({ type: 'info', content }),
  }

  // 倒计时
  useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  // 进入注册/重置模式时加载图形验证码
  useEffect(() => {
    if (studentMode === 'register' || studentMode === 'reset') {
      void loadCaptcha()
    }
  }, [studentMode])

  // 邮箱改变后清空邮箱验证码和倒计时
  useEffect(() => {
    if (prevEmailRef.current && prevEmailRef.current !== account) {
      setStudentCode('')
      setCountdown(0)
    }
    prevEmailRef.current = account
  }, [account])

  // 中台 SSO 自动登录
  useEffect(() => {
    if (ssoAutoTriedRef.current) return
    const params = new URLSearchParams(location.search)
    const token = params.get('token')?.trim()
    if (!token) return
    if (bootstrapping) return
    ssoAutoTriedRef.current = true

    void (async () => {
      try {
        const data = await ssoLogin(token)
        login(data)
        navigate('/student', { replace: true })
      } catch (error) {
        const message = error instanceof ApiError ? error.message : '中台 token 无效'
        setFeedback({
          type: 'error',
          content: `中台 token 无效：${message}`,
        })
        navigate('/auth', { replace: true })
      }
    })()
  }, [location.pathname, location.search, login, bootstrapping, navigate])

  const urlHasToken = !!new URLSearchParams(location.search).get('token')?.trim()
  const hasErrorFeedback = feedback?.type === 'error'
  if (session && !urlHasToken && !hasErrorFeedback) {
    return <Navigate to={session.role === 'admin' ? '/admin' : '/student'} replace />
  }

  async function loadCaptcha() {
    setCaptchaError(false)
    try {
      const data = await apiRequest<{ captcha_id: string; image: string }>('/api/v1/auth/captcha')
      setCaptchaId(data.captcha_id)
      setCaptchaImage(data.image)
      setStudentCaptcha('')
    } catch {
      setCaptchaError(true)
    }
  }

  async function handleSendCode() {
    if (!account.trim()) {
      notify.warning('请先输入邮箱地址')
      return
    }
    if (!studentCaptcha.trim()) {
      notify.warning('请先完成图形验证码')
      return
    }
    if (!captchaId) {
      notify.warning('图形验证码未加载，请点击图片刷新')
      return
    }
    const scene = studentMode === 'reset' ? 'reset' : 'register'
    setSendingCode(true)
    try {
      const body: Record<string, string> = {
        email: account.trim(),
        scene,
        captcha_id: captchaId,
        captcha_code: studentCaptcha.trim(),
      }
      const data = await apiRequest<{ cooldown_sec: number }>(
        '/api/v1/auth/student/email/send-code',
        { method: 'POST', body: JSON.stringify(body) },
      )
      setCountdown(data.cooldown_sec)
      notify.success('验证码已发送，请查收邮箱')
      void loadCaptcha()
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '发送验证码失败'
      notify.error(message)
      void loadCaptcha()
    } finally {
      setSendingCode(false)
    }
  }

  async function handleLogin() {
    if (!account.trim()) {
      notify.warning('请填写账号或邮箱')
      return
    }
    if (!password) {
      notify.warning('请填写密码')
      return
    }

    setSubmitting(true)
    try {
      const data = await apiRequest<LoginResponse>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ account: account.trim(), password }),
      })
      login(data)
      navigate(data.role === 'admin' ? '/admin' : '/student', { replace: true })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '登录失败'
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRegister() {
    if (!account.trim()) {
      notify.warning('请填写邮箱')
      return
    }
    if (!studentCode.trim() || !password || !studentConfirmPassword) {
      notify.warning('请完整填写注册信息')
      return
    }
    if (password !== studentConfirmPassword) {
      notify.warning('两次输入的密码不一致')
      return
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      notify.warning('密码至少 8 位，且需包含大写字母、小写字母和数字')
      return
    }

    setSubmitting(true)
    try {
      const data = await apiRequest<LoginResponse>('/api/v1/auth/student/register', {
        method: 'POST',
        body: JSON.stringify({
          email: account.trim(),
          code: studentCode.trim(),
          password,
          confirm_password: studentConfirmPassword,
        }),
      })
      login(data)
      navigate('/student', { replace: true })
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '注册失败'
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  function backToLogin() {
    setStudentMode('login')
    setStudentCode('')
    setPassword('')
    setStudentConfirmPassword('')
    setCountdown(0)
    setFeedback(null)
  }

  async function handleResetPassword() {
    if (!account.trim()) {
      notify.warning('请填写邮箱')
      return
    }
    if (!studentCode.trim() || !password || !studentConfirmPassword) {
      notify.warning('请完整填写验证码和新密码')
      return
    }
    if (password !== studentConfirmPassword) {
      notify.warning('两次输入的密码不一致')
      return
    }
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) {
      notify.warning('密码至少 8 位，且需包含大写字母、小写字母和数字')
      return
    }

    setSubmitting(true)
    try {
      await apiRequest('/api/v1/auth/student/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          email: account.trim(),
          code: studentCode.trim(),
          password,
          confirm_password: studentConfirmPassword,
        }),
      })
      notify.success('密码重置成功，请使用新密码登录')
      setStudentMode('login')
      setStudentCode('')
      setPassword('')
      setStudentConfirmPassword('')
      setCountdown(0)
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '密码重置失败'
      notify.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  const captchaImageEl = captchaError ? (
    <div
      onClick={() => void loadCaptcha()}
      style={{
        height: 48,
        width: 120,
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid #e74c3c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        color: '#e74c3c',
        background: '#fdf2f2',
        flexShrink: 0,
      }}
    >
      加载失败，点击重试
    </div>
  ) : (
    <img
      src={captchaImage || undefined}
      alt="图形验证码"
      title="点击刷新"
      onClick={() => void loadCaptcha()}
      style={{
        height: 48,
        width: 120,
        borderRadius: 8,
        cursor: 'pointer',
        border: '1px solid var(--surface-border)',
        objectFit: 'cover',
        flexShrink: 0,
        background: '#f5f7fc',
      }}
    />
  )

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

          {studentMode === 'reset' ? (
            /* ── 重置密码 ── */
            <div className="register-form">
              <button type="button" className="auth-link-btn" onClick={backToLogin}>
                ← 返回登录
              </button>
              <Typography.Title heading={6} style={{ margin: 0 }}>
                重置密码
              </Typography.Title>
              <Typography.Text type="secondary">
                输入绑定的邮箱，获取验证码后设置新密码。
              </Typography.Text>

              <Input
                size="large"
                prefix={<IconEmail />}
                placeholder="输入绑定的邮箱"
                value={account}
                onChange={setAccount}
              />

              <div className="code-row">
                <Input
                  size="large"
                  prefix={<IconSafe />}
                  placeholder="输入图形验证码"
                  value={studentCaptcha}
                  onChange={setStudentCaptcha}
                />
                {captchaImageEl}
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
                value={password}
                onChange={setPassword}
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
            </div>
          ) : (
            /* ── 登录 / 注册 ── */
            <div className="register-form">
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

              <Input
                size="large"
                prefix={<IconEmail />}
                placeholder={studentMode === 'register' ? '输入邮箱' : '账号或邮箱'}
                value={account}
                onChange={setAccount}
                onPressEnter={studentMode === 'login' ? handleLogin : undefined}
              />

              {studentMode === 'register' ? (
                <>
                  <div className="code-row">
                    <Input
                      size="large"
                      prefix={<IconSafe />}
                      placeholder="输入图形验证码"
                      value={studentCaptcha}
                      onChange={setStudentCaptcha}
                    />
                    {captchaImageEl}
                  </div>

                  <Input
                    size="large"
                    prefix={<IconSafe />}
                    placeholder="输入邮箱验证码"
                    value={studentCode}
                    onChange={setStudentCode}
                    onPressEnter={handleRegister}
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
                    value={password}
                    onChange={setPassword}
                    onPressEnter={handleRegister}
                  />
                  <Input.Password
                    size="large"
                    prefix={<IconUser />}
                    placeholder="再次输入密码"
                    value={studentConfirmPassword}
                    onChange={setStudentConfirmPassword}
                    onPressEnter={handleRegister}
                  />
                  <Typography.Text type="secondary">
                    密码至少 8 位，且需包含大写字母、小写字母和数字。
                  </Typography.Text>
                  <Button type="primary" size="large" long loading={submitting} onClick={handleRegister}>
                    注册并进入学生端
                  </Button>
                </>
              ) : (
                <>
                  <Input.Password
                    size="large"
                    prefix={<IconLock />}
                    placeholder="请输入密码"
                    value={password}
                    onChange={setPassword}
                    onPressEnter={handleLogin}
                  />
                  <Button type="primary" size="large" long loading={submitting} onClick={handleLogin}>
                    登 录
                  </Button>
                  <div style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="auth-link-btn"
                      onClick={() => {
                        setStudentMode('reset')
                        setPassword('')
                        setStudentConfirmPassword('')
                        setStudentCode('')
                        setCountdown(0)
                        setFeedback(null)
                      }}
                    >
                      忘记密码？
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

        </Card>
      </section>
    </div>
  )
}
