import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UsageInstrument } from './UsageInstrument'
import type { ProviderUsageSnapshot, UsageTelemetrySnapshot } from '../../../native/types'

const claude: ProviderUsageSnapshot = {
  provider: 'claude', collectedAt: '2026-08-15T10:00:00Z', source: 'supported_endpoint', freshness: 'live', status: 'ready',
  windows: [{ kind: 'five_hour', usedPercent: 32, remainingPercent: 68, resetsAt: '2026-08-15T12:00:00Z', source: 'supported_endpoint', confidence: 'authoritative', isWarning: false, isCritical: false }],
}

const telemetry: UsageTelemetrySnapshot = {
  system: { sampledAt: '2026-08-15T10:00:00Z', cpuPercent: 41, memoryUsedBytes: 8 * 1024 ** 3, memoryTotalBytes: 16 * 1024 ** 3, diskUsedBytes: 500 * 1024 ** 3, diskTotalBytes: 1_000 * 1024 ** 3, state: 'ready', confidence: 'confirmed' },
  github: { fetchedAt: '2026-08-15T10:00:00Z', sourceUpdatedAt: '2026-08-15T10:00:00Z', login: 'paralith-dev', name: 'Paralith Dev', repositories: 12, totalContributions: 42, activeDays: 6, averageContributionsPerActiveDay: 7, bestDay: { date: '2026-08-14', count: 12 }, contributions: [{ date: '2026-08-14', count: 12 }], state: 'ready', confidence: 'confirmed' },
}

describe('UsageInstrument', () => {
  it('renders verified quota, activity, and machine measurements', () => {
    render(<UsageInstrument snapshots={[claude]} telemetry={telemetry} isRefreshing={false} onRefreshAI={vi.fn()} onRefreshGitHub={vi.fn()} onRefreshAll={vi.fn()} />)
    expect(screen.getByText('68%')).toBeInTheDocument()
    expect(screen.getAllByText('SESSION')).not.toHaveLength(0)
    expect(screen.getByText('GITHUB / paralith-dev')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('8.0 GB / 16.0 GB')).toBeInTheDocument()
  })

  it('keeps unavailable sources explicit instead of rendering zeroes', () => {
    const onRefreshAll = vi.fn()
    render(<UsageInstrument snapshots={[]} isRefreshing={false} onRefreshAI={vi.fn()} onRefreshGitHub={vi.fn()} onRefreshAll={onRefreshAll} />)
    expect(screen.getAllByText('No live quota reported')).toHaveLength(2)
    expect(screen.getByText('Connect GitHub with gh auth login to load developer activity.')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /system telemetry/i })).getAllByText('—')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /refresh all/i }))
    expect(onRefreshAll).toHaveBeenCalledOnce()
  })
})
