import { afterEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useDatabaseStore } from '../../databaseStore'
import { useDatabaseCanvasStore } from '../canvas/databaseCanvasStore'
import { DiagramSection } from './DiagramSection'

afterEach(() => {
  useDatabaseStore.getState().reset()
  useDatabaseCanvasStore.setState({ positions: {}, bounds: { width: 0, height: 0 }, layoutFingerprint: undefined, requestedFingerprint: undefined })
})

describe('DiagramSection empty/loading/error states', () => {
  it('shows "Loading schema graph…" while loading with no cached tables', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'loading' }, activeSourceId: 's1' })
    render(<DiagramSection />)
    expect(screen.getByText('Loading schema graph…')).toBeInTheDocument()
  })

  it('shows "This source has no tables yet." for a genuinely empty schema', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'ready' }, schemaPage: { objects: [], edges: [], issues: [] }, activeSourceId: 's1' })
    render(<DiagramSection />)
    expect(screen.getByText('This source has no tables yet.')).toBeInTheDocument()
  })

  it('shows the error state with Retry while the canvas viewport stays mounted (not full-screen replaced)', () => {
    useDatabaseStore.setState({ schemaLoad: { status: 'error', errorMessage: 'schema fetch failed' }, activeSourceId: 's1' })
    render(<DiagramSection />)
    expect(screen.getByText('schema fetch failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
