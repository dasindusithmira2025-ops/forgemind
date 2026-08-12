import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DatabaseSidebar } from './DatabaseSidebar'
import type { DatabaseSource } from '../databaseTypes'

const source: DatabaseSource = {
  id: 's1',
  repositoryId: 'p1',
  logicalKey: 'sqlite@primary',
  displayName: 'Primary SQLite',
  engine: 'sqlite',
  adapterIds: ['sqlite'],
  consumerProjectIds: [],
  environmentIds: [],
  evidenceIds: [], relevance: 'application', evidencePaths: [],
  confidence: 1,
  discoveredAt: '',
  updatedAt: '',
}

function renderRail(props: Partial<Parameters<typeof DatabaseSidebar>[0]> = {}) {
  render(
    <DatabaseSidebar
      active="overview"
      sources={[]}
      sourcesLoad={{ status: 'idle' }}
      onSelectSource={vi.fn()}
      onNavigate={vi.fn()}
      showAllSources={false}
      onShowAllSourcesChange={vi.fn()}
      hiddenSourceCount={0}
      {...props}
    />,
  )
}

describe('the data-source rail states what is actually known', () => {
  it('does not claim the repository has no sources while discovery is still running', () => {
    renderRail({ sourcesLoad: { status: 'loading' } })
    expect(screen.getByText('Scanning…')).toBeInTheDocument()
    expect(screen.queryByText('No sources discovered yet.')).not.toBeInTheDocument()
  })

  it('does not claim the repository has no sources when discovery failed', () => {
    // Discovery failing and the repository having no database are different facts. This is the
    // exact combination the production failure showed: an error banner beside a rail asserting
    // there was nothing to find.
    renderRail({ sourcesLoad: { status: 'error', errorCode: 'database_error', errorMessage: 'boom' } })
    expect(screen.getByText('Discovery failed.')).toBeInTheDocument()
    expect(screen.queryByText('No sources discovered yet.')).not.toBeInTheDocument()
  })

  it('states the empty result only once discovery actually succeeded', () => {
    renderRail({ sourcesLoad: { status: 'ready' } })
    expect(screen.getByText('No sources discovered yet.')).toBeInTheDocument()
  })

  it('marks the active source for assistive technology, not only visually', () => {
    renderRail({ sources: [source], activeSourceId: 's1', sourcesLoad: { status: 'ready' } })
    expect(screen.getByRole('button', { name: /Primary SQLite/ })).toHaveAttribute('aria-current', 'true')
  })
})
