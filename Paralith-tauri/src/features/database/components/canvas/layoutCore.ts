import type { CanvasNodeRect } from '../../databaseTypes'

export interface LayoutNodeInput {
  id: string
  w: number
  h: number
  group: string
}

export interface LayoutEdgeInput {
  from: string
  to: string
}

export interface LayoutPreferences {
  /** Fixed positions that must be respected, keyed by node id — never moved by layout. */
  pinned?: Record<string, { x: number; y: number }>
  /** Horizontal gap between group columns. */
  groupGapX?: number
  /** Vertical gap between rows within a group. */
  rowGapY?: number
  /** Column gap within a group. */
  colGapX?: number
}

export interface LayoutResult {
  positions: Record<string, { x: number; y: number }>
  bounds: { width: number; height: number }
  computeMs: number
}

const smallestId = (ids: readonly string[]): string => ids.reduce((min, id) => (id < min ? id : min))

/**
 * Relationship-aware graph layout (UI-SPEC.md §3.1/§6). Within each namespace group, tables are
 * split into connected components by their FK edges, largest/most-connected clusters first. Each
 * multi-table cluster gets a layered (Sugiyama-style) placement: a BFS from its highest-degree
 * table assigns a layer per hop, and each layer is ordered by the barycenter of its parent layer
 * to reduce crossings — so directly-related tables land next to each other instead of wherever
 * alphabetical order happens to put them. Tables with no in-group relationship are tiled as a
 * compact grid after the clusters so lonely tables never interrupt a neighborhood's flow. Groups
 * are still placed left-to-right, same as before. Deterministic (no randomness, every ordering has
 * an id-based tie-break) and O(nodes + edges), well inside the B13 400ms/400-table budget.
 */
