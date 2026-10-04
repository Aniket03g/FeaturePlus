import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import * as api from './api'
import type { Session, User } from './types'

/**
 * Session state.
 *
 * The JWT lives in an HttpOnly cookie, so the app cannot read it. Identity
 * therefore comes from asking the server: /me succeeds when the cookie is
 * valid and returns 401 when it is not. That one request is the whole
 * "am I logged in" check, and it survives a page reload for free.
 */

interface AuthValue {
  user: User | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()

  const { data: user, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<User>('/me'),
    // A 401 here is the normal signed-out state, not a failure worth retrying.
    retry: (failCount, error) =>
      !(error instanceof api.ApiError && error.isAuthFailure) && failCount < 2,
    staleTime: 5 * 60 * 1000,
  })

  const signInMutation = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api.post<Session>('/auth/login', vars),
    onSuccess: (session) => {
      // Seed the cache from the login response so the app renders immediately
      // instead of waiting on a second round trip to /me.
      queryClient.setQueryData(['me'], session.user)
    },
  })

  // Signing up also signs in: the server sets the session cookie and returns
  // the same shape as login.
  const signUpMutation = useMutation({
    mutationFn: (vars: { name: string; email: string; password: string }) =>
      api.post<Session>('/auth/signup', vars),
    onSuccess: (session) => {
      queryClient.setQueryData(['me'], session.user)
    },
  })

  const signOutMutation = useMutation({
    mutationFn: () => api.post<void>('/auth/logout'),
    onSettled: () => {
      // Clear everything: cached data belongs to the account that just left.
      queryClient.clear()
      queryClient.setQueryData(['me'], null)
    },
  })

  const signIn = useCallback(
    async (email: string, password: string) => {
      await signInMutation.mutateAsync({ email, password })
    },
    [signInMutation],
  )

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      await signUpMutation.mutateAsync({ name, email, password })
    },
    [signUpMutation],
  )

  const signOut = useCallback(async () => {
    await signOutMutation.mutateAsync()
  }, [signOutMutation])

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
