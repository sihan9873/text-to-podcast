// src/Script.tsx
import * as React from "react"
import { sentenceMatches, replaceSentenceMatches } from "@/lib/sentenceSearch"
import { GrammarCheck, GrammarHighlights, useGrammarCheck } from "@/components/common/GrammarCheck"
import { GenerationEstimate, EstimateNotes, useGenerationConfirmation } from "@/components/common/GenerationConfirmation"
import { StatusBadge } from "@/components/common/StatusBadge"
import { TextProcessor, LANGUAGE_LABELS, estimateScriptDuration } from '@/lib/textProcessor'
import { RoleVoiceEditorDialog, type RoleDraft } from '@/components/audio/RoleVoiceEditorDialog'

import {
  CaseSensitive, ReplaceAll, Mic, Search, PanelLeftClose, PanelLeftOpen, Save, Undo2, Volume2, X,
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Gauge,
  Languages,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  ScrollText,
  Tag,
  Type,
  type LucideIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard } from "@/components/common/AppCard"
import { RoleAvatar, roleTone } from "@/components/common/RoleAvatar"

import {
  scriptsApi,
  audioApi,
  newIdempotencyKey,
  projectsApi,

  ApiError,
  type ScriptDetail,
  type ScriptSentence,
  type ScriptRole,
  type ProjectDetail,
  type VoiceConfig,

} from "@/api"

const TOOLS = [
  { id: "source", label: "原文", icon: FileText },
  { id: "estimate", label: "估算", icon: Gauge },
  { id: "voices", label: "声音", icon: Mic },
  { id: "search", label: "搜索", icon: Search },
] as const

// ============================================================
// Status badge
// ============================================================

// ============================================================
// UI pieces
// ============================================================

function formatSeconds(total: number) {
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

function PanelHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: LucideIcon
  title: string
  meta?: React.ReactNode
}) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-4" />
        </span>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      <div className="flex items-center gap-2">{meta}</div>
    </div>
  )
}

function ModeChip({ editable, label }: { editable: boolean; label?: string }) {
  const Icon = editable ? Pencil : Lock
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        editable
          ? "bg-primary/10 text-primary"
          : "bg-secondary text-muted-foreground",
      )}
    >
      <Icon className="size-3" />
      {label ?? (editable ? "可编辑" : "只读")}
    </span>
  )
}

function ToolIntro({ children }: { children: React.ReactNode }) {
  return <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

/** 竖向步骤：圆点 + 连接线，内容放在右侧 */
function Step({ n, last, children }: { n: number; last?: boolean; children: React.ReactNode }) {
  return (
    <div className="relative pl-9">
      <span className="absolute left-0 top-0 flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary ring-1 ring-primary/20">
        {n}
      </span>
      {!last && <span aria-hidden className="absolute bottom-0 left-3 top-7 w-px bg-border/70" />}
      <div className={cn(!last && "pb-5")}>{children}</div>
    </div>
  )
}

const TOOL_TITLES = { source: "原文", estimate: "生成估算", voices: "角色声音", search: "搜索与替换" } as const

function StatChip({ icon: Icon, title, children }: { icon: LucideIcon; title?: string; children: React.ReactNode }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground [&:not(:first-child)]:before:mr-1.5 [&:not(:first-child)]:before:text-border [&:not(:first-child)]:before:content-['·']">
      <Icon className="size-3.5 text-primary/70" />
      {children}
    </span>
  )
}

function SaveState({
  saving,
  dirty,
  editable,
}: {
  saving: boolean
  dirty: boolean
  editable: boolean
}) {
  if (saving) {
    return (
      <span
        role="status" aria-live="polite"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        保存中…
      </span>
    )
  }
  if (dirty) {
    return (
      <span
        role="status" aria-live="polite"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400"
      >
        <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />
        有未保存的修改
      </span>
    )
  }
  if (editable) {
    return (
      <span
        role="status" aria-live="polite"
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      >
        <Check className="size-3.5 text-primary" />
        所有修改已保存
      </span>
    )
  }
  return null
}

/** 加载占位：和真实布局同形，避免加载完成时跳动 */
function ScriptSkeleton() {
  return (
    <div
      role="status" aria-live="polite"
      aria-label="正在加载脚本"
      className="mx-auto flex h-full w-full max-w-7xl flex-col gap-4"
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-24 animate-pulse rounded-lg bg-secondary" />
        <div className="h-6 w-56 animate-pulse rounded-md bg-secondary/70" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="min-h-64 animate-pulse rounded-xl border border-border bg-card"
          />
        ))}
      </div>
    </div>
  )
}

// ============================================================
// 可编辑角色草稿（含 name/description/voice_config）
// ============================================================

function toRoleDraft(role: ScriptRole): RoleDraft {
  return {
    role_id: role.role_id,
    role_key: role.role_key,
    name: role.name,
    description: role.description,
    voice_config: { ...role.voice_config },
  }
}

