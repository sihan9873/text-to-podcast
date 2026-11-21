import { useGenerationConfirmation } from "@/components/common/GenerationConfirmation"
// src/Audio.tsx
import * as React from "react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { useSearchParams } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import {
  Play,
  Mic,
  Download,
  RefreshCw,
  AlertCircle,
  Loader2,
  FileAudio,
  FileText,
  Clock,
  ChevronRight,
  ArrowLeft,
  HardDrive,
  Headphones,
  SlidersHorizontal,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppMp3Player } from "@/components/common/AppMp3Player"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { RoleAvatar, hashToneIndex } from "@/components/common/RoleAvatar"

import {
  ApiError,
  newIdempotencyKey,
  audioApi,
  tasksApi,
  scriptsApi,
  pollTask,
  downloadAudio,
} from "@/api"

import type {
  AudioVersionDetail,
  AudioVersionListItem,
  ScriptDetail,
  TaskDetail,
} from "@/api"

// ============================================================
// Status badge
// ============================================================

// ============================================================
// 角色配色：角色名 → 配色序号（与脚本页一致，按脚本角色顺序）
// ============================================================

export const RoleToneContext = React.createContext<Map<string, number>>(new Map())

export function useRoleToneIndex() {
  const map = React.useContext(RoleToneContext)
  return React.useCallback(
    (name: string) => map.get(name) ?? hashToneIndex(name),
    [map],
  )
}

// ============================================================
// Audio page (top-level)
// ============================================================

export interface AudioPageProps {
  projectId: string
  scriptId: string
  onNavigate: (href: string) => void
}

export default function AudioPage({ projectId, scriptId, onNavigate }: AudioPageProps) {
  const [searchParams] = useSearchParams()
  const requestedVersionId = searchParams.get("versionId")
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [script, setScript] = React.useState<ScriptDetail | null>(null)
  const [versions, setVersions] = React.useState<AudioVersionListItem[] | null>(null)
  const [activeVersionId, setActiveVersionId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, list] = await Promise.all([
        scriptsApi.detail(scriptId),
        audioApi.listVersions(projectId, { script_id: scriptId, page: 1, page_size: 50 }),
      ])
      const sorted = [...list.items].sort((a, b) => b.version - a.version)
      if (requestedVersionId && !sorted.some((v) => v.audio_version_id === requestedVersionId)) {
        const requested = await audioApi.versionDetail(requestedVersionId)
        if (requested.project_id === projectId && requested.script_id === scriptId) {
          sorted.push(requested)
          sorted.sort((a, b) => b.version - a.version)
        }
      }
      setScript(s)
      setVersions(sorted)
      setActiveVersionId((cur) => {
        if (requestedVersionId && sorted.some((v) => v.audio_version_id === requestedVersionId)) return requestedVersionId
        if (cur && sorted.some((v) => v.audio_version_id === cur)) return cur
        const ready = sorted.find((v) => v.status === "ready")
        return ready?.audio_version_id ?? sorted[0]?.audio_version_id ?? null
      })
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [projectId, scriptId, requestedVersionId])

  React.useEffect(() => {
    void load()
  }, [load])

  const refreshVersions = React.useCallback(async () => {
    try {
      const list = await audioApi.listVersions(projectId, {
        script_id: scriptId,
        page: 1,
        page_size: 50,
      })
      const sorted = [...list.items].sort((a, b) => b.version - a.version)
      setVersions(sorted)
      setActiveVersionId((cur) => cur ?? sorted.find((v) => v.status === "ready")?.audio_version_id ?? sorted[0]?.audio_version_id ?? null)
    } catch {
      /* ignore */
    }
  }, [projectId, scriptId])

  if (loading) return <AudioPageSkeleton />

  if (error && !script) {
    return (
      <ErrorBlock
        title="加载失败"
        message={error}
        onBack={() => onNavigate(`/projects/${projectId}`)}
      />
    )
  }
  if (!script) {
    return (
      <ErrorBlock
        title="脚本不存在"
        message="该脚本可能已被删除或不属于当前项目"
        onBack={() => onNavigate(`/projects/${projectId}`)}
      />
    )
  }

  const isConfirmed = script.status === "confirmed"
  const isCurrentConfirmed =
    isConfirmed && script.confirmed_revision === script.edit_revision
  const sorted = versions ?? []
  const active = sorted.find((v) => v.audio_version_id === activeVersionId) ?? null
  // 角色名 → 配色序号（按脚本角色顺序，与脚本页一致）
  const roleTones = new Map<string, number>(
    script.roles.map((r, i): [string, number] => [r.name, i]),
  )

  return (
    <RoleToneContext.Provider value={roleTones}>
      <div className="mx-auto flex min-h-full w-full min-w-0 max-w-7xl flex-col space-y-4">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <AppButton
              variant="ghost"
              size="sm"
              aria-label="返回项目"
              title="返回项目"
              className="shrink-0 text-muted-foreground"
              onClick={() => onNavigate(`/projects/${projectId}`)}
            >
              <ArrowLeft />
            </AppButton>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold leading-tight tracking-tight" title={script.title}>
                {script.title}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><Headphones className="size-3.5" />音频生成</span>
                <StatusBadge status={script.status} />
                <span className="font-mono" title="脚本版本 · 编辑修订号">V{script.version} · r{script.edit_revision}</span>
              </div>
            </div>
          </div>
          <AppButton size="sm" variant="outline" onClick={() => onNavigate(`/projects/${projectId}/scripts/${scriptId}`)}>
            <FileText />脚本详情
          </AppButton>
        </header>

        {/* 未确认提示 */}
        {!isCurrentConfirmed && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
              <AlertCircle className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">
                {isConfirmed ? "脚本内容已更新，需要重新确认" : "脚本尚未确认"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                只有处于"已确认且修订号一致"的脚本才能试听或生成音频。
              </p>
            </div>
            <AppButton
              size="sm"
              variant="outline"
              onClick={() =>
                onNavigate(`/projects/${projectId}/scripts/${scriptId}`)
              }
            >
              前往脚本详情
              <ChevronRight />
            </AppButton>
          </div>
        )}

        {/* 角色声音配置 + 音频版本 */}
        {active ? (
          <AppCard className="overflow-hidden">
            <div className="grid lg:grid-cols-[320px_minmax(0,1fr)]">
              <VersionList
                versions={sorted}
                activeId={active.audio_version_id}
                onSelect={setActiveVersionId}
              />
              <div className="min-w-0">
          <AudioVersionView
            key={`${active.audio_version_id}:${script.edit_revision}`}
            version={active}
            scriptConfirmed={isConfirmed}
            scriptId={scriptId}
            projectId={projectId}
            onRefreshList={refreshVersions}
            onNavigate={onNavigate}
          />
              </div>
            </div>
          </AppCard>
        ) : (
          <GeneratePanel
            key={`${script.script_id}:${script.edit_revision}:${script.status}`}
            projectId={projectId}
            script={script}
            confirmed={isCurrentConfirmed}
            onAccepted={refreshVersions}
          />
        )}
      </div>
    </RoleToneContext.Provider>
  )
}

