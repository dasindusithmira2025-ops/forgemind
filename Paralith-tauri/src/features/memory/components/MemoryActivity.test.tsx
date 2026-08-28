import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryActivity } from './MemoryActivity'
import { useMemoryStore } from '../memoryStore'
import type {
  AnalyzeImpactPayload,
  ImpactOutcome,
  KnowledgeJob,
  MemorySummary,
} from '../memoryTypes'

const jobsApi = vi.fn()
const cancelJobApi = vi.fn()
const listApi = vi.fn()

vi.mock('../api', () => ({
  memoryApi: {
    jobs: (...args: unknown[]) => jobsApi(...args),
    cancelJob: (...args: unknown[]) => cancelJobApi(...args),
    list: (...args: unknown[]) => listApi(...args),
  },
}))

function summary(patch: Partial<MemorySummary> & { id: string }): MemorySummary {
  return {
    projectId: 'p1',
    slug: patch.id,
    title: patch.id,
    memoryType: 'decision',
    state: 'active',
    quality: 'canonical',
    importance: 0.5,
    confidence: 0.5,
    summary: '',
    pinned: false,
    tags: [],
    workspaceId: null,
    branchName: null,
    verifiedAt: null,
    staleReason: null,
    revisionNumber: 1,
    createdAt: '2026-08-14T09:00:00Z',
    updatedAt: '2026-08-14T09:00:00Z',
    ...patch,
  }
}

function job(
  patch: Partial<KnowledgeJob> & { id: string },
  payload?: AnalyzeImpactPayload,
  outcome?: ImpactOutcome,
): KnowledgeJob {
  return {
    projectId: 'p1',
    kind: 'analyze_impact',
    status: 'complete',
    payload: JSON.stringify(payload ?? { paths: ['src/auth/token.rs'], trigger: 'file change' }),
    attempts: 1,
    maxAttempts: 3,
    dedupKey: 'analyze_impact',
    result: outcome ? JSON.stringify(outcome) : null,
    error: null,
    createdAt: '2026-08-14T09:00:00Z',
    startedAt: '2026-08-14T09:00:01Z',
    finishedAt: '2026-08-14T09:00:02Z',
    ...patch,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useMemoryStore.getState().reset()
  useMemoryStore.setState({
    projectId: 'p1',
    items: [summary({ id: 'm1', title: 'Rotation Decision' }), summary({ id: 'm2', title: 'Scratch Note' })],
  })
  listApi.mockResolvedValue([])
})

describe('MemoryActivity', () => {
  it('shows both what the automation changed and what it refused to change', async () => {
    useMemoryStore.setState({
      jobs: [
        job({ id: 'j1' }, { paths: ['src/auth/token.rs'], trigger: 'commit a1b2c3' }, {
          pathsAnalyzed: 1,
          markedStale: ['m1'],
          skipped: [{ itemId: 'm2', reason: 'not yet load-bearing: quality below supported' }],
        }),
      ],
    })
    render(<MemoryActivity />)

    expect(screen.getByText('commit a1b2c3')).toBeInTheDocument()
    expect(screen.getByText('src/auth/token.rs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotation Decision' })).toBeInTheDocument()
    // The refusal is the auditable half: an automation that only reports its writes cannot be
    // checked for what it wrongly ignored.
    expect(screen.getByText('Scratch Note')).toBeInTheDocument()
    expect(screen.getByText(/not yet load-bearing/)).toBeInTheDocument()
  })

  it('opens the memory a job flagged', async () => {
    const getApi = vi.fn()
    useMemoryStore.setState({
      jobs: [job({ id: 'j1' }, undefined, { pathsAnalyzed: 1, markedStale: ['m1'], skipped: [] })],
    })
    render(<MemoryActivity />)

    await userEvent.click(screen.getByRole('button', { name: 'Rotation Decision' }))
    expect(useMemoryStore.getState().activeId).toBe('m1')
    expect(useMemoryStore.getState().view).toBe('knowledge')
    expect(getApi).not.toHaveBeenCalled()
  })

  it('reports honestly when a job could not be cancelled', async () => {
    cancelJobApi.mockResolvedValue(false)
    jobsApi.mockResolvedValue([])
    useMemoryStore.setState({ jobs: [job({ id: 'j1', status: 'queued', result: null })] })
    render(<MemoryActivity />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(cancelJobApi).toHaveBeenCalledWith('p1', 'j1')
    // A control that silently does nothing is worse than one that says why it could not.
    expect(useMemoryStore.getState().error).toMatch(/already started/)
  })

  it('offers no cancel control for work that has already started', () => {
    useMemoryStore.setState({ jobs: [job({ id: 'j1', status: 'running', result: null })] })
    render(<MemoryActivity />)
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('surfaces a failed job with its error and retry count rather than hiding it', () => {
    useMemoryStore.setState({
      jobs: [
        job({
          id: 'j1',
          status: 'failed',
          attempts: 3,
          error: 'The Project folder is unavailable.',
          result: null,
        }),
      ],
    })
    render(<MemoryActivity />)
    expect(screen.getByText('failed')).toBeInTheDocument()
    expect(screen.getByText('The Project folder is unavailable.')).toBeInTheDocument()
    expect(screen.getByText('attempt 3 of 3')).toBeInTheDocument()
  })

  it('says nothing was affected rather than showing an empty success', () => {
    useMemoryStore.setState({
      jobs: [job({ id: 'j1' }, undefined, { pathsAnalyzed: 4, markedStale: [], skipped: [] })],
    })
    render(<MemoryActivity />)
    expect(screen.getByText(/no knowledge cites them/)).toBeInTheDocument()
  })

  it('stays renderable when a job row carries a shape this build does not know', () => {
    useMemoryStore.setState({
      jobs: [job({ id: 'j1', payload: 'not json', result: '{{{' })],
    })
    render(<MemoryActivity />)
    // Falls back to the kind rather than throwing and taking the surface down with it.
    expect(screen.getByText('analyze_impact')).toBeInTheDocument()
  })

  it('loads the queue when the Activity view is opened', async () => {
    jobsApi.mockResolvedValue([job({ id: 'j1' })])
    await useMemoryStore.getState().setView('activity')
    expect(jobsApi).toHaveBeenCalledWith('p1')
    expect(useMemoryStore.getState().jobs).toHaveLength(1)
  })
})
