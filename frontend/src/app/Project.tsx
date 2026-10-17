// src/Project.tsx
import * as React from "react"
import { FileText } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard, AppCardContent } from "@/components/common/AppCard"

import { AudioStatusBadge } from "./Audio"

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
  const [pasteContent, setPasteContent] = React.useState("")
  const [showPaste, setShowPaste] = React.useState(false)

  const hasVersions = project.scriptVersions.length > 0
  const hasContent = project.content.trim().length > 0

  const updateProject = (updates: Partial<Project>) => {
    const updated = { ...project, ...updates }
    queryClient.setQueryData<Project>(["project", project.id], updated)
    queryClient.setQueryData<Project[]>(["projects"], (prev = []) =>
      prev.map((p) => (p.id === project.id ? { ...p, ...updates } : p))
    )
  }

  const handleSaveName = () => {
    if (nameDraft.trim()) {
      updateProject({
        name: nameDraft.trim(),
        updatedAt: new Date().toISOString(),
      })
    }
    setEditingName(false)
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      createFirstVersion(text)
    }
    reader.readAsText(file)
  }

  const handlePasteSubmit = () => {
    if (!pasteContent.trim()) return
    createFirstVersion(pasteContent)
  }

  const createFirstVersion = (sourceText: string) => {
    const newVersion: ScriptVersion = {
      id: `version-${Date.now()}`,
      projectId: project.id,
      version: 1,
      name: "《初稿》",
      content: sourceText,
      type: "user",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    updateProject({
      content: sourceText,
      scriptVersions: [newVersion, ...project.scriptVersions],
      updatedAt: new Date().toISOString(),
    })
    setShowPaste(false)
    setPasteContent("")
    onNavigate(`/projects/${project.id}/scripts/${newVersion.id}`)
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
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">原文</h2>
            <span className="text-xs text-muted-foreground">
              {hasContent ? "已上传" : "未上传"}
            </span>
          </div>
          {hasContent ? (
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg bg-secondary/30 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {project.content}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              上传或粘贴你的原文，作为生成脚本的基础。
            </p>
          )}
          {hasContent && (
            <p className="mt-2 text-xs text-muted-foreground">
              原文已上传，不可修改。如需更换原文，请创建新项目。
            </p>
          )}
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
                上传 TXT 文件或粘贴原文，开始创建第一个版本
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                <label>
                  <input
                    type="file"
                    accept=".txt"
                    className="sr-only"
                    onChange={handleFileUpload}
                  />
                  <AppButton asChild>
                    <span>
                      <FileText />
                      上传 TXT
                    </span>
                  </AppButton>
                </label>
                <AppButton
                  variant="outline"
                  onClick={() => setShowPaste((v) => !v)}
                >
                  粘贴原文
                </AppButton>
              </div>

              {showPaste && (
                <div className="mt-4 w-full max-w-lg space-y-3 text-left">
                  <textarea
                    value={pasteContent}
                    onChange={(e) => setPasteContent(e.target.value)}
                    placeholder="在此粘贴原文内容…"
                    rows={6}
                    className={cn(
                      "w-full rounded-lg border border-input bg-card px-3 py-2 text-sm",
                      "placeholder:text-muted-foreground",
                      "focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    )}
                  />
                  <div className="flex justify-end gap-2">
                    <AppButton
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowPaste(false)
                        setPasteContent("")
                      }}
                    >
                      取消
                    </AppButton>
                    <AppButton
                      size="sm"
                      onClick={handlePasteSubmit}
                      disabled={!pasteContent.trim()}
                    >
                      创建版本
                    </AppButton>
                  </div>
                </div>
              )}
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