// ============================================================
// Script page
// ============================================================

export interface ScriptPageProps {
  projectId: string
  scriptId: string
  onNavigate: (href: string) => void
}

export default function ScriptPage({
  projectId,
  scriptId,
  onNavigate,
}: ScriptPageProps) {
  const generation = useGenerationConfirmation()
  const audioBusy = React.useRef(false)
  const [generatingAudio, setGeneratingAudio] = React.useState(false)
  const [script, setScript] = React.useState<ScriptDetail | null>(null)
  const [project, setProject] = React.useState<ProjectDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadError, setLoadError] = React.useState<string | null>(null)

  const [notice, setNotice] = React.useState<{ text: string; kind: "error" | "info"; conflict?: boolean } | null>(null)
  const reportError = (error: unknown, fallback: string) => setNotice({
    text: describeError(error, fallback), kind: "error",
    conflict: error instanceof ApiError && error.code === "REVISION_CONFLICT",
  })
  React.useEffect(() => {
    if (notice?.kind !== "info") return
    const timer = window.setTimeout(() => setNotice(null), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])
  const loadSeq = React.useRef(0)
  const [mobilePanel, setMobilePanel] = React.useState("script")
  const [sourceCollapsed, setSourceCollapsed] = React.useState(false)
  const [activeTool, setActiveTool] = React.useState("source")
  const processor = React.useMemo(() => new TextProcessor(), [])
  const generateAudio = async () => {
    if (!script || audioBusy.current || saving || confirming || isDirty) return
    setNotice(null)
    audioBusy.current = true
    setGeneratingAudio(true)
    try {
      if (!await generation.confirm({ kind: "audio", text: script.sentences.map(s => s.text).join("\n"), title: script.title })) return
      const accepted = await audioApi.generate(projectId, {
        script_id: scriptId,
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
      }, newIdempotencyKey())
      const query = accepted.audio_version_id ? `?versionId=${encodeURIComponent(accepted.audio_version_id)}` : ""
      onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio${query}`)
    } catch (e) {
      reportError(e, "生成音频失败")
    } finally {
      audioBusy.current = false
      setGeneratingAudio(false)
    }
  }

  // 本地编辑态
  const [draftSentences, setDraftSentences] = React.useState<
    Record<string, string>
  >({})
  const [draftRoles, setDraftRoles] = React.useState<RoleDraft[]>([])
  const [draftTitle, setDraftTitle] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")
  const [replacement, setReplacement] = React.useState("")
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [replaceNotice, setReplaceNotice] = React.useState("")
  const [draftSummary, setDraftSummary] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [voiceEditorReset, setVoiceEditorReset] = React.useState(0)



  // ---------- 加载 ----------
  const load = React.useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setLoadError(null)
    try {
      const [s, p] = await Promise.all([
        scriptsApi.detail(scriptId),
        projectsApi.detail(projectId),
      ])
      if (seq !== loadSeq.current) return
      setScript(s)
      setNotice(null)
      setProject(p)
      setDraftTitle(s.title)
      setDraftSummary(s.summary ?? "")
      setDraftSentences(
        Object.fromEntries(s.sentences.map((x) => [x.sentence_id, x.text])),
      )
      setDraftRoles(s.roles.map(toRoleDraft))
      setVoiceEditorReset(v => v + 1)
    } catch (e) {
      if (seq !== loadSeq.current) return
      setLoadError(e instanceof ApiError ? e.message : "加载失败")
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [projectId, scriptId])

  React.useEffect(() => {
    void load()
    return () => { loadSeq.current++ }
  }, [load])

  // ---------- 派生状态 ----------
  const isDirty = React.useMemo(() => {
    if (!script) return false
    if (draftTitle !== script.title) return true
    if ((draftSummary || null) !== script.summary) return true
    if (
      script.sentences.some((s) => (draftSentences[s.sentence_id] ?? s.text).trim() !== s.text.trim())
    )
      return true
    if (script.roles.length !== draftRoles.length) return true
    return script.roles.some((orig) => {
      const d = draftRoles.find((r) => r.role_id === orig.role_id)
      if (!d) return true
      if (d.name !== orig.name) return true
      if ((d.description || null) !== orig.description) return true
      return !voiceConfigEqual(d.voice_config, orig.voice_config)
    })
  }, [script, draftTitle, draftSummary, draftSentences, draftRoles])

  const isEditable = script?.editable === true && script.status === "draft"
  const searchResults = React.useMemo(() => {
    let count = 0
    const sentences = (script?.sentences ?? []).filter(sentence => {
      if (!searchQuery) return true
      const matches = sentenceMatches(draftSentences[sentence.sentence_id] ?? sentence.text, searchQuery, caseSensitive)
      count += matches
      return matches > 0
    })
    return { sentences, count }
  }, [script, draftSentences, searchQuery, caseSensitive])
  const replaceAll = () => {
    if (!script || !isEditable || saving || confirming || !searchQuery || !searchResults.count) return
    if (!window.confirm(`将替换 ${searchResults.sentences.length} 句中的 ${searchResults.count} 处匹配，确定？`)) return
    setDraftSentences(previous => {
      const next = { ...previous }
      for (const sentence of script.sentences) {
        next[sentence.sentence_id] = replaceSentenceMatches(previous[sentence.sentence_id] ?? sentence.text, searchQuery, replacement, caseSensitive)
      }
      return next
    })
    setReplaceNotice(`已处理 ${searchResults.sentences.length} 句中的 ${searchResults.count} 处匹配，请保存修改。`)
  }
  const deferredSentences = React.useDeferredValue(draftSentences)
  const deferredRoles = React.useDeferredValue(draftRoles)
  const scriptAnalysis = React.useMemo(() => {
    const sentences = (script?.sentences ?? []).map(sentence => ({
      ...sentence,
      text: deferredSentences[sentence.sentence_id] ?? sentence.text,
    }))
    const text = sentences.map(sentence => sentence.text).join('\n')
    return {
      wordCount: processor.getStats(text).wordCount,
      topic: processor.detectTopic(text),
      language: processor.detectLanguage(text).language,
      durationSeconds: Math.ceil(estimateScriptDuration(sentences, deferredRoles)),
    }
  }, [script, deferredSentences, deferredRoles, processor])

  // 角色 → 配色序号（按角色在草稿中的顺序固定，句子行与角色清单共用）
  const roleToneIndex = React.useMemo(
    () => new Map(deferredRoles.map((r, i) => [r.role_id, i])),
    [deferredRoles],
  )
  const sourceWordCount = React.useMemo(() => {
    const text = project?.source_text?.trim()
    return text ? processor.getStats(text).wordCount : 0
  }, [project, processor])

  // ---------- 保存整份（S-04） ----------
  const handleSave = async () => {
    if (!script || saving || confirming) return
    if (!draftTitle.trim() || script.sentences.some(s => !(draftSentences[s.sentence_id] ?? s.text).trim())) {
      setNotice({ text: "标题和句子不能为空", kind: "error" })
      return
    }
    setNotice(null)
    setSaving(true)
    try {
      const updated = await scriptsApi.save(scriptId, {
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
        title: draftTitle,
        summary: draftSummary.trim() ? draftSummary : null,
        roles: draftRoles.map((r) => ({
          role_id: r.role_id,
          role_key: r.role_key,
          name: r.name,
          description: r.description,
          voice_config: r.voice_config,
        })),
        sentences: script.sentences.map((s) => ({
          sentence_id: s.sentence_id,
          sequence: s.sequence,
          role_id: s.role_id,
          text: (draftSentences[s.sentence_id] ?? s.text).trim(),
          speed: s.speed,
          extra_params: s.extra_params,
        })),
      })
      setScript(updated)
      setDraftTitle(updated.title)
      setDraftSummary(updated.summary ?? "")
      setDraftSentences(
        Object.fromEntries(
          updated.sentences.map((x) => [x.sentence_id, x.text]),
        ),
      )
      setDraftRoles(updated.roles.map(toRoleDraft))
      setVoiceEditorReset(v => v + 1)
    } catch (e) {
      reportError(e, "保存失败")
    } finally {
      setSaving(false)
    }
  }

  const toggleConfirm = async (action: "confirm" | "unconfirm") => {
    if (!script || saving || confirming || generatingAudio || isDirty) return
    setConfirming(true)
    setNotice(null)
    try {
      const res = await scriptsApi[action](scriptId, { expected_script_version: script.version, expected_edit_revision: script.edit_revision })
      setScript(prev => prev && ({ ...prev, status: res.status, editable: res.status === "draft", confirmed_at: res.confirmed_at, confirmed_by: res.confirmed_by, confirmed_revision: res.confirmed_revision }))
    } catch (e) { reportError(e, "更新确认状态失败") }
    finally { setConfirming(false) }
  }

  const handleSentenceChange = React.useCallback((id: string, text: string) => {
    setDraftSentences(prev => ({ ...prev, [id]: text }))
  }, [])
  React.useEffect(() => {
    if (!isDirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", h)
    return () => window.removeEventListener("beforeunload", h)
  }, [isDirty])
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        if (isDirty && !saving && !confirming && isEditable) void handleSave()
      }
    }
    window.addEventListener("keydown", h)
    return () => window.removeEventListener("keydown", h)
  })
  const goBack = () => {
    if (isDirty && !window.confirm("有未保存的修改，确定离开？")) return
    onNavigate(`/projects/${projectId}`)
  }

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ title: draftTitle, summary: draftSummary, roles: draftRoles, sentences: draftSentences }, null, 2))
      setNotice({ text: "草稿已复制，当前修改仍保留", kind: "info" })
    } catch { setNotice({ text: "复制失败，草稿仍保留，请手动复制", kind: "error", conflict: true }) }
  }
const clearSearch = () => { setSearchQuery(""); setReplaceNotice("") }

const jumpToSentence = (id: string) => {
  setMobilePanel("script")
  requestAnimationFrame(() =>
    document.getElementById(`sentence-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
  )
}
  // ---------- 渲染 ----------
  if (loading) return <ScriptSkeleton />

  if (loadError || !script || !project) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <AppCard>
          <div className="flex flex-col items-center p-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
              <AlertTriangle className="size-5" />
            </span>
            <h1 className="mt-5 text-lg font-semibold">无法加载脚本</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loadError ?? "脚本不存在或无权访问"}
            </p>
            <div className="mt-6 flex gap-2">
              <AppButton
                variant="outline"
                size="sm"
                onClick={() => void load()}
              >
                <RefreshCw />
                重试
              </AppButton>
              <AppButton
                size="sm"
                onClick={goBack}
              >
                返回项目
              </AppButton>
            </div>
          </div>
        </AppCard>
      </div>
    )
  }

  const tool = TOOLS.find(t => t.id === activeTool) ?? TOOLS[0]
  const regionFocus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"

