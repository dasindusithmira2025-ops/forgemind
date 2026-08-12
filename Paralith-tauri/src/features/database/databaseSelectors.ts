import { isPrimaryDatabaseSource } from './databaseTypes'
import type {
  DatabaseColumn,
  DatabaseGraphObject,
  DatabaseGraphPage,
  DatabaseIndex,
  DatabaseNamespaceGroupView,
  DatabaseTable,
  DatabaseSource,
  DatabaseTableNodeView,
  ForeignKey,
  PrimaryKey,
  SemanticId,
  UniqueConstraint,
} from './databaseTypes'

/** Extract just the tables from a mixed-kind graph page. Pure — no store access. */
export function tablesFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseTable[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'table' }> => object.kind === 'table').map((object) => object.value)
}

export function columnsFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseColumn[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'column' }> => object.kind === 'column').map((object) => object.value)
}

function primaryKeysFromGraphPage(page: DatabaseGraphPage | undefined): PrimaryKey[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'primary_key' }> => object.kind === 'primary_key').map((object) => object.value)
}

function foreignKeysFromGraphPage(page: DatabaseGraphPage | undefined): ForeignKey[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'foreign_key' }> => object.kind === 'foreign_key').map((object) => object.value)
}

function uniqueConstraintsFromGraphPage(page: DatabaseGraphPage | undefined): UniqueConstraint[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'unique_constraint' }> => object.kind === 'unique_constraint').map((object) => object.value)
}

function indexesFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseIndex[] {
  if (!page) return []
  return page.objects.filter((object): object is Extract<DatabaseGraphObject, { kind: 'index' }> => object.kind === 'index').map((object) => object.value)
}

function typeLabel(column: DatabaseColumn): string {
  const family = column.dataType.family
  if (column.dataType.length) return `${family}(${column.dataType.length})`
  return column.nativeType || family
}

/**
 * Build render-ready node views from a graph page. PK/FK/unique/index membership is resolved from
 * the actual `primary_key`/`foreign_key`/`unique_constraint`/`index` objects each table links to
 * (`primaryKeyId`, `foreignKeyIds`, `uniqueConstraintIds`, `indexIds`) — column-level flags are
 * derived from constraint column membership, never guessed from naming.
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

  const primaryKeysById = new Map(primaryKeysFromGraphPage(page).map((key) => [key.meta.identity.id, key]))
  const foreignKeysById = new Map(foreignKeysFromGraphPage(page).map((key) => [key.meta.identity.id, key]))
  const uniqueConstraintsById = new Map(uniqueConstraintsFromGraphPage(page).map((constraint) => [constraint.meta.identity.id, constraint]))
  const indexesById = new Map(indexesFromGraphPage(page).map((index) => [index.meta.identity.id, index]))

  // Incoming FK count per referenced table, for the far-zoom compact node's relationship count.
  const incomingCountByTable = new Map<SemanticId, number>()
  for (const key of foreignKeysById.values()) {
    incomingCountByTable.set(key.referencedTableId, (incomingCountByTable.get(key.referencedTableId) ?? 0) + 1)
  }

  return tables.map((table) => {
    const primaryKey: PrimaryKey | undefined = table.primaryKeyId ? primaryKeysById.get(table.primaryKeyId) : undefined
    const foreignKeys: ForeignKey[] = table.foreignKeyIds.map((id) => foreignKeysById.get(id)).filter((key): key is ForeignKey => Boolean(key))
    const uniqueConstraints: UniqueConstraint[] = table.uniqueConstraintIds.map((id) => uniqueConstraintsById.get(id)).filter((c): c is UniqueConstraint => Boolean(c))
    const indexes: DatabaseIndex[] = table.indexIds.map((id) => indexesById.get(id)).filter((i): i is DatabaseIndex => Boolean(i))

    const pkColumnIds = new Set<SemanticId>(primaryKey?.columnIds ?? [])
    const fkColumnIds = new Set<SemanticId>(foreignKeys.flatMap((key) => key.columnIds))
    // Only a single-column unique constraint reads as an "identity" marker on a column badge —
    // composite uniqueness is a table-level constraint, not one column's property.
    const uniqueColumnIds = new Set<SemanticId>(uniqueConstraints.filter((c) => c.columnIds.length === 1).flatMap((c) => c.columnIds))
    const indexedColumnIds = new Set<SemanticId>(indexes.filter((index) => index.keys.length === 1).flatMap((index) => index.keys.map((key) => key.columnId).filter((id): id is SemanticId => Boolean(id))))

    const columns = (columnsByTable.get(table.meta.identity.id) ?? [])
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((column) => ({
        id: column.meta.identity.id,
        name: column.name,
        typeLabel: typeLabel(column),
        isPrimaryKey: pkColumnIds.has(column.meta.identity.id),
        isForeignKey: fkColumnIds.has(column.meta.identity.id),
        isUnique: uniqueColumnIds.has(column.meta.identity.id),
        isIndexed: indexedColumnIds.has(column.meta.identity.id),
        nullable: column.nullable,
      }))
    return {
      id: table.meta.identity.id,
      qualifiedName: table.meta.identity.qualifiedName,
      name: table.name,
      groupId: table.namespaceId,
      groupLabel: table.namespaceId,
      columns,
      relationCount: foreignKeys.length + (incomingCountByTable.get(table.meta.identity.id) ?? 0),
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

/**
 * What the source rail and Overview show. Discovery reports every datasource it can prove exists,
 * including a repository's own test fixtures; the default view is the application-relevant subset.
 *
 * A repository whose *only* databases are fixtures still shows them — hiding everything would
 * assert "this project has no database", which is a different and false statement.
 */
