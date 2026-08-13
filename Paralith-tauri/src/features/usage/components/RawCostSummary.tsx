import { providerLabel, type ProviderUsage } from '../usageAnalytics'
import { formatCost, formatPercent, formatTokens, UNKNOWN } from '../usageFormat'
import type { ProviderUsageSnapshot, UsageSnapshotStatus } from '../../../native/types'

/** Statuses that mean the live collector could not report — recorded history still renders. */
const FAILED_STATUSES: UsageSnapshotStatus[] = ['error', 'unauthenticated', 'unsupported']

const ESTIMATE_NOTE =
  'Estimated from observed tokens at published API list prices. Claude and Codex subscriptions are not billed this way — this is not an amount you were charged.'

/**
 * The headline equivalent-cost figure and its per-provider split.
 *
 * The asterisk is load-bearing. A subscription does not charge API rates, so presenting this
 * number without qualification would be the single most misleading thing the page could do.
 */
export function RawCostSummary({
  totalCost,
  unpricedTokens,
  providers,
  snapshots,
}: {
  totalCost?: number
  unpricedTokens: number
  providers: ProviderUsage[]
  snapshots: ProviderUsageSnapshot[]
}) {
  return (
    <section className="usage-cost-summary" aria-label="Raw token cost">
      <p className="usage-eyebrow">Raw token cost</p>
      <p className="usage-headline">
        {formatCost(totalCost)}
        <abbr className="usage-headline-mark" title={ESTIMATE_NOTE}>*</abbr>
      </p>
      <p className="usage-headline-note">* if billed at full API rate</p>
      {unpricedTokens > 0 && (
        <p className="usage-headline-note is-warning">
          Excludes {formatTokens(unpricedTokens)} tokens from models with no published rate.
        </p>
      )}

      <ul className="usage-provider-list">
        {providers.map((provider) => {
          const snapshot = snapshots.find((item) => item.provider === provider.provider)
          // Explicit failures only. Treating any unrecognised status as a failure would let a new
          // backend status label silently annotate every healthy provider as broken.
          const unavailable = snapshot !== undefined && FAILED_STATUSES.includes(snapshot.status)
          return (
            <li key={provider.provider} className={`usage-provider is-${provider.provider}`}>
              <div className="usage-provider-head">
                <span className="usage-provider-mark" aria-hidden>
                  {provider.provider === 'claude' ? 'Cl' : 'Cx'}
                </span>
                <span className="usage-provider-name">{providerLabel(provider.provider)}</span>
                <span className="usage-provider-cost">{formatCost(provider.cost)}</span>
              </div>
              <div
                className="usage-provider-bar"
                role="progressbar"
                aria-label={`${providerLabel(provider.provider)} share of estimated cost`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={provider.costShare === undefined ? undefined : Math.round(provider.costShare)}
                aria-valuetext={provider.costShare === undefined ? 'Share unavailable' : formatPercent(provider.costShare)}
              >
                <i style={{ width: `${provider.costShare ?? 0}%` }} />
              </div>
              <p className="usage-provider-meta">
                {provider.costShare === undefined ? `${UNKNOWN} of cost` : `${formatPercent(provider.costShare)} of cost`}
                {' · '}
                {formatTokens(provider.tokens)} tokens
                {/* A live-collector failure never hides recorded history; it only annotates it. */}
                {unavailable && <span className="usage-provider-flag"> · live data unavailable</span>}
              </p>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
