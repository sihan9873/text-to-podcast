import type { AuthUser } from "@/types/auth"

export interface MockUserRecord extends AuthUser {
  password: string
}

const USERS_KEY = "textcast.mock.users.v1"
const SESSION_KEY = "textcast.mock.session.userId"

const now = new Date().toISOString()
const defaults: MockUserRecord[] = [
  {
    id: "user-admin",
    username: "admin",
    displayName: "系统管理员",
    password: "TextCast123!",
    role: "admin",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  },
  {
    id: "user-demo",
    username: "demo",
    displayName: "演示用户",
    password: "TextCast123!",
    role: "user",
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
  },
]

function loadUsers(): MockUserRecord[] {
  try {
    const stored = localStorage.getItem(USERS_KEY)
    if (stored) return JSON.parse(stored) as MockUserRecord[]
  } catch {
    // localStorage may be unavailable in a restricted browser context.
  }
  return defaults.map((user) => ({ ...user }))
}

export const mockUsers = loadUsers()

export function publicMockUser(record: MockUserRecord): AuthUser {
  const { password: _, ...user } = record
  return user
}

export function persistMockUsers() {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(mockUsers))
  } catch {
    // Keep the in-memory mock usable when persistence is unavailable.
  }
}

export function getMockSessionUser(): MockUserRecord | null {
  try {
    const userId = localStorage.getItem(SESSION_KEY)
    return mockUsers.find((user) => user.id === userId) ?? null
  } catch {
    return null
  }
}

export function setMockSessionUser(userId: string) {
  localStorage.setItem(SESSION_KEY, userId)
}

export function clearMockSession() {
  localStorage.removeItem(SESSION_KEY)
}
