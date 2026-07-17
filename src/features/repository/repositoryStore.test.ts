import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepositoryOperationRecord, RepositorySnapshot } from '../../native/types'

// ---- Native bindings + event mocks -------------------------------------------------------
const handlers: Record<string, (payload: unknown) => void> = {}

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ code: 'e', message: error instanceof Error ? error.message : String(error) }),
  native: {
    inspectRepository: vi.fn(),
    getGitHubProviderStatus: vi.fn().mockResolvedValue({ authenticated: true }),
    listRepositoryApprovals: vi.fn().mockResolvedValue([]),
    listRepositoryWorktreeLeases: vi.fn().mockResolvedValue([]),
    getWorktreeConflictRisks: vi.fn().mockResolvedValue([]),
    executeRepositoryOperation: vi.fn(),
    decideRepositoryApproval: vi.fn(),
    refreshRepositoryRemoteProjection: vi.fn(),
    getRepositoryDiff: vi.fn(),
  },
}))

vi.mock('../../native/events', () => {
  const register = (name: string) => (handler: (payload: unknown) => void) => { handlers[name] = handler; return Promise.resolve(() => { delete handlers[name] }) }
  return {
    onRepositoryStateChanged: register('state'),
    onRepositoryOperationProgress: register('progress'),
    onRepositoryApprovalRequired: register('approvalRequired'),
    onRepositoryApprovalDecision: register('approvalDecision'),
    onRepositorySyncHealth: register('syncHealth'),
  }
})

import { native } from '../../native/commands'
import { useRepositoryStore } from './repositoryStore'

const mockNative = native as unknown as Record<string, ReturnType<typeof vi.fn>>

function snapshot(projectId: string, overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    projectId, repositoryPath: '/repo', worktreePath: '/repo', branch: 'main', headSha: 'sha1',
    upstream: 'origin/main', ahead: 0, behind: 0, remotes: ['origin'], files: [],
    health: {
      gitAvailable: true, worktreeValid: true, bare: false, shallow: false, mergeInProgress: false,
      rebaseInProgress: false, cherryPickInProgress: false, revertInProgress: false, indexLocked: false,
      submodulesPresent: false, gitLfsAvailable: true, warnings: [],
    },
    capturedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function record(id: string, overrides: Partial<RepositoryOperationRecord> = {}): RepositoryOperationRecord {
  return {
    id, projectId: 'p1', kind: 'stage_paths', status: 'succeeded',
    policy: { decision: 'allowed', risk: 'low', reason: 'ok' }, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  useRepositoryStore.getState().reset()
  vi.clearAllMocks()
  mockNative.getGitHubProviderStatus.mockResolvedValue({ authenticated: true })
  mockNative.listRepositoryApprovals.mockResolvedValue([])
  mockNative.listRepositoryWorktreeLeases.mockResolvedValue([])
  mockNative.getWorktreeConflictRisks.mockResolvedValue([])
})

describe('repositoryStore.loadProject', () => {
  it('loads a snapshot and marks the surface ready', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    await useRepositoryStore.getState().loadProject('p1')
    const state = useRepositoryStore.getState()
    expect(state.load.status).toBe('ready')
    expect(state.snapshot?.projectId).toBe('p1')
  })

  it('records an error state when inspection fails', async () => {
    mockNative.inspectRepository.mockRejectedValue(new Error('not a repo'))
    await useRepositoryStore.getState().loadProject('p1')
    expect(useRepositoryStore.getState().load).toMatchObject({ status: 'error', errorMessage: 'not a repo' })
  })

  it('resets prior project state when switching projects', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    await useRepositoryStore.getState().loadProject('p1')
    useRepositoryStore.setState({ operations: [record('old')] })
    mockNative.inspectRepository.mockResolvedValue(snapshot('p2'))
    await useRepositoryStore.getState().loadProject('p2')
    const state = useRepositoryStore.getState()
    expect(state.projectId).toBe('p2')
    expect(state.operations).toHaveLength(0)
    expect(state.snapshot?.projectId).toBe('p2')
  })
})

describe('repositoryStore.runOperation', () => {
  beforeEach(async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    await useRepositoryStore.getState().loadProject('p1')
  })

  it('appends the returned record to the ledger and refreshes the snapshot', async () => {
    mockNative.executeRepositoryOperation.mockResolvedValue(record('op1'))
    await useRepositoryStore.getState().runOperation({ kind: 'stage_paths', paths: ['a.ts'] }, { key: 'stage:a.ts' })
    expect(useRepositoryStore.getState().operations[0].id).toBe('op1')
    // one inspect at load, one after the succeeded operation
    expect(mockNative.inspectRepository).toHaveBeenCalledTimes(2)
    const call = mockNative.executeRepositoryOperation.mock.calls[0][0]
    expect(call.context).toMatchObject({ projectId: 'p1', expectedBranch: 'main' })
    expect(call.context.idempotencyKey).toBeTruthy()
  })

  it('surfaces a failed operation message', async () => {
    mockNative.executeRepositoryOperation.mockResolvedValue(record('op2', { status: 'failed', errorMessage: 'push rejected' }))
    await useRepositoryStore.getState().runOperation({ kind: 'push_branch', remote: 'origin', branch: 'main', forceWithLease: false })
    expect(useRepositoryStore.getState().actionError).toBe('push rejected')
  })
})

describe('repositoryStore events', () => {
  beforeEach(async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    await useRepositoryStore.getState().loadProject('p1')
  })

  it('refreshes the snapshot only for the active project on state-changed', () => {
    const stop = useRepositoryStore.getState().subscribe()
    mockNative.inspectRepository.mockClear()
    handlers.state?.('other')
    expect(mockNative.inspectRepository).not.toHaveBeenCalled()
    handlers.state?.('p1')
    expect(mockNative.inspectRepository).toHaveBeenCalledTimes(1)
    stop()
  })

  it('stores operation progress events for the active project', () => {
    const stop = useRepositoryStore.getState().subscribe()
    handlers.progress?.({ operationId: 'op1', projectId: 'p1', kind: 'push_branch', phase: 'running', message: 'pushing', at: 'now' })
    expect(useRepositoryStore.getState().progress.op1?.message).toBe('pushing')
    stop()
  })
})
