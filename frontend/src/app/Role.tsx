// src/app/Roles.tsx
import * as React from "react"
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Mic2,
  Check,
  X,
} from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"
import { RoleAvatar, hashToneIndex } from "@/components/common/RoleAvatar"

import {
  configApi,
  ApiError,
  type RoleProfileItem,
  type CreateRoleRequest,
  type UpdateRoleRequest,
  type VoiceItem,
} from "@/api"

// ============================================================
// Roles page
// ============================================================

export default function RolesPage() {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<"" | "enabled" | "disabled">("")
  const [page, setPage] = React.useState(1)
  const pageSize = 20

  const {
    data,
    isPending,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["roles", { status, page, pageSize }],
    queryFn: () =>
      configApi.roles({
        page,
        page_size: pageSize,
        status: status || undefined,
      }),
  })

  // 编辑/新建抽屉
  const [editing, setEditing] = React.useState<RoleProfileItem | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [deletingId, setDeletingId] = React.useState<string | null>(null)

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const handleDeleted = React.useCallback(
    (id: string) => {
      setDeletingId(null)
      queryClient.invalidateQueries({ queryKey: ["roles"] })
      // 如果删除的是当前编辑项，关闭抽屉
      if (editing?.profile_id === id) setEditing(null)
    },
    [editing, queryClient],
  )

  const handleSaved = React.useCallback(() => {
    setEditing(null)
    setCreating(false)
    queryClient.invalidateQueries({ queryKey: ["roles"] })
  }, [queryClient])

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">角色模板</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            维护可复用的角色与声音配置。生成脚本时从中挑选 1–8 个角色。
          </p>
        </div>
        <AppButton onClick={() => setCreating(true)}>
          <Plus />
          新建角色模板
        </AppButton>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        {(["", "enabled", "disabled"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setStatus(s)
              setPage(1)
            }}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              status === s
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent/50",
            )}
          >
            {s === "" ? "全部" : s === "enabled" ? "启用" : "停用"}
          </button>
        ))}
      </div>

      {/* List */}
      {isPending ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <Loader2 className="mr-2 size-4 animate-spin" />
          加载角色模板…
        </div>
      ) : isError ? (
        <AppCard>
          <AppCardContent className="flex flex-col items-center gap-3 p-8 text-center">
            <AlertCircle className="size-6 text-destructive" />
            <p className="text-sm text-destructive">加载失败</p>
            <AppButton size="sm" variant="outline" onClick={() => refetch()}>
              重试
            </AppButton>
          </AppCardContent>
        </AppCard>
      ) : items.length === 0 ? (
        <AppCard>
          <AppCardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Mic2 className="size-12 text-muted-foreground/50" />
            <h2 className="mt-4 text-lg font-semibold">还没有角色模板</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              创建角色模板后，即可在生成脚本时选择
            </p>
            <AppButton className="mt-6" onClick={() => setCreating(true)}>
              <Plus />
              新建角色模板
            </AppButton>
          </AppCardContent>
        </AppCard>
      ) : (
        <AppCard>
          <AppCardContent className="p-0">
            <ul className="divide-y divide-border">
              {items.map((role) => (
                <li
                  key={role.profile_id}
                  className="flex flex-wrap items-center gap-3 px-5 py-4"
                >
                  <RoleAvatar name={role.name} toneIndex={hashToneIndex(role.name)} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{role.name}</span>
                      <StatusPill status={role.status} />
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {role.tts_provider} / {role.tts_model} · {role.voice_id}
                      {role.style ? ` · ${role.style}` : ""} · x{role.speed}
                      {Object.keys(role.extra_params ?? {}).length > 0 &&
                        ` · ${Object.keys(role.extra_params).length} 个额外参数`}
                    </p>
                    {role.description && (
                      <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                        {role.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <AppButton
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing(role)}
                    >
                      <Pencil className="size-3.5" />
                      编辑
                    </AppButton>
                    <AppButton
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => setDeletingId(role.profile_id)}
                    >
                      <Trash2 className="size-3.5" />
                      删除
                    </AppButton>
                  </div>
                </li>
              ))}
            </ul>
          </AppCardContent>
        </AppCard>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <AppButton
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            上一页
          </AppButton>
          <span>
            {page} / {totalPages}
          </span>
          <AppButton
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </AppButton>
        </div>
      )}

      {/* Dialog: create / edit */}
      {(creating || editing) && (
        <RoleFormDialog
          role={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={handleSaved}
        />
      )}

      {/* Delete confirm */}
      {deletingId && (
        <DeleteConfirmDialog
          roleId={deletingId}
          onClose={() => setDeletingId(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  )
}

// ============================================================
// Status pill
// ============================================================

function StatusPill({ status }: { status: RoleProfileItem["status"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "enabled"
          ? "bg-green-500/15 text-green-600 dark:text-green-500"
          : "bg-muted text-muted-foreground",
      )}
    >
      {status === "enabled" ? "启用" : "停用"}
    </span>
  )
}

// ============================================================
// Role form drawer (C-07 / C-08)
// ============================================================

interface RoleFormDialogProps {
  role: RoleProfileItem | null // null = create
  onClose: () => void
  onSaved: () => void
}

interface RoleFormState {
  name: string
  description: string
  tts_provider: string
  tts_model: string
  voice_id: string
  style: string
  speed: number
  extra_params: Record<string, unknown>
  status: "enabled" | "disabled"
}

function emptyForm(voices: VoiceItem[]): RoleFormState {
  const first = voices[0]
  return {
    name: "",
    description: "",
    tts_provider: first?.tts_provider ?? "",
    tts_model: first?.tts_model ?? "",
    voice_id: first?.voice_id ?? "",
    style: first?.default_style ?? "",
    speed: first?.speed.default ?? 1,
    extra_params: {},
    status: "enabled",
  }
}

function fromRole(role: RoleProfileItem): RoleFormState {
  return {
    name: role.name,
    description: role.description ?? "",
    tts_provider: role.tts_provider,
    tts_model: role.tts_model,
    voice_id: role.voice_id,
    style: role.style ?? "",
    speed: role.speed,
    extra_params: { ...(role.extra_params ?? {}) },
    status: role.status,
  }
}

function RoleFormDialog({ role, onClose, onSaved }: RoleFormDialogProps) {
  const isEdit = !!role
  //const queryClient = useQueryClient()

  const {
    data: voicesData,
    isPending: voicesLoading,
    isError: voicesError,
    refetch: refetchVoices,
  } = useQuery({
    queryKey: ["voices"],
    queryFn: () => configApi.voices(),
    staleTime: 5 * 60 * 1000,
  })

  const voices: VoiceItem[] = voicesData?.voices ?? []

  const [form, setForm] = React.useState<RoleFormState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({})

  // 初始化表单（等 voices 加载完成）
  React.useEffect(() => {
    if (!voices.length) return
    if (form) return
    setForm(role ? fromRole(role) : emptyForm(voices))
  }, [voices, role, form])

  const updateForm = (patch: Partial<RoleFormState>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev))
  }

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
            .filter((v) => v.tts_provider === form?.tts_provider)
            .map((v) => v.tts_model),
        ),
      ),
    [voices, form?.tts_provider],
  )
  const voicesOfProviderModel = React.useMemo(
    () =>
      voices.filter(
        (v) =>
          v.tts_provider === form?.tts_provider &&
          v.tts_model === form?.tts_model,
      ),
    [voices, form?.tts_provider, form?.tts_model],
  )

  const currentVoice = React.useMemo(
    () => voicesOfProviderModel.find((v) => v.voice_id === form?.voice_id),
    [voicesOfProviderModel, form?.voice_id],
  )

  const styles = currentVoice?.styles ?? []
  const speedCfg = currentVoice?.speed
  const extraSchema = currentVoice?.extra_parameter_schema ?? {}

  // 切换 provider
  const handleProviderChange = (provider: string) => {
    const firstModel = Array.from(
      new Set(
        voices
          .filter((v) => v.tts_provider === provider)
          .map((v) => v.tts_model),
      ),
    )[0]
    const firstVoice = voices.find(
      (v) => v.tts_provider === provider && v.tts_model === firstModel,
    )
    if (!firstVoice) return
    updateForm({
      tts_provider: provider,
      tts_model: firstModel,
      voice_id: firstVoice.voice_id,
      style: firstVoice.default_style ?? "",
      speed: firstVoice.speed.default,
      extra_params: {},
    })
  }

  const handleModelChange = (model: string) => {
    if (!form) return
    const firstVoice = voices.find(
      (v) => v.tts_provider === form.tts_provider && v.tts_model === model,
    )
    if (!firstVoice) return
    updateForm({
      tts_model: model,
      voice_id: firstVoice.voice_id,
      style: firstVoice.default_style ?? "",
      speed: firstVoice.speed.default,
      extra_params: {},
    })
  }

  const handleVoiceChange = (voiceId: string) => {
    if (!form) return
    const v = voices.find(
      (x) =>
        x.tts_provider === form.tts_provider &&
        x.tts_model === form.tts_model &&
        x.voice_id === voiceId,
    )
    if (!v) return
    updateForm({
      voice_id: voiceId,
      style: v.default_style ?? "",
      speed: v.speed.default,
      extra_params: {},
    })
  }

  // 校验
  const validate = (): { ok: boolean; errors: Record<string, string> } => {
    if (!form) return { ok: false, errors: {} }
    const errors: Record<string, string> = {}
    if (!form.name.trim() || form.name.length > 100)
      errors.name = "名称需为 1–100 字符"
    if (form.description.length > 0 && form.description.length > 500)
      errors.description = "描述最多 500 字符"
    if (!currentVoice) {
      errors.voice_id = "音色不在能力目录中"
    } else {
      if (speedCfg?.supported) {
        if (form.speed < speedCfg.min || form.speed > speedCfg.max) {
          errors.speed = `语速需在 ${speedCfg.min}–${speedCfg.max} 之间`
        }
      }
      if (form.style && !styles.includes(form.style)) {
        errors.style = "风格不在该音色支持范围内"
      }
    }
    return { ok: Object.keys(errors).length === 0, errors }
  }

  const handleSubmit = async () => {
    if (!form) return
    const { ok, errors } = validate()
    setFieldErrors(errors)
    if (!ok) return

    setSubmitting(true)
    setError(null)
    try {
      const base = {
        name: form.name.trim(),
        description: form.description.trim() ? form.description.trim() : null,
        tts_provider: form.tts_provider,
        tts_model: form.tts_model,
        voice_id: form.voice_id,
        style: form.style ? form.style : null,
        speed: form.speed,
        extra_params: sanitizeExtraParams(form.extra_params),
      }
      if (isEdit && role) {
        const body: UpdateRoleRequest = { ...base, status: form.status }
        await configApi.updateRole(role.profile_id, body)
      } else {
        const body: CreateRoleRequest = base
        await configApi.createRole(body)
      }
      onSaved()
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === "INVALID_VOICE") setFieldErrors({ voice_id: e.message })
        else if (e.code === "INVALID_AUDIO_PARAMS") setFieldErrors({ extra_params: e.message })
        else if (e.code === "INVALID_INPUT") setFieldErrors({ name: e.message })
        else setError(e.message)
      } else {
        setError("提交失败")
      }
    } finally {
      setSubmitting(false)
    }
  }

  // 兜底：voices 仍在加载
  if (!form) {
    return (
      <DialogShell title={isEdit ? "编辑角色模板" : "新建角色模板"} onClose={onClose}>
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          {voicesLoading ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              加载语音能力目录…
            </>
          ) : voicesError ? (
            <>
              <AlertCircle className="mr-2 size-4 text-destructive" />
              加载失败
              <AppButton size="sm" variant="outline" className="ml-2" onClick={() => refetchVoices()}>
                重试
              </AppButton>
            </>
          ) : (
            "暂无可用的语音能力"
          )}
        </div>
      </DialogShell>
    )
  }

  return (
    <DialogShell title={isEdit ? "编辑角色模板" : "新建角色模板"} onClose={onClose}>
      <div className="space-y-4">
        {/* 名称 / 描述 */}
        <Field label="名称" error={fieldErrors.name}>
          <input
            value={form.name}
            onChange={(e) => updateForm({ name: e.target.value })}
            className={inputClass}
            maxLength={100}
            placeholder="如：主持人"
            autoFocus
          />
        </Field>
        <Field label="描述（可选）" error={fieldErrors.description}>
          <textarea
            value={form.description}
            onChange={(e) => updateForm({ description: e.target.value })}
            rows={2}
            className={cn(inputClass, "resize-none")}
            placeholder="人设说明"
          />
        </Field>

        {/* 三级联动 */}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="TTS 提供方" error={fieldErrors.tts_provider}>
            <select
              value={form.tts_provider}
              onChange={(e) => handleProviderChange(e.target.value)}
              className={inputClass}
            >
              {providers.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="TTS 模型" error={fieldErrors.tts_model}>
            <select
              value={form.tts_model}
              onChange={(e) => handleModelChange(e.target.value)}
              className={inputClass}
            >
              {modelsOfProvider.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="音色" error={fieldErrors.voice_id}>
            <select
              value={form.voice_id}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className={inputClass}
            >
              {voicesOfProviderModel.map((v) => (
                <option key={v.voice_id} value={v.voice_id}>
                  {v.name}（{v.voice_id}）
                </option>
              ))}
            </select>
          </Field>
        </div>

        {/* 风格 / 语速 */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="风格" error={fieldErrors.style}>
            <select
              value={form.style}
              onChange={(e) => updateForm({ style: e.target.value })}
              className={inputClass}
              disabled={styles.length === 0}
            >
              <option value="">默认（使用音色默认表达）</option>
              {styles.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="语速" error={fieldErrors.speed}>
            <div>
              <input
                type="range"
                min={speedCfg?.min ?? 1}
                max={speedCfg?.max ?? 1}
                step={0.05}
                value={form.speed}
                onChange={(e) => updateForm({ speed: Number(e.target.value) })}
                disabled={!speedCfg?.supported}
                className="w-full accent-primary"
              />
              <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground">
                <span>
                  {speedCfg?.supported
                    ? `${speedCfg.min}–${speedCfg.max}`
                    : "该音色不支持语速调整"}
                </span>
                <span className="tabular-nums">x{form.speed}</span>
              </div>
            </div>
          </Field>
        </div>

        {/* 额外参数 */}
        <ExtraParamsEditor
          schema={extraSchema}
          value={form.extra_params}
          onChange={(extra) => updateForm({ extra_params: extra })}
        />

        {/* 状态（仅编辑） */}
        {isEdit && (
          <Field label="状态">
            <div className="flex gap-2">
              {(["enabled", "disabled"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => updateForm({ status: s })}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    form.status === s
                      ? "bg-primary/10 text-primary"
                      : "bg-secondary text-muted-foreground hover:bg-accent",
                  )}
                >
                  {s === "enabled" ? "启用" : "停用"}
                </button>
              ))}
            </div>
          </Field>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex justify-end gap-2 border-t border-border pt-4">
        <AppButton variant="ghost" onClick={onClose} disabled={submitting}>
          取消
        </AppButton>
        <AppButton onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Check className="mr-1 size-4" />}
          {isEdit ? "保存修改" : "创建"}
        </AppButton>
      </div>
    </DialogShell>
  )
}

// ============================================================
// Dialog shell
// ============================================================

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent/50"
            aria-label="关闭"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  )
}

