import {
  startTransition,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { apiRequest, ApiError } from './api'
import {
  AuthContext,
  type AuthContextValue,
  type AuthSession,
  type MeResponse,
  persistSession,
  readStoredSession,
} from './auth'

async function fetchMe(access: string) {
  return apiRequest<MeResponse>('/api/v1/auth/me', {
    headers: {
      Authorization: `Bearer ${access}`,
    },
  })
}

async function refreshAccess(refresh: string) {
  return apiRequest<{ access: string }>('/api/v1/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh }),
  })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(readStoredSession()))

  useEffect(() => {
    let alive = true
    const stored = readStoredSession()
    if (!stored) {
      return () => {
        alive = false
      }
    }
    const persistedSession: AuthSession = stored

    async function bootstrap() {
      try {
        const me = await fetchMe(persistedSession.access)
        if (!alive) {
          return
        }
        const nextSession: AuthSession = {
          ...persistedSession,
          role: me.role,
          profile: me.profile,
        }
        startTransition(() => {
          setSession(nextSession)
          setBootstrapping(false)
        })
        persistSession(nextSession)
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) {
          if (alive) {
            setBootstrapping(false)
          }
          return
        }

        try {
          const refreshed = await refreshAccess(persistedSession.refresh)
          const me = await fetchMe(refreshed.access)
          if (!alive) {
            return
          }
          const nextSession: AuthSession = {
            ...persistedSession,
            access: refreshed.access,
            role: me.role,
            profile: me.profile,
          }
          startTransition(() => {
            setSession(nextSession)
            setBootstrapping(false)
          })
          persistSession(nextSession)
        } catch {
          if (!alive) {
            return
          }
          persistSession(null)
          startTransition(() => {
            setSession(null)
            setBootstrapping(false)
          })
        }
      }
    }

    bootstrap()
    return () => {
      alive = false
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      bootstrapping,
      login(nextSession) {
        persistSession(nextSession)
        setSession(nextSession)
      },
      logout() {
        // Clear session immediately so the UI redirects at once.
        // Then revoke the refresh token in the background.
        const refresh = session?.refresh
        persistSession(null)
        setSession(null)
        if (refresh) {
          apiRequest('/api/v1/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ refresh }),
          }).catch(() => {})
        }
      },
      updateAccess(access) {
        setSession((current) => {
          if (!current) {
            return current
          }
          const nextSession = { ...current, access }
          persistSession(nextSession)
          return nextSession
        })
      },
      async refreshProfile() {
        const current = session
        if (!current) return
        try {
          const me = await fetchMe(current.access)
          setSession((prev) => {
            if (!prev) return prev
            const nextSession: AuthSession = { ...prev, profile: me.profile }
            persistSession(nextSession)
            return nextSession
          })
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            try {
              const refreshed = await refreshAccess(current.refresh)
              const me = await fetchMe(refreshed.access)
              setSession((prev) => {
                if (!prev) return prev
                const nextSession: AuthSession = {
                  ...prev,
                  access: refreshed.access,
                  profile: me.profile,
                }
                persistSession(nextSession)
                return nextSession
              })
            } catch {
              // ignore
            }
          }
        }
      },
    }),
    [bootstrapping, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