export function computeLayout(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], prefs: LayoutPreferences = {}): LayoutResult {
  const started = performance.now()
  const groupGapX = prefs.groupGapX ?? 96
  const rowGapY = prefs.rowGapY ?? 28
  const colGapX = prefs.colGapX ?? 32
  const clusterGapX = colGapX * 2
  const pinned = prefs.pinned ?? {}

  const groupOf = new Map(nodes.map((node) => [node.id, node.group]))
  const groups = new Map<string, LayoutNodeInput[]>()
  for (const node of nodes) {
    const list = groups.get(node.group) ?? []
    list.push(node)
    groups.set(node.group, list)
  }
  const sortedGroupIds = [...groups.keys()].sort((a, b) => a.localeCompare(b))

  // Bucket edges by the group they lay out within — a cross-group edge influences no group's
  // internal layout (it is still drawn; SchemaCanvas reads positions, not this bucketing).
  const edgesByGroup = new Map<string, LayoutEdgeInput[]>()
  for (const edge of edges) {
    const group = groupOf.get(edge.from)
    if (group && group === groupOf.get(edge.to) && edge.from !== edge.to) {
      const list = edgesByGroup.get(group) ?? []
      list.push(edge)
      edgesByGroup.set(group, list)
    }
  }

  const positions: Record<string, { x: number; y: number }> = {}
  let cursorX = 0
  let maxHeight = 0

  for (const groupId of sortedGroupIds) {
    const members = [...(groups.get(groupId) ?? [])].sort((a, b) => a.id.localeCompare(b.id))
    const byId = new Map(members.map((member) => [member.id, member]))

    const adjacency = new Map<string, Set<string>>()
    for (const member of members) adjacency.set(member.id, new Set())
    for (const edge of edgesByGroup.get(groupId) ?? []) {
      adjacency.get(edge.from)?.add(edge.to)
      adjacency.get(edge.to)?.add(edge.from)
    }

    const visited = new Set<string>()
    const clusters: string[][] = []
    const singletons: string[] = []
    for (const member of members) {
      if (visited.has(member.id)) continue
      if ((adjacency.get(member.id)?.size ?? 0) === 0) {
        visited.add(member.id)
        singletons.push(member.id)
        continue
      }
      const component: string[] = []
      const queue = [member.id]
      visited.add(member.id)
      while (queue.length > 0) {
        const current = queue.shift() as string
        component.push(current)
        for (const next of adjacency.get(current) ?? []) {
          if (!visited.has(next)) { visited.add(next); queue.push(next) }
        }
      }
      clusters.push(component)
    }
    // Largest, most-connected neighborhoods lead; ties broken by lowest member id for determinism.
    clusters.sort((a, b) => b.length - a.length || smallestId(a).localeCompare(smallestId(b)))

    let memberCursorX = cursorX
    let groupHeight = 0
    let firstUnit = true

    for (const clusterIds of clusters) {
      if (!firstUnit) memberCursorX += clusterGapX
      firstUnit = false

      let root = clusterIds[0]
      let rootDegree = -1
      for (const id of clusterIds) {
        const degree = adjacency.get(id)?.size ?? 0
        if (degree > rootDegree || (degree === rootDegree && id < root)) { root = id; rootDegree = degree }
      }

      const layerOf = new Map<string, number>([[root, 0]])
      const queue = [root]
      while (queue.length > 0) {
        const current = queue.shift() as string
        const depth = layerOf.get(current) as number
        for (const next of adjacency.get(current) ?? []) {
          if (!layerOf.has(next)) { layerOf.set(next, depth + 1); queue.push(next) }
        }
      }
      const maxLayer = Math.max(0, ...clusterIds.map((id) => layerOf.get(id) ?? 0))
      const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => [])
      for (const id of clusterIds) layers[layerOf.get(id) ?? 0].push(id)

      layers[0].sort((a, b) => (adjacency.get(b)?.size ?? 0) - (adjacency.get(a)?.size ?? 0) || a.localeCompare(b))
      for (let li = 1; li < layers.length; li += 1) {
        const prevIndex = new Map(layers[li - 1].map((id, index) => [id, index]))
        const barycenter = (id: string): number => {
          const parents = [...(adjacency.get(id) ?? [])].filter((neighbor) => prevIndex.has(neighbor))
          if (parents.length === 0) return Number.MAX_SAFE_INTEGER
          return parents.reduce((sum, neighbor) => sum + (prevIndex.get(neighbor) ?? 0), 0) / parents.length
        }
        layers[li].sort((a, b) => barycenter(a) - barycenter(b) || a.localeCompare(b))
      }

      let layerX = memberCursorX
      let clusterHeight = 0
      for (const layer of layers) {
        const layerWidth = Math.max(0, ...layer.map((id) => byId.get(id)?.w ?? 0))
        let layerY = 0
        for (const id of layer) {
          const member = byId.get(id)
          if (!member) continue
          positions[id] = { x: layerX, y: layerY }
          layerY += member.h + rowGapY
        }
        clusterHeight = Math.max(clusterHeight, layerY - rowGapY)
        layerX += layerWidth + colGapX
      }
      memberCursorX = layerX - colGapX
      groupHeight = Math.max(groupHeight, clusterHeight)
    }

    if (singletons.length > 0) {
      if (!firstUnit) memberCursorX += clusterGapX
      const columnCount = Math.max(1, Math.ceil(Math.sqrt(singletons.length)))
      const colWidths = new Array<number>(columnCount).fill(0)
      for (let index = 0; index < singletons.length; index += 1) {
        const col = index % columnCount
        colWidths[col] = Math.max(colWidths[col], byId.get(singletons[index])?.w ?? 0)
      }
      const colOffsets: number[] = []
      let runningX = memberCursorX
      for (const width of colWidths) { colOffsets.push(runningX); runningX += width + colGapX }
      const rowHeights = new Map<number, number>()
      for (let index = 0; index < singletons.length; index += 1) {
        const row = Math.floor(index / columnCount)
        rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, byId.get(singletons[index])?.h ?? 0))
      }
      const rowOffsets = new Map<number, number>()
      let runningY = 0
      for (const row of [...rowHeights.keys()].sort((a, b) => a - b)) { rowOffsets.set(row, runningY); runningY += (rowHeights.get(row) ?? 0) + rowGapY }
      for (let index = 0; index < singletons.length; index += 1) {
        const row = Math.floor(index / columnCount)
        const col = index % columnCount
        positions[singletons[index]] = { x: colOffsets[col], y: rowOffsets.get(row) ?? 0 }
      }
      memberCursorX = runningX - colGapX
      groupHeight = Math.max(groupHeight, runningY - rowGapY)
    }

    for (const [id, position] of Object.entries(pinned)) {
      if (byId.has(id)) positions[id] = position
    }

    maxHeight = Math.max(maxHeight, groupHeight)
    cursorX = memberCursorX + groupGapX
  }

  const computeMs = performance.now() - started
  return { positions, bounds: { width: Math.max(0, cursorX - groupGapX), height: maxHeight }, computeMs }
}

/** Convert a layout result's positions into `CanvasNodeRect[]` for the selector layer. */
export function toCanvasNodeRects(nodes: LayoutNodeInput[], result: LayoutResult): CanvasNodeRect[] {
  return nodes.map((node) => {
    const position = result.positions[node.id] ?? { x: 0, y: 0 }
    return { id: node.id, x: position.x, y: position.y, w: node.w, h: node.h, groupId: node.group }
  })
}
