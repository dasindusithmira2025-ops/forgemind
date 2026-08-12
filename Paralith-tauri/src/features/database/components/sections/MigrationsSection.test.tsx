import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { MigrationsSection } from './MigrationsSection'

// "supported but none found" and "the adapter cannot read migrations" are different facts, and
// which one applies is read from the real capability contract rather than guessed from an id list.
vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api')
  const capabilities = (extractMigrations: boolean) => ({
    detect: true,
    extractDeclaredSchema: true,
    extractMigrations,
    introspectObservedSchema: false,
    validate: true,
    diff: true,
    generateChange: extractMigrations,
    supportsReadOnlyTransaction: false,
  })
  return {
    ...actual,
    databaseApi: {
      ...actual.databaseApi,
      adapterSupport: vi.fn().mockResolvedValue([
        { adapterId: 'prisma', capabilities: capabilities(true) },
        { adapterId: 'sqlite', capabilities: capabilities(false) },
      ]),
    },
  }
})

afterEach(() => useDatabaseStore.getState().reset())

describe('MigrationsSection empty/loading/error/unsupported-adapter states', () => {
  it('shows the row skeleton while loading with none cached', () => {
    useDatabaseStore.setState({ migrationsLoad: { status: 'loading' }, activeSourceId: 's1' })
    const { container } = render(<MigrationsSection />)
    expect(container.querySelector('.code-explorer-skeleton')).toBeTruthy()
  })

  it('shows the ordinary empty copy when the adapter supports migrations but none exist', async () => {
    useDatabaseStore.setState({
      migrationsLoad: { status: 'ready' },
      migrations: [],
      activeSourceId: 's1',
      sources: [{ id: 's1', repositoryId: 'r1', logicalKey: 'k', displayName: 'Primary', engine: 'postgres', adapterIds: ['prisma'], consumerProjectIds: [], environmentIds: [], evidenceIds: [], relevance: 'application', evidencePaths: [], confidence: 1, discoveredAt: '', updatedAt: '' }],
    })
    render(<MigrationsSection />)
    await waitFor(() => expect(screen.getByText('No migrations discovered')).toBeInTheDocument())
    // Never the unsupported wording: this adapter can read migrations, there simply are none.
    expect(screen.queryByText('Migration extraction is not supported here')).not.toBeInTheDocument()
  })

  it('shows the neutral unsupported-adapter copy, not an error, for a non-migration adapter', async () => {
    useDatabaseStore.setState({
      migrationsLoad: { status: 'ready' },
      migrations: [],
      activeSourceId: 's1',
      sources: [{ id: 's1', repositoryId: 'r1', logicalKey: 'k', displayName: 'Local SQLite', engine: 'sqlite', adapterIds: ['sqlite'], consumerProjectIds: [], environmentIds: [], evidenceIds: [], relevance: 'application', evidencePaths: [], confidence: 1, discoveredAt: '', updatedAt: '' }],
    })
    render(<MigrationsSection />)
    await waitFor(() => expect(screen.getByText('Migration extraction is not supported here')).toBeInTheDocument())
    expect(screen.getByText(/capability limit, not a failed scan/)).toBeInTheDocument()
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ migrationsLoad: { status: 'error', errorMessage: 'boom' }, activeSourceId: 's1' })
    render(<MigrationsSection />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
