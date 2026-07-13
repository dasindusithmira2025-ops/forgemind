import { WORKSPACE_CANVAS_LAYOUT_VERSION } from './canvasConstants'
import type { Workspace } from '../../native/types'
import {
  CanvasError,
  type FloatingPanePlacement,
  type NormalizedRect,
  type WorkspaceCanvasLayout,
} from './canvasTypes'
import {
  allPaneIds,
  dockedPaneIds,
  insertPaneBesideTarget,
  normalizeFloatingZOrder,
  normalizeSplitTree,
} from './layoutOperations'

/**
 * Bridges the persisted database representation and the in-memory {@link WorkspaceCanvasLayout}.
 *
 * The docked split tree stays in the existing `Workspace.layout` (canonical, unchanged so old
 * clients and Rust validation keep working). The floating layer + canvas metadata are stored
 * separately as {@link CanvasExtras}; when absent (any pre-canvas workspace) we migrate to an
 * empty floating layer. Everything here is pure and idempotent.
 */

/** The additive slice persisted alongside the docked tree (in the new `canvas_json` column). */
export interface CanvasExtras {
  version: number
  floatingPanes: FloatingPanePlacement[]
  maximizedPaneId?: string
  nextFloatingZIndex: number
}

export function emptyCanvasExtras(): CanvasExtras {
  return { version: WORKSPACE_CANVAS_LAYOUT_VERSION, floatingPanes: [], maximizedPaneId: undefined, nextFloatingZIndex: 1 }
}

/** Migrate a docked-only workspace (no canvas extras) into a full canvas layout. */
export function migrateWorkspaceToCanvas(workspace: Workspace): WorkspaceCanvasLayout {
  return buildCanvasLayout(workspace, undefined)
}

/** Combine a Workspace (docked tree + active pane) with optional persisted canvas extras. */
export function buildCanvasLayout(workspace: Workspace, extras: CanvasExtras | undefined): WorkspaceCanvasLayout {
  const base: WorkspaceCanvasLayout = {
    version: WORKSPACE_CANVAS_LAYOUT_VERSION,
    dockedRoot: workspace.layout ?? null,
    floatingPanes: extras?.floatingPanes ?? [],
    activePaneId: workspace.activePaneId,
    maximizedPaneId: extras?.maximizedPaneId,
    nextFloatingZIndex: extras?.nextFloatingZIndex ?? 1,
  }
  return normalizeRestoredLayout(base, workspace.panes.map((pane) => pane.id))
}

/** Extract the additive extras to persist from an in-memory layout. */
export function toCanvasExtras(layout: WorkspaceCanvasLayout): CanvasExtras {
  return {
    version: WORKSPACE_CANVAS_LAYOUT_VERSION,
    floatingPanes: layout.floatingPanes,
    maximizedPaneId: layout.maximizedPaneId,
    nextFloatingZIndex: layout.nextFloatingZIndex,
  }
}

function clampNormalizedRect(rect: NormalizedRect): NormalizedRect {
  const finite = (value: number, fallback: number) => (Number.isFinite(value) ? value : fallback)
  let width = Math.min(Math.max(finite(rect.width, 0.4), 0.1), 1)
  let height = Math.min(Math.max(finite(rect.height, 0.4), 0.1), 1)
  const x = Math.min(Math.max(finite(rect.x, 0), 0), Math.max(0, 1 - width))
  const y = Math.min(Math.max(finite(rect.y, 0), 0), Math.max(0, 1 - Math.min(height, 0.9)))
  if (x + width > 1) width = 1 - x
  if (y + height > 1) height = 1 - y
  return { x, y, width, height }
}

/**
 * Repair a restored layout deterministically: drop floating panes for unknown ids, clamp every
 * floating rect into the canvas, ensure every known pane is placed exactly once, and compact
 * z-order. Never deletes a pane's configuration; a stranded pane is docked back in.
 */
