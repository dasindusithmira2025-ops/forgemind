import { Key, Link2 } from 'lucide-react'
import type { DatabaseNamespaceGroupView, DatabaseSemanticLod, DatabaseTableNodeView } from '../../databaseTypes'

interface TableNodeProps {
  table: DatabaseTableNodeView
  lod: DatabaseSemanticLod
  x: number
  y: number
  width: number
  selected: boolean
  onSelect: (id: string, additive: boolean) => void
  onPointerDownDrag?: (event: React.PointerEvent, id: string) => void
}

const COLLAPSE_THRESHOLD = 6

/**
 * A single table card. LOD is a prop, never internally derived — the parent (`SchemaCanvas`)
 * computes it once per frame from world zoom (UI-SPEC.md §3.1). Medium LOD renders only
 * PK/FK-flagged columns plus a collapsed "N more columns" row; near LOD renders every column.
 */
export function TableNode({ table, lod, x, y, width, selected, onSelect, onPointerDownDrag }: TableNodeProps) {
  const visibleColumns = lod === 'near' ? table.columns : table.columns.filter((column) => column.isPrimaryKey || column.isForeignKey)
  const hiddenCount = lod === 'near' ? 0 : table.columns.length - visibleColumns.length
  const shown = lod === 'near' ? visibleColumns : visibleColumns.slice(0, COLLAPSE_THRESHOLD)
  const collapsedCount = hiddenCount + Math.max(0, visibleColumns.length - shown.length)

  return (
    <div
      className={`db-canvas-node db-table-node ${selected ? 'is-selected' : ''}`}
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
        <span className="db-table-node-name" title={table.qualifiedName}>{table.name}</span>
        {table.issueCount > 0 && <span className="db-table-node-issue-badge" title={`${table.issueCount} health issue${table.issueCount === 1 ? '' : 's'}`}>{table.issueCount}</span>}
      </header>
      <div className="db-table-node-columns">
        {shown.map((column) => (
          <div key={column.id} className="db-table-node-column">
            {column.isPrimaryKey ? <Key size={12} className="db-col-icon is-pk" aria-label="Primary key" /> : column.isForeignKey ? <Link2 size={12} className="db-col-icon is-fk" aria-label="Foreign key" /> : <span className="db-col-icon-spacer" />}
            <span className="db-table-node-column-name">{column.name}</span>
            <span className="db-table-node-column-type">{column.typeLabel}</span>
          </div>
        ))}
        {collapsedCount > 0 && <div className="db-table-node-more">+{collapsedCount} more column{collapsedCount === 1 ? '' : 's'}</div>}
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

/** LOD0 (far) render unit — one node per namespace/domain group, never a per-table card. */
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
