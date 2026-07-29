import { CANVAS_CONSTANTS } from './canvasConstants'
import { calculateDockedRects, normalizeSplitSizes } from './geometryEngine'
import {
  CanvasError,
  type CanvasBounds,
  type CanvasSnapZone,
  type DockDropTarget,
  type DockZone,
  type DockedLayoutNode,
  type NormalizedRect,
  type PaneDragSession,
  type SplitDirection,
  type WorkspaceCanvasLayout,
} from './canvasTypes'

/**
 * Pure transformations over the docked split tree and the whole {@link WorkspaceCanvasLayout}.
 * Every function returns a fresh structure; inputs are never mutated. These are the primitives
 * that drop-commit and keyboard actions compose into one atomic layout change.
 */

export function dockedPaneIds(node: DockedLayoutNode | null): string[] {
  if (!node) return []
  return node.type === 'pane' ? [node.paneId] : node.children.flatMap(dockedPaneIds)
}

export function allPaneIds(layout: WorkspaceCanvasLayout): string[] {
  return [...dockedPaneIds(layout.dockedRoot), ...layout.floatingPanes.map((pane) => pane.paneId)]
}

/** Path of child indices from the docked root to `paneId`, or undefined if not docked. */
export function findDockPath(node: DockedLayoutNode | null, paneId: string): number[] | undefined {
  if (!node) return undefined
  if (node.type === 'pane') return node.paneId === paneId ? [] : undefined
  for (let index = 0; index < node.children.length; index += 1) {
    const inner = findDockPath(node.children[index], paneId)
    if (inner) return [index, ...inner]
  }
  return undefined
}

