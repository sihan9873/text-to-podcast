import { request, type QueryParams } from "@/api/request"
import type { AuthUser, UserRole, UserStatus } from "@/types/auth"

export interface UserFilters {
  search?: string
  role?: UserRole
  status?: UserStatus
}

export interface CreateUserInput {
  username: string
  displayName: string
  password: string
  role: UserRole
  status: UserStatus
}

export interface UpdateUserInput {
  displayName?: string
  role?: UserRole
  status?: UserStatus
}

interface UserResponse {
  user: AuthUser
}

interface UserListResponse {
  users: AuthUser[]
  total: number
}

export function getUsers(
  filters: UserFilters = {},
  signal?: AbortSignal
): Promise<UserListResponse> {
  return request<UserListResponse>("/admin/users", {
    query: filters as QueryParams,
    signal,
  })
}

export async function createUser(input: CreateUserInput): Promise<AuthUser> {
  const response = await request<UserResponse>("/admin/users", {
    method: "POST",
    body: input,
  })
  return response.user
}

export async function updateUser(
  userId: string,
  input: UpdateUserInput
): Promise<AuthUser> {
  const response = await request<UserResponse>(
    `/admin/users/${encodeURIComponent(userId)}`,
    { method: "PATCH", body: input }
  )
  return response.user
}

export function resetUserPassword(
  userId: string,
  newPassword: string
): Promise<void> {
  return request<void>(
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    { method: "POST", body: { newPassword } }
  )
}
