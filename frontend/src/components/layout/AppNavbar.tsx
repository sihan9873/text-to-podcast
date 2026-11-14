import * as React from "react"
import { Bell, ChevronRight, Menu, Search } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import type { TaskDetail } from "@/api"

export interface AppNavbarUser {
  name: string
  /** Optional avatar image URL; falls back to initials. */
  avatarUrl?: string
}

export interface AppNavbarProps extends React.HTMLAttributes<HTMLElement> {
  /** Brand / page title shown on the left. */
  title?: string
  breadcrumbs?: { label: string; href: string }[]
  /** Opens the mobile sidebar drawer. The menu button is hidden on lg+. */
  onMenuClick?: () => void
  /** Shows a pink dot on the bell when true. */
  hasNotifications?: boolean
  activeTasks?: (TaskDetail & { projectTitle: string })[]
  tasksLoading?: boolean
  tasksError?: boolean
  /** Called with the search text when the user presses Enter. */
  onSearch?: (query: string) => void
  user?: AppNavbarUser
  onUserClick?: () => void
  /** Extra actions rendered before the bell, e.g. a primary "New" button. */
  actions?: React.ReactNode
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

const AppNavbar = React.forwardRef<HTMLElement, AppNavbarProps>(
  (
    {
      className,
      title = "AIVoice",
      breadcrumbs,
      onMenuClick,
      hasNotifications = false,
      activeTasks = [],
      tasksLoading = false,
      tasksError = false,
      onSearch,
      user,
      onUserClick,
      actions,
      ...props
    },
    ref
  ) => {
    const [query, setQuery] = React.useState("")
    const [tasksOpen, setTasksOpen] = React.useState(false)
    const tasksReportId = React.useId()

    return (
      <header
        ref={ref}
        className={cn(
          "relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border",
          "bg-background/75 px-4 backdrop-blur-md md:px-6",
          className
        )}
        {...props}
      >
        <AppButton
          variant="ghost"
          size="icon"
          className="lg:hidden"
          aria-label="Open menu"
          onClick={onMenuClick}
        >
          <Menu />
        </AppButton>

        {breadcrumbs?.length ? (
          <nav aria-label="页面路径" className="min-w-0 flex-1 overflow-x-auto">
            <ol className="flex w-max items-center gap-2 py-1 text-sm">
              {breadcrumbs.map((crumb, index) => (
                <li key={crumb.href} className="flex items-center gap-2">
                  {index > 0 && <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground/60" />}
                  <Link
                    to={crumb.href}
                    aria-current={index === breadcrumbs.length - 1 ? "page" : undefined}
                    title={crumb.label}
                    className={cn(
                      "max-w-40 truncate rounded-sm transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:max-w-64",
                      index === breadcrumbs.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {crumb.label}
                  </Link>
                </li>
              ))}
            </ol>
          </nav>
        ) : <span className="text-base font-semibold tracking-tight">
          {title}
        </span>}

        {/* Search is shown only when the page provides a search handler. */}
        {onSearch && <form
          role="search"
          className="mx-auto hidden w-full max-w-md md:block"
          onSubmit={(e) => {
            e.preventDefault()
            onSearch?.(query.trim())
          }}
        >
          <label className="relative block">
            <span className="sr-only">Search</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className={cn(
                "h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm",
                "placeholder:text-muted-foreground transition-colors",
                "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              )}
            />
          </label>
        </form>}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {actions}

          <div
            className="relative"
            onMouseEnter={() => setTasksOpen(true)}
            onMouseLeave={() => setTasksOpen(false)}
            onFocus={() => setTasksOpen(true)}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setTasksOpen(false)
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setTasksOpen(false)
            }}
          >
          <AppButton
            variant="ghost"
            size="icon"
            className="relative"
            aria-label={`进行中的任务：${activeTasks.length}`}
            aria-describedby={tasksOpen ? tasksReportId : undefined}
          >
            <Bell />
            {(hasNotifications || activeTasks.length > 0) && (
              <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
            )}
          </AppButton>
          {tasksOpen && (
            <div className="absolute right-0 top-full z-50 w-[min(22rem,calc(100vw-6rem))] pt-2">
              <section id={tasksReportId} aria-label="进行中的任务汇报" className="overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold">进行中的任务</h2>
                  <span className="text-xs tabular-nums text-muted-foreground">{activeTasks.length} 项</span>
                </div>
                {tasksError && <p className="px-4 py-3 text-xs text-destructive">部分任务状态获取失败，正在等待刷新。</p>}
                {activeTasks.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                    {tasksLoading ? "正在获取任务状态…" : tasksError ? "暂时无法确认任务状态" : "暂无进行中的任务"}
                  </p>
                ) : (
                  <ul className="max-h-[min(24rem,60vh)] divide-y divide-border overflow-y-auto overscroll-contain">
                    {activeTasks.map(task => {
                      const progress = task.progress == null ? null : Math.round(Math.min(100, Math.max(0, task.progress)))
                      return (
                        <li key={task.task_id} className="space-y-2 px-4 py-3">
                          <p className="truncate text-sm font-medium" title={task.projectTitle}>{task.projectTitle}</p>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>{task.task_type === "script" ? "脚本生成" : "音频处理"} · {task.status === "queued" ? "排队中" : "运行中"}</span>
                            {progress !== null && <span className="tabular-nums">{progress}%</span>}
                          </div>
                          {progress !== null && <div role="progressbar" aria-label="任务进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} className="h-1 overflow-hidden rounded-full bg-secondary">
                            <div className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${progress}%` }} />
                          </div>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>
          )}
          </div>

          {user && (
            <button
              type="button"
              onClick={onUserClick}
              aria-label={`Account: ${user.name}`}
              className={cn(
                "ml-1 flex size-9 items-center justify-center overflow-hidden rounded-full",
                "border border-border bg-secondary text-xs font-semibold text-secondary-foreground",
                "transition-all hover:border-primary/60 hover:shadow-[0_0_14px_-4px_hsl(var(--primary))]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initials(user.name)
              )}
            </button>
          )}
        </div>
      </header>
    )
  }
)
AppNavbar.displayName = "AppNavbar"

export { AppNavbar }
