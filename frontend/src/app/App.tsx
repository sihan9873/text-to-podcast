// src/App.tsx
import * as React from "react"
import {
  Routes,
  Route,
  Outlet,
  useNavigate,
  useLocation,
  useParams,
} from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, FolderKanban, FileText } from "lucide-react"

import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { AppNavbar } from "@/components/layout/AppNavbar"
import { AppSidebar } from "@/components/layout/AppSidebar"

import ProjectPage from "@/app/Project"
import ScriptPage from "@/app/Script"
import AudioPage from "@/app/Audio"

import { getProjects, getProjectById, createProject } from "@/features/projects/api"
import type { Project } from "@/types/project"

// ============================================================
// App Layout
// ============================================================

function AppLayout() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const queryClient = useQueryClient()

  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState(false)

  // 项目列表：唯一数据源来自 API（TanStack Query 缓存）
  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => getProjects(),
  })

  const handleCreateProject = React.useCallback(async () => {
    const project = await createProject({ name: "未命名项目" })
    // 让列表重新请求（或直接用返回值做乐观更新）
    await queryClient.invalidateQueries({ queryKey: ["projects"] })
    // 预填详情缓存，避免跳转后二次请求闪烁
    queryClient.setQueryData(["project", project.id], project)
    navigate(`/projects/${project.id}`)
    setMobileOpen(false)
    return project
  }, [navigate, queryClient])

  const sidebarSections = React.useMemo(
    () => [
      {
        title: "项目",
        items: projects.map((p) => ({
          label: p.name,
          href: `/projects/${p.id}`,
          icon: FolderKanban,
          badge: p.scriptVersions.length || undefined,
        })),
      },
    ],
    [projects]
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
          user={{ name: "张三" }}
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
    queryFn: () => getProjects(),
  })

  const handleCreateProject = React.useCallback(async () => {
    const project = await createProject({ name: "未命名项目" })
    await queryClient.invalidateQueries({ queryKey: ["projects"] })
    queryClient.setQueryData(["project", project.id], project)
    navigate(`/projects/${project.id}`)
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

  const {
    data: project,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectById(projectId!),
    enabled: !!projectId,
  })

  if (!projectId) return <NotFound onNavigate={navigate} />
  if (isPending) return <Loading text="正在加载项目..." />
  if (isError) {
    // 404 单独处理
    if ((error as { status?: number })?.status === 404) {
      return <NotFound onNavigate={navigate} />
    }
    return <ErrorState message="项目加载失败，请稍后重试。" />
  }
  if (!project) return <NotFound onNavigate={navigate} />

  return (
    <ProjectPage key={project.id} project={project} onNavigate={navigate} />
  )
}

function ScriptRoute() {
  const { projectId, versionId } = useParams()
  const navigate = useNavigate()

  // project 详情用于面包屑 / 标题；脚本本身由 ScriptPage 内部按 versionId 请求
  const {
    data: project,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectById(projectId!),
    enabled: !!projectId && !!versionId,
  })

  if (!projectId || !versionId) {
    return <NotFound onNavigate={navigate} />
  }
  if (isPending) return <Loading text="正在加载脚本..." />
  if (isError || !project) return <NotFound onNavigate={navigate} />

  return (
    <ScriptPage
      project={project}
      versionId={versionId}
      onNavigate={navigate}
    />
  )
}

function AudioRoute() {
  const { projectId, scriptVersionId } = useParams()
  const navigate = useNavigate()

  const {
    data: project,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectById(projectId!),
    enabled: !!projectId && !!scriptVersionId,
  })

  if (!projectId || !scriptVersionId) {
    return <NotFound onNavigate={navigate} />
  }
  if (isPending) return <Loading text="正在加载音频..." />
  if (isError || !project) return <NotFound onNavigate={navigate} />

  return (
    <AudioPage
      project={project}
      scriptVersionId={scriptVersionId}
      onNavigate={navigate}
    />
  )
}

// ============================================================
// Projects list (dashboard)
// ============================================================

function ProjectsList({
  projects,
  onNavigate,
  onCreateProject,
}: {
  projects: Project[]
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
              key={project.id}
              interactive
              onClick={() => onNavigate(`/projects/${project.id}`)}
            >
              <AppCardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FileText className="size-5" />
                    </span>
                    <div>
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-xs text-muted-foreground">
                        {project.scriptVersions.length} 个版本
                      </p>
                    </div>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  更新于{" "}
                  {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
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

// ============================================================
// App
// ============================================================

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<ProjectsListRoute />} />
        <Route path="projects" element={<ProjectsListRoute />} />
        <Route path="projects/:projectId" element={<ProjectRoute />} />
        <Route
          path="projects/:projectId/scripts/:versionId"
          element={<ScriptRoute />}
        />
        <Route
          path="projects/:projectId/scripts/:scriptVersionId/audio"
          element={<AudioRoute />}
        />
      </Route>
    </Routes>
  )
}
