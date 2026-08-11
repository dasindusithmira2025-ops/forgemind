import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ConnectionsSection } from './ConnectionsSection'

describe('ConnectionsSection', () => {
  it('shows "No connection profiles configured." for the empty state', () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('No connection profiles configured.')).toBeInTheDocument()
  })

  it('shows the explicit permission/safety notice — never a generic transient-failure message', () => {
    render(<ConnectionsSection />)
    expect(screen.getByText('Live database connections are not available in this version.')).toBeInTheDocument()
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('renders no dead controls: this surface has zero <button> elements, since every action here would be non-functional in V1', () => {
    render(<ConnectionsSection />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
