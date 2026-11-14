// src/App.tsx
import * as React from "react"
import {
  Routes,
  Route,
  Outlet,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom"
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  FileCheck2,
  FileText,
  FolderKanban,
  Headphones,
  Loader2,
  Mic2,
  Plus,
  RefreshCw,
  Search,
  type LucideIcon,
} from "lucide-react"
import RolesPage from '@/app/Role'

import { cn } from "@/lib/utils"

import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppSidebar } from "@/components/layout/AppSidebar"

import ProjectPage from "@/app/Project"
import ScriptPage from "@/app/Script"
import AudioPage from "@/app/Audio"
import AuthPage from "@/app/Auth"

import {
  ApiError,
  authApi,
  projectsApi,
  tasksApi,
  type ProjectListItem,
  type SessionResponse,
  type TaskStatus,
} from "@/api"

// ============================================================
// Session：全应用唯一会话数据源
// ============================================================

function useSession() {
  return useQuery<SessionResponse | null>({
    queryKey: ["session"],
    queryFn: async () => {
      try {
        return await authApi.me()
      } catch (e) {
        if (e instanceof ApiError && e.code === "UNAUTHENTICATED") return null
        throw e
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  })
}

// ============================================================
// 创建项目（带 pending 防重复）
// ============================================================

function useCreateProject() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState(false)

  const create = React.useCallback(async () => {
    if (pending) return
    setPending(true)
    try {
      const created = await projectsApi.create({ title: "未命名项目" })
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
      navigate(`/projects/${created.project_id}`)
    } finally {
      setPending(false)
    }
  }, [navigate, pending, queryClient])

  return { create, pending }
}

// ============================================================
// 登出
// ============================================================

function useLogout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return React.useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      /* 即使失败也清空本地状态 */
    } finally {
      queryClient.clear()
      navigate("/login", { replace: true })
    }
  }, [navigate, queryClient])
}

// ============================================================
// Auth guards
// ============================================================

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending, isError } = useSession()
  const location = useLocation()

  if (isPending) return <FullPageLoading />
  if (isError) {
    return (
      <FullPageError
        title="会话加载失败"
        message="请刷新页面后重试"
      />
    )
  }
  if (!data) {
    const redirect = encodeURIComponent(
      location.pathname + location.search,
    )
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  return <>{children}</>
}

function RequireGuest({ children }: { children: React.ReactNode }) {
  const { data, isPending } = useSession()
  if (isPending) return <FullPageLoading />
  if (data) {
    const params = new URLSearchParams(window.location.search)
    const redirect = params.get("redirect") || "/projects"
    // 防 open redirect：只接受站内相对路径
    const safe = redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/projects"
    return <Navigate to={safe} replace />
  }
  return <>{children}</>
}

// ============================================================
// App Layout
// ============================================================

// Build links only for pages that exist in the route hierarchy.
function breadcrumbsOf(pathname: string, projects: ProjectListItem[] = []) {
  if (pathname.startsWith("/roles")) return [{ label: "角色模板", href: "/roles" }]

  const crumbs = [{ label: "项目", href: "/projects" }]
  const segments = pathname.split("/").filter(Boolean)
  const projectId = segments[1]
  if (segments[0] !== "projects" || !projectId) return crumbs

  const projectHref = `/projects/${projectId}`
  const project = projects.find((item) => item.project_id === projectId)
  crumbs.push({ label: project?.title || "项目详情", href: projectHref })
  if (segments[2] === "scripts" && segments[3]) {
    crumbs.push({ label: "脚本", href: `${projectHref}/scripts/${segments[3]}` })
  }
  if (segments.at(-1) === "audio") {
    crumbs.push({ label: "音频", href: pathname })
  }
  return crumbs
}

