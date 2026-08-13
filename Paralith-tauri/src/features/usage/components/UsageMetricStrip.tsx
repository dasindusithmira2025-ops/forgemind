import type { UsageMetrics } from '../usageAnalytics'
import { formatCost, formatMultiple, formatPercent, formatTokens, UNKNOWN } from '../usageFormat'

/**
 * One continuous metric strip, not five cards.
 *
 * These five numbers describe one period from five angles, so they read as one surface separated
 * by hairlines. Five floating cards would imply five independent measurements.
 */
export function UsageMetricStrip({ metrics }: { metrics: UsageMetrics }) {
  return (
    <section className="usage-metric-strip" aria-label="Usage summary metrics">
      <Metric
        label="Processed tokens"
        value={formatTokens(metrics.processedTokens)}
        detail={metrics.tokensPerActiveDay === undefined ? 'No active days' : `${formatTokens(metrics.tokensPerActiveDay)} per active day`}
      />
      <Metric
        label="Cached input"
        value={formatTokens(metrics.cachedInputTokens)}
        detail={metrics.cachedInputShare === undefined ? `${UNKNOWN} of observed input` : `${formatPercent(metrics.cachedInputShare)} of observed input`}
      />
      <Metric
        label="Uncached input"
        value={formatTokens(metrics.uncachedInputTokens)}
        detail={`${formatTokens(metrics.cacheWriteTokens)} cache writes`}
      />
      <Metric
        label="Output"
        value={formatTokens(metrics.outputTokens)}
        detail={`includes ${formatTokens(metrics.reasoningTokens)} reasoning`}
      />
      <Metric
        label="Cache savings"
        value={formatCost(metrics.cacheSavings)}
        detail={
          metrics.cacheSavingsMultiple === undefined
            ? 'Needs published rates for every model used'
            : `${formatMultiple(metrics.cacheSavingsMultiple)} the raw token cost`
        }
        title={
          metrics.cacheSavings === undefined
            ? 'Cache savings compare cached input priced at the full uncached rate against the discounted cache-read rate. It cannot be computed without a published rate.'
            : undefined
        }
      />
    </section>
  )
}

function Metric({ label, value, detail, title }: { label: string; value: string; detail: string; title?: string }) {
  return (
    <div className="usage-metric" title={title}>
      <p className="usage-metric-label">{label}</p>
      <p className="usage-metric-value">{value}</p>
      <p className="usage-metric-detail">{detail}</p>
    </div>
  )
}
