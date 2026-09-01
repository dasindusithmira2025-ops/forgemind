/**
 * Knowledge graph surface.
 *
 * Node placement lives in `memoryGraphLayout.ts` — this component owns interaction (curation,
 * focus, depth, overlays, edge filtering, labelling, pan and zoom) and nothing about where a node
 * sits.
 *
 * The governing rule is progressive exploration rather than "render everything". A project with
 * three hundred memories drawn at once is a picture with no information in it, so the default view
 * is a curated slice of the most connected, most important, most current knowledge, the full graph
 * is one explicit click away, and labels are spent on the nodes that carry the structure instead
 * of on every circle simultaneously. Selecting a node dims everything it is not connected to,
 * which is what turns a web into a neighbourhood.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Crosshair, Expand, Loader2, Maximize2, Minus, Plus, RotateCcw, Search } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { GRAPH_EDGE_KINDS } from '../memoryTypes'
import type { GraphEdge, GraphNode, GraphNodeKind } from '../memoryTypes'
import { curateGraph, graphBounds, layoutGraph, VIEW_SIZE } from '../memoryGraphLayout'

/** How many nodes the curated default draws before the full graph has to be asked for. */
const CURATED_NODES = 40

/** How many nodes carry a permanent label. Beyond this, a label appears on selection or match. */
const LABELLED_NODES = 18

/** Fit never zooms past this. A handful of nodes filling the canvas at 4x reads as a diagram of
 * four circles, not as a project's knowledge. */
const MAX_FIT_ZOOM = 2

function nodeClass(
  node: GraphNode,
  selectedId: string | undefined,
  dimmed: boolean,
  matched: boolean,
): string {
  const classes = ['memory-graph-node', `is-${node.kind}`]
  if (node.stale) classes.push('is-stale')
  if (node.quality) classes.push(`q-${node.quality}`)
  if (node.itemId && node.itemId === selectedId) classes.push('is-selected')
  if (dimmed) classes.push('is-dim')
  if (matched) classes.push('is-match')
  return classes.join(' ')
}

