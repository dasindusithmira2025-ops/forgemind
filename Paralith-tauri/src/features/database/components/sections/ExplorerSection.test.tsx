import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { ExplorerSection } from './ExplorerSection'

afterEach(() => useDatabaseStore.getState().reset())

describe('ExplorerSection empty/loading/error states', () => {
  it('shows the row skeleton while loading with no cached tables', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'loading' }, activeSourceId: 's1' })
    const { container } = render(<ExplorerSection />)
    expect(container.querySelector('.code-explorer-skeleton')).toBeTruthy()
  })

  it('distinguishes a genuinely empty schema from a filtered-out one', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'ready' }, schemaPage: { objects: [], edges: [], issues: [] }, activeSourceId: 's1' })
    render(<ExplorerSection />)
    expect(screen.getByText('No schema objects detected for this datasource.')).toBeInTheDocument()
  })

  it('uses distinct copy when a search filters out every object', () => {
    useDatabaseStore.setState({
      schemaLoad: { status: 'ready' },
      activeSourceId: 's1',
      filters: { hideUnrelated: false, search: 'zzz-no-match' },
      schemaPage: {
        objects: [{
          kind: 'table',
          value: {
            meta: { identity: { id: 't1', logicalKey: 'users', qualifiedName: 'users', previousIds: [] }, sourceId: 's1', layer: 'declared', confidence: 1, provenanceIds: [], discoveredAt: '', observedAt: '', updatedAt: '', contentFingerprint: 'f' },
            namespaceId: 'ns1', name: 'users', columnIds: [], foreignKeyIds: [], uniqueConstraintIds: [], checkConstraintIds: [], indexIds: [],
          },
        }],
        edges: [],
        issues: [],
      },
    })
    render(<ExplorerSection />)
    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument()
    // The empty-schema copy must not appear: the schema is not empty, the filter is.
    expect(screen.queryByText('No schema objects detected for this datasource.')).not.toBeInTheDocument()
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'error', errorMessage: 'load failed' }, activeSourceId: 's1' })
    render(<ExplorerSection />)
    expect(screen.getByText('load failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
