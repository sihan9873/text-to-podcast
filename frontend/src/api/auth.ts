import { ApiError, request } from "@/api/request"
import type { AuthUser } from "@/types/auth"

interface MeResponse {
  user: AuthUser
}

interface LoginResponse extends MeResponse {
  expiresAt: string
}

export async function getCurrentUser(
  signal?: AbortSignal
): Promise<AuthUser | null> {
  try {
    const response = await request<MeResponse>("/auth/me", { signal })
    return response.user
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.code === "AUTH_REQUIRED")
    ) {
      return null
    }
    throw error
  }
}

export async function login(
  username: string,
  password: string
): Promise<AuthUser> {
  const response = await request<LoginResponse>("/auth/login", {
    method: "POST",
    body: { username, password },
  })
  return response.user
}

export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" })
}

export async function updateMyProfile(displayName: string): Promise<AuthUser> {
  const response = await request<MeResponse>("/auth/me", {
    method: "PATCH",
    body: { displayName },
  })
  return response.user
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<AuthUser> {
  const response = await request<LoginResponse>("/auth/change-password", {
    method: "POST",
    body: { currentPassword, newPassword },
  })
  return response.user
}