export function visibleDatabaseSources(sources: DatabaseSource[], showAll: boolean): DatabaseSource[] {
  if (showAll) return sources
  const primary = sources.filter(isPrimaryDatabaseSource)
  return primary.length > 0 ? primary : sources
}

export function hiddenDatabaseSourceCount(sources: DatabaseSource[], showAll: boolean): number {
  return sources.length - visibleDatabaseSources(sources, showAll).length
}

/** Table and relation counts for one source's loaded graph — the Overview's headline numbers. */
export interface DatabaseSourceStats {
  tableCount: number
  relationCount: number
}

export function statsFromGraphPage(page: DatabaseGraphPage | undefined): DatabaseSourceStats {
  if (!page) return { tableCount: 0, relationCount: 0 }
  return {
    tableCount: page.objects.filter((object) => object.kind === 'table').length,
    relationCount: page.edges.filter((edge) => edge.edgeType === 'REFERENCES').length,
  }
}

/**
 * Search that answers "where does this column live". Matching only table names meant searching a
 * column name returned nothing, even though the owning table is exactly what the user wanted.
 */
export interface TableSearchMatch {
  table: DatabaseTableNodeView
  /** The column that matched, when the query matched a column rather than the table itself. */
  matchedColumn?: string
}

export function searchTables(tables: DatabaseTableNodeView[], search: string | undefined): TableSearchMatch[] {
  const query = search?.trim().toLowerCase()
  if (!query) return tables.map((table) => ({ table }))
  const matches: TableSearchMatch[] = []
  for (const table of tables) {
    if (table.name.toLowerCase().includes(query) || table.qualifiedName.toLowerCase().includes(query)) {
      matches.push({ table })
      continue
    }
    const column = table.columns.find((candidate) => candidate.name.toLowerCase().includes(query))
    if (column) matches.push({ table, matchedColumn: column.name })
  }
  // Table-name matches rank above column matches: the direct answer comes first.
  return matches.sort((left, right) => Number(Boolean(left.matchedColumn)) - Number(Boolean(right.matchedColumn)))
}
