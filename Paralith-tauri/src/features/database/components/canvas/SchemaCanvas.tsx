import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Loader2, Maximize2, Search as SearchIcon, ZoomIn, ZoomOut } from 'lucide-react'
import type { CanvasEdgeRef, CanvasNodeRect, DatabaseNamespaceGroupView, DatabaseTableNodeView } from '../../databaseTypes'
import { applyHideUnrelated, computeBoundingBox, computeVisibleNodeIds, highlightedEdges, nHopNodes, resolveRenderDescriptors } from './canvasSelectors'
import { useDatabaseCanvasStore } from './databaseCanvasStore'
import { DomainAggregateNode, TableNode } from './TableNode'

const OVERSCAN_PX = 200
const CANVAS_PADDING = 48

export interface SchemaCanvasProps {
  tables: DatabaseTableNodeView[]
  groups: DatabaseNamespaceGroupView[]
  edges: CanvasEdgeRef[]
  selection: Set<string>
  onSelect: (id: string, additive: boolean) => void
  hideUnrelated: boolean
  nHop: number
  loading: boolean
  layoutPending: boolean
}

/**
 * The DOM+SVG canvas engine (UI-SPEC.md §3.1). No graph-rendering library: nodes are absolutely
 * positioned DOM elements, edges are `<line>`s inside one SVG overlay, and both are viewport-culled
 * against `useDatabaseCanvasStore`'s already-computed positions. Layout itself is never called from
 * here — `DiagramSection` owns the `recomputeLayout` effect; this component only *reads*
 * `positions`/`bounds` from the store.
 */
export function SchemaCanvas({ tables, groups, edges, selection, onSelect, hideUnrelated, nHop, loading, layoutPending }: SchemaCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const viewport = useDatabaseCanvasStore((state) => state.viewport)
  const lod = useDatabaseCanvasStore((state) => state.lod)
  const positions = useDatabaseCanvasStore((state) => state.positions)
  const bounds = useDatabaseCanvasStore((state) => state.bounds)
  const setViewport = useDatabaseCanvasStore((state) => state.setViewport)
  const zoomAround = useDatabaseCanvasStore((state) => state.zoomAround)
  const fitToRect = useDatabaseCanvasStore((state) => state.fitToRect)

  const nodeRects: CanvasNodeRect[] = useMemo(
    () => tables.map((table) => {
      const position = positions[table.id] ?? { x: 0, y: 0 }
      return { id: table.id, x: position.x, y: position.y, w: 220, h: 140, groupId: table.groupId }
    }),
    [tables, positions],
  )

  const tablesById = useMemo(() => new Map(tables.map((table) => [table.id, table])), [tables])
  const groupsById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups])

  const containerSize = viewportRef.current?.getBoundingClientRect()
  const viewportWorldRect = {
    x: -viewport.x / viewport.zoom,
    y: -viewport.y / viewport.zoom,
    width: (containerSize?.width ?? 1200) / viewport.zoom,
    height: (containerSize?.height ?? 800) / viewport.zoom,
  }

  const rawVisibleIds = useMemo(
    () => computeVisibleNodeIds(nodeRects, viewportWorldRect, lod, OVERSCAN_PX),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- containerSize is a DOMRect read each render, intentionally not a dependency key
    [nodeRects, lod, viewport.x, viewport.y, viewport.zoom],
  )

  const visibleIds = useMemo(
    () => hideUnrelated ? applyHideUnrelated(rawVisibleIds, selection, edges, nHop) : rawVisibleIds,
    [rawVisibleIds, hideUnrelated, selection, edges, nHop],
  )

  const descriptors = useMemo(() => resolveRenderDescriptors(visibleIds, nodeRects, lod), [visibleIds, nodeRects, lod])
  const highlightSet = useMemo(() => new Set(highlightedEdges(selection, edges).map((edge) => edge.id)), [selection, edges])
  const neighborhood = useMemo(() => hideUnrelated || selection.size === 0 ? undefined : nHopNodes(selection, edges, nHop), [hideUnrelated, selection, edges, nHop])

  const visibleEdges = useMemo(() => {
    const visibleSet = new Set(visibleIds)
    return edges.filter((edge) => (visibleSet.has(edge.from) || visibleSet.has(edge.to) || highlightSet.has(edge.id)) && positions[edge.from] && positions[edge.to])
  }, [edges, visibleIds, highlightSet, positions])

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

  useEffect(() => {
    // Auto-fit once, the first time real layout bounds arrive, so the diagram never opens blank.
    if (bounds.width > 0 && viewport.x === 0 && viewport.y === 0 && viewport.zoom === 0.6) fitToView()
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
        {selection.size > 0 && <button type="button" className="db-canvas-tool" onClick={fitToSelection} aria-label="Fit to selection"><SearchIcon size={14} /></button>}
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
            {visibleEdges.map((edge) => {
              const from = positions[edge.from]
              const to = positions[edge.to]
              if (!from || !to) return null
              return (
                <line
                  key={edge.id}
                  x1={from.x + 110}
                  y1={from.y + 70}
                  x2={to.x + 110}
                  y2={to.y + 70}
                  className={highlightSet.has(edge.id) ? 'is-highlighted' : ''}
                />
              )
            })}
          </svg>
          {descriptors.map((descriptor) => {
            if (descriptor.kind === 'domain-aggregate') {
              const group = groupsById.get(descriptor.id)
              if (!group) return null
              const position = positions[descriptor.id] ?? computeBoundingBox(nodeRects.filter((node) => node.groupId === descriptor.id))
              return <DomainAggregateNode key={descriptor.id} group={group} x={position.x} y={position.y} width={200} selected={selection.has(descriptor.id)} onSelect={onSelect} />
            }
            const table = tablesById.get(descriptor.id)
            const position = positions[descriptor.id]
            if (!table || !position) return null
            const dimmed = neighborhood ? !neighborhood.has(descriptor.id) : false
            return (
              <div key={descriptor.id} className={dimmed ? 'db-canvas-node-dimmed' : ''}>
                <TableNode table={table} lod={lod === 'far' ? 'medium' : lod} x={position.x} y={position.y} width={220} selected={selection.has(descriptor.id)} onSelect={onSelect} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
