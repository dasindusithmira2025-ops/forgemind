import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MergeReadiness, RepositoryOperationRecord, RepositorySnapshot } from '../../native/types'

const handlers: Record<string, (payload: unknown) => void> = {}

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ code: (error as { code?: string })?.code ?? 'e', message: error instanceof Error ? error.message : String(error) }),
  native: {
    inspectRepository: vi.fn(),
    getGitHubProviderStatus: vi.fn().mockResolvedValue({ provider: 'github', authenticated: false, permissions: [], message: '' }),
    listRepositoryApprovals: vi.fn().mockResolvedValue([]),
    listRepositoryWorktreeLeases: vi.fn().mockResolvedValue([]),
    getWorktreeConflictRisks: vi.fn().mockResolvedValue([]),
    executeRepositoryOperation: vi.fn(),
    decideRepositoryApproval: vi.fn(),
    refreshRepositoryRemoteProjection: vi.fn().mockResolvedValue({ projectId: 'p1', provider: 'github', repository: {}, objects: [], lastSuccessfulSync: '', stale: false }),
    getRepositoryDiff: vi.fn().mockResolvedValue({ text: '', totalBytes: 0, offset: 0, truncated: false, binary: false }),
    evaluateMergeReadiness: vi.fn(),
    listAgentProfiles: vi.fn().mockResolvedValue([{ id: 'a1', provider: 'claude', name: 'Claude', executablePath: '', available: true, createdAt: '', updatedAt: '' }]),
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
import { RepositoryCommandCenter } from './RepositoryCommandCenter'

const mockNative = native as unknown as Record<string, ReturnType<typeof vi.fn>>

function snapshot(projectId: string, overrides: Partial<RepositorySnapshot> = {}): RepositorySnapshot {
  return {
    projectId, repositoryPath: '/repo', worktreePath: '/repo', branch: 'main', headSha: 'sha12345',
    upstream: 'origin/main', ahead: 1, behind: 0, remotes: ['origin'],
    files: [
      { path: 'src/app.ts', indexStatus: ' ', worktreeStatus: 'M', conflicted: false, untracked: false, renamed: false, deleted: false, submodule: false },
      { path: 'src/new.ts', indexStatus: 'A', worktreeStatus: ' ', conflicted: false, untracked: false, renamed: false, deleted: false, submodule: false },
    ],
    health: {
      gitAvailable: true, worktreeValid: true, bare: false, shallow: false, mergeInProgress: false,
      rebaseInProgress: false, cherryPickInProgress: false, revertInProgress: false, indexLocked: false,
      submodulesPresent: false, gitLfsAvailable: true, warnings: [],
    },
    capturedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function okRecord(kind: string): RepositoryOperationRecord {
  return { id: `op-${kind}`, projectId: 'p1', kind, status: 'succeeded', policy: { decision: 'allowed', risk: 'low', reason: 'ok' }, createdAt: '2026-01-01T00:00:00Z' }
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  useRepositoryStore.getState().reset()
  vi.clearAllMocks()
  mockNative.getGitHubProviderStatus.mockResolvedValue({ provider: 'github', authenticated: false, permissions: [], message: '' })
  mockNative.listRepositoryApprovals.mockResolvedValue([])
  mockNative.listRepositoryWorktreeLeases.mockResolvedValue([])
  mockNative.getWorktreeConflictRisks.mockResolvedValue([])
  mockNative.refreshRepositoryRemoteProjection.mockResolvedValue({ projectId: 'p1', provider: 'github', repository: {}, objects: [], lastSuccessfulSync: '', stale: false })
  mockNative.getRepositoryDiff.mockResolvedValue({ text: '', totalBytes: 0, offset: 0, truncated: false, binary: false })
  mockNative.listAgentProfiles.mockResolvedValue([{ id: 'a1', provider: 'claude', name: 'Claude', executablePath: '', available: true, createdAt: '', updatedAt: '' }])
})

describe('RepositoryCommandCenter', () => {
  it('renders the header and section nav once the snapshot is ready', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    expect(await screen.findByText('Alpha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Overview/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pull Requests/ })).toBeInTheDocument()
  })

  it('shows a not-a-repository error state with retry', async () => {
    mockNative.inspectRepository.mockRejectedValue({ code: 'not_a_repository', message: 'not a git repository' })
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    expect(await screen.findByText('No git repository here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('lists changed files and stages one through the typed operation contract', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    mockNative.executeRepositoryOperation.mockResolvedValue(okRecord('stage_paths'))
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    fireEvent.click(await screen.findByRole('button', { name: /Changes/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stage src/app.ts' }))
    await waitFor(() => expect(mockNative.executeRepositoryOperation).toHaveBeenCalled())
    const call = mockNative.executeRepositoryOperation.mock.calls[0][0]
    expect(call.operation).toEqual({ kind: 'stage_paths', paths: ['src/app.ts'] })
    expect(call.context.projectId).toBe('p1')
  })

  it('exposes unified and split diff modes', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    fireEvent.click(await screen.findByRole('button', { name: /Changes/ }))
    expect(await screen.findByRole('tab', { name: 'Unified' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Split' })).toBeInTheDocument()
  })

  it('surfaces the agent worktree dialog with agent, branch and permission before dispatch', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    mockNative.executeRepositoryOperation.mockResolvedValue(okRecord('create_agent_worktree'))
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    fireEvent.click(await screen.findByRole('button', { name: /Branches/ }))
    fireEvent.click(await screen.findByRole('button', { name: /New agent worktree/ }))
    expect(await screen.findByText(/Create a git worktree and branch/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Create agent worktree' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create agent worktree' }))
    await waitFor(() => expect(mockNative.executeRepositoryOperation).toHaveBeenCalled())
    expect(mockNative.executeRepositoryOperation.mock.calls[0][0].operation.kind).toBe('create_agent_worktree')
  })

  it('renders the backend merge-readiness decision as blocked', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    mockNative.refreshRepositoryRemoteProjection.mockResolvedValue({
      projectId: 'p1', provider: 'github', repository: {}, lastSuccessfulSync: '', stale: false,
      objects: [{ kind: 'pull_request', externalId: '1', fetchedAt: '2026-01-01T00:00:00Z', stale: false, deleted: false, payload: { number: 5, title: 'A PR', headBranch: 'feat', baseBranch: 'main', headSha: 'deadbeef' } }],
    })
    const readiness: MergeReadiness = { ready: false, blockingReasons: ['Required review missing'], warnings: [], requiredActions: [], evidence: {}, evaluatedAt: '', sourceHeadSha: 'deadbeef' }
    mockNative.evaluateMergeReadiness.mockResolvedValue(readiness)
    render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    fireEvent.click(await screen.findByRole('button', { name: /Pull Requests/ }))
    expect(await screen.findByText('Merge blocked')).toBeInTheDocument()
    expect(screen.getByText('Required review missing')).toBeInTheDocument()
    const mergeButton = screen.getByRole('button', { name: /Merge pull request/ })
    expect(mergeButton).toBeDisabled()
  })

  it('resets repository state when the project changes', async () => {
    mockNative.inspectRepository.mockResolvedValue(snapshot('p1'))
    const { rerender } = render(<RepositoryCommandCenter projectId="p1" projectName="Alpha" />)
    await screen.findByText('Alpha')
    useRepositoryStore.setState({ operations: [okRecord('commit_change_set')] })
    mockNative.inspectRepository.mockResolvedValue(snapshot('p2'))
    rerender(<RepositoryCommandCenter projectId="p2" projectName="Beta" />)
    await waitFor(() => expect(useRepositoryStore.getState().projectId).toBe('p2'))
    expect(useRepositoryStore.getState().operations).toHaveLength(0)
  })
})
