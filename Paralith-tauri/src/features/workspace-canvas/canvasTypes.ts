import type { LayoutNode, SplitDirection } from '../../native/types'

/**
 * The docked split tree is the existing recursive {@link LayoutNode}. We alias it here so the
 * docking feature reads coherently and so a future split-node id can be introduced in one
 * place without touching call sites.
 */
export type DockedLayoutNode = LayoutNode

export type { SplitDirection }

/** A rectangle in canvas-normalised coordinates. Every field is a fraction in [0, 1]. */
export interface NormalizedRect {
  x: number
  y: number
  width: number
  height: number
}

/** A rectangle in device pixels relative to the usable canvas origin. */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** The usable canvas box in pixels (already excludes sidebar / title bar / status bar). */
export interface CanvasBounds {
  width: number
  height: number
}

export interface FloatingPanePlacement {
  paneId: string
  rect: NormalizedRect
  zIndex: number
  /** Path into the docked tree the pane last occupied, so it can return home. */
  previousDockPath?: number[]
  createdAt: string
  updatedAt: string
}

/**
 * The complete, versioned, persisted canvas layout for one Workspace. The docked tree stays
 * the canonical placement for docked panes; floating placements live alongside it.
 */
export interface WorkspaceCanvasLayout {
  version: number
  dockedRoot: DockedLayoutNode | null
  floatingPanes: FloatingPanePlacement[]
  activePaneId?: string
  maximizedPaneId?: string
  nextFloatingZIndex: number
}

export type PanePlacementKind = 'docked' | 'floating'

/** How the pointer is resolved against a docked pane's five-zone overlay. */
export type DockZone = 'left' | 'right' | 'top' | 'bottom' | 'center'

/**
 * How the pointer is resolved against the canvas boundary. In the strict-tiling model a canvas
 * snap docks the pane as a full-length column/row at the root, so only the four edge halves are
 * meaningful (corners would require an ambiguous nested split).
 */
export type CanvasSnapZone = 'left-half' | 'right-half' | 'top-half' | 'bottom-half'

/**
 * A resolved drop target while dragging — exactly one variant is active at a time. There is no
 * free-floating variant: every valid drop tiles the pane into the docked tree so panes can never
 * overlap. `invalid` marks a placement that would violate minimum sizes (the drop is rejected).
 */
export type DockDropTarget =
  | { kind: 'canvas-snap'; zone: CanvasSnapZone; rect: PixelRect }
  | { kind: 'pane-dock'; targetPaneId: string; zone: DockZone; rect: PixelRect }
  | { kind: 'invalid'; rect: PixelRect }
  | { kind: 'return-home' }

export type DragPhase = 'pending' | 'dragging' | 'settling' | 'cancelled'

/**
 * Transient state for one in-flight pane drag. This never touches persisted layout, terminal
 * runtime, or xterm output — it is discarded on drop or cancel.
 */
export interface PaneDragSession {
  paneId: string
  sourcePlacement: PanePlacementKind
  sourceDockPath?: number[]
  sourceFloatingRect?: NormalizedRect
  pointerId: number
  /** Pointer offset from the previewed pane's top-left, in px. */
  pointerOffsetX: number
  pointerOffsetY: number
  /** Live preview rectangle in canvas pixels. */
  previewRect: PixelRect
  activeDropTarget?: DockDropTarget
  startedAt: number
  phase: DragPhase
}

export type ResizeEdge =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

/** Transient state for an in-flight floating-pane resize. */
export interface FloatingResizeSession {
  paneId: string
  edge: ResizeEdge
  pointerId: number
  startPointerX: number
  startPointerY: number
  startRect: PixelRect
  currentRect: PixelRect
}

/** Alignment guide surfaced while dragging or resizing near an edge. */
export interface MagneticGuide {
  orientation: 'vertical' | 'horizontal'
  /** Position along the perpendicular axis, in canvas px. */
  position: number
}

/** Structured error codes shared across the docking pipeline. */
export type CanvasErrorCode =
  | 'invalid_layout'
  | 'missing_pane'
  | 'duplicate_pane'
  | 'invalid_drop_target'
  | 'minimum_size_violation'
  | 'stale_layout_revision'
  | 'layout_persistence_failed'
  | 'floating_rect_invalid'
  | 'docking_operation_failed'
  | 'layout_migration_failed'

export class CanvasError extends Error {
  code: CanvasErrorCode
  constructor(code: CanvasErrorCode, message: string) {
    super(message)
    this.name = 'CanvasError'
    this.code = code
  }
}
