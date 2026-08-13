import { RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DailyUsageChart, type ChartMetric } from './DailyUsageChart'
import { RawCostSummary } from './RawCostSummary'
import { UsageBreakdown, type BreakdownMode } from './UsageBreakdown'
import { UsageMetricStrip } from './UsageMetricStrip'
import { UsageSegmented } from './UsageSegmented'
import { useAiUsage } from '../aiUsageStore'
import { buildUsageAnalytics, USAGE_PERIODS, type UsagePeriod } from '../usageAnalytics'
import { useUsageHistory } from '../usageHistoryStore'
import { formatRange } from '../usageFormat'

const PERIOD_OPTIONS = USAGE_PERIODS.map((period) => ({ value: period, label: `${period} days` }))

/**
 * Historical token consumption and its equivalent API cost.
 *
 * Deliberately distinct from the status-bar quota popover: that surface reports how much of a
 * subscription window remains, this one reports what was actually consumed and what it would have
 * cost at list price. The two must never be added together or shown as one number.
 */
export function UsagePage() {
  const { rows, period, setPeriod, isLoading, isRefreshing, error, refresh } = useUsageHistory()
  const { snapshots } = useAiUsage()
  const [metric, setMetric] = useState<ChartMetric>('cost')
  const [breakdown, setBreakdown] = useState<BreakdownMode>('model')

  // Every derived view of the period comes from one computation, so the chart, strip and table
  // can never disagree about the same interval.
  const analytics = useMemo(() => buildUsageAnalytics(rows, period), [rows, period])

  return (
    <div className="usage-page">
      <div className="usage-container">
        <header className="usage-header">
          <h1>Usage</h1>
          <div className="usage-header-controls">
            <span className="usage-range">{formatRange(analytics.from, analytics.to)}</span>
            <UsageSegmented
              label="Reporting period"
              value={period}
              options={PERIOD_OPTIONS}
              onChange={(next) => setPeriod(next as UsagePeriod)}
            />
            <button
              type="button"
              className="usage-refresh"
              aria-label="Refresh usage"
              onClick={refresh}
              disabled={isRefreshing}
            >
              <RefreshCw size={13} className={isRefreshing ? 'is-spinning' : undefined} aria-hidden />
            </button>
          </div>
        </header>

        <p className="usage-live-region" role="status" aria-live="polite">
          {isRefreshing ? 'Refreshing usage' : isLoading ? 'Loading usage' : ''}
        </p>

        {error && <p className="usage-error">{error}</p>}

        {/* The layout is never replaced by a loading or empty state: a page that collapses on
            refresh makes the reader re-find every number they were already looking at. */}
        <div className="usage-top">
          <RawCostSummary
            totalCost={analytics.totalCost}
            unpricedTokens={analytics.unpricedTokens}
            providers={analytics.providers}
            snapshots={snapshots}
          />
          <DailyUsageChart providers={analytics.providers} metric={metric} onMetricChange={setMetric} />
        </div>

        <UsageMetricStrip metrics={analytics.metrics} />

        {!analytics.hasUsage && !isLoading && (
          <p className="usage-empty-note">
            No usage recorded for this period. Usage will appear here as Claude Code and Codex sessions are observed by Paralith.
          </p>
        )}

        <UsageBreakdown mode={breakdown} onModeChange={setBreakdown} models={analytics.models} days={analytics.days} />
      </div>
    </div>
  )
}
