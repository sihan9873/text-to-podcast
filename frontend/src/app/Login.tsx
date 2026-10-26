import * as React from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { Headphones, LoaderCircle, LockKeyhole, UserRound } from "lucide-react"

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

interface LoginLocationState {
  from?: string
}

export default function LoginPage() {
  const { user, isLoading, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
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

  const destination =
    (location.state as LoginLocationState | null)?.from ?? "/projects"

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password)
      navigate(destination, { replace: true })
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "登录失败，请稍后重试")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,hsl(var(--primary)/0.18),transparent_45%)]" />
      <div className="relative w-full max-w-md">
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
            <AppCardTitle>登录系统</AppCardTitle>
            <AppCardDescription>
              使用管理员分配的账户进入文字转播客工作区
            </AppCardDescription>
          </AppCardHeader>
          <AppCardContent>
            <form className="space-y-5" onSubmit={handleSubmit}>
              <label className="block space-y-2 text-sm">
                <span className="font-medium">用户名</span>
                <span className="relative block">
                  <UserRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    autoComplete="username"
                    autoFocus
                    required
                    maxLength={32}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                    placeholder="请输入用户名"
                  />
                </span>
              </label>

              <label className="block space-y-2 text-sm">
                <span className="font-medium">密码</span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-ring/30"
                    placeholder="请输入密码"
                  />
                </span>
              </label>

              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}

              <AppButton className="w-full" type="submit" disabled={submitting}>
                {submitting && <LoaderCircle className="animate-spin" />}
                {submitting ? "正在登录" : "登录"}
              </AppButton>
            </form>

            {import.meta.env.VITE_ENABLE_MOCK === "true" && (
              <p className="mt-5 text-center text-xs text-muted-foreground">
                Mock 开发账号：admin / TextCast123!
              </p>
            )}
          </AppCardContent>
        </AppCard>
      </div>
    </main>
  )
}
