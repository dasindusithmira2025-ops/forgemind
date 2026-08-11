import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDatabaseStore } from '../../databaseStore'
import { ChangesSection } from './ChangesSection'
import type { DatabaseDesign, DatabaseDesignBundle, DatabaseGraphPage } from '../../databaseTypes'

afterEach(() => useDatabaseStore.getState().reset())

function design(overrides: Partial<DatabaseDesign> = {}): DatabaseDesign {
  return {
    id: 'd1',
    sourceId: 's1',
    name: 'Claude registration',
    status: 'draft',
    headRevisionId: 'r1',
    revisionNumber: 0,
    createdBy: { kind: 'agent', sessionId: 'sess', agentId: 'claude' },
    createdAt: '2026-08-11T00:00:00Z',
    updatedAt: '2026-08-11T00:00:00Z',
    ...overrides,
  }
}

function bundle(overrides: Partial<DatabaseDesign> = {}): DatabaseDesignBundle {
  const value = design(overrides)
  return {
    design: value,
    revision: {
      id: value.headRevisionId,
      designId: value.id,
      revisionNumber: value.revisionNumber,
      state: 'draft',
      graphFingerprint: 'fp',
      operationIds: [],
      createdBy: value.createdBy,
      createdAt: value.createdAt,
    },
    objects: [],
    edges: [],
    issues: [],
    concurrency: { expectedHeadRevisionId: value.headRevisionId, expectedRevisionNumber: value.revisionNumber },
  }
}

const schemaPage: DatabaseGraphPage = {
  snapshot: {
    id: 'snap1',
    sourceId: 's1',
    layer: 'declared',
    adapterId: 'raw_sql',
    fingerprint: 'fp',
    objectCount: 1,
    edgeCount: 0,
    extractorVersion: 'v1',
    createdAt: '2026-08-11T00:00:00Z',
    status: 'ready',
  },
  objects: [],
  edges: [],
  issues: [],
}

describe('ChangesSection design mode', () => {
  it('shows a spinner while designs load', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'loading' }, activeSourceId: 's1' })
    render(<ChangesSection />)
    expect(screen.getByText(/Loading designs/)).toBeInTheDocument()
  })

  it('explains that a design changes nothing until it is implemented', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'ready' }, designs: [], activeSourceId: 's1' })
    render(<ChangesSection />)
    expect(screen.getByText(/nothing it contains touches the repository/i)).toBeInTheDocument()
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'error', errorMessage: 'boom' }, activeSourceId: 's1' })
    render(<ChangesSection />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })

  it('shows the stale-revision notice as its own named state with a Reload design action', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'ready' }, designs: [], activeSourceId: 's1', staleRevisionNotice: { designId: 'd1' } })
    render(<ChangesSection />)
    expect(screen.getByText('This design changed elsewhere.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload design/i })).toBeInTheDocument()
  })

  it('creates a draft rooted in the loaded snapshot, so two drafts provably share a base', async () => {
    const createDraft = vi.fn().mockResolvedValue(undefined)
    useDatabaseStore.setState({
      designsLoad: { status: 'ready' },
      designs: [],
      activeSourceId: 's1',
      schemaPage,
      createDraft,
    })
    render(<ChangesSection />)

    await userEvent.type(screen.getByLabelText('Design name'), 'Codex registration')
    await userEvent.click(screen.getByRole('button', { name: /new design/i }))

    expect(createDraft).toHaveBeenCalledWith('Codex registration', { kind: 'snapshot', snapshotId: 'snap1' })
  })

  it('offers approve and reject on a draft, and implement only once approved', async () => {
    const decideDesign = vi.fn().mockResolvedValue(undefined)
    useDatabaseStore.setState({
      designsLoad: { status: 'ready' },
      designs: [design()],
      activeSourceId: 's1',
      activeDesignId: 'd1',
      activeBundle: bundle(),
      schemaPage,
      decideDesign,
    })
    const { rerender } = render(<ChangesSection />)
    expect(screen.queryByRole('button', { name: /^implement$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /approve/i }))
    expect(decideDesign).toHaveBeenCalledWith('approve')

    useDatabaseStore.setState({
      designs: [design({ status: 'approved', approvedRevisionId: 'r1' })],
      activeBundle: bundle({ status: 'approved', approvedRevisionId: 'r1' }),
    })
    rerender(<ChangesSection />)
    expect(screen.getByRole('button', { name: /^implement$/i })).toBeInTheDocument()
  })

  it('compares two designs semantically and renders the typed changes', async () => {
    const compare = vi.fn().mockResolvedValue(undefined)
    useDatabaseStore.setState({
      designsLoad: { status: 'ready' },
      designs: [design(), design({ id: 'd2', name: 'Codex registration', headRevisionId: 'r2' })],
      activeSourceId: 's1',
      activeDesignId: 'd1',
      activeBundle: bundle(),
      schemaPage,
      compare,
    })
    render(<ChangesSection />)

    await userEvent.selectOptions(screen.getByLabelText('Compare with design'), 'd2')
    await userEvent.click(screen.getByRole('button', { name: /^compare$/i }))

    expect(compare).toHaveBeenCalledWith({
      mode: 'design_revisions',
      leftRevisionId: 'r2',
      rightRevisionId: 'r1',
    })
  })

  it('requires an explicit second confirmation before applying a destructive change', async () => {
    const implementActiveDesign = vi.fn().mockResolvedValue(undefined)
    useDatabaseStore.setState({
      designsLoad: { status: 'ready' },
      designs: [design({ status: 'approved', approvedRevisionId: 'r1' })],
      activeSourceId: 's1',
      activeDesignId: 'd1',
      activeBundle: bundle({ status: 'approved', approvedRevisionId: 'r1' }),
      schemaPage,
      implementActiveDesign,
      implementationLoad: {
        status: 'error',
        errorCode: 'database_destructive_change_not_acknowledged',
        errorMessage: 'This design destroys existing data.',
      },
    })
    render(<ChangesSection />)

    await userEvent.click(screen.getByRole('button', { name: /apply the destructive change/i }))
    expect(implementActiveDesign).toHaveBeenCalledWith({ acknowledgeDestructive: true })
  })

  it('reports an unverified implementation instead of calling it done', () => {
    useDatabaseStore.setState({
      designsLoad: { status: 'ready' },
      designs: [design({ status: 'approved', approvedRevisionId: 'r1' })],
      activeSourceId: 's1',
      activeDesignId: 'd1',
      activeBundle: bundle({ status: 'approved', approvedRevisionId: 'r1' }),
      schemaPage,
      implementationLoad: { status: 'ready' },
      implementationRun: {
        runId: 'run1',
        designId: 'd1',
        targetRevisionId: 'r1',
        phase: 'unverified',
        completed: 4,
        total: 5,
        risk: 'safe',
        dryRun: false,
        changedFiles: ['db/migrations/001.sql'],
        migrationPath: 'db/migrations/001.sql',
        steps: [{ phase: 'verify', detail: 'still differs', ok: false }],
        verified: false,
        residualChanges: [
          {
            kind: 'add',
            objectId: 'table:x',
            breaking: false,
            destructive: false,
            summary: 'Add table public.x',
          },
        ],
      },
    })
    render(<ChangesSection />)
    expect(screen.getByText('Implemented — not verified')).toBeInTheDocument()
    expect(screen.getByText(/still differs from the approved target/i)).toBeInTheDocument()
  })
})