function AppLayout() {
  React.useLayoutEffect(() => {
    document.documentElement.classList.add('app-shell-active')
    return () => document.documentElement.classList.remove('app-shell-active')
  }, [])
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { data: session } = useSession()
  const logout = useLogout()
  const { create: createProject, pending: creating } = useCreateProject()

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)
  const [unreadProjects, setUnreadProjects] = React.useState<Set<string>>(() => new Set())
  const previousTaskStatuses = React.useRef(new Map<string, TaskStatus>())

  const { data: projectList, isPending: taskProjectsLoading, isError: taskProjectsError } = useQuery({
    queryKey: ["projects", { page: 1, page_size: 50 }],
    queryFn: () => projectsApi.list({ page: 1, page_size: 50 }),
    retry: false,
  })

  const projectTasks = useQueries({
    queries: (projectList?.items ?? []).map((project) => ({
      queryKey: ["sidebar-tasks", project.project_id],
      queryFn: () => tasksApi.listByProject(project.project_id, { page: 1, page_size: 100 }),
      staleTime: 3_000,
      refetchInterval: 5_000,
      retry: false,
    })),
  })

  React.useEffect(() => {
    const completedProjects = new Set<string>()
    for (const result of projectTasks) {
      if (!result.isSuccess) continue
      for (const task of result.data.items) {
        const previous = previousTaskStatuses.current.get(task.task_id)
        if ((previous === "queued" || previous === "running") && task.status === "succeeded") {
          completedProjects.add(task.project_id)
        }
        previousTaskStatuses.current.set(task.task_id, task.status)
      }
    }
    if (completedProjects.size) {
      setUnreadProjects(previous => new Set([...previous, ...completedProjects]))
    }
  }, [projectTasks])

  const sidebarSections = [
      {
        title: '配置',
        items: [{ label: '角色模板', href: '/roles', icon: Mic2 }],
      },
      {
        title: "项目",
        showCreateProject: true,
        href: "/projects",
        items: (projectList?.items ?? []).map((p) => ({
          label: p.title,
          href: `/projects/${p.project_id}`,
          icon: FolderKanban,
          badge: unreadProjects.has(p.project_id) ? "●" : undefined,
          badgeLabel: "任务已完成，点击查看",
        })),
      },
    ]

  const displayName =
    session?.user.display_name ?? session?.user.username ?? "未登录"

  return (
    // 外壳锁定为视口高度：文档本身不再滚动，只有 <main> 内部滚动，
    // 侧边栏和顶栏因此不会在滚到底/橡皮筋回弹时被带着上移
    <div className="fixed inset-0 flex h-dvh overflow-hidden bg-background">
      <AppSidebar
        sections={sidebarSections}
        activePath={pathname}
        onNavigate={(href) => {
          const projectId = /^\/projects\/([^/]+)$/.exec(href)?.[1]
          if (projectId) {
            setUnreadProjects(previous => {
              if (!previous.has(projectId)) return previous
              const next = new Set(previous)
              next.delete(projectId)
              return next
            })
          }
          navigate(href)
          setMobileOpen(false)
        }}
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        brand="TextCast"
        onCreateProject={createProject}
        creatingProject={creating}
      />

      <div className="relative isolate grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        {/* 背景氛围光：纯装饰，位于内容之下 */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-48 right-0 -z-10 size-[560px] rounded-full bg-primary/10 blur-3xl"
        />
        <AppNavbar
          activeTasks={projectTasks.flatMap((result, index) =>
            (result.data?.items ?? [])
              .filter(task => task.status === "queued" || task.status === "running")
              .map(task => ({ ...task, projectTitle: projectList?.items[index]?.title ?? "项目" })),
          )}
          tasksLoading={taskProjectsLoading || projectTasks.some(result => result.isPending)}
          tasksError={taskProjectsError || projectTasks.some(result => result.isError)}
          breadcrumbs={breadcrumbsOf(pathname, projectList?.items)}
          onMenuClick={() => setMobileOpen(true)}
          user={{ name: displayName }}
          // 简单下拉：先直接给"退出登录"入口
          onUserClick={logout}
        />

        <main className="min-h-0 min-w-0 overflow-y-auto overscroll-contain p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

// ============================================================
// Route wrappers
// ============================================================

function ProjectsListRoute() {
  const navigate = useNavigate()
  const { create: createProject, pending: creating } = useCreateProject()

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["projects", { page: 1, page_size: 50 }],
    queryFn: () => projectsApi.list({ page: 1, page_size: 50 }),
  })

  if (isPending) return <ProjectsSkeleton />
  if (isError) {
    return (
      <ErrorState
        message="项目加载失败，请稍后重试。"
        onRetry={() => void refetch()}
      />
    )
  }

  return (
    <ProjectsList
      projects={data?.items ?? []}
      onNavigate={navigate}
      onCreateProject={createProject}
      creating={creating}
    />
  )
}

function ProjectRoute() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  if (!projectId) return <NotFound onNavigate={navigate} />
  return <ProjectPage projectId={projectId} onNavigate={navigate} />
}

