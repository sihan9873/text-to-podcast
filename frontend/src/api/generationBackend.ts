export async function generationRequest<T>(path: string, method = "GET", body?: unknown, task = false): Promise<T> {
  const headers = new Headers()
  if (body !== undefined) headers.set("Content-Type", "application/json")
  if (task) headers.set("Idempotency-Key", crypto.randomUUID())
  const response = await fetch("/api/v1" + path, {
    method, headers, credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.message ?? "请求失败")
  return payload.data
}

export type GenerationProjectSummary = {
  project_id: number
  title: string
  updated_at: string
  current_script_id?: number | null
  confirmed_script_id?: number | null
  latest_audio_version_id?: number | null
}

export async function listGenerationProjects() {
  const projects: GenerationProjectSummary[] = []
  for (let page = 1; ; page++) {
    const result = await generationRequest<{ items: GenerationProjectSummary[]; total: number }>(
      "/projects?page_size=100&page=" + page,
    )
    projects.push(...result.items)
    if (projects.length >= result.total || result.items.length < 100) return projects
  }
}
