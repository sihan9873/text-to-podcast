// src/app/Auth.tsx
import * as React from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { safeRedirect } from '@/components/auth/session'
import { useQueryClient } from "@tanstack/react-query"
import { Loader2, AlertCircle, Mic } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import { authApi, ApiError } from "@/api"
import { SoundWaveBackdrop } from "@/components/effects/SoundWaveBackdrop"

type Mode = "login" | "register"

// ============================================================
// 字段校验（与文档一致）
// ============================================================

const USERNAME_RE = /^[A-Za-z0-9_]{3,64}$/
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const DISPLAY_NAME_MAX = 100

function validateUsername(v: string): string | null {
  if (!v) return "请输入用户名"
  if (!USERNAME_RE.test(v))
    return "用户名为 3–64 位字母、数字或下划线"
  return null
}

function validatePassword(v: string): string | null {
  if (!v) return "请输入密码"
  if (v.length < PASSWORD_MIN || v.length > PASSWORD_MAX)
    return `密码长度需为 ${PASSWORD_MIN}–${PASSWORD_MAX} 字符`
  return null
}

function validateDisplayName(v: string): string | null {
  if (!v) return null // 可选
  if (v.length > DISPLAY_NAME_MAX)
    return `昵称最多 ${DISPLAY_NAME_MAX} 字符`
  return null
}

// ============================================================
// 错误码 → 用户提示
// ============================================================

function messageForError(e: unknown): string {
  if (!(e instanceof ApiError)) return "网络异常，请稍后重试"
  switch (e.code) {
    case "INVALID_CREDENTIALS":
      return "用户名或密码错误"
    case "USERNAME_EXISTS":
      return "该用户名已被注册"
    case "INVALID_INPUT":
      return e.message || "输入不合法"
    case "UNAUTHENTICATED":
      return "登录已过期，请重新登录"
    case "CSRF_FAILED":
      return "安全校验失败，请刷新页面后重试"
    case "SERVICE_UNAVAILABLE":
      return "服务暂不可用，请稍后重试"
    default:
      if (e.status === 429) return "操作过于频繁，请稍后重试"
      return e.message || "请求失败"
  }
}

// ============================================================
// 登录/注册页
// ============================================================

