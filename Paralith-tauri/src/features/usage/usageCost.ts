import { rateFor } from './usagePricing'
import type { TokenUsageSummary, UsageDailyRow } from '../../native/types'

/**
 * The equivalent-API-cost engine.
 *
 * Two rules carry the whole module:
 *  1. Cost is an *estimate* of list-price API spend, never money actually charged. Callers label it.
 *  2. An unpriced model yields `undefined`, never `0`. Unknown and free are different facts, and
 *     collapsing them would understate a bill and hide a model from the reader.
 */

const PER_MILLION = 1_000_000

export interface CostEstimate {
  /** Estimated list-price cost in USD, or `undefined` when no rate covers the model. */
  amount?: number
  /**
   * What the same input would have cost with no prompt cache, minus what it did cost. `undefined`
   * whenever the underlying rate is unknown — a savings figure invented from a missing price is
   * worse than no figure.
   */
  cacheSavings?: number
  /** Tokens that could not be priced. Surfaced so the UI can qualify a partial total. */
  unpricedTokens: number
}

/** Tokens processed in a bucket. Reasoning is inside output, so it is not added again. */
export function processedTokens(tokens: TokenUsageSummary): number {
  return tokens.inputTokens + tokens.cachedInputTokens + tokens.cacheCreationTokens + tokens.outputTokens
}

/**
 * Prices one bucket. `date` selects the rate in force, so re-pricing history after a published
 * price change cannot rewrite what an earlier day actually cost.
 */
export function estimateCost(tokens: TokenUsageSummary, model: string | undefined, date: string): CostEstimate {
  const rate = rateFor(model, date)
  if (!rate) return { unpricedTokens: processedTokens(tokens) }
  const amount =
    (tokens.inputTokens * rate.input +
      tokens.cachedInputTokens * rate.cachedInput +
      tokens.cacheCreationTokens * rate.cacheWrite +
      tokens.outputTokens * rate.output) /
    PER_MILLION
  // What the cache actually saved: the same reads charged at the full uncached input rate, less
  // what the discounted cache-read rate charged for them.
  const cacheSavings = (tokens.cachedInputTokens * (rate.input - rate.cachedInput)) / PER_MILLION
  return { amount, cacheSavings, unpricedTokens: 0 }
}

/**
 * Sums estimates across buckets.
 *
 * A total is reported as soon as *any* bucket could be priced — dropping the whole total because
 * one experimental model is unpriced would be less honest, not more. `unpricedTokens` tells the
 * reader the total is partial; only a set with nothing priced at all returns no amount.
 */
export function sumCost(rows: readonly UsageDailyRow[]): CostEstimate {
  let amount = 0
  let cacheSavings = 0
  let priced = 0
  let unpricedTokens = 0
  for (const row of rows) {
    const estimate = estimateCost(row.tokens, row.model, row.date)
    if (estimate.amount === undefined) {
      unpricedTokens += estimate.unpricedTokens
      continue
    }
    priced += 1
    amount += estimate.amount
    cacheSavings += estimate.cacheSavings ?? 0
  }
  return priced === 0 ? { unpricedTokens } : { amount, cacheSavings, unpricedTokens }
}
