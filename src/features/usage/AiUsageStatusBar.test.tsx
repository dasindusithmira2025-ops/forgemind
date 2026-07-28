import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ native: { getAiUsageSnapshots: vi.fn(), refreshAiUsage: vi.fn(), getAiUsageDiagnostics: vi.fn() } }))
vi.mock('../../native/commands', () => ({ native: mocks.native }))
vi.mock('../../native/events', () => ({ onAiUsageChanged: vi.fn().mockResolvedValue(() => undefined), onTerminalExit: vi.fn().mockResolvedValue(() => undefined) }))

import { AiUsageStatusBar } from './AiUsageStatusBar'

const claude = {
  provider: 'claude' as const, collectedAt: new Date().toISOString(), sourceUpdatedAt: new Date().toISOString(), source: 'supported_endpoint' as const,
  freshness: 'live' as const, status: 'ready' as const, windows: [
    { kind: 'five_hour' as const, usedPercent: 57, remainingPercent: 43, source: 'supported_endpoint' as const, confidence: 'authoritative' as const, isWarning: false, isCritical: false, resetsAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString() },
    { kind: 'weekly' as const, usedPercent: 89, remainingPercent: 11, source: 'supported_endpoint' as const, confidence: 'authoritative' as const, isWarning: true, isCritical: false },
  ],
}

describe('AiUsageStatusBar', () => {
  beforeEach(() => { mocks.native.getAiUsageSnapshots.mockResolvedValue([claude]); mocks.native.refreshAiUsage.mockResolvedValue([claude]) })
  it('summarizes the tightest live window and opens a keyboard-dismissible provider roster', async () => {
    render(<AiUsageStatusBar />)
    const chip = await screen.findByRole('button', { name: /subscription usage.*claude 11% remaining/i })
    expect(chip).toHaveTextContent('11%')
    fireEvent.click(chip)
    const dialog = await screen.findByRole('dialog', { name: /subscription usage/i })
    expect(dialog).toHaveTextContent('Anthropic account')
    expect(dialog).toHaveTextContent('11% left')
    expect(screen.getByRole('progressbar', { name: /5-hour remaining/i })).toHaveAttribute('aria-valuenow', '43')
    expect(screen.queryByText(/manage accounts|account selector|email/i)).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
  })
})
