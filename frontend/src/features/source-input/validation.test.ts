import { describe, expect, it } from "vitest"

import {
  MAX_SOURCE_FILE_BYTES,
  RECOMMENDED_SOURCE_CHARACTERS,
  SourceInputError,
  countSourceCharacters,
  decodeUtf8Source,
  readSourceTextFile,
  validateSourceFileMetadata,
  validateSourceText,
} from "./validation"

function makeFile(
  overrides: Partial<{
    name: string
    size: number
    type: string
    bytes: Uint8Array
    readError: Error
  }> = {}
) {
  const bytes = overrides.bytes ?? new TextEncoder().encode("有效的中文原文")
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  return {
    name: overrides.name ?? "article.txt",
    size: overrides.size ?? bytes.byteLength,
    type: overrides.type ?? "text/plain",
    arrayBuffer: async () => {
      if (overrides.readError) throw overrides.readError
      return buffer
    },
  }
}

describe("原文字符校验", () => {
  it("将 emoji 作为一个用户可见字符统计", () => {
    expect(countSourceCharacters("中文😀")).toBe(3)
  })

  it("拒绝空内容和纯空白内容", () => {
    expect(validateSourceText(" \n\t ").errors[0]?.code).toBe("SOURCE_EMPTY")
  })

  it("超过 5000 字时警告但不截断", () => {
    const source = "文".repeat(RECOMMENDED_SOURCE_CHARACTERS + 1)
    const result = validateSourceText(source)

    expect(result.errors).toHaveLength(0)
    expect(result.warnings[0]?.code).toBe("SOURCE_OVER_RECOMMENDED_LENGTH")
    expect(result.characterCount).toBe(RECOMMENDED_SOURCE_CHARACTERS + 1)
    expect(source).toHaveLength(RECOMMENDED_SOURCE_CHARACTERS + 1)
  })
})

describe("TXT 文件校验", () => {
  it("接受大小上限内的 TXT 文件", () => {
    expect(() =>
      validateSourceFileMetadata(
        makeFile({ name: "ARTICLE.TXT", size: MAX_SOURCE_FILE_BYTES })
      )
    ).not.toThrow()
  })

  it("拒绝非 TXT 文件", () => {
    expect(() => validateSourceFileMetadata(makeFile({ name: "article.md" })))
      .toThrowError(SourceInputError)
  })

  it("拒绝空文件", () => {
    expect(() => validateSourceFileMetadata(makeFile({ size: 0 }))).toThrow(
      "所选 TXT 文件为空"
    )
  })

  it("拒绝超过 100 KB 的文件", () => {
    expect(() =>
      validateSourceFileMetadata(
        makeFile({ size: MAX_SOURCE_FILE_BYTES + 1 })
      )
    ).toThrow("不能超过 100 KB")
  })

  it("拒绝无法读取的文件", async () => {
    await expect(
      readSourceTextFile(makeFile({ readError: new Error("disk error") }))
    ).rejects.toMatchObject({ code: "FILE_READ_FAILED" })
  })
})

describe("UTF-8 解码", () => {
  it("读取中文 UTF-8 并移除 BOM", async () => {
    const text = await readSourceTextFile(
      makeFile({ bytes: new TextEncoder().encode("\uFEFF中文内容") })
    )
    expect(text).toBe("中文内容")
  })

  it("拒绝无效 UTF-8 字节", () => {
    expect(() => decodeUtf8Source(new Uint8Array([0xc3, 0x28]))).toThrow(
      "不是有效的 UTF-8 编码"
    )
  })

  it("拒绝解码后为空白的文件", async () => {
    await expect(
      readSourceTextFile(
        makeFile({ bytes: new TextEncoder().encode("  \n\t") })
      )
    ).rejects.toMatchObject({ code: "SOURCE_EMPTY" })
  })
})
