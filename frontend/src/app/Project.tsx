// src/Project.tsx
import * as React from "react"
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  RotateCcw,
  Upload,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import { AudioStatusBadge } from "./Audio"
import { updateProject as saveProject } from "@/features/projects/api"
import {
  RECOMMENDED_SOURCE_CHARACTERS,
  getSourceInputErrorMessage,
  readSourceTextFile,
  validateSourceText,
} from "@/features/source-input/validation"

import type { Project } from "@/types/project"
import type { ScriptVersion } from "@/types/script"
import type { AudioVersion } from "@/types/audio"

// ============================================================
// Badges
// ============================================================

export function TypeBadge({ type }: { type: ScriptVersion["type"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        type === "user"
          ? "bg-blue-500/15 text-blue-500"
          : "bg-purple-500/15 text-purple-500"
      )}
    >
      {type === "user" ? "用户编辑版" : "AI 修改版"}
    </span>
  )
}

export function StatusBadge({ status }: { status: ScriptVersion["status"] }) {
  const config = {
    draft: { label: "草稿", className: "bg-muted text-muted-foreground" },
    pending: {
      label: "待确认",
      className: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-500",
    },
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
        className
      )}
    >
      {label}
    </span>
  )
}

// ============================================================
// Audio status cell (reads project.audioVersions)
// ============================================================

function AudioStatusCell({
  projectId,
  scriptVersionId,
  audioVersions,
  onNavigate,
}: {
  projectId: string
  scriptVersionId: string
  audioVersions: AudioVersion[]
  onNavigate: (href: string) => void
}) {
  // 找到该脚本版本的最新音频
  const latest: AudioVersion | undefined = audioVersions
    .filter((a) => a.scriptVersionId === scriptVersionId)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0]

  const href = `/projects/${projectId}/scripts/${scriptVersionId}/audio`

  if (!latest) {
    return (
      <button
        onClick={() => onNavigate(href)}
        className="text-xs text-primary hover:underline"
      >
        生成音频
      </button>
    )
  }

  return (
    <button onClick={() => onNavigate(href)}>
      <AudioStatusBadge status={latest.status} />
    </button>
  )
}

// ============================================================
// Project page
// ============================================================

export interface ProjectPageProps {
  project: Project
  onNavigate: (href: string) => void
}

