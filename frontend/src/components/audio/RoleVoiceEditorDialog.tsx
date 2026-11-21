import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, Check, AlertCircle, RotateCcw } from 'lucide-react';
import { RoleAvatar } from '@/components/common/RoleAvatar';
import { cn } from '@/lib/utils';
import { AppButton } from '@/components/common/AppButton';
import { configApi, type VoiceConfig, type VoiceItem } from '@/api';
export interface RoleDraft {
  role_id: string
  role_key: string
  name: string
  description: string | null
  voice_config: VoiceConfig
}

interface RoleVoiceEditorDialogProps {
  roles: RoleDraft[]
  onClose: () => void
  onApply: (roles: RoleDraft[]) => void
  applyLabel?: string
  description?: string
  inline?: boolean
  disabled?: boolean
}

export function RoleVoiceEditorDialog({
  roles,
  onClose,
  onApply,
  applyLabel = '保存声音配置',
  description = '声音参数须来自语音能力目录；保存后需确认脚本，才能使用新配置生成音频。',
  inline = false,
  disabled = false,
}: RoleVoiceEditorDialogProps) {
  const [local, setLocal] = React.useState<RoleDraft[]>(() =>
    roles.map((r) => ({ ...r, voice_config: { ...r.voice_config } })),
  )

  const { data: voicesData, isPending: voicesLoading, isError: voicesError, refetch } = useQuery({
    queryKey: ["voices"],
    queryFn: () => configApi.voices(),
    staleTime: 5 * 60 * 1000,
  })
  const voices: VoiceItem[] = React.useMemo(() => voicesData?.voices ?? [], [voicesData])

  const originalById = React.useMemo(() => new Map(roles.map((r) => [r.role_id, r])), [roles])

  const validationErrors = React.useMemo(() => {
    const errs: Record<string, string> = {}
    local.forEach((role) => {
      if (!role.name.trim()) {
        errs[role.role_id] = "角色名不能为空"
        return
      }
      const v = voices.find(
        (x) =>
          x.tts_provider === role.voice_config.tts_provider &&
          x.tts_model === role.voice_config.tts_model &&
          x.voice_id === role.voice_config.voice_id,
      )
      if (!v) { errs[role.role_id] = "音色不在能力目录中"; return }
      if (v.speed.supported && (role.voice_config.speed < v.speed.min || role.voice_config.speed > v.speed.max)) {
        errs[role.role_id] = `语速需在 ${v.speed.min}–${v.speed.max} 之间`
        return
      }
      if (role.voice_config.style && !v.styles.includes(role.voice_config.style)) {
        errs[role.role_id] = "风格不在该音色支持范围内"
      }
    })
    return errs
  }, [local, voices])

  const errorCount = Object.keys(validationErrors).length
  const hasErrors = errorCount > 0
  const hasChanges = React.useMemo(() => JSON.stringify(local) !== JSON.stringify(roles), [local, roles])
  const canApply = !disabled && !voicesLoading && !voicesError && !hasErrors && (!inline || hasChanges)

  const updateRole = (roleId: string, patch: Partial<RoleDraft>) =>
    setLocal((prev) => prev.map((r) => (r.role_id === roleId ? { ...r, ...patch } : r)))
  const updateVoiceConfig = (roleId: string, patch: Partial<VoiceConfig>) =>
    setLocal((prev) =>
      prev.map((r) => (r.role_id === roleId ? { ...r, voice_config: { ...r.voice_config, ...patch } } : r)),
    )

  const status = voicesLoading ? { tone: "muted", text: "正在加载声音配置" }
    : voicesError ? { tone: "error", text: "声音配置加载失败" }
    : hasErrors ? { tone: "error", text: `${errorCount} 个角色的配置不合法` }
    : hasChanges ? { tone: "warn", text: "有待应用的角色修改" }
    : { tone: "ok", text: "所有配置均合法" }

  return (
    <div
      className={inline ? "min-w-0" : "fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"}
      onClick={inline ? undefined : onClose}
    >
      <div
        className={cn(
          "@container flex w-full flex-col",
          inline ? "gap-3" : "max-h-[90vh] max-w-3xl rounded-xl border border-border bg-card shadow-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {!inline && (
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h2 className="text-lg font-semibold">编辑角色声音</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
            </div>
            <AppButton size="sm" variant="ghost" onClick={onClose}>关闭</AppButton>
          </div>
        )}

        <div className={inline ? "space-y-2" : "flex-1 space-y-3 overflow-y-auto px-6 py-4"}>
          {voicesLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />加载语音能力目录…
            </div>
          )}
          {voicesError && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-6 text-center text-sm text-destructive">
              <AlertCircle className="size-5" />语音能力目录加载失败
              <AppButton size="sm" variant="outline" onClick={() => refetch()}>重试</AppButton>
            </div>
          )}
          {!voicesLoading && !voicesError && local.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">当前脚本没有角色。</p>
          )}
          {!voicesLoading && !voicesError && local.map((role, i) => (
            <RoleVoiceEditorCard
              key={role.role_id}
              role={role}
              original={originalById.get(role.role_id)}
              toneIndex={i}
              inline={inline}
              disabled={disabled}
              voices={voices}
              error={validationErrors[role.role_id]}
              onUpdateRole={(patch) => updateRole(role.role_id, patch)}
              onUpdateVoice={(patch) => updateVoiceConfig(role.role_id, patch)}
            />
          ))}
        </div>

        {/* 底部操作条：内联模式吸附在面板滚动区底部（面板有 p-4，所以用负 margin 铺满） */}
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-3 border-t border-border",
            inline
              ? "sticky bottom-0 z-10 -mx-4 -mb-4 bg-card/90 px-4 py-3 backdrop-blur"
              : "px-6 py-4",
          )}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              status.tone === "error" ? "text-destructive" : status.tone === "warn" ? "text-amber-400" : "text-muted-foreground",
            )}
          >
            {status.tone === "warn" && <span className="size-1.5 animate-pulse rounded-full bg-amber-400" />}
            {status.tone === "ok" && <Check className="size-3.5 text-primary" />}
            {status.tone === "error" && <AlertCircle className="size-3.5" />}
            {status.text}
          </span>
          <div className="flex gap-2">
            <AppButton variant="ghost" size={inline ? "sm" : undefined} onClick={onClose} disabled={inline && (!hasChanges || disabled)}>
              {inline ? <><RotateCcw />重置</> : "取消"}
            </AppButton>
            <AppButton size={inline ? "sm" : undefined} onClick={() => onApply(local)} disabled={!canApply}>
              <Check />{applyLabel}
            </AppButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 单个角色编辑卡片
