import { Button, Result, Spin } from '@arco-design/web-react'
import type { ReactNode } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from './auth'

export function ProtectedRoute({
  children,
  role,
}: {
  children: ReactNode
  role: 'student' | 'admin'
}) {
  const { bootstrapping, session, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  if (bootstrapping) {
    return (
      <div className="page-shell" style={{ display: 'grid', placeItems: 'center' }}>
        <Spin size={40} tip="正在恢复登录状态..." />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/auth" replace state={{ from: location.pathname }} />
  }

  if (session.role !== role) {
    return (
      <div className="page-shell" style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
        <Result
          status="403"
          title="无权访问该页面"
          subTitle="当前账号角色与页面不匹配，请切换到正确端。"
          extra={[
            <Button
              key="home"
              type="primary"
              onClick={() => navigate(session.role === 'admin' ? '/admin' : '/student', { replace: true })}
            >
              回到我的首页
            </Button>,
            <Button key="logout" onClick={() => void logout()}>
              退出登录
            </Button>,
          ]}
        />
      </div>
    )
  }

  return <>{children}</>
}

