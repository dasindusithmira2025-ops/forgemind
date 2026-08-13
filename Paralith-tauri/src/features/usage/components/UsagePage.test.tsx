import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: {
    getAiUsageSnapshots: vi.fn(),
    refreshAiUsage: vi.fn(),
    getAiUsageDiagnostics: vi.fn(),
    getAiUsageHistory: vi.fn(),
  },
}))
vi.mock('../../../native/commands', () => ({ native: mocks.native }))
vi.mock('../../../native/events', () => ({
  onAiUsageChanged: vi.fn().mockResolvedValue(() => undefined),
  onTerminalExit: vi.fn().mockResolvedValue(() => undefined),
}))

import { UsagePage } from './UsagePage'
import type { ProviderUsageSnapshot, TokenUsageSummary, UsageDailyRow } from '../../../native/types'

function tokens(partial: Partial<TokenUsageSummary> = {}): TokenUsageSummary {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 0, ...partial }
}

function today(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)
}

const history: UsageDailyRow[] = [
  { date: today(), provider: 'claude', model: 'claude-opus-5', tokens: tokens({ outputTokens: 1_000_000, cachedInputTokens: 2_000_000 }) },
  { date: today(), provider: 'codex', model: 'gpt-5.6-sol', tokens: tokens({ outputTokens: 1_000_000, inputTokens: 500_000 }) },
  // 45 days back: inside the 90-day period, outside the 7- and 30-day periods.
  { date: today(45), provider: 'claude', model: 'claude-sonnet-5', tokens: tokens({ outputTokens: 4_000_000 }) },
]

const ready: ProviderUsageSnapshot = {
  provider: 'claude', collectedAt: new Date().toISOString(), source: 'supported_endpoint',
  freshness: 'live', status: 'ready', windows: [],
}

