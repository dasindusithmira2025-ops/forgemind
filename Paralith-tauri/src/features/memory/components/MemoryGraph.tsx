/**
 * Knowledge graph surface.
 *
 * Node placement lives in `memoryGraphLayout.ts` — this component owns interaction (focus, depth,
 * overlays, edge filtering, pan and zoom) and nothing about where a node sits.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { Crosshair, Loader2, Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { useMemoryStore } from '../memoryStore'
import { GRAPH_EDGE_KINDS } from '../memoryTypes'
import type { GraphEdge, GraphNode, GraphNodeKind } from '../memoryTypes'
import { layoutGraph, VIEW_SIZE } from '../memoryGraphLayout'

function nodeClass(node: GraphNode, selectedId?: string): string {
  const classes = ['memory-graph-node', `is-${node.kind}`]
  if (node.stale) classes.push('is-stale')
  if (node.quality) classes.push(`q-${node.quality}`)
  if (node.itemId && node.itemId === selectedId) classes.push('is-selected')
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
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  const positioned = useMemo(() => (graph ? layoutGraph(graph) : []), [graph])
  const byId = useMemo(
    () => new Map(positioned.map((node) => [node.id, node] as const)),
    [positioned],
  )

  const edges = useMemo(
    () =>
      (graph?.edges ?? []).filter(
        (edge) =>
          !hiddenKinds.includes(edge.kind) && byId.has(edge.source) && byId.has(edge.target),
      ),
    [graph, hiddenKinds, byId],
  )

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

  const resetView = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

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
        </div>

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
                return (
                  <line
                    key={edge.id}
                    className={`memory-graph-edge is-${edge.kind}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    strokeOpacity={0.25 + edge.confidence * 0.55}
                  >
                    <title>{edgeTitle(edge, from, to)}</title>
                  </line>
                )
              })}
              {positioned.map((node) => (
                <g
                  key={node.id}
                  className={nodeClass(node, activeId)}
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
                  <text x={node.x} y={node.y + node.r + 12} textAnchor="middle">
                    {node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}
                  </text>
                  <title>
                    {node.label}
                    {node.sublabel ? ` — ${node.sublabel}` : ''}
                  </title>
                </g>
              ))}
            </g>
          </svg>
        )}
      </div>

      <div className="memory-graph-foot">
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
