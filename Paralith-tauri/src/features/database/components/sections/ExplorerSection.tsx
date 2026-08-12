import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Database, Eye, ListOrdered, Network, Search, Table2 } from 'lucide-react'
import { useDatabaseStore } from '../../databaseStore'
import { SectionError } from '../SectionError'
import { buildTableNodeViews } from '../../databaseSelectors'
import { LayerUnavailableNotice } from './LayerUnavailableNotice'
import { layerUnavailableReason } from './layerAvailability'
import { buildExplorerGroups, type ExplorerEntry, type ObjectKind } from './explorerHierarchy'

const ROW_HEIGHT = 30 // matches --row-h-dense
const OVERSCAN = 12

const KIND_ICON: Record<ObjectKind, typeof Table2> = { table: Table2, view: Eye, enum: ListOrdered }

/**
 * Explorer: the schema browser.
 *
 * The hierarchy is namespace → object kind → object, and it is built only from what the adapter
 * actually produced. A category with nothing in it is not rendered — inventing an empty "Views"
 * folder for an adapter that cannot report views would be a claim about the database that no
 * evidence supports.
 */
export function ExplorerSection() {
  const schemaLoad = useDatabaseStore((state) => state.schemaLoad)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  const loadSchema = useDatabaseStore((state) => state.loadSchema)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const activeLayer = useDatabaseStore((state) => state.activeLayer)
  const selection = useDatabaseStore((state) => state.selection)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const revealObject = useDatabaseStore((state) => state.revealObject)
  const filters = useDatabaseStore((state) => state.filters)
  const setSearch = useDatabaseStore((state) => state.setSearch)

  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const tables = useMemo(() => buildTableNodeViews(schemaPage), [schemaPage])
  const groups = useMemo(() => buildExplorerGroups(schemaPage, tables, filters.search), [schemaPage, tables, filters.search])
  const totalObjects = useMemo(() => groups.reduce((sum, group) => sum + group.total, 0), [groups])

  if (schemaLoad.status === 'loading' && tables.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 10 }).map((_, index) => <span key={index} />)}</div>
  }

  if (schemaLoad.status === 'error') {
    const unavailable = layerUnavailableReason(activeLayer, schemaLoad)
    if (unavailable) return <LayerUnavailableNotice layer={activeLayer} />
    return <SectionError load={schemaLoad} fallback="Failed to load schema objects." onRetry={() => void loadSchema()} />
  }

  if (tables.length === 0) {
    return (
      <div className="db-explorer-empty">
        <Table2 size={22} />
        <span>No schema objects detected for this datasource.</span>
      </div>
    )
  }

  return (
    <div className="db-explorer">
      <div className="db-explorer-toolbar">
        <Search size={13} aria-hidden />
        <input
          value={filters.search ?? ''}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            // Enter jumps straight to the single best match, so search is a navigation control.
            if (event.key !== 'Enter') return
            const first = groups.flatMap((group) => group.kinds.flatMap((kind) => kind.entries))[0]
            if (first) selectObjects([first.id], { focusedId: first.id })
          }}
          placeholder="Search tables and columns…"
          aria-label="Search schema objects"
        />
        {filters.search && <span className="db-explorer-match-count">{totalObjects} match{totalObjects === 1 ? '' : 'es'}</span>}
      </div>

      {totalObjects === 0 ? (
        <div className="db-explorer-empty"><Table2 size={22} /><span>Nothing matches “{filters.search}”.</span></div>
      ) : (
        <div className="db-explorer-scroll" role="tree" aria-label="Schema objects">
          {groups.map((group) => (
            <section key={group.namespaceId} className="db-explorer-group">
              <button
                type="button"
                className="db-explorer-group-header"
                aria-expanded={!collapsed.has(group.namespaceId)}
                onClick={() => setCollapsed((current) => toggle(current, group.namespaceId))}
              >
                {collapsed.has(group.namespaceId) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                <Database size={13} />
                <span>{group.namespaceLabel}</span>
                <span className="db-explorer-row-count">{group.total}</span>
              </button>
              {!collapsed.has(group.namespaceId) && group.kinds.map((kindGroup) => (
                <KindSection
                  key={kindGroup.kind}
                  groupId={group.namespaceId}
                  kind={kindGroup.kind}
                  label={kindGroup.label}
                  entries={kindGroup.entries}
                  collapsed={collapsed}
                  onToggle={(key) => setCollapsed((current) => toggle(current, key))}
                  selectedIds={new Set(selection.tableIds)}
                  onSelect={(id) => selectObjects([id], { focusedId: id })}
                  onShowOnDiagram={(id) => revealObject(id, 'diagram')}
                />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function KindSection({ groupId, kind, label, entries, collapsed, onToggle, selectedIds, onSelect, onShowOnDiagram }: {
  groupId: string
  kind: ObjectKind
  label: string
  entries: ExplorerEntry[]
  collapsed: Set<string>
  onToggle: (key: string) => void
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onShowOnDiagram: (id: string) => void
}) {
  const key = `${groupId}::${kind}`
  const open = !collapsed.has(key)
  const Icon = KIND_ICON[kind]
  return (
    <div className="db-explorer-kind">
      <button type="button" className="db-explorer-kind-header" aria-expanded={open} onClick={() => onToggle(key)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Icon size={12} />
        <span>{label}</span>
        <span className="db-explorer-row-count">{entries.length}</span>
      </button>
      {open && (
        entries.length > 60
          // Only the long lists pay for virtualization; a fifteen-table schema renders plainly.
          ? <VirtualEntries entries={entries} selectedIds={selectedIds} onSelect={onSelect} onShowOnDiagram={onShowOnDiagram} />
          : <div>{entries.map((entry) => (
              <EntryRow key={entry.id} entry={entry} selected={selectedIds.has(entry.id)} onSelect={onSelect} onShowOnDiagram={onShowOnDiagram} />
            ))}</div>
      )}
    </div>
  )
}

function EntryRow({ entry, selected, onSelect, onShowOnDiagram }: {
  entry: ExplorerEntry
  selected: boolean
  onSelect: (id: string) => void
  onShowOnDiagram: (id: string) => void
}) {
  const Icon = KIND_ICON[entry.kind]
  return (
    <div className={`db-explorer-row ${selected ? 'is-active' : ''}`} style={{ height: ROW_HEIGHT }}>
      <button type="button" className="db-explorer-row-main" onClick={() => onSelect(entry.id)}>
        <Icon size={13} className="db-explorer-row-icon" />
        <span className="db-explorer-row-name">{entry.name}</span>
        {entry.matchedColumn && <span className="db-explorer-row-match">.{entry.matchedColumn}</span>}
        <span className="db-explorer-row-count">{entry.detail}</span>
        {entry.issueCount > 0 && <span className="db-explorer-row-issue">{entry.issueCount}</span>}
      </button>
      {entry.kind === 'table' && (
        <button
          type="button"
          className="db-explorer-row-action"
          title="Show on diagram"
          aria-label={`Show ${entry.name} on the diagram`}
          onClick={() => onShowOnDiagram(entry.id)}
        >
          <Network size={12} />
        </button>
      )}
    </div>
  )
}

function VirtualEntries({ entries, selectedIds, onSelect, onShowOnDiagram }: {
  entries: ExplorerEntry[]
  selectedIds: Set<string>
  onSelect: (id: string) => void
  onShowOnDiagram: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const update = () => setHeight(element.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const total = entries.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(total, start + visibleCount)

  return (
    <div className="db-explorer-virtual" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
      <div className="db-explorer-canvas" style={{ height: total * ROW_HEIGHT }}>
        <div className="db-explorer-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {entries.slice(start, end).map((entry) => (
            <EntryRow key={entry.id} entry={entry} selected={selectedIds.has(entry.id)} onSelect={onSelect} onShowOnDiagram={onShowOnDiagram} />
          ))}
        </div>
      </div>
    </div>
  )
}

function toggle(current: Set<string>, key: string): Set<string> {
  const next = new Set(current)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}
