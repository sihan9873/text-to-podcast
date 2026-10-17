export const MAX_SOURCE_FILE_BYTES = 100 * 1024
export const RECOMMENDED_SOURCE_CHARACTERS = 5_000

export type SourceInputErrorCode =
  | "FILE_TYPE_INVALID"
  | "FILE_EMPTY"
  | "FILE_TOO_LARGE"
  | "FILE_READ_FAILED"
  | "FILE_ENCODING_INVALID"
  | "SOURCE_EMPTY"

export interface SourceInputIssue {
  code: SourceInputErrorCode | "SOURCE_OVER_RECOMMENDED_LENGTH"
  message: string
}

export interface SourceTextValidation {
  characterCount: number
  errors: SourceInputIssue[]
  warnings: SourceInputIssue[]
}

export interface SourceFileLike {
  name: string
  size: number
  type?: string
  arrayBuffer: () => Promise<ArrayBuffer>
}

export class SourceInputError extends Error {
  readonly code: SourceInputErrorCode

  constructor(code: SourceInputErrorCode, message: string) {
    super(message)
    this.name = "SourceInputError"
    this.code = code
  }
}

/** 按用户可见字符计数，避免 emoji 等代理对被算成两个字符。 */
export function countSourceCharacters(text: string): number {
  return Array.from(text).length
}

export function validateSourceText(text: string): SourceTextValidation {
  const characterCount = countSourceCharacters(text)
  const errors: SourceInputIssue[] = []
  const warnings: SourceInputIssue[] = []

  if (!text.trim()) {
    errors.push({ code: "SOURCE_EMPTY", message: "原文不能为空或只包含空白字符。" })
  }

  if (characterCount > RECOMMENDED_SOURCE_CHARACTERS) {
    warnings.push({
      code: "SOURCE_OVER_RECOMMENDED_LENGTH",
      message: `当前原文 ${characterCount} 字，超过 ${RECOMMENDED_SOURCE_CHARACTERS} 字建议上限。系统不会截断内容，请确认后再保存。`,
    })
  }

  return { characterCount, errors, warnings }
}

export function validateSourceFileMetadata(
  file: Pick<SourceFileLike, "name" | "size" | "type">
): void {
  if (!file.name.toLowerCase().endsWith(".txt")) {
    throw new SourceInputError("FILE_TYPE_INVALID", "仅支持 .txt 文本文件。")
  }

  const allowedMimeTypes = new Set(["text/plain", "application/octet-stream"])
  if (file.type && !allowedMimeTypes.has(file.type)) {
    throw new SourceInputError(
      "FILE_TYPE_INVALID",
      `文件类型 ${file.type} 不受支持，请选择纯文本 TXT 文件。`
    )
  }

  if (file.size === 0) {
    throw new SourceInputError("FILE_EMPTY", "所选 TXT 文件为空。")
  }

  if (file.size > MAX_SOURCE_FILE_BYTES) {
    throw new SourceInputError(
      "FILE_TOO_LARGE",
      `TXT 文件不能超过 100 KB，当前约 ${(file.size / 1024).toFixed(1)} KB。`
    )
  }
}

export function decodeUtf8Source(bytes: ArrayBuffer | Uint8Array): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return decoded.replace(/^\uFEFF/, "")
  } catch {
    throw new SourceInputError(
      "FILE_ENCODING_INVALID",
      "文件不是有效的 UTF-8 编码，请转换编码后重试。"
    )
  }
}

export async function readSourceTextFile(file: SourceFileLike): Promise<string> {
  validateSourceFileMetadata(file)

  let bytes: ArrayBuffer
  try {
    bytes = await file.arrayBuffer()
  } catch {
    throw new SourceInputError(
      "FILE_READ_FAILED",
      "文件读取失败，请重新选择文件或检查文件是否可访问。"
    )
  }

  const text = decodeUtf8Source(bytes)
  const validation = validateSourceText(text)
  if (validation.errors.length > 0) {
    throw new SourceInputError("SOURCE_EMPTY", validation.errors[0].message)
  }

  return text
}

export function getSourceInputErrorMessage(error: unknown): string {
  if (error instanceof SourceInputError || error instanceof Error) {
    return error.message
  }
  return "处理原文时发生未知错误，请重试。"
}
