import { searchTables } from '../../databaseSelectors'
import type { DatabaseGraphPage, DatabaseTableNodeView, SemanticId } from '../../databaseTypes'

export type ObjectKind = 'table' | 'view' | 'enum'

export interface ExplorerEntry {
  id: SemanticId
  kind: ObjectKind
  name: string
  /** Right-aligned secondary text — column count for a table, value count for an enum. */
  detail: string
  issueCount: number
  /** Set when this row matched because one of its columns matched, not its own name. */
  matchedColumn?: string
}

export interface ExplorerGroup {
  namespaceId: string
  namespaceLabel: string
  kinds: Array<{ kind: ObjectKind; label: string; entries: ExplorerEntry[] }>
  total: number
}

export const KIND_LABEL: Record<ObjectKind, string> = { table: 'Tables', view: 'Views', enum: 'Enums' }

/**
 * Group the loaded graph into namespace → kind → object. Views and enums come straight from the
 * graph page, so they appear only for adapters that actually extract them.
 */
export function buildExplorerGroups(
  page: DatabaseGraphPage | undefined,
  tables: DatabaseTableNodeView[],
  search: string | undefined,
): ExplorerGroup[] {
  if (!page) return []

  const namespaceNames = new Map<string, string>()
  for (const object of page.objects) {
    if (object.kind === 'namespace') namespaceNames.set(object.value.meta.identity.id, object.value.name)
  }

  const issueCountByObject = new Map<SemanticId, number>()
  for (const issue of page.issues) {
    for (const objectId of issue.semanticObjectIds) {
      issueCountByObject.set(objectId, (issueCountByObject.get(objectId) ?? 0) + 1)
    }
  }

  const matches = searchTables(tables, search)
  const byNamespace = new Map<string, Map<ObjectKind, ExplorerEntry[]>>()
  const push = (namespaceId: string, kind: ObjectKind, entry: ExplorerEntry) => {
    const kinds = byNamespace.get(namespaceId) ?? new Map<ObjectKind, ExplorerEntry[]>()
    const list = kinds.get(kind) ?? []
    list.push(entry)
    kinds.set(kind, list)
    byNamespace.set(namespaceId, kinds)
  }

  for (const match of matches) {
    push(match.table.groupId, 'table', {
      id: match.table.id,
      kind: 'table',
      name: match.table.name,
      detail: `${match.table.columns.length} col${match.table.columns.length === 1 ? '' : 's'}`,
      issueCount: match.table.issueCount,
      matchedColumn: match.matchedColumn,
    })
  }

  const query = search?.trim().toLowerCase()
  const nameMatches = (name: string) => !query || name.toLowerCase().includes(query)

  for (const object of page.objects) {
    if (object.kind === 'view' && nameMatches(object.value.name)) {
      push(object.value.namespaceId, 'view', {
        id: object.value.meta.identity.id,
        kind: 'view',
        name: object.value.name,
        detail: object.value.materialized ? 'materialized' : 'view',
        issueCount: issueCountByObject.get(object.value.meta.identity.id) ?? 0,
      })
    }
    if (object.kind === 'enum' && nameMatches(object.value.name)) {
      push(object.value.namespaceId, 'enum', {
        id: object.value.meta.identity.id,
        kind: 'enum',
        name: object.value.name,
        detail: `${object.value.values.length} value${object.value.values.length === 1 ? '' : 's'}`,
        issueCount: 0,
      })
    }
  }

  const groups: ExplorerGroup[] = []
  for (const [namespaceId, kinds] of byNamespace) {
    const ordered: ExplorerGroup['kinds'] = []
    let total = 0
    for (const kind of ['table', 'view', 'enum'] as ObjectKind[]) {
      const entries = kinds.get(kind)
      if (!entries || entries.length === 0) continue
      entries.sort((left, right) => left.name.localeCompare(right.name))
      ordered.push({ kind, label: KIND_LABEL[kind], entries })
      total += entries.length
    }
    if (total === 0) continue
    groups.push({
      namespaceId,
      namespaceLabel: namespaceNames.get(namespaceId) ?? namespaceId,
      kinds: ordered,
      total,
    })
  }
  return groups.sort((left, right) => left.namespaceLabel.localeCompare(right.namespaceLabel))
}