const discardDrafts = () => {
  setDraftTitle(script.title)
  setDraftSummary(script.summary ?? "")
  setDraftSentences(Object.fromEntries(script.sentences.map(x => [x.sentence_id, x.text])))
  setDraftRoles(script.roles.map(toRoleDraft))
  setVoiceEditorReset(v => v + 1)
}

const actions = (
  <div className="flex flex-wrap items-center gap-2">
    {isEditable && (
      <>
        <AppButton variant="ghost" size="sm" onClick={discardDrafts} disabled={!isDirty || saving}>
          <Undo2 />放弃
        </AppButton>
        <AppButton size="sm" variant={isDirty ? "primary" : "secondary"} onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? <Loader2 className="animate-spin" /> : <Save />}
          保存
          <kbd className="ml-1 hidden rounded bg-foreground/10 px-1 font-mono text-[10px] md:inline">Ctrl S</kbd>
        </AppButton>
      </>
    )}
    {script.status === "draft" && (
      <AppButton size="sm" variant={isDirty ? "outline" : "primary"}
        onClick={() => void toggleConfirm("confirm")} disabled={confirming || saving || isDirty}
        title={isDirty ? "请先保存修改再确认" : "确认后将锁定脚本，并可生成音频"}>
        {confirming ? <Loader2 className="animate-spin" /> : <Lock />}确认脚本
      </AppButton>
    )}
    {script.status === "confirmed" && (
      <>
        <AppButton size="sm" variant="outline" onClick={() => void toggleConfirm("unconfirm")}
          disabled={confirming || saving || generatingAudio}
          title={script.confirmed_at ? `已于 ${new Date(script.confirmed_at).toLocaleString("zh-CN")} 确认` : undefined}>
          {confirming && <Loader2 className="animate-spin" />}取消确认
        </AppButton>
        <AppButton size="sm" onClick={() => void generateAudio()} disabled={generatingAudio || saving || confirming}>
          {generatingAudio ? <Loader2 className="animate-spin" /> : <Volume2 />}生成音频
        </AppButton>
      </>
    )}
  </div>
)

  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-col gap-4 overflow-hidden">
      {generation.dialog}
