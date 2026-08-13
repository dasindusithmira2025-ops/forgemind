import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RawCostSummary } from './RawCostSummary'
import type { ProviderUsageSnapshot } from '../../../native/types'
import type { ProviderUsage } from '../usageAnalytics'

function provider(partial: Partial<ProviderUsage> = {}): ProviderUsage {
  return { provider: 'claude', tokens: 1_000_000, cost: 75, costShare: 60, series: [], ...partial }
}

function snapshot(partial: Partial<ProviderUsageSnapshot> = {}): ProviderUsageSnapshot {
  return {
    provider: 'claude', collectedAt: new Date().toISOString(), source: 'supported_endpoint',
    freshness: 'live', status: 'ready', windows: [], ...partial,
  }
}

describe('RawCostSummary', () => {
  const providers = [provider(), provider({ provider: 'codex', cost: 50, costShare: 40, tokens: 2_000_000 })]

  it('isolates a failed provider: its history still renders, annotated', () => {
    render(
      <RawCostSummary
        totalCost={125}
        unpricedTokens={0}
        providers={providers}
        snapshots={[snapshot(), snapshot({ provider: 'codex', status: 'error', diagnosticMessage: 'Codex CLI not found' })]}
      />,
    )
    const codex = screen.getByText('Codex').closest('li') as HTMLElement
    expect(within(codex).getByText('$50.00')).toBeInTheDocument()
    expect(codex).toHaveTextContent('live data unavailable')
    // The healthy provider is not annotated by its neighbour's failure.
    const claude = screen.getByText('Claude Code').closest('li') as HTMLElement
    expect(claude).not.toHaveTextContent('live data unavailable')
  })

  it('does not annotate a provider whose cached data is merely stale', () => {
    render(
      <RawCostSummary totalCost={125} unpricedTokens={0} providers={providers} snapshots={[snapshot({ status: 'stale' })]} />,
    )
    expect(screen.getByText('Claude Code').closest('li')).not.toHaveTextContent('live data unavailable')
  })

  it('marks an unknown share without implying a zero share', () => {
    render(
      <RawCostSummary
        totalCost={undefined}
        unpricedTokens={6_200_000}
        providers={[provider({ cost: undefined, costShare: undefined })]}
        snapshots={[]}
      />,
    )
    const bar = screen.getByRole('progressbar', { name: /claude code share/i })
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).toHaveAttribute('aria-valuetext', 'Share unavailable')
    expect(screen.getByText(/— of cost/)).toBeInTheDocument()
    expect(screen.getByText(/Excludes 6\.20M tokens/)).toBeInTheDocument()
  })

  it('always labels the headline as an estimate rather than a charge', () => {
    render(<RawCostSummary totalCost={125} unpricedTokens={0} providers={providers} snapshots={[]} />)
    expect(screen.getByText('* if billed at full API rate')).toBeInTheDocument()
    expect(screen.getByTitle(/not an amount you were charged/i)).toBeInTheDocument()
  })
})
