/**
 * Knowledge-graph layout.
 *
 * ## Why the layout is deterministic rather than a force simulation
 *
 * A local graph already carries the only spatial fact that means anything here: hop distance from
 * the focus. Rendering that as concentric rings makes the picture *readable* — the ring a memory
 * sits in tells you how far it is from what you asked about — and it is O(n), stable between
 * renders, and free of the settling jitter that makes force layouts feel unreliable. A physics
 * simulation would replace a meaningful axis with an arbitrary one.
 *
 * ponytail: no force relaxation, so a dense ring can produce crossing edges. The upgrade path is
 * a bounded relaxation pass over the ring angles only (keeping the radius, which carries the
 * meaning), if crossings ever measurably hurt readability.
 *
 * Positions are a pure function of the payload, so no layout state can drift from the data.
 */
import type { GraphNode, KnowledgeGraph } from './memoryTypes'

/** Radius of one hop ring, in view units. */
const RING_GAP = 150

/** Node radius floor and ceiling; importance scales between them. */
const RADIUS_MIN = 7
const RADIUS_MAX = 16

/** Side of the square SVG coordinate space every position is expressed in. */
export const VIEW_SIZE = 900

export interface PositionedNode extends GraphNode {
  x: number
  y: number
  r: number
}

/**
 * Place every node.
 *
 * With a focus, nodes ring outwards by hop distance. Without one, nodes spiral outwards by degree
 * so the best-connected knowledge sits near the middle. Ordering inside a ring is by id, which is
 * stable across refetches — a node must not jump because an unrelated memory was edited.
 */
export function layoutGraph(graph: KnowledgeGraph): PositionedNode[] {
  const centre = VIEW_SIZE / 2
  const maxImportance = Math.max(1, ...graph.nodes.map((node) => node.importance))
  const radiusFor = (node: GraphNode) =>
    node.kind === 'memory'
      ? RADIUS_MIN + (RADIUS_MAX - RADIUS_MIN) * Math.min(1, node.importance / maxImportance)
      : RADIUS_MIN - 1

  if (graph.focusId) {
    const rings = new Map<number, GraphNode[]>()
    for (const node of graph.nodes) {
      // A node with no distance (an evidence or tag overlay node) sits one ring beyond the
      // deepest memory rather than collapsing onto the centre.
      const ring = node.distance ?? -1
      const existing = rings.get(ring)
      if (existing) existing.push(node)
      else rings.set(ring, [node])
    }
    const deepest = Math.max(0, ...[...rings.keys()].filter((ring) => ring >= 0))
    const placed: PositionedNode[] = []
    for (const [ring, nodes] of rings) {
      const effective = ring < 0 ? deepest + 1 : ring
      const ordered = [...nodes].sort((left, right) => left.id.localeCompare(right.id))
      if (effective === 0 && ordered.length === 1) {
        placed.push({ ...ordered[0], x: centre, y: centre, r: radiusFor(ordered[0]) })
        continue
      }
      const radius = Math.max(effective, 1) * RING_GAP
      ordered.forEach((node, index) => {
        // Offset each ring by half a step so nodes do not line up radially with the ring inside.
        const angle = ((index + (effective % 2) * 0.5) / ordered.length) * Math.PI * 2
        placed.push({
          ...node,
          x: centre + Math.cos(angle) * radius,
          y: centre + Math.sin(angle) * radius,
          r: radiusFor(node),
        })
      })
    }
    return placed
  }

  const ordered = [...graph.nodes].sort(
    (left, right) => right.degree - left.degree || left.id.localeCompare(right.id),
  )
  // Golden-angle spiral: even density, no arbitrary ring boundaries, and no two nodes land on the
  // same spoke however many there are.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  return ordered.map((node, index) => {
    const radius = Math.sqrt(index + 0.5) * 34
    const angle = index * goldenAngle
    return {
      ...node,
      x: centre + Math.cos(angle) * radius,
      y: centre + Math.sin(angle) * radius,
      r: radiusFor(node),
    }
  })
}

/**
 * Reduce a graph to the slice worth drawing first.
 *
 * The backend returns everything that matches the request, which for a mature project is hundreds
 * of nodes — a picture with every label on it is a picture with no information in it. Prominence
 * here uses only properties the backend already computed: how connected a node is, how important
 * the project considers it, and whether it is current. Nothing is invented and nothing is
 * permanently hidden; the caller offers the full graph as an explicit choice.
 *
 * The focus node, when there is one, is always kept: a focused view that dropped its own subject
 * would be nonsense.
 */
export function curateGraph(graph: KnowledgeGraph, limit: number): KnowledgeGraph {
  if (graph.nodes.length <= limit) return graph
  const ranked = [...graph.nodes].sort(
    (left, right) => nodeWeight(right) - nodeWeight(left) || left.id.localeCompare(right.id),
  )
  const kept = new Set<string>()
  if (graph.focusId) kept.add(graph.focusId)
  for (const node of ranked) {
    if (kept.size >= limit) break
    kept.add(node.id)
  }
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) => kept.has(edge.source) && kept.has(edge.target)),
    truncated: true,
  }
}

/** How much of the picture one node earns. Memory outranks overlays; connection outranks size. */
function nodeWeight(node: GraphNode): number {
  const kindWeight = node.kind === 'memory' ? 6 : 0
  const qualityWeight =
    node.quality === 'canonical' ? 4 : node.quality === 'verified' ? 3 : node.quality === 'superseded' ? -4 : 0
  // A focused graph carries hop distance, and a nearer node is more relevant to what was asked.
  const distancePenalty = node.distance == null ? 0 : node.distance * 2
  return kindWeight + node.degree * 2 + node.importance * 3 + qualityWeight - distancePenalty
}

/**
 * Bounding box of a laid-out graph, so a "fit" control can frame real content rather than the
 * fixed coordinate space most of which is usually empty.
 */
export function graphBounds(nodes: PositionedNode[]): {
  x: number
  y: number
  width: number
  height: number
} | null {
  if (nodes.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.r)
    minY = Math.min(minY, node.y - node.r)
    maxX = Math.max(maxX, node.x + node.r)
    maxY = Math.max(maxY, node.y + node.r)
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) }
}
