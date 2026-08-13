import { useEffect, useMemo, useRef, useState } from 'react'
import { UsageSegmented } from './UsageSegmented'
import { providerLabel, type ProviderUsage } from '../usageAnalytics'
import { formatCost, formatDay, formatTokens } from '../usageFormat'

export type ChartMetric = 'cost' | 'tokens'

const METRIC_OPTIONS = [
  { value: 'cost' as const, label: 'COST' },
  { value: 'tokens' as const, label: 'TOKENS' },
]

const PADDING = { top: 12, right: 8, bottom: 20, left: 44 }
const GRID_LINES = 4

/**
 * Daily cost/token series, one line per provider.
 *
 * Hand-drawn SVG rather than a charting dependency: the whole surface is two paths and a set of
 * gridlines, and a chart library would add a bundle and a theming layer to draw them. It also
 * keeps the plot honest — every point is a real bucket, and a day with no observation is a real
 * zero on a padded axis rather than an interpolated gap.
 */
export function DailyUsageChart({
  providers,
  metric,
  onMetricChange,
}: {
  providers: ProviderUsage[]
  metric: ChartMetric
  onMetricChange: (metric: ChartMetric) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [height, setHeight] = useState(196)
  const [hover, setHover] = useState<number>()

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (entry?.contentRect.width) setWidth(entry.contentRect.width)
      if (entry?.contentRect.height) setHeight(entry.contentRect.height)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const dates = providers[0]?.series.map((point) => point.date) ?? []
  const values = useMemo(
    () =>
      providers.map((provider) => ({
        provider: provider.provider,
        // An unpriced day is drawn as 0 rather than breaking the line: the chart's job is the
        // shape of consumption, and the unpriced total is disclosed on the summary instead.
        points: provider.series.map((point) => (metric === 'cost' ? point.cost ?? 0 : point.tokens)),
      })),
    [providers, metric],
  )

  const max = Math.max(1, ...values.flatMap((series) => series.points))
  const plotWidth = Math.max(1, width - PADDING.left - PADDING.right)
  const plotHeight = Math.max(1, height - PADDING.top - PADDING.bottom)
  const x = (index: number) => PADDING.left + (dates.length <= 1 ? plotWidth / 2 : (index / (dates.length - 1)) * plotWidth)
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight

  const format = (value: number) => (metric === 'cost' ? formatCost(value) : formatTokens(value))
  // Sparse X labels: first, last and a couple between, so a 90-day axis stays readable.
  const labelStep = Math.max(1, Math.ceil(dates.length / 4))

  const pointer = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect || dates.length === 0) return
    const ratio = (clientX - rect.left - PADDING.left) / plotWidth
    setHover(Math.min(dates.length - 1, Math.max(0, Math.round(ratio * (dates.length - 1)))))
  }

  return (
    <section className="usage-chart-panel" aria-label="Daily usage">
      <header className="usage-chart-header">
        <h2>Daily {metric === 'cost' ? 'cost' : 'tokens'}</h2>
        <div className="usage-chart-controls">
          <UsageSegmented label="Chart metric" value={metric} options={METRIC_OPTIONS} onChange={onMetricChange} />
          <ul className="usage-chart-legend">
            {providers.map((provider) => (
              <li key={provider.provider} className={`is-${provider.provider}`}>
                <i aria-hidden />
                {providerLabel(provider.provider)}
              </li>
            ))}
          </ul>
        </div>
      </header>
      <div
        ref={ref}
        className="usage-chart-plot"
        tabIndex={0}
        role="img"
        aria-label={`Daily ${metric} per provider from ${dates[0] ?? 'the start of the period'} to ${dates[dates.length - 1] ?? 'today'}`}
        onMouseMove={(event) => pointer(event.clientX)}
        onMouseLeave={() => setHover(undefined)}
        onFocus={() => setHover((current) => current ?? dates.length - 1)}
        onBlur={() => setHover(undefined)}
        onKeyDown={(event) => {
          // Keyboard equivalent of hovering: the tooltip is the only way to read exact values.
          if (event.key === 'ArrowRight') { event.preventDefault(); setHover((current) => Math.min(dates.length - 1, (current ?? dates.length - 1) + 1)) }
          if (event.key === 'ArrowLeft') { event.preventDefault(); setHover((current) => Math.max(0, (current ?? dates.length - 1) - 1)) }
          if (event.key === 'Escape') setHover(undefined)
        }}
      >
        <svg width={width} height={height} aria-hidden>
          {Array.from({ length: GRID_LINES + 1 }, (_, index) => {
            const value = (max / GRID_LINES) * (GRID_LINES - index)
            const lineY = y(value)
            return (
              <g key={index}>
                <line className="usage-chart-grid" x1={PADDING.left} x2={width - PADDING.right} y1={lineY} y2={lineY} />
                <text className="usage-chart-axis" x={PADDING.left - 8} y={lineY + 3} textAnchor="end">
                  {format(value)}
                </text>
              </g>
            )
          })}

          {values.map((series) => {
            const line = series.points.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(value)}`).join(' ')
            const area = `${line} L${x(series.points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
            return (
              <g key={series.provider} className={`usage-chart-series is-${series.provider}`}>
                <path className="usage-chart-area" d={area} />
                <path className="usage-chart-line" d={line} />
              </g>
            )
          })}

          {dates.map((date, index) =>
            index % labelStep === 0 || index === dates.length - 1 ? (
              <text key={date} className="usage-chart-axis" x={x(index)} y={height - 5} textAnchor="middle">
                {formatDay(date)}
              </text>
            ) : null,
          )}

          {hover !== undefined && dates.length > 0 && (
            <g>
              <line className="usage-chart-cursor" x1={x(hover)} x2={x(hover)} y1={PADDING.top} y2={PADDING.top + plotHeight} />
              {values.map((series) => (
                <circle key={series.provider} className={`usage-chart-dot is-${series.provider}`} cx={x(hover)} cy={y(series.points[hover] ?? 0)} r={3} />
              ))}
            </g>
          )}
        </svg>

        {hover !== undefined && dates.length > 0 && (
          <div
            className="usage-chart-tooltip"
            role="status"
            style={{ left: `${Math.min(Math.max(x(hover), PADDING.left + 60), width - 60)}px` }}
          >
            <strong>{formatDay(dates[hover])}</strong>
            {values.map((series) => (
              <span key={series.provider} className={`is-${series.provider}`}>
                <i aria-hidden />
                {providerLabel(series.provider)}
                <b>{format(series.points[hover] ?? 0)}</b>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
