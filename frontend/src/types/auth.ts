export type UserRole = "admin" | "user"
export type UserStatus = "active" | "disabled"

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: UserRole
  status: UserStatus
  createdAt: string
  updatedAt: string
  lastLoginAt: string | null
}
