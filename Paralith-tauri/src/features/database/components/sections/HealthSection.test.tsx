import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { HealthSection } from './HealthSection'

afterEach(() => useDatabaseStore.getState().reset())

describe('HealthSection empty/loading/error states', () => {
  it('shows the row skeleton while loading with none cached', () => {
    useDatabaseStore.setState({ issuesLoad: { status: 'loading' }, activeSourceId: 's1' })
    const { container } = render(<HealthSection />)
    expect(container.querySelector('.code-explorer-skeleton')).toBeTruthy()
  })

  it('shows the success-tone "No issues detected." copy, not a neutral empty state', () => {
    useDatabaseStore.setState({ issuesLoad: { status: 'ready' }, issues: [], activeSourceId: 's1' })
    render(<HealthSection />)
    const empty = screen.getByText('No issues detected.')
    expect(empty).toBeInTheDocument()
    expect(empty.closest('.db-health-empty')).toHaveClass('success')
  })

  it('shows ErrorNotice with Retry on a load error', () => {
    useDatabaseStore.setState({ issuesLoad: { status: 'error', errorMessage: 'boom' }, activeSourceId: 's1' })
    render(<HealthSection />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
