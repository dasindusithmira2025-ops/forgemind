import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run, RunDetail, RunInboxSummary, RunQuery } from './runTypes'

// A minimal in-memory fake of the Run Engine IPC surface. The store must be backend-authoritative:
// it never advances a Run itself, it only mirrors what these commands return.
const backend = {
  runs: [] as Run[],
  summary: { running: 0, waitingApproval: 0, reviewReady: 0, failed: 0, interrupted: 0 } as RunInboxSummary,
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    projectId: 'p1',
    workspaceId: null,
    parentRunId: null,
    rootRunId: 'run-1',
    retryOfRunId: null,
    swarmId: null,
    swarmTaskId: null,
    runType: 'agent_task',
    executionStrategy: 'single_agent',
    isolation: 'isolated_worktree',
    objective: 'Fix the detach regression',
    providerId: 'claude',
    modelId: null,
    reasoningEffort: null,
    terminalSessionId: null,
    providerSessionId: null,
    workingDirectory: null,
    worktreePath: null,
    branchName: null,
    contextPackId: null,
    status: 'queued',
    statusReason: null,
    triggerSource: 'manual',
    requestedBy: 'user',
    errorCode: null,
    errorMessage: null,
    resultSummary: null,
    createdAt: '2026-08-23T10:00:00Z',
    queuedAt: '2026-08-23T10:00:00Z',
    startedAt: null,
    completedAt: null,
    updatedAt: '2026-08-23T10:00:00Z',
    metadata: {},
    ...overrides,
  }
}

const list = vi.fn(async (query: RunQuery) => {
  let runs = backend.runs.filter((run) => run.projectId === query.projectId)
  if (query.needsAttentionOnly) {
    runs = runs.filter((run) => run.status === 'waiting_approval' || run.status === 'review_ready')
  }
  if (query.activeOnly) {
    runs = runs.filter((run) => !['succeeded', 'failed', 'cancelled', 'interrupted'].includes(run.status))
  }
  return runs
})
const create = vi.fn(async (request: { projectId: string; objective: string }) => {
  const run = makeRun({ id: `run-${backend.runs.length + 1}`, projectId: request.projectId, objective: request.objective })
  backend.runs = [...backend.runs, run]
  return run
})
const cancel = vi.fn(async (runId: string) => {
  backend.runs = backend.runs.map((run) => (run.id === runId ? { ...run, status: 'cancelled' as const } : run))
  return backend.runs.find((run) => run.id === runId)!
})
const retry = vi.fn(async (runId: string) => {
  const previous = backend.runs.find((run) => run.id === runId)!
  const fresh = makeRun({ id: `run-${backend.runs.length + 1}`, projectId: previous.projectId, retryOfRunId: runId })
  backend.runs = [...backend.runs, fresh]
  return fresh
})
const detail = vi.fn(async (runId: string): Promise<RunDetail> => ({
  run: backend.runs.find((run) => run.id === runId)!,
  events: [],
  approvals: [],
  children: [],
}))
const inboxSummary = vi.fn(async (_projectId: string) => backend.summary)
const resolveApproval = vi.fn(async (_approvalId: string, _approved: boolean, _note?: string) => backend.runs[0])

vi.mock('./runApi', () => ({
  runApi: {
    list: (...args: unknown[]) => list(...(args as [RunQuery])),
    create: (...args: unknown[]) => create(...(args as [{ projectId: string; objective: string }])),
    cancel: (...args: unknown[]) => cancel(...(args as [string])),
    retry: (...args: unknown[]) => retry(...(args as [string])),
    detail: (...args: unknown[]) => detail(...(args as [string])),
    inboxSummary: (...args: unknown[]) => inboxSummary(...(args as [string])),
    resolveApproval: (...args: unknown[]) => resolveApproval(...(args as [string, boolean])),
  },
}))

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

import { resetRunStoreVersions, useRunStore } from './runStore'

