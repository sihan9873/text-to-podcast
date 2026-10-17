// src/Script.tsx
import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"

import { cn } from "@/lib/utils"
import { AppButton } from "@/components/common/AppButton"
import { AppCard } from "@/components/common/AppCard"

import { TypeBadge, StatusBadge } from "./Project"

import type { Project } from "@/types/project"
import type { ScriptVersion } from "@/types/script"

// ============================================================
// Script page
// ============================================================

export interface ScriptPageProps {
  project: Project
  versionId: string
  onNavigate: (href: string) => void
}

/** 把完整 TXT 拆成段落 -> 句子，用于逐句编辑展示 */
interface Sentence {
  id: string
  text: string
}
interface Paragraph {
  id: string
  sentences: Sentence[]
}

function splitIntoSentences(text: string): Sentence[] {
  // 按中英文句末标点切分，保留标点
  const parts = text
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean)
  return (parts.length ? parts : [text.trim()].filter(Boolean)).map(
    (s, i) => ({ id: `s-${i}`, text: s })
  )
}

function parseContent(content: string): Paragraph[] {
  return content
    .split(/\n{2,}|\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({
      id: `p-${i}`,
      sentences: splitIntoSentences(p),
    }))
}

function serialize(paragraphs: Paragraph[]): string {
  return paragraphs
    .map((p) => p.sentences.map((s) => s.text).join(""))
    .join("\n\n")
}