export function MemoryGraph() {
  const graph = useMemoryStore((state) => state.graph)
  const loading = useMemoryStore((state) => state.graphLoading)
  const controls = useMemoryStore((state) => state.graphControls)
  const setGraphControls = useMemoryStore((state) => state.setGraphControls)
  const refreshGraph = useMemoryStore((state) => state.refreshGraph)
  const activeId = useMemoryStore((state) => state.activeId)
  const open = useMemoryStore((state) => state.open)
  const health = useMemoryStore((state) => state.health)

  const [hiddenKinds, setHiddenKinds] = useState<string[]>([])
  const [showAll, setShowAll] = useState(false)
  const [highlight, setHighlight] = useState('')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // Curation happens before layout so the picture is laid out for what is drawn, not for a
  // hundred nodes most of which are not on screen.
  const drawn = useMemo(
    () => (graph ? (showAll ? graph : curateGraph(graph, CURATED_NODES)) : undefined),
    [graph, showAll],
  )
  const hiddenCount = (graph?.nodes.length ?? 0) - (drawn?.nodes.length ?? 0)

  const positioned = useMemo(() => (drawn ? layoutGraph(drawn) : []), [drawn])
  const byId = useMemo(
    () => new Map(positioned.map((node) => [node.id, node] as const)),
    [positioned],
  )

  const edges = useMemo(
    () =>
      (drawn?.edges ?? []).filter(
        (edge) =>
          !hiddenKinds.includes(edge.kind) && byId.has(edge.source) && byId.has(edge.target),
      ),
    [drawn, hiddenKinds, byId],
  )

  const selectedNodeId = useMemo(
    () => positioned.find((node) => node.itemId && node.itemId === activeId)?.id,
    [positioned, activeId],
  )

  /** The selected node and everything one edge away from it. Empty when nothing is selected. */
  const neighbourhood = useMemo(() => {
    if (!selectedNodeId) return null
    const near = new Set<string>([selectedNodeId])
    for (const edge of edges) {
      if (edge.source === selectedNodeId) near.add(edge.target)
      if (edge.target === selectedNodeId) near.add(edge.source)
    }
    return near
  }, [selectedNodeId, edges])

  const matches = useMemo(() => {
    const needle = highlight.trim().toLowerCase()
    if (!needle) return null
    return new Set(
      positioned
        .filter((node) => node.label.toLowerCase().includes(needle))
        .map((node) => node.id),
    )
  }, [highlight, positioned])

  /** Nodes that always carry a label: the structural ones plus anything currently in play. */
  const labelled = useMemo(() => {
    const ranked = [...positioned]
      .sort((left, right) => right.degree - left.degree || right.importance - left.importance)
      .slice(0, LABELLED_NODES)
    const keep = new Set(ranked.map((node) => node.id))
    if (neighbourhood) for (const id of neighbourhood) keep.add(id)
    if (matches) for (const id of matches) keep.add(id)
    return keep
  }, [positioned, neighbourhood, matches])

  const toggleKind = (kind: string) =>
    setHiddenKinds((current) =>
      current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind],
    )

  const toggleOverlay = (kind: GraphNodeKind) => {
    const next = controls.includeKinds.includes(kind)
      ? controls.includeKinds.filter((value) => value !== kind)
      : [...controls.includeKinds, kind]
    void setGraphControls({ includeKinds: next })
  }

  const selectNode = useCallback(
    (node: GraphNode) => {
      if (!node.itemId) return
      void open(node.itemId)
      void setGraphControls({ focusItemId: node.itemId })
    },
    [open, setGraphControls],
  )

  const resetView = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  /** Frame what is actually drawn rather than the fixed coordinate space it is drawn inside. */
  const fitView = useCallback(() => {
    const bounds = graphBounds(positioned)
    if (!bounds) return resetView()
    const padding = 70
    const next = Math.min(
      MAX_FIT_ZOOM,
      Math.max(0.25, VIEW_SIZE / Math.max(bounds.width + padding, bounds.height + padding)),
    )
    setZoom(next)
    setPan({
      x: VIEW_SIZE / 2 - (bounds.x + bounds.width / 2),
      y: VIEW_SIZE / 2 - (bounds.y + bounds.height / 2),
    })
  }, [positioned, resetView])

  // Frame the graph the first time each payload is drawn. Without this the first paint is a small
  // cluster in the middle of a large empty canvas and the user's first action is always a zoom.
  // Keyed on the payload and the curation choice, so panning and zooming afterwards is never
  // fought by a refit.
  const framed = useRef<{ graph: unknown; showAll: boolean }>(undefined)
  useEffect(() => {
    const key = { graph, showAll }
    if (!graph || positioned.length === 0) return
    const previous = framed.current
    if (previous && previous.graph === graph && previous.showAll === showAll) return
    framed.current = key
    fitView()
  }, [graph, showAll, positioned, fitView])

  return (
    <div className="memory-graph">
      <div className="memory-graph-bar">
        <div className="memory-graph-scope">
          <Button
            variant={controls.focusItemId ? 'secondary' : 'ghost'}
            icon={<Crosshair size={13} />}
            disabled={!activeId}
            onClick={() =>
              void setGraphControls({
                focusItemId: controls.focusItemId ? undefined : (activeId ?? undefined),
              })
            }
          >
            {controls.focusItemId ? 'Focused' : 'Whole project'}
          </Button>
          <label className="memory-graph-depth">
            <span>Depth</span>
            <select
              value={controls.depth}
              disabled={!controls.focusItemId}
              onChange={(event) => void setGraphControls({ depth: Number(event.target.value) })}
            >
              <option value={1}>1 hop</option>
              <option value={2}>2 hops</option>
              <option value={3}>3 hops</option>
            </select>
          </label>
          {controls.focusItemId && controls.depth < 3 && (
            <Button
              variant="ghost"
              icon={<Expand size={13} />}
              onClick={() => void setGraphControls({ depth: controls.depth + 1 })}
            >
              Expand
            </Button>
          )}
        </div>

        <label className="memory-graph-find">
          <Search size={12} aria-hidden />
          <input
            type="search"
            value={highlight}
            onChange={(event) => setHighlight(event.target.value)}
            placeholder="Highlight"
            aria-label="Highlight nodes by name"
            spellCheck={false}
          />
        </label>

        <div className="memory-graph-legend" role="group" aria-label="Edge kinds">
          {GRAPH_EDGE_KINDS.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              className={`memory-graph-chip is-${kind}${hiddenKinds.includes(kind) ? ' is-off' : ''}`}
              aria-pressed={!hiddenKinds.includes(kind)}
              onClick={() => toggleKind(kind)}
            >
              {label}
            </button>
          ))}
          <span className="memory-graph-divider" />
          {(['file', 'tag'] as GraphNodeKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`memory-graph-chip is-overlay${
                controls.includeKinds.includes(kind) ? '' : ' is-off'
              }`}
              aria-pressed={controls.includeKinds.includes(kind)}
              onClick={() => toggleOverlay(kind)}
            >
              {kind === 'file' ? 'Evidence nodes' : 'Tag nodes'}
            </button>
          ))}
        </div>

        <div className="memory-graph-zoom">
          <Button
            variant="ghost"
            icon={<Minus size={13} />}
            aria-label="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.25, value / 1.25))}
          />
          <Button
            variant="ghost"
            icon={<Plus size={13} />}
            aria-label="Zoom in"
            onClick={() => setZoom((value) => Math.min(4, value * 1.25))}
          />
          <Button variant="ghost" icon={<Maximize2 size={13} />} aria-label="Fit to content" onClick={fitView} />
          <Button variant="ghost" icon={<RotateCcw size={13} />} aria-label="Reset view" onClick={resetView} />
        </div>
      </div>

      <div
        className="memory-graph-canvas"
        onPointerDown={(event) => {
          drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
          // Capture keeps the pan alive when the pointer leaves the canvas. It is optional
          // because not every host implements it, and panning must not throw where it is absent.
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start) return
          setPan({
            x: start.panX + (event.clientX - start.x) / zoom,
            y: start.panY + (event.clientY - start.y) / zoom,
          })
        }}
        onPointerUp={() => {
          drag.current = null
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        {loading && (
          <div className="memory-graph-status" role="status">
            <Loader2 size={14} className="spin" /> Building graph…
          </div>
        )}

        {graph && graph.nodes.length === 0 && !loading ? (
          <p className="memory-graph-empty">
            No knowledge to draw yet. Memories appear here as soon as they exist; edges appear once
            they link to or relate to one another.
          </p>
        ) : (
          <svg
            className="memory-graph-svg"
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
            role="img"
            aria-label={`Knowledge graph, ${positioned.length} nodes and ${edges.length} edges`}
          >
            <g
              transform={`translate(${VIEW_SIZE / 2} ${VIEW_SIZE / 2}) scale(${zoom}) translate(${
                pan.x - VIEW_SIZE / 2
              } ${pan.y - VIEW_SIZE / 2})`}
            >
              {edges.map((edge) => {
                const from = byId.get(edge.source)
                const to = byId.get(edge.target)
                if (!from || !to) return null
                const dim = Boolean(
                  neighbourhood && edge.source !== selectedNodeId && edge.target !== selectedNodeId,
                )
                return (
                  <line
                    key={edge.id}
                    className={`memory-graph-edge is-${edge.kind}${dim ? ' is-dim' : ''}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    strokeOpacity={dim ? 0.08 : 0.25 + edge.confidence * 0.55}
                  >
                    <title>{edgeTitle(edge, from, to)}</title>
                  </line>
                )
              })}
              {positioned.map((node) => {
                const dim = Boolean(
                  (neighbourhood && !neighbourhood.has(node.id)) || (matches && !matches.has(node.id)),
                )
                return (
                  <g
                    key={node.id}
                    className={nodeClass(node, activeId, dim, Boolean(matches?.has(node.id)))}
                    role={node.itemId ? 'button' : undefined}
                    tabIndex={node.itemId ? 0 : undefined}
                    aria-label={`${node.label}${node.stale ? ', needs verification' : ''}`}
                    onClick={() => selectNode(node)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectNode(node)
                      }
                    }}
                  >
                    <circle cx={node.x} cy={node.y} r={node.r} />
                    {labelled.has(node.id) && (
                      <text
                        x={node.x}
                        y={node.y + node.r + 11 / zoom}
                        textAnchor="middle"
                        style={{ fontSize: 11 / zoom, strokeWidth: 3 / zoom }}
                      >
                        {node.label.length > 24 ? `${node.label.slice(0, 23)}…` : node.label}
                      </text>
                    )}
                    <title>
                      {node.label}
                      {node.sublabel ? ` — ${node.sublabel}` : ''}
                    </title>
                  </g>
                )
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="memory-graph-foot">
        {hiddenCount > 0 && (
          <button type="button" className="memory-graph-more" onClick={() => setShowAll(true)}>
            Showing the {positioned.length} most connected · draw all {graph?.nodes.length}
          </button>
        )}
        {showAll && (graph?.nodes.length ?? 0) > CURATED_NODES && (
          <button type="button" className="memory-graph-more" onClick={() => setShowAll(false)}>
            Back to the most connected
          </button>
        )}
        {graph?.truncated && (
          <span className="memory-graph-warn">
            Showing part of the graph. Focus a memory to see its full neighbourhood.
          </span>
        )}
        {health && (
          <span className="memory-graph-health">
            {health.total} memories · {health.stale} need verification · {health.brokenLinks}{' '}
            broken links · {health.orphans} unconnected
          </span>
        )}
        <Button variant="ghost" onClick={() => void refreshGraph()} disabled={loading}>
          Refresh
        </Button>
      </div>
    </div>
  )
}

function edgeTitle(edge: GraphEdge, from: GraphNode, to: GraphNode): string {
  const verb = edge.kind === 'relation' ? edge.label : edge.kind
  return `${from.label} — ${verb} → ${to.label}`
}
