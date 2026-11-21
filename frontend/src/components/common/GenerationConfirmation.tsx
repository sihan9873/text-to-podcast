// src/components/common/GenerationConfirmation.tsx
import * as React from "react"
import {
  AlertCircle,
  AudioLines,
  ChevronDown,
  Clock,
  Cpu,
  FileText,
  Info,
  Sparkles,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { AppButton } from "./AppButton"
import { estimateGeneration, TextProcessor, LANGUAGE_LABELS } from "@/lib/textProcessor"

type GenerationInfo = { text: string; kind: "script" | "audio"; title?: string }

// ============================================================
// 估算面板
// ============================================================

type EstimateProps = GenerationInfo & { compact?: boolean }

export function GenerationEstimate({ text, kind, title, compact = false }: EstimateProps) {
  const estimate = React.useMemo(() => estimateGeneration(text), [text])
  const processor = React.useMemo(() => new TextProcessor(), [])
  const timing = estimate[kind]
  const lang = LANGUAGE_LABELS[processor.detectLanguage(text).language]
  const topic = processor.detectTopic(text)
  const isScript = kind === "script"
  const KindIcon = isScript ? FileText : AudioLines
  const empty = !text.trim()

  const tokenValue = isScript ? estimate.script.totalTokens : estimate.audio.textTokens
  const tokenLabel = isScript ? "预计文本 Token" : "预计文本输入 Token"

  if (compact) {
    return (
      <div className="space-y-2.5">
        {title && (
          <p className="flex items-center gap-2 text-sm font-medium" title={title}>
            <KindIcon className="size-4 shrink-0 text-primary" />
            <span className="truncate">{title}</span>
          </p>
        )}
        {empty ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            {isScript ? "项目还没有原文，无法估算" : "脚本内容为空，无法估算"}
          </p>
        ) : (
          <>
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {estimate.characters.toLocaleString()} 字符 · {lang} · {topic}
            </p>
            <div className="space-y-2.5 rounded-xl border border-border/60 bg-secondary/20 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs text-muted-foreground">{tokenLabel}</span>
                <span className="text-base font-semibold tabular-nums">≈ {tokenValue.toLocaleString()}</span>
              </div>
              {isScript && (
                <TokenBar input={estimate.script.inputTokens} output={estimate.script.outputTokens} />
              )}
              {!isScript && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  音频输出 Token 以语音服务计费为准。
                </p>
              )}
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-xs">
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="size-3.5 text-primary/80" />
                预计生成时间（不含排队）
              </span>
              <span className="font-medium tabular-nums">{timing.minSeconds}–{timing.maxSeconds} 秒</span>
            </div>
          </>
        )}
      </div>
    )
  }

  /* ---------- 完整版（确认弹窗）：与原来一致，只把尾部换成 EstimateNotes ---------- */
  return (
    <div className="space-y-4">
      {title && <p className="truncate text-sm font-medium" title={title}>{title}</p>}

      <div className="grid grid-cols-3 gap-2">
        <Stat icon={FileText} label="字符" value={estimate.characters.toLocaleString()} />
        <Stat icon={Sparkles} label="语言" value={lang} />
        <Stat icon={Cpu} label="主题" value={topic} className="truncate" />
      </div>

      <div className="rounded-xl border border-border bg-secondary/30 p-4">
        {isScript ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">预计文本 Token</span>
              <span className="text-lg font-semibold tabular-nums">≈ {estimate.script.totalTokens.toLocaleString()}</span>
            </div>
            <TokenBar input={estimate.script.inputTokens} output={estimate.script.outputTokens} />
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-muted-foreground">预计文本输入 Token</span>
              <span className="text-lg font-semibold tabular-nums">≈ {estimate.audio.textTokens.toLocaleString()}</span>
            </div>
            <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" />
              音频输出 Token 无法仅按字数确定，实际以语音服务计费为准。
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-4 py-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Clock className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">预计生成时间（不含排队）</p>
          <p className="text-sm font-medium tabular-nums">{timing.minSeconds}–{timing.maxSeconds} 秒</p>
        </div>
      </div>

      <EstimateNotes kind={kind} />
    </div>
  )
}