/** Remove a pane from the docked tree, collapsing single-child splits. Returns null if empty. */
export function removePaneFromDockedTree(
  node: DockedLayoutNode | null,
  paneId: string,
): DockedLayoutNode | null {
  if (!node) return null
  if (node.type === 'pane') return node.paneId === paneId ? null : node

  const kept: Array<{ child: DockedLayoutNode; size: number }> = []
  node.children.forEach((child, index) => {
    const result = removePaneFromDockedTree(child, paneId)
    if (result) kept.push({ child: result, size: node.sizes[index] ?? 100 / node.children.length })
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].child
  return {
    type: 'split',
    direction: node.direction,
    sizes: normalizeSplitSizes(kept.map((entry) => entry.size), kept.length),
    children: kept.map((entry) => entry.child),
  }
}

/**
 * Insert `newPaneId` beside `targetPaneId`. left/right create (or reuse) a vertical column
 * split; top/bottom a horizontal row split. When the target already sits in a same-direction
 * split the new pane is spliced in beside it; otherwise the target pane is wrapped in a new
 * two-child split. `center` is not a valid insertion zone (it means swap).
 */
export function insertPaneBesideTarget(
  root: DockedLayoutNode,
  targetPaneId: string,
  newPaneId: string,
  zone: Exclude<DockZone, 'center'>,
): DockedLayoutNode {
  const direction: SplitDirection = zone === 'left' || zone === 'right' ? 'vertical' : 'horizontal'
  const before = zone === 'left' || zone === 'top'
  const newPane: DockedLayoutNode = { type: 'pane', paneId: newPaneId }

  const wrap = (target: DockedLayoutNode): DockedLayoutNode => ({
    type: 'split',
    direction,
    sizes: [50, 50],
    children: before ? [newPane, target] : [target, newPane],
  })

  const insert = (node: DockedLayoutNode): DockedLayoutNode | undefined => {
    if (node.type === 'pane') return node.paneId === targetPaneId ? wrap(node) : undefined

    const directIndex = node.children.findIndex(
      (child) => child.type === 'pane' && child.paneId === targetPaneId,
    )
    if (directIndex >= 0 && node.direction === direction) {
      // Splice the new pane in beside its sibling and give it the row's average share, pushing the
      // existing panes down proportionally (renormalised to 100). Starting from an equal row this
      // yields an equal row of N+1, so a reorder within a same-direction split stays balanced
      // instead of squeezing the drop target to half — which would otherwise trip the min-size
      // rejection in a crowded row that a balanced layout still fits.
      const sizes = normalizeSplitSizes(node.sizes, node.children.length)
      const averageShare = 100 / node.children.length
      const children = [...node.children]
      const nextSizes = [...sizes]
      const insertAt = before ? directIndex : directIndex + 1
      children.splice(insertAt, 0, newPane)
      nextSizes.splice(insertAt, 0, averageShare)
      return { type: 'split', direction: node.direction, sizes: normalizeSplitSizes(nextSizes, children.length), children }
    }

    for (let index = 0; index < node.children.length; index += 1) {
      const result = insert(node.children[index])
      if (result) {
        const children = [...node.children]
        children[index] = result
        return { type: 'split', direction: node.direction, sizes: node.sizes, children }
      }
    }
    return undefined
  }

  const next = insert(root)
  if (!next) throw new CanvasError('missing_pane', `Dock target pane "${targetPaneId}" was not found.`)
  return next
}

/** Return the split node at `path`, or undefined if the path does not resolve to a split. */
export function getSplitAtPath(root: DockedLayoutNode | null, path: number[]): Extract<DockedLayoutNode, { type: 'split' }> | undefined {
  let node = root
  for (const index of path) {
    if (!node || node.type !== 'split' || index < 0 || index >= node.children.length) return undefined
    node = node.children[index]
  }
  return node && node.type === 'split' ? node : undefined
}

/** Immutably replace the `sizes` array of the split node at `path`. */
export function setSizesAtPath(root: DockedLayoutNode, path: number[], sizes: number[]): DockedLayoutNode {
  if (path.length === 0) {
    return root.type === 'split' ? { ...root, sizes } : root
  }
  if (root.type !== 'split') return root
  const [head, ...tail] = path
  return {
    ...root,
    children: root.children.map((child, index) => (index === head ? setSizesAtPath(child, tail, sizes) : child)),
  }
}

/** Swap two pane ids in place within the docked tree. Geometry stays put; contents swap. */
export function swapPaneLocations(node: DockedLayoutNode, a: string, b: string): DockedLayoutNode {
  if (node.type === 'pane') {
    if (node.paneId === a) return { type: 'pane', paneId: b }
    if (node.paneId === b) return { type: 'pane', paneId: a }
    return node
  }
  return { type: 'split', direction: node.direction, sizes: node.sizes, children: node.children.map((child) => swapPaneLocations(child, a, b)) }
}

/** Flatten same-direction nested splits and drop single-child splits. */
export function collapseRedundantSplits(node: DockedLayoutNode): DockedLayoutNode {
  if (node.type === 'pane') return node
  const children = node.children.map(collapseRedundantSplits)
  const sizes = normalizeSplitSizes(node.sizes, children.length)

  const flatChildren: DockedLayoutNode[] = []
  const flatSizes: number[] = []
  children.forEach((child, index) => {
    const share = sizes[index]
    if (child.type === 'split' && child.direction === node.direction) {
      const inner = normalizeSplitSizes(child.sizes, child.children.length)
      child.children.forEach((grandChild, grandIndex) => {
        flatChildren.push(grandChild)
        flatSizes.push((share * inner[grandIndex]) / 100)
      })
    } else {
      flatChildren.push(child)
      flatSizes.push(share)
    }
  })

  if (flatChildren.length === 1) return flatChildren[0]
  return { type: 'split', direction: node.direction, sizes: normalizeSplitSizes(flatSizes, flatChildren.length), children: flatChildren }
}

/** Collapse redundancy and normalise every split's sizes. Safe on null. */
export function normalizeSplitTree(node: DockedLayoutNode | null): DockedLayoutNode | null {
  return node ? collapseRedundantSplits(node) : null
}

/** Move a docked pane out into the floating layer at `rect` (canvas-normalised). */
export function floatPane(
  layout: WorkspaceCanvasLayout,
  paneId: string,
  rect: NormalizedRect,
  now: string,
): WorkspaceCanvasLayout {
  const previousDockPath = findDockPath(layout.dockedRoot, paneId)
  const dockedRoot = normalizeSplitTree(removePaneFromDockedTree(layout.dockedRoot, paneId))
  const zIndex = layout.nextFloatingZIndex
  const floatingPanes = [
    ...layout.floatingPanes.filter((pane) => pane.paneId !== paneId),
    { paneId, rect, zIndex, previousDockPath, createdAt: now, updatedAt: now },
  ]
  return {
    ...layout,
    dockedRoot,
    floatingPanes,
    activePaneId: paneId,
    nextFloatingZIndex: zIndex + 1,
  }
}

/** Return a floating pane to the docked layer, beside a target pane or as the sole root. */
export function dockFloatingPane(
  layout: WorkspaceCanvasLayout,
  paneId: string,
  target: { targetPaneId: string; zone: Exclude<DockZone, 'center'> } | undefined,
): WorkspaceCanvasLayout {
  if (!layout.floatingPanes.some((pane) => pane.paneId === paneId)) {
    throw new CanvasError('missing_pane', `Floating pane "${paneId}" was not found.`)
  }
  const floatingPanes = layout.floatingPanes.filter((pane) => pane.paneId !== paneId)
  let dockedRoot: DockedLayoutNode | null
  if (!layout.dockedRoot) {
    dockedRoot = { type: 'pane', paneId }
  } else if (target) {
    dockedRoot = insertPaneBesideTarget(layout.dockedRoot, target.targetPaneId, paneId, target.zone)
  } else {
    // No target: append beside the first docked pane so the pane never vanishes.
    const anchor = dockedPaneIds(layout.dockedRoot)[0]
    dockedRoot = insertPaneBesideTarget(layout.dockedRoot, anchor, paneId, 'right')
  }
  return { ...layout, dockedRoot: normalizeSplitTree(dockedRoot), floatingPanes, activePaneId: paneId }
}

/**
 * Swap the placements of two panes regardless of docked/floating combination. Docked↔docked
 * swaps ids in the tree; a floating pane and a docked pane exchange places entirely.
 */
export function swapPanePlacements(
  layout: WorkspaceCanvasLayout,
  draggedId: string,
  targetId: string,
  now: string,
): WorkspaceCanvasLayout {
  if (draggedId === targetId) return layout
  const draggedFloat = layout.floatingPanes.find((pane) => pane.paneId === draggedId)
  const targetFloat = layout.floatingPanes.find((pane) => pane.paneId === targetId)

  // Both docked → swap ids in the tree.
  if (!draggedFloat && !targetFloat) {
    if (!layout.dockedRoot) throw new CanvasError('missing_pane', 'No docked layout to swap within.')
    return { ...layout, dockedRoot: swapPaneLocations(layout.dockedRoot, draggedId, targetId), activePaneId: draggedId }
  }

  // Both floating → exchange rectangles and z-order.
  if (draggedFloat && targetFloat) {
    const floatingPanes = layout.floatingPanes.map((pane) => {
      if (pane.paneId === draggedId) return { ...pane, rect: targetFloat.rect, zIndex: targetFloat.zIndex, updatedAt: now }
      if (pane.paneId === targetId) return { ...pane, rect: draggedFloat.rect, zIndex: draggedFloat.zIndex, updatedAt: now }
      return pane
    })
    return { ...layout, floatingPanes, activePaneId: draggedId }
  }

  // One floating, one docked → the docked slot takes the floating pane's id; the previously
  // docked pane becomes floating in the vacated rectangle.
  const floater = draggedFloat ?? targetFloat!
  const dockedId = draggedFloat ? targetId : draggedId
  if (!layout.dockedRoot) throw new CanvasError('missing_pane', 'No docked layout to swap into.')
  const dockedRoot = swapPaneLocations(layout.dockedRoot, floater.paneId, dockedId)
  const floatingPanes = layout.floatingPanes.map((pane) =>
    pane.paneId === floater.paneId ? { ...pane, paneId: dockedId, updatedAt: now } : pane,
  )
  return { ...layout, dockedRoot, floatingPanes, activePaneId: draggedId }
}

/** Bring a floating pane to the front, renormalising z-order when it grows too large. */
export function bringFloatingToFront(
  layout: WorkspaceCanvasLayout,
  paneId: string,
): WorkspaceCanvasLayout {
  if (!layout.floatingPanes.some((pane) => pane.paneId === paneId)) {
    return { ...layout, activePaneId: paneId }
  }
  const top = layout.nextFloatingZIndex
  const floatingPanes = layout.floatingPanes.map((pane) =>
    pane.paneId === paneId ? { ...pane, zIndex: top } : pane,
  )
  return normalizeFloatingZOrder({ ...layout, floatingPanes, activePaneId: paneId, nextFloatingZIndex: top + 1 })
}

/** Compact z-index values to 1..N once they exceed the ceiling, preserving stacking order. */
export function normalizeFloatingZOrder(layout: WorkspaceCanvasLayout): WorkspaceCanvasLayout {
  const ceiling = 100_000
  if (layout.nextFloatingZIndex < ceiling) return layout
  const ordered = [...layout.floatingPanes].sort((a, b) => a.zIndex - b.zIndex)
  const floatingPanes = ordered.map((pane, index) => ({ ...pane, zIndex: index + 1 }))
  return { ...layout, floatingPanes, nextFloatingZIndex: floatingPanes.length + 1 }
}

/** Throw on any structural invariant violation. Optionally cross-checks a known pane set. */
export function validateCanvasLayout(layout: WorkspaceCanvasLayout, knownPaneIds?: string[]): void {
  const docked = dockedPaneIds(layout.dockedRoot)
  const floating = layout.floatingPanes.map((pane) => pane.paneId)
  const combined = [...docked, ...floating]
  const seen = new Set<string>()
  for (const id of combined) {
    if (seen.has(id)) throw new CanvasError('duplicate_pane', `Pane "${id}" is placed more than once.`)
    seen.add(id)
  }
  for (const pane of layout.floatingPanes) {
    const { x, y, width, height } = pane.rect
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
      throw new CanvasError('floating_rect_invalid', `Floating pane "${pane.paneId}" has an invalid rectangle.`)
    }
  }
  if (knownPaneIds) {
    const known = new Set(knownPaneIds)
    for (const id of combined) {
      if (!known.has(id)) throw new CanvasError('missing_pane', `Layout references unknown pane "${id}".`)
    }
    for (const id of knownPaneIds) {
      if (!seen.has(id)) throw new CanvasError('missing_pane', `Pane "${id}" is not placed anywhere.`)
    }
  }
  if (combined.length === 0) throw new CanvasError('invalid_layout', 'A workspace must contain at least one pane.')
}

