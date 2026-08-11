import { describe, expect, it } from 'vitest'
import { applyDesignOperation, type ProposedGraph } from './databaseDesignOperations'
import type { DatabaseSelection, DatabaseTable } from './databaseTypes'

function proposedTable(id: string, name: string): DatabaseTable {
  return {
    meta: {
      identity: { id, logicalKey: 'orders', qualifiedName: name, previousIds: [] },
      sourceId: 'source-1',
      layer: 'proposed',
      designRevisionId: 'revision-1',
      confidence: 1,
      provenanceIds: [],
      discoveredAt: '2026-01-01T00:00:00Z',
      observedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      contentFingerprint: 'fp1',
    },
    namespaceId: 'ns-1',
    name,
    columnIds: [],
    foreignKeyIds: [],
    uniqueConstraintIds: [],
    checkConstraintIds: [],
    indexIds: [],
  }
}

describe('applyDesignOperation: RenameTable preserves synthetic Proposed identity', () => {
  // CONTRACTS.md §1.1: Proposed identity is `db:<kind>:p_<ulid>` and is copied unchanged into
  // every descendant revision; rename operations never recompute `id` or `logicalKey`.
  const proposedId = 'db:table:p_01jc9x8k3q7v9m2n4p6r8s0t2u'

  it('renaming does not change the table id or logicalKey, only qualifiedName/name', () => {
    const graph: ProposedGraph = { tables: { [proposedId]: proposedTable(proposedId, 'orders') }, columns: {} }
    const next = applyDesignOperation(graph, { kind: 'rename_table', tableId: proposedId, newName: 'orders_v2' })

    const renamed = next.tables[proposedId]
    expect(renamed).toBeDefined()
    expect(renamed.meta.identity.id).toBe(proposedId)
    expect(renamed.meta.identity.logicalKey).toBe('orders')
    expect(renamed.name).toBe('orders_v2')
    expect(renamed.meta.identity.qualifiedName).toBe('orders_v2')
  })

  it('a selection referencing the proposed id remains valid after the rename (selection is keyed by id, never by name)', () => {
    const graph: ProposedGraph = { tables: { [proposedId]: proposedTable(proposedId, 'orders') }, columns: {} }
    const selectionBefore: DatabaseSelection = { tableIds: [proposedId], columnIds: [], relationshipIds: [], focusedId: proposedId }

    const next = applyDesignOperation(graph, { kind: 'rename_table', tableId: proposedId, newName: 'orders_v2' })

    // The rename operation itself never touches selection state — this proves the *reason* it
    // doesn't need to: the id the selection references is byte-identical before and after.
    expect(selectionBefore.tableIds).toContain(proposedId)
    expect(next.tables[proposedId].meta.identity.id).toBe(selectionBefore.tableIds[0])
    expect(next.tables[proposedId].meta.identity.id).toBe(selectionBefore.focusedId)
  })

  it('a pinned layout position keyed by the proposed id remains resolvable after the rename', () => {
    const graph: ProposedGraph = { tables: { [proposedId]: proposedTable(proposedId, 'orders') }, columns: {} }
    const pinnedPositions: Record<string, { x: number; y: number }> = { [proposedId]: { x: 420, y: 133 } }

    const next = applyDesignOperation(graph, { kind: 'rename_table', tableId: proposedId, newName: 'orders_v2' })

    // Pinned positions are keyed by the same id the reducer left untouched, so the entry is still
    // present and unchanged — a rename must never orphan a pin.
    expect(pinnedPositions[proposedId]).toEqual({ x: 420, y: 133 })
    expect(next.tables[proposedId].meta.identity.id in pinnedPositions).toBe(true)
    expect(pinnedPositions[next.tables[proposedId].meta.identity.id]).toEqual({ x: 420, y: 133 })
  })

  it('renaming an unknown table id is a safe no-op', () => {
    const graph: ProposedGraph = { tables: {}, columns: {} }
    const next = applyDesignOperation(graph, { kind: 'rename_table', tableId: 'missing', newName: 'x' })
    expect(next).toBe(graph)
  })
})

describe('applyDesignOperation: add/drop table and column', () => {
  it('add_table inserts by the table object own synthetic id', () => {
    const table = proposedTable('db:table:p_new', 'accounts')
    const next = applyDesignOperation({ tables: {}, columns: {} }, { kind: 'add_table', table })
    expect(next.tables['db:table:p_new']).toBe(table)
  })

  it('drop_table removes the table and leaves others untouched', () => {
    const a = proposedTable('a', 'a')
    const b = proposedTable('b', 'b')
    const next = applyDesignOperation({ tables: { a, b }, columns: {} }, { kind: 'drop_table', tableId: 'a' })
    expect(next.tables.a).toBeUndefined()
    expect(next.tables.b).toBe(b)
  })
})
