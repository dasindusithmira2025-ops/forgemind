import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDatabaseStore } from '../databaseStore'
import { DatabaseStudio } from './DatabaseStudio'
import { saveDatabaseNav } from '../databaseNav'
import type { DatabaseSnapshot } from '../databaseTypes'

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    databaseApi: {
      discoverSources: vi.fn().mockResolvedValue({ sources: [], issues: [], scanId: 'scan' }),
      adapterSupport: vi.fn().mockResolvedValue([]),
    },
  }
})

const snapshot: DatabaseSnapshot = {
  id: 'obs1',
  sourceId: 's1',
  layer: 'observed',
  adapterId: 'sqlite',
  fingerprint: 'fp',
  objectCount: 2,
  edgeCount: 1,
  extractorVersion: 'v1',
  createdAt: '2026-08-11T00:00:00Z',
  status: 'ready',
}

afterEach(() => useDatabaseStore.getState().reset())

describe('DatabaseStudio layer separation', () => {
  it('offers all three layers and never merges them', async () => {
    saveDatabaseNav('p1', { section: 'diagram' })
    render(<DatabaseStudio projectId="p1" />)
    const group = await screen.findByRole('radiogroup', { name: 'Schema layer' })
    expect(group).toBeInTheDocument()
    for (const label of ['Declared', 'Observed', 'Proposed']) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument()
    }
  })

  it('disables a layer that has nothing behind it, and says why', async () => {
    saveDatabaseNav('p1', { section: 'diagram' })
    render(<DatabaseStudio projectId="p1" />)
    const observed = await screen.findByRole('radio', { name: 'Observed' })
    expect(observed).toBeDisabled()
    expect(observed).toHaveAttribute('title', 'Introspect a database file first')
    expect(screen.getByRole('radio', { name: 'Proposed' })).toBeDisabled()
  })

  it('enables and switches to Observed once a database has actually been introspected', async () => {
    saveDatabaseNav('p1', { section: 'diagram' })
    const setLayer = vi.fn()
    render(<DatabaseStudio projectId="p1" />)
    await screen.findByRole('radiogroup', { name: 'Schema layer' })

    useDatabaseStore.setState({ observedSnapshot: snapshot, setLayer })
    const observed = await screen.findByRole('radio', { name: 'Observed' })
    expect(observed).toBeEnabled()
    await userEvent.click(observed)
    expect(setLayer).toHaveBeenCalledWith('observed')
  })
})
