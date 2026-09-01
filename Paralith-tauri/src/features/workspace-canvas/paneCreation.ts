import { CANVAS_CONSTANTS } from './canvasConstants'
import { computeCanvasView } from './canvasSelectors'
import type { CanvasBounds, PixelRect, SplitDirection, WorkspaceCanvasLayout } from './canvasTypes'

/**
 * Where a newly created pane goes.
 *
 * Creation is a spatial act, not an append: a new terminal has to land beside the context the
 * developer is already working in, at a size they can actually type into. This module answers
 * "split which pane, along which axis" from the live geometry, so the canvas keeps producing
 * useful asymmetric shapes instead of degrading into an ever-finer grid of equal cells.
 *
 * Every function here is pure (layout + bounds → decision) so placement is testable without a
 * DOM and stays independent of the drag/resize controllers.
 */

export interface PanePlacementDecision {
  targetPaneId: string
  direction: SplitDirection
}

/** Sessions live at once beyond which the workspace surfaces a resource warning. */
export const SESSION_PRESSURE_THRESHOLD = 10

/**
 * The axis to split `rect` along, or undefined when neither half would stay usable.
 *
 * Axes are compared in units of their own minimum rather than raw pixels: a 900×300 pane has more
 * width than height, but relative to what a terminal needs it is far tighter vertically, so it
 * splits into columns. Comparing raw extents would keep slicing wide-but-short panes the wrong way.
 */
export function splitDirectionFor(rect: PixelRect): SplitDirection | undefined {
  const columnsFit = rect.width / 2 >= CANVAS_CONSTANTS.minDockedWidth
  const rowsFit = rect.height / 2 >= CANVAS_CONSTANTS.minDockedHeight
  if (columnsFit && rowsFit) {
    const widthRoom = rect.width / CANVAS_CONSTANTS.minDockedWidth
    const heightRoom = rect.height / CANVAS_CONSTANTS.minDockedHeight
    return widthRoom >= heightRoom ? 'vertical' : 'horizontal'
  }
  if (columnsFit) return 'vertical'
  if (rowsFit) return 'horizontal'
  return undefined
}

/**
 * Resolve the split target for a new pane.
 *
 * Preference order: the focused pane (creation should appear next to what the user is looking at),
 * then the roomiest pane that can still be split. Creation is never refused — if nothing fits, the
 * focused pane is split anyway and Tidy is the user's recovery, because a hard cap on panes would
 * be a UI convenience paid for by the developer's workflow.
 */
export function resolvePanePlacement(
  layout: WorkspaceCanvasLayout | null,
  bounds: CanvasBounds,
  focusedPaneId: string | undefined,
  fallbackPaneId: string,
): PanePlacementDecision {
  const rects = new Map(computeCanvasView(layout, bounds).panes.map((pane) => [pane.paneId, pane.rect]))
  const preferred = focusedPaneId ?? fallbackPaneId

  const focusedRect = rects.get(preferred)
  const focusedDirection = focusedRect && splitDirectionFor(focusedRect)
  if (focusedDirection) return { targetPaneId: preferred, direction: focusedDirection }

  // The focused pane is at its minimum. Rather than squeeze the context in use below usability,
  // place the new pane against the pane with the most room to give.
  let best: PanePlacementDecision | undefined
  let bestArea = -1
  for (const [paneId, rect] of rects) {
    const direction = splitDirectionFor(rect)
    if (!direction) continue
    const area = rect.width * rect.height
    if (area > bestArea) {
      bestArea = area
      best = { targetPaneId: paneId, direction }
    }
  }
  return best ?? { targetPaneId: preferred, direction: 'vertical' }
}

/** The dock zone a split direction inserts into — new panes go right of / below their target. */
export function insertZoneFor(direction: SplitDirection): 'right' | 'bottom' {
  return direction === 'vertical' ? 'right' : 'bottom'
}
