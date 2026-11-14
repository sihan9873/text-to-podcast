// src/Audio.tsx
import * as React from "react"
import { RoleVoiceEditorDialog, type RoleDraft } from '@/components/audio/RoleVoiceEditorDialog'
import {
  Play,
  Pause,
  Download,
  RefreshCw,
  Volume2,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Mic,
  FileAudio,
  FileText,
  Clock,
  ThumbsUp,
  RotateCcw,
  ChevronRight,
  ArrowLeft,
  HardDrive,
  Headphones,
  SlidersHorizontal,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { RoleAvatar, roleTone, hashToneIndex } from "@/components/common/RoleAvatar"

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
  AudioSentencesResponse,
  AudioSentenceItem,
  AudioVersionDetail,
  AudioVersionListItem,
  CandidateItem,
  ScriptDetail,
  TaskDetail,
  KeepOriginalResponse,
  UseCandidateCurrentResponse,
  TaskAccepted,
} from "@/api"

// ============================================================
// Status badge
// ============================================================

type AudioLikeStatus = AudioVersionListItem["status"] | AudioSentenceItem["status"] | CandidateItem['status']

export function AudioStatusBadge({ status }: { status: AudioLikeStatus }) {
  const map: Record<
    AudioLikeStatus,
    { label: string; className: string; icon: React.ElementType; spin?: boolean }
  > = {
    pending: { label: '待生成', className: 'bg-muted text-muted-foreground', icon: Clock },
    accepted: { label: '已采用', className: 'bg-emerald-500/15 text-emerald-400', icon: CheckCircle2 },
    discarded: { label: '已保留原片段', className: 'bg-muted text-muted-foreground', icon: RotateCcw },
    queued: { label: "排队中", className: "bg-muted text-muted-foreground", icon: Clock },
    running: {
      label: "生成中",
      className: "bg-sky-500/15 text-sky-400",
      icon: Loader2,
      spin: true,
    },
    ready: {
      label: "已完成",
      className: "bg-emerald-500/15 text-emerald-400",
      icon: CheckCircle2,
    },
    succeeded: {
      label: "成功",
      className: "bg-emerald-500/15 text-emerald-400",
      icon: CheckCircle2,
    },
    failed: { label: "失败", className: "bg-red-500/15 text-red-400", icon: AlertCircle },
  }
  const { label, className, icon: Icon, spin } = map[status]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      <Icon className={cn("size-3", spin && "animate-spin")} />
      {label}
    </span>
  )
}

// ============================================================
// 角色配色：角色名 → 配色序号（与脚本页一致，按脚本角色顺序）
// ============================================================

const RoleToneContext = React.createContext<Map<string, number>>(new Map())