// ============================================================

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground/70">{title}</legend>
      {children}
    </fieldset>
  )
}

function RoleVoiceEditorCard({
  role, original, toneIndex, voices, error, onUpdateRole, onUpdateVoice, inline = false, disabled = false,
}: {
  role: RoleDraft
  original?: RoleDraft
  toneIndex: number
  voices: VoiceItem[]
  error?: string
  onUpdateRole: (patch: Partial<RoleDraft>) => void
  onUpdateVoice: (patch: Partial<VoiceConfig>) => void
  inline?: boolean
  disabled?: boolean
}) {
  const [open, setOpen] = React.useState(!inline)
  const panelId = React.useId()
  const hasError = !!error

  // 出现校验错误时自动展开，避免错误藏在收起的卡片里
  React.useEffect(() => { if (hasError) setOpen(true) }, [hasError])

  const changed = !!original && JSON.stringify(original) !== JSON.stringify(role)

  const currentVoice = voices.find(
    (v) =>
      v.tts_provider === role.voice_config.tts_provider &&
      v.tts_model === role.voice_config.tts_model &&
      v.voice_id === role.voice_config.voice_id,
  )
  const providers = React.useMemo(() => Array.from(new Set(voices.map((v) => v.tts_provider))), [voices])
  const modelsOfProvider = React.useMemo(
    () => Array.from(new Set(voices.filter((v) => v.tts_provider === role.voice_config.tts_provider).map((v) => v.tts_model))),
    [voices, role.voice_config.tts_provider],
  )
  const voicesOfProviderModel = React.useMemo(
    () => voices.filter((v) => v.tts_provider === role.voice_config.tts_provider && v.tts_model === role.voice_config.tts_model),
    [voices, role.voice_config.tts_provider, role.voice_config.tts_model],
  )

  const styles = currentVoice?.styles ?? []
  const speedCfg = currentVoice?.speed
  const extraSchema = currentVoice?.extra_parameter_schema ?? {}
  const speedIsDefault = !speedCfg || role.voice_config.speed === speedCfg.default

  const summary = [currentVoice?.name ?? role.voice_config.voice_id, role.voice_config.style, `${role.voice_config.speed}x`]
    .filter(Boolean).join(" · ")

  // —— 联动处理（逻辑与原来一致）——
  const handleProviderChange = (provider: string) => {
    const firstModel = Array.from(new Set(voices.filter((v) => v.tts_provider === provider).map((v) => v.tts_model)))[0]
    if (!firstModel) return
    const firstVoice = voices.find((v) => v.tts_provider === provider && v.tts_model === firstModel)
    if (!firstVoice) return
    onUpdateVoice({
      tts_provider: provider, tts_model: firstModel, voice_id: firstVoice.voice_id,
      style: firstVoice.default_style, speed: firstVoice.speed.default, extra_params: {},
    })
  }
  const handleModelChange = (model: string) => {
    const firstVoice = voices.find((v) => v.tts_provider === role.voice_config.tts_provider && v.tts_model === model)
    if (!firstVoice) return
    onUpdateVoice({
      tts_model: model, voice_id: firstVoice.voice_id,
      style: firstVoice.default_style, speed: firstVoice.speed.default, extra_params: {},
    })
  }
  const handleVoiceChange = (voiceId: string) => {
    const v = voices.find(
      (x) => x.tts_provider === role.voice_config.tts_provider && x.tts_model === role.voice_config.tts_model && x.voice_id === voiceId,
    )
    if (!v) return
    onUpdateVoice({ voice_id: voiceId, style: v.default_style, speed: v.speed.default, extra_params: {} })
  }

  const label = "mb-1 block text-[11px] font-medium text-muted-foreground"

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border transition-colors",
        hasError ? "border-destructive/50" : open ? "border-border bg-card" : "border-border/60 bg-secondary/20 hover:border-border",
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <RoleAvatar name={role.name} toneIndex={toneIndex} />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{role.name || "未命名角色"}</span>
            <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">{role.role_key}</span>
            {changed && (
              <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-400">已修改</span>
            )}
          </p>
          <p className={cn("truncate text-[11px]", hasError ? "text-destructive" : "text-muted-foreground")} title={error ?? summary}>
            {hasError ? <span className="inline-flex items-center gap-1"><AlertCircle className="size-3" />{error}</span> : summary}
          </p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <fieldset id={panelId} disabled={disabled} className="min-w-0 space-y-4 border-t border-border/60 px-3 py-3">
          <FieldGroup title="基本信息">
            <div className="grid gap-3 @sm:grid-cols-2">
              <label className="block">
                <span className={label}>角色名</span>
                <input value={role.name} onChange={(e) => onUpdateRole({ name: e.target.value })}
                  aria-invalid={!role.name.trim()} className={inputClass} />
              </label>
              <label className="block">
                <span className={label}>描述</span>
                <input value={role.description ?? ""} placeholder="可选"
                  onChange={(e) => onUpdateRole({ description: e.target.value.trim() ? e.target.value : null })}
                  className={inputClass} />
              </label>
            </div>
          </FieldGroup>

          <FieldGroup title="声音">
            <div className="grid gap-3 @sm:grid-cols-2">
              <label className="block">
                <span className={label}>TTS 提供方</span>
                <select value={role.voice_config.tts_provider} onChange={(e) => handleProviderChange(e.target.value)} className={inputClass}>
                  {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </label>
              <label className="block">
                <span className={label}>TTS 模型</span>
                <select value={role.voice_config.tts_model} onChange={(e) => handleModelChange(e.target.value)} className={inputClass}>
                  {modelsOfProvider.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              <label className="block @sm:col-span-2">
                <span className={label}>音色</span>
                <select value={role.voice_config.voice_id} onChange={(e) => handleVoiceChange(e.target.value)} className={inputClass}>
                  {voicesOfProviderModel.map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}（{v.voice_id}）</option>)}
                </select>
              </label>
            </div>
          </FieldGroup>

          <FieldGroup title="表达">
            <div className="grid gap-3 @sm:grid-cols-2">
              <label className="block">
                <span className={label}>风格</span>
                <select
                  value={role.voice_config.style ?? ""}
                  onChange={(e) => onUpdateVoice({ style: e.target.value || null })}
                  disabled={styles.length === 0}
                  className={inputClass}
                >
                  <option value="">默认（使用音色默认表达）</option>
                  {styles.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>

              <div className="block">
                <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                  <label htmlFor={`${panelId}-speed`}>语速</label>
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <span className="text-foreground">x{role.voice_config.speed}</span>
                    {!speedIsDefault && speedCfg?.supported && (
                      <button type="button" onClick={() => onUpdateVoice({ speed: speedCfg.default })}
                        className="inline-flex items-center gap-0.5 rounded px-1 text-primary hover:bg-primary/10 disabled:opacity-50">
                        <RotateCcw className="size-3" />默认
                      </button>
                    )}
                  </span>
                </span>
                <input
                  id={`${panelId}-speed`}
                  type="range"
                  min={speedCfg?.min ?? 1}
                  max={speedCfg?.max ?? 1}
                  step={0.05}
                  value={role.voice_config.speed}
                  onChange={(e) => onUpdateVoice({ speed: Number(e.target.value) })}
                  disabled={!speedCfg?.supported}
                  className="w-full accent-primary"
                />
                {speedCfg && (
                  <span className="mt-0.5 flex justify-between text-[10px] tabular-nums text-muted-foreground">
                    <span>{speedCfg.min}x</span>
                    {!speedCfg.supported && <span>该音色不支持语速调整</span>}
                    <span>{speedCfg.max}x</span>
                  </span>
                )}
              </div>
            </div>
          </FieldGroup>

          <ExtraParamsEditor
            schema={extraSchema}
            value={role.voice_config.extra_params}
            onChange={(extra) => onUpdateVoice({ extra_params: extra })}
          />
        </fieldset>
      )}
    </div>
  )
}

