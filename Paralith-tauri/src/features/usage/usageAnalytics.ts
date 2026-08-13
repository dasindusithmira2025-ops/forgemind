import { estimateCost, processedTokens, sumCost } from './usageCost'
import type { TokenUsageSummary, UsageDailyRow, UsageProvider } from '../../native/types'

/**
 * Turns persisted daily buckets into everything the Usage page renders.
 *
 * All of it is pure: the same rows always produce the same analytics, so the presentation layer
 * only formats and the numbers stay testable without a DOM. Deriving the whole page from one
 * function is also what keeps the range, chart-metric and breakdown-mode switches consistent —
 * they select from one computed model rather than each recomputing their own view of the period.
 */

export const USAGE_PERIODS = [7, 30, 90] as const
export type UsagePeriod = (typeof USAGE_PERIODS)[number]

export interface UsageSeriesPoint {
  date: string
  tokens: number
  /** `undefined` when nothing that day could be priced. */
  cost?: number
}

export interface ProviderUsage {
  provider: UsageProvider
  tokens: number
  cost?: number
  /** Share of the period's *cost*, or `undefined` when the period has no priced cost at all. */
  costShare?: number
  series: UsageSeriesPoint[]
}

export interface ModelUsage {
  /** `undefined` when the provider never reported a model for these tokens. */
  model?: string
  provider: UsageProvider
  tokens: number
  cost?: number
  costShare?: number
}

export interface DayUsage {
  date: string
  tokens: number
  cost?: number
  costShare?: number
}

export interface UsageMetrics {
  processedTokens: number
  cachedInputTokens: number
  uncachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
  reasoningTokens: number
  /** Days in the period that recorded any usage — the denominator for "per active day". */
  activeDays: number
  tokensPerActiveDay?: number
  /** Cached share of observed input (cached + uncached). `undefined` when no input was observed. */
  cachedInputShare?: number
  cacheSavings?: number
  /** Cache savings as a multiple of raw cost. `undefined` when raw cost is unknown or zero. */
  cacheSavingsMultiple?: number
}

export interface UsageAnalytics {
  from: string
  to: string
  /** Estimated list-price cost of everything observed in the period. */
  totalCost?: number
  totalTokens: number
  /** Tokens whose model has no published rate. A non-zero value means `totalCost` is partial. */
  unpricedTokens: number
  hasUsage: boolean
  providers: ProviderUsage[]
  models: ModelUsage[]
  days: DayUsage[]
  metrics: UsageMetrics
}

const PROVIDER_ORDER: UsageProvider[] = ['claude', 'codex']

export function providerLabel(provider: UsageProvider): string {
  return provider === 'claude' ? 'Claude Code' : 'Codex'
}

/** Inclusive UTC day list ending today — the axis every series is padded onto. */
export function periodDates(period: UsagePeriod, now = new Date()): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Array.from({ length: period }, (_, index) =>
    new Date(end - (period - 1 - index) * 86_400_000).toISOString().slice(0, 10),
  )
}

function emptyTokens(): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0 }
}

function addTokens(target: TokenUsageSummary, source: TokenUsageSummary) {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cachedInputTokens += source.cachedInputTokens
  target.cacheCreationTokens += source.cacheCreationTokens
  target.reasoningTokens += source.reasoningTokens
  target.totalTokens += source.totalTokens
}

/** A share is only meaningful against a known, non-zero whole. */
function share(part: number | undefined, whole: number | undefined): number | undefined {
  if (part === undefined || whole === undefined || whole <= 0) return undefined
  return (part / whole) * 100
}

