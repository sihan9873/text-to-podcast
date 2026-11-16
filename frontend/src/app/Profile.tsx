import * as React from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { KeyRound, LogOut, Save, UserRound } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { ApiError } from "@/api/client"
import { authApi } from "@/api/auth"
import type { SessionResponse } from "@/api/types"
import { AppButton } from "@/components/common/AppButton"
import {
  AppCard,
  AppCardContent,
  AppCardDescription,
  AppCardHeader,
  AppCardTitle,
} from "@/components/common/AppCard"

function validateDisplayName(value: string): string | null {
  const name = value.trim()
  if (!name) return "昵称不能为空"
  if (name.length > 80) return "昵称最多 80 个字符"
  return null
}

function validatePassword(value: string): string | null {
  if (value.length < 8 || value.length > 128) return "密码长度需为 8–128 个字符"
  if (!value.trim()) return "密码不能全部为空白字符"
  return null
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString("zh-CN", { hour12: false })
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: session, isPending } = useQuery<SessionResponse | null>({
    queryKey: ["session"],
    queryFn: () => authApi.me(),
    retry: false,
  })

  const [displayName, setDisplayName] = React.useState("")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [savingProfile, setSavingProfile] = React.useState(false)
  const [savingPassword, setSavingPassword] = React.useState(false)

  React.useEffect(() => {
    if (session?.user) {
      setDisplayName(session.user.display_name ?? session.user.username)
    }
  }, [session])

  if (isPending) return <p className="text-sm text-muted-foreground">正在加载个人资料…</p>
  if (!session?.user) return null

  const user = session.user
  const roleLabel = user.role === "admin" ? "系统管理员" : "普通用户"
  const statusLabel = user.status === "active" ? "启用" : "已禁用"

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setError(null)
    const validationError = validateDisplayName(displayName)
    if (validationError) return setError(validationError)
    setSavingProfile(true)
    try {
      const updated = await authApi.updateMyProfile(displayName.trim())
      queryClient.setQueryData<SessionResponse | null>(["session"], (current) =>
        current ? { ...current, user: updated } : current
      )
      setFeedback("个人资料已保存")
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败")
    } finally {
      setSavingProfile(false)
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    setError(null)
    const validationError = validatePassword(newPassword)
    if (validationError) return setError(validationError)
    if (newPassword !== confirmPassword) return setError("两次输入的新密码不一致")
    if (currentPassword === newPassword) return setError("新密码不能与当前密码相同")
    setSavingPassword(true)
    try {
      const nextSession = await authApi.changePassword(currentPassword, newPassword)
      queryClient.setQueryData(["session"], nextSession)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setFeedback("密码已修改，其他登录会话已失效")
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "密码修改失败")
    } finally {
      setSavingPassword(false)
    }
  }

  async function logout() {
    try {
      await authApi.logout()
    } finally {
      queryClient.clear()
      navigate("/login", { replace: true })
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个人中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          查看账户信息、修改昵称和登录密码
        </p>
      </div>

      {(feedback || error) && (
        <p
          role="status"
          className={error ? "text-sm text-destructive" : "text-sm text-primary"}
        >
          {error ?? feedback}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <AppCard>
          <AppCardHeader>
            <AppCardTitle className="flex items-center gap-2">
              <UserRound className="size-5 text-primary" />
              基本信息
            </AppCardTitle>
            <AppCardDescription>
              用户名和角色由系统维护，昵称可以自行修改。
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form className="space-y-4" onSubmit={saveProfile}>
              <Field label="用户名">
                <input className={inputClass} value={user.username} disabled />
              </Field>
              <Field label="昵称">
                <input
                  className={inputClass}
                  value={displayName}
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="角色">
                  <input className={inputClass} value={roleLabel} disabled />
                </Field>
                <Field label="状态">
                  <input className={inputClass} value={statusLabel} disabled />
                </Field>
              </div>
              <Field label="注册时间">
                <input className={inputClass} value={formatDate(user.created_at)} disabled />
              </Field>
              <Field label="最近登录">
                <input
                  className={inputClass}
                  value={formatDate(user.last_login_at)}
                  disabled
                />
              </Field>
              <AppButton type="submit" disabled={savingProfile}>
                <Save />
                {savingProfile ? "保存中…" : "保存资料"}
              </AppButton>
            </form>
          </AppCardContent>
        </AppCard>

        <AppCard>
          <AppCardHeader>
            <AppCardTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" />
              修改密码
            </AppCardTitle>
            <AppCardDescription>
              修改后会撤销其他会话，并保留当前设备的登录状态。
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form className="space-y-4" onSubmit={savePassword}>
              <Field label="当前密码">
                <input
                  type="password"
                  autoComplete="current-password"
                  className={inputClass}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  required
                />
              </Field>
              <Field label="新密码">
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </Field>
              <Field label="确认新密码">
                <input
                  type="password"
                  autoComplete="new-password"
                  className={inputClass}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                />
              </Field>
              <AppButton type="submit" disabled={savingPassword}>
                <KeyRound />
                {savingPassword ? "修改中…" : "修改密码"}
              </AppButton>
            </form>
          </AppCardContent>
        </AppCard>
      </div>

      <AppButton variant="outline" onClick={() => void logout()}>
        <LogOut />
        退出登录
      </AppButton>
    </div>
  )
}

const inputClass =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60"

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
