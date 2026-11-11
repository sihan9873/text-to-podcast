import { useCallback, useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { generationRequest as api } from "@/api/generationBackend"

type Project = {
  project_id: number
  title: string
  source_text?: string
  source_submitted: boolean
  current_script?: { script_id: number }
  latest_audio?: { current_asset_id: number | null }
  active_tasks: { task_id: number }[]
}
type Script = {
  script_id: number
  version: number
  edit_revision: number
  status: string
  title: string
  sentences: { sentence_id: number; text: string }[]
}

async function waitForTask(id: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const task = await api<{ status: string; error_message?: string }>("/tasks/" + id)
    if (task.status === "succeeded") return
    if (task.status !== "queued" && task.status !== "running") {
      throw new Error(task.error_message ?? "任务失败")
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  throw new Error("任务仍在处理中，请稍后打开项目查看")
}

export default function PodcastWorkflow({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient()
  const [project, setProject] = useState<Project>()
  const [script, setScript] = useState<Script>()
  const [source, setSource] = useState("")
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  const open = useCallback(async (id: number) => {
    const detail = await api<Project>("/projects/" + id)
    setProject(detail)
    setScript(detail.current_script ? await api<Script>("/scripts/" + detail.current_script.script_id) : undefined)
  }, [])

  useEffect(() => {
    void open(projectId).catch(err => setError(err.message))
  }, [open, projectId])

  async function run(label: string, work: () => Promise<void>) {
    setBusy(label)
    setError("")
    try {
      await work()
      await queryClient.invalidateQueries({ queryKey: ["projects"] })
    }
    catch (err) { setError(err instanceof Error ? err.message : "操作失败") }
    finally { setBusy("") }
  }

  const path = "/projects/" + project?.project_id
  const asset = project?.latest_audio?.current_asset_id
  const revision = script && {
    expected_script_version: script.version,
    expected_edit_revision: script.edit_revision,
  }

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold">{project?.title ?? "项目详情"}</h1>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {busy && <p role="status">{busy}</p>}
      <fieldset disabled={Boolean(busy)} className="space-y-4">
        {project && <>

          {project.source_submitted && <details><summary>已提交的原文</summary><p className="whitespace-pre-wrap">{project.source_text}</p></details>}
          {!project.source_submitted && <textarea aria-label="原文" className="w-full border p-2" maxLength={5000} rows={6} value={source} onChange={e => setSource(e.target.value)} />}
          {!script && !project.active_tasks.length && <button className="rounded border p-2" disabled={!project.source_submitted && !source.trim()} onClick={() => void run("正在生成脚本", async () => {
            if (!project.source_submitted) {
              await api(path + "/source", "PUT", { text: source })
              await open(project.project_id)
            }
            const roles = await api<{ items: { profile_id: number }[] }>("/roles")
            if (!roles.items.length) throw new Error("没有可用的主持人角色")
            const task = await api<{ task_id: number }>(path + "/script/generate", "POST", {
              roles: [{ profile_id: roles.items[0].profile_id, role_key: "host" }],
            }, true)
            await waitForTask(task.task_id)
            await open(project.project_id)
          })}>生成脚本</button>}
          {script && <div className="space-y-2">
            <h3 className="font-semibold">{script.title}</h3>
            {script.sentences.map(line => <p key={line.sentence_id}>{line.text}</p>)}
            {!project.active_tasks.length && script.status !== "confirmed" && <button className="rounded border p-2" onClick={() => void run("正在确认脚本", async () => {
              await api("/scripts/" + script.script_id + "/confirm", "POST", revision)
              await open(project.project_id)
            })}>确认脚本</button>}
            {!project.active_tasks.length && script.status === "confirmed" && !asset && <button className="rounded border p-2" onClick={() => void run("正在合成音频", async () => {
              const task = await api<{ task_id: number }>(path + "/audio/generate", "POST", { script_id: script.script_id, ...revision }, true)
              await waitForTask(task.task_id)
              await open(project.project_id)
            })}>合成音频</button>}
          </div>}
          {project.active_tasks.length > 0 && <button className="rounded border p-2" onClick={() => void run("正在等待任务", async () => {
            try { await waitForTask(project.active_tasks[0].task_id) }
            finally { await open(project.project_id) }
          })}>查看任务进度</button>}
          {asset && <div className="space-y-2">
            <audio
              controls
              src={"/api/v1/audio-assets/" + asset + "/play"}
              onError={() => setError("音频加载失败：请确认已登录后重试")}
            />
            <a className="underline" href={"/api/v1/audio-assets/" + asset + "/download"}>下载 MP3</a>
          </div>}
        </>}
      </fieldset>
    </section>
  )
}
