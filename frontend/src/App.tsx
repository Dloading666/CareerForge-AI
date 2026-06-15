import { Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { Spin } from '@arco-design/web-react'

const AdminHomePage = lazy(() =>
  import('./admin/AdminHomePage').then((m) => ({ default: m.AdminHomePage })),
)
const AuthPage = lazy(() =>
  import('./auth/AuthPage').then((m) => ({ default: m.AuthPage })),
)
import { StudentHomePage } from './student/StudentHomePage'
import { ProtectedRoute } from './shared/ProtectedRoute'
import { useAuth } from './shared/auth'

function RouteFallback() {
  return (
    <div className="page-shell" style={{ display: 'grid', placeItems: 'center' }}>
      <Spin size={40} tip="页面加载中..." />
    </div>
  )
}

function HomeRedirect() {
  const { session } = useAuth()

  if (!session) {
    return <Navigate to="/auth" replace />
  }

  return <Navigate to={session.role === 'admin' ? '/admin' : '/student'} replace />
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route
          path="/student/*"
          element={
            <ProtectedRoute role="student">
              <StudentHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute role="admin">
              <AdminHomePage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

export default App
