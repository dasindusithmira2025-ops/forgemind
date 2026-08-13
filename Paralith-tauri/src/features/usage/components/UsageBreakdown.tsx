import { UsageSegmented } from './UsageSegmented'
import { providerLabel, type DayUsage, type ModelUsage } from '../usageAnalytics'
import { formatCost, formatDay, formatPercent, formatTokens } from '../usageFormat'

export type BreakdownMode = 'model' | 'day'

const MODE_OPTIONS = [
  { value: 'model' as const, label: 'MODEL' },
  { value: 'day' as const, label: 'DAY' },
]

/**
 * The period's rows, by model or by day.
 *
 * Both views are derived from the analytics already in memory, so switching modes is a re-render
 * and never a backend round trip. An unpriced model keeps its row with an unavailable cost —
 * dropping it would hide real token consumption from the only place it is itemised.
 */
export function UsageBreakdown({
  mode,
  onModeChange,
  models,
  days,
}: {
  mode: BreakdownMode
  onModeChange: (mode: BreakdownMode) => void
  models: ModelUsage[]
  days: DayUsage[]
}) {
  const empty = mode === 'model' ? models.length === 0 : days.length === 0
  return (
    <section className="usage-breakdown" aria-label="Usage breakdown">
      <header className="usage-breakdown-header">
        <h2>Breakdown</h2>
        <UsageSegmented label="Breakdown grouping" value={mode} options={MODE_OPTIONS} onChange={onModeChange} />
      </header>
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">{mode === 'model' ? 'Model' : 'Date'}</th>
            <th scope="col" className="is-numeric">Cost</th>
            <th scope="col" className="is-numeric">Share</th>
            <th scope="col" className="is-numeric">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {empty && (
            <tr className="usage-table-empty">
              <td colSpan={4}>No usage recorded for this period</td>
            </tr>
          )}
          {mode === 'model'
            ? models.map((model) => (
                <tr key={`${model.provider}:${model.model ?? 'unreported'}`}>
                  <th scope="row">
                    <span className={`usage-table-dot is-${model.provider}`} aria-hidden />
                    <span className="usage-table-model">{model.model ?? 'Model not reported'}</span>
                    <span className="usage-table-provider">{providerLabel(model.provider)}</span>
                  </th>
                  <td className="is-numeric">{formatCost(model.cost)}</td>
                  <td className="is-numeric">{formatPercent(model.costShare)}</td>
                  <td className="is-numeric">{formatTokens(model.tokens)}</td>
                </tr>
              ))
            : days.map((day) => (
                <tr key={day.date}>
                  <th scope="row"><span className="usage-table-model">{formatDay(day.date)}</span></th>
                  <td className="is-numeric">{formatCost(day.cost)}</td>
                  <td className="is-numeric">{formatPercent(day.costShare)}</td>
                  <td className="is-numeric">{formatTokens(day.tokens)}</td>
                </tr>
              ))}
        </tbody>
      </table>
    </section>
  )
}
