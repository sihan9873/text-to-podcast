import { describe, expect, it } from "vitest"

import {
  validateDisplayName,
  validatePassword,
  validateUsername,
} from "./validation"

describe("用户凭据校验", () => {
  it("接受约定范围内的用户名", () => {
    expect(validateUsername("alice-01")).toBeNull()
  })

  it("拒绝过短或包含中文的用户名", () => {
    expect(validateUsername("ab")).not.toBeNull()
    expect(validateUsername("中文用户")).not.toBeNull()
  })

  it("拒绝过短密码和空白密码", () => {
    expect(validatePassword("short")).not.toBeNull()
    expect(validatePassword("        ")).not.toBeNull()
    expect(validatePassword("UserPass123!")).toBeNull()
  })

  it("校验显示名称", () => {
    expect(validateDisplayName(" ")).toBe("显示名称不能为空")
    expect(validateDisplayName("播客用户")).toBeNull()
  })
})