// ============================================================
// extra_params 动态表单（按 schema 简单渲染）
// ============================================================

function ExtraParamsEditor({
  schema,
  value,
  onChange,
}: {
  schema: Record<string, unknown>
  value: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
}) {
  const entries = Object.entries(schema)
  if (entries.length === 0) return null

  return (
    <div className="rounded-md border border-border bg-secondary/20 p-3">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">
        其他参数（能力目录允许的参数）
      </p>
      <div className="grid gap-2 @sm:grid-cols-2">
        {entries.map(([key, raw]) => {
          const def = (raw ?? {}) as {
            type?: string
            enum?: unknown[]
            default?: unknown
            description?: string
          }
          const current = value[key]

          if (def.enum && Array.isArray(def.enum)) {
            return (
              <label key={key} className="block">
                <span className="mb-0.5 block text-[10px] text-muted-foreground">
                  {key}
                </span>
                <select
                  value={current == null ? "" : String(current)}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      [key]: e.target.value || undefined,
                    })
                  }
                  className={inputClass}
                >
                  <option value="">（未设置）</option>
                  {def.enum.map((opt) => (
                    <option key={String(opt)} value={String(opt)}>
                      {String(opt)}
                    </option>
                  ))}
                </select>
              </label>
            )
          }

          if (def.type === "boolean") {
            return (
              <label
                key={key}
                className="flex items-center gap-2 text-[11px] text-muted-foreground"
              >
                <input
                  type="checkbox"
                  checked={current === true}
                  onChange={(e) =>
                    onChange({ ...value, [key]: e.target.checked })
                  }
                />
                {key}
              </label>
            )
          }

          if (def.type === "number" || def.type === "integer") {
            return (
              <label key={key} className="block">
                <span className="mb-0.5 block text-[10px] text-muted-foreground">
                  {key}
                </span>
                <input
                  type="number"
                  value={current == null ? "" : Number(current)}
                  onChange={(e) => {
                    const raw = e.target.value
                    onChange({
                      ...value,
                      [key]: raw === "" ? undefined : Number(raw),
                    })
                  }}
                  className={inputClass}
                />
              </label>
            )
          }

          // 默认 string
          return (
            <label key={key} className="block">
              <span className="mb-0.5 block text-[10px] text-muted-foreground">
                {key}
              </span>
              <input
                type="text"
                value={current == null ? "" : String(current)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    [key]: e.target.value || undefined,
                  })
                }
                className={inputClass}
              />
            </label>
          )
        })}
      </div>
    </div>
  )
}


const inputClass = cn(
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
  "placeholder:text-muted-foreground",
  "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:cursor-not-allowed disabled:opacity-60",
)
