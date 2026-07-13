import { calculateDockedRects, normalizedToPixel, type SplitHandle } from './geometryEngine'
import type { CanvasBounds, PanePlacementKind, PixelRect, WorkspaceCanvasLayout } from './canvasTypes'

/** Base z-index band for docked panes; floating panes stack above it. */
const DOCKED_Z_BASE = 0
const FLOATING_Z_BASE = 1000
const MAXIMIZED_Z = 1_000_000

export interface PaneView {
  paneId: string
  kind: PanePlacementKind
  rect: PixelRect
  zIndex: number
  /** True while this pane is the maximized one (occupies the whole canvas). */
  maximized: boolean
}

export interface CanvasView {
  panes: PaneView[]
  handles: SplitHandle[]
  activePaneId?: string
  maximizedPaneId?: string
}

/**
 * Resolve a persisted layout + measured canvas bounds into concrete pixel placements for every
 * pane, ordered stably by pane id so React keys never shuffle. When a pane is maximized it is
 * promoted to fill the canvas above everything else while all other panes keep their real
 * geometry (kept mounted, just visually covered).
 */
export function computeCanvasView(layout: WorkspaceCanvasLayout | null, bounds: CanvasBounds): CanvasView {
  if (!layout) return { panes: [], handles: [] }

  const { rects: dockedRects, handles } = calculateDockedRects(layout.dockedRoot, bounds)
  const views: PaneView[] = []

  for (const [paneId, rect] of Object.entries(dockedRects)) {
    views.push({ paneId, kind: 'docked', rect, zIndex: DOCKED_Z_BASE, maximized: false })
  }
  for (const floating of layout.floatingPanes) {
    views.push({
      paneId: floating.paneId,
      kind: 'floating',
      rect: normalizedToPixel(floating.rect, bounds),
      zIndex: FLOATING_Z_BASE + floating.zIndex,
      maximized: false,
    })
  }

  const maximizedPaneId = layout.maximizedPaneId
  const panes = views
    .map((view) =>
      view.paneId === maximizedPaneId
        ? { ...view, rect: { x: 0, y: 0, width: bounds.width, height: bounds.height }, zIndex: MAXIMIZED_Z, maximized: true }
        : view,
    )
    .sort((a, b) => a.paneId.localeCompare(b.paneId))

  return {
    panes,
    handles: maximizedPaneId ? [] : handles,
    activePaneId: layout.activePaneId,
    maximizedPaneId,
  }
}

/** Floating pane pixel rectangles keyed by pane id (used by the drop resolver & magnetics). */
export function floatingPixelRects(layout: WorkspaceCanvasLayout, bounds: CanvasBounds): Array<{ paneId: string; rect: PixelRect }> {
  return layout.floatingPanes
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((floating) => ({ paneId: floating.paneId, rect: normalizedToPixel(floating.rect, bounds) }))
}
