import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from "@/api/auth"
import { AUTH_REQUIRED_EVENT } from "@/api/request"
import type { AuthUser } from "@/types/auth"

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  register: (
    username: string,
    displayName: string,
    password: string
  ) => Promise<AuthUser>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  loginNotice: string | null
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const [loginNotice, setLoginNotice] = React.useState<string | null>(null)
  const { data: user = null, isPending } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
    staleTime: 30_000,
  })

  const clearPrivateState = React.useCallback(() => {
    queryClient.setQueryData(["auth", "me"], null)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    })
  }, [queryClient])

  React.useEffect(() => {
    const handleUnauthorized = () => {
      clearPrivateState()
      setLoginNotice("登录状态已失效，请重新登录")
    }
    window.addEventListener(AUTH_REQUIRED_EVENT, handleUnauthorized)
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, handleUnauthorized)
  }, [clearPrivateState])

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      login: async (username, password) => {
        const authenticatedUser = await loginRequest(username, password)
        queryClient.setQueryData(["auth", "me"], authenticatedUser)
        setLoginNotice(null)
        return authenticatedUser
      },
      register: async (username, displayName, password) => {
        const authenticatedUser = await registerRequest(
          username,
          displayName,
          password
        )
        queryClient.setQueryData(["auth", "me"], authenticatedUser)
        setLoginNotice(null)
        return authenticatedUser
      },
      logout: async () => {
        try {
          await logoutRequest()
        } finally {
          clearPrivateState()
          setLoginNotice("已安全退出，请重新登录")
        }
      },
      refreshUser: async () => {
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] })
      },
      loginNotice,
    }),
    [clearPrivateState, isPending, loginNotice, queryClient, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用")
  return context
}
