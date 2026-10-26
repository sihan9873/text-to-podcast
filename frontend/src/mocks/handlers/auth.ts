import { delay, http, HttpResponse } from "msw"

import {
  clearMockSession,
  getMockSessionUser,
  mockUsers,
  persistMockUsers,
  publicMockUser,
  setMockSessionUser,
} from "@/mocks/data/users"
import {
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/features/auth/validation"
import type { UserRole, UserStatus } from "@/types/auth"

function error(status: number, code: string, message: string) {
  return HttpResponse.json({ code, message }, { status })
}

function requireUser() {
  const user = getMockSessionUser()
  if (!user || user.status !== "active") return null
  return user
}

function requireAdmin() {
  const user = requireUser()
  if (!user || user.role !== "admin") return null
  return user
}

export const authHandlers = [
  http.post("/api/auth/login", async ({ request }) => {
    await delay(180)
    const body = (await request.json()) as {
      username?: string
      password?: string
    }
    const user = mockUsers.find(
      (item) => item.username === body.username?.trim().toLowerCase()
    )
    if (!user || user.password !== body.password) {
      return error(401, "INVALID_CREDENTIALS", "用户名或密码错误")
    }
    if (user.status !== "active") {
      return error(403, "ACCOUNT_DISABLED", "账户已被禁用，请联系管理员")
    }
    user.lastLoginAt = new Date().toISOString()
    user.updatedAt = user.lastLoginAt
    persistMockUsers()
    setMockSessionUser(user.id)
    return HttpResponse.json({
      user: publicMockUser(user),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    })
  }),

  http.get("/api/auth/me", async () => {
    await delay(80)
    const user = requireUser()
    if (!user) return error(401, "AUTH_REQUIRED", "请先登录")
    return HttpResponse.json({ user: publicMockUser(user) })
  }),

  http.patch("/api/auth/me", async ({ request }) => {
    const user = requireUser()
    if (!user) return error(401, "AUTH_REQUIRED", "请先登录")
    const body = (await request.json()) as { displayName?: string }
    const validationError = validateDisplayName(body.displayName ?? "")
    if (validationError) return error(400, "DISPLAY_NAME_REQUIRED", validationError)
    user.displayName = body.displayName!.trim()
    user.updatedAt = new Date().toISOString()
    persistMockUsers()
    return HttpResponse.json({ user: publicMockUser(user) })
  }),

  http.post("/api/auth/change-password", async ({ request }) => {
    const user = requireUser()
    if (!user) return error(401, "AUTH_REQUIRED", "请先登录")
    const body = (await request.json()) as {
      currentPassword?: string
      newPassword?: string
    }
    if (body.currentPassword !== user.password) {
      return error(400, "CURRENT_PASSWORD_INVALID", "当前密码不正确")
    }
    const validationError = validatePassword(body.newPassword ?? "")
    if (validationError) return error(400, "PASSWORD_INVALID", validationError)
    if (body.newPassword === user.password) {
      return error(400, "PASSWORD_UNCHANGED", "新密码不能与当前密码相同")
    }
    user.password = body.newPassword!
    user.updatedAt = new Date().toISOString()
    persistMockUsers()
    return HttpResponse.json({
      user: publicMockUser(user),
      expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    })
  }),

  http.post("/api/auth/logout", () => {
    clearMockSession()
    return new HttpResponse(null, { status: 204 })
  }),

  http.get("/api/admin/users", async ({ request }) => {
    await delay(120)
    if (!requireAdmin()) {
      return error(403, "ADMIN_REQUIRED", "仅系统管理员可以执行此操作")
    }
    const url = new URL(request.url)
    const search = url.searchParams.get("search")?.toLowerCase()
    const role = url.searchParams.get("role")
    const status = url.searchParams.get("status")
    const users = mockUsers.filter(
      (user) =>
        (!search ||
          user.username.toLowerCase().includes(search) ||
          user.displayName.toLowerCase().includes(search)) &&
        (!role || user.role === role) &&
        (!status || user.status === status)
    )
    return HttpResponse.json({
      users: users.map(publicMockUser),
      total: users.length,
    })
  }),

  http.post("/api/admin/users", async ({ request }) => {
    const admin = requireAdmin()
    if (!admin) return error(403, "ADMIN_REQUIRED", "仅系统管理员可以执行此操作")
    const body = (await request.json()) as {
      username?: string
      displayName?: string
      password?: string
      role?: UserRole
      status?: UserStatus
    }
    const validationError =
      validateUsername(body.username ?? "") ??
      validateDisplayName(body.displayName ?? "") ??
      validatePassword(body.password ?? "")
    if (validationError) return error(400, "CREDENTIAL_INVALID", validationError)
    const username = body.username!.trim().toLowerCase()
    if (mockUsers.some((user) => user.username === username)) {
      return error(409, "USERNAME_EXISTS", "用户名已经存在")
    }
    const timestamp = new Date().toISOString()
    const user = {
      id: `user-${crypto.randomUUID()}`,
      username,
      displayName: body.displayName!.trim(),
      password: body.password!,
      role: body.role ?? "user",
      status: body.status ?? "active",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastLoginAt: null,
    }
    mockUsers.unshift(user)
    persistMockUsers()
    return HttpResponse.json({ user: publicMockUser(user) }, { status: 201 })
  }),

  http.patch("/api/admin/users/:userId", async ({ params, request }) => {
    const admin = requireAdmin()
    if (!admin) return error(403, "ADMIN_REQUIRED", "仅系统管理员可以执行此操作")
    const target = mockUsers.find((user) => user.id === params.userId)
    if (!target) return error(404, "USER_NOT_FOUND", "用户不存在")
    const body = (await request.json()) as {
      displayName?: string
      role?: UserRole
      status?: UserStatus
    }
    if (
      target.id === admin.id &&
      ((body.role && body.role !== admin.role) ||
        (body.status && body.status !== admin.status))
    ) {
      return error(409, "SELF_ACCESS_CHANGE_FORBIDDEN", "不能修改自己的角色或状态")
    }
    if (body.displayName !== undefined) {
      const validationError = validateDisplayName(body.displayName)
      if (validationError) return error(400, "DISPLAY_NAME_REQUIRED", validationError)
      target.displayName = body.displayName.trim()
    }
    if (body.role) target.role = body.role
    if (body.status) target.status = body.status
    target.updatedAt = new Date().toISOString()
    persistMockUsers()
    return HttpResponse.json({ user: publicMockUser(target) })
  }),

  http.post(
    "/api/admin/users/:userId/reset-password",
    async ({ params, request }) => {
      const admin = requireAdmin()
      if (!admin) return error(403, "ADMIN_REQUIRED", "仅系统管理员可以执行此操作")
      const target = mockUsers.find((user) => user.id === params.userId)
      if (!target) return error(404, "USER_NOT_FOUND", "用户不存在")
      if (target.id === admin.id) {
        return error(409, "USE_CHANGE_PASSWORD", "请通过个人资料页面修改自己的密码")
      }
      const body = (await request.json()) as { newPassword?: string }
      const validationError = validatePassword(body.newPassword ?? "")
      if (validationError) return error(400, "PASSWORD_INVALID", validationError)
      target.password = body.newPassword!
      target.updatedAt = new Date().toISOString()
      persistMockUsers()
      return new HttpResponse(null, { status: 204 })
    }
  ),
]