function ScriptRoute() {
  const { projectId, scriptId } = useParams()
  const navigate = useNavigate()
  if (!projectId || !scriptId) return <NotFound onNavigate={navigate} />
  return (
    <ScriptPage projectId={projectId} scriptId={scriptId} onNavigate={navigate} />
  )
}

function AudioRoute() {
  const { projectId, scriptId } = useParams()
  const navigate = useNavigate()
  if (!projectId || !scriptId) return <NotFound onNavigate={navigate} />
  return (
    <AudioPage projectId={projectId} scriptId={scriptId} onNavigate={navigate} />
  )
}

// ============================================================
// Projects list
// ============================================================

/** 相对时间："刚刚 / 3 小时前 / 昨天"，超过 30 天显示日期 */
function formatRelative(iso: string) {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ""
  const diff = (t - Date.now()) / 1000
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" })
  if (abs < 60 || diff > 0) return "刚刚"
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute")
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour")
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day")
  return new Date(t).toLocaleDateString("zh-CN")
}

function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </div>
  )
}

function NewProjectButton({
  onClick,
  creating,
  className,
}: {
  onClick: () => Promise<void>
  creating: boolean
  className?: string
}) {
  return (
    <AppButton onClick={onClick} disabled={creating} className={className}>
      {creating ? <Loader2 className="animate-spin" /> : <Plus />}
      新建项目
    </AppButton>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: number
  icon: LucideIcon
}) {
  return (
    <AppCard>
      <AppCardContent className="flex items-center gap-3 p-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="size-4" />
        </span>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold leading-tight tabular-nums">
            {value}
          </p>
        </div>
      </AppCardContent>
    </AppCard>
  )
}

const PROGRESS_STEPS = ["原文", "脚本", "音频"] as const

/** 原文 → 脚本 → 音频 三步进度，已完成的步骤点亮 */
function ProjectProgress({ project }: { project: ProjectListItem }) {
  const done = [
    Boolean(project.source_submitted),
    Boolean(project.confirmed_script_id),
    Boolean(project.latest_audio_version_id),
  ]
  return (
    <ol className="flex flex-wrap items-center gap-2" aria-label="项目进度">
      {PROGRESS_STEPS.map((label, i) => (
        <li
          key={label}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
            done[i]
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border text-muted-foreground",
          )}
        >
          {done[i] ? (
            <Check className="size-3" />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/40" />
          )}
          {label}
        </li>
      ))}
    </ol>
  )
}

function ProjectCard({
  project,
  onOpen,
}: {
  project: ProjectListItem
  onOpen: (href: string) => void
}) {
  const href = `/projects/${project.project_id}`
  return (
    <AppCard
      interactive
      role="link"
      tabIndex={0}
      onClick={() => onOpen(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen(href)
        }
      }}
      className="group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AppCardContent className="p-5">
        <div className="flex items-start gap-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary ring-1 ring-primary/20">
            <FileText className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-semibold leading-tight">
              {project.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              更新于{" "}
              <time
                dateTime={project.updated_at}
                title={new Date(project.updated_at).toLocaleString("zh-CN")}
              >
                {formatRelative(project.updated_at)}
              </time>
            </p>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-transparent transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
        <div className="mt-4 border-t border-border pt-4">
          <ProjectProgress project={project} />
        </div>
      </AppCardContent>
    </AppCard>
  )
}

function EmptyProjects({
  onCreate,
  creating,
}: {
  onCreate: () => Promise<void>
  creating: boolean
}) {
  return (
    <AppCard variant="accent" className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
      />
      <div className="relative flex flex-col items-center px-6 py-16 text-center">
        <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary ring-1 ring-primary/30">
          <FolderKanban className="size-7" />
        </span>
        <h2 className="mt-6 text-lg font-semibold tracking-tight">
          创建你的第一个项目
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          提交原文，生成并确认脚本，再合成为音频。
        </p>
        <NewProjectButton
          onClick={onCreate}
          creating={creating}
          className="mt-8"
        />
      </div>
    </AppCard>
  )
}