describe('runStore (backend-authoritative)', () => {
  beforeEach(() => {
    backend.runs = []
    backend.summary = { running: 0, waitingApproval: 0, reviewReady: 0, failed: 0, interrupted: 0 }
    vi.clearAllMocks()
    resetRunStoreVersions()
    useRunStore.setState({
      runsByProject: {},
      detailById: {},
      summaryByProject: {},
      loadingProject: undefined,
      loadingDetailById: {},
      pendingByRun: {},
      error: undefined,
    })
  })

  it('creates a Run and reloads the project list from the backend', async () => {
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    const run = await useRunStore.getState().createRun({
      projectId: 'p1',
      objective: 'Fix the detach regression',
      runType: 'agent_task',
      executionStrategy: 'single_agent',
      isolation: 'isolated_worktree',
    })
    expect(run.id).toBe('run-1')
    // The store did not insert the Run itself; it re-read the authoritative list.
    expect(list).toHaveBeenCalledTimes(2)
    expect(useRunStore.getState().runsByProject.p1).toHaveLength(1)
  })

  it('never advances a Run status locally — cancelling re-reads the backend', async () => {
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    await useRunStore.getState().createRun({
      projectId: 'p1',
      objective: 'Something',
      runType: 'agent_task',
      executionStrategy: 'single_agent',
      isolation: 'shared_read_only',
    })
    await useRunStore.getState().cancelRun('run-1')
    expect(cancel).toHaveBeenCalledWith('run-1', false)
    expect(useRunStore.getState().runsByProject.p1[0].status).toBe('cancelled')
    // The pending marker is always cleared, so a row can never be stuck disabled.
    expect(useRunStore.getState().pendingByRun['run-1']).toBeUndefined()
  })

  it('preserves the active filter when a run-changed event triggers a refresh', async () => {
    backend.runs = [makeRun({ id: 'run-a', status: 'waiting_approval' }), makeRun({ id: 'run-b', status: 'succeeded' })]
    await useRunStore.getState().loadRuns({ projectId: 'p1', needsAttentionOnly: true })
    expect(useRunStore.getState().runsByProject.p1.map((run) => run.id)).toEqual(['run-a'])

    await useRunStore.getState().applyChange({
      projectId: 'p1',
      runId: 'run-b',
      rootRunId: 'run-b',
      parentRunId: null,
      swarmId: null,
      status: 'succeeded',
      kind: 'completed',
      sequence: 4,
      updatedAt: '2026-08-23T10:05:00Z',
    })

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ needsAttentionOnly: true }))
    expect(useRunStore.getState().runsByProject.p1.map((run) => run.id)).toEqual(['run-a'])
  })

  it('does not refetch detail for a Run the surface never opened', async () => {
    backend.runs = [makeRun({ id: 'run-a' })]
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    await useRunStore.getState().applyChange({
      projectId: 'p1',
      runId: 'run-a',
      rootRunId: 'run-a',
      parentRunId: null,
      swarmId: null,
      status: 'running',
      kind: 'started',
      sequence: 3,
      updatedAt: '2026-08-23T10:01:00Z',
    })
    expect(detail).not.toHaveBeenCalled()

    await useRunStore.getState().loadDetail('run-a')
    await useRunStore.getState().applyChange({
      projectId: 'p1',
      runId: 'run-a',
      rootRunId: 'run-a',
      parentRunId: null,
      swarmId: null,
      status: 'succeeded',
      kind: 'completed',
      sequence: 4,
      updatedAt: '2026-08-23T10:02:00Z',
    })
    expect(detail).toHaveBeenCalledTimes(2)
  })

  it('retrying keeps the original Run and adds the new attempt', async () => {
    backend.runs = [makeRun({ id: 'run-a', status: 'failed' })]
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    const fresh = await useRunStore.getState().retryRun('run-a')
    expect(fresh.retryOfRunId).toBe('run-a')
    const ids = useRunStore.getState().runsByProject.p1.map((run) => run.id)
    expect(ids).toContain('run-a')
    expect(ids).toContain(fresh.id)
  })

  it('surfaces a native failure as an error instead of silently succeeding', async () => {
    list.mockRejectedValueOnce(new Error('the Project is unavailable'))
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    expect(useRunStore.getState().error).toBe('the Project is unavailable')
    expect(useRunStore.getState().loadingProject).toBeUndefined()
  })

  it('drops a stale list response so a slow request cannot overwrite a newer one', async () => {
    backend.runs = [makeRun({ id: 'slow' })]
    let releaseSlow: (() => void) | undefined
    list.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          releaseSlow = () => resolve([makeRun({ id: 'slow' })])
        }),
    )

    const slow = useRunStore.getState().loadRuns({ projectId: 'p1' })
    backend.runs = [makeRun({ id: 'fresh' })]
    await useRunStore.getState().loadRuns({ projectId: 'p1' })
    releaseSlow?.()
    await slow

    expect(useRunStore.getState().runsByProject.p1.map((run) => run.id)).toEqual(['fresh'])
  })
})
