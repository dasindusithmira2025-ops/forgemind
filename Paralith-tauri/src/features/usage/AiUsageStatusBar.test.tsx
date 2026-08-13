import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ native: { getAiUsageSnapshots: vi.fn(), refreshAiUsage: vi.fn(), getAiUsageDiagnostics: vi.fn() } }))
vi.mock('../../native/commands', () => ({ native: mocks.native }))
vi.mock('../../native/events', () => ({ onAiUsageChanged: vi.fn().mockResolvedValue(() => undefined), onTerminalExit: vi.fn().mockResolvedValue(() => undefined) }))

import { useNativeOverlayStore } from '../../stores/nativeOverlay'
import { AiUsageStatusBar } from './AiUsageStatusBar'
import { placeUsagePopover } from './usagePopoverPlacement'

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

  it('places the roster fully inside the viewport without relying on a transform', async () => {
    render(<AiUsageStatusBar />)
    fireEvent.click(await screen.findByRole('button', { name: /subscription usage/i }))
    const dialog = await screen.findByRole('dialog', { name: /subscription usage/i })
    expect(dialog.style.transform).toBe('')
    expect(Number.parseFloat(dialog.style.top)).toBeGreaterThanOrEqual(0)
  })

  // The roster opens over the right-side tool panel, and the native Browser webview there is
  // composited above all HTML: without this lease no z-index can keep the roster visible.
  it('suppresses native webview overlays only while the roster is open', async () => {
    render(<AiUsageStatusBar />)
    const chip = await screen.findByRole('button', { name: /subscription usage/i })
    expect(useNativeOverlayStore.getState().count).toBe(0)
    fireEvent.click(chip)
    await screen.findByRole('dialog', { name: /subscription usage/i })
    expect(useNativeOverlayStore.getState().count).toBe(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(useNativeOverlayStore.getState().count).toBe(0)
  })
})

describe('placeUsagePopover', () => {
  // The trigger lives in the bottom status bar, so the roster must open upward and never spill past
  // the window bottom, where the Windows taskbar hides it.
  const statusBarChip = { top: 874, bottom: 896, right: 1100 }
  const viewport = { width: 1440, height: 900 }

  it('stacks the roster above a status-bar trigger', () => {
    const { left, top } = placeUsagePopover(statusBarChip, viewport, { width: 392, height: 420 })
    expect(top).toBe(874 - 8 - 420)
    expect(top + 420).toBeLessThanOrEqual(statusBarChip.top)
    expect(left).toBe(1100 - 392)
  })

  it('keeps a roster taller than the space above it inside the viewport', () => {
    const { top } = placeUsagePopover(statusBarChip, viewport, { width: 392, height: 876 })
    expect(top).toBeGreaterThanOrEqual(12)
    expect(top + 876).toBeLessThanOrEqual(viewport.height)
  })

  it('flips below a trigger that sits at the top of the window', () => {
    const { top } = placeUsagePopover({ top: 6, bottom: 32, right: 1100 }, viewport, { width: 392, height: 300 })
    expect(top).toBe(40)
  })

  it('clamps to the left margin in a narrow window', () => {
    const { left } = placeUsagePopover({ top: 300, bottom: 322, right: 120 }, { width: 360, height: 700 }, { width: 336, height: 300 })
    expect(left).toBe(12)
    expect(left + 336).toBeLessThanOrEqual(360)
  })
})
