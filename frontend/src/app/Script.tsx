// src/Script.tsx
import * as React from "react"
import { TextProcessor, LANGUAGE_LABELS, estimateScriptDuration } from '@/lib/textProcessor'
import { RoleVoiceEditorDialog } from '@/components/audio/RoleVoiceEditorDialog'

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  FileText,
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
  projectsApi,

  ApiError,
  type ScriptDetail,
  type ScriptSentence,
  type ScriptRole,
  type ProjectDetail,
  type VoiceConfig,

} from "@/api"

// ============================================================
// Status badge
// ============================================================

function StatusBadge({ status }: { status: ScriptDetail["status"] }) {
  const config: Record<
    ScriptDetail["status"],
    { label: string; className: string; dot: string }
  > = {
    draft: {
      label: "草稿",
      className: "bg-muted text-muted-foreground",
      dot: "bg-muted-foreground/60",
    },
    confirmed: {
      label: "已确认",
      className: "bg-emerald-500/15 text-emerald-400",
      dot: "bg-emerald-400",
    },
  }
  const { label, className, dot } = config[status]
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", dot)} />
      {label}
    </span>
  )
}

// ============================================================
// UI pieces
// ============================================================

function formatSeconds(total: number) {
  if (total < 60) return `${total} 秒`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m} 分 ${s} 秒` : `${m} 分钟`
}

function voiceSummary(role: RoleDraft) {
  const v = role.voice_config
  return `${v.tts_provider}/${v.tts_model} · ${v.voice_id}${
    v.style ? ` · ${v.style}` : ""
  } · x${v.speed}`
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

function StatChip({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon
  title?: string
  children: React.ReactNode
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-md bg-secondary/50 px-2 py-1 text-xs text-muted-foreground"
    >
      <Icon className="size-3.5 text-primary/80" />
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
        role="status"
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
        role="status"
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
        role="status"
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
      role="status"
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

interface RoleDraft {
  role_id: string
  role_key: string
  name: string
  description: string | null
  voice_config: VoiceConfig
}

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
  const [script, setScript] = React.useState<ScriptDetail | null>(null)
  const [project, setProject] = React.useState<ProjectDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // 本地编辑态
  const [draftSentences, setDraftSentences] = React.useState<
    Record<string, string>
  >({})
  const [draftRoles, setDraftRoles] = React.useState<RoleDraft[]>([])
  const [draftTitle, setDraftTitle] = React.useState("")
  const [draftSummary, setDraftSummary] = React.useState("")
  const [saving, setSaving] = React.useState(false)
  const [confirming, setConfirming] = React.useState(false)
  const [editingRoleId, setEditingRoleId] = React.useState<string | null>(null)



  // ---------- 加载 ----------
  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, p] = await Promise.all([
        scriptsApi.detail(scriptId),
        projectsApi.detail(projectId),
      ])
      setScript(s)
      setProject(p)
      setDraftTitle(s.title)
      setDraftSummary(s.summary ?? "")
      setDraftSentences(
        Object.fromEntries(s.sentences.map((x) => [x.sentence_id, x.text])),
      )
      setDraftRoles(s.roles.map(toRoleDraft))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "加载失败")
    } finally {
      setLoading(false)
    }
  }, [projectId, scriptId])

  React.useEffect(() => {
    void load()
  }, [load])

  // ---------- 派生状态 ----------
  const isDirty = React.useMemo(() => {
    if (!script) return false
    if (draftTitle !== script.title) return true
    if ((draftSummary || null) !== script.summary) return true
    if (
      script.sentences.some((s) => draftSentences[s.sentence_id] !== s.text)
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
  const scriptAnalysis = React.useMemo(() => {
    const sentences = (script?.sentences ?? []).map(sentence => ({
      ...sentence,
      text: draftSentences[sentence.sentence_id] ?? sentence.text,
    }))
    const text = sentences.map(sentence => sentence.text).join('\n')
    const processor = new TextProcessor()
    return {
      wordCount: processor.getStats(text).wordCount,
      topic: processor.detectTopic(text),
      language: processor.detectLanguage(text).language,
      durationSeconds: Math.ceil(estimateScriptDuration(sentences, draftRoles)),
    }
  }, [script, draftSentences, draftRoles])

  // 角色 → 配色序号（按角色在草稿中的顺序固定，句子行与角色清单共用）
  const roleToneIndex = React.useMemo(
    () => new Map(draftRoles.map((r, i) => [r.role_id, i])),
    [draftRoles],
  )
  const sourceWordCount = React.useMemo(() => {
    const text = project?.source_text?.trim()
    return text ? new TextProcessor().getStats(text).wordCount : 0
  }, [project])

  // ---------- 保存整份（S-04） ----------
  const handleSave = async () => {
    if (!script) return
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
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        alert("脚本内容已更新，请刷新后重新编辑")
        await load()
      } else if (e instanceof ApiError && e.code === "SCRIPT_LOCKED") {
        alert("已确认脚本不能编辑，请先取消确认")
        await load()
      } else if (
        e instanceof ApiError &&
        (e.code === "INVALID_VOICE" ||
          e.code === "INVALID_AUDIO_PARAMS" ||
          e.code === "INVALID_ROLE")
      ) {
        alert(`角色声音配置不合法：${e.message}`)
      } else {
        alert(e instanceof ApiError ? e.message : "保存失败")
      }
    } finally {
      setSaving(false)
    }
  }

  // ---------- 确认（S-06） ----------
  const handleConfirm = async () => {
    if (!script) return
    setConfirming(true)
    try {
      const res = await scriptsApi.confirm(scriptId, {
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
      })
      setScript({
        ...script,
        status: res.status,
        editable: res.status === 'draft',
        confirmed_at: res.confirmed_at,
        confirmed_by: res.confirmed_by,
        confirmed_revision: res.confirmed_revision,
      })
    } catch (e) {
      if (e instanceof ApiError && e.code === "ANOTHER_SCRIPT_CONFIRMED") {
        alert("该项目已有其他脚本处于确认状态，请先取消确认")
      } else if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        alert("脚本内容已更新，请刷新后重试")
        await load()
      } else {
        alert(e instanceof ApiError ? e.message : "确认失败")
      }
    } finally {
      setConfirming(false)
    }
  }

  // ---------- 取消确认（S-07） ----------
  const handleUnconfirm = async () => {
    if (!script) return
    setConfirming(true)
    try {
      const res = await scriptsApi.unconfirm(scriptId, {
        expected_script_version: script.version,
        expected_edit_revision: script.edit_revision,
      })
      setScript({
        ...script,
        status: res.status,
        editable: res.status === 'draft',
        confirmed_at: res.confirmed_at,
        confirmed_by: res.confirmed_by,
        confirmed_revision: res.confirmed_revision,
      })
    } catch (e) {
      if (e instanceof ApiError && e.code === "REVISION_CONFLICT") {
        alert("脚本内容已更新，请刷新后重试")
        await load()
      } else {
        alert(e instanceof ApiError ? e.message : "取消确认失败")
      }
    } finally {
      setConfirming(false)
    }
  }

  // ---------- 渲染 ----------
  if (loading) return <ScriptSkeleton />

  if (error || !script || !project) {
    return (
      <div className="mx-auto max-w-sm py-16">
        <AppCard>
          <div className="flex flex-col items-center p-8 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/30">
              <AlertTriangle className="size-5" />
            </span>
            <h1 className="mt-5 text-lg font-semibold">无法加载脚本</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {error ?? "脚本不存在或无权访问"}
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
                onClick={() => onNavigate(`/projects/${projectId}`)}
              >
                返回项目
              </AppButton>
            </div>
          </div>
        </AppCard>
      </div>
    )
  }

  const regionFocus =
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"

  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <AppButton
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-muted-foreground"
            onClick={() => onNavigate(`/projects/${projectId}`)}
          >
            <ArrowLeft />
            返回项目
          </AppButton>
          <span className="text-muted-foreground/30">/</span>
          <h1
            className="min-w-0 max-w-[32ch] truncate text-lg font-semibold tracking-tight"
            title={script.title}
          >
            {script.title}
          </h1>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary ring-1 ring-primary/20">
            V{script.version}
          </span>
          <span
            className="font-mono text-xs text-muted-foreground"
            title="编辑修订号"
          >
            r{script.edit_revision}
          </span>
          <StatusBadge status={script.status} />
        </div>
        <SaveState saving={saving} dirty={isDirty} editable={isEditable} />
      </div>

      {/* Two-column layout */}
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-2 gap-4 lg:grid-cols-2 lg:grid-rows-1">
        {/* Left: 原文 */}
        <AppCard className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <PanelHeader
            icon={FileText}
            title="原文"
            meta={
              <>
                {sourceWordCount > 0 && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {sourceWordCount.toLocaleString("zh-CN")} 字
                  </span>
                )}
                <ModeChip editable={false} label="不可修改" />
              </>
            }
          />
          <div
            tabIndex={0}
            role="region"
            aria-label="原文内容"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto overscroll-contain break-words p-6",
              regionFocus,
            )}
          >
            {project.source_text?.trim() ? (
              <p className="whitespace-pre-wrap text-[15px] leading-7 text-foreground/80">
                {project.source_text}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                该项目还没有原文。
              </p>
            )}
          </div>
        </AppCard>

        {/* Right: 脚本编辑器 */}
        <AppCard className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <PanelHeader
            icon={ScrollText}
            title="脚本"
            meta={
              <>
                <ModeChip editable={isEditable} />
              </>
            }
          />

          <div
            role="group"
            aria-label="脚本统计"
            className="flex shrink-0 flex-wrap gap-2 border-b border-border px-5 py-2.5"
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
              <div className="space-y-2">
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="脚本标题"
                  aria-label="脚本标题"
                  className={cn(inputClass, "h-11 text-base font-semibold")}
                />
                <textarea
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  placeholder="脚本简介（可选）"
                  aria-label="脚本简介"
                  rows={2}
                  className={cn(inputClass, "resize-none")}
                />
              </div>
            ) : (
              script.summary && (
                <p className="rounded-lg border border-border bg-secondary/20 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                  {script.summary}
                </p>
              )
            )}

            {/* 角色清单（展示当前草稿的声音摘要） */}
            {draftRoles.length > 0 && (
              <section aria-label="角色" className="space-y-2">
                <h3 className="text-xs font-medium tracking-wider text-muted-foreground/70">
                  角色 · {draftRoles.length}
                </h3>
                <div className="grid gap-2 xl:grid-cols-2">
                  {draftRoles.map((role, i) => (
                    <button
                      key={role.role_id}
                      type="button"
                      disabled={!isEditable || saving || confirming}
                      onClick={() => setEditingRoleId(role.role_id)}
                      aria-label={`编辑 ${role.name} 的角色声音`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-secondary/20 px-3 py-2.5 text-left transition-colors enabled:cursor-pointer enabled:hover:border-primary/50 enabled:hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <RoleAvatar name={role.name} toneIndex={i} />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-1.5 text-sm font-medium">
                          <span className="truncate">{role.name}</span>
                          <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                            {role.role_key}
                          </span>
                        </p>
                        <p
                          className="truncate text-[11px] text-muted-foreground"
                          title={voiceSummary(role)}
                        >
                          {voiceSummary(role)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {/* 句子列表 */}
            <section aria-label="句子" className="space-y-1">
              {script.sentences.length === 0 ? (
                <p className="text-sm text-muted-foreground">脚本内容为空。</p>
              ) : (
                script.sentences.map((sentence) => (
                  <SentenceRow
                    key={sentence.sentence_id}
                    sentence={sentence}
                    role={draftRoles.find((r) => r.role_id === sentence.role_id)}
                    toneIndex={roleToneIndex.get(sentence.role_id) ?? 0}
                    value={draftSentences[sentence.sentence_id] ?? sentence.text}
                    readOnly={!isEditable}
                    onChange={(text) =>
                      setDraftSentences((prev) => ({
                        ...prev,
                        [sentence.sentence_id]: text,
                      }))
                    }
                  />
                ))
              )}
            </section>
          </div>
        </AppCard>
      </div>

      {/* Bottom action bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/80 px-4 py-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">
          {script.status === "confirmed"
            ? script.confirmed_at
              ? `已于 ${new Date(script.confirmed_at).toLocaleString("zh-CN")} 确认，确认后不可编辑`
              : "脚本已确认，不可编辑"
            : isDirty
              ? "请先保存修改，再确认脚本"
              : "确认后将锁定脚本，并可生成音频"}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          {isEditable && (
            <>
              <AppButton
                variant="ghost"
                onClick={() => {
                  if (!script) return
                  setDraftTitle(script.title)
                  setDraftSummary(script.summary ?? "")
                  setDraftSentences(
                    Object.fromEntries(
                      script.sentences.map((x) => [x.sentence_id, x.text]),
                    ),
                  )
                  setDraftRoles(script.roles.map(toRoleDraft))
                }}
                disabled={!isDirty || saving}
              >
                放弃修改
              </AppButton>
              <AppButton
                variant={isDirty ? "primary" : "secondary"}
                onClick={handleSave}
                disabled={!isDirty || saving}
              >
                {saving && <Loader2 className="animate-spin" />}
                保存修改
              </AppButton>
            </>
          )}

          {script.status === "draft" && (
            <AppButton
              variant={isDirty ? "outline" : "primary"}
              onClick={handleConfirm}
              disabled={confirming || isDirty}
              title={isDirty ? "请先保存修改再确认" : undefined}
            >
              {confirming && <Loader2 className="animate-spin" />}
              确认脚本
            </AppButton>
          )}

          {script.status === "confirmed" && (
            <AppButton
              variant="outline"
              onClick={handleUnconfirm}
              disabled={confirming}
            >
              {confirming && <Loader2 className="animate-spin" />}
              取消确认
            </AppButton>
          )}

          {script.status === "confirmed" && (
            <AppButton
              onClick={() =>
                onNavigate(`/projects/${projectId}/scripts/${scriptId}/audio`)
              }
            >
              生成音频
            </AppButton>
          )}
        </div>
      </div>

      {editingRoleId && isEditable && <RoleVoiceEditorDialog
        key={editingRoleId}
        roles={draftRoles.filter(role => role.role_id === editingRoleId)}
        applyLabel="应用到草稿"
        description="修改先应用到草稿，再点击页面底部“保存修改”生效。"
        onClose={() => setEditingRoleId(null)}
        onApply={next => {
          setDraftRoles(previous => previous.map(role =>
            next.find(updated => updated.role_id === role.role_id) ?? role,
          ))
          setEditingRoleId(null)
        }}
      />}
    </div>
  )
}

// ============================================================
// Sentence row
// ============================================================

function SentenceRow({
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
  onChange: (text: string) => void
}) {
  const durationSeconds = React.useMemo(
    () => estimateScriptDuration([{ ...sentence, text: value }], role ? [role] : []),
    [sentence, value, role],
  )

  // 文本框随内容自动增高（不再出现框内滚动条）；宽度变化导致换行变化时重新计算
  const ref = React.useRef<HTMLTextAreaElement>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  React.useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === "undefined") return
    let lastWidth = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return
      lastWidth = el.clientWidth
      el.style.height = "auto"
      el.style.height = `${el.scrollHeight}px`
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div
      className={cn(
        "group flex gap-3 rounded-xl border border-transparent p-3 transition-colors",
        "focus-within:border-primary/30 focus-within:bg-card focus-within:ring-1 focus-within:ring-ring/30",
        !readOnly && "hover:border-border hover:bg-accent/20",
      )}
    >
      <RoleAvatar name={role?.name} toneIndex={toneIndex} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
          <span
            className={cn(
              "text-xs font-semibold",
              role ? roleTone(toneIndex).text : "text-muted-foreground",
            )}
          >
            {role?.name ?? "未知角色"}
          </span>
          <span className="font-mono">#{sentence.sequence}</span>
          {sentence.speed !== null && <span>语速 {sentence.speed}x</span>}
          <span
            className="ml-auto tabular-nums"
            title="按本句语言和有效语速估算，句子语速优先于角色默认语速"
          >
            约 {durationSeconds.toFixed(1)} 秒
          </span>
        </div>
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          rows={1}
          aria-label={`第 ${sentence.sequence} 句`}
          className={cn(
            "block w-full resize-none overflow-hidden bg-transparent text-sm leading-relaxed focus-visible:outline-none",
            readOnly ? "cursor-default text-foreground/85" : "text-foreground",
          )}
        />
      </div>
    </div>
  )
}

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
