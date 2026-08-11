import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { ChangesSection } from './ChangesSection'

afterEach(() => useDatabaseStore.getState().reset())

describe('ChangesSection empty/loading/error + stale-revision states', () => {
  it('shows a spinner in the draft selector while loading', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'loading' }, activeSourceId: 's1' })
    render(<ChangesSection />)
    expect(screen.getByText(/Loading drafts/)).toBeInTheDocument()
  })

  it('shows "No design drafts yet." with a Create draft CTA', () => {
    useDatabaseStore.setState({ designsLoad: { status: 'ready' }, designs: [], activeSourceId: 's1' })
    render(<ChangesSection />)
    expect(screen.getByText('No design drafts yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create draft/i })).toBeInTheDocument()
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
})