function useRoleToneIndex() {
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
  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false)
  const [savingVoices, setSavingVoices] = React.useState(false)
  const [voiceError, setVoiceError] = React.useState<string | null>(null)
  const voiceBusy = React.useRef(false)
  async function updateVoices(next: RoleDraft[]) {
    if (!script || voiceBusy.current) return
    voiceBusy.current = true
    setSavingVoices(true)
    setVoiceError(null)
    try {
      const updated = await scriptsApi.save(scriptId, {
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
        title: script.title,
        summary: script.summary,
        roles: next,
        sentences: script.sentences,
      })
      setScript(updated)
      setRoleDialogOpen(false)
    } catch (e) { setVoiceError(e instanceof Error ? e.message : '保存失败，请重试') }
    finally { voiceBusy.current = false; setSavingVoices(false) }
  }
  async function toggleConfirmation() {
    if (!script || voiceBusy.current) return
    voiceBusy.current = true
    setSavingVoices(true)
    setVoiceError(null)
    try {
      const result = await scriptsApi[script.status === 'confirmed' ? 'unconfirm' : 'confirm'](scriptId, { expected_script_version: script.version, expected_edit_revision: script.edit_revision })
      setScript({ ...script, ...result, editable: result.status === 'draft' })
    } catch (e) { setVoiceError(e instanceof Error ? e.message : '操作失败，请重试') }
    finally { voiceBusy.current = false; setSavingVoices(false) }
  }
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
      setScript(s)
      setVersions(sorted)
      setActiveVersionId((cur) => {
        if (cur && sorted.some((v) => v.audio_version_id === cur)) return cur
        const ready = sorted.find((v) => v.status === "ready")
        return ready?.audio_version_id ?? sorted[0]?.audio_version_id ?? null
      })
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [projectId, scriptId])

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
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <AppButton
              variant="ghost"
              size="sm"
              className="-ml-2 shrink-0 gap-1.5 text-muted-foreground"
              onClick={() => onNavigate(`/projects/${projectId}`)}
            >
              <ArrowLeft />
              返回项目
            </AppButton>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <Headphones className="size-[18px]" />
            </span>
            <h1 className="shrink-0 text-xl font-semibold tracking-tight text-foreground">
              音频生成
            </h1>
            <span aria-hidden="true" className="text-muted-foreground/30">/</span>
            <button
              type="button"
              onClick={() => onNavigate(`/projects/${projectId}/scripts/${scriptId}`)}
              title={script.title}
              className="max-w-full truncate rounded-md text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:max-w-sm"
            >
              {script.title}
            </button>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20">
              V{script.version}
            </span>
            {isConfirmed ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400" />
                已确认
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-medium text-amber-400">
                <span className="size-1.5 rounded-full bg-amber-400" />
                未确认
              </span>
            )}
          </div>
        </div>

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
        <div className={cn("grid items-start gap-4", sorted.length > 0 && "lg:grid-cols-2")}>
          <VoiceConfigCard
            script={script}
            isConfirmed={isConfirmed}
            saving={savingVoices}
            error={voiceError}
            onEdit={() => {
              setVoiceError(null)
              setRoleDialogOpen(true)
            }}
            onToggleConfirmation={toggleConfirmation}
          />
          {sorted.length > 0 && (
            <VersionList
              versions={sorted}
              activeId={activeVersionId}
              onSelect={setActiveVersionId}
            />
          )}
        </div>
        {roleDialogOpen && (
          <fieldset disabled={savingVoices}>
            <RoleVoiceEditorDialog
              roles={script.roles}
              onClose={() => {
                if (!voiceBusy.current) setRoleDialogOpen(false)
              }}
              onApply={updateVoices}
            />
            {voiceError && (
              <p
                role="alert"
                className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive shadow-lg"
              >
                {voiceError}
              </p>
            )}
          </fieldset>
        )}

        {/* 主体：要么生成，要么查看详情 */}
        {active ? (
          <AudioVersionView
            key={`${active.audio_version_id}:${script.edit_revision}`}
            version={active}
            projectId={projectId}
            onRefreshList={refreshVersions}
            onNavigate={onNavigate}
          />
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

function VoiceConfigCard({
  script,
  isConfirmed,
  saving,
  error,
  onEdit,
  onToggleConfirmation,
}: {
  script: ScriptDetail
  isConfirmed: boolean
  saving: boolean
  error: string | null
  onEdit: () => void
  onToggleConfirmation: () => void
}) {
  return (
    <AppCard>
      <AppCardContent className="space-y-4 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Mic className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">角色声音配置</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              修改声音前需取消确认；保存后重新确认，再试听或生成音频。已有音频保留生成时的配置。
            </p>
          </div>
        </div>

        <ul className="grid gap-2 sm:grid-cols-2">
          {script.roles.map((role, i) => (
            <li
              key={role.role_id}
              className="flex items-center gap-2.5 rounded-lg border border-border bg-secondary/20 px-3 py-2"
            >
              <RoleAvatar name={role.name} toneIndex={i} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{role.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {role.voice_config.voice_id} · x{role.voice_config.speed}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <AppButton
            size="sm"
            variant="outline"
            disabled={saving || !script.roles.length || !script.editable || isConfirmed}
            onClick={onEdit}
          >
            <SlidersHorizontal />
            编辑角色声音
          </AppButton>
          <AppButton
            size="sm"
            variant={isConfirmed ? "secondary" : "primary"}
            disabled={saving}
            onClick={onToggleConfirmation}
          >
            {saving && <Loader2 className="animate-spin" />}
            {isConfirmed ? "取消确认以编辑声音" : "确认脚本"}
          </AppButton>
        </div>

        {error && <InlineError>{error}</InlineError>}
      </AppCardContent>
    </AppCard>
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
    <AppCard className="flex flex-col overflow-hidden">
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
                <AudioStatusBadge status={v.status} />
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
    </AppCard>
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
            <audio src={previewPlayUrl} controls className="w-full" />
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
  version: AudioVersionListItem
  projectId: string
  onRefreshList: () => void
  onNavigate: (href: string) => void
}

function AudioVersionView({
  version,
  projectId,
  onRefreshList,
  onNavigate,
}: AudioVersionViewProps) {
  const [detail, setDetail] = React.useState<AudioVersionDetail | null>(null)
  const [sentences, setSentences] = React.useState<AudioSentencesResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeSentenceId, setActiveSentenceId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [d, s] = await Promise.all([
        audioApi.versionDetail(version.audio_version_id),
        audioApi.sentences(version.audio_version_id),
      ])
      setDetail(d)
      setSentences(s)
      setActiveSentenceId((cur) => cur ?? s.sentences[0]?.audio_sentence_id ?? null)
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

  if (loading) return <AudioDetailSkeleton />
  if (error || !detail || !sentences) {
    return (
      <ErrorBlock
        title="加载音频失败"
        message={error ?? "未知错误"}
        onBack={() => onNavigate(`/projects/${projectId}`)}
      />
    )
  }

  const canDownload = detail.status === "ready" && !!detail.current_asset_id
  const activeSentence =
    sentences.sentences.find((s) => s.audio_sentence_id === activeSentenceId) ?? null

  return (
    <div className="space-y-4">
      {/* Header + full audio */}
      <AppCard>
        <AppCardContent className="p-6">
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
              <AudioStatusBadge status={detail.status} />
              <span className="font-mono text-xs text-muted-foreground">
                selection r{detail.selection_revision}
              </span>
            </div>
          </div>

          {detail.status === "ready" && detail.play_url && (
            <>
              <div className="mt-5">
                <AudioPlayer src={detail.play_url} />
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
              </div>
              {detail.source_script_changed && (
                <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-400">
                  <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                  脚本内容此后有更新，不影响本次已生成的音频。
                </p>
              )}
            </>
          )}

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
              onRetried={load}
            />
          )}
        </AppCardContent>
      </AppCard>

      {/* Two-column: sentence list + active sentence panel */}
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr] lg:items-start">
        <SentenceList
          sentences={sentences}
          activeId={activeSentenceId}
          onSelect={setActiveSentenceId}
        />
        {activeSentence ? (
          <SentencePanel
            key={activeSentence.audio_sentence_id}
            sentence={activeSentence}
            revision={sentences.selection_revision}
            onChanged={() => {
              void load()
              onRefreshList()
            }}
          />
        ) : (
          <AppCard>
            <AppCardContent className="p-6 text-sm text-muted-foreground">
              该音频版本没有可用的句段。
            </AppCardContent>
          </AppCard>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Sentence list (A-05)
// ============================================================

function SentenceList({
  sentences,
  activeId,
  onSelect,
}: {
  sentences: AudioSentencesResponse
  activeId: string | null
  onSelect: (id: string) => void
}) {
  const toneIndexOf = useRoleToneIndex()
  const total = sentences.total_sentences
  const pct = total > 0 ? Math.round((sentences.completed_sentences / total) * 100) : 0

  return (
    <AppCard className="flex flex-col overflow-hidden">
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">逐句</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {sentences.completed_sentences}/{sentences.total_sentences} 完成
            {sentences.failed_sentences > 0 && (
              <span className="ml-1 text-destructive">
                · {sentences.failed_sentences} 失败
              </span>
            )}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <ul className="max-h-[560px] flex-1 space-y-1 overflow-y-auto overscroll-contain p-2">
        {sentences.sentences.map((s) => {
          const active = s.audio_sentence_id === activeId
          const tone = toneIndexOf(s.role.name)
          return (
            <li key={s.audio_sentence_id}>
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelect(s.audio_sentence_id)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-primary/40 bg-primary/5"
                    : "border-transparent hover:bg-accent/40",
                )}
              >
                <RoleAvatar name={s.role.name} toneIndex={tone} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="font-mono tabular-nums">#{s.sequence}</span>
                    <span className={cn("truncate font-medium", roleTone(tone).text)}>
                      {s.role.name}
                    </span>
                    {s.has_ready_candidates && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
                        <ThumbsUp className="size-2.5" />
                        候选
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed">{s.text}</p>
                </div>
                <div className="shrink-0 pt-0.5">
                  <AudioStatusBadge status={s.status} />
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </AppCard>
  )
}

// ============================================================
// Sentence detail panel: per-sentence listening (A-09) +
// regenerate candidate (A-06) + candidate list/decision (A-07/A-08)
// ============================================================

function SentencePanel({
  sentence,
  revision,
  onChanged,
}: {
  sentence: AudioSentenceItem
  revision: number
  onChanged: () => void
}) {
  const [regenerating, setRegenerating] = React.useState(false)
  const [regenError, setRegenError] = React.useState<string | null>(null)
  const [candidates, setCandidates] = React.useState<CandidateItem[] | null>(null)
  const [loadingCandidates, setLoadingCandidates] = React.useState(false)
  const [candidateError, setCandidateError] = React.useState<string | null>(null)
  const [decidingId, setDecidingId] = React.useState<string | null>(null)
  const [decisionError, setDecisionError] = React.useState<string | null>(null)
  const operationBusy = React.useRef(false)

  const loadCandidates = React.useCallback(async () => {
    setLoadingCandidates(true)
    setCandidateError(null)
    try {
      const res = await audioApi.candidates(sentence.audio_sentence_id, {
        page: 1,
        page_size: 20,
      })
      setCandidates(res.items)
    } catch (e) {
      setCandidateError(e instanceof ApiError ? e.message : "加载候选失败")
    } finally {
      setLoadingCandidates(false)
    }
  }, [sentence.audio_sentence_id])

  React.useEffect(() => {
    void loadCandidates()
  }, [loadCandidates, revision])

  const handleRegenerate = async () => {
    if (operationBusy.current) return
    operationBusy.current = true
    setRegenerating(true)
    setRegenError(null)
    try {
      const accepted: TaskAccepted = await audioApi.regenerateSentence(
        sentence.audio_sentence_id,
        { expected_selection_revision: revision },
        newIdempotencyKey(),
      )
      const task = await pollTask(accepted.task_id)
      if (task.status === 'failed') throw new Error(task.error_message ?? '候选生成失败')
      await loadCandidates()
      onChanged()
    } catch (e) {
      if (isAbort(e)) return
      setRegenError(e instanceof ApiError ? `${e.code}: ${e.message}` : "重生成失败")
    } finally {
      operationBusy.current = false
      setRegenerating(false)
    }
  }

  const handleDecision = async (
    candidateId: string,
    choice: "use_candidate" | "keep_original",
  ) => {
    if (operationBusy.current) return
    operationBusy.current = true
    setDecidingId(candidateId)
    setDecisionError(null)
    try {
      const res = await audioApi.decide(
        candidateId,
        { choice, expected_selection_revision: revision },
        newIdempotencyKey(),
      )
      // 采用候选会产生合并任务 (202)；轮询直到完成
      const asAccepted = res as TaskAccepted
      if (asAccepted && typeof asAccepted.task_id === "string") {
        const task = await pollTask(asAccepted.task_id)
        if (task.status === 'failed') throw new Error(task.error_message ?? '采用候选失败，音频合并未完成')
      }
      // keep_original / 已采用幂等 (200) 直接结束
      void (res as KeepOriginalResponse | UseCandidateCurrentResponse)
      await loadCandidates()
      onChanged()
    } catch (e) {
      if (isAbort(e)) return
      setDecisionError(e instanceof Error ? e.message : "操作失败")
      if (e instanceof ApiError && e.status === 409) { await loadCandidates(); onChanged() }
    } finally {
      operationBusy.current = false
      setDecidingId(null)
    }
  }

  const currentPlay = sentence.play_url
  const toneIndexOf = useRoleToneIndex()
  const tone = toneIndexOf(sentence.role.name)

  return (
    <AppCard>
      <AppCardContent className="space-y-5 p-6">
        {/* 当前片段：按句试听 */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <RoleAvatar name={sentence.role.name} toneIndex={tone} />
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-sm font-semibold", roleTone(tone).text)}>
                  {sentence.role.name}
                </span>
                <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[11px]">
                  #{sentence.sequence}
                </span>
                <AudioStatusBadge status={sentence.status} />
              </div>
            </div>
            <span
              className="max-w-full truncate rounded-md bg-secondary/50 px-2 py-1 text-[11px] text-muted-foreground"
              title={formatParams(sentence.current_params)}
            >
              当前参数：{formatParams(sentence.current_params)}
            </span>
          </div>
          <p className="mt-4 whitespace-pre-wrap border-l-2 border-primary/40 pl-4 text-sm leading-relaxed">
            {sentence.text}
          </p>
        </div>

        {sentence.error_message && (
          <InlineError>生成错误：{sentence.error_message}</InlineError>
        )}

        {currentPlay ? (
          <div className="rounded-xl border border-border bg-secondary/30 p-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">当前片段试听</p>
            <audio src={currentPlay} controls className="w-full" />
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
            当前片段尚未就绪{sentence.status === "failed" ? "（可重试整篇音频或重生成此句）" : ""}
          </p>
        )}

        <div className="space-y-3 border-t border-border pt-5">
          <div className="flex flex-wrap gap-2">
            <AppButton
              size="sm"
              variant="outline"
              onClick={handleRegenerate}
              disabled={regenerating || decidingId !== null}
            >
              {regenerating ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              重新生成此句候选
            </AppButton>
            <AppButton
              size="sm"
              variant="ghost"
              onClick={() => void loadCandidates()}
              disabled={loadingCandidates}
            >
              {loadingCandidates ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              刷新候选
            </AppButton>
          </div>
          {regenError && <InlineError>{regenError}</InlineError>}
          {candidateError && <InlineError>{candidateError}</InlineError>}
          {decisionError && <InlineError>{decisionError}</InlineError>}

          {/* 候选列表 */}
          {candidates && candidates.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-medium text-muted-foreground">
                候选片段（{candidates.length}）
              </p>
              {candidates.map((c) => (
                <CandidateRow
                  key={c.candidate_id}
                  candidate={c}
                  deciding={decidingId === c.candidate_id}
                  disabled={regenerating || decidingId !== null}
                  onDecision={(choice) => handleDecision(c.candidate_id, choice)}
                />
              ))}
            </div>
          )}

          {candidates && candidates.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
              还没有候选。点击"重新生成此句候选"后会出现可试听的候选片段。
            </p>
          )}
        </div>
      </AppCardContent>
    </AppCard>
  )
}

// ============================================================
// Candidate row
// ============================================================

function CandidateRow({
  candidate,
  deciding,
  disabled,
  onDecision,
}: {
  candidate: CandidateItem
  deciding: boolean
  disabled: boolean
  onDecision: (choice: "use_candidate" | "keep_original") => void
}) {
  const actionable =
    candidate.status === "ready" && !candidate.is_stale && !candidate.is_current
  return (
    <div
      className={cn(
        "rounded-xl border bg-card px-4 py-3 text-sm",
        candidate.is_current ? "border-emerald-500/30" : "border-border",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <AudioStatusBadge status={candidate.status as AudioLikeStatus} />
          {candidate.is_current && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              当前使用
            </span>
          )}
          {candidate.is_stale && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-400">
              基准已变化
            </span>
          )}
          {candidate.duration_ms != null && (
            <span className="tabular-nums text-muted-foreground">
              {formatMs(candidate.duration_ms)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          {new Date(candidate.created_at).toLocaleString("zh-CN")}
        </span>
      </div>

      {candidate.play_url ? (
        <audio src={candidate.play_url} controls className="mt-3 w-full" />
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">候选尚未生成可播放片段</p>
      )}

      {actionable && (
        <div className="mt-3 flex gap-2">
          <AppButton size="sm" onClick={() => onDecision("use_candidate")} disabled={disabled}>
            {deciding ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            {deciding ? '正在处理…' : '采用此候选'}
          </AppButton>
          <AppButton
            size="sm"
            variant="ghost"
            onClick={() => onDecision("keep_original")}
            disabled={disabled}
          >
            保留原片段
          </AppButton>
        </div>
      )}
    </div>
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
// Audio player
// ============================================================

const PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75]

const rangeThumb =
  "[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-0 [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-[0_0_10px_hsl(var(--primary))] " +
  "[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary"

/** 已播放部分填充主题色的进度条背景 */
const fillStyle = (pct: number): React.CSSProperties => ({
  background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--border)) ${pct}%)`,
})

function AudioPlayer({ src }: { src: string }) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(1)
  const [rate, setRate] = React.useState(1)

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) el.pause()
    else void el.play()
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current
    if (!el) return
    const time = Number(e.target.value)
    el.currentTime = time
    setCurrentTime(time)
  }

  const cycleRate = () => {
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length]
    setRate(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  const progress = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0

  return (
    <div className="rounded-2xl border border-border bg-gradient-to-br from-secondary/50 to-secondary/20 p-4 sm:p-5">
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onVolumeChange={(e) => setVolume(e.currentTarget.volume)}
      />
      <div className="flex items-center gap-4">
        <AppButton
          size="icon"
          variant="primary"
          className="size-12 shrink-0 rounded-full"
          onClick={togglePlay}
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? <Pause className="size-5" /> : <Play className="size-5 translate-x-0.5" />}
        </AppButton>

        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            aria-label="播放进度"
            style={fillStyle(progress)}
            className={cn(
              "h-1.5 w-full cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              rangeThumb,
            )}
          />
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatSec(currentTime)}</span>
            <span>{formatSec(duration)}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={cycleRate}
          aria-label={`播放速度 ${rate}x，点击切换`}
          className="hidden h-8 min-w-12 shrink-0 rounded-md border border-border px-2 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:block"
        >
          {rate}x
        </button>

        <div className="hidden items-center gap-2 sm:flex">
          <Volume2 className="size-4 text-muted-foreground" />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => {
              const el = audioRef.current
              if (el) el.volume = Number(e.target.value)
            }}
            aria-label="音量"
            style={fillStyle(volume * 100)}
            className={cn(
              "h-1.5 w-20 cursor-pointer appearance-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
              rangeThumb,
            )}
          />
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

function AudioDetailSkeleton() {
  return (
    <div role="status" aria-label="正在加载音频" className="space-y-4">
      <div className="h-48 animate-pulse rounded-xl border border-border bg-card" />
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]">
        <div className="h-80 animate-pulse rounded-xl border border-border bg-card" />
        <div className="h-80 animate-pulse rounded-xl border border-border bg-card" />
      </div>
    </div>
  )
}

function ErrorBlock({
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
function InlineError({
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

function isAbort(e: unknown): boolean {
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

function formatMs(ms: number): string {
  return formatSec(ms / 1000)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) return "默认参数"
  return entries
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
}


/** 生成下载文件名：优先使用脚本快照中的 title，回退到"播客音频" */
export function buildAudioFileName(snapshot: unknown, version: number): string {
  const snap = (snapshot ?? {}) as Record<string, unknown>
  const raw =
    (typeof snap.title === "string" && snap.title) ||
    (typeof snap.script_title === "string" && snap.script_title) ||
    "播客音频"
  const safe = raw.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "播客音频"
  return `${safe}_音频V${version}.mp3`
}
