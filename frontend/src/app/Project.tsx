// src/Project.tsx
import * as React from "react"
import { FileText, Loader2, AlertCircle } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import {
  projectsApi,
  scriptsApi,
  configApi,
  tasksApi,
  ApiError,
  newIdempotencyKey,
  type ProjectDetail,
  type ScriptListItem,
  type AudioVersionListItem,
  type ActiveTaskSummary,
  type RoleProfileItem,
  type TaskAccepted,
  type TaskDetail,
} from "@/api"

import { AudioStatusBadge } from "./Audio"

// ============================================================
// Badges
// ============================================================

export function StatusBadge({ status }: { status: ScriptListItem["status"] }) {
  const config: Record<
    ScriptListItem["status"],
    { label: string; className: string }
  > = {
    draft: { label: "草稿", className: "bg-muted text-muted-foreground" },
    confirmed: {
      label: "已确认",
      className: "bg-green-500/15 text-green-600 dark:text-green-500",
    },
  }
  const { label, className } = config[status]
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      {label}
    </span>
  )
}

// ============================================================
// Audio status cell
// ============================================================

function AudioStatusCell({
  projectId,
  scriptId,
  audioVersion,
  loading,
  onNavigate,
}: {
  projectId: string
  scriptId: string
  audioVersion: AudioVersionListItem | undefined
  loading: boolean
  onNavigate: (href: string) => void
}) {
  const href = `/projects/${projectId}/scripts/${scriptId}/audio`
  if (loading) return <Loader2 className="size-4 animate-spin text-muted-foreground" />
  if (!audioVersion) {
    return (
      <button
        onClick={() => onNavigate(href)}
        className="text-xs text-primary hover:underline"
      >
        生成音频
      </button>
    )
  }
  return (
    <button onClick={() => onNavigate(href)}>
      <AudioStatusBadge status={audioVersion.status} />
    </button>
  )
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

/**
 * 轮询 P-03 直到 active_tasks 中不再有 script 任务。
 * 返回：成功后 invalidate scripts 列表；失败时取 T-01 拿 error。
 */
function useScriptGenerationPolling(
  projectId: string,
  enabled: boolean,
  onSettled: (finalTask: TaskDetail | null) => void,
) {
  const queryClient = useQueryClient()

  React.useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const tick = async () => {
      try {
        const detail = await projectsApi.detail(projectId)
        if (cancelled) return
        const scriptTask = pickScriptTask(detail.active_tasks)
        if (scriptTask) {
          // 还在跑：刷新缓存让 UI 更新阶段/进度
          queryClient.setQueryData(["project", projectId], detail)
          return
        }
        // 没有 script 任务了：停止轮询，刷新脚本列表
        if (timer) clearInterval(timer)
        queryClient.invalidateQueries({ queryKey: ["scripts", projectId] })
        // 用最后一次 P-03 缓存里的 script 任务 ID 反查 T-01（若有）
        // 由于 active_tasks 已清空，我们保存的 lastTaskId 从调用方传不进来，
        // 这里退化为：拉一次最近任务列表，取最新 script 任务
        try {
          const list = await tasksApi.listByProject(projectId, {
            page: 1,
            page_size: 5,
            task_type: "script",
          })
          const latest = list.items[0] ?? null
          if (!cancelled) onSettled(latest)
        } catch {
          if (!cancelled) onSettled(null)
        }
      } catch (e) {
        if (cancelled) return
        // 网络错误：继续重试（不停止）
        console.warn("轮询项目详情失败", e)
      }
    }

    // 立即执行一次，再每 2 秒
    void tick()
    timer = setInterval(() => void tick(), 2000)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [projectId, enabled, onSettled, queryClient])
}

// ============================================================
// Generate dialog: 选择角色（C-06）
// ============================================================

interface GenerateDialogProps {
  projectId: string
  onClose: () => void
  onSubmitted: () => void
}

