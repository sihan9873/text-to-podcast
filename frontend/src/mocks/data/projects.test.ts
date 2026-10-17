import { afterEach, describe, expect, it, vi } from "vitest"

describe("Mock 项目刷新持久化", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it("保存项目后重新加载模块仍能恢复完整原文", async () => {
    const values = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    })

    const firstLoad = await import("./projects")
    const completeSource = "刷新后仍然存在的完整原文😀"
    firstLoad.mockProjects[0].content = completeSource
    firstLoad.persistMockProjects()

    vi.resetModules()
    const refreshed = await import("./projects")

    expect(refreshed.mockProjects[0].content).toBe(completeSource)
  })
})
