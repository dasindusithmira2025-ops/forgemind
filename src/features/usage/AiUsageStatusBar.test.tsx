import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ native: { getAiUsageSnapshots: vi.fn(), refreshAiUsage: vi.fn(), getAiUsageDiagnostics: vi.fn() } }))
vi.mock('../../native/commands', () => ({ native: mocks.native }))
vi.mock('../../native/events', () => ({ onAiUsageChanged: vi.fn().mockResolvedValue(() => undefined), onTerminalExit: vi.fn().mockResolvedValue(() => undefined) }))

import { AiUsageStatusBar } from './AiUsageStatusBar'

const claude = {
  provider: 'claude' as const, collectedAt: new Date().toISOString(), source: 'local_session_state' as const,
  freshness: 'live' as const, status: 'ready' as const, windows: [
    { kind: 'five_hour' as const, usedPercent: 57, remainingPercent: 43, source: 'local_session_state' as const, confidence: 'authoritative' as const, isWarning: false, isCritical: false, resetLabel: '2h 54m' },
    { kind: 'weekly' as const, usedPercent: 89, remainingPercent: 11, source: 'local_session_state' as const, confidence: 'authoritative' as const, isWarning: true, isCritical: false },
  ],
}

describe('AiUsageStatusBar', () => {
  beforeEach(() => { mocks.native.getAiUsageSnapshots.mockResolvedValue([claude]); mocks.native.refreshAiUsage.mockResolvedValue([claude]) })
  it('shows honest missing windows and an anchored keyboard-dismissible popover without account controls', async () => {
    render(<AiUsageStatusBar />)
    const chip = await screen.findByRole('button', { name: /claude usage/i })
    expect(chip).toHaveTextContent('43%')
    fireEvent.click(chip)
    expect(await screen.findByRole('dialog', { name: /claude usage/i })).toHaveTextContent('11% left')
    expect(screen.queryByText(/manage accounts|account selector|email/i)).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(chip).toHaveFocus()
  })
})
