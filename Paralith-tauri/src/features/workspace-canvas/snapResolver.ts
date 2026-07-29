import { CANVAS_CONSTANTS } from './canvasConstants'
import { resolveCanvasSnapRect } from './geometryEngine'
import type {
  CanvasBounds,
  CanvasSnapZone,
  DockDropTarget,
  DockZone,
  MagneticGuide,
  PixelRect,
} from './canvasTypes'

/**
 * Resolves a live pointer position into a concrete drop target, and computes magnetic
 * alignment. Pure: takes measured geometry in, returns a decision out. Hysteresis is applied
 * by widening the active zone's catch region via the previously-resolved target.
 */

/**
 * Canvas edge detection with hysteresis. When a canvas-snap zone is already active the catch band
 * widens by the release threshold so the zone does not flicker at its boundary. Only the four
 * edge halves are produced: a canvas snap docks the pane as a full-length root column / row, and
 * whichever edge the pointer is closest to wins when two edges are both in range (a corner).
 */
export function resolveCanvasSnapZone(
  px: number,
  py: number,
  bounds: CanvasBounds,
  sticky: boolean,
): CanvasSnapZone | undefined {
  const t = CANVAS_CONSTANTS.canvasEdgeSnapThreshold + (sticky ? CANVAS_CONSTANTS.snapReleaseThreshold : 0)
  const distances: Array<{ zone: CanvasSnapZone; dist: number }> = []
  if (px <= t) distances.push({ zone: 'left-half', dist: px })
  if (px >= bounds.width - t) distances.push({ zone: 'right-half', dist: bounds.width - px })
  if (py <= t) distances.push({ zone: 'top-half', dist: py })
  if (py >= bounds.height - t) distances.push({ zone: 'bottom-half', dist: bounds.height - py })
  if (distances.length === 0) return undefined
  return distances.reduce((best, entry) => (entry.dist < best.dist ? entry : best)).zone
}

/** Resolve which of the five dock zones a point falls into within a target pane rectangle. */
export function resolveDockZone(px: number, py: number, rect: PixelRect): DockZone {
  if (rect.width <= 0 || rect.height <= 0) return 'center'
  const fx = (px - rect.x) / rect.width
  const fy = (py - rect.y) / rect.height
  const edge = CANVAS_CONSTANTS.dockEdgeZoneFraction
  const distLeft = fx
  const distRight = 1 - fx
  const distTop = fy
  const distBottom = 1 - fy
  const nearest = Math.min(distLeft, distRight, distTop, distBottom)
  if (nearest > edge) return 'center'
  if (nearest === distLeft) return 'left'
  if (nearest === distRight) return 'right'
  if (nearest === distTop) return 'top'
  return 'bottom'
}

/** The highlighted destination rectangle for a resolved dock zone over a target pane. */
export function dockZoneRect(target: PixelRect, zone: DockZone): PixelRect {
  const { x, y, width, height } = target
  switch (zone) {
    case 'left':
      return { x, y, width: width / 2, height }
    case 'right':
      return { x: x + width / 2, y, width: width / 2, height }
    case 'top':
      return { x, y, width, height: height / 2 }
    case 'bottom':
      return { x, y: y + height / 2, width, height: height / 2 }
    case 'center':
      return { x, y, width, height }
  }
}

export interface DropResolutionInput {
  pointerX: number
  pointerY: number
  bounds: CanvasBounds
  previewRect: PixelRect
  dockedRects: Record<string, PixelRect>
  /** Floating panes ordered back-to-front; the last entry wins overlap tests. */
  floating: Array<{ paneId: string; rect: PixelRect }>
  draggedPaneId: string
  previous?: DockDropTarget
}

