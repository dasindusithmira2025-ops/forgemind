import { afterEach, describe, expect, it } from 'vitest'
import { useDatabaseStore } from './databaseStore'
import { relationCardinality } from './relationSemantics'
import { buildExplorerGroups } from './components/sections/explorerHierarchy'
import type {
  DatabaseGraphPage,
  DatabaseObjectDetail,
  DatabaseTableNodeView,
  ForeignKey,
} from './databaseTypes'

afterEach(() => useDatabaseStore.getState().reset())

describe('every surface drives one shared semantic selection', () => {
  it('reveals an object by selecting it and naming the surface that should bring it into view', () => {
    useDatabaseStore.getState().revealObject('table:orders', 'diagram')
    const state = useDatabaseStore.getState()
    expect(state.selection.tableIds).toEqual(['table:orders'])
    expect(state.selection.focusedId).toBe('table:orders')
    expect(state.revealTarget?.objectId).toBe('table:orders')
    expect(state.revealTarget?.section).toBe('diagram')
  })

  it('gives each reveal a fresh nonce so asking twice for the same object re-centres it', () => {
    useDatabaseStore.getState().revealObject('table:orders')
    const first = useDatabaseStore.getState().revealTarget!
    useDatabaseStore.setState({ revealTarget: { ...first, nonce: first.nonce - 1 } })
    useDatabaseStore.getState().revealObject('table:orders')
    expect(useDatabaseStore.getState().revealTarget!.nonce).toBeGreaterThan(first.nonce - 1)
  })

  it('clears the reveal request once the target surface has handled it', () => {
    useDatabaseStore.getState().revealObject('table:orders')
    useDatabaseStore.getState().clearRevealTarget()
    expect(useDatabaseStore.getState().revealTarget).toBeUndefined()
    // Clearing the request must not clear the selection it established.
    expect(useDatabaseStore.getState().selection.tableIds).toEqual(['table:orders'])
  })

  it('selects a relationship as the relationship, keeping both endpoints selected', () => {
    useDatabaseStore.getState().selectRelationship('edge:1', { from: 'table:orders', to: 'table:users' })
    const { selection } = useDatabaseStore.getState()
    expect(selection.relationshipIds).toEqual(['edge:1'])
    expect(selection.tableIds).toEqual(['table:orders', 'table:users'])
    expect(selection.focusedId).toBe('table:orders')
  })

  it('replaces a relationship selection when a plain table is selected next', () => {
    useDatabaseStore.getState().selectRelationship('edge:1', { from: 'table:orders', to: 'table:users' })
    useDatabaseStore.getState().selectObjects(['table:payments'], { focusedId: 'table:payments' })
    expect(useDatabaseStore.getState().selection.relationshipIds).toEqual([])
    expect(useDatabaseStore.getState().selection.tableIds).toEqual(['table:payments'])
  })
})

function foreignKey(columnIds: string[]): ForeignKey {
  return {
    meta: {
      identity: { id: 'fk:1', logicalKey: 'fk', qualifiedName: 'orders:fk', previousIds: [] },
      sourceId: 's1',
      layer: 'declared',
      confidence: 1,
      provenanceIds: [],
      discoveredAt: '',
      observedAt: '',
      updatedAt: '',
      contentFingerprint: 'f',
    },
    tableId: 'table:orders',
    columnIds,
    referencedTableId: 'table:users',
    referencedColumnIds: ['col:users.id'],
    onDelete: 'no_action',
    onUpdate: 'no_action',
  }
}

function detail(overrides: Partial<DatabaseObjectDetail>): DatabaseObjectDetail {
  return {
    table: {
      meta: {
        identity: { id: 'table:orders', logicalKey: 'orders', qualifiedName: 'orders', previousIds: [] },
        sourceId: 's1',
        layer: 'declared',
        confidence: 1,
        provenanceIds: [],
        discoveredAt: '',
        observedAt: '',
        updatedAt: '',
        contentFingerprint: 'f',
      },
      namespaceId: 'ns',
      name: 'orders',
      columnIds: [],
      foreignKeyIds: [],
      uniqueConstraintIds: [],
      checkConstraintIds: [],
      indexIds: [],
    },
    columns: [],
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    incomingForeignKeys: [],
    usage: [],
    migrations: [],
    issues: [],
    provenance: [],
    ...overrides,
  }
}

