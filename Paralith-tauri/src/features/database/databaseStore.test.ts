import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDatabaseStore } from './databaseStore'
import type { DatabaseIssue, DatabaseSource } from './databaseTypes'

const discoverSources = vi.fn()

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api')
  return {
    ...actual,
    databaseApi: {
      discoverSources: (...args: unknown[]) => discoverSources(...args),
    },
  }
})

function source(id: string): DatabaseSource {
  return {
    id,
    repositoryId: 'p1',
    logicalKey: id,
    displayName: id,
    engine: 'sqlite',
    adapterIds: ['sqlite'],
    consumerProjectIds: [],
    environmentIds: [],
    evidenceIds: [], relevance: 'application', evidencePaths: [],
    confidence: 1,
    discoveredAt: '',
    updatedAt: '',
  }
}

function issue(id: string): DatabaseIssue {
  return {
    id,
    sourceId: 's1',
    semanticObjectIds: [],
    code: 'missing_primary_key',
    severity: 'warning',
    title: 'No primary key',
    explanation: 'The table declares no primary key.',
    evidenceIds: [],
    status: 'open',
    detectedAt: '',
  }
}

beforeEach(() => {
  discoverSources.mockReset()
  useDatabaseStore.getState().reset()
})

afterEach(() => useDatabaseStore.getState().reset())

describe('discovery keeps the selected source honest', () => {
  it('drops an active source that the rescan no longer reports', async () => {
    discoverSources.mockResolvedValueOnce({ sources: [source('a'), source('b')], issues: [], scanId: '1' })
    await useDatabaseStore.getState().loadProject('p1')
    useDatabaseStore.getState().selectSource('b')
    expect(useDatabaseStore.getState().activeSourceId).toBe('b')

    // `b`'s schema file was deleted; keeping the id would point every later request at a source
    // the backend no longer knows about.
    discoverSources.mockResolvedValueOnce({ sources: [source('a')], issues: [], scanId: '2' })
    await useDatabaseStore.getState().discoverSources(true)
    expect(useDatabaseStore.getState().activeSourceId).toBe('a')
  })

  it('keeps the active source when the rescan still reports it', async () => {
    discoverSources.mockResolvedValueOnce({ sources: [source('a'), source('b')], issues: [], scanId: '1' })
    await useDatabaseStore.getState().loadProject('p1')
    useDatabaseStore.getState().selectSource('b')

    discoverSources.mockResolvedValueOnce({ sources: [source('b'), source('a')], issues: [], scanId: '2' })
    await useDatabaseStore.getState().discoverSources(true)
    expect(useDatabaseStore.getState().activeSourceId).toBe('b')
  })

  it('keeps the issues discovery already returned instead of refetching them', async () => {
    discoverSources.mockResolvedValueOnce({ sources: [source('a')], issues: [issue('i1')], scanId: '1' })
    await useDatabaseStore.getState().loadProject('p1')
    expect(useDatabaseStore.getState().issues).toHaveLength(1)
    expect(useDatabaseStore.getState().issuesLoad.status).toBe('ready')
  })

  it('carries the backend cause into the load state so a failure is diagnosable', async () => {
    discoverSources.mockRejectedValueOnce({
      code: 'database_error',
      message: 'PARALITH could not access its local database.',
      recoverable: true,
      detail: 'UNIQUE constraint failed: database_source_evidence.id',
    })
    await useDatabaseStore.getState().loadProject('p1')
    const load = useDatabaseStore.getState().sourcesLoad
    expect(load.status).toBe('error')
    expect(load.errorCode).toBe('database_error')
    expect(load.errorDetail).toBe('UNIQUE constraint failed: database_source_evidence.id')
  })
})

describe('state that belongs to one source or layer never survives a switch', () => {
  it('drops cached object detail when the source changes', async () => {
    discoverSources.mockResolvedValueOnce({ sources: [source('a'), source('b')], issues: [], scanId: '1' })
    await useDatabaseStore.getState().loadProject('p1')
    useDatabaseStore.setState({
      objectDetails: { 'table:users': { table: {} } as never },
      objectDetailLoad: { 'table:users': { status: 'ready' } },
    })

    useDatabaseStore.getState().selectSource('b')
    expect(useDatabaseStore.getState().objectDetails).toEqual({})
    expect(useDatabaseStore.getState().objectDetailLoad).toEqual({})
  })

  it('drops cached object detail when the layer changes', async () => {
    discoverSources.mockResolvedValueOnce({ sources: [source('a')], issues: [], scanId: '1' })
    await useDatabaseStore.getState().loadProject('p1')
    useDatabaseStore.setState({
      observedSnapshot: undefined,
      objectDetails: { 'table:users': { table: {} } as never },
      objectDetailLoad: { 'table:users': { status: 'ready' } },
    })

    // Declared, Observed, and Proposed carry different objects under the same ids.
    useDatabaseStore.getState().setLayer('observed')
    expect(useDatabaseStore.getState().objectDetails).toEqual({})
  })
})

describe('pinned canvas positions', () => {
  it('records and releases a pinned position', () => {
    useDatabaseStore.getState().setPinnedPosition('table:users', { x: 120, y: 40 })
    expect(useDatabaseStore.getState().pinnedPositions['table:users']).toEqual({ x: 120, y: 40 })

    useDatabaseStore.getState().setPinnedPosition('table:users', undefined)
    expect(useDatabaseStore.getState().pinnedPositions['table:users']).toBeUndefined()
  })
})