/** Topmost pane (floating first, then docked) under the pointer, excluding the dragged pane. */
function paneUnderPointer(input: DropResolutionInput): { paneId: string; rect: PixelRect } | undefined {
  for (let index = input.floating.length - 1; index >= 0; index -= 1) {
    const entry = input.floating[index]
    if (entry.paneId === input.draggedPaneId) continue
    const r = entry.rect
    if (input.pointerX >= r.x && input.pointerX <= r.x + r.width && input.pointerY >= r.y && input.pointerY <= r.y + r.height) {
      return entry
    }
  }
  for (const [paneId, r] of Object.entries(input.dockedRects)) {
    if (paneId === input.draggedPaneId) continue
    if (input.pointerX >= r.x && input.pointerX <= r.x + r.width && input.pointerY >= r.y && input.pointerY <= r.y + r.height) {
      return { paneId, rect: r }
    }
  }
  return undefined
}

/**
 * The full resolution pipeline for the strict-tiling canvas. Canvas-edge snapping takes priority
 * near the boundary (so a pane can always be flung to a full-length root column / row), then pane
 * docking when hovering another pane. There is deliberately no floating fallback: when the pointer
 * is only over the dragged pane's own tile (e.g. a lone pane, or a jitter inside its own slot)
 * the pane simply stays where it is. Minimum-size feasibility is checked by the caller, which
 * downgrades an infeasible target to `invalid`.
 */
export function resolveDropTarget(input: DropResolutionInput): DockDropTarget {
  const sticky = input.previous?.kind === 'canvas-snap'
  const snapZone = resolveCanvasSnapZone(input.pointerX, input.pointerY, input.bounds, sticky)
  if (snapZone) {
    return { kind: 'canvas-snap', zone: snapZone, rect: resolveCanvasSnapRect(snapZone, input.bounds) }
  }
  const pane = paneUnderPointer(input)
  if (pane) {
    const zone = resolveDockZone(input.pointerX, input.pointerY, pane.rect)
    return { kind: 'pane-dock', targetPaneId: pane.paneId, zone, rect: dockZoneRect(pane.rect, zone) }
  }
  return { kind: 'return-home' }
}

export interface MagneticResult {
  dx: number
  dy: number
  guides: MagneticGuide[]
}

/**
 * Compute a small translation that snaps a moving rectangle's edges to the canvas boundary or
 * to nearby pane edges when within the magnetic threshold, along with the guide lines to draw.
 */
export function computeMagneticAdjustment(
  rect: PixelRect,
  bounds: CanvasBounds,
  otherRects: PixelRect[],
): MagneticResult {
  const threshold = CANVAS_CONSTANTS.magneticAlignThreshold

  const verticalLines = [0, bounds.width, ...otherRects.flatMap((r) => [r.x, r.x + r.width])]
  const horizontalLines = [0, bounds.height, ...otherRects.flatMap((r) => [r.y, r.y + r.height])]

  let dx = 0
  let bestX: number = threshold
  for (const line of verticalLines) {
    for (const edge of [rect.x, rect.x + rect.width]) {
      const delta = line - edge
      if (Math.abs(delta) < bestX) {
        bestX = Math.abs(delta)
        dx = delta
      }
    }
  }

  let dy = 0
  let bestY: number = threshold
  for (const line of horizontalLines) {
    for (const edge of [rect.y, rect.y + rect.height]) {
      const delta = line - edge
      if (Math.abs(delta) < bestY) {
        bestY = Math.abs(delta)
        dy = delta
      }
    }
  }

  const finalGuides: MagneticGuide[] = []
  if (bestX < threshold) {
    // Guide sits on whichever edge actually snapped.
    const snappedLeft = verticalLines.includes(rect.x + dx)
    finalGuides.push({ orientation: 'vertical', position: snappedLeft ? rect.x + dx : rect.x + rect.width + dx })
  }
  if (bestY < threshold) {
    const snappedTop = horizontalLines.includes(rect.y + dy)
    finalGuides.push({ orientation: 'horizontal', position: snappedTop ? rect.y + dy : rect.y + rect.height + dy })
  }

  return { dx: bestX < threshold ? dx : 0, dy: bestY < threshold ? dy : 0, guides: finalGuides }
}