export default function AuthPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()

  const initialMode: Mode = location.pathname !== '/login' || params.get("mode") === "register" ? "register" : "login"
  const redirect = safeRedirect(params.get("redirect"))

  const mode = initialMode
  const busy = React.useRef(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  // 表单字段
  const [username, setUsername] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [displayName, setDisplayName] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")

  const [touched, setTouched] = React.useState<Record<string, boolean>>({})
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string | null>>({})

  const switchMode = (next: Mode) => {
    setError(null)
    setNotice(null)
    setFieldErrors({})
    setTouched({})
    setConfirmPassword("")
    // 同步 URL，便于刷新保留模式
    navigate(`${next === 'register' ? '/register' : '/login'}?redirect=${encodeURIComponent(redirect)}`, { replace: true })
  }

  const runValidation = () => {
    const next: Record<string, string | null> = {
      username: validateUsername(username.trim()),
      password: validatePassword(password),
    }
    if (mode === "register") {
      next.displayName = validateDisplayName(displayName)
      if (password !== confirmPassword) {
        next.confirmPassword = "两次输入的密码不一致"
      }
    }
    setFieldErrors(next)
    setTouched(Object.fromEntries(Object.keys(next).map(key => [key, true])))
    return Object.values(next).every((v) => v === null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy.current) return
    setError(null)
    setNotice(null)
    if (!runValidation()) return

    busy.current = true
    setSubmitting(true)
    try {
      if (mode === "register") {
        await authApi.register({
          username: username.trim(),
          password,
          display_name: displayName.trim() || undefined,
        })
        // 注册不自动登录，切到登录模式
        switchMode("login")
        setPassword('')
        setNotice("注册成功，请登录")
        // 保留已填用户名
        setTouched({})
      } else {
        const session = await authApi.login({ username: username.trim(), password })
        // 登录成功，缓存会话 + 跳转
        await queryClient.cancelQueries()
        queryClient.clear()
        queryClient.setQueryData(["session"], session)
        navigate(redirect, { replace: true })
      }
    } catch (err) {
      setError(messageForError(err))
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }))

  const showFieldError = (field: string): string | null => {
    if (!touched[field] || fieldErrors[field] === undefined) return null
    return fieldErrors[field]
  }

  return (
    <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      <SoundWaveBackdrop />
      <div className="w-full max-w-md space-y-6">
        {/* Brand */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Mic className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">TextCast</h1>
          <p className="text-sm text-muted-foreground">
            文字转播客系统
          </p>
        </div>

        {/* Card */}
        <AppCard>
          <AppCardContent className="p-6">
            {/* Tab */}
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
              {(["login", "register"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={submitting}
                  onClick={() => switchMode(m)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    mode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "login" ? "登录" : "注册"}
                </button>
              ))}
            </div>

            {/* Notice / Error */}
            {notice && (
              <div role="status" className="mb-4 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-700 dark:text-green-400">
                {notice}
              </div>
            )}
            {error && (
              <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* 用户名 */}
              <Field
                label="用户名"
                hint={
                  mode === "register"
                    ? "3–64 位字母、数字或下划线"
                    : undefined
                }
                error={showFieldError("username")}
              >
                <input
                  type="text"
                  value={username}
                  autoComplete="username"
                  autoFocus
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => {
                    markTouched("username")
                    setFieldErrors((p) => ({ ...p, username: validateUsername(username) }))
                  }}
                  disabled={submitting}
                  className={inputClass(!!showFieldError("username"))}
                  placeholder="your_username"
                />
              </Field>

              {/* 昵称（仅注册） */}
              {mode === "register" && (
                <Field
                  label="昵称（可选）"
                  error={showFieldError("displayName")}
                >
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    onBlur={() => {
                      markTouched("displayName")
                      setFieldErrors((p) => ({
                        ...p,
                        displayName: validateDisplayName(displayName),
                      }))
                    }}
                    disabled={submitting}
                    className={inputClass(!!showFieldError("displayName"))}
                    placeholder="显示名称"
                    maxLength={DISPLAY_NAME_MAX}
                  />
                </Field>
              )}

              {/* 密码 */}
              <Field
                label="密码"
                hint={
                  mode === "register"
                    ? `8–128 字符`
                    : undefined
                }
                error={showFieldError("password")}
              >
                <input
                  type="password"
                  value={password}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => {
                    markTouched("password")
                    setFieldErrors((p) => ({ ...p, password: validatePassword(password) }))
                  }}
                  disabled={submitting}
                  className={inputClass(!!showFieldError("password"))}
                  placeholder="••••••••"
                />
              </Field>

              {/* 确认密码（仅注册） */}
              {mode === "register" && (
                <Field
                  label="确认密码"
                  error={showFieldError("confirmPassword")}
                >
                  <input
                    type="password"
                    value={confirmPassword}
                    autoComplete="new-password"
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    onBlur={() => {
                      markTouched("confirmPassword")
                      setFieldErrors((p) => ({
                        ...p,
                        confirmPassword:
                          password !== confirmPassword ? "两次输入的密码不一致" : null,
                      }))
                    }}
                    disabled={submitting}
                    className={inputClass(!!showFieldError("confirmPassword"))}
                    placeholder="••••••••"
                  />
                </Field>
              )}

              <AppButton
                type="submit"
                className="w-full"
                disabled={submitting}
              >
                {submitting && <Loader2 className="mr-1 size-4 animate-spin" />}
                {mode === "login" ? "登录" : "注册"}
              </AppButton>
            </form>

            {/* 底部切换提示 */}
            <p className="mt-4 text-center text-xs text-muted-foreground">
              {mode === "login" ? (
                <>
                  还没有账号？{" "}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => switchMode("register")}
                    className="font-medium text-primary hover:underline"
                  >
                    立即注册
                  </button>
                </>
              ) : (
                <>
                  已有账号？{" "}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => switchMode("login")}
                    className="font-medium text-primary hover:underline"
                  >
                    去登录
                  </button>
                </>
              )}
            </p>
          </AppCardContent>
        </AppCard>
      </div>
    </div>
  )
}

// ============================================================
// Field wrapper
// ============================================================

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string
  hint?: string
  error?: string | null
  children: React.ReactNode
}) {
  const inputId = React.useId()
  const input = React.isValidElement<React.InputHTMLAttributes<HTMLInputElement>>(children)
    ? React.cloneElement(children, { id: inputId, 'aria-invalid': !!error, 'aria-describedby': error ? `${inputId}-error` : undefined })
    : children
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={inputId} className="text-xs font-medium text-foreground">{label}</label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {input}
      {error && <p id={`${inputId}-error`} className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

function inputClass(hasError: boolean): string {
  return cn(
    "auth-input h-10 w-full rounded-lg border bg-background px-3 text-sm text-foreground",
    "placeholder:text-muted-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
    "disabled:cursor-not-allowed disabled:opacity-60",
    hasError
      ? "border-destructive/60 focus-visible:border-destructive"
      : "border-input focus-visible:border-primary/60",
  )
}
