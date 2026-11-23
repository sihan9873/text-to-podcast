import * as React from "react"
import { AppButton } from "./AppButton"
import { checkText, applySuggestion, type CheckResult, type LTMatch } from "@/lib/textProcessor"

export function useGrammarCheck(text: string, disabled: boolean, edited: boolean, composing: boolean) {
  const [enabled, setEnabled] = React.useState(false)
  const [result, setResult] = React.useState<CheckResult | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  React.useEffect(() => {
    setBusy(false)
    setError(null)
    setResult(null)
    if (!enabled || disabled || !edited || composing || !text.trim()) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setBusy(true)
      try {
        const language = /\p{Script=Han}/u.test(text) ? "zh-CN" : "en-US"
        const next = await checkText(text, language, undefined, controller.signal)
        if (!controller.signal.aborted) setResult(next)
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "语法检查暂时不可用")
      } finally { if (!controller.signal.aborted) setBusy(false) }
    }, 1200)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [text, disabled, edited, composing, enabled])
  return { enabled, enable: () => setEnabled(true), matches: !disabled && !composing && result?.originalText === text ? result.matches : [], busy, error }
}

export function GrammarHighlights({ text, matches }: { text: string; matches: LTMatch[] }) {
  const pieces: React.ReactNode[] = []
  let cursor = 0
  for (const [index, match] of [...matches].sort((a, b) => a.offset - b.offset).entries()) {
    const start = match.length ? match.offset : Math.max(0, match.offset - 1)
    const end = match.length ? match.offset + match.length : Math.min(text.length, start + 1)
    if (start < cursor) continue
    pieces.push(text.slice(cursor, start))
    pieces.push(<mark key={index} className="bg-destructive/10 text-transparent underline decoration-destructive decoration-wavy underline-offset-4">{text.slice(start, end)}</mark>)
    cursor = end
  }
  pieces.push(text.slice(cursor), "\n")
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words text-sm leading-relaxed text-transparent" style={{ overflowWrap: "break-word" }}>{pieces}</div>
}

export function GrammarCheck({ text, disabled, matches, busy, error, enabled, enable, onChange }: {
  enabled: boolean; enable: () => void; text: string; disabled: boolean; matches: LTMatch[]; busy: boolean; error: string | null; onChange: (text: string) => void
}) {
  if (disabled) return null
  if (!enabled) return <button type="button" className="mt-1 text-xs text-muted-foreground hover:text-primary"
    title="启用后会将编辑过的当前句子发送至 LanguageTool 在线服务进行语法检查" onClick={enable}>启用在线语法检查</button>
  return <div className="mt-1 text-xs text-muted-foreground">
    <span role="status">{busy ? "正在检查语法…" : error ?? (matches.length ? `发现 ${matches.length} 处语法建议` : "")}</span>
    {matches.length > 0 && <details className="mt-1">
      <summary className="cursor-pointer">查看修改建议</summary>
      <div className="space-y-2 rounded-lg border border-border p-2">
        {matches.map((match, index) => <div key={index}>
          <p>{match.message} · <span className="text-foreground">{text.slice(match.offset, match.offset + match.length) || "插入位置"}</span></p>
          <div className="mt-1 flex flex-wrap gap-1">{match.replacements.slice(0, 5).map((replacement, i) => <AppButton key={i} size="sm" variant="secondary" onClick={() => onChange(applySuggestion(text, match, i))}>{replacement.value || "删除"}</AppButton>)}</div>
        </div>)}
      </div>
    </details>}
  </div>
}