import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: { listActivityThreads: vi.fn(), resyncActivity: vi.fn(), reviewActivityDeployment: vi.fn(), dismissActivityThread: vi.fn() },
}))
vi.mock('../../native/commands', () => ({
  native: mocks.native,
  asNativeError: (error: unknown) => ({ code: 'x', message: String(error) }),
}))
vi.mock('../../native/events', () => ({ onActivityChanged: vi.fn().mockResolvedValue(() => undefined) }))

import type { ActivityState, ActivityThread } from '../../native/types'
import { bucketThreads, pulseState, useActivityStore } from './activityStore'

let clock = 0
const thread = (id: string, state: ActivityState, minutesAgo = clock++): ActivityThread => ({
  id,
  projectId: 'p1',
  source: 'github',
  title: id,
  summary: `${id} summary`,
  state,
  steps: [],
  detail: {},
  startedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, minutesAgo)).toISOString(),
  observedAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  revision: 1,
})

beforeEach(() => {
  clock = 0
  useActivityStore.setState({ threads: [], open: false, loaded: false, error: undefined, reviewing: [], expanded: [] })
})

describe('bucketThreads', () => {
  it('sorts by priority first and recency second', () => {
    const running = thread('running', 'running')
    const waiting = thread('waiting', 'waiting_for_user')
    const failed = thread('failed', 'failed')
    const blocked = thread('blocked', 'blocked')
    const buckets = bucketThreads([running, waiting, failed, blocked])
    // The blocked thread updated after the waiting one, so it leads its bucket — but neither can
    // be outranked by the newer running job.
    expect(buckets.attention.map((item) => item.id)).toEqual(['blocked', 'waiting'])
    expect(buckets.live.map((item) => item.id)).toEqual(['running'])
    expect(buckets.recent.map((item) => item.id)).toEqual(['failed'])
  })

  it('keeps the settled tail short so Activity never becomes a notification archive', () => {
    const settled = Array.from({ length: 9 }, (_, index) => thread(`done-${index}`, 'completed'))
    const buckets = bucketThreads(settled)
    expect(buckets.recent).toHaveLength(6)
    expect(buckets.recent[0].id).toBe('done-8')
  })
})

describe('pulseState', () => {
  it('ranks an ask above a failure, a failure above live work, and live work above a completion', () => {
    const live = thread('live', 'running')
    const done = thread('done', 'completed')
    const failed = thread('failed', 'failed')
    const waiting = thread('waiting', 'waiting_for_user')
    expect(pulseState([])).toBe('idle')
    expect(pulseState([done])).toBe('complete')
    expect(pulseState([done, live])).toBe('live')
    expect(pulseState([done, live, failed])).toBe('failure')
    expect(pulseState([done, live, failed, waiting])).toBe('attention')
    expect(pulseState([thread('gone', 'cancelled')])).toBe('idle')
  })
})

describe('ingest', () => {
  it('replaces a thread in place, prepends an unseen one, and never regresses to an older revision', () => {
    const first = thread('run-1', 'queued')
    useActivityStore.getState().ingest(first)
    expect(useActivityStore.getState().threads).toHaveLength(1)

    useActivityStore.getState().ingest({ ...first, state: 'running', revision: 2 })
    expect(useActivityStore.getState().threads[0].state).toBe('running')

    // An out-of-order redelivery of revision 1 must not undo the running transition.
    useActivityStore.getState().ingest({ ...first, state: 'queued', revision: 1 })
    expect(useActivityStore.getState().threads[0].state).toBe('running')

    useActivityStore.getState().ingest(thread('run-2', 'running'))
    expect(useActivityStore.getState().threads.map((item) => item.id)).toEqual(['run-2', 'run-1'])
  })

  it('keeps an event that arrives while the initial snapshot is still loading', async () => {
    let release: (value: ActivityThread[]) => void = () => undefined
    mocks.native.listActivityThreads.mockReturnValue(new Promise<ActivityThread[]>((resolve) => { release = resolve }))
    const loading = useActivityStore.getState().hydrate()
    const live = { ...thread('run-live', 'running'), revision: 2 }
    useActivityStore.getState().ingest(live)

    release([{ ...live, state: 'queued', revision: 1 }])
    await loading

    expect(useActivityStore.getState().threads).toEqual([live])
  })
})

describe('review', () => {
  it('refuses a second submission while the first is in flight', async () => {
    const waiting = thread('deploy', 'waiting_for_user')
    useActivityStore.setState({ threads: [waiting] })
    let release: (value: ActivityThread) => void = () => undefined
    mocks.native.reviewActivityDeployment.mockReturnValue(new Promise<ActivityThread>((resolve) => { release = resolve }))

    const first = useActivityStore.getState().review('deploy', true)
    await useActivityStore.getState().review('deploy', true)
    expect(mocks.native.reviewActivityDeployment).toHaveBeenCalledTimes(1)

    release({ ...waiting, state: 'running', revision: 2 })
    await first
    expect(useActivityStore.getState().threads[0].state).toBe('running')
    expect(useActivityStore.getState().reviewing).toEqual([])
  })
})
