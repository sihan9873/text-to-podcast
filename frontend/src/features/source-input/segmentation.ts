import type {
  SegmentationMode,
  SourceChunkPreview,
  SourceType,
} from "@/api/types"

export interface SegmentSourceOptions {
  sourceType: SourceType
  mode: SegmentationMode
  targetMinutes: number
  charsPerMinute: number
}

export interface LocalSourcePlan {
  sourceText: string
  characterCount: number
  spokenCharacterCount: number
  estimatedSeconds: number
  chunks: SourceChunkPreview[]
}

const MAX_CHUNK_CHARACTERS = 5_000
const MAX_SOURCE_CHUNKS = 2_000

export function normalizeSource(text: string): string {
  const normalized = text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
  return Array.from(normalized)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0
      return code === 9 || code === 10 || (code >= 32 && code !== 127)
    })
    .join("")
    .trim()
    .replace(/^\uFEFF/, "")
}

export function spokenCharacterCount(text: string, sourceType: SourceType): number {
  let value = text
  if (sourceType === "markdown") {
    value = value
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s{0,3}(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gm, "")
      .replace(/```|~~~/g, "")
      .replace(/[*_~`]/g, "")
  }
  return Array.from(value.replace(/\s+/g, "")).length
}

function markdownBlocks(text: string): string[] {
  const blocks: string[] = []
  let current: string[] = []
  let fence: "```" | "~~~" | null = null
  for (const line of text.split("\n")) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1] as "```" | "~~~" | undefined
    if (marker) {
      fence = fence === marker ? null : fence ?? marker
      current.push(line)
      continue
    }
    if (!line.trim() && !fence) {
      if (current.length) blocks.push(current.join("\n").trim())
      current = []
    } else {
      current.push(line)
    }
  }
  if (current.length) blocks.push(current.join("\n").trim())

  const merged: string[] = []
  let headings: string[] = []
  for (let block of blocks) {
    if (/^\s{0,3}#{1,6}\s+[^\n]+$/.test(block)) {
      headings.push(block)
      continue
    }
    if (headings.length) {
      block = [...headings, block].join("\n\n")
      headings = []
    }
    merged.push(block)
  }
  if (headings.length) merged.push(headings.join("\n\n"))
  return merged
}

function blocksOf(text: string, sourceType: SourceType): string[] {
  if (sourceType === "markdown") return markdownBlocks(text)
  return text.split(/\n\s*\n+/).map((item) => item.trim()).filter(Boolean)
}

function splitOversized(block: string, sourceType: SourceType, limit: number): string[] {
  if (spokenCharacterCount(block, sourceType) <= limit && Array.from(block).length <= MAX_CHUNK_CHARACTERS) {
    return [block]
  }
  const sentences = block.split(/(?<=[。！？!?；;.])/u).map((item) => item.trim()).filter(Boolean)
  if (sentences.length <= 1) {
    const characters = Array.from(block)
    return Array.from({ length: Math.ceil(characters.length / limit) }, (_, index) =>
      characters.slice(index * limit, (index + 1) * limit).join("").trim(),
    ).filter(Boolean)
  }
  const result: string[] = []
  let current = ""
  for (const sentence of sentences) {
    const characters = Array.from(sentence)
    if (characters.length > MAX_CHUNK_CHARACTERS || spokenCharacterCount(sentence, sourceType) > limit) {
      if (current) result.push(current)
      current = ""
      for (let index = 0; index < characters.length; index += Math.min(limit, MAX_CHUNK_CHARACTERS)) {
        result.push(characters.slice(index, index + Math.min(limit, MAX_CHUNK_CHARACTERS)).join(""))
      }
      continue
    }
    const candidate = current + sentence
    if (current && (spokenCharacterCount(candidate, sourceType) > limit || Array.from(candidate).length > MAX_CHUNK_CHARACTERS)) {
      result.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) result.push(current)
  return result
}

export function segmentSourceLocally(text: string, options: SegmentSourceOptions): LocalSourcePlan {
  const sourceText = normalizeSource(text)
  const target = Math.min(MAX_CHUNK_CHARACTERS, options.targetMinutes * options.charsPerMinute)
  const pieces = blocksOf(sourceText, options.sourceType).flatMap((block) =>
    splitOversized(block, options.sourceType, options.mode === "duration" ? target : MAX_CHUNK_CHARACTERS),
  )
  const grouped: string[] = []
  if (options.mode === "paragraph") {
    grouped.push(...pieces)
  } else {
    let current = ""
    for (const piece of pieces) {
      const candidate = current ? `${current}\n\n${piece}` : piece
      if (current && (spokenCharacterCount(candidate, options.sourceType) > target || Array.from(candidate).length > MAX_CHUNK_CHARACTERS)) {
        grouped.push(current)
        current = piece
      } else {
        current = candidate
      }
    }
    if (current) grouped.push(current)
  }
  if (grouped.length > MAX_SOURCE_CHUNKS) {
    throw new Error(`分段数量不能超过 ${MAX_SOURCE_CHUNKS}，请改用按预计时长分段。`)
  }
  let spokenCharacterCountTotal = 0
  const chunks = grouped.map((chunk, index) => {
    const spoken = Math.max(1, spokenCharacterCount(chunk, options.sourceType))
    spokenCharacterCountTotal += spoken
    return {
      sequence: index + 1,
      text: chunk,
      character_count: Array.from(chunk).length,
      estimated_seconds: Math.max(1, Math.ceil(spoken * 60 / options.charsPerMinute)),
      boundary_type: options.mode,
    }
  })
  return {
    sourceText,
    characterCount: Array.from(sourceText).length,
    spokenCharacterCount: spokenCharacterCountTotal,
    estimatedSeconds: Math.max(1, Math.ceil(spokenCharacterCountTotal * 60 / options.charsPerMinute)),
    chunks,
  }
}
