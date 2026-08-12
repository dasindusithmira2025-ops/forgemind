import { ArrowUpRight, Key, Pin } from 'lucide-react'
import type { DatabaseNamespaceGroupView, DatabaseSemanticLod, DatabaseTableNodeView } from '../../databaseTypes'
import { MEDIUM_ROW_CAP, NEAR_ROW_CAP } from './nodeMetrics'

/** `TableNode`'s own visual detail tiers. `compact` is a rendering-only tier (never a zoom-lod
 * value from the store) used when the schema has a single namespace group, so far zoom shows one
 * small card per table instead of collapsing the entire database into one aggregate box. */
export type TableNodeVisualLod = DatabaseSemanticLod | 'compact'

interface TableNodeProps {
  table: DatabaseTableNodeView
  lod: TableNodeVisualLod
  x: number
  y: number
  width: number
  selected: boolean
  onSelect: (id: string, additive: boolean) => void
  onPointerDownDrag?: (event: React.PointerEvent, id: string) => void
  /** Release a pinned table back to automatic layout. */
  onReleasePin?: (id: string) => void
  dragging?: boolean
}

/**
 * A single table card. LOD is a prop, never internally derived — the parent (`SchemaCanvas`)
 * computes it once per frame from world zoom (UI-SPEC.md §3.1). `compact` shows name + relation
 * count only. `medium`/`far`-resolved-to-medium shows PK/FK columns plus enough bounded scalar
 * fields to fill `MEDIUM_ROW_CAP` rows; `near` shows more fields, up to `NEAR_ROW_CAP` — never
 * literally every column, so a wide table's card height stays within what `nodeMetrics`'s layout
 * estimate reserves for it (mission §16: no unbounded canvas content). Never raw ORM/SQL syntax —
 * constraint membership renders as icons/badges, not `@relation(...)`/`@@index(...)` strings. The
 * right Inspector is always the exhaustive source (mission §2).
 */
