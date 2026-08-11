import type { CanvasEdgeRef, CanvasNodeRect, CanvasRenderDescriptor, DatabaseSemanticLod, SemanticId } from '../../databaseTypes'

/** World-space axis-aligned rectangle. */
export interface WorldRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Semantic LOD from world zoom scale. Boundaries are inclusive on the lower bound, matching
 * UI-SPEC.md §3.1/§3.7: far `< 0.35`, medium `0.35 <= z < 0.85`, near `>= 0.85`.
 */
export function computeLod(zoom: number): DatabaseSemanticLod {
  if (zoom < 0.35) return 'far'
  if (zoom < 0.85) return 'medium'
  return 'near'
}

function intersects(a: WorldRect, b: WorldRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function expand(rect: WorldRect, overscan: number): WorldRect {
  return { x: rect.x - overscan, y: rect.y - overscan, width: rect.width + overscan * 2, height: rect.height + overscan * 2 }
}

/** One group's aggregate bounding rect, used only at LOD0 for viewport intersection. */
function groupBounds(nodes: CanvasNodeRect[]): Map<string, WorldRect> {
  const bounds = new Map<string, WorldRect>()
  for (const node of nodes) {
    const existing = bounds.get(node.groupId)
    if (!existing) { bounds.set(node.groupId, { x: node.x, y: node.y, width: node.w, height: node.h }); continue }
    const minX = Math.min(existing.x, node.x)
    const minY = Math.min(existing.y, node.y)
    const maxX = Math.max(existing.x + existing.width, node.x + node.w)
    const maxY = Math.max(existing.y + existing.height, node.y + node.h)
    bounds.set(node.groupId, { x: minX, y: minY, width: maxX - minX, height: maxY - minY })
  }
  return bounds
}

/**
 * The primary bounding mechanism (UI-SPEC.md §3.1/§3.8 mechanism 1+2): viewport-cull nodes, and at
 * LOD0 collapse each group to one aggregate id instead of mounting its member table cards — the
 * mounted count becomes group count, not table count, however many tables exist per group.
 */
export function computeVisibleNodeIds(nodes: CanvasNodeRect[], viewport: WorldRect, lod: DatabaseSemanticLod, overscanPx: number): SemanticId[] {
  const expanded = expand(viewport, overscanPx)
  if (lod === 'far') {
    const bounds = groupBounds(nodes)
    const visible: SemanticId[] = []
    for (const [groupId, rect] of bounds) if (intersects(rect, expanded)) visible.push(groupId)
    return visible
  }
  return nodes.filter((node) => intersects({ x: node.x, y: node.y, width: node.w, height: node.h }, expanded)).map((node) => node.id)
}

/** What `TableNode`'s parent resolves a visible id to before mounting anything. */
export function resolveRenderDescriptors(ids: SemanticId[], nodes: CanvasNodeRect[], lod: DatabaseSemanticLod): CanvasRenderDescriptor[] {
  if (lod === 'far') {
    const groupIds = new Set(nodes.map((node) => node.groupId))
    return ids.filter((id) => groupIds.has(id)).map((id) => ({ id, kind: 'domain-aggregate', groupId: id }))
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  return ids.map((id) => ({ id, kind: 'table-card', groupId: byId.get(id)?.groupId ?? '' }))
}

/** BFS from a selection set out to `hops` steps over the loaded edge list. Hop 0 = the selection itself. */
export function nHopNodes(selection: ReadonlySet<SemanticId>, edges: CanvasEdgeRef[], hops: number): Set<SemanticId> {
  const visited = new Set(selection)
  let frontier = new Set(selection)
  for (let step = 0; step < hops; step += 1) {
    const next = new Set<SemanticId>()
    for (const edge of edges) {
      if (frontier.has(edge.from) && !visited.has(edge.to)) next.add(edge.to)
      if (frontier.has(edge.to) && !visited.has(edge.from)) next.add(edge.from)
    }
    if (next.size === 0) break
    for (const id of next) visited.add(id)
    frontier = next
  }
  return visited
}

/** Any edge touching a selected node — for relationship highlighting. */
export function highlightedEdges(selection: ReadonlySet<SemanticId>, edges: CanvasEdgeRef[]): CanvasEdgeRef[] {
  return edges.filter((edge) => selection.has(edge.from) || selection.has(edge.to))
}

/**
 * The third bounding mechanism (§3.8 mechanism 3): when `hideUnrelated` is on, intersect
 * viewport-culled ids with the selection's N-hop neighborhood instead of all loaded nodes.
 */
export function applyHideUnrelated(visibleIds: SemanticId[], selection: ReadonlySet<SemanticId>, edges: CanvasEdgeRef[], hops: number): SemanticId[] {
  if (selection.size === 0) return visibleIds
  const neighborhood = nHopNodes(selection, edges, hops)
  return visibleIds.filter((id) => neighborhood.has(id))
}

/** Bounding box of a node set, for fit-to-view / fit-to-selection. */
export function computeBoundingBox(nodes: CanvasNodeRect[]): WorldRect {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    minX = Math.min(minX, node.x)
    minY = Math.min(minY, node.y)
    maxX = Math.max(maxX, node.x + node.w)
    maxY = Math.max(maxY, node.y + node.h)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Zoom level that frames `bounds` inside a `viewportW x viewportH` screen area with padding. */
export function computeFitZoom(bounds: WorldRect, viewportW: number, viewportH: number, paddingPx: number): number {
  if (bounds.width <= 0 || bounds.height <= 0) return 1
  const availableW = Math.max(1, viewportW - paddingPx * 2)
  const availableH = Math.max(1, viewportH - paddingPx * 2)
  return Math.min(availableW / bounds.width, availableH / bounds.height)
}
