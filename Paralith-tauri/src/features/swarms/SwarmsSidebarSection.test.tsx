import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SwarmsSidebarSection } from './SwarmsSidebarSection'

describe('SwarmsSidebarSection project boundary', () => {
  it('disables creation and directs the user to open a Project when none is active', () => {
    render(<MemoryRouter><SwarmsSidebarSection /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'New swarm' })).toBeDisabled()
    expect(screen.getByText('Open a Project to create a Swarm.')).toBeInTheDocument()
  })
})
