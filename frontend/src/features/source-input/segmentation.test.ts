import { describe, expect, it } from "vitest"

import { segmentSourceLocally, spokenCharacterCount } from "./segmentation"

describe("长文档分段", () => {
  it("按自然段保持顺序", () => {
    const result = segmentSourceLocally("第一段。\n\n第二段。", {
      sourceType: "text",
      mode: "paragraph",
      targetMinutes: 5,
      charsPerMinute: 240,
    })
    expect(result.chunks.map((item) => item.text)).toEqual(["第一段。", "第二段。"])
  })

  it("按预计时长组合短段落", () => {
    const result = segmentSourceLocally(["甲".repeat(120), "乙".repeat(120), "丙".repeat(120)].join("\n\n"), {
      sourceType: "text",
      mode: "duration",
      targetMinutes: 1,
      charsPerMinute: 240,
    })
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[0].estimated_seconds).toBe(60)
  })

  it("Markdown 估算忽略链接地址和格式符", () => {
    expect(spokenCharacterCount("# 标题\n[文字](https://example.com)和**重点**", "markdown"))
      .toBe("标题文字和重点".length)
  })
})
