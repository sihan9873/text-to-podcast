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
import {
  Plus,
  FolderKanban,
  FileText,
  LayoutDashboard,
  UserRound,
  Users,
} from "lucide-react"

import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { AppNavbar } from "@/components/layout/AppNavbar"
import {
  AppSidebar,
  type AppSidebarSection,
} from "@/components/layout/AppSidebar"

import PodcastWorkflow from "@/app/PodcastWorkflow"
import LoginPage from "@/app/Login"
import RegisterPage from "@/app/Register"
import ProfilePage from "@/app/Profile"
import UsersPage from "@/app/Users"

import { generationRequest, listGenerationProjects, type GenerationProjectSummary } from "@/api/generationBackend"
import { useAuth } from "@/features/auth/AuthProvider"

// ============================================================
// App Layout
// ============================================================

function AppLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  // 项目列表：唯一数据源来自 API（TanStack Query 缓存）
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listGenerationProjects(),
  })

  const handleCreateProject = React.useCallback(async () => {
    const project = await generationRequest<GenerationProjectSummary>("/projects", "POST", { title: "未命名项目" })
    // 让列表重新请求（或直接用返回值做乐观更新）
    await queryClient.invalidateQueries({ queryKey: ["projects"] })
    navigate(`/projects/${project.project_id}`)
    setMobileOpen(false)
    return project
  }, [navigate, queryClient])

  const sidebarSections = React.useMemo(
    () => {
      const sections: AppSidebarSection[] = [
        {
          title: "工作区",
          items: [
            {
              label: "全部项目",
              href: "/projects",
              icon: LayoutDashboard,
              badge: projects.length || undefined,
            },
          ],
        },
        {
          title: "最近项目",
          items: projects.slice(0, 8).map((p) => ({
          label: p.title,
          href: `/projects/${p.project_id}`,
          icon: FolderKanban,

        })),
        },
      ]
      if (user?.role === "admin") {
        sections.push({
          title: "系统管理",
          items: [{ label: "用户管理", href: "/admin/users", icon: Users }],
        })
      }
      sections.push({
        title: "账户",
        items: [{ label: "个人资料", href: "/profile", icon: UserRound }],
      })
      return sections
    },
    [projects, user?.role]
  )

  return (
    <div className="flex min-h-screen bg-background">
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
      />

      <div className="flex flex-1 flex-col">
        <AppNavbar
          title="TextCast"
          onMenuClick={() => setMobileOpen(true)}
          user={{ name: user?.displayName ?? user?.username ?? "用户" }}
          onUserClick={() => navigate("/profile")}
          actions={
            <AppButton size="sm" onClick={handleCreateProject}>
              <Plus />
              新建项目
            </AppButton>
          }
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

function RequireAuth() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) return <Loading text="正在验证登录状态..." />
  if (!user) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}` }}
      />
    )
  }
  return <Outlet />
}

function RequireAdmin() {
  const { user } = useAuth()
  if (user?.role !== "admin") return <Navigate to="/projects" replace />
  return <Outlet />
}

// ============================================================
// Route wrappers
// ============================================================

function ProjectsListRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: projects = [],
    isPending,
    isError,
  } = useQuery({
    queryKey: ["projects"],
    queryFn: () => listGenerationProjects(),
  })

  const handleCreateProject = React.useCallback(async () => {
    const project = await generationRequest<GenerationProjectSummary>("/projects", "POST", { title: "未命名项目" })
    await queryClient.invalidateQueries({ queryKey: ["projects"] })
    navigate(`/projects/${project.project_id}`)
  }, [navigate, queryClient])

  if (isPending) {
    return <Loading text="正在加载项目..." />
  }

  if (isError) {
    return <ErrorState message="项目加载失败，请稍后重试。" />
  }

  return (
    <ProjectsList
      projects={projects}
      onNavigate={navigate}
      onCreateProject={handleCreateProject}
    />
  )
}

function ProjectRoute() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const id = Number(projectId)
  if (!Number.isSafeInteger(id) || id <= 0) return <NotFound onNavigate={navigate} />
  return <PodcastWorkflow key={id} projectId={id} />
}
// ============================================================
// Projects list (dashboard)
// ============================================================

function ProjectsList({
  projects,
  onNavigate,
  onCreateProject,
}: {
  projects: GenerationProjectSummary[]
  onNavigate: (href: string) => void
  onCreateProject: () => void
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
        <AppButton onClick={onCreateProject}>
          <Plus />
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
          <AppButton className="mt-6" onClick={onCreateProject}>
            <Plus />
            新建项目
          </AppButton>
        </AppCard>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <AppCard
              key={project.project_id}
              interactive
              onClick={() => onNavigate(`/projects/${project.project_id}`)}
            >
              <AppCardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{project.title}</h3>
                      <p className="text-xs text-muted-foreground">
                        {project.latest_audio_version_id ? "已有音频" : project.confirmed_script_id ? "已确认脚本" : project.current_script_id ? "待确认脚本" : "等待生成脚本"}
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  更新于{" "}
                  {new Date(project.updated_at).toLocaleDateString("zh-CN")}
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
// Shared UI: Loading / Error / NotFound
// ============================================================

function Loading({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-24 text-sm text-muted-foreground">
      {text}
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

function NotFoundRoute() {
  const navigate = useNavigate()
  return <NotFound onNavigate={navigate} />
}

// ============================================================
// App
// ============================================================

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="register" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/projects" replace />} />
          <Route path="projects" element={<ProjectsListRoute />} />
          <Route path="projects/:projectId" element={<ProjectRoute />} />

          <Route path="profile" element={<ProfilePage />} />
          <Route element={<RequireAdmin />}>
            <Route path="admin/users" element={<UsersPage />} />
          </Route>
          <Route path="*" element={<NotFoundRoute />} />
        </Route>
      </Route>
    </Routes>
  )
}