function GenerateDialog({ projectId, onClose, onSubmitted }: GenerateDialogProps) {
  const [selected, setSelected] = React.useState<string[]>([])
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
  const canSubmit = selected.length >= 1 && selected.length <= 8 && !submitting

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= 8) return prev
      return [...prev, id]
    })
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
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
        { roles: payloadRoles },
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
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">生成脚本</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          选择 1–8 个角色模板，生成后将创建新脚本版本。
        </p>

        <div className="mt-4 max-h-80 overflow-y-auto rounded-lg border border-border">
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

        {error && (
          <p className="mt-3 text-xs text-destructive">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <AppButton variant="ghost" onClick={onClose} disabled={submitting}>
            取消
          </AppButton>
          <AppButton onClick={handleSubmit} disabled={!canSubmit}>
            {submitting && <Loader2 className="mr-1 size-3 animate-spin" />}
            开始生成
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

  const { latestByScript, loading: audioLoading } = useLatestAudioByScript(
    projectId,
    scripts,
  )

  const [pasteContent, setPasteContent] = React.useState("")
  const [showPaste, setShowPaste] = React.useState(false)
  const [submittingSource, setSubmittingSource] = React.useState(false)
  const [showGenerate, setShowGenerate] = React.useState(false)

  // 是否有进行中的脚本生成任务（来自 P-03 active_tasks）
  const activeScriptTask = pickScriptTask(project?.active_tasks)
  const isGenerating = !!activeScriptTask

  // 轮询：当有 script 任务时启动
  const handleSettled = React.useCallback(
    (finalTask: TaskDetail | null) => {
      if (finalTask?.status === "failed") {
        // 失败提示（非侵入）
        console.warn(
          `脚本生成失败：${finalTask.error_code} ${finalTask.error_message ?? ""}`,
        )
      }
      // 不论成败都刷新项目详情与脚本列表
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      queryClient.invalidateQueries({ queryKey: ["scripts", projectId] })
    },
    [projectId, queryClient],
  )

  useScriptGenerationPolling(projectId, isGenerating, handleSettled)

  // ---------- 提交原文 ----------
  const submitText = async (text: string) => {
    setSubmittingSource(true)
    try {
      await projectsApi.submitSource(projectId, { text })
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
      setShowPaste(false)
      setPasteContent("")
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "提交失败")
    } finally {
      setSubmittingSource(false)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setSubmittingSource(true)
    try {
      await projectsApi.uploadSource(projectId, file)
      queryClient.invalidateQueries({ queryKey: ["project", projectId] })
    } catch (e) {
      alert(e instanceof ApiError ? e.message : "上传失败")
    } finally {
      setSubmittingSource(false)
    }
  }

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return
    void submitText(pasteContent)
  }

  // ---------- 生成成功后的回调：重新拉项目详情以恢复占位 ----------
  const handleGenerateSubmitted = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["project", projectId] })
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {project.source_text}
                </p>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                原文已锁定，不可修改；如需更换，请创建新项目。
              </p>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                上传 TXT 文件或粘贴原文，提交后即锁定。
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label>
                  <input
                    type="file"
                    accept=".txt"
                    className="sr-only"
                    onChange={handleFileUpload}
                    disabled={submittingSource}
                  />
                  <AppButton asChild disabled={submittingSource}>
                    <span>
                      {submittingSource ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <FileText className="size-4" />
                      )}
                      上传 TXT
                    </span>
                  </AppButton>
                </label>
                <AppButton
                  variant="outline"
                  onClick={() => setShowPaste((v) => !v)}
                  disabled={submittingSource}
                >
                  粘贴原文
                </AppButton>
              </div>

              {showPaste && (
                <div className="mt-4 space-y-3">
                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder="在此粘贴原文内容…（提交后锁定）"
                    rows={6}
                    disabled={submittingSource}
                    className={cn(
                      "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm",
                      "placeholder:text-muted-foreground",
                      "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <AppButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowPaste(false)
                        setPasteContent("")
                      }}
                      disabled={submittingSource}
                    >
                      取消
                    </AppButton>
                    <AppButton
                      size="sm"
                      onClick={handlePasteSubmit}
                      disabled={!pasteContent.trim() || submittingSource}
                    >
                      {submittingSource && (
                        <Loader2 className="mr-1 size-3 animate-spin" />
                      )}
                      提交原文
                    </AppButton>
                  </div>
                </div>
              )}
            </>
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

          {!hasSource ? (
            <Placeholder text="请先提交原文" hint="原文提交后即可生成脚本版本" />
          ) : !hasVersions && !isGenerating ? (
            <Placeholder text="还没有脚本版本" hint="点击“生成脚本”选择角色后创建第一个版本" />
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
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
                  {isGenerating && activeScriptTask && (
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
                        {formatStage(activeScriptTask.stage)}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[11px] font-medium text-blue-500">
                          <Loader2 className="size-3 animate-spin" />
                          {formatStage(activeScriptTask.stage)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">—</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        <button
                          onClick={() => onNavigate(activeScriptTask.status_url)}
                          className="text-xs text-primary hover:underline"
                        >
                          查看任务
                        </button>
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
                          projectId={projectId}
                          scriptId={version.script_id}
                          audioVersion={latestByScript[version.script_id]}
                          loading={audioLoading}
                          onNavigate={onNavigate}
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
            <div className="mt-3 flex justify-end">
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
            </div>
          )}
        </AppCardContent>
      </AppCard>

      {showGenerate && (
        <GenerateDialog
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
    validating: "校验结果",
    synthesizing: "合成语音",
    merging: "合并音频",
    saving: "保存结果",
    completed: "完成",
    failed: "失败",
  }
  return map[stage] ?? stage
}