export function normalizeRestoredLayout(layout: WorkspaceCanvasLayout, knownPaneIds: string[]): WorkspaceCanvasLayout {
  const known = new Set(knownPaneIds)

  // Keep only floating panes for known ids, de-duplicated, with clamped rectangles.
  const seenFloating = new Set<string>()
  const floatingPanes: FloatingPanePlacement[] = []
  for (const pane of layout.floatingPanes) {
    if (!known.has(pane.paneId) || seenFloating.has(pane.paneId)) continue
    seenFloating.add(pane.paneId)
    floatingPanes.push({ ...pane, rect: clampNormalizedRect(pane.rect) })
  }

  // Docked tree: prune unknown ids via normalize (they simply won't be re-added below).
  let dockedRoot = normalizeSplitTree(pruneUnknownDocked(layout.dockedRoot, known, seenFloating))

  // Place any known pane that ended up nowhere (stranded by a corrupt file) back into the dock.
  const placed = new Set<string>([...dockedPaneIds(dockedRoot), ...seenFloating])
  for (const id of knownPaneIds) {
    if (placed.has(id)) continue
    if (!dockedRoot) {
      dockedRoot = { type: 'pane', paneId: id }
    } else {
      const anchor = dockedPaneIds(dockedRoot)[0]
      dockedRoot = insertPaneBesideTarget(dockedRoot, anchor, id, 'right')
    }
    placed.add(id)
  }

  const activePaneId = layout.activePaneId && placed.has(layout.activePaneId) ? layout.activePaneId : knownPaneIds[0]
  const maximizedPaneId = layout.maximizedPaneId && placed.has(layout.maximizedPaneId) ? layout.maximizedPaneId : undefined
  const topZ = floatingPanes.reduce((max, pane) => Math.max(max, pane.zIndex), 0)

  return normalizeFloatingZOrder({
    version: WORKSPACE_CANVAS_LAYOUT_VERSION,
    dockedRoot,
    floatingPanes,
    activePaneId,
    maximizedPaneId,
    nextFloatingZIndex: Math.max(layout.nextFloatingZIndex, topZ + 1, 1),
  })
}

/** Drop docked panes whose ids are unknown or already claimed by the floating layer. */
function pruneUnknownDocked(
  node: WorkspaceCanvasLayout['dockedRoot'],
  known: Set<string>,
  floating: Set<string>,
): WorkspaceCanvasLayout['dockedRoot'] {
  if (!node) return null
  if (node.type === 'pane') return known.has(node.paneId) && !floating.has(node.paneId) ? node : null
  const kept: Array<{ child: NonNullable<WorkspaceCanvasLayout['dockedRoot']>; size: number }> = []
  node.children.forEach((child, index) => {
    const result = pruneUnknownDocked(child, known, floating)
    if (result) kept.push({ child: result, size: node.sizes[index] ?? 100 / node.children.length })
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].child
  return { type: 'split', direction: node.direction, sizes: kept.map((entry) => entry.size), children: kept.map((entry) => entry.child) }
}

/**
 * Reconstruct the canvas layout from a persisted record. When the workspace predates the canvas
 * (no stored blob) we migrate from its docked-only layout. A corrupt / unparseable blob also
 * falls back to migration rather than losing the workspace.
 */
export function buildFromPersisted(workspace: Workspace, canvasJson: string | null): WorkspaceCanvasLayout {
  if (!canvasJson) return migrateWorkspaceToCanvas(workspace)
  let parsed: WorkspaceCanvasLayout
  try {
    parsed = JSON.parse(canvasJson) as WorkspaceCanvasLayout
  } catch {
    return migrateWorkspaceToCanvas(workspace)
  }
  const knownPaneIds = workspace.panes.map((pane) => pane.id)
  return normalizeRestoredLayout(
    {
      version: WORKSPACE_CANVAS_LAYOUT_VERSION,
      dockedRoot: parsed.dockedRoot ?? null,
      floatingPanes: Array.isArray(parsed.floatingPanes) ? parsed.floatingPanes : [],
      activePaneId: parsed.activePaneId ?? workspace.activePaneId,
      maximizedPaneId: parsed.maximizedPaneId,
      nextFloatingZIndex: Number.isFinite(parsed.nextFloatingZIndex) ? parsed.nextFloatingZIndex : 1,
    },
    knownPaneIds,
  )
}

/** Assert a layout is coherent for persistence (throws {@link CanvasError} otherwise). */
export function assertPersistable(layout: WorkspaceCanvasLayout, knownPaneIds: string[]): void {
  const placed = allPaneIds(layout)
  if (placed.length !== knownPaneIds.length || new Set(placed).size !== placed.length) {
    throw new CanvasError('invalid_layout', 'The canvas layout does not place every pane exactly once.')
  }
}
