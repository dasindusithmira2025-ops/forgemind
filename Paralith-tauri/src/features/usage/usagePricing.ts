/**
 * Centralised model pricing for the Usage analytics surface.
 *
 * Everything here answers exactly one question: *what would these observed tokens have cost at the
 * provider's published API list price?* That is not what a Claude or Codex subscription charges,
 * and the UI must always label it as an estimate. Pricing never leaves this module — no component
 * multiplies a token count by a rate.
 *
 * Rates are USD per million tokens and carry an `effectiveFrom` date because published prices
 * change. A day's tokens are priced with the entry in force on that day, so re-pricing history
 * after a provider price change cannot silently rewrite what last month actually cost.
 */

export interface ModelRate {
  /** Uncached prompt input. */
  input: number
  /** Cache *read* — the discounted rate for input served from a prompt cache. */
  cachedInput: number
  /** Cache *write* — the premium for populating the cache. */
  cacheWrite: number
  /** Completion output. Reasoning tokens are a subset of output on both providers and are
   *  therefore never billed a second time. */
  output: number
}

export interface PricingEntry {
  /** Matched against the normalised model id as a prefix. */
  prefix: string
  /** ISO date (`YYYY-MM-DD`) this rate took effect. */
  effectiveFrom: string
  rate: ModelRate
}

/**
 * Ordered longest-prefix-first at lookup time, so `claude-opus` never shadows `claude-opus-5`
 * and a newly released point version inherits its family's price instead of vanishing from cost.
 */
export const MODEL_PRICING: readonly PricingEntry[] = [
  // ---- Anthropic ---------------------------------------------------------------------------
  { prefix: 'claude-opus', effectiveFrom: '2024-01-01', rate: { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 } },
  { prefix: 'claude-sonnet', effectiveFrom: '2024-01-01', rate: { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 } },
  { prefix: 'claude-haiku', effectiveFrom: '2024-01-01', rate: { input: 1, cachedInput: 0.1, cacheWrite: 1.25, output: 5 } },
  { prefix: 'claude-3-5-haiku', effectiveFrom: '2024-01-01', rate: { input: 0.8, cachedInput: 0.08, cacheWrite: 1, output: 4 } },
  { prefix: 'claude-3-5-sonnet', effectiveFrom: '2024-01-01', rate: { input: 3, cachedInput: 0.3, cacheWrite: 3.75, output: 15 } },
  { prefix: 'claude-3-opus', effectiveFrom: '2024-01-01', rate: { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 } },
  { prefix: 'claude-fable', effectiveFrom: '2024-01-01', rate: { input: 15, cachedInput: 1.5, cacheWrite: 18.75, output: 75 } },
  // ---- OpenAI / Codex ----------------------------------------------------------------------
  // Codex does not report cache writes; the rate is carried anyway so the shape stays uniform.
  { prefix: 'gpt-5', effectiveFrom: '2024-01-01', rate: { input: 1.25, cachedInput: 0.125, cacheWrite: 1.25, output: 10 } },
  { prefix: 'gpt-5-mini', effectiveFrom: '2024-01-01', rate: { input: 0.25, cachedInput: 0.025, cacheWrite: 0.25, output: 2 } },
  { prefix: 'gpt-5-nano', effectiveFrom: '2024-01-01', rate: { input: 0.05, cachedInput: 0.005, cacheWrite: 0.05, output: 0.4 } },
  { prefix: 'gpt-4.1', effectiveFrom: '2024-01-01', rate: { input: 2, cachedInput: 0.5, cacheWrite: 2, output: 8 } },
  { prefix: 'gpt-4o', effectiveFrom: '2024-01-01', rate: { input: 2.5, cachedInput: 1.25, cacheWrite: 2.5, output: 10 } },
  { prefix: 'o3', effectiveFrom: '2024-01-01', rate: { input: 2, cachedInput: 0.5, cacheWrite: 2, output: 8 } },
]

/**
 * Collapses a provider's model id to a stable lookup key.
 *
 * Providers append dated build suffixes (`claude-opus-4-20250514`) and Codex appends tuning
 * suffixes (`gpt-5.6-sol`). Both must resolve to the family rate rather than falling out of the
 * pricing table on every release, so the date stamp is dropped and separators are normalised.
 *
 * The GPT minor version is dropped as well. It sits *between* the family and the size
 * (`gpt-5.4-mini`), so leaving it in place would let the full `gpt-5` entry win the prefix match
 * and bill a mini model at five times its real rate.
 */
export function normalizeModelId(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/^(anthropic|openai)\//, '')
    .replace(/[_\s]+/g, '-')
    .replace(/-(\d{8}|latest|preview)$/, '')
    .replace(/^(gpt-\d+)\.\d+/, '$1')
}

/**
 * The rate in force for `model` on `date`, or `undefined` when the model is unknown.
 *
 * `undefined` is a first-class answer: an unpriced model keeps its tokens in every total and is
 * still listed in the breakdown with an unavailable cost. It is never priced at zero.
 */
export function rateFor(model: string | undefined, date: string): ModelRate | undefined {
  if (!model) return undefined
  const id = normalizeModelId(model)
  // `gpt-5.6-sol` must match `gpt-5` but not `gpt-5-mini`, so a match requires the prefix to end
  // at a separator — otherwise the shorter family entry would swallow the cheaper variants.
  const candidates = MODEL_PRICING.filter(
    (entry) => (id === entry.prefix || id.startsWith(`${entry.prefix}-`) || id.startsWith(`${entry.prefix}.`)) && entry.effectiveFrom <= date,
  )
  if (candidates.length === 0) return undefined
  return candidates.reduce((best, entry) =>
    entry.prefix.length !== best.prefix.length
      ? entry.prefix.length > best.prefix.length ? entry : best
      : entry.effectiveFrom > best.effectiveFrom ? entry : best,
  ).rate
}
