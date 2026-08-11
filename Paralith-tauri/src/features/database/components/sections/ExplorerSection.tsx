import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, RotateCcw, Search, Table2 } from 'lucide-react'
import { Button } from '../../../../components/ui/Button'
import { useDatabaseStore } from '../../databaseStore'
import { buildTableNodeViews, filterTablesBySearch } from '../../databaseSelectors'

const ROW_HEIGHT = 30 // matches --row-h-dense
const OVERSCAN = 12

/**
 * A dense, virtualized table listing. Follows `DiffViewer`'s `VirtualRows` precedent exactly:
 * scrollTop-driven windowing, a fixed row height, a single `translateY`-transformed inner div.
 */
export function ExplorerSection() {
  const schemaLoad = useDatabaseStore((state) => state.schemaLoad)
  const schemaPage = useDatabaseStore((state) => state.schemaPage)
  const loadSchema = useDatabaseStore((state) => state.loadSchema)
  const activeSourceId = useDatabaseStore((state) => state.activeSourceId)
  const selection = useDatabaseStore((state) => state.selection)
  const selectObjects = useDatabaseStore((state) => state.selectObjects)
  const filters = useDatabaseStore((state) => state.filters)
  const setSearch = useDatabaseStore((state) => state.setSearch)

  useEffect(() => {
    if (schemaLoad.status === 'idle' && activeSourceId) void loadSchema()
  }, [schemaLoad.status, activeSourceId, loadSchema])

  const allTables = useMemo(() => buildTableNodeViews(schemaPage), [schemaPage])
  const tables = useMemo(() => filterTablesBySearch(allTables, filters.search), [allTables, filters.search])

  if (schemaLoad.status === 'loading' && allTables.length === 0) {
    return <div className="code-explorer-skeleton">{Array.from({ length: 10 }).map((_, index) => <span key={index} />)}</div>
  }

  if (schemaLoad.status === 'error') {
    return (
      <div className="db-section-error">
        <AlertTriangle size={18} />
        <span>{schemaLoad.errorMessage ?? 'Failed to load tables.'}</span>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void loadSchema()}>Retry</Button>
      </div>
    )
  }

  if (allTables.length === 0) {
    return <div className="db-explorer-empty"><Table2 size={22} /><span>No tables in this schema.</span></div>
  }

  return (
    <div className="db-explorer">
      <div className="db-explorer-toolbar">
        <Search size={13} aria-hidden />
        <input value={filters.search ?? ''} onChange={(event) => setSearch(event.target.value)} placeholder="Search tables…" aria-label="Search tables" />
      </div>
      {tables.length === 0 ? (
        <div className="db-explorer-empty"><Table2 size={22} /><span>No tables match your filter.</span></div>
      ) : (
        <VirtualTableRows tables={tables} selectedIds={new Set(selection.tableIds)} onSelect={(id) => selectObjects([id], { focusedId: id })} />
      )}
    </div>
  )
}

function VirtualTableRows({ tables, selectedIds, onSelect }: {
  tables: ReturnType<typeof buildTableNodeViews>
  selectedIds: Set<string>
  onSelect: (id: string) => void
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

  const total = tables.length
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2
  const end = Math.min(total, start + visibleCount)
  const slice = tables.slice(start, end)

  return (
    <div className="db-explorer-scroll" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} tabIndex={0} role="region" aria-label="Table list">
      <div className="db-explorer-canvas" style={{ height: total * ROW_HEIGHT }}>
        <div className="db-explorer-window" style={{ transform: `translateY(${start * ROW_HEIGHT}px)` }}>
          {slice.map((table) => (
            <button
              key={table.id}
              type="button"
              className={`db-explorer-row ${selectedIds.has(table.id) ? 'is-active' : ''}`}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onSelect(table.id)}
            >
              <Table2 size={13} className="db-explorer-row-icon" />
              <span className="db-explorer-row-name">{table.name}</span>
              <span className="db-explorer-row-count">{table.columns.length} col{table.columns.length === 1 ? '' : 's'}</span>
              {table.issueCount > 0 && <span className="db-explorer-row-issue">{table.issueCount}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
