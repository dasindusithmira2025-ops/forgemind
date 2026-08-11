import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Loader2, Maximize2, Search as SearchIcon, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { CanvasEdgeRef, CanvasNodeRect, DatabaseNamespaceGroupView, DatabaseTableNodeView } from '../../databaseTypes'
import { applyHideUnrelated, computeBoundingBox, computeFitZoom, computeVisibleNodeIds, highlightedEdges, nHopNodes, resolveRenderDescriptors } from './canvasSelectors'
import { useDatabaseCanvasStore } from './databaseCanvasStore'
import { COMPACT_NODE_HEIGHT, DOMAIN_NODE_WIDTH, NODE_WIDTH, estimateTableNodeHeight } from './nodeMetrics'
import { DomainAggregateNode, TableNode } from './TableNode'

const OVERSCAN_PX = 200
const CANVAS_PADDING = 48
/** The lower bound for the automatic initial fit — never opens a large schema shrunk past the
 * point of legibility (UI-SPEC.md/mission §14). Matches the medium-LOD zoom threshold. */
const INITIAL_FIT_MIN_ZOOM = 0.35
const INITIAL_FIT_MAX_ZOOM = 1

export interface SchemaCanvasProps {
  tables: DatabaseTableNodeView[]
  groups: DatabaseNamespaceGroupView[]
  edges: CanvasEdgeRef[]
  selection: Set<string>
  onSelect: (id: string, additive: boolean) => void
  hideUnrelated: boolean
  onHideUnrelatedChange: (value: boolean) => void
  nHop: number
  onNHopChange: (value: number) => void
  grouped: boolean
  onGroupedChange: (value: boolean) => void
  loading: boolean
  layoutPending: boolean
}

interface Rect { x: number; y: number; w: number; h: number }

function anchorPoint(rect: Rect, side: 'left' | 'right' | 'top' | 'bottom') {
  switch (side) {
    case 'left': return { x: rect.x, y: rect.y + rect.h / 2 }
    case 'right': return { x: rect.x + rect.w, y: rect.y + rect.h / 2 }
    case 'top': return { x: rect.x + rect.w / 2, y: rect.y }
    default: return { x: rect.x + rect.w / 2, y: rect.y + rect.h }
  }
}

/**
 * A smooth path anchored to the facing sides of the two node rects (not their centers), so a line
 * approaches a card's edge instead of visually cutting through its interior. `spreadIndex`/`spreadOf`
 * fan parallel edges between the same pair of tables apart so they stay individually traceable.
 */
function buildEdgePath(from: Rect, to: Rect, spreadIndex: number, spreadOf: number): string {
  const dx = (to.x + to.w / 2) - (from.x + from.w / 2)
  const dy = (to.y + to.h / 2) - (from.y + from.h / 2)
  const horizontal = Math.abs(dx) >= Math.abs(dy)
  const fromSide = horizontal ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top')
  const toSide = horizontal ? (dx >= 0 ? 'left' : 'right') : (dy >= 0 ? 'top' : 'bottom')
  const start = anchorPoint(from, fromSide)
  const end = anchorPoint(to, toSide)
  const centered = spreadIndex - (spreadOf - 1) / 2
  const offset = centered * 16
  if (horizontal) {
    const midX = (start.x + end.x) / 2
    return `M ${start.x} ${start.y} C ${midX} ${start.y + offset}, ${midX} ${end.y + offset}, ${end.x} ${end.y}`
  }
  const midY = (start.y + end.y) / 2
  return `M ${start.x} ${start.y} C ${start.x + offset} ${midY}, ${end.x + offset} ${midY}, ${end.x} ${end.y}`
}

/**
 * The DOM+SVG canvas engine (UI-SPEC.md §3.1). No graph-rendering library: nodes are absolutely
 * positioned DOM elements, edges are `<path>`s inside one SVG overlay, and both are viewport-culled
 * against `useDatabaseCanvasStore`'s already-computed positions. Layout itself is never called from
 * here — `DiagramSection` owns the `recomputeLayout` effect; this component only *reads*
 * `positions`/`bounds` from the store.
 */
