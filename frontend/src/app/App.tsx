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
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, FolderKanban, FileText, Loader2, Mic2 } from "lucide-react"
import RolesPage from '@/app/Role'

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
  type ProjectListItem,
  type SessionResponse,
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

// 顶栏显示"当前页面名"，品牌名只留在侧边栏，避免重复
function pageTitleOf(pathname: string) {
  if (pathname.startsWith("/roles")) return "角色模板"
  if (pathname.endsWith("/audio")) return "音频"
  if (pathname.includes("/scripts/")) return "脚本"
  if (pathname.startsWith("/projects/")) return "项目详情"
  return "项目"
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

  const { data: projectList } = useQuery({
    queryKey: ["projects", { page: 1, page_size: 50 }],
    queryFn: () => projectsApi.list({ page: 1, page_size: 50 }),
    retry: false,
  })

  const sidebarSections = React.useMemo(
    () => [
      {
        title: '配置',
        items: [{ label: '角色模板', href: '/roles', icon: Mic2 }],
      },
      {
        title: "项目",
        showCreateProject: true,
        items: (projectList?.items ?? []).map((p) => ({
          label: p.title,
          href: `/projects/${p.project_id}`,
          icon: FolderKanban,
          badge: p.confirmed_script_id ? "●" : undefined,
        })),
      },
    ],
    [projectList],
  )

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

      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
        <AppNavbar
          title={pageTitleOf(pathname)}
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

  const { data, isPending, isError } = useQuery({
    queryKey: ["projects", { page: 1, page_size: 50 }],
    queryFn: () => projectsApi.list({ page: 1, page_size: 50 }),
  })

  if (isPending) return <Loading text="正在加载项目..." />
  if (isError) return <ErrorState message="项目加载失败，请稍后重试。" />

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
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">项目</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            管理你的播客脚本项目
          </p>
        </div>
        <AppButton onClick={onCreateProject} disabled={creating}>
          {creating ? (
            <Loader2 className="mr-1 size-3 animate-spin" />
          ) : (
            <Plus />
          )}
          新建项目
        </AppButton>
      </div>

      {projects.length === 0 ? (
        <AppCard className="flex flex-col items-center justify-center py-16 text-center">
          <FolderKanban className="size-12 text-muted-foreground/50" />
          <h2 className="mt-4 text-lg font-semibold">还没有项目</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            创建你的第一个项目，开始生成播客脚本
          </p>
          <AppButton
            className="mt-6"
            onClick={onCreateProject}
            disabled={creating}
          >
            <Plus />
            新建项目
          </AppButton>
        </AppCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <AppCard
              key={p.project_id}
              interactive
              onClick={() => onNavigate(`/projects/${p.project_id}`)}
            >
              <AppCardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-semibold">{p.title}</h3>
                    <p className="text-xs text-muted-foreground">
                      {p.source_submitted ? "原文已提交" : "待提交原文"}
                      {p.confirmed_script_id ? " · 已确认脚本" : ""}
                      {p.latest_audio_version_id ? " · 有音频" : ""}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  更新于{" "}
                  {new Date(p.updated_at).toLocaleDateString("zh-CN")}
                </p>
              </AppCardContent>
            </AppCard>
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Shared UI
// ============================================================

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {text}
    </div>
  )
}

function FullPageLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function FullPageError({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 text-center">
      <p className="text-sm font-semibold text-destructive">{title}</p>
      <p className="text-xs text-muted-foreground">{message}</p>
      <AppButton
        size="sm"
        variant="outline"
        className="mt-4"
        onClick={() => window.location.reload()}
      >
        刷新页面
      </AppButton>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="text-sm text-destructive">{message}</p>
    </div>
  )
}

function NotFound({ onNavigate }: { onNavigate: (href: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-sm text-muted-foreground">页面不存在</p>
      <AppButton className="mt-6" onClick={() => onNavigate("/projects")}>
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
