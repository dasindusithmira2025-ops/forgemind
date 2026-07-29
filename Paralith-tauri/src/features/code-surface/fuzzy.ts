/** A subsequence fuzzy score. Higher is better; contiguous and word-boundary matches rank up.
 * Returns null when `query` is not a subsequence of `text`. */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()
  let score = 0
  let textIndex = 0
  let previousMatch = -2
  for (let queryIndex = 0; queryIndex < lowerQuery.length; queryIndex += 1) {
    const character = lowerQuery[queryIndex]
    const found = lowerText.indexOf(character, textIndex)
    if (found < 0) return null
    if (found === previousMatch + 1) score += 5
    if (found === 0 || '/._-'.includes(lowerText[found - 1])) score += 3
    score += 1
    previousMatch = found
    textIndex = found + 1
  }
  // Prefer shorter paths and matches nearer the file name.
  return score - text.length * 0.05
}