export function buildUsageAnalytics(rows: readonly UsageDailyRow[], period: UsagePeriod, now = new Date()): UsageAnalytics {
  const dates = periodDates(period, now)
  const from = dates[0]
  const to = dates[dates.length - 1]
  // The backend query is bounded by the period, but a clock change or a longer cached response
  // could still carry an out-of-range bucket; the page must only ever total the shown interval.
  const scoped = rows.filter((row) => row.date >= from && row.date <= to)

  const total = emptyTokens()
  for (const row of scoped) addTokens(total, row.tokens)
  const totals = sumCost(scoped)

  // Both providers are always represented, even at zero. A provider that vanishes when it has no
  // usage also takes its "live data unavailable" annotation with it, and the reader cannot tell
  // "nothing was used" apart from "nothing could be collected".
  const providers = PROVIDER_ORDER.map<ProviderUsage>((provider) => {
    const providerRows = scoped.filter((row) => row.provider === provider)
    const cost = sumCost(providerRows)
    const byDate = new Map<string, UsageDailyRow[]>()
    for (const row of providerRows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row])
    return {
      provider,
      tokens: providerRows.reduce((sum, row) => sum + processedTokens(row.tokens), 0),
      cost: cost.amount,
      costShare: share(cost.amount, totals.amount),
      series: dates.map((date) => {
        const dayRows = byDate.get(date) ?? []
        return {
          date,
          tokens: dayRows.reduce((sum, row) => sum + processedTokens(row.tokens), 0),
          cost: dayRows.length === 0 ? 0 : sumCost(dayRows).amount,
        }
      }),
    }
  })

  const modelKey = (row: UsageDailyRow) => `${row.provider}::${row.model ?? ''}`
  const modelGroups = new Map<string, UsageDailyRow[]>()
  for (const row of scoped) modelGroups.set(modelKey(row), [...(modelGroups.get(modelKey(row)) ?? []), row])
  const models = [...modelGroups.values()]
    .map<ModelUsage>((group) => {
      const cost = sumCost(group)
      return {
        model: group[0].model,
        provider: group[0].provider,
        tokens: group.reduce((sum, row) => sum + processedTokens(row.tokens), 0),
        cost: cost.amount,
        costShare: share(cost.amount, totals.amount),
      }
    })
    // Unpriced models sort last but are never dropped: their tokens are real observations.
    .sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens)

  const dayGroups = new Map<string, UsageDailyRow[]>()
  for (const row of scoped) dayGroups.set(row.date, [...(dayGroups.get(row.date) ?? []), row])
  const days = dates
    .filter((date) => dayGroups.has(date))
    .map<DayUsage>((date) => {
      const group = dayGroups.get(date) ?? []
      const cost = sumCost(group)
      return {
        date,
        tokens: group.reduce((sum, row) => sum + processedTokens(row.tokens), 0),
        cost: cost.amount,
        costShare: share(cost.amount, totals.amount),
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const observedInput = total.inputTokens + total.cachedInputTokens
  const activeDays = days.filter((day) => day.tokens > 0).length
  const processed = processedTokens(total)
  const cacheSavings = scoped.length === 0 ? undefined : totals.cacheSavings
  const metrics: UsageMetrics = {
    processedTokens: processed,
    cachedInputTokens: total.cachedInputTokens,
    uncachedInputTokens: total.inputTokens,
    cacheWriteTokens: total.cacheCreationTokens,
    outputTokens: total.outputTokens,
    reasoningTokens: total.reasoningTokens,
    activeDays,
    tokensPerActiveDay: activeDays > 0 ? processed / activeDays : undefined,
    cachedInputShare: share(total.cachedInputTokens, observedInput),
    cacheSavings,
    cacheSavingsMultiple:
      cacheSavings !== undefined && totals.amount !== undefined && totals.amount > 0
        ? cacheSavings / totals.amount
        : undefined,
  }

  return {
    from,
    to,
    totalCost: totals.amount,
    totalTokens: processed,
    unpricedTokens: totals.unpricedTokens,
    hasUsage: scoped.length > 0,
    providers,
    models,
    days,
    metrics,
  }
}

/** Per-day cost for one provider, or `undefined` where the day could not be priced. */
export function seriesValue(point: UsageSeriesPoint, metric: 'cost' | 'tokens'): number | undefined {
  return metric === 'cost' ? point.cost : point.tokens
}

export { estimateCost, processedTokens }
