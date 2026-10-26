import * as React from "react"
import { KeyRound, LogOut, Save, UserRound } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { changePassword, updateMyProfile } from "@/api/auth"
import { ApiError } from "@/api/request"
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
} from "@/features/auth/validation"

export default function ProfilePage() {
  const { user, refreshUser, logout } = useAuth()
  const navigate = useNavigate()
  const [displayName, setDisplayName] = React.useState(user?.displayName ?? "")
  const [currentPassword, setCurrentPassword] = React.useState("")
  const [newPassword, setNewPassword] = React.useState("")
  const [feedback, setFeedback] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  if (!user) return null

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    const validationError = validateDisplayName(displayName)
    if (validationError) return setError(validationError)
    setError(null)
    try {
      await updateMyProfile(displayName.trim())
      await refreshUser()
      setFeedback("个人资料已保存")
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "保存失败")
    }
  }

  async function savePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFeedback(null)
    const validationError = validatePassword(newPassword)
    if (validationError) return setError(validationError)
    setError(null)
    try {
      await changePassword(currentPassword, newPassword)
      await refreshUser()
      setCurrentPassword("")
      setNewPassword("")
      setFeedback("密码已修改，其他登录会话已退出")
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "密码修改失败")
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">个人资料</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          管理显示名称、登录密码和当前会话
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
              用户名由管理员维护，显示名称可以自行修改。
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form className="space-y-4" onSubmit={saveProfile}>
              <Field label="用户名">
                <input className={inputClass} value={user.username} disabled />
              </Field>
              <Field label="显示名称">
                <input
                  className={inputClass}
                  value={displayName}
                  maxLength={80}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </Field>
              <Field label="角色">
                <input
                  className={inputClass}
                  value={user.role === "admin" ? "系统管理员" : "普通用户"}
                  disabled
                />
              </Field>
              <AppButton type="submit">
                <Save />保存资料
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
              <AppButton type="submit">
                <KeyRound />修改密码
              </AppButton>
            </form>
          </AppCardContent>
        </AppCard>
      </div>

      <AppButton
        variant="outline"
        onClick={async () => {
          await logout()
          navigate("/login", { replace: true })
        }}
      >
        <LogOut />退出登录
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
