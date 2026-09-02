import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: { listActivityThreads: vi.fn(), resyncActivity: vi.fn(), reviewActivityDeployment: vi.fn(), dismissActivityThread: vi.fn() },
}))
vi.mock('../../native/commands', () => ({
  native: mocks.native,
  asNativeError: (error: unknown) => ({ code: 'x', message: String(error) }),
}))
vi.mock('../../native/events', () => ({ onActivityChanged: vi.fn().mockResolvedValue(() => undefined) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }))

import type { ActivityThread } from '../../native/types'
import { ActivityDock } from './ActivityDock'
import { useActivityStore } from './activityStore'

const deployment: ActivityThread = {
  id: 'run-42',
  projectId: 'p1',
  source: 'github',
  title: 'Release · production',
  summary: 'Waiting for a deployment review',
  state: 'waiting_for_user',
  steps: [{ key: 'build', label: 'build', state: 'completed' }],
  approval: { runId: 42, environment: 'production', environmentIds: [7], canApprove: false, restriction: 'Only release managers can approve production.' },
  detail: { workflowPath: '.github/workflows/release.yml', branch: 'main', commitSha: 'abcdef1234', runNumber: 42, url: 'https://example.invalid/run/42' },
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  revision: 3,
}

beforeEach(() => {
  useActivityStore.setState({ threads: [deployment], open: true, loaded: true, error: undefined, reviewing: [], expanded: [] })
})

describe('ActivityDock', () => {
  it('explains why a deployment cannot be approved instead of offering a dead control', () => {
    render(<ActivityDock anchor={null} onClose={() => undefined} />)
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve).toBeDisabled()
    expect(approve).toHaveAttribute('title', 'Only release managers can approve production.')
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled()
    expect(screen.getByLabelText('Needs you')).toHaveTextContent('Only release managers can approve production.')
    expect(mocks.native.reviewActivityDeployment).not.toHaveBeenCalled()
  })

  it('keeps the technical detail collapsed until it is asked for', () => {
    render(<ActivityDock anchor={null} onClose={() => undefined} />)
    expect(screen.queryByText('release.yml')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Release · production/ }))
    expect(screen.getByText('release.yml')).toBeInTheDocument()
    expect(screen.getByText('abcdef1')).toBeInTheDocument()
    expect(screen.getByText('#42')).toBeInTheDocument()
  })
})