describe('relationship cardinality comes from constraint evidence only', () => {
  it('reads an ordinary foreign key as many-to-one', () => {
    expect(relationCardinality(foreignKey(['col:orders.user_id']), detail({}))).toBe('Many → One')
  })

  it('reads a foreign key over a unique column as one-to-one', () => {
    const uniqueConstraint = {
      meta: {
        identity: { id: 'uq:1', logicalKey: 'uq', qualifiedName: 'orders:uq', previousIds: [] },
        sourceId: 's1',
        layer: 'declared' as const,
        confidence: 1,
        provenanceIds: [],
        discoveredAt: '',
        observedAt: '',
        updatedAt: '',
        contentFingerprint: 'f',
      },
      tableId: 'table:orders',
      columnIds: ['col:orders.user_id'],
    }
    expect(relationCardinality(foreignKey(['col:orders.user_id']), detail({ uniqueConstraints: [uniqueConstraint] })))
      .toBe('One → One')
  })

  it('does not treat a unique constraint over *different* columns as making the relation one-to-one', () => {
    const uniqueConstraint = {
      meta: {
        identity: { id: 'uq:1', logicalKey: 'uq', qualifiedName: 'orders:uq', previousIds: [] },
        sourceId: 's1',
        layer: 'declared' as const,
        confidence: 1,
        provenanceIds: [],
        discoveredAt: '',
        observedAt: '',
        updatedAt: '',
        contentFingerprint: 'f',
      },
      tableId: 'table:orders',
      columnIds: ['col:orders.reference'],
    }
    expect(relationCardinality(foreignKey(['col:orders.user_id']), detail({ uniqueConstraints: [uniqueConstraint] })))
      .toBe('Many → One')
  })
})

function tableView(name: string): DatabaseTableNodeView {
  return {
    id: `table:${name}`,
    qualifiedName: `public.${name}`,
    name,
    groupId: 'ns:public',
    groupLabel: 'public',
    columns: [],
    relationCount: 0,
    issueCount: 0,
    pinned: false,
  }
}

function graphPage(objects: DatabaseGraphPage['objects']): DatabaseGraphPage {
  return { objects, edges: [], issues: [] }
}

const namespaceObject: DatabaseGraphPage['objects'][number] = {
  kind: 'namespace',
  value: {
    meta: {
      identity: { id: 'ns:public', logicalKey: 'public', qualifiedName: 'public', previousIds: [] },
      sourceId: 's1',
      layer: 'declared',
      confidence: 1,
      provenanceIds: [],
      discoveredAt: '',
      observedAt: '',
      updatedAt: '',
      contentFingerprint: 'f',
    },
    name: 'public',
  },
}

describe('the Explorer hierarchy only claims what the adapter produced', () => {
  it('groups objects under their namespace and names it from the namespace object', () => {
    const groups = buildExplorerGroups(graphPage([namespaceObject]), [tableView('orders')], undefined)
    expect(groups).toHaveLength(1)
    expect(groups[0].namespaceLabel).toBe('public')
    expect(groups[0].total).toBe(1)
  })

  it('renders no Views or Enums category when the adapter reported none', () => {
    const groups = buildExplorerGroups(graphPage([namespaceObject]), [tableView('orders')], undefined)
    expect(groups[0].kinds.map((kind) => kind.kind)).toEqual(['table'])
  })

  it('includes enums as their own category when the adapter did report them', () => {
    const enumObject: DatabaseGraphPage['objects'][number] = {
      kind: 'enum',
      value: {
        meta: {
          identity: { id: 'enum:role', logicalKey: 'Role', qualifiedName: 'Role', previousIds: [] },
          sourceId: 's1',
          layer: 'declared',
          confidence: 1,
          provenanceIds: [],
          discoveredAt: '',
          observedAt: '',
          updatedAt: '',
          contentFingerprint: 'f',
        },
        namespaceId: 'ns:public',
        name: 'Role',
        values: [{ name: 'ADMIN', ordinal: 0 }, { name: 'USER', ordinal: 1 }],
      },
    }
    const groups = buildExplorerGroups(graphPage([namespaceObject, enumObject]), [tableView('orders')], undefined)
    expect(groups[0].kinds.map((kind) => kind.kind)).toEqual(['table', 'enum'])
    expect(groups[0].kinds[1].entries[0].detail).toBe('2 values')
  })

  it('drops a namespace entirely when a search matches nothing inside it', () => {
    expect(buildExplorerGroups(graphPage([namespaceObject]), [tableView('orders')], 'zzz')).toEqual([])
  })
})
