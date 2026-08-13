/**
 * Shared display formatters for the Usage surface.
 *
 * Analytics compares numbers across rows, so every value in a column has to be the same shape.
 * These live outside the components for that reason: a total, a table cell and a chart tooltip
 * showing the same quantity must never disagree about its precision.
 *
 * `undefined` renders as an em dash everywhere. That is the one visual encoding of "not known",
 * and it must never be confused with a real zero.
 */

export const UNKNOWN = '—'

/** `984` · `12.4K` · `3.21M` · `1.24B` — three significant digits above 1000. */
export function formatTokens(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN
  const magnitude = Math.abs(value)
  if (magnitude < 1_000) return String(Math.round(value))
  const [divisor, suffix] =
    magnitude >= 1_000_000_000 ? [1_000_000_000, 'B'] : magnitude >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'K']
  const scaled = value / divisor
  return `${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2)}${suffix}`
}

/** `$0.10` · `$47.17` · `$2,106.47` — always two decimals, always grouped. */
export function formatCost(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** `0.0%` · `4.2%` · `38.6%`. A share of nothing is unknown, not zero. */
export function formatPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN
  return `${value.toFixed(1)}%`
}

/** `Jul 15` — the compact axis/range form. Dates are `YYYY-MM-DD` buckets, parsed as UTC. */
export function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** `Jul 15 to Aug 13` — the active interval shown beside the period controls. */
export function formatRange(from: string, to: string): string {
  return `${formatDay(from)} to ${formatDay(to)}`
}

/** `1.5x` — the cache-savings multiple against raw cost. */
export function formatMultiple(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return UNKNOWN
  return `${value.toFixed(1)}x`
}
