import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: { listActivityThreads: vi.fn(), resyncActivity: vi.fn(), reviewActivityDeployment: vi.fn(), dismissActivityThread: vi.fn() },
  sendNotification: vi.fn(),
  isPermissionGranted: vi.fn().mockResolvedValue(true),
  requestPermission: vi.fn().mockResolvedValue('granted'),
}))
vi.mock('../../native/commands', () => ({
  native: mocks.native,
  asNativeError: (error: unknown) => ({ code: 'x', message: String(error) }),
}))
vi.mock('../../native/events', () => ({ onActivityChanged: vi.fn().mockResolvedValue(() => undefined) }))
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: mocks.sendNotification,
  isPermissionGranted: mocks.isPermissionGranted,
  requestPermission: mocks.requestPermission,
}))

import type { ActivityState, ActivityThread } from '../../native/types'
import { ActivityAlerts } from './ActivityAlerts'
import { alertKey, pendingAlerts, useActivityStore } from './activityStore'

const thread = (id: string, state: ActivityState): ActivityThread => ({
  id,
  projectId: 'p1',
  source: 'github',
  title: id,
  summary: `${id} summary`,
  state,
  steps: [],
  detail: {},
  startedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  observedAt: new Date().toISOString(),
  revision: 1,
})

beforeEach(() => {
  mocks.sendNotification.mockClear()
  useActivityStore.setState({ threads: [], open: false, loaded: false, error: undefined, reviewing: [], expanded: [] })
  vi.spyOn(document, 'hasFocus').mockReturnValue(false)
})

afterEach(() => vi.restoreAllMocks())

describe('pendingAlerts', () => {
  it('alerts once per state transition, not once per delivery', () => {
    const failed = thread('build', 'failed')
    const running = thread('deploy', 'running')
    const fired = new Set<string>()
    expect(pendingAlerts([failed, running], fired).map((item) => item.id)).toEqual(['build'])
    fired.add(alertKey(failed))
    expect(pendingAlerts([failed, running], fired)).toEqual([])
    // The same thread moving on is a new transition and is allowed to interrupt again.
    expect(pendingAlerts([{ ...failed, state: 'completed' }], fired).map((item) => item.id)).toEqual(['build'])
  })

  it('orders simultaneous alerts newest first', () => {
    const older = { ...thread('older', 'failed'), updatedAt: '2026-01-01T00:00:00Z' }
    const newer = { ...thread('newer', 'completed'), updatedAt: '2026-01-01T00:01:00Z' }
    expect(pendingAlerts([older, newer], new Set()).map((item) => item.id)).toEqual(['newer', 'older'])
  })
})

describe('ActivityAlerts', () => {
  it('adopts the hydrate snapshot silently and only interrupts on what happens next', async () => {
    render(<ActivityAlerts />)
    await act(async () => { useActivityStore.setState({ threads: [thread('old-failure', 'failed')], loaded: true }) })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.sendNotification).not.toHaveBeenCalled()

    await act(async () => { useActivityStore.getState().ingest(thread('new-failure', 'failed')) })
    expect(await screen.findByRole('alert')).toHaveTextContent('new-failure')
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1)

    // A redelivery of the same thread at the same state must not re-notify.
    await act(async () => { useActivityStore.getState().ingest({ ...thread('new-failure', 'failed'), revision: 2 }) })
    expect(mocks.sendNotification).toHaveBeenCalledTimes(1)
  })

  it('stays silent in the OS while the window is focused, and never for merely running work', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<ActivityAlerts />)
    await act(async () => { useActivityStore.setState({ threads: [], loaded: true }) })

    await act(async () => { useActivityStore.getState().ingest(thread('build', 'running')) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    await act(async () => { useActivityStore.getState().ingest(thread('build-2', 'completed')) })
    expect(await screen.findByRole('status')).toHaveTextContent('build-2')
    expect(mocks.sendNotification).not.toHaveBeenCalled()
  })
})
