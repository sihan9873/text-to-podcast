import { afterEach, describe, expect, it, vi } from "vitest"

import { authApi } from "./auth"
import { ApiError } from "./client"

const rawUser = {
  id: "account-1",
  username: "demo",
  displayName: "演示用户",
  role: "user",
  status: "active",
  createdAt: "2026-11-15T00:00:00Z",
  updatedAt: "2026-11-15T00:00:00Z",
  lastLoginAt: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("authApi account-service adapter", () => {
  it("maps the formal backend camelCase session to the frontend contract", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: rawUser,
            expiresAt: "2026-11-16T00:00:00Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    await expect(authApi.login({ username: "demo", password: "password" })).resolves.toEqual({
      user: {
        user_id: "account-1",
        username: "demo",
        display_name: "演示用户",
        status: "active",
        created_at: "2026-11-15T00:00:00Z",
        role: "user",
        last_login_at: null,
      },
      expires_at: "2026-11-16T00:00:00Z",
      csrf_token: null,
    })
  })

  it("maps AUTH_REQUIRED to UNAUTHENTICATED", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ code: "AUTH_REQUIRED", message: "请先登录" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    )

    const error = await authApi.me().catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ code: "UNAUTHENTICATED", status: 401 })
  })

  it("updates displayName and normalizes the returned user", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ user: { ...rawUser, displayName: "新昵称" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await expect(authApi.updateMyProfile("新昵称")).resolves.toMatchObject({
      user_id: "account-1",
      display_name: "新昵称",
    })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/me")
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "PATCH" })
  })
})
