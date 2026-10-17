// src/Audio.tsx
import * as React from "react"
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
  Clock,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import {
  listAudioVersions,
  getAudioVersion,
} from "@/api/audio"
import {
  createPreview,
  createFullGeneration,
  pollTask,
  retryAudioVersion,
} from "@/api/generation"
import { ApiError, isAborted } from "@/api/request"
import { getScript } from "@/api/scripts"

import type { Project } from "@/types/project"
import type { ScriptVersion } from "@/types/script"
import type { AudioVersion, AudioStatus } from "@/types/audio"
import type { VoiceConfig, VoiceGender, VoiceStyle, SpeechRate } from "@/types/voice"

// ============================================================
// Audio status badge (shared with Project.tsx)
// ============================================================

export function AudioStatusBadge({ status }: { status: AudioStatus }) {
  const config = {
    generating: {
      label: "生成中",
      className: "bg-blue-500/15 text-blue-500",
      icon: Loader2,
    },
    completed: {
      label: "已完成",
      className: "bg-green-500/15 text-green-600 dark:text-green-500",
      icon: CheckCircle2,
    },
    failed: {
      label: "失败",
      className: "bg-red-500/15 text-red-500",
      icon: AlertCircle,
    },
  }
  const { label, className, icon: Icon } = config[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        className
      )}
    >
      <Icon className={cn("size-3", status === "generating" && "animate-spin")} />
      {label}
    </span>
  )
}

// ============================================================
// Audio page
// ============================================================

export interface AudioPageProps {
  project: Project
  scriptVersionId: string
  onNavigate: (href: string) => void
}

export default function AudioPage({
  project,
  scriptVersionId,
  onNavigate,
}: AudioPageProps) {
  const [scriptVersion, setScriptVersion] = React.useState<ScriptVersion | null>(null)
  const [audioVersions, setAudioVersions] = React.useState<AudioVersion[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Current active audio version for detail view
  const [activeAudioId, setActiveAudioId] = React.useState<string | null>(null)
  const [activeAudio, setActiveAudio] = React.useState<AudioVersion | null>(null)
  const [loadingAudio, setLoadingAudio] = React.useState(false)

  // Fetch script version and audio versions
  React.useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [scriptRes, audioRes] = await Promise.all([
          getScript(scriptVersionId, controller.signal),
          listAudioVersions(project.id, { scriptVersionId }, controller.signal),
        ])
        setScriptVersion(scriptRes.scriptVersion)
        setAudioVersions(audioRes.audioVersions)
        // Auto-select the latest audio version
        if (audioRes.audioVersions.length > 0) {
          setActiveAudioId(audioRes.audioVersions[0].id)
        }
      } catch (err) {
        if (isAborted(err)) return
        setError(err instanceof ApiError ? err.message : "加载失败")
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [project.id, scriptVersionId])

  // Fetch active audio detail
  React.useEffect(() => {
    if (!activeAudioId) {
      setActiveAudio(null)
      return
    }
    const controller = new AbortController()
    setLoadingAudio(true)
    getAudioVersion(activeAudioId, controller.signal)
      .then((res) => setActiveAudio(res.audioVersion))
      .catch((err) => {
        if (!isAborted(err)) {
          setError(err instanceof ApiError ? err.message : "加载音频失败")
        }
      })
      .finally(() => setLoadingAudio(false))
    return () => controller.abort()
  }, [activeAudioId])

  // Refresh audio list after generation completes
  const refreshAudioVersions = React.useCallback(async () => {
    try {
      const res = await listAudioVersions(project.id, { scriptVersionId })
      setAudioVersions(res.audioVersions)
      if (res.audioVersions.length > 0) {
        setActiveAudioId(res.audioVersions[0].id)
      }
    } catch {
      // ignore
    }
  }, [project.id, scriptVersionId])

  if (loading) {
    return <AudioPageSkeleton />
  }

  if (error && !scriptVersion) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="size-10 text-destructive" />
        <h1 className="mt-4 text-lg font-semibold">加载失败</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <AppButton
          className="mt-6"
          onClick={() => onNavigate(`/projects/${project.id}`)}
        >
          返回项目
        </AppButton>
      </div>
    )
  }

  if (!scriptVersion) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="size-10 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">脚本版本不存在</h1>
        <AppButton
          className="mt-6"
          onClick={() => onNavigate(`/projects/${project.id}`)}
        >
          返回项目
        </AppButton>
      </div>
    )
  }

  const isScriptConfirmed = scriptVersion.status === "confirmed"

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate(`/projects/${project.id}`)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {project.name}
          </button>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="text-lg font-semibold tracking-tight">
            {scriptVersion.name}
          </h1>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            V{scriptVersion.version}
          </span>
          {isScriptConfirmed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-500">
              <CheckCircle2 className="size-3" />
              已确认
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[11px] font-medium text-yellow-600 dark:text-yellow-500">
              <AlertCircle className="size-3" />
              未确认
            </span>
          )}
        </div>
      </div>

      {/* Not confirmed warning */}
      {!isScriptConfirmed && (
        <AppCard variant="accent">
          <AppCardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">脚本尚未确认</p>
              <p className="mt-1 text-xs text-muted-foreground">
                只有已确认的脚本版本才能生成音频。请先确认脚本后再进行音频生成。
              </p>
              <AppButton
                size="sm"
                className="mt-3"
                onClick={() =>
                  onNavigate(
                    `/projects/${project.id}/scripts/${scriptVersionId}`
                  )
                }
              >
                前往确认脚本
              </AppButton>
            </div>
          </AppCardContent>
        </AppCard>
      )}

      {/* Audio versions list */}
      {audioVersions.length > 0 && (
        <AppCard>
          <AppCardContent className="p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">音频版本</h2>
              <span className="text-xs text-muted-foreground">
                {audioVersions.length} 个版本
              </span>
            </div>
            <div className="mt-4 space-y-2">
              {audioVersions.map((audio) => (
                <button
                  key={audio.id}
                  onClick={() => setActiveAudioId(audio.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors",
                    activeAudioId === audio.id
                      ? "border-primary/50 bg-primary/5"
                      : "border-border hover:bg-accent/50"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <FileAudio className="size-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">音频 V{audio.version}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(audio.createdAt).toLocaleString("zh-CN")}
                      </p>
                    </div>
                  </div>
                  <AudioStatusBadge status={audio.status} />
                </button>
              ))}
            </div>
          </AppCardContent>
        </AppCard>
      )}

      {/* Active audio detail or generate config */}
      {activeAudio ? (
        <AudioDetail
          audio={activeAudio}
          loading={loadingAudio}
          onRefresh={refreshAudioVersions}
          scriptVersion={scriptVersion}
        />
      ) : (
        <AudioGenerateConfig
          project={project}
          scriptVersion={scriptVersion}
          confirmed={isScriptConfirmed}
          onGenerated={refreshAudioVersions}
        />
      )}
    </div>
  )
}

