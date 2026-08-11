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

/**
 * Deterministic layout: group tables by `group` (namespace), lay each group out as a grid, and
 * place groups left-to-right in a stable (sorted-by-group-id) order. Deliberately not a physics
 * simulation — a grid is O(n), trivially deterministic for the same input (required for the
 * "only recompute new objects" pinned-position rule, UI-SPEC.md §3.1), and fast enough that a
 * 400-node/~600-edge schema stays comfortably under the B13 400ms budget. Edges only influence
 * grouping upstream (server-provided `namespaceId`), not node placement, so this function does not
 * need to read `edges` for positioning — it is accepted for API stability and future edge-aware
 * layout without another off-render-path plumbing change.
 */
export function computeLayout(nodes: LayoutNodeInput[], _edges: LayoutEdgeInput[], prefs: LayoutPreferences = {}): LayoutResult {
  const started = performance.now()
  const groupGapX = prefs.groupGapX ?? 80
  const rowGapY = prefs.rowGapY ?? 24
  const colGapX = prefs.colGapX ?? 24
  const pinned = prefs.pinned ?? {}

  const groups = new Map<string, LayoutNodeInput[]>()
  for (const node of nodes) {
    const list = groups.get(node.group) ?? []
    list.push(node)
    groups.set(node.group, list)
  }
  const sortedGroupIds = [...groups.keys()].sort((a, b) => a.localeCompare(b))

  const positions: Record<string, { x: number; y: number }> = {}
  let cursorX = 0
  let maxHeight = 0

  for (const groupId of sortedGroupIds) {
    const members = [...(groups.get(groupId) ?? [])].sort((a, b) => a.id.localeCompare(b.id))
    const columnCount = Math.max(1, Math.ceil(Math.sqrt(members.length)))
    const columnWidths = new Array<number>(columnCount).fill(0)
    for (let index = 0; index < members.length; index += 1) {
      const col = index % columnCount
      columnWidths[col] = Math.max(columnWidths[col], members[index].w)
    }
    const columnOffsets: number[] = []
    let runningX = cursorX
    for (const width of columnWidths) { columnOffsets.push(runningX); runningX += width + colGapX }

    const rowHeights = new Map<number, number>()
    for (let index = 0; index < members.length; index += 1) {
      const row = Math.floor(index / columnCount)
      rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, members[index].h))
    }
    const rowOffsets = new Map<number, number>()
    let runningY = 0
    const sortedRows = [...rowHeights.keys()].sort((a, b) => a - b)
    for (const row of sortedRows) { rowOffsets.set(row, runningY); runningY += (rowHeights.get(row) ?? 0) + rowGapY }

    for (let index = 0; index < members.length; index += 1) {
      const node = members[index]
      const row = Math.floor(index / columnCount)
      const col = index % columnCount
      if (pinned[node.id]) { positions[node.id] = pinned[node.id]; continue }
      positions[node.id] = { x: columnOffsets[col], y: rowOffsets.get(row) ?? 0 }
    }

    const groupWidth = columnOffsets.length > 0 ? (columnOffsets.at(-1) ?? 0) + columnWidths.at(-1)! - cursorX : 0
    const groupHeight = runningY - rowGapY
    maxHeight = Math.max(maxHeight, groupHeight)
    cursorX += groupWidth + groupGapX
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