export function TableNode({ table, lod, x, y, width, selected, onSelect, onPointerDownDrag, onReleasePin, dragging }: TableNodeProps) {
  if (lod === 'compact') {
    return (
      <div
        className={`db-canvas-node db-table-node-compact ${selected ? 'is-selected' : ''} ${table.pinned ? 'is-pinned' : ''} ${dragging ? 'is-dragging' : ''}`}
        style={{ left: x, top: y, width }}
        data-node-id={table.id}
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onPointerDown={(event) => onPointerDownDrag?.(event, table.id)}
        onClick={(event) => onSelect(table.id, event.shiftKey || event.ctrlKey || event.metaKey)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(table.id, event.shiftKey) } }}
      >
        {table.pinned && <Pin size={10} className="db-table-node-pin" aria-label="Pinned" />}
        <span className="db-table-node-compact-name" title={table.qualifiedName}>{table.name}</span>
        <span className="db-table-node-compact-count">{table.relationCount || table.columns.length}</span>
        {table.issueCount > 0 && <span className="db-table-node-issue-dot" title={`${table.issueCount} health issue${table.issueCount === 1 ? '' : 's'}`} />}
      </div>
    )
  }

  const rowCap = lod === 'near' ? NEAR_ROW_CAP : MEDIUM_ROW_CAP
  const keyColumns = table.columns.filter((column) => column.isPrimaryKey || column.isForeignKey)
  const remainingSlots = Math.max(0, rowCap - keyColumns.length)
  const scalarColumns = [...table.columns]
    .filter((column) => !column.isPrimaryKey && !column.isForeignKey)
    .sort((a, b) => (Number(b.isUnique) - Number(a.isUnique)) || (Number(b.isIndexed) - Number(a.isIndexed)))
    .slice(0, remainingSlots)
  // Key columns are never dropped for being past the cap (a PK/FK is always architecturally
  // relevant), but the total row count — and therefore the card's height — is still bounded by
  // `nodeMetrics.estimateTableNodeHeight`, which reserves for up to `NEAR_ROW_CAP` rows regardless
  // of tier; a table with more keys than that is the one case a card can outgrow its reserved slot.
  const shown = table.columns.filter((column) => keyColumns.includes(column) || scalarColumns.includes(column))
  const hiddenCount = table.columns.length - shown.length

  return (
    <div
      className={`db-canvas-node db-table-node ${selected ? 'is-selected' : ''} ${table.pinned ? 'is-pinned' : ''} ${dragging ? 'is-dragging' : ''}`}
      style={{ left: x, top: y, width }}
      data-node-id={table.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onPointerDown={(event) => onPointerDownDrag?.(event, table.id)}
      onClick={(event) => onSelect(table.id, event.shiftKey || event.ctrlKey || event.metaKey)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(table.id, event.shiftKey) } }}
    >
      <header className="db-table-node-header">
        {table.pinned && (
          // A pinned table is held out of automatic layout, so the state has to be visible and
          // reversible from the card itself rather than only from wherever it was pinned.
          <button
            type="button"
            className="db-table-node-pin-button"
            title="Pinned — release to automatic layout"
            aria-label="Release pinned position"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); onReleasePin?.(table.id) }}
          >
            <Pin size={11} />
          </button>
        )}
        <span className="db-table-node-name" title={table.qualifiedName}>{table.name}</span>
        {table.issueCount > 0 && <span className="db-table-node-issue-badge" title={`${table.issueCount} health issue${table.issueCount === 1 ? '' : 's'}`}>{table.issueCount}</span>}
      </header>
      <div className="db-table-node-columns">
        {shown.map((column) => (
          <div key={column.id} className={`db-table-node-column ${column.nullable && !column.isPrimaryKey ? 'is-nullable' : ''}`}>
            {column.isPrimaryKey
              ? <Key size={11} className="db-col-icon is-pk" aria-label="Primary key" />
              : column.isForeignKey
                ? <ArrowUpRight size={11} className="db-col-icon is-fk" aria-label="Foreign key" />
                : <span className="db-col-icon-spacer" />}
            <span className="db-table-node-column-name" title={column.name}>{column.name}</span>
            {column.isUnique && !column.isPrimaryKey && <span className="db-col-badge is-unique" title="Unique">UQ</span>}
            {column.isIndexed && !column.isPrimaryKey && !column.isUnique && <span className="db-col-badge is-indexed" title="Indexed" aria-hidden />}
            <span className="db-table-node-column-type" title={column.typeLabel}>{column.typeLabel}</span>
          </div>
        ))}
        {hiddenCount > 0 && <div className="db-table-node-more">+{hiddenCount} more field{hiddenCount === 1 ? '' : 's'}</div>}
      </div>
    </div>
  )
}

interface DomainAggregateNodeProps {
  group: DatabaseNamespaceGroupView
  x: number
  y: number
  width: number
  selected: boolean
  onSelect: (id: string, additive: boolean) => void
}

/** LOD0 (far) render unit when a schema has more than one namespace — one node per domain/namespace
 * group, never a per-table card. Single-namespace schemas render `TableNode` in `compact` mode
 * instead (see `SchemaCanvas`), since collapsing an entire single-schema database into one box
 * communicates nothing about its architecture. */
export function DomainAggregateNode({ group, x, y, width, selected, onSelect }: DomainAggregateNodeProps) {
  return (
    <div
      className={`db-canvas-node db-domain-node ${selected ? 'is-selected' : ''}`}
      style={{ left: x, top: y, width }}
      data-node-id={group.id}
      data-node-kind="domain-aggregate"
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={(event) => onSelect(group.id, event.shiftKey || event.ctrlKey || event.metaKey)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(group.id, event.shiftKey) } }}
    >
      <span className="db-domain-node-name">{group.label}</span>
      <span className="db-domain-node-count">{group.tableIds.length} table{group.tableIds.length === 1 ? '' : 's'}</span>
      {group.issueCount > 0 && <span className="db-domain-node-issue-badge">{group.issueCount}</span>}
    </div>
  )
}