/**
 * Move a pane (docked or floating) so it becomes docked beside `targetPaneId`. Used by both
 * pointer docking and keyboard "dock" actions. The source is removed from wherever it lived.
 */
export function movePaneBeside(
  layout: WorkspaceCanvasLayout,
  paneId: string,
  targetPaneId: string,
  zone: Exclude<DockZone, 'center'>,
): WorkspaceCanvasLayout {
  if (paneId === targetPaneId) return layout
  const wasFloating = layout.floatingPanes.some((pane) => pane.paneId === paneId)
  const floatingPanes = layout.floatingPanes.filter((pane) => pane.paneId !== paneId)
  const withoutPane = wasFloating
    ? layout.dockedRoot
    : normalizeSplitTree(removePaneFromDockedTree(layout.dockedRoot, paneId))
  const dockedRoot: DockedLayoutNode = withoutPane
    ? insertPaneBesideTarget(withoutPane, targetPaneId, paneId, zone)
    : { type: 'pane', paneId }
  return { ...layout, dockedRoot: normalizeSplitTree(dockedRoot), floatingPanes, activePaneId: paneId }
}

const CANVAS_EDGE_TO_SPLIT: Record<CanvasSnapZone, { direction: SplitDirection; before: boolean }> = {
  'left-half': { direction: 'vertical', before: true },
  'right-half': { direction: 'vertical', before: false },
  'top-half': { direction: 'horizontal', before: true },
  'bottom-half': { direction: 'horizontal', before: false },
}

