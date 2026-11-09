import * as React from "react"
import { Link, Navigate, useNavigate } from "react-router-dom"
import {
  Headphones,
  LoaderCircle,
  LockKeyhole,
  UserRound,
} from "lucide-react"

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
  validateUsername,
} from "@/features/auth/validation"

export default function RegisterPage() {
  const { user, isLoading, register } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoaderCircle className="size-7 animate-spin text-primary" />
      </div>
    )
  }
  if (user) return <Navigate to="/projects" replace />

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError =
      validateUsername(username) ??
      validateDisplayName(displayName) ??
      validatePassword(password) ??
      (password !== confirmPassword ? "两次输入的密码不一致" : null)
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      await register(username.trim(), displayName.trim(), password)
      navigate("/projects", { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "注册失败，请稍后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_45%)]" />
      <div className="relative mx-auto w-full max-w-md">
        <div className="mb-7 flex items-center justify-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_28px_-5px_hsl(var(--primary))]">
            <Headphones className="size-6" />
          </span>
          <span className="text-2xl font-semibold tracking-tight">
            TextCast<span className="text-primary">.</span>
          </span>
        </div>

        <AppCard variant="elevated">
          <AppCardHeader>
            <AppCardTitle>注册普通用户</AppCardTitle>
            <AppCardDescription>
              创建账号后自动登录；管理员权限只能由已有管理员授予
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Field label="用户名">
                <InputIcon icon={<UserRound />}>
                  <input
                    autoComplete="username"
                    autoFocus
                    required
                    maxLength={32}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className={inputClass}
                    placeholder="3 至 32 位字母、数字或符号"
                  />
                </InputIcon>
              </Field>
              <Field label="显示名称">
                <InputIcon icon={<UserRound />}>
                  <input
                    autoComplete="name"
                    required
                    maxLength={80}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className={inputClass}
                    placeholder="用于页面展示"
                  />
                </InputIcon>
              </Field>
              <Field label="密码">
                <InputIcon icon={<LockKeyhole />}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className={inputClass}
                    placeholder="至少 8 个字符"
                  />
                </InputIcon>
              </Field>
              <Field label="确认密码">
                <InputIcon icon={<LockKeyhole />}>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    maxLength={128}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className={inputClass}
                    placeholder="再次输入密码"
                  />
                </InputIcon>
              </Field>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <AppButton className="w-full" type="submit" disabled={submitting}>
                {submitting && <LoaderCircle className="animate-spin" />}
                {submitting ? "正在注册" : "注册并登录"}
              </AppButton>
            </form>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              已有账号？{" "}
              <Link className="font-medium text-primary hover:underline" to="/login">
                返回登录
              </Link>
            </p>
          </AppCardContent>
        </AppCard>
      </div>
    </main>
  )
}

const inputClass =
  "h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"

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

function InputIcon({
  icon,
  children,
}: {
  icon: React.ReactElement<{ className?: string }>
  children: React.ReactNode
}) {
  return (
    <span className="relative block">
      {React.cloneElement(icon, {
        className:
          "pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground",
      })}
      {children}
    </span>
  )
}