export default function ProjectPage({
  project,
  onNavigate,
}: ProjectPageProps) {
  const queryClient = useQueryClient()
  const [editingName, setEditingName] = React.useState(false)
  const [nameDraft, setNameDraft] = React.useState(project.name)
  const [sourceDraft, setSourceDraft] = React.useState(project.content)
  const [sourceTouched, setSourceTouched] = React.useState(false)
  const [selectedFileName, setSelectedFileName] = React.useState<string | null>(null)
  const [sourceError, setSourceError] = React.useState<string | null>(null)
  const [sourceMessage, setSourceMessage] = React.useState<string | null>(null)
  const [readingFile, setReadingFile] = React.useState(false)
  const [savingSource, setSavingSource] = React.useState(false)
  const [acceptLongSource, setAcceptLongSource] = React.useState(false)

  const hasVersions = project.scriptVersions.length > 0
  const hasContent = project.content.trim().length > 0
  const sourceValidation = React.useMemo(
    () => validateSourceText(sourceDraft),
    [sourceDraft]
  )
  const sourceChanged = sourceDraft !== project.content
  const isOverRecommendedLength = sourceValidation.warnings.length > 0

  const cacheProject = (updated: Project) => {
    queryClient.setQueryData<Project>(["project", project.id], updated)
    queryClient.setQueryData<Project[]>(["projects"], (prev = []) =>
      prev.map((p) => (p.id === project.id ? updated : p))
    )
  }

  const handleSaveName = async () => {
    const nextName = nameDraft.trim()
    if (!nextName || nextName === project.name) {
      setEditingName(false)
      return
    }

    try {
      const updated = await saveProject(project.id, { name: nextName })
      cacheProject(updated)
      setSourceError(null)
    } catch (error) {
      setSourceError(getSourceInputErrorMessage(error))
    }
    setEditingName(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setReadingFile(true)
    setSourceError(null)
    setSourceMessage(null)
    setAcceptLongSource(false)
    try {
      const text = await readSourceTextFile(file)
      setSourceDraft(text)
      setSelectedFileName(file.name)
      setSourceTouched(true)
      setSourceMessage(`已读取 ${file.name}，请检查内容后保存。`)
    } catch (error) {
      setSelectedFileName(null)
      setSourceError(getSourceInputErrorMessage(error))
    } finally {
      setReadingFile(false)
      e.target.value = ""
    }
  }

  const handleSourceChange = (value: string) => {
    setSourceDraft(value)
    setSourceTouched(true)
    setSourceError(null)
    setSourceMessage(null)
    setAcceptLongSource(false)
  }

  const handleResetSource = () => {
    setSourceDraft(project.content)
    setSelectedFileName(null)
    setSourceTouched(false)
    setSourceError(null)
    setSourceMessage(null)
    setAcceptLongSource(false)
  }

  const handleSaveSource = async () => {
    setSourceTouched(true)
    setSourceError(null)
    setSourceMessage(null)

    if (sourceValidation.errors.length > 0) {
      setSourceError(sourceValidation.errors[0].message)
      return
    }
    if (isOverRecommendedLength && !acceptLongSource) {
      setSourceError("请先确认保留超过 5000 字的完整原文。")
      return
    }

    setSavingSource(true)
    try {
      const updated = await saveProject(project.id, { content: sourceDraft })
      cacheProject(updated)
      setSourceTouched(false)
      setSelectedFileName(null)
      setSourceMessage("原文已通过项目接口保存，内容未被截断。")
    } catch (error) {
      setSourceError(getSourceInputErrorMessage(error))
    } finally {
      setSavingSource(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Project header */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName()
                  if (e.key === "Escape") {
                    setNameDraft(project.name)
                    setEditingName(false)
                  }
                }}
                autoFocus
                className={cn(
                  "h-10 w-full max-w-md rounded-lg border border-input bg-card px-3 text-lg font-semibold",
                  "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                )}
              />
              <AppButton size="sm" onClick={handleSaveName}>
                保存
              </AppButton>
              <AppButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNameDraft(project.name)
                  setEditingName(false)
                }}
              >
                取消
              </AppButton>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">
                {project.name}
              </h1>
              <AppButton
                size="sm"
                variant="ghost"
                onClick={() => {
                  setNameDraft(project.name)
                  setEditingName(true)
                }}
              >
                重命名
              </AppButton>
            </div>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            创建于 {new Date(project.createdAt).toLocaleDateString("zh-CN")}
          </p>
        </div>
      </div>

      {/* Original text section */}
      <AppCard>
        <AppCardContent className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">原文输入</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                上传 UTF-8 编码的 TXT，或直接粘贴并编辑完整原文。
              </p>
            </div>
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium",
                hasContent
                  ? "bg-green-500/15 text-green-600 dark:text-green-500"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {hasContent ? "已保存" : "未保存"}
            </span>
          </div>

          <div className="mt-5 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label>
                <input
                  type="file"
                  accept=".txt,text/plain"
                  className="sr-only"
                  onChange={handleFileUpload}
                  disabled={readingFile || savingSource}
                />
                <AppButton asChild variant="outline">
                  <span>
                    <Upload />
                    {readingFile ? "正在读取…" : "选择 TXT"}
                  </span>
                </AppButton>
              </label>
              <span className="text-xs text-muted-foreground">
                最大 100 KB，仅支持有效 UTF-8 编码
              </span>
              {selectedFileName && (
                <span className="text-xs font-medium text-foreground">
                  已选择：{selectedFileName}
                </span>
              )}
            </div>

            <div>
              <label htmlFor="source-content" className="sr-only">
                原文内容
              </label>
              <textarea
                id="source-content"
                value={sourceDraft}
                onChange={(event) => handleSourceChange(event.target.value)}
                onPaste={() => setSourceTouched(true)}
                placeholder="在这里粘贴原文，或先选择 TXT 文件…"
                rows={12}
                className={cn(
                  "w-full resize-y rounded-lg border bg-card px-4 py-3 text-sm leading-relaxed",
                  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                  sourceTouched && sourceValidation.errors.length > 0
                    ? "border-destructive focus-visible:border-destructive"
                    : "border-input focus-visible:border-primary/60"
                )}
                aria-invalid={sourceTouched && sourceValidation.errors.length > 0}
                aria-describedby="source-help source-feedback"
                disabled={savingSource}
              />
              <div
                id="source-help"
                className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span className="text-muted-foreground">
                  保存前可以继续修改；系统不会自动截断原文。
                </span>
                <span
                  className={cn(
                    "font-medium tabular-nums",
                    isOverRecommendedLength
                      ? "text-yellow-600 dark:text-yellow-500"
                      : "text-muted-foreground"
                  )}
                >
                  {sourceValidation.characterCount.toLocaleString("zh-CN")} /{" "}
                  {RECOMMENDED_SOURCE_CHARACTERS.toLocaleString("zh-CN")} 字建议上限
                </span>
              </div>
            </div>

            {isOverRecommendedLength && (
              <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm">
                <div className="flex items-start gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <div className="space-y-2">
                    <p>{sourceValidation.warnings[0].message}</p>
                    <label className="flex cursor-pointer items-start gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={acceptLongSource}
                        onChange={(event) => {
                          setAcceptLongSource(event.target.checked)
                          setSourceError(null)
                        }}
                        className="mt-0.5"
                      />
                      我确认保留并保存超过建议长度的完整原文
                    </label>
                  </div>
                </div>
              </div>
            )}

            {sourceChanged && hasVersions && (
              <p className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
                当前项目已有脚本版本。保存新原文不会改写历史脚本；后续需要由大模型模块基于新原文生成新版本。
              </p>
            )}

            <div id="source-feedback" aria-live="polite">
              {(sourceError ||
                (sourceTouched && sourceValidation.errors[0]?.message)) && (
                <p className="flex items-start gap-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  {sourceError ?? sourceValidation.errors[0].message}
                </p>
              )}
              {sourceMessage && !sourceError && (
                <p className="flex items-start gap-2 text-sm text-green-600 dark:text-green-500">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  {sourceMessage}
                </p>
              )}
            </div>

            <div className="flex flex-wrap justify-end gap-3">
              <AppButton
                variant="ghost"
                onClick={handleResetSource}
                disabled={!sourceChanged || savingSource}
              >
                <RotateCcw />
                撤销修改
              </AppButton>
              <AppButton
                onClick={handleSaveSource}
                disabled={
                  !sourceChanged ||
                  readingFile ||
                  savingSource ||
                  sourceValidation.errors.length > 0 ||
                  (isOverRecommendedLength && !acceptLongSource)
                }
              >
                {savingSource ? "正在保存…" : "保存原文"}
              </AppButton>
            </div>
          </div>
        </AppCardContent>
      </AppCard>

      {/* Script versions */}
      <AppCard>
        <AppCardContent className="p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">脚本版本</h2>
            <span className="text-xs text-muted-foreground">
              {project.scriptVersions.length} 个版本
            </span>
          </div>

          {!hasVersions ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
              <FileText className="size-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium">还没有脚本版本</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasContent
                  ? "原文已保存，等待大模型脚本生成模块创建第一个版本"
                  : "请先在上方上传、粘贴或编辑原文并保存"}
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">版本号</th>
                    <th className="px-4 py-3 font-medium">脚本名称</th>
                    <th className="px-4 py-3 font-medium">创建时间</th>
                    <th className="px-4 py-3 font-medium">版本类型</th>
                    <th className="px-4 py-3 font-medium">状态</th>
                    <th className="px-4 py-3 font-medium">音频</th>
                    <th className="px-4 py-3 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {project.scriptVersions.map((version) => (
                    <tr
                      key={version.id}
                      className="border-t border-border transition-colors hover:bg-accent/50"
                    >
                      <td className="px-4 py-3 font-medium">
                        V{version.version}
                      </td>
                      <td className="px-4 py-3">{version.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(version.createdAt).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        <TypeBadge
                          type={
                            // types/script.ts 中没有 type 字段时，按是否有 confirmedAt 推断
                            version.confirmedAt ? "user" : "user"
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={version.status} />
                      </td>
                      <td className="px-4 py-3">
                        <AudioStatusCell
                          projectId={project.id}
                          scriptVersionId={version.id}
                          audioVersions={project.audioVersions}
                          onNavigate={onNavigate}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <AppButton
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            onNavigate(
                              `/projects/${project.id}/scripts/${version.id}`
                            )
                          }
                        >
                          查看
                        </AppButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AppCardContent>
      </AppCard>
    </div>
  )
}