// ============================================================
// Audio detail (player + download + retry)
// ============================================================

interface AudioDetailProps {
  audio: AudioVersion
  loading: boolean
  onRefresh: () => void
  scriptVersion: ScriptVersion
}

function AudioDetail({
  audio,
  loading,
  onRefresh,
  scriptVersion,
}: AudioDetailProps) {
  const [retrying, setRetrying] = React.useState(false)
  const [retryError, setRetryError] = React.useState<string | null>(null)

  const handleRetry = async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      await retryAudioVersion(audio.id)
      onRefresh()
    } catch (err) {
      if (!isAborted(err)) {
        setRetryError(err instanceof ApiError ? err.message : "重试失败")
      }
    } finally {
      setRetrying(false)
    }
  }

  const handleDownload = () => {
    if (!audio.audioUrl) return
    const a = document.createElement("a")
    a.href = audio.audioUrl
    a.download = buildAudioFileName(scriptVersion.name, audio.id)
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  if (loading) {
    return <AudioDetailSkeleton />
  }

  return (
    <AppCard>
      <AppCardContent className="p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">音频 V{audio.version}</h2>
          <AudioStatusBadge status={audio.status} />
        </div>

        {/* Generating state */}
        {audio.status === "generating" && (
          <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
            <Loader2 className="size-10 animate-spin text-primary" />
            <p className="mt-4 text-sm font-medium">音频生成中…</p>
            <p className="mt-1 text-xs text-muted-foreground">
              生成完成后会自动刷新，请稍候
            </p>
            <AppButton
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={onRefresh}
            >
              <RefreshCw />
              刷新状态
            </AppButton>
          </div>
        )}

        {/* Completed state */}
        {audio.status === "completed" && audio.audioUrl && (
          <div className="mt-6 space-y-4">
            <AudioPlayer src={audio.audioUrl} />
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {audio.durationSeconds && (
                <span className="flex items-center gap-1">
                  <Clock className="size-3" />
                  {formatDuration(audio.durationSeconds)}
                </span>
              )}
              {audio.fileSizeBytes && (
                <span>{formatFileSize(audio.fileSizeBytes)}</span>
              )}
              <span>基于脚本 V{scriptVersion.version}</span>
            </div>
            <div className="flex flex-wrap gap-3">
              <AppButton onClick={handleDownload}>
                <Download />
                下载 MP3
              </AppButton>
            </div>
          </div>
        )}

        {/* Failed state */}
        {audio.status === "failed" && (
          <div className="mt-6 flex flex-col items-center justify-center py-12 text-center">
            <AlertCircle className="size-10 text-destructive" />
            <p className="mt-4 text-sm font-medium">音频生成失败</p>
            <p className="mt-1 text-xs text-muted-foreground">
              请重试生成，旧的失败记录会保留
            </p>
            {retryError && (
              <p className="mt-2 text-xs text-destructive">{retryError}</p>
            )}
            <AppButton
              className="mt-4"
              onClick={handleRetry}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="animate-spin" />
              ) : (
                <RefreshCw />
              )}
              重试生成
            </AppButton>
          </div>
        )}
      </AppCardContent>
    </AppCard>
  )
}