/**
 * Dock a pane as a full-length column / row against a canvas edge, i.e. as a new child of the
 * docked root. Left/right create a vertical (side-by-side) root split, top/bottom a horizontal
 * (stacked) one; `normalizeSplitTree` then flattens it into an existing same-direction root so a
 * fourth column lands beside the others rather than nesting.
 */
export function dockPaneAtCanvasEdge(
  layout: WorkspaceCanvasLayout,
  paneId: string,
  zone: CanvasSnapZone,
): WorkspaceCanvasLayout {
  const { direction, before } = CANVAS_EDGE_TO_SPLIT[zone]
  const withoutPane = normalizeSplitTree(removePaneFromDockedTree(layout.dockedRoot, paneId))
  const newPane: DockedLayoutNode = { type: 'pane', paneId }
  const dockedRoot: DockedLayoutNode = withoutPane
    ? { type: 'split', direction, sizes: [50, 50], children: before ? [newPane, withoutPane] : [withoutPane, newPane] }
    : newPane
  return {
    ...layout,
    dockedRoot: normalizeSplitTree(dockedRoot),
    floatingPanes: layout.floatingPanes.filter((pane) => pane.paneId !== paneId),
    activePaneId: paneId,
  }
}

/**
 * Count docked panes that would render below the minimum tile size at the given bounds. Used to
 * reject a drop that would squeeze a pane (its own or a neighbour) past the minimum — the guard
 * that keeps strict tiling from ever producing an unusably thin terminal.
 */