<header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
  <div className="flex min-w-0 items-center gap-2">
    <AppButton variant="ghost" size="sm" onClick={goBack} aria-label="返回项目" className="shrink-0 text-muted-foreground">
      <ArrowLeft />
    </AppButton>
    <div className="min-w-0">
      <h1 className="truncate text-lg font-semibold leading-tight tracking-tight" title={script.title}>
        {script.title}
      </h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><ScrollText className="size-3.5" />脚本编辑</span>
        <StatusBadge status={script.status} />
        <span className="font-mono" title="脚本版本 · 编辑修订号">V{script.version} · r{script.edit_revision}</span>
        <span aria-hidden className="text-border">|</span>
        <SaveState saving={saving} dirty={isDirty} editable={isEditable} />
      </div>
    </div>
  </div>
  {actions}
</header>

      <div className="flex shrink-0 gap-2 lg:hidden" aria-label="切换内容">
        {[["source", "原文与工具"], ["script", "脚本"]].map(([id, label]) => <AppButton key={id} variant={mobilePanel === id ? "primary" : "secondary"} aria-pressed={mobilePanel === id} onClick={() => setMobilePanel(id)}>{label}</AppButton>)}
      </div>
      {/* Unified workspace: navigation, source/tools, script editor */}
      <AppCard className={cn(
        "grid min-h-0 min-w-0 flex-1 grid-rows-1 overflow-hidden shadow-sm shadow-black/20",
        mobilePanel === "source" && !sourceCollapsed ? "grid-cols-[4.5rem_minmax(0,1fr)]" : "grid-cols-1",
        sourceCollapsed ? "lg:grid-cols-[4.5rem_minmax(0,1fr)]" : "lg:grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1.2fr)]",
      )}>
        {/* Source workspace and persistent sidebar */}
