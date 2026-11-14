import * as React from "react"
import { Clock3, Eye, FileText, Loader2, Upload } from "lucide-react"

import { ApiError, projectsApi } from "@/api"
import type {
  SegmentationMode,
  SourcePreview,
  SourceType,
  SubmitSourceRequest,
} from "@/api/types"
import { AppButton } from "@/components/common/AppButton"
import { cn } from "@/lib/utils"

import {
  getSourceInputErrorMessage,
  readSourceDocumentFile,
  validateSourceText,
} from "./validation"

function durationLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
}

export function SourceInputPanel({
  projectId,
  onSubmitted,
}: {
  projectId: string
  onSubmitted: () => void | Promise<void>
}) {
  const [text, setText] = React.useState("")
  const [sourceType, setSourceType] = React.useState<SourceType>("text")
  const [sourceName, setSourceName] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<SegmentationMode>("paragraph")
  const [targetMinutes, setTargetMinutes] = React.useState(5)
  const [charsPerMinute, setCharsPerMinute] = React.useState(240)
  const [preview, setPreview] = React.useState<SourcePreview | null>(null)
  const [busy, setBusy] = React.useState<"preview" | "submit" | "file" | null>(null)
  const [dragging, setDragging] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const validation = React.useMemo(() => validateSourceText(text), [text])
  const invalidatePreview = () => setPreview(null)
  const body = React.useCallback((): SubmitSourceRequest => ({
    text,
    source_type: sourceType,
    source_name: sourceName,
    segmentation_mode: mode,
    target_minutes: targetMinutes,
    chars_per_minute: charsPerMinute,
  }), [charsPerMinute, mode, sourceName, sourceType, targetMinutes, text])

  const loadFile = async (file: File) => {
    setBusy("file")
    setError(null)
    try {
      const document = await readSourceDocumentFile(file)
      setText(document.text)
      setSourceType(document.sourceType)
      setSourceName(document.sourceName)
      setPreview(null)
    } catch (cause) {
      setError(getSourceInputErrorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  const requestPreview = async () => {
    if (validation.errors.length) {
      setError(validation.errors[0].message)
      return
    }
    setBusy("preview")
    setError(null)
    try {
      setPreview(await projectsApi.previewSource(projectId, body()))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "分段预览失败，请重试。")
    } finally {
      setBusy(null)
    }
  }

  const submit = async () => {
    if (!preview) return
    if (!window.confirm(`将提交并锁定完整原文及 ${preview.chunk_count} 个分段，提交后不可修改。是否继续？`)) return
    setBusy("submit")
    setError(null)
    try {
      await projectsApi.submitSource(projectId, body())
      await onSubmitted()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "原文提交失败，请重试。")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 space-y-5">
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,text/plain,text/markdown"
        className="hidden"
        disabled={busy !== null}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file) void loadFile(file)
        }}
      />

      <button
        type="button"
        disabled={busy !== null}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy" }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer.files.length !== 1) {
            setError("请一次上传一个 TXT 或 Markdown 文件。")
            return
          }
          void loadFile(event.dataTransfer.files[0])
        }}
        className={cn(
          "flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-7 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
          dragging ? "border-primary bg-primary/10" : "border-border bg-secondary/20 hover:border-primary/50 hover:bg-primary/5",
        )}
      >
        <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {busy === "file" ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
        </span>
        <span className="text-sm font-medium">
          {dragging ? "松开以上传文件" : "拖拽 TXT / Markdown 到这里，或点击选择文件"}
        </span>
        <span className="text-xs text-muted-foreground">支持 .txt、.md、.markdown，UTF-8 编码，单个文件不超过 2 MB</span>
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-secondary/30 p-1">
          {(["text", "markdown"] as const).map((type) => (
            <button
              type="button"
              key={type}
              onClick={() => { setSourceType(type); setSourceName(null); invalidatePreview() }}
              className={cn("rounded-md px-3 py-1.5 text-xs font-medium", sourceType === type ? "bg-card text-foreground shadow-sm" : "text-muted-foreground")}
            >
              {type === "text" ? "粘贴纯文本" : "粘贴 Markdown"}
            </button>
          ))}
        </div>
        {sourceName && <span className="text-xs text-muted-foreground">已读取：{sourceName}</span>}
      </div>

      <div>
        <textarea
          value={text}
          onChange={(event) => { setText(event.target.value); setSourceName(null); invalidatePreview() }}
          placeholder={sourceType === "markdown" ? "粘贴 Markdown 内容，标题、列表和代码块会被保留……" : "粘贴长文本，使用空行分隔自然段……"}
          rows={10}
          disabled={busy !== null}
          className="w-full rounded-lg border border-input bg-card px-3 py-2 font-mono text-sm leading-relaxed placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <div className="mt-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <span>{validation.characterCount.toLocaleString("zh-CN")} / 100,000 字符</span>
          <span>{sourceType === "markdown" ? "Markdown 标记会保留，时长估算会忽略格式符" : "空行用于识别自然段"}</span>
        </div>
        {validation.errors.map((issue) => <p key={issue.code} className="mt-1 text-sm text-destructive">{issue.message}</p>)}
        {validation.warnings.map((issue) => <p key={issue.code} className="mt-1 text-sm text-amber-600">{issue.message}</p>)}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">分段方式</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {([
            ["paragraph", "按自然段", "每个自然段形成一个分段；超长段落在句子边界继续切分。"],
            ["duration", "按预计时长", "在自然段边界组合内容，使每段接近指定朗读时长。"],
          ] as const).map(([value, label, description]) => (
            <label key={value} className={cn("cursor-pointer rounded-lg border p-3", mode === value ? "border-primary bg-primary/5" : "border-border")}>
              <span className="flex items-center gap-2 text-sm font-medium">
                <input type="radio" name="segmentation-mode" checked={mode === value} onChange={() => { setMode(value); invalidatePreview() }} />
                {label}
              </span>
              <span className="mt-1 block pl-5 text-xs leading-relaxed text-muted-foreground">{description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === "duration" && (
          <label className="text-sm">
            <span className="mb-1 block font-medium">每段预计时长</span>
            <select value={targetMinutes} onChange={(event) => { setTargetMinutes(Number(event.target.value)); invalidatePreview() }} className="h-10 w-full rounded-lg border border-input bg-card px-3">
              {[1, 2, 3, 5, 8, 10, 15].map((value) => <option key={value} value={value}>{value} 分钟</option>)}
            </select>
          </label>
        )}
        <label className="text-sm">
          <span className="mb-1 block font-medium">预计朗读速度</span>
          <select value={charsPerMinute} onChange={(event) => { setCharsPerMinute(Number(event.target.value)); invalidatePreview() }} className="h-10 w-full rounded-lg border border-input bg-card px-3">
            <option value={180}>舒缓 · 180 字/分钟</option>
            <option value={240}>正常 · 240 字/分钟</option>
            <option value={300}>较快 · 300 字/分钟</option>
          </select>
        </label>
      </div>

      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex flex-wrap justify-end gap-2">
        <AppButton variant="outline" onClick={() => void requestPreview()} disabled={busy !== null || validation.errors.length > 0}>
          {busy === "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
          预览分段
        </AppButton>
        <AppButton onClick={() => void submit()} disabled={busy !== null || !preview}>
          {busy === "submit" && <Loader2 className="animate-spin" />}
          确认提交并锁定
        </AppButton>
      </div>

      {preview && (
        <section className="space-y-3 rounded-xl border border-border bg-secondary/15 p-4" aria-label="分段预览">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold">分段预览</h3>
              <p className="mt-1 text-xs text-muted-foreground">检查顺序和边界后再确认提交。</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-secondary px-2.5 py-1"><FileText className="mr-1 inline size-3" />{preview.chunk_count} 段</span>
              <span className="rounded-full bg-secondary px-2.5 py-1"><Clock3 className="mr-1 inline size-3" />约 {durationLabel(preview.estimated_seconds)}</span>
            </div>
          </div>
          <div className="max-h-[28rem] space-y-2 overflow-y-auto pr-1">
            {preview.chunks.map((chunk) => (
              <details key={chunk.sequence} className="rounded-lg border border-border bg-card px-3 py-2" open={preview.chunks.length <= 5}>
                <summary className="cursor-pointer text-sm font-medium">
                  第 {chunk.sequence} 段
                  <span className="ml-2 font-normal text-muted-foreground">{chunk.character_count} 字符 · 约 {durationLabel(chunk.estimated_seconds)}</span>
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted-foreground">{chunk.text}</pre>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