describe('UsagePage', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.native.getAiUsageSnapshots.mockResolvedValue([ready])
    mocks.native.refreshAiUsage.mockResolvedValue([ready])
    mocks.native.getAiUsageHistory.mockResolvedValue(history)
  })

  it('reports the estimated cost, both providers, and labels the figure as an estimate', async () => {
    render(<UsagePage />)
    // Claude $75 output + $3 cache reads; Codex $10 output + $0.625 input.
    expect(await screen.findByText('$88.63')).toBeInTheDocument()
    expect(screen.getByText('* if billed at full API rate')).toBeInTheDocument()
    const summary = screen.getByRole('region', { name: /raw token cost/i })
    expect(within(summary).getByText('Claude Code')).toBeInTheDocument()
    expect(within(summary).getByText('Codex')).toBeInTheDocument()
    expect(within(summary).getByText('$78.00')).toBeInTheDocument()
    expect(within(summary).getByText('$10.63')).toBeInTheDocument()
  })

  it('renders the five summary metrics', async () => {
    render(<UsagePage />)
    const strip = await screen.findByRole('region', { name: /usage summary metrics/i })
    for (const label of ['Processed tokens', 'Cached input', 'Uncached input', 'Output', 'Cache savings']) {
      expect(within(strip).getByText(label)).toBeInTheDocument()
    }
    // 2M cache reads on Opus save $13.50/MTok.
    expect(within(strip).getByText('$27.00')).toBeInTheDocument()
  })

  it('switches the reporting period and re-queries only the requested window', async () => {
    render(<UsagePage />)
    await screen.findByText('$88.63')
    expect(mocks.native.getAiUsageHistory).toHaveBeenCalledWith(30)
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(mocks.native.getAiUsageHistory).toHaveBeenCalledWith(90))
    // The 45-day-old Sonnet bucket only enters the total once the period covers it.
    expect(await screen.findByText('$148.63')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }))
    await waitFor(() => expect(mocks.native.getAiUsageHistory).toHaveBeenCalledWith(7))
    expect(await screen.findByText('$88.63')).toBeInTheDocument()
  })

  it('persists the selected period across mounts', async () => {
    const { unmount } = render(<UsagePage />)
    await screen.findByText('$88.63')
    fireEvent.click(screen.getByRole('radio', { name: '90 days' }))
    await waitFor(() => expect(mocks.native.getAiUsageHistory).toHaveBeenCalledWith(90))
    unmount()
    mocks.native.getAiUsageHistory.mockClear()
    render(<UsagePage />)
    await waitFor(() => expect(mocks.native.getAiUsageHistory).toHaveBeenCalledWith(90))
  })

  it('switches the chart between cost and tokens without refetching', async () => {
    render(<UsagePage />)
    await screen.findByText('$88.63')
    expect(screen.getByRole('heading', { name: 'Daily cost' })).toBeInTheDocument()
    const calls = mocks.native.getAiUsageHistory.mock.calls.length
    fireEvent.click(screen.getByRole('radio', { name: 'TOKENS' }))
    expect(await screen.findByRole('heading', { name: 'Daily tokens' })).toBeInTheDocument()
    expect(mocks.native.getAiUsageHistory).toHaveBeenCalledTimes(calls)
  })

  it('switches the breakdown between model and day without refetching', async () => {
    render(<UsagePage />)
    await screen.findByText('$88.63')
    const breakdown = screen.getByRole('region', { name: /usage breakdown/i })
    expect(within(breakdown).getByRole('columnheader', { name: 'Model' })).toBeInTheDocument()
    expect(within(breakdown).getByText('claude-opus-5')).toBeInTheDocument()
    const calls = mocks.native.getAiUsageHistory.mock.calls.length
    fireEvent.click(within(breakdown).getByRole('radio', { name: 'DAY' }))
    expect(await within(breakdown).findByRole('columnheader', { name: 'Date' })).toBeInTheDocument()
    expect(mocks.native.getAiUsageHistory).toHaveBeenCalledTimes(calls)
  })

  it('shows an unpriced model as unavailable rather than dropping it or pricing it at zero', async () => {
    mocks.native.getAiUsageHistory.mockResolvedValue([
      ...history,
      { date: today(), provider: 'codex', model: 'new-unknown-model', tokens: tokens({ outputTokens: 6_200_000 }) },
    ])
    render(<UsagePage />)
    const breakdown = await screen.findByRole('region', { name: /usage breakdown/i })
    const row = within(breakdown).getByText('new-unknown-model').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getAllByText('—')).toHaveLength(2)
    expect(within(row as HTMLElement).getByText('6.20M')).toBeInTheDocument()
    expect(screen.getByText(/Excludes 6\.20M tokens from models with no published rate/)).toBeInTheDocument()
  })

  it('keeps the whole layout on an empty period instead of replacing it with an empty state', async () => {
    mocks.native.getAiUsageHistory.mockResolvedValue([])
    render(<UsagePage />)
    expect(await screen.findByText(/No usage recorded for this period/)).toBeInTheDocument()
    // Every structural region survives: an empty page still has to be the same page.
    expect(screen.getByRole('region', { name: /raw token cost/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /usage summary metrics/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /usage breakdown/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /daily cost per provider/i })).toBeInTheDocument()
    // An unknown total is an em dash, never $0.00.
    expect(screen.getByRole('region', { name: /raw token cost/i })).toHaveTextContent('—')
  })

  it('keeps recorded history when a provider refresh fails', async () => {
    mocks.native.refreshAiUsage.mockRejectedValue(new Error('codex CLI unavailable'))
    render(<UsagePage />)
    await screen.findByText('$88.63')
    fireEvent.click(screen.getByRole('button', { name: /refresh usage/i }))
    await waitFor(() => expect(mocks.native.refreshAiUsage).toHaveBeenCalled())
    // The failure belongs to the live collector; the persisted analytics stay on screen.
    expect(await screen.findByText('$88.63')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /usage breakdown/i })).toHaveTextContent('claude-opus-5')
  })

  it('re-reads history after a refresh ingests new observations', async () => {
    render(<UsagePage />)
    await screen.findByText('$88.63')
    mocks.native.getAiUsageHistory.mockResolvedValue([
      { date: today(), provider: 'claude', model: 'claude-opus-5', tokens: tokens({ outputTokens: 2_000_000 }) },
    ])
    fireEvent.click(screen.getByRole('button', { name: /refresh usage/i }))
    const summary = await screen.findByRole('region', { name: /raw token cost/i })
    await waitFor(() => expect(summary.querySelector('.usage-headline')).toHaveTextContent('$150.00'))
  })
})

describe('UsagePage segmented controls', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.native.getAiUsageSnapshots.mockResolvedValue([ready])
    mocks.native.refreshAiUsage.mockResolvedValue([ready])
    mocks.native.getAiUsageHistory.mockResolvedValue(history)
  })

  it('moves between options with arrow keys and keeps one tab stop', async () => {
    render(<UsagePage />)
    await screen.findByText('$88.63')
    const active = screen.getByRole('radio', { name: '30 days' })
    expect(active).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: '7 days' })).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(active, { key: 'ArrowRight' })
    await waitFor(() => expect(screen.getByRole('radio', { name: '90 days' })).toHaveAttribute('aria-checked', 'true'))
  })
})