export function countSubMinPanes(
  root: DockedLayoutNode | null,
  bounds: CanvasBounds,
  minWidth: number = CANVAS_CONSTANTS.minDockedWidth,
  minHeight: number = CANVAS_CONSTANTS.minDockedHeight,
): number {
  if (!root || bounds.width <= 0 || bounds.height <= 0) return 0
  const epsilon = 0.5
  const { rects } = calculateDockedRects(root, bounds)
  let count = 0
  for (const rect of Object.values(rects)) {
    if (rect.width < minWidth - epsilon || rect.height < minHeight - epsilon) count += 1
  }
  return count
}

/**
 * Whether applying `candidate` keeps every tile at least as large as `source` did. A drop is
 * valid only when it does not increase the number of sub-minimum panes, so a genuinely crowded
 * canvas rejects a new split while a canvas already too small to satisfy the minimum is never
 * locked out of rearranging.
 */
export function dropPreservesMinimumSizes(
  source: DockedLayoutNode | null,
  candidate: DockedLayoutNode | null,
  bounds: CanvasBounds,
): boolean {
  return countSubMinPanes(candidate, bounds) <= countSubMinPanes(source, bounds)
}

/** Move a pane to a floating rectangle (canvas-normalised). Docked sources leave the tree. */
export function movePaneToFloat(
  layout: WorkspaceCanvasLayout,
  paneId: string,
  rect: NormalizedRect,
  now: string,
): WorkspaceCanvasLayout {
  const existing = layout.floatingPanes.find((pane) => pane.paneId === paneId)
  if (existing) {
    const floatingPanes = layout.floatingPanes.map((pane) =>
      pane.paneId === paneId ? { ...pane, rect, updatedAt: now } : pane,
    )
    return { ...layout, floatingPanes, activePaneId: paneId }
  }
  return floatPane(layout, paneId, rect, now)
}

/**
 * Atomically resolve a completed drag into the next layout. Pure — the controller converts
 * pointer geometry into a {@link DockDropTarget} and this function applies it. Never mutates.
 * Every valid drop tiles the pane into the docked tree (no floating layer), so panes can never
 * overlap. `invalid` / `return-home` / no target all leave the layout untouched.
 */
export function applyDrop(
  layout: WorkspaceCanvasLayout,
  session: PaneDragSession,
  target: DockDropTarget | undefined,
  _bounds: CanvasBounds,
  now: string,
): WorkspaceCanvasLayout {
  const paneId = session.paneId
  if (!target || target.kind === 'return-home' || target.kind === 'invalid') return layout
  switch (target.kind) {
    case 'canvas-snap':
      return dockPaneAtCanvasEdge(layout, paneId, target.zone)
    case 'pane-dock':
      return target.zone === 'center'
        ? swapPanePlacements(layout, paneId, target.targetPaneId, now)
        : movePaneBeside(layout, paneId, target.targetPaneId, target.zone)
  }
}