// ============================================================
// Voice config card & version list
// ============================================================

export function AudioRoleSettings({ detail, scriptConfirmed, onNavigate }: {
  detail: AudioVersionDetail
  scriptConfirmed: boolean
  onNavigate: (href: string) => void
}) {
  const queryClient = useQueryClient()
  const busy = React.useRef(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const snapshotRoles = detail.script_snapshot?.roles
  const roles = Array.isArray(snapshotRoles)
    ? snapshotRoles.filter((role): role is Record<string, unknown> =>
        !!role && typeof role === "object" && typeof role.name === "string")
    : []

  const editScript = async () => {
    if (busy.current) return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try {
      const current = await scriptsApi.detail(detail.script_id)
      if (current.status === "confirmed") {
        await scriptsApi.unconfirm(current.script_id, {
          expected_script_version: current.version,
          expected_edit_revision: current.edit_revision,
        })
      }
      void queryClient.invalidateQueries({ queryKey: ["scripts", detail.project_id] })
      void queryClient.invalidateQueries({ queryKey: ["project", detail.project_id] })
      onNavigate(`/projects/${detail.project_id}/scripts/${detail.script_id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "取消确认失败，请重试")
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }

  return (
    <section className="mt-5 space-y-3 border-t border-border pt-5" aria-label="音频角色声音设定">
      <div>
        <h3 className="text-sm font-semibold">角色声音设定</h3>
        <p className="mt-1 text-xs text-muted-foreground">本音频生成时的声音设定，仅供查看。修改脚本不会改变已有音频。</p>
      </div>
      <div className="grid items-start gap-2 sm:grid-cols-2">
        {roles.map((role, index) => {
          const voice = role.voice_config && typeof role.voice_config === "object"
            ? role.voice_config as Record<string, unknown>
            : null
          const fields = [
            ["服务商", voice?.tts_provider],
            ["模型", voice?.tts_model],
            ["音色", voice?.voice_id],
            ["语速", voice?.speed],
            ["风格", voice?.style],
          ]
          return (
            <div key={String(role.role_id ?? role.role_key ?? index)} className="rounded-lg border border-border bg-secondary/20">
              <div className="flex items-center gap-2.5 px-3 py-2 text-xs font-medium">
                <RoleAvatar name={String(role.name)} toneIndex={index} size="sm" />
                <span className="min-w-0 flex-1 break-words">{String(role.name)}</span>
              </div>
              {voice ? (
                <dl className="space-y-2 border-t border-border px-3 py-3 text-xs">
                  {fields.map(([label, value]) => (
                    <div key={String(label)} className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
                      <dt className="text-muted-foreground">{String(label)}</dt>
                      <dd className="break-words">{value == null || value === "" ? "—" : String(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="px-3 pb-3 text-xs text-muted-foreground">本音频未记录该角色的声音设定。</p>}
            </div>
          )
        })}
      </div>
      {roles.length === 0 && <p className="text-xs text-muted-foreground">本音频未记录角色声音设定。</p>}
      <AppButton size="sm" variant="outline" disabled={submitting} onClick={() => void editScript()}>
        {submitting ? <Loader2 className="animate-spin" /> : <SlidersHorizontal />}
        {scriptConfirmed ? "取消确认以编辑角色声音" : "前往脚本编辑角色声音"}
      </AppButton>
      {error && <InlineError>{error}</InlineError>}
    </section>
  )
}

function VersionList({
  versions,
  activeId,
  onSelect,
}: {
  versions: AudioVersionListItem[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden border-b border-border lg:border-b-0 lg:border-r">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileAudio className="size-4" />
          </span>
          <h2 className="text-sm font-semibold">音频版本</h2>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {versions.length} 个版本
        </span>
      </div>
      <ul className="max-h-72 space-y-1.5 overflow-y-auto overscroll-contain p-3">
        {versions.map((v) => {
          const selected = v.audio_version_id === activeId
          return (
            <li key={v.audio_version_id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(v.audio_version_id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? "border-primary/50 bg-primary/5"
                    : "border-border hover:bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-semibold",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-muted-foreground",
                  )}
                >
                  V{v.version}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">音频 V{v.version}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {new Date(v.created_at).toLocaleString("zh-CN")}
                    {v.duration_ms != null ? ` · ${formatMs(v.duration_ms)}` : ""}
                  </p>
                </div>
                <StatusBadge status={v.status} />
                <ChevronRight
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform",
                    selected && "translate-x-0.5 text-primary",
                  )}
                />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ============================================================
// Generate panel (A-01 / A-02)
// ============================================================

interface GeneratePanelProps {
  projectId: string
  script: ScriptDetail
  confirmed: boolean
  onAccepted: () => void
}

function GeneratePanel({ projectId, script, confirmed, onAccepted }: GeneratePanelProps) {
  const generation = useGenerationConfirmation()
  const generationBusy = React.useRef(false)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewPlayUrl, setPreviewPlayUrl] = React.useState<string | null>(null)
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  const [fullLoading, setFullLoading] = React.useState(false)
  const [fullTask, setFullTask] = React.useState<TaskDetail | null>(null)
  const [fullError, setFullError] = React.useState<string | null>(null)

  const abortRef = React.useRef<AbortController | null>(null)
  React.useEffect(() => () => abortRef.current?.abort(), [])

  const expected = {
    script_id: script.script_id,
    expected_script_version: script.version,
    expected_edit_revision: script.edit_revision,
  }

  const runPreview = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewPlayUrl(null)
    try {
      const accepted = await audioApi.preview(projectId, expected, newIdempotencyKey())
      const task = await pollTask(accepted.task_id, { signal: controller.signal })
      if (task.status === "succeeded") {
        const result = task.result as { play_url?: string } | null
        if (result?.play_url) setPreviewPlayUrl(result.play_url)
        else setPreviewError("试听成功但未返回播放地址")
      } else {
        setPreviewError(task.error_message ?? "试听失败")
      }
    } catch (e) {
      if (isAbort(e)) return
      setPreviewError(e instanceof ApiError ? `${e.code}: ${e.message}` : "试听失败")
    } finally {
      setPreviewLoading(false)
    }
  }

  const runFull = async () => {
    if (generationBusy.current) return
    generationBusy.current = true
    const acceptedByUser = await generation.confirm({ kind: "audio", text: script.sentences.map(s => s.text).join("\n"), title: script.title })
    if (!acceptedByUser) { generationBusy.current = false; return }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setFullLoading(true)
    setFullError(null)
    setFullTask(null)
    try {
      const accepted = await audioApi.generate(projectId, expected, newIdempotencyKey())
      await pollTask(accepted.task_id, {
        signal: controller.signal,
        onUpdate: setFullTask,
      })
      onAccepted()
    } catch (e) {
      if (isAbort(e)) return
      setFullError(e instanceof ApiError ? `${e.code}: ${e.message}` : "生成失败")
    } finally {
      generationBusy.current = false
      setFullLoading(false)
    }
  }

  const busy = previewLoading || fullLoading
  const progress =
    typeof fullTask?.progress === "number"
      ? Math.min(100, Math.max(0, fullTask.progress))
      : null

  return (
    <AppCard variant="accent" className="relative overflow-hidden">
      {generation.dialog}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/15 blur-3xl"
      />
      <AppCardContent className="relative p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/30 to-primary/5 text-primary ring-1 ring-primary/30">
            <Mic className="size-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold tracking-tight">生成音频</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              音频使用上方“角色声音配置”。调整音色或语速后，请保存并重新确认脚本。
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            脚本角色 · {script.roles.length}
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {script.roles.map((role, i) => (
              <li
                key={role.role_id}
                className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 px-3 py-2.5"
              >
                <RoleAvatar name={role.name} toneIndex={i} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{role.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {role.voice_config.tts_provider} / {role.voice_config.tts_model} ·{" "}
                    {role.voice_config.voice_id}
                    {role.voice_config.style ? ` · ${role.voice_config.style}` : ""} · x
                    {role.voice_config.speed}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <AppButton
            onClick={runPreview}
            disabled={!confirmed || busy}
            variant="outline"
          >
            {previewLoading ? <Loader2 className="animate-spin" /> : <Play />}
            试听前三句
          </AppButton>
          <AppButton onClick={runFull} disabled={!confirmed || busy}>
            {fullLoading ? <Loader2 className="animate-spin" /> : <FileAudio />}
            生成全文音频
          </AppButton>
        </div>

        {previewError && <InlineError className="mt-4">{previewError}</InlineError>}
        {fullError && <InlineError className="mt-4">{fullError}</InlineError>}

        {fullTask?.status === "running" && (
          <div
            role="status"
            className="mt-5 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4"
          >
            <div className="flex items-center justify-between text-sm text-sky-300">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                全文生成中…
              </span>
              {progress !== null && <span className="tabular-nums">{progress}%</span>}
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full bg-sky-400 transition-all",
                  progress === null && "w-1/3 animate-pulse",
                )}
                style={progress !== null ? { width: `${progress}%` } : undefined}
              />
            </div>
          </div>
        )}

        {previewPlayUrl && (
          <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">试听片段</p>
            <AppMp3Player tracks={[{ src: previewPlayUrl, title: "试听片段" }]} variant="compact" />
          </div>
        )}
      </AppCardContent>
    </AppCard>
  )
}

// ============================================================
// Audio version detail view (A-04 + A-05) with per-sentence listening
// ============================================================

interface AudioVersionViewProps {
  scriptConfirmed: boolean
  scriptId: string
  version: AudioVersionListItem
  projectId: string
  onRefreshList: () => void
  onNavigate: (href: string) => void
}

function AudioVersionView({
  scriptConfirmed,
  scriptId,
  version,
  projectId,
  onRefreshList,
  onNavigate,
}: AudioVersionViewProps) {
  const generation = useGenerationConfirmation()
  const regenerateBusy = React.useRef(false)
  const [regenerating, setRegenerating] = React.useState(false)
  const [regenerateError, setRegenerateError] = React.useState<string | null>(null)
  const [detail, setDetail] = React.useState<AudioVersionDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const regenerate = async () => {
    if (regenerateBusy.current) return
    regenerateBusy.current = true
    setRegenerating(true)
    setRegenerateError(null)
    try {
      const script = await scriptsApi.detail(scriptId)
      if (script.status !== "confirmed" || script.confirmed_revision !== script.edit_revision) {
        throw new Error("请先在脚本页确认当前脚本，再重新生成音频")
      }
      if (!await generation.confirm({
        kind: "audio",
        text: script.sentences.map(sentence => sentence.text).join("\n"),
        title: `基于当前已确认脚本 V${script.version}：${script.title}`,
      })) return
      const accepted = await audioApi.generate(projectId, {
        script_id: scriptId,
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
      }, newIdempotencyKey())
      onRefreshList()
      if (accepted.audio_version_id) {
        onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio?versionId=${encodeURIComponent(accepted.audio_version_id)}`)
      }
    } catch (e) {
      setRegenerateError(e instanceof Error ? e.message : "重新生成音频失败，请重试")
    } finally {
      regenerateBusy.current = false
      setRegenerating(false)
    }
  }

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setDetail(await audioApi.versionDetail(version.audio_version_id))
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "加载音频失败")
    } finally {
      setLoading(false)
    }
  }, [version.audio_version_id])

  React.useEffect(() => {
    void load()
  }, [load])

  // 版本状态为 queued/running 时轮询刷新
  React.useEffect(() => {
    if (!detail) return
    if (detail.status !== "queued" && detail.status !== "running") return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [detail, load])

  if (loading) return <div className="p-6"><AudioDetailSkeleton /></div>
  if (error || !detail) {
    return (
      <ErrorBlock
        title="加载音频失败"
        message={error ?? "未知错误"}
        onBack={() => onNavigate(`/projects/${projectId}`)}
      />
    )
  }

  const canDownload = detail.status === "ready" && !!detail.current_asset_id

  return (
        <AppCardContent className="p-6">
          {generation.dialog}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <FileAudio className="size-5" />
              </span>
              <h2 className="text-lg font-semibold tracking-tight">
                音频 V{detail.version}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={detail.status} />
              <span className="font-mono text-xs text-muted-foreground">
                selection r{detail.selection_revision}
              </span>
            </div>
          </div>

          {detail.status === "ready" && (
            <>
              <div className="mt-5">
                {detail.play_url && (
                  <AppMp3Player tracks={[{ src: detail.play_url, title: `音频 V${detail.version}` }]} />
                )}
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  {detail.duration_ms != null && (
                    <MetaChip icon={Clock}>{formatMs(detail.duration_ms)}</MetaChip>
                  )}
                  {detail.size_bytes != null && (
                    <MetaChip icon={HardDrive}>{formatBytes(detail.size_bytes)}</MetaChip>
                  )}
                  <MetaChip icon={FileText}>基于脚本 V{detail.script_version}</MetaChip>
                </div>
                <div className="flex flex-wrap gap-2">
                  <AppButton variant="outline" onClick={() => onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio/${detail.audio_version_id}/sentences`)}><Headphones />逐句试听<ChevronRight /></AppButton>
                {canDownload && (
                  <AppButton
                    variant="outline"
                    onClick={() =>
                      downloadAudio(
                        detail.current_asset_id!,
                        buildAudioFileName(detail.script_snapshot, detail.version),
                      ).catch((e) =>
                        setError(e instanceof ApiError ? e.message : "下载失败"),
                      )
                    }
                  >
                    <Download />
                    下载 MP3
                  </AppButton>
                )}
                  <AppButton variant="outline" onClick={() => void regenerate()} disabled={regenerating || !scriptConfirmed}
                    title={!scriptConfirmed ? "请先在脚本页确认脚本" : "使用当前已确认脚本生成新的音频版本"}>
                    {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    重新生成音频
                  </AppButton>
              </div>
              </div>
              {regenerateError && <InlineError>{regenerateError}</InlineError>}
              {detail.source_script_changed && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  脚本内容此后有更新，不影响本次已生成的音频。
                </p>
              )}
            </>
          )}

          <AudioRoleSettings detail={detail} scriptConfirmed={scriptConfirmed} onNavigate={onNavigate} />

          {detail.status === "queued" || detail.status === "running" ? (
            <div
              role="status"
              className="mt-5 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4"
            >
              <div className="flex items-center gap-2 text-sm text-sky-300">
                <Loader2 className="size-4 animate-spin" />
                音频生成中，每 2 秒自动刷新…
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-sky-400/70" />
              </div>
            </div>
          ) : null}

          {detail.status === "failed" && (
            <RetryFailedTask
              projectId={projectId}
              audioVersionId={detail.audio_version_id}
              onRetried={() => { void load(); onRefreshList() }}
            />
          )}
        </AppCardContent>


  )
}

// ============================================================
// Retry failed audio version task (T-02 + T-03)
// ============================================================

function RetryFailedTask({
  projectId,
  audioVersionId,
  onRetried,
}: {
  projectId: string
  audioVersionId: string
  onRetried: () => void
}) {
  const [retrying, setRetrying] = React.useState(false)
  const [err, setErr] = React.useState<string | null>(null)
  const [failedTaskId, setFailedTaskId] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        // 只查询该 audio_version 下的任务，避免误重试其他版本
        const list = await tasksApi.listByProject(projectId, {
          page: 1,
          page_size: 50,
          audio_version_id: audioVersionId,
          task_type: "audio",
          status: "failed",
        })
        if (cancelled) return
        const candidate = list.items
          .filter((t) => t.can_retry)
          .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0]
        setFailedTaskId(candidate?.task_id ?? null)
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, audioVersionId])

  const handleRetry = async () => {
    if (!failedTaskId) return
    setRetrying(true)
    setErr(null)
    try {
      const accepted = await tasksApi.retry(failedTaskId, newIdempotencyKey())
      await pollTask(accepted.task_id)
      onRetried()
    } catch (e) {
      if (isAbort(e)) return
      setErr(e instanceof ApiError ? `${e.code}: ${e.message}` : "重试失败")
    } finally {
      setRetrying(false)
    }
  }

  if (loading) {
    return (
      <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        正在查找可重试任务…
      </div>
    )
  }
  if (!failedTaskId) return null

  return (
    <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">音频生成失败</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            失败可重试：将沿用原输入复用已有成功片段，仅补做失败部分。
          </p>
          <AppButton
            className="mt-3"
            size="sm"
            onClick={handleRetry}
            disabled={retrying}
          >
            {retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            重试生成
          </AppButton>
          {err && <InlineError className="mt-3">{err}</InlineError>}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Skeletons & blocks
// ============================================================

function AudioPageSkeleton() {
  return (
    <div
      role="status"
      aria-label="正在加载音频页面"
      className="mx-auto max-w-7xl space-y-4"
    >
      <div className="h-8 w-24 animate-pulse rounded-lg bg-secondary" />
      <div className="flex items-center gap-3">
        <div className="size-9 animate-pulse rounded-xl bg-secondary" />
        <div className="h-6 w-56 animate-pulse rounded-md bg-secondary/70" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
    </div>
  )
}

export function AudioDetailSkeleton() {
  return (
    <div role="status" aria-label="正在加载音频" className="space-y-4">
      <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
</div>
  )
}

export function ErrorBlock({
  title,
  message,
  onBack,
}: {
  title: string
  message: string
  onBack: () => void
}) {
  return (
    <div className="mx-auto max-w-sm py-16">
      <AppCard>
        <AppCardContent className="flex flex-col items-center p-8 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
            <AlertCircle className="size-5" />
          </span>
          <h1 className="mt-5 text-lg font-semibold">{title}</h1>
          <p className="mt-1 break-words text-sm text-muted-foreground">{message}</p>
          <AppButton className="mt-6" size="sm" onClick={onBack}>
            返回项目
          </AppButton>
        </AppCardContent>
      </AppCard>
    </div>
  )
}

/** 行内错误提示：红色描边 + 图标，比一行红字更醒目 */
export function InlineError({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive",
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

function MetaChip({
  icon: Icon,
  children,
}: {
  icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-secondary/50 px-2 py-1 text-xs tabular-nums text-muted-foreground">
      <Icon className="size-3.5 text-primary/80" />
      {children}
    </span>
  )
}

// ============================================================
// Helpers
// ============================================================

export function isAbort(e: unknown): boolean {
  return (
    (e instanceof DOMException && e.name === "AbortError") ||
    (typeof e === "object" && e !== null && "name" in e && (e as { name: string }).name === "AbortError")
  )
}

function formatSec(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function formatMs(ms: number): string {
  return formatSec(ms / 1000)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function buildAudioFileName(snapshot: unknown, version: number): string {
  const snap = (snapshot ?? {}) as Record<string, unknown>
  const raw =
    (typeof snap.title === "string" && snap.title) ||
    (typeof snap.script_title === "string" && snap.script_title) ||
    "播客音频"
  const safe = raw.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "播客音频"
  return `${safe}_音频V${version}.mp3`
}
