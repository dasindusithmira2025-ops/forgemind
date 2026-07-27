import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RepositoryIntelligence } from '../../native/types'

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({
    code: (error as { code?: string })?.code ?? 'e',
    message: error instanceof Error ? error.message : String(error),
  }),
  native: {
    getRepositoryIntelligence: vi.fn(),
    refreshRepositoryIntelligence: vi.fn(),
  },
}))

vi.mock('../../native/events', () => {
  const register = () => () => Promise.resolve(() => undefined)
  return {
    onRepositoryStateChanged: register(),
    onRepositoryOperationProgress: register(),
    onRepositoryApprovalRequired: register(),
    onRepositoryApprovalDecision: register(),
    onRepositorySyncHealth: register(),
  }
})

import { native } from '../../native/commands'
import { useRepositoryStore } from './repositoryStore'
import { IntelligenceSection } from './components/IntelligenceSection'

const mockNative = native as unknown as Record<string, ReturnType<typeof vi.fn>>

function intelligence(overrides: Partial<RepositoryIntelligence> = {}): RepositoryIntelligence {
  return {
    projectId: 'p1',
    repositoryId: 'repo-1',
    worktreePath: '/repo',
    headSha: 'sha12345',
    statusHash: 'status-1',
    graph: {
      id: 'snap-1', repositoryId: 'repo-1', projectId: 'p1', worktreePath: '/repo',
      headSha: 'sha12345', statusHash: 'status-1', extractorVersion: 'repo-graph-v1',
      createdAt: '2026-07-27T00:00:00Z', nodes: [], edges: [],
    },
    impact: {
      changedFiles: ['src/parser.ts'],
      changedSymbols: [],
      directDependents: [
        { path: 'src/caller.ts', reason: "References the stem 'parser'.", confidence: 0.5, evidence: ["git grep -F 'parser'"] },
      ],
      relatedTests: [
        { path: 'src/parser.test.ts', reason: "Test filename matches the stem 'parser'.", confidence: 0.6, evidence: ['stem match'] },
      ],
      relatedWorkflows: [],
      riskSignals: [
        { code: 'ci_configuration_changed', severity: 'high', summary: 'CI workflow definitions are modified.', evidence: ['.github/workflows/ci.yml'] },
      ],
      missingTestSignals: [],
      explanations: [],
      generatedAt: '2026-07-27T00:00:00Z',
    },
    ...overrides,
  }
}

beforeEach(() => {
  useRepositoryStore.getState().reset()
  vi.clearAllMocks()
  useRepositoryStore.setState({ projectId: 'p1' })
})

describe('IntelligenceSection', () => {
  it('offers extraction when no graph has ever been built', async () => {
    mockNative.getRepositoryIntelligence.mockResolvedValue(null)
    await useRepositoryStore.getState().loadIntelligence()
    render(<IntelligenceSection />)
    expect(await screen.findByText('No graph extracted yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Build repository graph/ })).toBeInTheDocument()
  })

  it('distinguishes "not read yet" from "never extracted"', () => {
    // A fresh store has `intelligence === undefined`, which must read as loading rather than as
    // the empty state — otherwise every normal load flashes "No graph extracted yet".
    render(<IntelligenceSection />)
    expect(screen.getByText('Reading repository graph…')).toBeInTheDocument()
    expect(screen.queryByText('No graph extracted yet')).not.toBeInTheDocument()
  })

  it('renders impact, risk signals and per-item confidence', async () => {
    mockNative.getRepositoryIntelligence.mockResolvedValue(intelligence())
    await useRepositoryStore.getState().loadIntelligence()
    render(<IntelligenceSection />)

    expect(await screen.findByText('Change impact')).toBeInTheDocument()
    expect(screen.getByText('CI workflow definitions are modified.')).toBeInTheDocument()
    expect(screen.getByText('.github/workflows/ci.yml')).toBeInTheDocument()

    // Heuristic relationships must surface their confidence, not read as certainties.
    expect(screen.getByText('src/parser.test.ts')).toBeInTheDocument()
    expect(screen.getByText('60%')).toBeInTheDocument()
    expect(screen.getByText('src/caller.ts')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('flags the graph as stale when HEAD has moved past the extraction', async () => {
    mockNative.getRepositoryIntelligence.mockResolvedValue(intelligence())
    await useRepositoryStore.getState().loadIntelligence()
    useRepositoryStore.setState({
      snapshot: { headSha: 'different-sha' } as never,
    })
    render(<IntelligenceSection />)
    expect(await screen.findByText(/HEAD moved/)).toBeInTheDocument()
  })

  it('rebuilds on demand and shows the refreshed projection', async () => {
    mockNative.getRepositoryIntelligence.mockResolvedValue(null)
    await useRepositoryStore.getState().loadIntelligence()
    mockNative.refreshRepositoryIntelligence.mockResolvedValue(intelligence())

    render(<IntelligenceSection />)
    fireEvent.click(await screen.findByRole('button', { name: /Build repository graph/ }))

    await waitFor(() => expect(mockNative.refreshRepositoryIntelligence).toHaveBeenCalledWith({ projectId: 'p1' }))
    expect(await screen.findByText('Change impact')).toBeInTheDocument()
  })

  it('surfaces an extraction failure with a retry', async () => {
    mockNative.getRepositoryIntelligence.mockRejectedValue(new Error('git is unavailable'))
    await useRepositoryStore.getState().loadIntelligence()
    render(<IntelligenceSection />)
    expect(await screen.findByText('git is unavailable')).toBeInTheDocument()
  })
})