// ============================================================
// Field wrapper
// ============================================================

function Field({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  )
}

// ============================================================
// Extra params editor (按 schema)
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

// ============================================================
// Delete confirm (C-09)
// ============================================================

function DeleteConfirmDialog({
  roleId,
  onClose,
  onDeleted,
}: {
  roleId: string
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await configApi.deleteRole(roleId)
      onDeleted(roleId)
    } catch (e) {
      if (e instanceof ApiError && e.code === "RESOURCE_NOT_FOUND") {
        // 已删除，幂等成功
        onDeleted(roleId)
      } else {
        setError(e instanceof ApiError ? e.message : "删除失败")
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <AlertCircle className="size-5 text-destructive" />
          <h2 className="text-base font-semibold">删除角色模板</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          删除后不能再用于新脚本。已生成的脚本角色和历史音频不受影响。
        </p>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <AppButton variant="ghost" onClick={onClose} disabled={deleting}>
            取消
          </AppButton>
          <AppButton
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting && <Loader2 className="mr-1 size-4 animate-spin" />}
            删除
          </AppButton>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Helpers
// ============================================================

const inputClass = cn(
  "w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
  "placeholder:text-muted-foreground",
  "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
  "disabled:cursor-not-allowed disabled:opacity-60",
)

/** 去掉 undefined 的额外参数；schema 只允许已知键，这里再过滤一次防脏数据 */
function sanitizeExtraParams(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v
  }
  return out
}
