/** Literal search, including punctuation; replacement text is never a regex template. */
export function sentenceMatches(text: string, query: string, caseSensitive = false): number {
  if (!query) return 0
  return [...text.matchAll(pattern(query, caseSensitive))].length
}

export function replaceSentenceMatches(text: string, query: string, replacement: string, caseSensitive = false): string {
  if (!query) return text
  return text.replace(pattern(query, caseSensitive), () => replacement)
}

function pattern(query: string, caseSensitive: boolean): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), caseSensitive ? "gu" : "giu")
}