export function SchemaCanvas({ tables, groups, edges, selection, onSelect, hideUnrelated, onHideUnrelatedChange, nHop, onNHopChange, grouped, onGroupedChange, loading, layoutPending }: SchemaCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useDatabaseCanvasStore((state) => state.viewport)
  const lod = useDatabaseCanvasStore((state) => state.lod)
  const positions = useDatabaseCanvasStore((state) => state.positions)
  const bounds = useDatabaseCanvasStore((state) => state.bounds)
  const setViewport = useDatabaseCanvasStore((state) => state.setViewport)
  const zoomAround = useDatabaseCanvasStore((state) => state.zoomAround)
  const fitToRect = useDatabaseCanvasStore((state) => state.fitToRect)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  const nodeRects: CanvasNodeRect[] = useMemo(
    () => tables.map((table) => {
      const position = positions[table.id] ?? { x: 0, y: 0 }
      return { id: table.id, x: position.x, y: position.y, w: NODE_WIDTH, h: estimateTableNodeHeight(table.columns.length), groupId: table.groupId }
    }),
    [tables, positions],
  )
  const nodeRectsById = useMemo(() => new Map(nodeRects.map((rect) => [rect.id, rect])), [nodeRects])

  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables])
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])
  // A single-namespace schema (the common case for a Prisma/Drizzle project with one schema) has
  // nothing meaningful to group by — collapsing it to one aggregate box at far zoom would hide the
  // entire database behind one label. Grouping only ever applies when there is more than one group
  // and the caller has not turned it off (mission §7's "Group by namespace / No grouping").
  const groupingActive = grouped && groups.length > 1
  // The zoom-driven LOD still drives the backend semantic-LOD tier and the toolbar indicator, but
  // far zoom only collapses to domain-aggregate boxes when grouping is actually meaningful;
  // otherwise every table renders as its own compact card (mission §2's far-zoom example).
  const resolveLod = lod === 'far' && !groupingActive ? 'medium' : lod

  const containerSize = viewportRef.current?.getBoundingClientRect()
  const viewportWorldRect = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: (containerSize?.width ?? 1200) / viewport.zoom,
    height: (containerSize?.height ?? 800) / viewport.zoom,
  }

  const rawVisibleIds = useMemo(
    () => computeVisibleNodeIds(nodeRects, viewportWorldRect, resolveLod, OVERSCAN_PX),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerSize is a DOMRect read each render, intentionally not a dependency key
    [nodeRects, resolveLod, viewport.x, viewport.y, viewport.zoom],
  )

  const visibleIds = useMemo(
    () => hideUnrelated ? applyHideUnrelated(rawVisibleIds, selection, edges, nHop) : rawVisibleIds,
    [rawVisibleIds, hideUnrelated, selection, edges, nHop],
  )

  const descriptors = useMemo(() => resolveRenderDescriptors(visibleIds, nodeRects, resolveLod), [visibleIds, nodeRects, resolveLod])
  const highlightSet = useMemo(() => new Set(highlightedEdges(selection, edges).map((edge) => edge.id)), [selection, edges])
  const neighborhood = useMemo(() => hideUnrelated || selection.size === 0 ? undefined : nHopNodes(selection, edges, nHop), [hideUnrelated, selection, edges, nHop])

  const visibleEdges = useMemo(() => {
    const visibleSet = new Set(visibleIds)
    return edges.filter((edge) => (visibleSet.has(edge.from) || visibleSet.has(edge.to) || highlightSet.has(edge.id)) && positions[edge.from] && positions[edge.to])
  }, [edges, visibleIds, highlightSet, positions])

  // Parallel-edge grouping: how many edges connect the same unordered pair of tables, and this
  // edge's index within that group, so `buildEdgePath` can fan them apart deterministically.
  const edgeSpread = useMemo(() => {
    const byPair = new Map<string, string[]>()
    for (const edge of visibleEdges) {
      const key = [edge.from, edge.to].sort().join('::')
      const list = byPair.get(key) ?? []
      list.push(edge.id)
      byPair.set(key, list)
    }
    const spread = new Map<string, { index: number; of: number }>()
    for (const ids of byPair.values()) ids.forEach((id, index) => spread.set(id, { index, of: ids.length }))
    return spread
  }, [visibleEdges])

  // At LOD0 (far, grouping active) individual table cards never mount — `visibleEdges` would
  // otherwise draw lines to the invisible per-table positions underneath the aggregate boxes,
  // dangling in empty space. Collapse same-pair table edges into one edge per distinct domain pair
  // instead, anchored to the aggregate boxes actually on screen (mission §5/§7: relationships stay
  // legible at every LOD, including between domains).
  const groupRects = useMemo(() => {
    const map = new Map<string, Rect>()
    for (const group of groups) {
      const position = positions[group.id] ?? computeBoundingBox(nodeRects.filter((node) => node.groupId === group.id))
      map.set(group.id, { x: position.x, y: position.y, w: DOMAIN_NODE_WIDTH, h: COMPACT_NODE_HEIGHT })
    }
    return map
  }, [groups, positions, nodeRects])

  const groupEdges = useMemo(() => {
    if (resolveLod !== 'far') return []
    const groupOfTable = new Map(tables.map((table) => [table.id, table.groupId]))
    const pairs = new Map<string, { from: string; to: string; highlighted: boolean }>()
    for (const edge of edges) {
      const fromGroup = groupOfTable.get(edge.from)
      const toGroup = groupOfTable.get(edge.to)
      if (!fromGroup || !toGroup || fromGroup === toGroup) continue // intra-domain edges are absorbed into the one aggregate box
      const key = [fromGroup, toGroup].sort().join('::')
      const highlighted = highlightSet.has(edge.id)
      const existing = pairs.get(key)
      if (existing) existing.highlighted = existing.highlighted || highlighted
      else pairs.set(key, { from: fromGroup, to: toGroup, highlighted })
    }
    return [...pairs.entries()].map(([key, value]) => ({ id: `group-edge:${key}`, ...value }))
  }, [resolveLod, tables, edges, highlightSet])

  const searchMatches = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return []
    return tables.filter((table) => table.name.toLowerCase().includes(query) || table.qualifiedName.toLowerCase().includes(query)).slice(0, 8)
  }, [searchTerm, tables])

  const startPan = useCallback((event: React.PointerEvent) => {
    if ((event.target as HTMLElement).closest('[data-node-id]')) return
    event.preventDefault()
    const origin = { x: event.clientX, y: event.clientY }
    const startViewport = { ...viewport }
    const move = (moveEvent: PointerEvent) => {
      setViewport({ x: startViewport.x + (moveEvent.clientX - origin.x), y: startViewport.y + (moveEvent.clientY - origin.y) })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewport captured at drag start intentionally
  }, [viewport, setViewport])

  const onWheel = useCallback((event: React.WheelEvent) => {
    if (!event.ctrlKey) return // plain wheel scrolls the surrounding page per UI-SPEC.md §3.2
    event.preventDefault()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    zoomAround(event.deltaY, event.clientX, event.clientY, rect)
  }, [zoomAround])

  const fitToView = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const box = computeBoundingBox(nodeRects)
    fitToRect(box, rect.width, rect.height, CANVAS_PADDING)
  }, [nodeRects, fitToRect])

  const fitToSelection = useCallback(() => {
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect || selection.size === 0) return
    const selected = nodeRects.filter((node) => selection.has(node.id))
    if (selected.length === 0) return
    const box = computeBoundingBox(selected)
    fitToRect(box, rect.width, rect.height, CANVAS_PADDING)
  }, [nodeRects, selection, fitToRect])

  const goToTable = useCallback((id: string) => {
    const rect = viewportRef.current?.getBoundingClientRect()
    const node = nodeRects.find((candidate) => candidate.id === id)
    if (!rect || !node) return
    onSelect(id, false)
    const zoom = Math.max(viewport.zoom, 0.7)
    const x = rect.width / 2 - (node.x + node.w / 2) * zoom
    const y = rect.height / 2 - (node.y + node.h / 2) * zoom
    setViewport({ x, y, zoom })
    setSearchTerm('')
    setSearchOpen(false)
  }, [nodeRects, onSelect, setViewport, viewport.zoom])

  useEffect(() => {
    // Auto-fit once, the first time real layout bounds arrive, so the diagram never opens blank —
    // but never shrink a large schema past legibility just to fit every table on screen at once
    // (mission §14). Zoom is clamped to at least the medium-LOD threshold; it is fine for a big
    // schema to render off-screen content the user then pans/searches to.
    if (bounds.width > 0 && viewport.x === 0 && viewport.y === 0 && viewport.zoom === 0.6) {
      const rect = viewportRef.current?.getBoundingClientRect()
      const box = computeBoundingBox(nodeRects)
      if (!rect || box.width <= 0 || box.height <= 0) return
      const naturalZoom = computeFitZoom(box, rect.width, rect.height, CANVAS_PADDING)
      const zoom = Math.min(INITIAL_FIT_MAX_ZOOM, Math.max(INITIAL_FIT_MIN_ZOOM, naturalZoom))
      const x = CANVAS_PADDING - box.x * zoom + Math.max(0, (rect.width - CANVAS_PADDING * 2 - box.width * zoom) / 2)
      const y = CANVAS_PADDING - box.y * zoom + Math.max(0, (rect.height - CANVAS_PADDING * 2 - box.height * zoom) / 2)
      setViewport({ x, y, zoom })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once when bounds first populate
  }, [bounds.width])

  if (loading) {
    return <div className="db-canvas-state"><Loader2 size={18} className="is-spinning" /><span>Loading schema graph…</span></div>
  }

  if (tables.length === 0) {
    return <div className="db-canvas-state db-canvas-empty"><span>This source has no tables yet.</span></div>
  }

  return (
    <div className="db-canvas-shell">
      <div className="db-canvas-toolbar">
        <button type="button" className="db-canvas-tool" onClick={() => zoomAround(-120, (viewportRef.current?.getBoundingClientRect().width ?? 0) / 2, (viewportRef.current?.getBoundingClientRect().height ?? 0) / 2, viewportRef.current!.getBoundingClientRect())} aria-label="Zoom in"><ZoomIn size={14} /></button>
        <button type="button" className="db-canvas-tool" onClick={() => zoomAround(120, (viewportRef.current?.getBoundingClientRect().width ?? 0) / 2, (viewportRef.current?.getBoundingClientRect().height ?? 0) / 2, viewportRef.current!.getBoundingClientRect())} aria-label="Zoom out"><ZoomOut size={14} /></button>
        <button type="button" className="db-canvas-tool" onClick={fitToView} aria-label="Fit to view"><Maximize2 size={14} /></button>
        {selection.size > 0 && <button type="button" className="db-canvas-tool" onClick={fitToSelection} aria-label="Fit to selection"><Crosshair size={14} /></button>}

        <div className="db-canvas-search">
          <SearchIcon size={13} aria-hidden />
          <input
            value={searchTerm}
            onChange={(event) => { setSearchTerm(event.target.value); setSearchOpen(true) }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={(event) => { if (event.key === 'Enter' && searchMatches[0]) goToTable(searchMatches[0].id) }}
            placeholder="Search tables…"
            aria-label="Search the diagram"
          />
          {searchTerm && <button type="button" onClick={() => setSearchTerm('')} aria-label="Clear search"><X size={12} /></button>}
          {searchOpen && searchMatches.length > 0 && (
            <ul className="db-canvas-search-results" role="listbox">
              {searchMatches.map((table) => (
                <li key={table.id}>
                  <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => goToTable(table.id)}>
                    {table.name}
                    <span>{table.groupLabel}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {groups.length > 1 && (
          <button type="button" className={`db-canvas-toggle ${groupingActive ? 'is-active' : ''}`} onClick={() => onGroupedChange(!grouped)} title="Collapse tables into their namespace at far zoom">
            {groupingActive ? 'Grouped' : 'Ungrouped'}
          </button>
        )}

        <button type="button" className={`db-canvas-toggle ${hideUnrelated ? 'is-active' : ''}`} disabled={selection.size === 0} onClick={() => onHideUnrelatedChange(!hideUnrelated)} title="Show only the selected table's relationship neighborhood">
          Focus
        </button>
        {hideUnrelated && (
          <div className="db-canvas-hop-stepper" role="group" aria-label="Focus hop distance">
            <button type="button" className={nHop === 1 ? 'is-active' : ''} onClick={() => onNHopChange(1)}>1-hop</button>
            <button type="button" className={nHop === 2 ? 'is-active' : ''} onClick={() => onNHopChange(2)}>2-hop</button>
          </div>
        )}

        <span className="db-canvas-lod-indicator">{lod}</span>
        {layoutPending && <span className="db-canvas-layout-pending"><Loader2 size={12} className="is-spinning" /> Laying out…</span>}
      </div>
      <div
        className="db-canvas-viewport"
        ref={viewportRef}
        role="application"
        aria-label="Schema diagram"
        onPointerDown={startPan}
        onWheel={onWheel}
      >
        <div className="db-canvas-world" style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}>
          <svg className="db-canvas-edges" width={Math.max(1, bounds.width)} height={Math.max(1, bounds.height)} aria-hidden>
            {resolveLod === 'far'
              ? groupEdges.map((edge) => {
                  const fromRect = groupRects.get(edge.from)
                  const toRect = groupRects.get(edge.to)
                  if (!fromRect || !toRect) return null
                  const path = buildEdgePath(fromRect, toRect, 0, 1)
                  return <path key={edge.id} d={path} fill="none" className={edge.highlighted ? 'is-highlighted' : ''} />
                })
              : visibleEdges.map((edge) => {
                  const fromRect = nodeRectsById.get(edge.from)
                  const toRect = nodeRectsById.get(edge.to)
                  if (!fromRect || !toRect) return null
                  const spread = edgeSpread.get(edge.id) ?? { index: 0, of: 1 }
                  const path = buildEdgePath(fromRect, toRect, spread.index, spread.of)
                  return <path key={edge.id} d={path} fill="none" className={highlightSet.has(edge.id) ? 'is-highlighted' : ''} />
                })}
          </svg>
          {descriptors.map((descriptor) => {
            if (descriptor.kind === 'domain-aggregate') {
              const group = groupsById.get(descriptor.id)
              if (!group) return null
              const position = positions[descriptor.id] ?? computeBoundingBox(nodeRects.filter((node) => node.groupId === descriptor.id))
              return <DomainAggregateNode key={descriptor.id} group={group} x={position.x} y={position.y} width={DOMAIN_NODE_WIDTH} selected={selection.has(descriptor.id)} onSelect={onSelect} />
            }
            const table = tablesById.get(descriptor.id)
            const position = positions[descriptor.id]
            if (!table || !position) return null
            const dimmed = neighborhood ? !neighborhood.has(descriptor.id) : false
            const nodeLod = lod === 'far' && !groupingActive ? 'compact' : lod === 'far' ? 'medium' : lod
            return (
              <div key={descriptor.id} className={dimmed ? 'db-canvas-node-dimmed' : ''}>
                <TableNode table={table} lod={nodeLod} x={position.x} y={position.y} width={NODE_WIDTH} selected={selection.has(descriptor.id)} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
