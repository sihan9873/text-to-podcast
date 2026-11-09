import { afterEach, describe, expect, it, vi } from "vitest"

import { AUTH_REQUIRED_EVENT, ApiError, request } from "./request"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("统一登录失效处理", () => {
  it("受保护接口返回 401 时通知认证模块", async () => {
    const browserWindow = new EventTarget()
    const listener = vi.fn()
    browserWindow.addEventListener(AUTH_REQUIRED_EVENT, listener)
    vi.stubGlobal("window", browserWindow)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "SESSION_INVALID", message: "会话已失效" }),
          { status: 401 }
        )
      )
    )

    await expect(request("/projects")).rejects.toBeInstanceOf(ApiError)
    expect(listener).toHaveBeenCalledOnce()
  })

  it("首次匿名检查和登录失败不会误报会话过期", async () => {
    const browserWindow = new EventTarget()
    const listener = vi.fn()
    browserWindow.addEventListener(AUTH_REQUIRED_EVENT, listener)
    vi.stubGlobal("window", browserWindow)
    const mockedFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "AUTH_REQUIRED", message: "请先登录" }),
          { status: 401 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "INVALID_CREDENTIALS", message: "登录失败" }),
          { status: 401 }
        )
      )
    vi.stubGlobal("fetch", mockedFetch)

    await expect(request("/auth/me")).rejects.toBeInstanceOf(ApiError)
    await expect(
      request("/auth/login", { method: "POST", body: {} })
    ).rejects.toBeInstanceOf(ApiError)
    expect(listener).not.toHaveBeenCalled()
  })
})
