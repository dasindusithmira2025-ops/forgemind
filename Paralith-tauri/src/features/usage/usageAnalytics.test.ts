import { describe, expect, it } from 'vitest'
import { buildUsageAnalytics, periodDates } from './usageAnalytics'
import { formatCost, formatDay, formatPercent, formatRange, formatTokens, UNKNOWN } from './usageFormat'
import type { TokenUsageSummary, UsageDailyRow } from '../../native/types'

const NOW = new Date('2026-08-13T10:00:00Z')

function tokens(partial: Partial<TokenUsageSummary> = {}): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0, ...partial }
}

function row(partial: Partial<UsageDailyRow> = {}): UsageDailyRow {
  return { date: '2026-08-13', provider: 'claude', model: 'claude-opus-5', tokens: tokens({ outputTokens: 1_000_000 }), ...partial }
}

describe('periodDates', () => {
  it('produces an inclusive day axis ending today', () => {
    const dates = periodDates(7, NOW)
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe('2026-08-07')
    expect(dates[6]).toBe('2026-08-13')
  })
})

describe('buildUsageAnalytics', () => {
  it('groups by provider and reports each provider share of cost', () => {
    const analytics = buildUsageAnalytics(
      [
        row({ provider: 'claude', model: 'claude-opus-5', tokens: tokens({ outputTokens: 1_000_000 }) }),
        row({ provider: 'codex', model: 'gpt-5.6-sol', tokens: tokens({ outputTokens: 1_000_000 }) }),
      ],
      30,
      NOW,
    )
    // $75 Claude + $10 Codex.
    expect(analytics.totalCost).toBeCloseTo(85, 6)
    const claude = analytics.providers.find((item) => item.provider === 'claude')
    const codex = analytics.providers.find((item) => item.provider === 'codex')
    expect(claude?.cost).toBeCloseTo(75, 6)
    expect(claude?.costShare).toBeCloseTo((75 / 85) * 100, 4)
    expect(codex?.costShare).toBeCloseTo((10 / 85) * 100, 4)
  })

  it('pads each provider series across every day in the period', () => {
    const analytics = buildUsageAnalytics([row({ date: '2026-08-13' })], 7, NOW)
    const claude = analytics.providers.find((item) => item.provider === 'claude')
    expect(claude?.series).toHaveLength(7)
    expect(claude?.series[0]).toMatchObject({ date: '2026-08-07', tokens: 0 })
    expect(claude?.series[6].tokens).toBe(1_000_000)
  })

  it('excludes buckets outside the selected range', () => {
    const analytics = buildUsageAnalytics(
      [row({ date: '2026-08-13' }), row({ date: '2026-06-01' })],
      7,
      NOW,
    )
    expect(analytics.totalCost).toBeCloseTo(75, 6)
    expect(analytics.days).toHaveLength(1)
  })

  it('includes both range boundary days', () => {
    const analytics = buildUsageAnalytics(
      [row({ date: '2026-08-07' }), row({ date: '2026-08-13' })],
      7,
      NOW,
    )
    expect(analytics.days.map((day) => day.date)).toEqual(['2026-08-13', '2026-08-07'])
  })

  it('keeps an unpriced model visible in the breakdown with its real token count', () => {
    const analytics = buildUsageAnalytics(
      [row(), row({ model: 'new-unknown-model', tokens: tokens({ outputTokens: 6_200_000 }) })],
      30,
      NOW,
    )
    const unknown = analytics.models.find((item) => item.model === 'new-unknown-model')
    expect(unknown).toBeDefined()
    expect(unknown?.cost).toBeUndefined()
    expect(unknown?.tokens).toBe(6_200_000)
    expect(analytics.unpricedTokens).toBe(6_200_000)
    // A priced model still sorts above an unpriced one.
    expect(analytics.models[0].model).toBe('claude-opus-5')
  })

  it('keeps a bucket the provider reported no model for', () => {
    const analytics = buildUsageAnalytics([row({ model: undefined })], 30, NOW)
    expect(analytics.models).toHaveLength(1)
    expect(analytics.models[0].model).toBeUndefined()
    expect(analytics.models[0].tokens).toBe(1_000_000)
  })

  it('separates the same model id reported by two different providers', () => {
    const analytics = buildUsageAnalytics(
      [row({ provider: 'claude', model: 'shared' }), row({ provider: 'codex', model: 'shared' })],
      30,
      NOW,
    )
    expect(analytics.models).toHaveLength(2)
  })

  it('derives cache metrics from observed input only', () => {
    const analytics = buildUsageAnalytics(
      [row({ tokens: tokens({ inputTokens: 1_000_000, cachedInputTokens: 99_000_000, cacheCreationTokens: 2_000_000, outputTokens: 1_000_000, reasoningTokens: 250_000 }) })],
      30,
      NOW,
    )
    const { metrics } = analytics
    expect(metrics.cachedInputShare).toBeCloseTo(99, 4)
    expect(metrics.uncachedInputTokens).toBe(1_000_000)
    expect(metrics.cacheWriteTokens).toBe(2_000_000)
    expect(metrics.reasoningTokens).toBe(250_000)
    expect(metrics.processedTokens).toBe(103_000_000)
    expect(metrics.activeDays).toBe(1)
    expect(metrics.tokensPerActiveDay).toBe(103_000_000)
    // 99M cache reads at a $13.50/MTok discount.
    expect(metrics.cacheSavings).toBeCloseTo(99 * 13.5, 4)
  })

  it('reports an empty period as no usage rather than as zero cost', () => {
    const analytics = buildUsageAnalytics([], 30, NOW)
    expect(analytics.hasUsage).toBe(false)
    expect(analytics.totalCost).toBeUndefined()
    expect(analytics.metrics.cacheSavings).toBeUndefined()
    expect(analytics.metrics.tokensPerActiveDay).toBeUndefined()
    expect(analytics.metrics.cachedInputShare).toBeUndefined()
  })

  it('gives no cache-savings multiple when raw cost is unknown', () => {
    const analytics = buildUsageAnalytics([row({ model: 'new-unknown-model' })], 30, NOW)
    expect(analytics.metrics.cacheSavingsMultiple).toBeUndefined()
  })
})

describe('formatters', () => {
  it('scales token magnitudes', () => {
    expect(formatTokens(984)).toBe('984')
    expect(formatTokens(12_400)).toBe('12.4K')
    expect(formatTokens(3_210_000)).toBe('3.21M')
    expect(formatTokens(1_240_000_000)).toBe('1.24B')
    expect(formatTokens(3_200_000_000)).toBe('3.20B')
  })

  it('renders unknown values as an em dash, never as zero', () => {
    expect(formatTokens(undefined)).toBe(UNKNOWN)
    expect(formatCost(undefined)).toBe(UNKNOWN)
    expect(formatPercent(undefined)).toBe(UNKNOWN)
    expect(formatCost(0)).toBe('$0.00')
  })

  it('groups and fixes cost precision', () => {
    expect(formatCost(0.1)).toBe('$0.10')
    expect(formatCost(47.17)).toBe('$47.17')
    expect(formatCost(2106.47)).toBe('$2,106.47')
  })

  it('formats percentages to one decimal', () => {
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(38.61)).toBe('38.6%')
  })

  it('formats bucket dates in UTC so a local timezone cannot shift a day', () => {
    expect(formatDay('2026-07-15')).toBe('Jul 15')
    expect(formatRange('2026-07-15', '2026-08-13')).toBe('Jul 15 to Aug 13')
  })
})
