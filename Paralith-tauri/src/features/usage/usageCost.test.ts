import { describe, expect, it } from 'vitest'
import { estimateCost, processedTokens, sumCost } from './usageCost'
import { normalizeModelId, rateFor } from './usagePricing'
import type { TokenUsageSummary, UsageDailyRow } from '../../native/types'

function tokens(partial: Partial<TokenUsageSummary> = {}): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0, ...partial }
}

function row(partial: Partial<UsageDailyRow> = {}): UsageDailyRow {
  return { date: '2026-08-01', provider: 'claude', model: 'claude-opus-5', tokens: tokens(), ...partial }
}

describe('model pricing lookup', () => {
  it('resolves dated build suffixes to the family rate', () => {
    expect(normalizeModelId('claude-opus-4-20250514')).toBe('claude-opus-4')
    expect(rateFor('claude-opus-4-20250514', '2026-08-01')?.input).toBe(15)
  })

  it('prefers the longest matching prefix so a variant is not billed at the family rate', () => {
    expect(rateFor('gpt-5-mini', '2026-08-01')?.input).toBe(0.25)
    expect(rateFor('gpt-5.6-sol', '2026-08-01')?.input).toBe(1.25)
  })

  // Real ids observed locally. The minor version sits between the family and the size, so a
  // naive prefix match bills `gpt-5.4-mini` at the full `gpt-5` rate — five times its real price.
  it('resolves a sized variant carrying a minor version to the variant rate', () => {
    expect(normalizeModelId('gpt-5.4-mini')).toBe('gpt-5-mini')
    expect(rateFor('gpt-5.4-mini', '2026-08-01')?.input).toBe(0.25)
    expect(rateFor('gpt-5.4', '2026-08-01')?.input).toBe(1.25)
    expect(rateFor('gpt-5.3-codex', '2026-08-01')?.input).toBe(1.25)
  })

  it('resolves an Anthropic point release to its family rate', () => {
    expect(rateFor('claude-opus-4-8', '2026-08-01')?.input).toBe(15)
    expect(rateFor('claude-fable-5', '2026-08-01')?.input).toBe(15)
    expect(rateFor('claude-sonnet-5', '2026-08-01')?.input).toBe(3)
  })

  it('does not match a prefix that stops mid-token', () => {
    // `o3` must not claim `o3nonsense`; a partial word match would price an unrelated model.
    expect(rateFor('o3nonsense', '2026-08-01')).toBeUndefined()
  })

  it('ignores rates that were not yet in force on the priced day', () => {
    expect(rateFor('claude-opus-5', '2023-01-01')).toBeUndefined()
  })
})

describe('estimateCost', () => {
  it('prices a known Claude model across every token dimension', () => {
    const estimate = estimateCost(
      tokens({ inputTokens: 1_000_000, cachedInputTokens: 1_000_000, cacheCreationTokens: 1_000_000, outputTokens: 1_000_000 }),
      'claude-opus-5',
      '2026-08-01',
    )
    expect(estimate.amount).toBeCloseTo(15 + 1.5 + 18.75 + 75, 6)
  })

  it('prices a known Codex model', () => {
    const estimate = estimateCost(tokens({ inputTokens: 2_000_000, outputTokens: 100_000 }), 'gpt-5.6-sol', '2026-08-01')
    expect(estimate.amount).toBeCloseTo(2 * 1.25 + 0.1 * 10, 6)
  })

  it('does not bill reasoning tokens a second time on top of output', () => {
    const withReasoning = estimateCost(tokens({ outputTokens: 1_000_000, reasoningTokens: 400_000 }), 'gpt-5.6-sol', '2026-08-01')
    const withoutReasoning = estimateCost(tokens({ outputTokens: 1_000_000 }), 'gpt-5.6-sol', '2026-08-01')
    expect(withReasoning.amount).toBe(withoutReasoning.amount)
  })

  it('reports cache savings as the discount against the uncached input rate', () => {
    const estimate = estimateCost(tokens({ cachedInputTokens: 1_000_000 }), 'claude-opus-5', '2026-08-01')
    expect(estimate.cacheSavings).toBeCloseTo(15 - 1.5, 6)
  })

  it('leaves an unknown model unpriced instead of pricing it at zero', () => {
    const estimate = estimateCost(tokens({ outputTokens: 6_200_000 }), 'new-unknown-model', '2026-08-01')
    expect(estimate.amount).toBeUndefined()
    expect(estimate.cacheSavings).toBeUndefined()
    expect(estimate.unpricedTokens).toBe(6_200_000)
  })

  it('leaves tokens unpriced when the provider reported no model at all', () => {
    expect(estimateCost(tokens({ outputTokens: 10 }), undefined, '2026-08-01').amount).toBeUndefined()
  })

  it('prices zero usage as zero, not as unknown', () => {
    const estimate = estimateCost(tokens(), 'claude-opus-5', '2026-08-01')
    expect(estimate.amount).toBe(0)
    expect(estimate.unpricedTokens).toBe(0)
  })

  it('counts processed tokens without double-counting reasoning inside output', () => {
    expect(processedTokens(tokens({ inputTokens: 1, cachedInputTokens: 2, cacheCreationTokens: 3, outputTokens: 4, reasoningTokens: 4 }))).toBe(10)
  })
})

describe('sumCost', () => {
  it('reports a partial total and the unpriced remainder when one model is unknown', () => {
    const total = sumCost([
      row({ tokens: tokens({ outputTokens: 1_000_000 }) }),
      row({ model: 'new-unknown-model', tokens: tokens({ outputTokens: 500_000 }) }),
    ])
    expect(total.amount).toBeCloseTo(75, 6)
    expect(total.unpricedTokens).toBe(500_000)
  })

  it('returns no amount when nothing in the set could be priced', () => {
    const total = sumCost([row({ model: 'new-unknown-model', tokens: tokens({ outputTokens: 10 }) })])
    expect(total.amount).toBeUndefined()
    expect(total.unpricedTokens).toBe(10)
  })

  it('returns no amount for an empty set rather than a confident zero', () => {
    expect(sumCost([]).amount).toBeUndefined()
  })
})