export default function ScriptPage({
  project,
  versionId,
  onNavigate,
}: ScriptPageProps) {
  const queryClient = useQueryClient()
  const version = project.scriptVersions.find((v) => v.id === versionId)
  const [saving, setSaving] = React.useState(false)

  // 用版本内容初始化段落（必须在 hooks 之前处理 version 缺失的渲染）
  const initialParagraphs = React.useMemo(
    () => parseContent(version?.content ?? ""),
    [version?.content]
  )
  const [editedScript, setEditedScript] =
    React.useState<Paragraph[]>(initialParagraphs)

  // version 变化时重置编辑区
  React.useEffect(() => {
    setEditedScript(initialParagraphs)
  }, [initialParagraphs])

  if (!version) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="text-2xl font-semibold">版本不存在</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          找不到该脚本版本，可能已被删除
        </p>
        <AppButton
          className="mt-6"
          onClick={() => onNavigate(`/projects/${project.id}`)}
        >
          返回项目
        </AppButton>
      </div>
    )
  }

  const isLatest = project.scriptVersions[0]?.id === version.id
  const isEditable = version.type === "user" && version.status === "draft"
  const isReadOnly = !isEditable
  const canConfirm = isLatest && version.status !== "confirmed"

  const updateSentence = (pIdx: number, sIdx: number, text: string) => {
    setEditedScript((prev) => {
      const next = prev.map((p) => ({
        ...p,
        sentences: p.sentences.map((s) => ({ ...s })),
      }))
      next[pIdx].sentences[sIdx].text = text
      return next
    })
  }

  const replaceVersion = (updates: Partial<ScriptVersion>) => {
    const apply = (p: Project): Project => ({
      ...p,
      updatedAt: new Date().toISOString(),
      scriptVersions: p.scriptVersions.map((v) =>
        v.id === version.id ? { ...v, ...updates } : v
      ),
    })
    queryClient.setQueryData<Project>(["project", project.id], (current) =>
      apply(current ?? project)
    )
    queryClient.setQueryData<Project[]>(["projects"], (current = []) =>
      current.map((p) => (p.id === project.id ? apply(p) : p))
    )
  }

  const prependVersion = (newVersion: ScriptVersion) => {
    const apply = (p: Project): Project => ({
      ...p,
      updatedAt: new Date().toISOString(),
      scriptVersions: [newVersion, ...p.scriptVersions],
    })
    queryClient.setQueryData<Project>(["project", project.id], (current) =>
      apply(current ?? project)
    )
    queryClient.setQueryData<Project[]>(["projects"], (current = []) =>
      current.map((p) => (p.id === project.id ? apply(p) : p))
    )
  }

  // TODO: replace with scripts.ts updateScript()
  const handleSave = () => {
    setSaving(true)
    const content = serialize(editedScript)
    setTimeout(() => {
      setSaving(false)
      replaceVersion({
        content,
        updatedAt: new Date().toISOString(),
      })
    }, 400)
  }

  // TODO: replace with createScript() + AI 任务接口
  const handleSubmitToAI = () => {
    const nextNumber =
      Math.max(0, ...project.scriptVersions.map((v) => v.version)) + 1
    const newVersion: ScriptVersion = {
      id: `version-${Date.now()}`,
      projectId: project.id,
      version: nextNumber,
      name: `${version.name}（AI 修改版）`,
      content: version.content,
      type: "ai",
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    prependVersion(newVersion)
    onNavigate(`/projects/${project.id}/scripts/${newVersion.id}`)
  }

  // TODO: replace with createScript()
  const handleCreateEditable = () => {
    const nextNumber =
      Math.max(0, ...project.scriptVersions.map((v) => v.version)) + 1
    const newVersion: ScriptVersion = {
      id: `version-${Date.now()}`,
      projectId: project.id,
      version: nextNumber,
      name: `${version.name}（新版本）`,
      content: serialize(editedScript),
      type: "user",
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    prependVersion(newVersion)
    onNavigate(`/projects/${project.id}/scripts/${newVersion.id}`)
  }

  // TODO: replace with confirmScript()
  const handleConfirm = () => {
    replaceVersion({
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => onNavigate(`/projects/${project.id}`)}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            ← {project.name}
          </button>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="text-lg font-semibold tracking-tight">
            {version.name}
          </h1>
          <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            V{version.version}
          </span>
          <TypeBadge type={version.type} />
          <StatusBadge status={version.status} />
        </div>
        {saving && (
          <span className="text-xs text-muted-foreground">保存中…</span>
        )}
      </div>

      {/* Two-column layout */}
      <div className="grid flex-1 gap-4 lg:grid-cols-2">
        {/* Left: original text */}
        <AppCard className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">原文</h2>
            <span className="text-xs text-muted-foreground">不可修改</span>
          </div>
          <div className="flex-1 overflow-y-auto p-5">
            {project.content.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {project.content}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                该项目还没有原文。
              </p>
            )}
          </div>
        </AppCard>

        {/* Right: script editor */}
        <AppCard className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="text-sm font-semibold">脚本</h2>
            <span className="text-xs text-muted-foreground">
              {isReadOnly ? "只读" : "可编辑"}
            </span>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-5">
            {editedScript.length === 0 ? (
              <p className="text-sm text-muted-foreground">脚本内容为空。</p>
            ) : (
              editedScript.map((paragraph, pIdx) => (
                <div key={paragraph.id} className="space-y-2">
                  {paragraph.sentences.map((sentence, sIdx) => (
                    <div
                      key={sentence.id}
                      className={cn(
                        "group rounded-lg border border-transparent p-2 transition-colors",
                        !isReadOnly && "hover:border-border hover:bg-accent/30"
                      )}
                    >
                      <textarea
                        value={sentence.text}
                        onChange={(e) =>
                          updateSentence(pIdx, sIdx, e.target.value)
                        }
                        readOnly={isReadOnly}
                        rows={2}
                        className={cn(
                          "w-full resize-none rounded-md bg-transparent text-sm leading-relaxed",
                          "focus-visible:outline-none",
                          isReadOnly && "cursor-default text-muted-foreground",
                          !isReadOnly &&
                            "focus-visible:bg-card focus-visible:ring-1 focus-visible:ring-ring/40"
                        )}
                      />
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </AppCard>
      </div>

      {/* Bottom action bar */}
      <div className="flex flex-wrap items-center justify-end gap-3 rounded-xl border border-border bg-card p-4">
        {isEditable && (
          <>
            <AppButton variant="outline" onClick={handleSave} disabled={saving}>
              保存
            </AppButton>
            <AppButton onClick={handleSubmitToAI}>提交给 AI 修改</AppButton>
          </>
        )}

        {version.type === "ai" && version.status !== "confirmed" && (
          <AppButton variant="outline" onClick={handleCreateEditable}>
            创建可编辑版本
          </AppButton>
        )}

        {version.status === "confirmed" && (
          <AppButton variant="outline" onClick={handleCreateEditable}>
            创建新版本
          </AppButton>
        )}

        {canConfirm && <AppButton onClick={handleConfirm}>确认脚本</AppButton>}

        {!isLatest && version.status !== "confirmed" && (
          <span className="text-xs text-muted-foreground">
            只有最新版本可以确认
          </span>
        )}
      </div>
    </div>
  )
}
