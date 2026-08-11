import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { OverviewSection } from './OverviewSection'

afterEach(() => useDatabaseStore.getState().reset())

describe('OverviewSection empty/loading/error states', () => {
  it('shows the loading skeleton while sources are loading and none are cached yet', () => {
    useDatabaseStore.setState({ sourcesLoad: { status: 'loading' }, sources: [] })
    render(<OverviewSection onNavigate={() => undefined} />)
    expect(document.querySelector('[aria-busy="true"]')).toBeTruthy()
  })

  it('shows the exact empty-state copy when no sources are discovered', () => {
    useDatabaseStore.setState({ sourcesLoad: { status: 'ready' }, sources: [] })
    render(<OverviewSection onNavigate={() => undefined} />)
    expect(screen.getByText('No database sources discovered in this project yet.')).toBeInTheDocument()
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ sourcesLoad: { status: 'error', errorMessage: 'boom' }, sources: [] })
    render(<OverviewSection onNavigate={() => undefined} />)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
