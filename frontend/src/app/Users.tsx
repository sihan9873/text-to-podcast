import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, Plus, Search, ShieldCheck, UserRound } from "lucide-react"

import { ApiError } from "@/api/request"
import {
  createUser,
  getUsers,
  resetUserPassword,
  updateUser,
  type CreateUserInput,
} from "@/api/users"
import { AppButton } from "@/components/common/AppButton"
import {
  AppCard,
  AppCardContent,
  AppCardDescription,
  AppCardHeader,
  AppCardTitle,
} from "@/components/common/AppCard"
import { useAuth } from "@/features/auth/AuthProvider"
import {
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "@/features/auth/validation"
import type { AuthUser, UserRole, UserStatus } from "@/types/auth"

const emptyNewUser: CreateUserInput = {
  username: "",
  displayName: "",
  password: "",
  role: "user",
  status: "active",
}

export default function UsersPage() {
  const { user: currentUser } = useAuth()
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [role, setRole] = React.useState<UserRole | "">("")
  const [status, setStatus] = React.useState<UserStatus | "">("")
  const [showCreate, setShowCreate] = React.useState(false)
  const [newUser, setNewUser] = React.useState<CreateUserInput>(emptyNewUser)
  const [busyUserId, setBusyUserId] = React.useState<string | null>(null)
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ["admin", "users", search, role, status],
    queryFn: ({ signal }) =>
      getUsers(
        {
          search: search.trim() || undefined,
          role: role || undefined,
          status: status || undefined,
        },
        signal
      ),
  })

  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ["admin", "users"] })
  }

  async function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError =
      validateUsername(newUser.username) ??
      validateDisplayName(newUser.displayName) ??
      validatePassword(newUser.password)
    if (validationError) return setError(validationError)
    setError(null)
    try {
      await createUser({
        ...newUser,
        username: newUser.username.trim(),
        displayName: newUser.displayName.trim(),
      })
      setNewUser(emptyNewUser)
      setShowCreate(false)
      setFeedback("用户已创建")
      await refreshUsers()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "创建用户失败")
    }
  }

  async function patchUser(target: AuthUser, changes: Partial<AuthUser>) {
    setBusyUserId(target.id)
    setError(null)
    try {
      await updateUser(target.id, {
        displayName: changes.displayName,
        role: changes.role,
        status: changes.status,
      })
      setFeedback("用户信息已更新")
      await refreshUsers()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "更新用户失败")
    } finally {
      setBusyUserId(null)
    }
  }

  async function resetPassword(target: AuthUser) {
    const newPassword = window.prompt(`请输入 ${target.username} 的新密码`)
    if (newPassword === null) return
    const validationError = validatePassword(newPassword)
    if (validationError) return setError(validationError)
    setBusyUserId(target.id)
    setError(null)
    try {
      await resetUserPassword(target.id, newPassword)
      setFeedback("密码已重置，该用户原有会话已失效")
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "密码重置失败")
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">用户管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建账户、设置角色、禁用账户或重置密码
          </p>
        </div>
        <AppButton onClick={() => setShowCreate((value) => !value)}>
          <Plus />新建用户
        </AppButton>
      </div>

      {(feedback || error) && (
        <p
          role="status"
          className={error ? "text-sm text-destructive" : "text-sm text-primary"}
        >
          {error ?? feedback}
        </p>
      )}

      {showCreate && (
        <AppCard variant="accent">
          <AppCardHeader>
            <AppCardTitle>创建用户</AppCardTitle>
            <AppCardDescription>
              系统不提供公开注册，账户统一由管理员创建。
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form
              className="grid gap-4 md:grid-cols-2 lg:grid-cols-5"
              onSubmit={handleCreate}
            >
              <Field label="用户名">
                <input
                  className={inputClass}
                  value={newUser.username}
                  onChange={(event) =>
                    setNewUser({ ...newUser, username: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="显示名称">
                <input
                  className={inputClass}
                  value={newUser.displayName}
                  onChange={(event) =>
                    setNewUser({ ...newUser, displayName: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="初始密码">
                <input
                  type="password"
                  className={inputClass}
                  value={newUser.password}
                  onChange={(event) =>
                    setNewUser({ ...newUser, password: event.target.value })
                  }
                  required
                />
              </Field>
              <Field label="角色">
                <select
                  className={inputClass}
                  value={newUser.role}
                  onChange={(event) =>
                    setNewUser({
                      ...newUser,
                      role: event.target.value as UserRole,
                    })
                  }
                >
                  <option value="user">普通用户</option>
                  <option value="admin">系统管理员</option>
                </select>
              </Field>
              <div className="flex items-end">
                <AppButton className="w-full" type="submit">
                  创建账户
                </AppButton>
              </div>
            </form>
          </AppCardContent>
        </AppCard>
      )}

      <AppCard>
        <AppCardContent className="p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_160px_160px]">
            <label className="relative">
              <span className="sr-only">搜索用户</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                className={`${inputClass} pl-9`}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索用户名或显示名称"
              />
            </label>
            <select
              className={inputClass}
              value={role}
              onChange={(event) => setRole(event.target.value as UserRole | "")}
              aria-label="按角色筛选"
            >
              <option value="">全部角色</option>
              <option value="admin">系统管理员</option>
              <option value="user">普通用户</option>
            </select>
            <select
              className={inputClass}
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as UserStatus | "")
              }
              aria-label="按状态筛选"
            >
              <option value="">全部状态</option>
              <option value="active">已启用</option>
              <option value="disabled">已禁用</option>
            </select>
          </div>
        </AppCardContent>
      </AppCard>

      {usersQuery.isPending ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          正在加载用户...
        </p>
      ) : usersQuery.isError ? (
        <p className="py-12 text-center text-sm text-destructive">
          用户列表加载失败
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-border bg-secondary/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">用户</th>
                <th className="px-4 py-3 font-medium">角色</th>
                <th className="px-4 py-3 font-medium">状态</th>
                <th className="px-4 py-3 font-medium">最后登录</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {usersQuery.data.users.map((user) => {
                const isSelf = user.id === currentUser?.id
                const disabled = busyUserId === user.id
                return (
                  <tr key={user.id} className="hover:bg-secondary/20">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-3">
                        <span className="flex size-9 items-center justify-center rounded-full bg-secondary text-primary">
                          {user.role === "admin" ? (
                            <ShieldCheck className="size-4" />
                          ) : (
                            <UserRound className="size-4" />
                          )}
                        </span>
                        <div>
                          <p className="font-medium">
                            {user.displayName}{isSelf ? "（我）" : ""}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {user.username}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        className={smallSelectClass}
                        value={user.role}
                        disabled={disabled || isSelf}
                        onChange={(event) =>
                          void patchUser(user, {
                            role: event.target.value as UserRole,
                          })
                        }
                      >
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <select
                        className={smallSelectClass}
                        value={user.status}
                        disabled={disabled || isSelf}
                        onChange={(event) =>
                          void patchUser(user, {
                            status: event.target.value as UserStatus,
                          })
                        }
                      >
                        <option value="active">已启用</option>
                        <option value="disabled">已禁用</option>
                      </select>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">
                      {user.lastLoginAt
                        ? new Date(user.lastLoginAt).toLocaleString("zh-CN")
                        : "尚未登录"}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <AppButton
                        size="sm"
                        variant="ghost"
                        disabled={disabled || isSelf}
                        onClick={() => void resetPassword(user)}
                      >
                        <KeyRound />重置密码
                      </AppButton>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {usersQuery.data.users.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">
              没有符合条件的用户
            </p>
          )}
        </div>
      )}
    </div>
  )
}

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
const smallSelectClass =
  "h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block space-y-2 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  )
}
