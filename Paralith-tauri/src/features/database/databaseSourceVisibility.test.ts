import { describe, expect, it } from 'vitest'
import { hiddenDatabaseSourceCount, searchTables, visibleDatabaseSources } from './databaseSelectors'
import type { DatabaseSource, DatabaseSourceRelevance, DatabaseTableNodeView } from './databaseTypes'

function source(id: string, relevance: DatabaseSourceRelevance): DatabaseSource {
  return {
    id,
    repositoryId: 'repo',
    logicalKey: id,
    displayName: id,
    engine: 'postgres',
    adapterIds: ['prisma'],
    consumerProjectIds: [],
    environmentIds: [],
    evidenceIds: [],
    relevance,
    evidencePaths: [],
    confidence: 1,
    discoveredAt: '',
    updatedAt: '',
  }
}

describe('which discovered datasources a developer sees by default', () => {
  it('hides test, example and generated sources so fixtures never compete with the real database', () => {
    const sources = [
      source('app', 'application'),
      source('dev', 'development'),
      source('fixture', 'test'),
      source('sample', 'example'),
      source('build', 'generated'),
    ]
    expect(visibleDatabaseSources(sources, false).map((item) => item.id)).toEqual(['app', 'dev'])
    expect(hiddenDatabaseSourceCount(sources, false)).toBe(3)
  })

  it('shows everything on explicit opt-in — discovery evidence is never destroyed, only ranked', () => {
    const sources = [source('app', 'application'), source('fixture', 'test')]
    expect(visibleDatabaseSources(sources, true)).toHaveLength(2)
    expect(hiddenDatabaseSourceCount(sources, true)).toBe(0)
  })

  it('still shows fixture sources when they are the only ones, rather than claiming there are none', () => {
    // Hiding everything would assert "this project has no database", which is a different and
    // false statement from "this project's only database evidence is a fixture".
    const sources = [source('fixture', 'test'), source('sample', 'example')]
    expect(visibleDatabaseSources(sources, false)).toHaveLength(2)
    expect(hiddenDatabaseSourceCount(sources, false)).toBe(0)
  })
})

function table(name: string, columns: string[]): DatabaseTableNodeView {
  return {
    id: `table:${name}`,
    qualifiedName: `public.${name}`,
    name,
    groupId: 'ns',
    groupLabel: 'public',
    columns: columns.map((column) => ({
      id: `col:${name}.${column}`,
      name: column,
      typeLabel: 'text',
      isPrimaryKey: false,
      isForeignKey: false,
      isUnique: false,
      isIndexed: false,
      nullable: true,
    })),
    relationCount: 0,
    issueCount: 0,
    pinned: false,
  }
}

describe('searching the schema', () => {
  const tables = [table('orders', ['id', 'stripeCustomerId']), table('customers', ['id', 'email'])]

  it('returns every table when the query is empty', () => {
    expect(searchTables(tables, '')).toHaveLength(2)
    expect(searchTables(tables, undefined)).toHaveLength(2)
  })

  it('finds the owning table when the query names a column', () => {
    const matches = searchTables(tables, 'stripeCustomerId')
    expect(matches).toHaveLength(1)
    expect(matches[0].table.name).toBe('orders')
    // The match is attributed, so the UI can say *why* this table came back.
    expect(matches[0].matchedColumn).toBe('stripeCustomerId')
  })

  it('ranks a table-name match above a column-name match for the same query', () => {
    const matches = searchTables(tables, 'customer')
    expect(matches[0].table.name).toBe('customers')
    expect(matches[0].matchedColumn).toBeUndefined()
    expect(matches[1].table.name).toBe('orders')
    expect(matches[1].matchedColumn).toBe('stripeCustomerId')
  })

  it('is case-insensitive', () => {
    expect(searchTables(tables, 'ORDERS')).toHaveLength(1)
  })
})
