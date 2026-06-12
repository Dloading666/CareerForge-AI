import { createContext, useContext } from 'react'

export type Role = 'student' | 'admin'

export type SessionProfile = Record<string, string | null | undefined>

export type AuthSession = {
  access: string
  refresh: string
  role: Role
  profile: SessionProfile
}

export type AuthContextValue = {
  session: AuthSession | null
  bootstrapping: boolean
  login: (session: AuthSession) => void
  logout: () => void
  updateAccess: (access: string) => void
  refreshProfile: () => Promise<void>
}

export type MeResponse = {
  id: number
  role: Role
  profile: SessionProfile
}

export const STORAGE_KEY = 'zhipei-auth-session'

export const AuthContext = createContext<AuthContextValue | null>(null)

export function readStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

export function persistSession(session: AuthSession | null) {
  if (!session) {
    localStorage.removeItem(STORAGE_KEY)
    return
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}

