import { GenerationEstimate, useGenerationConfirmation } from "@/components/common/GenerationConfirmation"
// src/Project.tsx
import * as React from "react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { FileText, Loader2, AlertCircle } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import {
  projectsApi,
  scriptsApi,
  audioApi,
  configApi,
  tasksApi,
  ApiError,
  newIdempotencyKey,
  //type ProjectDetail,
  type ScriptListItem,
  type AudioVersionListItem,
  type ActiveTaskSummary,
  type RoleProfileItem,
  //type TaskAccepted,
} from "@/api"

import { formatMs } from "./Audio"
import { SourceInputPanel } from "@/features/source-input/SourceInputPanel"
import { ScriptTaskFailure, isScriptTaskRunning } from "@/features/script-generation/ScriptTaskFailure"

// ============================================================
// Badges
// ============================================================

// ============================================================
// Audio status cell
// ============================================================

function AudioStatusCell({
  audioVersion,
  loading,
}: {
  audioVersion: AudioVersionListItem | undefined
  loading: boolean
}) {
  if (loading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (!audioVersion) {
    return <StatusBadge status="not_generated" showIcon={false} />
  }
  return <StatusBadge status={audioVersion.status} />
}

// ============================================================
// Helper: 拉取每个脚本版本的最新音频（A-03）
// ============================================================

function useLatestAudioByScript(projectId: string, scripts: ScriptListItem[]) {
  const [latestByScript, setLatestByScript] = React.useState<
    Record<string, AudioVersionListItem | undefined>
  >({})
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (scripts.length === 0) return
    let cancelled = false
    const fetchAll = async () => {
      setLoading(true)
      try {
        const entries = await Promise.all(
          scripts.map(async (s) => {
            try {
              const res = await audioApiList(projectId, s.script_id)
              return [s.script_id, res.items[0]] as const
            } catch {
              return [s.script_id, undefined] as const
            }
          }),
        )
        if (!cancelled) setLatestByScript(Object.fromEntries(entries))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void fetchAll()
    return () => {
      cancelled = true
    }
  }, [projectId, scripts])

  return { latestByScript, loading }
}

// 局部包装，避免顶部 import 过长；与 audioApi.listVersions 等价
async function audioApiList(projectId: string, scriptId: string) {
  const { audioApi } = await import("@/api")
  return audioApi.listVersions(projectId, {
    script_id: scriptId,
    page: 1,
    page_size: 1,
  })
}

// ============================================================
// Script generation task: 轮询 P-03 的 active_tasks
// ============================================================

/** 从 P-03 的 active_tasks 中挑选脚本任务 */
function pickScriptTask(
  tasks: ActiveTaskSummary[] | undefined,
): ActiveTaskSummary | undefined {
  return tasks?.find((t) => t.task_type === "script")
}

// ============================================================
// Generate dialog: 选择角色（C-06）
// ============================================================

interface GenerateDialogProps {
  sourceText: string
  projectId: string
  onClose: () => void
  onSubmitted: () => void
}

function GenerateDialog({ projectId, sourceText, onClose, onSubmitted }: GenerateDialogProps) {
  const submitBusy = React.useRef(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [generationMode, setGenerationMode] = React.useState<"prompt" | "verbatim" | "summary">(sourceText.length > 5000 ? "summary" : "prompt")
  const [modelId, setModelId] = React.useState("")
  const { data: modelsData } = useQuery({ queryKey: ["models"], queryFn: () => configApi.models({ page_size: 100 }) })
  const [targetMinutes, setTargetMinutes] = React.useState(10)
  const [style, setStyle] = React.useState("自然、清晰、连贯")

  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const {
    data: rolesData,
    isPending: rolesLoading,
    isError: rolesError,
  } = useQuery({
    queryKey: ["roles", { status: "enabled" }],
    queryFn: () => configApi.roles({ status: "enabled", page: 1, page_size: 100 }),
  })

  const roles: RoleProfileItem[] = rolesData?.items ?? []
  const canSubmit = selected.length >= 1 && selected.length <= 8 && (generationMode === "verbatim" || style.trim().length > 0) && !submitting

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 8) return prev
      return [...prev, id]
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit || submitBusy.current) return
    submitBusy.current = true
    setSubmitting(true)
    setError(null)
    try {
      // 角色在脚本中的 role_key：用 profile 名去掉空白/标点 + 索引
      const payloadRoles = selected.map((profileId, idx) => {
        const profile = roles.find((r) => r.profile_id === profileId)
        const base = (profile?.name ?? "role").replace(/[^A-Za-z0-9_]/g, "").slice(0, 40) || "role"
        return { profile_id: profileId, role_key: `${base}_${idx + 1}`.slice(0, 64) }
      })
      await scriptsApi.generate(
        projectId,
        { roles: payloadRoles, target_minutes: targetMinutes, style: style.trim() || "自然、清晰、连贯", generation_mode: generationMode, ...(modelId ? { model_id: modelId } : {}) },
        newIdempotencyKey(),
      )
      onSubmitted()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.code === "TASK_ALREADY_RUNNING") {
        // 已有任务在跑：直接关闭并提示
        setError("已有生成任务正在进行，请在列表中查看进度")
        onSubmitted() // 触发一次 P-03 拉取以恢复占位符
      } else if (e instanceof ApiError && e.code === "MODEL_NOT_CONFIGURED") {
        setError("请先配置项目 LLM 模型")
      } else if (e instanceof ApiError && e.code === "SOURCE_NOT_SUBMITTED") {
        setError("请先提交原文")
      } else {
        setError(e instanceof ApiError ? e.message : "提交失败")
      }
    } finally {
      submitBusy.current = false
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => { if (!submitBusy.current) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="确认生成脚本"
        className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">生成脚本</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          选择 1–8 个角色模板，生成后将创建新脚本版本。
        </p>

        <div className="mt-5 grid items-start gap-6 md:grid-cols-2">
          <section className="min-w-0" aria-label="选择角色">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">选择角色</h3>
              <span className="text-xs text-muted-foreground">已选 {selected.length} / 8</span>
            </div>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-border md:max-h-[50vh]">
          {rolesLoading ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />加载角色模板…
            </div>
          ) : rolesError ? (
            <div className="flex items-center justify-center py-10 text-xs text-destructive">
              <AlertCircle className="mr-1 size-4" />角色模板加载失败
            </div>
          ) : roles.length === 0 ? (
            <div className="flex items-center justify-center py-10 text-xs text-muted-foreground">
              还没有角色模板，请先在配置中创建。
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {roles.map((r) => {
                const checked = selected.includes(r.profile_id)
                const disabled = !checked && selected.length >= 8
                return (
                  <li key={r.profile_id}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-start gap-3 px-4 py-3",
                        disabled && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={disabled || submitting}
                        onChange={() => toggle(r.profile_id)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {r.tts_provider} / {r.tts_model} · {r.voice_id}
                          {r.style ? ` · ${r.style}` : ""} · x{r.speed}
                        </div>
                      </div>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
          </section>
          <section className="min-w-0" aria-label="生成信息">
            <h3 className="mb-3 text-sm font-semibold">生成信息</h3>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">脚本生成模式</span>
            <select aria-label="脚本生成模式" value={generationMode} disabled={submitting} onChange={e => setGenerationMode(e.target.value as typeof generationMode)} className="h-10 w-full rounded-lg border border-input bg-card px-3">
              <option value="prompt">提示词创作脚本</option>
              <option value="verbatim">保留原文生成脚本</option>
              <option value="summary">长文本概括脚本</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{generationMode === "prompt" ? "把已提交内容作为提示词，围绕主题创作台词（提示词最多5000字符）。" : generationMode === "verbatim" ? "逐字保留已提交原文，仅分句并分配给主持人；不调用模型，目标时长与风格不参与改写。" : "对已提交原文分段提炼、建立全局大纲，再概括为连贯脚本；支持最长10万字符。"}</p>
          {generationMode !== "verbatim" && <label className="block text-sm">
            <span className="mb-1 block font-medium">脚本模型</span>
            <select aria-label="脚本模型" value={modelId} disabled={submitting} onChange={e => setModelId(e.target.value)} className="h-10 w-full rounded-lg border border-input bg-card px-3">
              <option value="">使用当前服务默认模型</option>
              {modelsData?.items.map(model => <option key={model.model_id} value={model.model_id}>{model.name}</option>)}
            </select>
          </label>}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">目标节目时长</span>
            <select
              value={targetMinutes}
              disabled={submitting || generationMode === "verbatim"}
              onChange={(event) => setTargetMinutes(Number(event.target.value))}
              className="h-10 w-full rounded-lg border border-input bg-card px-3"
            >
              {[5, 10, 15, 20].map((value) => <option key={value} value={value}>{value} 分钟</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">主持风格</span>
            <input
              value={style}
              maxLength={200}
              disabled={submitting || generationMode === "verbatim"}
              onChange={(event) => setStyle(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-card px-3"
              placeholder="自然、清晰、连贯"
            />
          </label>
        </div>


            <GenerationEstimate text={sourceText} kind="script" />
          </section>
        </div>

        {error && (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <AppButton variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </AppButton>
          <AppButton onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1 size-3 animate-spin" />}
            确认生成
          </AppButton>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Project page
// ============================================================

export interface ProjectPageProps {
  projectId: string
  onNavigate: (href: string) => void
}

export default function ProjectPage({ projectId, onNavigate }: ProjectPageProps) {
  const queryClient = useQueryClient()

  const {
    data: project,
    isPending: projectLoading,
    isError: projectError,
  } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => projectsApi.detail(projectId),
  })

  const {
    data: scriptsData,
    isPending: scriptsLoading,
  } = useQuery({
    queryKey: ["scripts", projectId],
    queryFn: () => scriptsApi.list(projectId, { page: 1, page_size: 100 }),
  })

  const scripts = scriptsData?.items ?? []
  const confirmedScript = [...scripts]
    .filter((script) => script.status === "confirmed")
    .sort((a, b) => b.version - a.version)[0]
  const { data: audioSummary } = useQuery({
    queryKey: ["audio-versions", projectId, "summary"],
    queryFn: () => audioApi.listVersions(projectId, { page: 1, page_size: 1 }),
  })

  const { latestByScript, loading: audioLoading } = useLatestAudioByScript(
    projectId,
    scripts,
  )

  const [showGenerate, setShowGenerate] = React.useState(false)

  const activeScriptTask = pickScriptTask(project?.active_tasks)
  const { data: scriptTasks, isError: scriptTasksError } = useQuery({
    queryKey: ["script-tasks", projectId],
    queryFn: () => tasksApi.listByProject(projectId, { page: 1, page_size: 1, task_type: "script" }),
    refetchInterval: query => activeScriptTask || isScriptTaskRunning(query.state.data?.items[0]) ? 2000 : false,
  })
  const latestScriptTask = scriptTasks?.items[0]
  const isGenerating = !!activeScriptTask || isScriptTaskRunning(latestScriptTask)
  const generatingTask = activeScriptTask ?? (isScriptTaskRunning(latestScriptTask) && latestScriptTask ? {
    ...latestScriptTask, status_url: `/api/tasks/${latestScriptTask.task_id}`,
  } : undefined)

  // Poll the project only while work is active. Keep the terminal task separately,
  // since completed/failed tasks disappear from the project's active_tasks.
  React.useEffect(() => {
    if (!isGenerating) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    }, 2000)
    return () => clearInterval(timer)
  }, [isGenerating, projectId, queryClient])

  const settledTaskId = latestScriptTask && !isScriptTaskRunning(latestScriptTask) ? latestScriptTask.task_id : null
  React.useEffect(() => {
    if (!settledTaskId) return
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["scripts", projectId] })
  }, [settledTaskId, projectId, queryClient])

  const handleGenerateSubmitted = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    void queryClient.invalidateQueries({ queryKey: ["script-tasks", projectId] })
  }, [projectId, queryClient])

  // ---------- 渲染 ----------
  if (projectLoading || scriptsLoading) {
    return (
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (projectError || !project) {
    return (
      <div className="mx-auto max-w-5xl">
        <AppCard>
          <AppCardContent className="p-6 text-center text-sm text-destructive">
            项目不存在或无权访问
          </AppCardContent>
        </AppCard>
      </div>
    )
  }

  const hasSource = project.source_submitted
  const hasVersions = scripts.length > 0

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            创建于 {new Date(project.created_at).toLocaleDateString("zh-CN")}
            {project.updated_at !== project.created_at && (
              <>
                {" · 更新于 "}
                {new Date(project.updated_at).toLocaleString("zh-CN")}
              </>
            )}
          </p>
        </div>
      </div>

      {/* 原文 */}
      <AppCard>
        <AppCardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">原文</h2>
            <span className="text-xs text-muted-foreground">
              {hasSource ? "已提交（已锁定）" : "未提交"}
            </span>
          </div>

          {hasSource ? (
            <>
              <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-secondary/30 p-3">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-muted-foreground">
                  {project.source_text}
                </pre>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span className="rounded-full bg-secondary px-2.5 py-1">
                  {project.source_type === "markdown" ? "Markdown" : project.source_type === "txt" ? "TXT" : "粘贴文本"}
                </span>
                {project.source_name && <span className="rounded-full bg-secondary px-2.5 py-1">{project.source_name}</span>}
                <span className="rounded-full bg-secondary px-2.5 py-1">{(project.source_character_count ?? project.source_text?.length ?? 0).toLocaleString("zh-CN")} 字符</span>
                <span className="rounded-full bg-secondary px-2.5 py-1">
                  {(project.source_chunk_count || 1) === 1 ? "完整原文" : `${project.source_chunk_count} 个语义片段`}
                </span>
                {project.source_estimated_seconds && <span className="rounded-full bg-secondary px-2.5 py-1">预计 {Math.ceil(project.source_estimated_seconds / 60)} 分钟</span>}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                原文已锁定，不可修改；如需更换，请创建新项目。
              </p>
            </>
          ) : (
            <SourceInputPanel
              projectId={projectId}
              onSubmitted={() => queryClient.invalidateQueries({ queryKey: ["project", projectId] })}
              onGenerateRequested={() => setShowGenerate(true)}
            />
          )}
        </AppCardContent>
      </AppCard>

      {/* 脚本版本 */}
      <AppCard>
        <AppCardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">脚本版本</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {scripts.length} 个版本
              </span>
            </div>
          </div>

          {scriptTasksError && <p role="alert" className="mt-4 text-sm text-destructive">任务状态读取失败，请检查服务连接后刷新页面；已有脚本会保留。</p>}
          {!isGenerating && <ScriptTaskFailure task={latestScriptTask} onRetry={() => setShowGenerate(true)} />}

          {!hasSource ? (
            <Placeholder text="请先提交原文" hint="原文提交后即可生成脚本版本" />
          ) : !hasVersions && !isGenerating ? (
            <Placeholder text="还没有脚本版本" hint="点击“生成脚本”选择角色后创建第一个版本" />
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">版本号</th>
                    <th className="px-4 py-3 font-medium">脚本标题</th>
                    <th className="px-4 py-3 font-medium">句数</th>
                    <th className="px-4 py-3 font-medium">创建时间</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">音频</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 生成中占位行（位于顶部） */}
                  {isGenerating && generatingTask && (
                    <tr className="border-t border-border bg-primary/5">
                      <td className="px-4 py-3 font-medium">
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="size-3 animate-spin text-primary" />
                          V?
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          生成中…
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">—</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatStage(generatingTask.stage)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status="running" label={formatStage(generatingTask.stage)} />
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">—</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        <span className="text-xs">任务 {generatingTask.task_id}</span>
                      </td>
                    </tr>
                  )}

                  {scripts.map((version) => (
                    <tr
                      key={version.script_id}
                      className="border-t border-border transition-colors hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        V{version.version}
                        <span className="ml-1 text-xs text-muted-foreground">
                          (r{version.edit_revision})
                        </span>
                      </td>
                      <td className="px-4 py-3">{version.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {version.sentence_count}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(version.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={version.status} />
                      </td>
                      <td className="px-4 py-3">
                        <AudioStatusCell
                          audioVersion={latestByScript[version.script_id]}
                          loading={audioLoading}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AppButton
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onNavigate(
                              `/projects/${projectId}/scripts/${version.script_id}`,
                            )
                          }
                        >
                          查看
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasSource && (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <AppButton
                size="sm"
                variant="outline"
                onClick={() => setShowGenerate(true)}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-1 size-3 animate-spin" />
                    生成中…
                  </>
                  ) : hasVersions ? (
                    "重新生成脚本"
                  ) : (
                    "生成脚本"
                  )}
              </AppButton>
              {confirmedScript && audioSummary?.total === 0 && (
                <GenerateAudioButton projectId={projectId} script={confirmedScript} onNavigate={onNavigate} />
              )}
            </div>
          )}
        </AppCardContent>
      </AppCard>

      <ProjectAudioVersions projectId={projectId} scripts={scripts} onNavigate={onNavigate} />

      {showGenerate && (
        <GenerateDialog
          sourceText={project.source_text ?? ""}
          projectId={projectId}
          onClose={() => setShowGenerate(false)}
          onSubmitted={handleGenerateSubmitted}
        />
      )}
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

function ProjectAudioVersions({ projectId, scripts, onNavigate }: {
  projectId: string
  scripts: ScriptListItem[]
  onNavigate: (href: string) => void
}) {
  const [page, setPage] = React.useState(1)
  const pageSize = 20
  const confirmedScript = [...scripts]
    .filter((script) => script.status === "confirmed")
    .sort((a, b) => b.version - a.version)[0]
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["audio-versions", projectId, page],
    queryFn: () => audioApi.listVersions(projectId, { page, page_size: pageSize }),
    refetchInterval: (query) => query.state.data?.items.some(
      (version) => version.status === "queued" || version.status === "running",
    ) ? 2000 : false,
  })

  if (isPending || (!isError && data?.total === 0)) return null

  return (
    <AppCard>
      <AppCardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">音频版本</h2>
          {data && <span className="text-xs text-muted-foreground">{data.total} 个版本</span>}
        </div>
        {isPending ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />正在加载音频版本…
          </div>
        ) : isError ? (
          <div role="alert" className="mt-4 flex items-center justify-between gap-3 text-sm text-destructive">
            音频版本加载失败
            <AppButton size="sm" variant="outline" onClick={() => void refetch()}>重试</AppButton>
          </div>
        ) : !data?.items.length ? (
          <Placeholder text="还没有音频版本" hint="确认脚本后，进入音频页生成第一个版本" />
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full whitespace-nowrap text-sm">
              <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  {['版本号', '关联脚本', '时长', '创建时间', '状态'].map((label) => (
                    <th key={label} className="px-4 py-3 font-medium">{label}</th>
                  ))}
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((version) => (
                  <tr key={version.audio_version_id} className="border-t border-border transition-colors hover:bg-accent/50">
                    <td className="px-4 py-3 font-medium">V{version.version}</td>
                    <td className="px-4 py-3">
                      {scripts.find((script) => script.script_id === version.script_id)?.title ?? '脚本'}
                      <span className="ml-2 text-xs text-muted-foreground">V{version.script_version} (r{version.script_edit_revision})</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{version.duration_ms == null ? '—' : formatMs(version.duration_ms)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{new Date(version.created_at).toLocaleString('zh-CN')}</td>
                    <td className="px-4 py-3"><StatusBadge status={version.status} /></td>
                    <td className="px-4 py-3 text-right">
                      <AppButton size="sm" variant="ghost" onClick={() => onNavigate(
                        `/projects/${projectId}/scripts/${version.script_id}/audio?versionId=${encodeURIComponent(version.audio_version_id)}`,
                      )}>查看</AppButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {confirmedScript && data && data.total > 0 && (
          <div className="mt-3 flex justify-end">
            <GenerateAudioButton projectId={projectId} script={confirmedScript} onNavigate={onNavigate} regenerate />
          </div>
        )}
        {data && data.total > pageSize && (
          <div className="mt-3 flex items-center justify-end gap-3">
            <AppButton size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>上一页</AppButton>
            <span className="text-xs text-muted-foreground">{page} / {Math.ceil(data.total / pageSize)}</span>
            <AppButton size="sm" variant="outline" disabled={page * pageSize >= data.total} onClick={() => setPage(page + 1)}>下一页</AppButton>
          </div>
        )}
      </AppCardContent>
    </AppCard>
  )
}

function GenerateAudioButton({ projectId, script, onNavigate, regenerate = false }: {
  projectId: string
  script: ScriptListItem
  onNavigate: (href: string) => void
  regenerate?: boolean
}) {
  const generation = useGenerationConfirmation()
  const queryClient = useQueryClient()
  const busy = React.useRef(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const generate = async () => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try {
      const detail = await scriptsApi.detail(script.script_id)
      if (detail.status !== "confirmed" || detail.confirmed_revision !== detail.edit_revision) {
        throw new Error("脚本已发生变化，请重新确认后再生成音频")
      }
      if (!await generation.confirm({ kind: "audio", text: detail.sentences.map(s => s.text).join("\n"), title: detail.title })) return
      const accepted = await audioApi.generate(projectId, {
        script_id: detail.script_id,
        expected_script_version: detail.version,
        expected_edit_revision: detail.edit_revision,
      }, newIdempotencyKey())
      void queryClient.invalidateQueries({ queryKey: ["audio-versions", projectId] })
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      const query = accepted.audio_version_id ? `?versionId=${encodeURIComponent(accepted.audio_version_id)}` : ""
      onNavigate(`/projects/${projectId}/scripts/${detail.script_id}/audio${query}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成音频失败，请重试")
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {generation.dialog}
      <AppButton size="sm" variant="outline" disabled={submitting} onClick={() => void generate()}
        title={`基于已确认脚本 V${script.version}：${script.title}`}>
        {submitting && <Loader2 className="size-3 animate-spin" />}
        {submitting ? "正在提交…" : regenerate ? "重新生成音频" : "生成音频"}
      </AppButton>
      {error && <p role="alert" className="max-w-sm text-xs text-destructive">{error}</p>}
    </div>
  )
}

function Placeholder({ text, hint }: { text: string; hint: string }) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
      <FileText className="size-10 text-muted-foreground/40" />
      <p className="mt-3 text-sm font-medium">{text}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

/** 把 T-01 的 stage 字段翻译为中文 */
function formatStage(stage: string): string {
  const map: Record<string, string> = {
    queued: "排队中",
    calling_llm: "调用模型",
    analyzing_source: "提取全文概要",
    planning_script: "建立全局大纲",
    drafting_sections: "分节生成脚本",
    refining_script: "统一润色脚本",
    validating: "校验结果",
    synthesizing: "合成语音",
    merging: "合并音频",
    saving: "保存结果",
    completed: "完成",
    failed: "失败",
  }
  return map[stage] ?? stage
}
