import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDatabaseStore } from '../../databaseStore'
import { ConnectionsSection } from './ConnectionsSection'

vi.mock('../../api', async () => {
  const actual = await vi.importActual<typeof import('../../api')>('../../api')
  return {
    ...actual,
    databaseApi: {
      adapterSupport: vi.fn().mockResolvedValue([
        {
          adapterId: 'sqlite',
          capabilities: {
            detect: true,
            extractDeclaredSchema: true,
            extractMigrations: false,
            introspectObservedSchema: true,
            validate: true,
            diff: true,
            generateChange: false,
            supportsReadOnlyTransaction: true,
          },
        },
      ]),
    },
  }
})

describe('ConnectionsSection', () => {
  beforeEach(() => useDatabaseStore.getState().reset())

  it('states plainly that network connections are unavailable, rather than offering a control that would fail', () => {
    render(<ConnectionsSection />)
    expect(
      screen.getByText('Network database connections are not available in this version.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('note')).toBeInTheDocument()
  })

  it('offers read-only SQLite introspection, which is a capability that actually exists', async () => {
    const introspect = vi.fn().mockResolvedValue(undefined)
    useDatabaseStore.setState({ projectId: 'p1', activeSourceId: 's1', introspectSqliteFile: introspect })
    render(<ConnectionsSection />)

    const input = screen.getByLabelText('Project-relative database file')
    await userEvent.type(input, 'dev.sqlite')
    await userEvent.click(screen.getByRole('button', { name: /introspect/i }))

    expect(introspect).toHaveBeenCalledWith('dev.sqlite')
  })

  it('keeps the introspection action disabled until a file is named, so nothing connects by accident', () => {
    useDatabaseStore.setState({ projectId: 'p1', activeSourceId: 's1' })
    render(<ConnectionsSection />)
    expect(screen.getByRole('button', { name: /introspect/i })).toBeDisabled()
  })

  it('reports adapter capabilities from the backend rather than claiming blanket support', async () => {
    render(<ConnectionsSection />)
    await waitFor(() => expect(screen.getByRole('rowheader', { name: 'SQLite' })).toBeInTheDocument())
    // The matrix states each capability explicitly, supported or not — no blanket claim.
    expect(screen.getByRole('columnheader', { name: 'Observed schema' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Migrations' })).toBeInTheDocument()
  })
})