function ProjectsList({
  projects,
  onNavigate,
  onCreateProject,
  creating,
}: {
  projects: ProjectListItem[]
  onNavigate: (href: string) => void
  onCreateProject: () => Promise<void>
  creating: boolean
}) {
  const [query, setQuery] = React.useState("")

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? projects.filter((p) => p.title.toLowerCase().includes(q)) : projects
  }, [projects, query])

  const scriptCount = projects.filter((p) => p.confirmed_script_id).length
  const audioCount = projects.filter((p) => p.latest_audio_version_id).length

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="项目"
        description="管理你的播客脚本项目"
        actions={
          <NewProjectButton onClick={onCreateProject} creating={creating} />
        }
      />

      {projects.length === 0 ? (
        <EmptyProjects onCreate={onCreateProject} creating={creating} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="全部项目" value={projects.length} icon={FolderKanban} />
            <StatTile label="已确认脚本" value={scriptCount} icon={FileCheck2} />
            <StatTile label="已生成音频" value={audioCount} icon={Headphones} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              {query.trim() ? "搜索结果" : "全部项目"}
              <span className="ml-2 tabular-nums text-foreground">
                {filtered.length}
              </span>
            </h2>
            <label className="relative block w-full sm:max-w-xs">
              <span className="sr-only">搜索项目</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索项目…"
                className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm transition-colors placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
            </label>
          </div>

          {filtered.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              没有匹配“{query.trim()}”的项目
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filtered.map((p) => (
                <ProjectCard key={p.project_id} project={p} onOpen={onNavigate} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** 列表加载占位：和真实布局同形，避免加载完成时跳动 */
function ProjectsSkeleton() {
  return (
    <div
      role="status"
      aria-label="正在加载项目"
      className="mx-auto max-w-5xl space-y-6"
    >
      <div className="space-y-2">
        <div className="h-7 w-24 animate-pulse rounded-md bg-secondary" />
        <div className="h-4 w-48 animate-pulse rounded bg-secondary/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-[74px] animate-pulse rounded-xl border border-border bg-card"
          />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-[148px] animate-pulse rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  )
}

// ============================================================
// Shared UI
// ============================================================

function FullPageLoading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
      <span className="flex size-12 animate-pulse items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground shadow-[0_0_30px_-4px_hsl(var(--primary))]">
        T
      </span>
      <p className="text-xs tracking-[0.25em] text-muted-foreground">TEXTCAST</p>
    </div>
  )
}

function FullPageError({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <AppCard className="w-full max-w-sm">
        <AppCardContent className="flex flex-col items-center p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
            <AlertTriangle className="size-5" />
          </span>
          <p className="mt-5 text-base font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
          <AppButton
            size="sm"
            variant="outline"
            className="mt-6"
            onClick={() => window.location.reload()}
          >
            <RefreshCw />
            刷新页面
          </AppButton>
        </AppCardContent>
      </AppCard>
    </div>
  )
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="mx-auto max-w-sm py-16">
      <AppCard>
        <AppCardContent className="flex flex-col items-center p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
            <AlertTriangle className="size-5" />
          </span>
          <p className="mt-5 text-sm text-muted-foreground">{message}</p>
          {onRetry && (
            <AppButton
              size="sm"
              variant="outline"
              className="mt-6"
              onClick={onRetry}
            >
              <RefreshCw />
              重试
            </AppButton>
          )}
        </AppCardContent>
      </AppCard>
    </div>
  )
}

function NotFound({ onNavigate }: { onNavigate: (href: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="bg-gradient-to-b from-primary to-primary/10 bg-clip-text text-8xl font-bold tracking-tighter text-transparent">
        404
      </h1>
      <p className="mt-4 text-lg font-semibold">页面不存在</p>
      <p className="mt-1 text-sm text-muted-foreground">
        链接可能已失效，或项目已被删除。
      </p>
      <AppButton className="mt-8" onClick={() => onNavigate("/projects")}>
        返回项目列表
      </AppButton>
    </div>
  )
}

// ============================================================
// App
// ============================================================

export default function App() {
  return (
    <Routes>
      {/* 游客路由 */}
      <Route
        path="login"
        element={
          <RequireGuest>
            <AuthPage />
          </RequireGuest>
        }
      />
      <Route
        path="register"
        element={
          <RequireGuest>
            <AuthPage />
          </RequireGuest>
        }
      />

      {/* 受保护区域 */}
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="projects" element={<ProjectsListRoute />} />
        <Route path="roles" element={<RolesPage />} />
        <Route path="projects/:projectId" element={<ProjectRoute />} />
        <Route
          path="projects/:projectId/scripts/:scriptId"
          element={<ScriptRoute />}
        />
        <Route
          path="projects/:projectId/scripts/:scriptId/audio"
          element={<AudioRoute />}
        />
      </Route>

      {/* 兜底：不在受保护区也不在游客区的路径回首页 */}
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  )
}
