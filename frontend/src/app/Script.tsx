// src/Script.tsx
import * as React from "react"
import { TextProcessor, LANGUAGE_LABELS, estimateScriptDuration } from '@/lib/textProcessor'
import { RoleVoiceEditorDialog } from '@/components/audio/RoleVoiceEditorDialog'

import { ArrowLeft, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard } from "@/components/common/AppCard"

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
  const [roleDialogOpen, setRoleDialogOpen] = React.useState(false)



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
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !script || !project) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-2xl font-semibold">无法加载脚本</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? "脚本不存在或无权访问"}
        </p>
        <AppButton
          className="mt-6"
          onClick={() => onNavigate(`/projects/${projectId}`)}
        >
          返回项目
        </AppButton>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-7xl flex-col gap-4 overflow-hidden">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <AppButton
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={() => onNavigate(`/projects/${projectId}`)}
          >
            <ArrowLeft />返回项目
          </AppButton>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="text-lg font-semibold tracking-tight">
            {script.title}
          </h1>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            V{script.version}
          </span>
          <span className="text-xs text-muted-foreground">
            r{script.edit_revision}
          </span>
          <StatusBadge status={script.status} />
        </div>
        {saving && (
          <span className="text-xs text-muted-foreground">保存中…</span>
        )}
        {isDirty && !saving && (
          <span className="text-xs text-amber-500">有未保存的修改</span>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-2 gap-4 lg:grid-cols-2 lg:grid-rows-1">
        {/* Left: 原文 */}
        <AppCard className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">原文</h2>
            <span className="text-xs text-muted-foreground">不可修改</span>
          </div>
          <div tabIndex={0} role="region" aria-label="原文内容" className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words p-5">
            {project.source_text?.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
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
          <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">脚本</h2>
            <div className="flex items-center gap-2">
              {isEditable && <AppButton size="sm" variant="outline" disabled={saving || confirming || !draftRoles.length} onClick={() => setRoleDialogOpen(true)}>编辑角色声音</AppButton>}
              <span className="text-xs text-muted-foreground">
                {isEditable ? "可编辑" : "只读"}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-border px-5 py-2 text-xs text-muted-foreground" aria-label="脚本统计">
            <span title="中日韩按字符、其他语言按单词计数，不含空白及标点">字数：{scriptAnalysis.wordCount.toLocaleString('zh-CN')}</span>
            {scriptAnalysis.topic !== '其他' && <span>主题：{scriptAnalysis.topic}</span>}
            {scriptAnalysis.language !== 'unknown' && <span>语言：{LANGUAGE_LABELS[scriptAnalysis.language]}</span>}
            <span title="按每句语言和有效语速估算，累加所有角色；实际时长以生成音频为准">预估语音时长：约 {scriptAnalysis.durationSeconds} 秒</span>
          </div>
          <div tabIndex={0} role="region" aria-label="脚本内容" className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain break-words p-5">
            {/* 标题与简介 */}
            {isEditable ? (
              <div className="space-y-2">
                <input
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="脚本标题"
                  className={inputClass}
                />
                <textarea
                  value={draftSummary}
                  onChange={(e) => setDraftSummary(e.target.value)}
                  placeholder="脚本简介（可选）"
                  rows={2}
                  className={cn(inputClass, "resize-none")}
                />
              </div>
            ) : (
              script.summary && (
                <p className="text-sm text-muted-foreground">{script.summary}</p>
              )
            )}

            {/* 角色清单（展示当前草稿的声音摘要） */}
            {draftRoles.length > 0 && (
              <div className="space-y-1.5">
                {draftRoles.map((role) => (
                  <div
                    key={role.role_id}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2"
                  >
                    <span className="text-xs font-medium">{role.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      ({role.role_key})
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      · {role.voice_config.tts_provider}/
                      {role.voice_config.tts_model} ·{" "}
                      {role.voice_config.voice_id}
                      {role.voice_config.style
                        ? ` · ${role.voice_config.style}`
                        : ""}{" "}
                      · x{role.voice_config.speed}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* 句子列表 */}
            {script.sentences.length === 0 ? (
              <p className="text-sm text-muted-foreground">脚本内容为空。</p>
            ) : (
              <div className="space-y-2">
                {script.sentences.map((sentence) => (
                  <SentenceRow
                    key={sentence.sentence_id}
                    sentence={sentence}
                    role={draftRoles.find((r) => r.role_id === sentence.role_id)}
                    value={draftSentences[sentence.sentence_id] ?? sentence.text}
                    readOnly={!isEditable}
                    onChange={(text) =>
                      setDraftSentences((prev) => ({
                        ...prev,
                        [sentence.sentence_id]: text,
                      }))
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </AppCard>
      </div>

      {/* Bottom action bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card p-4">
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
            <AppButton onClick={handleSave} disabled={!isDirty || saving}>
              {saving && <Loader2 className="mr-1 size-3 animate-spin" />}
              保存修改
            </AppButton>
          </>
        )}

        {script.status === "draft" && (
          <AppButton
            variant="outline"
            onClick={handleConfirm}
            disabled={confirming || isDirty}
            title={isDirty ? "请先保存修改再确认" : undefined}
          >
            {confirming && <Loader2 className="mr-1 size-3 animate-spin" />}
            确认脚本
          </AppButton>
        )}

        {script.status === "confirmed" && (
          <AppButton
            variant="outline"
            onClick={handleUnconfirm}
            disabled={confirming}
          >
            {confirming && <Loader2 className="mr-1 size-3 animate-spin" />}
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

      {roleDialogOpen && isEditable && <RoleVoiceEditorDialog
        roles={draftRoles}
        applyLabel="应用到草稿"
        description="修改先应用到草稿，再点击页面底部“保存修改”生效。"
        onClose={() => setRoleDialogOpen(false)}
        onApply={next => { setDraftRoles(next); setRoleDialogOpen(false) }}
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
  value,
  readOnly,
  onChange,
}: {
  sentence: ScriptSentence
  role: RoleDraft | undefined
  value: string
  readOnly: boolean
  onChange: (text: string) => void
}) {
  const durationSeconds = React.useMemo(
    () => estimateScriptDuration([{ ...sentence, text: value }], role ? [role] : []),
    [sentence, value, role],
  )
  return (
    <div
      className={cn(
        "group rounded-lg border border-transparent p-2 transition-colors",
        !readOnly && "hover:border-border hover:bg-accent/30",
      )}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className="font-mono">#{sentence.sequence}</span>
        {role && (
          <span className="inline-flex items-center rounded-full bg-secondary/60 px-2 py-0.5 font-medium">
            {role.name}
          </span>
        )}
        {sentence.speed !== null && <span>语速 {sentence.speed}x</span>}
        <span title="按本句语言和有效语速估算，句子语速优先于角色默认语速">
          预估 {durationSeconds.toFixed(1)} 秒
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        readOnly={readOnly}
        rows={2}
        className={cn(
          "w-full resize-none rounded-md bg-transparent text-sm leading-relaxed",
          "focus-visible:outline-none",
          readOnly && "cursor-default text-muted-foreground",
          !readOnly &&
            "focus-visible:bg-card focus-visible:ring-1 focus-visible:ring-ring/40",
        )}
      />
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
