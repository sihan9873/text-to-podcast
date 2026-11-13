import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, ChevronDown, ChevronUp, Check, AlertCircle } from 'lucide-react';
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
}

export function RoleVoiceEditorDialog({
  roles,
  onClose,
  onApply,
  applyLabel = '保存声音配置',
  description = '声音参数须来自语音能力目录；保存后需确认脚本，才能使用新配置生成音频。',
}: RoleVoiceEditorDialogProps) {
  // 本地草稿：对话框内修改，确认后才写回
  const [local, setLocal] = React.useState<RoleDraft[]>(() =>
    roles.map((r) => ({ ...r, voice_config: { ...r.voice_config } })),
  )

  const {
    data: voicesData,
    isPending: voicesLoading,
    isError: voicesError,
    refetch,
  } = useQuery({
    queryKey: ["voices"],
    queryFn: () => configApi.voices(),
    staleTime: 5 * 60 * 1000,
  })

  const voices: VoiceItem[] = React.useMemo(() => voicesData?.voices ?? [], [voicesData])

  // 校验所有角色声音合法（provider/model/voice 匹配、speed 范围、style 合法）
  const validationErrors = React.useMemo(() => {
    const errs: Record<string, string> = {}
    local.forEach((role) => {
      const v = voices.find(
        (x) =>
          x.tts_provider === role.voice_config.tts_provider &&
          x.tts_model === role.voice_config.tts_model &&
          x.voice_id === role.voice_config.voice_id,
      )
      if (!v) {
        errs[role.role_id] = "音色不在能力目录中"
        return
      }
      if (v.speed.supported) {
        if (
          role.voice_config.speed < v.speed.min ||
          role.voice_config.speed > v.speed.max
        ) {
          errs[role.role_id] = `语速需在 ${v.speed.min}–${v.speed.max} 之间`
          return
        }
      }
      if (
        role.voice_config.style &&
        !v.styles.includes(role.voice_config.style)
      ) {
        errs[role.role_id] = "风格不在该音色支持范围内"
      }
    })
    return errs
  }, [local, voices])

  const hasErrors = Object.keys(validationErrors).length > 0
  const canApply = !voicesLoading && !voicesError && !hasErrors

  const updateRole = (roleId: string, patch: Partial<RoleDraft>) => {
    setLocal((prev) =>
      prev.map((r) => (r.role_id === roleId ? { ...r, ...patch } : r)),
    )
  }

  const updateVoiceConfig = (roleId: string, patch: Partial<VoiceConfig>) => {
    setLocal((prev) =>
      prev.map((r) =>
        r.role_id === roleId
          ? { ...r, voice_config: { ...r.voice_config, ...patch } }
          : r,
      ),
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">编辑角色声音</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {description}
            </p>
          </div>
          <AppButton size="sm" variant="ghost" onClick={onClose}>
            关闭
          </AppButton>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          {voicesLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              加载语音能力目录…
            </div>
          )}
          {voicesError && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 py-6 text-center text-sm text-destructive">
              <AlertCircle className="size-5" />
              语音能力目录加载失败
              <AppButton size="sm" variant="outline" onClick={() => refetch()}>
                重试
              </AppButton>
            </div>
          )}
          {!voicesLoading && !voicesError && local.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">
              当前脚本没有角色。
            </p>
          )}
          {!voicesLoading &&
            !voicesError &&
            local.map((role) => (
              <RoleVoiceEditorCard
                key={role.role_id}
                role={role}
                voices={voices}
                error={validationErrors[role.role_id]}
                onUpdateRole={(patch) => updateRole(role.role_id, patch)}
                onUpdateVoice={(patch) =>
                  updateVoiceConfig(role.role_id, patch)
                }
              />
            ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <span className="text-xs text-muted-foreground">
            {hasErrors ? "存在不合法的声音配置" : "所有配置均合法"}
          </span>
          <div className="flex gap-2">
            <AppButton
              variant="ghost"
              onClick={onClose}
            >
              取消
            </AppButton>
            <AppButton onClick={() => onApply(local)} disabled={!canApply}>
              <Check className="mr-1 size-4" />
              {applyLabel}
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

function RoleVoiceEditorCard({
  role,
  voices,
  error,
  onUpdateRole,
  onUpdateVoice,
}: {
  role: RoleDraft
  voices: VoiceItem[]
  error?: string
  onUpdateRole: (patch: Partial<RoleDraft>) => void
  onUpdateVoice: (patch: Partial<VoiceConfig>) => void
}) {
  const [open, setOpen] = React.useState(true)

  // 当前 voice（按 provider+model+voice_id 三元匹配）
  const currentVoice = voices.find(
    (v) =>
      v.tts_provider === role.voice_config.tts_provider &&
      v.tts_model === role.voice_config.tts_model &&
      v.voice_id === role.voice_config.voice_id,
  )

  // 联动候选
  const providers = React.useMemo(
    () => Array.from(new Set(voices.map((v) => v.tts_provider))),
    [voices],
  )
  const modelsOfProvider = React.useMemo(
    () =>
      Array.from(
        new Set(
          voices
            .filter((v) => v.tts_provider === role.voice_config.tts_provider)
            .map((v) => v.tts_model),
        ),
      ),
    [voices, role.voice_config.tts_provider],
  )
  const voicesOfProviderModel = React.useMemo(
    () =>
      voices.filter(
        (v) =>
          v.tts_provider === role.voice_config.tts_provider &&
          v.tts_model === role.voice_config.tts_model,
      ),
    [voices, role.voice_config.tts_provider, role.voice_config.tts_model],
  )

  const styles = currentVoice?.styles ?? []
  const speedCfg = currentVoice?.speed
  const extraSchema = currentVoice?.extra_parameter_schema ?? {}

  // 切换提供方时重置模型与音色
  const handleProviderChange = (provider: string) => {
    const firstModel = Array.from(
      new Set(
        voices
          .filter((v) => v.tts_provider === provider)
          .map((v) => v.tts_model),
      ),
    )[0]
    if (!firstModel) return
    const firstVoice = voices.find(
      (v) => v.tts_provider === provider && v.tts_model === firstModel,
    )
    if (!firstVoice) return
    onUpdateVoice({
      tts_provider: provider,
      tts_model: firstModel,
      voice_id: firstVoice.voice_id,
      style: firstVoice.default_style,
      speed: firstVoice.speed.default,
      extra_params: {},
    })
  }

  const handleModelChange = (model: string) => {
    const firstVoice = voices.find(
      (v) =>
        v.tts_provider === role.voice_config.tts_provider &&
        v.tts_model === model,
    )
    if (!firstVoice) return
    onUpdateVoice({
      tts_model: model,
      voice_id: firstVoice.voice_id,
      style: firstVoice.default_style,
      speed: firstVoice.speed.default,
      extra_params: {},
    })
  }

  const handleVoiceChange = (voiceId: string) => {
    const v = voices.find(
      (x) =>
        x.tts_provider === role.voice_config.tts_provider &&
        x.tts_model === role.voice_config.tts_model &&
        x.voice_id === voiceId,
    )
    if (!v) return
    onUpdateVoice({
      voice_id: voiceId,
      style: v.default_style,
      speed: v.speed.default,
      extra_params: {},
    })
  }

  return (
    <div
      className={cn(
        "rounded-lg border",
        error ? "border-destructive/50" : "border-border",
      )}
    >
      {/* Card header */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{role.name}</span>
          <span className="text-[11px] text-muted-foreground">
            ({role.role_key})
          </span>
          {error && (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
              <AlertCircle className="size-3" />
              {error}
            </span>
          )}
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-3 border-t border-border px-4 py-3">
          {/* 角色名 / 描述 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                角色名
              </span>
              <input
                value={role.name}
                onChange={(e) => onUpdateRole({ name: e.target.value })}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                描述
              </span>
              <input
                value={role.description ?? ""}
                onChange={(e) =>
                  onUpdateRole({
                    description: e.target.value.trim() ? e.target.value : null,
                  })
                }
                className={inputClass}
              />
            </label>
          </div>

          {/* 三级联动：provider / model / voice */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                TTS 提供方
              </span>
              <select
                value={role.voice_config.tts_provider}
                onChange={(e) => handleProviderChange(e.target.value)}
                className={inputClass}
              >
                {providers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                TTS 模型
              </span>
              <select
                value={role.voice_config.tts_model}
                onChange={(e) => handleModelChange(e.target.value)}
                className={inputClass}
              >
                {modelsOfProvider.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                音色
              </span>
              <select
                value={role.voice_config.voice_id}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className={inputClass}
              >
                {voicesOfProviderModel.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}（{v.voice_id}）
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* 风格 / 语速 */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-muted-foreground">
                风格
              </span>
              <select
                value={role.voice_config.style ?? ""}
                onChange={(e) =>
                  onUpdateVoice({
                    style: e.target.value ? e.target.value : null,
                  })
                }
                className={inputClass}
                disabled={styles.length === 0}
              >
                <option value="">默认（使用音色默认表达）</option>
                {styles.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                <span>语速</span>
                <span className="tabular-nums">
                  x{role.voice_config.speed}
                </span>
              </span>
              <input
                type="range"
                min={speedCfg?.min ?? 1}
                max={speedCfg?.max ?? 1}
                step={0.05}
                value={role.voice_config.speed}
                onChange={(e) =>
                  onUpdateVoice({ speed: Number(e.target.value) })
                }
                disabled={!speedCfg?.supported}
                className="w-full accent-primary"
              />
              {speedCfg && (
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  范围 {speedCfg.min}–{speedCfg.max}，默认 {speedCfg.default}
                  {!speedCfg.supported && "（该音色不支持语速调整）"}
                </span>
              )}
            </label>
          </div>

          {/* extra_params（按 schema 动态渲染） */}
          <ExtraParamsEditor
            schema={extraSchema}
            value={role.voice_config.extra_params}
            onChange={(extra) => onUpdateVoice({ extra_params: extra })}
          />
        </div>
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
      <div className="grid gap-2 sm:grid-cols-2">
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