<aside aria-label="脚本功能" className={cn(
  "min-h-0 min-w-0 flex-col items-stretch gap-1 overflow-y-auto border-r border-border/60 bg-secondary/10 p-2 lg:flex",
  mobilePanel === "source" ? "flex" : "hidden")}>
  <nav aria-label="功能导航" className="flex flex-col gap-1">
    {TOOLS.map(({ id, label, icon: Icon }) => {
      const active = activeTool === id && !sourceCollapsed
      return (
        <button key={id} type="button" aria-pressed={active} title={label}
          onClick={() => { setActiveTool(id); setSourceCollapsed(false) }}
          className={cn(
            "relative flex flex-col items-center gap-1 rounded-xl px-1 py-2.5 text-[11px] font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
          {active && <span aria-hidden className="absolute inset-y-2.5 -left-2 w-0.5 rounded-full bg-primary" />}
          <Icon className="size-[18px]" />
          {label}
          {id === "search" && searchQuery && (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-semibold leading-4 text-primary-foreground">
              {searchResults.sentences.length}
            </span>
          )}
        </button>
      )
    })}
  </nav>
  <button type="button" aria-expanded={!sourceCollapsed} onClick={() => setSourceCollapsed(v => !v)}
    title={sourceCollapsed ? "展开面板" : "收起面板"}
    className="mt-auto hidden items-center justify-center rounded-lg py-2 text-muted-foreground hover:bg-secondary hover:text-foreground lg:flex">
    {sourceCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
  </button>
</aside>
          <div className={cn("min-h-0 min-w-0 flex-col border-r border-border", sourceCollapsed ? "hidden" : mobilePanel === "source" ? "flex" : "hidden lg:flex")}>
            <PanelHeader icon={tool.icon} title={TOOL_TITLES[tool.id]}
              meta={activeTool === "source" ? <span className="text-xs text-muted-foreground">{sourceWordCount.toLocaleString("zh-CN")} 字</span> : undefined}
            />
            <div tabIndex={0} role="region" aria-label="当前功能内容" className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain break-words p-4", regionFocus)}>
              {activeTool === "source" && <>
{project.source_text?.trim() ? (
  <article className="mx-auto max-w-prose space-y-3 text-[15px] leading-8 text-foreground/80">
    {project.source_text.split(/\n+/).filter(Boolean).map((p, i) => (
      <p key={i} className="indent-8">{p}</p>
    ))}
  </article>
) : (
  <div className="flex h-full flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
    <FileText className="size-8 opacity-40" />
    <p className="text-sm">该项目还没有原文</p>
  </div>
)}
              </>}
{activeTool === "estimate" && (
  <div className="space-y-5">
    <ToolIntro>调用模型前，先看看大概要用多少 Token 和多长时间。数据按当前草稿实时计算。</ToolIntro>
    <div className="grid grid-cols-3 gap-2">
      <Metric label="句子数" value={script.sentences.length} />
      <Metric label="脚本字数" value={scriptAnalysis.wordCount.toLocaleString("zh-CN")} />
      <Metric label="预估时长" value={`约 ${formatSeconds(scriptAnalysis.durationSeconds)}`} />
    </div>
    <div>
      <Step n={1}>
        <GenerationEstimate compact kind="script" title="基于原文生成脚本" text={project.source_text ?? ""} />
      </Step>
      <Step n={2} last>
        <GenerationEstimate compact kind="audio" title="基于当前脚本生成音频"
          text={script.sentences.map(s => draftSentences[s.sentence_id] ?? s.text).join("\n")} />
      </Step>
    </div>
    <EstimateNotes />
  </div>
)}
<div hidden={activeTool !== "voices"} className="space-y-4">
  <ToolIntro>为每个角色选择声音、风格和语速。修改先应用到草稿，保存后才会生效。</ToolIntro>
  {!isEditable && (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
      <Lock className="size-3.5 shrink-0" />
      脚本已确认，声音设置为只读。取消确认后可修改。
    </div>
  )}
  <RoleVoiceEditorDialog
    key={voiceEditorReset}
    inline
    disabled={!isEditable || saving || confirming}
    roles={draftRoles}
    applyLabel="应用到草稿"
    onClose={() => setVoiceEditorReset(v => v + 1)}
    onApply={next => {
      setDraftRoles(next)
      setNotice({ text: "角色声音已应用到草稿，请点击右上角“保存”生效", kind: "info" })
    }}
  />
</div>
{activeTool === "search" && (
  <section aria-label="搜索与替换" className="space-y-5">
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={searchQuery}
          onChange={e => { setSearchQuery(e.target.value); setReplaceNotice("") }}
          onKeyDown={e => { if (e.key === "Escape") clearSearch() }}
          placeholder="搜索单词或短语"
          aria-label="搜索句子"
          className={cn(inputClass, "pl-9 pr-[4.5rem] [&::-webkit-search-cancel-button]:hidden")}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          {searchQuery && (
            <button type="button" onClick={clearSearch} aria-label="清除搜索"
              className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <X className="size-3.5" />
            </button>
          )}
          <button type="button" aria-pressed={caseSensitive} title="区分大小写"
            onClick={() => { setCaseSensitive(v => !v); setReplaceNotice("") }}
            className={cn("rounded p-1 transition-colors",
              caseSensitive ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-secondary hover:text-foreground")}>
            <CaseSensitive className="size-4" />
          </button>
        </div>
      </div>

      <p role="status" className="text-xs text-muted-foreground">
        {replaceNotice ? (
          <span className="inline-flex items-center gap-1.5 text-primary"><Check className="size-3.5" />{replaceNotice}</span>
        ) : searchQuery ? (
          searchResults.count
            ? <>共 <b className="font-semibold text-foreground">{searchResults.count}</b> 处匹配，分布在 <b className="font-semibold text-foreground">{searchResults.sentences.length}</b> 句</>
            : "没有找到匹配的句子"
        ) : "按字面匹配句子文本（含单词的一部分），Esc 清除。"}
      </p>
    </div>

    {isEditable ? (
      <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
        <label className="text-xs font-medium text-muted-foreground" htmlFor="replace-input">替换为</label>
        <input id="replace-input" value={replacement}
          onChange={e => { setReplacement(e.target.value); setReplaceNotice("") }}
          placeholder="留空则删除匹配内容" className={inputClass} />
        <AppButton size="sm" className="w-full" disabled={!searchResults.count || saving || confirming} onClick={replaceAll}>
          <ReplaceAll />
          全部替换{searchResults.count ? `（${searchResults.count}）` : ""}
        </AppButton>
        <p className="text-[11px] text-muted-foreground">只作用于草稿，替换后请点击右上角“保存”。</p>
      </div>
    ) : (
      <p className="flex items-center gap-2 rounded-lg bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
        <Lock className="size-3.5" />脚本已确认，仅可搜索，不能替换。
      </p>
    )}

    {searchQuery && searchResults.sentences.length > 0 && (
      <div className="space-y-1.5">
        <h3 className="text-xs font-medium tracking-wider text-muted-foreground/70">匹配的句子</h3>
        <ul className="space-y-1">
          {searchResults.sentences.slice(0, MAX_HITS).map(s => {
            const text = draftSentences[s.sentence_id] ?? s.text
            return (
              <li key={s.sentence_id}>
                <button type="button" onClick={() => jumpToSentence(s.sentence_id)}
                  className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-xs leading-relaxed text-foreground/80 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="mt-px shrink-0 rounded bg-secondary/60 px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">#{s.sequence}</span>
                  <span className="min-w-0 break-words">{highlight(snippet(text, searchQuery, caseSensitive), searchQuery, caseSensitive)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {searchResults.sentences.length > MAX_HITS && (
          <p className="px-2 text-[11px] text-muted-foreground">仅显示前 {MAX_HITS} 句，其余请在右侧脚本中查看。</p>
        )}
      </div>
    )}
  </section>
)}

            </div>
          </div>

        {/* Right: 脚本编辑器 */}
        <div className={cn("min-h-0 min-w-0 flex-col overflow-hidden lg:flex", mobilePanel === "script" ? "flex" : "hidden")}>
          <PanelHeader
            icon={ScrollText}
            title="脚本"
            meta={
              <>
                <ModeChip editable={isEditable} />
                {sourceCollapsed && (
                  <AppButton
                    variant="ghost"
                    size="sm"
                    className="hidden lg:inline-flex"
                    aria-expanded={false}
                    onClick={() => setSourceCollapsed(false)}
                  >
                    <FileText />
                    展开侧栏面板
                  </AppButton>
                )}
              </>
            }
          />

          <div
            role="group"
            aria-label="脚本统计"
            className="flex shrink-0 flex-wrap gap-x-2.5 gap-y-1 border-b border-border px-5 py-2"
          >
            <StatChip
              icon={Type}
              title="中日韩按字符、其他语言按单词计数，不含空白及标点"
            >
              字数 {scriptAnalysis.wordCount.toLocaleString("zh-CN")}
            </StatChip>
            {scriptAnalysis.topic !== "其他" && (
              <StatChip icon={Tag}>主题 {scriptAnalysis.topic}</StatChip>
            )}
            {scriptAnalysis.language !== "unknown" && (
              <StatChip icon={Languages}>
                {LANGUAGE_LABELS[scriptAnalysis.language]}
              </StatChip>
            )}
            <StatChip
              icon={Clock}
              title="按每句语言和有效语速估算，累加所有角色；实际时长以生成音频为准"
            >
              预估时长 约 {formatSeconds(scriptAnalysis.durationSeconds)}
            </StatChip>
            {searchQuery && <div className="flex w-full items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">正在筛选“{searchQuery}”：{searchResults.sentences.length} 句</span>
              <AppButton size="sm" variant="ghost" onClick={() => { setSearchQuery(""); setReplaceNotice("") }}>清除筛选</AppButton>
            </div>}
          </div>

          <div
            tabIndex={0}
            role="region"
            aria-label="脚本内容"
            className={cn(
              "min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain break-words p-5",
              regionFocus,
            )}
          >
            {/* 标题与简介 */}
            {isEditable ? (
<div className="space-y-1">
  <input value={draftTitle} onChange={e => setDraftTitle(e.target.value)} placeholder="脚本标题"
    aria-label="脚本标题" disabled={saving || confirming} aria-invalid={!draftTitle.trim()}
    className={cn(ghostInput, "py-1.5 text-xl font-semibold tracking-tight aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/40")} />
  <textarea value={draftSummary} onChange={e => setDraftSummary(e.target.value)} placeholder="添加简介（可选）"
    aria-label="脚本简介" disabled={saving || confirming} rows={2}
    className={cn(ghostInput, "resize-none py-1 text-sm leading-relaxed text-muted-foreground")} />
</div>
            ) : (
              script.summary && (
                <p className="rounded-lg border border-border bg-secondary/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                  {script.summary}
                </p>
              )
            )}

            <hr className="border-border/60" />
            {/* 句子列表 */}
            <section aria-label="句子" className="-mx-2 space-y-0.5">
              {searchResults.sentences.length === 0 ? (
                <p className="text-sm text-muted-foreground">{searchQuery ? "没有包含该关键词的句子。" : "脚本内容为空。"}</p>
              ) : (
                searchResults.sentences.map((sentence) => (
                  <SentenceRow
                    key={sentence.sentence_id}
                    sentence={sentence}
                    role={draftRoles.find((r) => r.role_id === sentence.role_id)}
                    toneIndex={roleToneIndex.get(sentence.role_id) ?? 0}
                    value={draftSentences[sentence.sentence_id] ?? sentence.text}
                    readOnly={!isEditable || saving || confirming}
                    onChange={handleSentenceChange}
                  />
                ))
              )}
            </section>
          </div>
        </div>
      </AppCard>

{notice && (
  <div role={notice.kind === "error" ? "alert" : "status"}
    className={cn(
      "fixed bottom-6 left-1/2 z-50 flex w-[min(92vw,42rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur",
      "animate-in fade-in slide-in-from-bottom-2",
      notice.kind === "error"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-primary/30 bg-card/90 text-foreground")}>
    {notice.kind === "error" ? <AlertTriangle className="size-4 shrink-0" /> : <Check className="size-4 shrink-0 text-primary" />}
    <span className="min-w-0 flex-1">{notice.text}</span>
    {notice.conflict && (
      <>
        <AppButton size="sm" variant="outline" onClick={() => { if (window.confirm("加载最新将丢弃当前修改，确定继续？")) void load() }}>加载最新</AppButton>
        <AppButton size="sm" variant="outline" onClick={copyDraft}>复制我的修改</AppButton>
      </>
    )}
    <button onClick={() => setNotice(null)} aria-label="关闭" className="rounded p-1 opacity-70 hover:opacity-100">
      <X className="size-4" />
    </button>
  </div>
)}
    </div>
  )
}

// ============================================================
// Sentence row
// ============================================================

const SentenceRow = React.memo(function SentenceRow({
  sentence,
  role,
  toneIndex,
  value,
  readOnly,
  onChange,
}: {
  sentence: ScriptSentence
  role: RoleDraft | undefined
  toneIndex: number
  value: string
  readOnly: boolean
  onChange: (sentenceId: string, text: string) => void
}) {
  const tone = role ? roleTone(toneIndex) : null
  const isEmpty = !readOnly && value.trim().length === 0
  const [edited, setEdited] = React.useState(false)
  const [composing, setComposing] = React.useState(false)
  const grammar = useGrammarCheck(value, readOnly, edited, composing)
  const changeText = (text: string) => {
    setEdited(true)
    onChange(sentence.sentence_id, text)
  }

  const durationSeconds = React.useMemo(
    () => estimateScriptDuration([{ ...sentence, text: value }], role ? [role] : []),
    [sentence, value, role],
  )

  // 文本框随内容自动增高；宽度变化导致换行变化时重新计算
  const ref = React.useRef<HTMLTextAreaElement>(null)
  const resize = React.useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])
  React.useLayoutEffect(resize, [value, resize])
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      resize()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [resize])

  return (
    <div
      id={`sentence-${sentence.sentence_id}`}
      className={cn(
        "group relative scroll-mt-4 flex gap-3 rounded-xl border border-transparent py-3 pl-4 pr-3 transition-colors",
        !readOnly && "hover:border-border hover:bg-accent/20",
        "focus-within:border-primary/40 focus-within:bg-card focus-within:shadow-sm focus-within:ring-1 focus-within:ring-ring/30",
        isEmpty && "border-destructive/40 bg-destructive/5 focus-within:border-destructive/60 focus-within:ring-destructive/30",
      )}
    >
      {/* 角色色条：用 bg-current 继承角色文字色，无需额外的色板字段 */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-3 left-1 w-0.5 rounded-full bg-current opacity-40 transition-opacity",
          "group-focus-within:opacity-100",
          tone?.text ?? "text-muted-foreground",
        )}
      />

      <RoleAvatar name={role?.name} toneIndex={toneIndex} />

      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("text-xs font-semibold", tone?.text ?? "text-muted-foreground")}>
            {role?.name ?? "未知角色"}
          </span>
          <span className="rounded bg-secondary/60 px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground opacity-70 group-focus-within:opacity-100">
            #{sentence.sequence}
          </span>
          {sentence.speed !== null && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-px text-[10px] font-medium text-primary"
              title="本句单独设置的语速，优先于角色默认语速"
            >
              <Gauge className="size-3" />
              {sentence.speed}x
            </span>
          )}
          <span
            className="ml-auto inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground opacity-70 group-focus-within:opacity-100"
            title="按本句语言和有效语速估算，句子语速优先于角色默认语速"
          >
            <Clock className="size-3" />
            约 {durationSeconds.toFixed(1)} 秒
          </span>
        </div>

        <div className="relative">
        <GrammarHighlights text={value} matches={grammar.matches} />
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => changeText(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          spellCheck={false}
          readOnly={readOnly}
          rows={1}
          placeholder={readOnly ? undefined : "输入这一句的内容…"}
          aria-label={`第 ${sentence.sequence} 句`}
          aria-invalid={isEmpty || undefined}
          className={cn(
            "relative block w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-sm leading-relaxed placeholder:text-muted-foreground/50 focus-visible:outline-none",
            readOnly ? "cursor-default text-foreground/85" : "text-foreground",
          )}
        />
        </div>

        <GrammarCheck text={value} disabled={readOnly} {...grammar} onChange={changeText} />

        {/* 仅在编辑且聚焦/出错时显示，避免常驻噪音 */}
        {!readOnly && (
          <div
            className={cn(
              "mt-1 flex h-4 items-center justify-between text-[11px] text-muted-foreground/70 transition-opacity",
              isEmpty ? "opacity-100" : "opacity-0 group-focus-within:opacity-100",
            )}
          >
            <span className={cn(isEmpty && "text-destructive")}>
              {isEmpty ? "句子不能为空" : ""}
            </span>
            <span className="tabular-nums">{value.length} 字</span>
          </div>
        )}
      </div>
    </div>
  )
})
// ============================================================
// Role voice editor dialog
// ============================================================
// Helpers
// ============================================================

function voiceConfigEqual(a: VoiceConfig, b: VoiceConfig): boolean {
  return (
    a.tts_provider === b.tts_provider &&
    a.tts_model === b.tts_model &&
    a.voice_id === b.voice_id &&
    a.style === b.style &&
    a.speed === b.speed &&
    JSON.stringify(a.extra_params ?? {}) ===
      JSON.stringify(b.extra_params ?? {})
  )
}

const inputClass = cn(
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
  "placeholder:text-muted-foreground",
  "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:cursor-not-allowed disabled:opacity-60",
)

function describeError(e: unknown, fallback: string) {
  if (e instanceof ApiError) {
    const messages: Record<string, string> = {
      REVISION_CONFLICT: "脚本已被更新，当前修改已保留",
      SCRIPT_LOCKED: "脚本已锁定，当前修改已保留，请取消确认后再编辑",
      ANOTHER_SCRIPT_CONFIRMED: "该项目已有其他脚本处于确认状态，请先取消确认",
    }
    if (["INVALID_VOICE", "INVALID_AUDIO_PARAMS", "INVALID_ROLE"].includes(e.code)) return `角色声音配置不合法：${e.message}`
    return messages[e.code] ?? e.message
  }
  return e instanceof Error ? e.message : fallback
}

const ghostInput = "w-full rounded-lg bg-transparent px-2 -mx-2 transition-colors placeholder:text-muted-foreground/50 hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"

const MAX_HITS = 50

function snippet(text: string, query: string, cs: boolean) {
  const idx = (cs ? text : text.toLowerCase()).indexOf(cs ? query : query.toLowerCase())
  const start = Math.max(0, idx - 24)
  const end = start + 120
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "")
}

function highlight(text: string, query: string, cs: boolean) {
  if (!query) return text
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, cs ? "g" : "gi")
  return text.split(re).map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">{part}</mark>
      : part,
  )
}
