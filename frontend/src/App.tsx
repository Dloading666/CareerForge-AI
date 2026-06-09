import { Navigate, Route, Routes } from 'react-router-dom'

import { AdminHomePage } from './admin/AdminHomePage'
import { AuthPage } from './auth/AuthPage'
import { StudentHomePage } from './student/StudentHomePage'
import { ProtectedRoute } from './shared/ProtectedRoute'
import { useAuth } from './shared/auth'

function HomeRedirect() {
  const { session } = useAuth()

  if (!session) {
    return <Navigate to="/auth" replace />
  }

  return <Navigate to={session.role === 'admin' ? '/admin' : '/student'} replace />
}

function App() {
  return (
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
  )
}

export default App
