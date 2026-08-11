import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { MigrationsSection } from './MigrationsSection'

afterEach(() => useDatabaseStore.getState().reset())

describe('MigrationsSection empty/loading/error/unsupported-adapter states', () => {
  it('shows the row skeleton while loading with none cached', () => {
    useDatabaseStore.setState({ migrationsLoad: { status: 'loading' }, activeSourceId: 's1' })
    const { container } = render(<MigrationsSection />)
    expect(container.querySelector('.code-explorer-skeleton')).toBeTruthy()
  })

  it('shows the ordinary empty copy when the adapter supports migrations but none exist', () => {
    useDatabaseStore.setState({
      migrationsLoad: { status: 'ready' },
      migrations: [],
      activeSourceId: 's1',
      sources: [{ id: 's1', repositoryId: 'r1', logicalKey: 'k', displayName: 'Primary', engine: 'postgres', adapterIds: ['prisma'], consumerProjectIds: [], environmentIds: [], evidenceIds: [], confidence: 1, discoveredAt: '', updatedAt: '' }],
    })
    render(<MigrationsSection />)
    expect(screen.getByText('No migrations detected for this adapter.')).toBeInTheDocument()
  })

  it('shows the neutral unsupported-adapter copy, not an error, for a non-migration adapter', () => {
    useDatabaseStore.setState({
      migrationsLoad: { status: 'ready' },
      migrations: [],
      activeSourceId: 's1',
      sources: [{ id: 's1', repositoryId: 'r1', logicalKey: 'k', displayName: 'Local SQLite', engine: 'sqlite', adapterIds: ['sqlite'], consumerProjectIds: [], environmentIds: [], evidenceIds: [], confidence: 1, discoveredAt: '', updatedAt: '' }],
    })
    render(<MigrationsSection />)
    expect(screen.getByText('Migration history is not tracked for this adapter yet.')).toBeInTheDocument()
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ migrationsLoad: { status: 'error', errorMessage: 'boom' }, activeSourceId: 's1' })
    render(<MigrationsSection />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
