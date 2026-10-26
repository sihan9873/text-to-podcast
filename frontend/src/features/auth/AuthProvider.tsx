import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
} from "@/api/auth"
import type { AuthUser } from "@/types/auth"

interface AuthContextValue {
  user: AuthUser | null
  isLoading: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const { data: user = null, isPending } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: ({ signal }) => getCurrentUser(signal),
    retry: false,
    staleTime: 30_000,
  })

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: isPending,
      login: async (username, password) => {
        const authenticatedUser = await loginRequest(username, password)
        queryClient.setQueryData(["auth", "me"], authenticatedUser)
        return authenticatedUser
      },
      logout: async () => {
        try {
          await logoutRequest()
        } finally {
          queryClient.clear()
          queryClient.setQueryData(["auth", "me"], null)
        }
      },
      refreshUser: async () => {
        await queryClient.invalidateQueries({ queryKey: ["auth", "me"] })
      },
    }),
    [isPending, queryClient, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用")
  return context
}
