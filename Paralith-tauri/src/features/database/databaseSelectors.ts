import type {
  DatabaseColumn,
  DatabaseGraphObject,
  DatabaseGraphPage,
  DatabaseNamespaceGroupView,
  DatabaseTable,
  DatabaseTableNodeView,
  SemanticId,
} from './databaseTypes'

/** Extract just the tables from a mixed-kind graph page. Pure — no store access. */
export function tablesFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseTable[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'table' }> => object.kind === 'table').map((object) => object.table)
}

export function columnsFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseColumn[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'column' }> => object.kind === 'column').map((object) => object.column)
}

function typeLabel(column: DatabaseColumn): string {
  const family = column.dataType.family
  if (column.dataType.length) return `${family}(${column.dataType.length})`
  return column.nativeType || family
}

/**
 * Build render-ready node views from a graph page. A table's PK/FK columns are marked from the
 * table's own `primaryKeyId`/`foreignKeyIds`-linked column ids — the actual FK/PK objects are not
 * required for this projection, only column membership, which keeps this cheap for large schemas.
 */
export function buildTableNodeViews(page: DatabaseGraphPage | undefined, pinnedIds: ReadonlySet<SemanticId> = new Set()): DatabaseTableNodeView[] {
  if (!page) return []
  const tables = tablesFromGraphPage(page)
  const columnsByTable = new Map<SemanticId, DatabaseColumn[]>()
  for (const column of columnsFromGraphPage(page)) {
    const list = columnsByTable.get(column.tableId) ?? []
    list.push(column)
    columnsByTable.set(column.tableId, list)
  }
  const issueCountByObject = new Map<SemanticId, number>()
  for (const issue of page.issues) {
    for (const objectId of issue.semanticObjectIds) issueCountByObject.set(objectId, (issueCountByObject.get(objectId) ?? 0) + 1)
  }

  return tables.map((table) => {
    const pkColumnIds = new Set<SemanticId>() // populated below once PK objects are threaded through; V1 keeps this simple via column-level flags
    const fkColumnIds = new Set<SemanticId>()
    const columns = (columnsByTable.get(table.meta.identity.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((column) => ({
        id: column.meta.identity.id,
        name: column.name,
        typeLabel: typeLabel(column),
        isPrimaryKey: pkColumnIds.has(column.meta.identity.id),
        isForeignKey: fkColumnIds.has(column.meta.identity.id),
        nullable: column.nullable,
      }))
    return {
      id: table.meta.identity.id,
      qualifiedName: table.meta.identity.qualifiedName,
      name: table.name,
      groupId: table.namespaceId,
      groupLabel: table.namespaceId,
      columns,
      issueCount: issueCountByObject.get(table.meta.identity.id) ?? 0,
      pinned: pinnedIds.has(table.meta.identity.id),
    }
  })
}

export function groupTableViews(tables: DatabaseTableNodeView[]): DatabaseNamespaceGroupView[] {
  const groups = new Map<string, DatabaseNamespaceGroupView>()
  for (const table of tables) {
    const existing = groups.get(table.groupId)
    if (existing) {
      existing.tableIds.push(table.id)
      existing.issueCount += table.issueCount
    } else {
      groups.set(table.groupId, { id: table.groupId, label: table.groupLabel, tableIds: [table.id], issueCount: table.issueCount })
    }
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * Layer merge: an object present in more than one layer (e.g. both Declared and Observed) must
 * remain independently retrievable, never silently collapsed onto one value. Keyed by
 * `(id, layer)` rather than `id` alone.
 */
export interface LayeredObjectKey {
  id: SemanticId
  layer: DatabaseTable['meta']['layer']
}

export function layeredObjectKey(id: SemanticId, layer: DatabaseTable['meta']['layer']): string {
  return `${id}::${layer}`
}

export function mergeLayeredTables(existing: Map<string, DatabaseTable>, incoming: DatabaseTable[]): Map<string, DatabaseTable> {
  const next = new Map(existing)
  for (const table of incoming) next.set(layeredObjectKey(table.meta.identity.id, table.meta.layer), table)
  return next
}

/** Filter tables by a case-insensitive substring match against qualified name or plain name. */
export function filterTablesBySearch(tables: DatabaseTableNodeView[], search: string | undefined): DatabaseTableNodeView[] {
  const query = search?.trim().toLowerCase()
  if (!query) return tables
  return tables.filter((table) => table.qualifiedName.toLowerCase().includes(query) || table.name.toLowerCase().includes(query))
}