// ============================================================
// Audio player
// ============================================================

function AudioPlayer({ src }: { src: string }) {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const [currentTime, setCurrentTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [volume, setVolume] = React.useState(1)

  const togglePlay = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
    } else {
      el.play()
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current
    if (!el) return
    const time = Number(e.target.value)
    el.currentTime = time
    setCurrentTime(time)
  }

  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-4">
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
          {playing ? (
            <Pause className="size-5" />
          ) : (
            <Play className="size-5 translate-x-0.5" />
          )}
        </AppButton>

        <div className="flex-1 space-y-1">
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-primary"
          />
          <div className="flex justify-between text-[11px] tabular-nums text-muted-foreground">
            <span>{formatDuration(currentTime)}</span>
            <span>{formatDuration(duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
            className="h-1.5 w-20 cursor-pointer appearance-none rounded-full bg-border accent-primary"
          />
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Audio generate config (voice config + preview + full)
// ============================================================

interface AudioGenerateConfigProps {
  project: Project
  scriptVersion: ScriptVersion
  confirmed: boolean
  onGenerated: () => void
}

function AudioGenerateConfig({
  project,
  scriptVersion,
  confirmed,
  onGenerated,
}: AudioGenerateConfigProps) {
  const [voiceConfig, setVoiceConfig] = React.useState<VoiceConfig>({
    gender: "female",
    style: "lively",
    rate: "normal",
  })

  // Preview state
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)

  // Full generation state
  const [fullLoading, setFullLoading] = React.useState(false)
  const [fullError, setFullError] = React.useState<string | null>(null)
  const [fullTaskId, setFullTaskId] = React.useState<string | null>(null)

  const abortRef = React.useRef<AbortController | null>(null)

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  // Reset preview when config changes
  React.useEffect(() => {
    setPreviewUrl(null)
    setPreviewError(null)
  }, [voiceConfig.gender, voiceConfig.style, voiceConfig.rate])

  const handlePreview = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewUrl(null)

    try {
      const { task } = await createPreview(
        {
          projectId: project.id,
          scriptVersionId: scriptVersion.id,
          voiceConfig,
        },
        controller.signal
      )
      const completed = await pollTask(task.id, {
        signal: controller.signal,
      })

      if (completed.previewAudioUrl) {
        setPreviewUrl(completed.previewAudioUrl)
      } else {
        setPreviewError("试听完成但未返回音频地址")
      }
    } catch (err) {
      if (isAborted(err)) return
      setPreviewError(err instanceof ApiError ? err.message : "试听失败")
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleGenerateFull = async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setFullLoading(true)
    setFullError(null)

    try {
      const { task } = await createFullGeneration(
        {
          projectId: project.id,
          scriptVersionId: scriptVersion.id,
          voiceConfig,
        },
        controller.signal
      )
      setFullTaskId(task.id)

      await pollTask(task.id, {
        signal: controller.signal,
        onTick: () => {},
      })

      onGenerated()
    } catch (err) {
      if (isAborted(err)) return
      setFullError(err instanceof ApiError ? err.message : "全文生成失败")
    } finally {
      setFullLoading(false)
      setFullTaskId(null)
    }
  }

  const isGenerating = previewLoading || fullLoading

  return (
    <div className="space-y-4">
      {/* Voice config */}
      <AppCard>
        <AppCardContent className="p-6">
          <div className="flex items-center gap-2">
            <Mic className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">声音配置</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            选择声音参数后，先试听短片段，确认效果后再生成全文音频。
          </p>

          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <ConfigSelect
              label="性别"
              value={voiceConfig.gender}
              onChange={(v) =>
                setVoiceConfig((c) => ({ ...c, gender: v as VoiceGender }))
              }
              options={[
                { value: "female", label: "女声" },
                { value: "male", label: "男声" },
              ]}
              disabled={isGenerating}
            />
            <ConfigSelect
              label="风格"
              value={voiceConfig.style}
              onChange={(v) =>
                setVoiceConfig((c) => ({ ...c, style: v as VoiceStyle }))
              }
              options={[
                { value: "lively", label: "活泼" },
                { value: "calm", label: "沉稳" },
              ]}
              disabled={isGenerating}
            />
            <ConfigSelect
              label="语速"
              value={voiceConfig.rate}
              onChange={(v) =>
                setVoiceConfig((c) => ({ ...c, rate: v as SpeechRate }))
              }
              options={[
                { value: "slow", label: "慢速" },
                { value: "normal", label: "正常" },
                { value: "fast", label: "快速" },
              ]}
              disabled={isGenerating}
            />
          </div>

          {!confirmed && (
            <p className="mt-4 text-xs text-muted-foreground">
              脚本未确认，无法试听或生成音频。
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <AppButton
              onClick={handlePreview}
              disabled={!confirmed || isGenerating}
            >
              {previewLoading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Play />
              )}
              试听短片段
            </AppButton>
          </div>

          {previewError && (
            <p className="mt-3 text-xs text-destructive">{previewError}</p>
          )}
        </AppCardContent>
      </AppCard>

      {/* Preview result */}
      {previewUrl && (
        <AppCard variant="accent">
          <AppCardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="size-5 text-primary" />
                <h2 className="text-lg font-semibold">试听片段</h2>
              </div>
              <span className="text-xs text-muted-foreground">
                约前 100 字
              </span>
            </div>
            <div className="mt-4">
              <AudioPlayer src={previewUrl} />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <AppButton
                onClick={handleGenerateFull}
                disabled={isGenerating}
              >
                {fullLoading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <FileAudio />
                )}
                确认生成全文音频
              </AppButton>
              <p className="text-xs text-muted-foreground">
                确认后将基于当前脚本快照和声音配置生成完整音频
              </p>
            </div>
            {fullError && (
              <p className="mt-3 text-xs text-destructive">{fullError}</p>
            )}
            {fullTaskId && (
              <p className="mt-3 text-xs text-muted-foreground">
                任务已创建，正在生成…
              </p>
            )}
          </AppCardContent>
        </AppCard>
      )}
    </div>
  )
}

// ============================================================
// Config select
// ============================================================

function ConfigSelect({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={cn(
          "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm",
          "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// ============================================================
// Skeletons
// ============================================================

function AudioPageSkeleton() {
  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="h-6 w-48 animate-pulse rounded bg-secondary" />
      <AppCard>
        <AppCardContent className="p-6">
          <div className="h-5 w-24 animate-pulse rounded bg-secondary" />
          <div className="mt-4 space-y-3">
            <div className="h-14 animate-pulse rounded-lg bg-secondary" />
            <div className="h-14 animate-pulse rounded-lg bg-secondary" />
          </div>
        </AppCardContent>
      </AppCard>
      <AppCard>
        <AppCardContent className="p-6">
          <div className="h-5 w-24 animate-pulse rounded bg-secondary" />
          <div className="mt-4 grid gap-5 sm:grid-cols-3">
            <div className="h-16 animate-pulse rounded-lg bg-secondary" />
            <div className="h-16 animate-pulse rounded-lg bg-secondary" />
            <div className="h-16 animate-pulse rounded-lg bg-secondary" />
          </div>
        </AppCardContent>
      </AppCard>
    </div>
  )
}

function AudioDetailSkeleton() {
  return (
    <AppCard>
      <AppCardContent className="p-6">
        <div className="h-5 w-24 animate-pulse rounded bg-secondary" />
        <div className="mt-6 h-24 animate-pulse rounded-xl bg-secondary" />
      </AppCardContent>
    </AppCard>
  )
}

// ============================================================
// Helpers
// ============================================================

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00"
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 规范文件名：安全标题_任务编号.mp3
 * 空标题使用"播客音频"。
 */
export function buildAudioFileName(
  title: string,
  taskId: string
): string {
  const safeTitle =
    (title || "播客音频")
      .replace(/[\\/:*?"<>|]/g, "")
      .trim()
      .slice(0, 60) || "播客音频"
  return `${safeTitle}_${taskId}.mp3`
}
