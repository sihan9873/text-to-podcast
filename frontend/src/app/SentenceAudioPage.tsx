// src/pages/SentenceAudioPage.tsx
import * as React from "react"
import { StatusBadge } from "@/components/common/StatusBadge"
import { isAbort, InlineError, RoleToneContext, useRoleToneIndex, formatMs, AudioDetailSkeleton, ErrorBlock, AudioRoleSettings } from "./Audio"
import { ArrowLeft, ChevronDown, FileAudio, Loader2, RefreshCw, RotateCcw, ThumbsUp, CheckCircle2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppMp3Player } from "@/components/common/AppMp3Player"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { RoleAvatar, roleTone } from "@/components/common/RoleAvatar"

import { ApiError, newIdempotencyKey, audioApi, scriptsApi, pollTask } from "@/api"
import type {
  AudioSentencesResponse,
  AudioSentenceItem,
  AudioVersionDetail,
  CandidateItem,
  KeepOriginalResponse,
  UseCandidateCurrentResponse,
  TaskAccepted,
} from "@/api"

export interface SentenceAudioPageProps {
  projectId: string
  scriptId: string
  versionId: string          // 从路由取，替代原 activeVersionId
  onNavigate: (href: string) => void
}

export default function SentenceAudioPage({
  projectId,
  scriptId,
  versionId,
  onNavigate,
}: SentenceAudioPageProps) {
  const [version, setVersion] = React.useState<AudioVersionDetail | null>(null)
  const [scriptConfirmed, setScriptConfirmed] = React.useState(false)
  const [sentences, setSentences] = React.useState<AudioSentencesResponse | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeSentenceId, setActiveSentenceId] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 版本详情用于拿到角色顺序（配色）与状态轮询
      const [d, s, script] = await Promise.all([
        audioApi.versionDetail(versionId),
        audioApi.sentences(versionId),
        scriptsApi.detail(scriptId),
      ])
      setVersion(d)
      setScriptConfirmed(script.status === "confirmed")
      setSentences(s)
      setActiveSentenceId((cur) => cur ?? s.sentences[0]?.audio_sentence_id ?? null)
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "加载句段失败")
    } finally {
      setLoading(false)
    }
  }, [versionId, scriptId])

  React.useEffect(() => { void load() }, [load])

  // 版本仍在生成时轮询
  React.useEffect(() => {
    if (!version) return
    if (version.status !== "queued" && version.status !== "running") return
    const timer = setInterval(() => void load(), 2000)
    return () => clearInterval(timer)
  }, [version, load])

  if (loading) return <AudioDetailSkeleton />

  if (error || !sentences || !version) {
    return (
      <ErrorBlock
        title="加载句段失败"
        message={error ?? "未知错误"}
        onBack={() => onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio`)}
      />
    )
  }

  const activeSentence =
    sentences.sentences.find((s) => s.audio_sentence_id === activeSentenceId) ?? null

  // 角色配色：按句段里首次出现顺序（无法拿到脚本 roles 顺序时）
  const toneMap = new Map<string, number>()
  for (const s of sentences.sentences) {
    if (!toneMap.has(s.role.name)) toneMap.set(s.role.name, toneMap.size)
  }

  return (
    <RoleToneContext.Provider value={toneMap}>
      <div className="mx-auto flex min-h-full w-full min-w-0 max-w-6xl flex-col space-y-4">
        {/* Header */}
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <AppButton
              variant="ghost"
              size="sm"
              className="-ml-2 shrink-0 gap-1.5 text-muted-foreground"
              onClick={() =>
                onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio`)
              }
            >
              <ArrowLeft />
              返回音频
            </AppButton>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
              <FileAudio className="size-[18px]" />
            </span>
            <h1 className="shrink-0 text-xl font-semibold tracking-tight">逐句试听</h1>
            <span aria-hidden className="text-muted-foreground/30">/</span>
            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20">
              音频 V{version.version}
            </span>
            <StatusBadge status={version.status} />
          </div>
        </div>

        <AppCard>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-6 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              角色声音设定
              <ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <AppCardContent className="px-6 pb-6 pt-0 [&>section]:mt-0 [&>section]:border-t-0 [&>section]:pt-0 [&>section>div>h3]:hidden">
              <AudioRoleSettings detail={version} scriptConfirmed={scriptConfirmed} onNavigate={onNavigate} />
            </AppCardContent>
          </details>
        </AppCard>

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
              onChanged={() => void load()}
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
    </RoleToneContext.Provider>
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
                  <StatusBadge status={s.status} />
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
                <StatusBadge status={sentence.status} />
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
            <AppMp3Player
              tracks={[{ src: currentPlay, title: sentence.text, artist: sentence.role.name }]}
              variant="compact"
            />
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
          <StatusBadge status={candidate.status} />
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
        <AppMp3Player
          tracks={[{ src: candidate.play_url, title: "候选片段试听" }]}
          variant="compact"
          className="mt-3"
        />
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


function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) return "默认参数"
  return entries
    .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ")
}


/** 生成下载文件名：优先使用脚本快照中的 title，回退到"播客音频" */