/** 免责声明 + 估算假设。弹窗里跟着单个估算显示；侧栏里整页只放一份（不传 kind） */
export function EstimateNotes({ kind }: { kind?: "script" | "audio" }) {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
        <AlertCircle className="mt-0.5 size-3 shrink-0" />
        <span>
          本地粗略估算，非实际用量或计费依据。模型、提示词、角色数、并发和网络均会影响结果。
          {kind === "script" && "脚本 Token 按字符当量估算。"}
          {kind === "audio" && "音频按文字输入当量估算，部分语音服务按字符或时长计费。"}
          {!kind && "脚本按字符当量估算；音频按文字输入当量估算，部分语音服务按字符或时长计费。"}
        </span>
      </p>
      <details className="group rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11px] text-muted-foreground">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium marker:content-none">
          估算假设
          <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
        </summary>
        <p className="mt-2 leading-relaxed">
          每个非空白 ASCII 字符按 0.3 Token、其他字符按 1.5 Token；脚本额外预留 800 输入
          Token，输出为原文 Token 的 1.2 倍，输出速率假设 20–60 Token/秒。音频生成耗时假设为
          朗读时长的 10%–50%，另加 5–20 秒处理开销。未包含重试。
        </p>
      </details>
    </div>
  )
}

function Stat({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType
  label: string
  value: string
  className?: string
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-secondary/30 px-2.5 py-2">
      <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </p>
      <p
        className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", className)}
        title={value}
      >
        {value}
      </p>
    </div>
  )
}

function TokenBar({ input, output }: { input: number; output: number }) {
  const total = Math.max(input + output, 1)
  const inPct = (input / total) * 100
  return (
    <div className="space-y-1.5">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${inPct}%` }}
          title={`输入 ${input.toLocaleString()}`}
        />
        <div
          className="h-full bg-sky-400/70 transition-all"
          style={{ width: `${100 - inPct}%` }}
          title={`输出 ${output.toLocaleString()}`}
        />
      </div>
      <div className="flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-primary" />
          输入 {input.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-sky-400/70" />
          输出 {output.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

// ============================================================
// 确认对话框 hook
// ============================================================

export function useGenerationConfirmation() {
  const [info, setInfo] = React.useState<GenerationInfo | null>(null)
  const resolver = React.useRef<((accepted: boolean) => void) | null>(null)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const confirmRef = React.useRef<HTMLButtonElement>(null)

  const finish = React.useCallback((accepted: boolean) => {
    resolver.current?.(accepted)
    resolver.current = null
    setInfo(null)
  }, [])

  React.useEffect(() => {
    const el = dialogRef.current
    if (!info) {
      el?.close()
      return
    }
    if (!el?.open) el?.showModal()
    // 打开后聚焦主操作
    const t = window.setTimeout(() => confirmRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [info])

  // 组件卸载时拒绝未决 Promise
  React.useEffect(() => () => { resolver.current?.(false); resolver.current = null }, [])

  const confirm = React.useCallback(
    (next: GenerationInfo) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false)
        resolver.current = resolve
        setInfo(next)
      }),
    [],
  )

  const onBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    // 仅当点击 dialog 本体（非内容区）时视为取消
    if (e.target === dialogRef.current) finish(false)
  }

  const dialog = info ? (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        finish(false)
      }}
      onClick={onBackdropClick}
      aria-labelledby="generation-confirm-title"
      aria-describedby="generation-confirm-desc"
      className={cn(
        "fixed inset-0 m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-0 text-foreground shadow-2xl",
        "backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        "open:animate-in open:fade-in open:zoom-in-95",
      )}
    >
      <div className="space-y-4 p-6">
        {/* 头部 */}
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            {info.kind === "script" ? (
              <FileText className="size-5" />
            ) : (
              <AudioLines className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <h2
              id="generation-confirm-title"
              className="text-lg font-semibold tracking-tight"
            >
              确认生成{info.kind === "script" ? "脚本" : "音频"}
            </h2>
            <p
              id="generation-confirm-desc"
              className="mt-0.5 text-xs text-muted-foreground"
            >
              生成将消耗模型额度，请先确认下方估算。
            </p>
          </div>
        </div>

        {/* 估算 */}
        <GenerationEstimate {...info} />

        {/* 操作 */}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <AppButton
            ref={cancelRef}
            variant="outline"
            onClick={() => finish(false)}
          >
            取消
          </AppButton>
          <AppButton ref={confirmRef} onClick={() => finish(true)}>
            <Sparkles />
            确认生成
          </AppButton>
        </div>
      </div>
    </dialog>
  ) : null

  return { confirm, dialog }
}