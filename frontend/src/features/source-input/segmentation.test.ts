import { describe, expect, it } from "vitest"

import { segmentSourceLocally, spokenCharacterCount } from "./segmentation"

const options = {
  sourceType: "text" as const,
  mode: "auto" as const,
  targetMinutes: 5,
  charsPerMinute: 240,
}

describe("automatic source segmentation", () => {
  it("keeps explicit legacy paragraph mode compatible", () => {
    const result = segmentSourceLocally("第一段。\n\n第二段。", {
      ...options,
      mode: "paragraph",
    })
    expect(result.chunks.map((item) => item.text)).toEqual(["第一段。", "第二段。"])
  })

  it("keeps explicit legacy duration mode compatible", () => {
    const result = segmentSourceLocally(["甲".repeat(120), "乙".repeat(120), "丙".repeat(120)].join("\n\n"), {
      ...options,
      mode: "duration",
      targetMinutes: 1,
    })
    expect(result.chunks).toHaveLength(2)
    expect(result.chunks[0].estimated_seconds).toBe(60)
  })

  it("ignores Markdown links and markers in spoken duration", () => {
    expect(spokenCharacterCount("# 标题\n[文字](https://example.com)和**重点**", "markdown"))
      .toBe("标题文字和重点".length)
  })

  it("keeps an ordinary multi-paragraph document intact", () => {
    const source = ["甲".repeat(1000), "乙".repeat(1000), "丙".repeat(1000), "丁".repeat(900)].join("\n\n")
    const result = segmentSourceLocally(source, options)
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0].text).toBe(source)
    expect(result.chunks[0].boundary_type).toBe("complete")
  })

  it("only splits long documents and preserves paragraph order", () => {
    const paragraphs = ["甲", "乙", "丙", "丁"].map((value) => value.repeat(1800))
    const result = segmentSourceLocally(paragraphs.join("\n\n"), options)
    expect(result.chunks.map((chunk) => chunk.text)).toEqual(paragraphs)
    expect(result.chunks.every((chunk) => chunk.boundary_type === "semantic")).toBe(true)
    expect(result.chunks.every((chunk) => chunk.character_count <= 3500)).toBe(true)
  })
})
