import { CANVAS_CONSTANTS } from './canvasConstants'
import type {
  CanvasBounds,
  CanvasSnapZone,
  DockedLayoutNode,
  NormalizedRect,
  PixelRect,
} from './canvasTypes'

/**
 * Pure geometry for the docking canvas. Nothing here touches React, the DOM, Tauri, or any
 * store — every function maps data → data so the whole engine is unit-testable in isolation.
 *
 * Split-direction convention (matches the existing app + react-resizable-panels usage):
 *   - direction 'vertical'   → children are COLUMNS laid out along the X axis.
 *   - direction 'horizontal' → children are ROWS stacked along the Y axis.
 */

/** Thickness (px) reserved between sibling docked panes for the resize handle. */
export const SPLIT_HANDLE_PX = 6

export interface SplitHandle {
  /** Path from the docked root to the split node owning this divider. */
  path: number[]
  /** Divider sits between child `index` and child `index + 1`. */
  index: number
  direction: 'horizontal' | 'vertical'
  /** Visual orientation of the draggable bar. */
  orientation: 'vertical' | 'horizontal'
  rect: PixelRect
}

export interface DockedGeometry {
  rects: Record<string, PixelRect>
  handles: SplitHandle[]
}

/** Normalise a split node's sizes so they sum to 100 while preserving proportions. */
export function normalizeSplitSizes(sizes: number[], count: number): number[] {
  const usable = sizes.slice(0, count).map((size) => (Number.isFinite(size) && size > 0 ? size : 0))
  while (usable.length < count) usable.push(0)
  const total = usable.reduce((sum, size) => sum + size, 0)
  if (total <= 0) return new Array(count).fill(100 / count)
  return usable.map((size) => (size / total) * 100)
}

/**
 * Compute pixel rectangles for every docked pane plus the resize handles between siblings.
 * Returns an empty result when the tree is null (all panes floating) or bounds are degenerate.
 */
export function calculateDockedRects(
  root: DockedLayoutNode | null,
  bounds: CanvasBounds,
  handlePx: number = SPLIT_HANDLE_PX,
): DockedGeometry {
  const rects: Record<string, PixelRect> = {}
  const handles: SplitHandle[] = []
  if (!root || bounds.width <= 0 || bounds.height <= 0) return { rects, handles }

  const walk = (node: DockedLayoutNode, rect: PixelRect, path: number[]): void => {
    if (node.type === 'pane') {
      rects[node.paneId] = rect
      return
    }
    const count = node.children.length
    const sizes = normalizeSplitSizes(node.sizes, count)
    const isColumns = node.direction === 'vertical'
    const totalExtent = isColumns ? rect.width : rect.height
    const gutter = handlePx * (count - 1)
    const contentExtent = Math.max(0, totalExtent - gutter)

    let cursor = isColumns ? rect.x : rect.y
    node.children.forEach((child, childIndex) => {
      const extent = (sizes[childIndex] / 100) * contentExtent
      const childRect: PixelRect = isColumns
        ? { x: cursor, y: rect.y, width: extent, height: rect.height }
        : { x: rect.x, y: cursor, width: rect.width, height: extent }
      walk(child, childRect, [...path, childIndex])
      cursor += extent
      if (childIndex < count - 1) {
        handles.push({
          path,
          index: childIndex,
          direction: node.direction,
          orientation: isColumns ? 'vertical' : 'horizontal',
          rect: isColumns
            ? { x: cursor, y: rect.y, width: handlePx, height: rect.height }
            : { x: rect.x, y: cursor, width: rect.width, height: handlePx },
        })
        cursor += handlePx
      }
    })
  }

  walk(root, { x: 0, y: 0, width: bounds.width, height: bounds.height }, [])
  return { rects, handles }
}

/** Pixel rectangle of the node at `path` from the docked root (used for split resize math). */
export function rectAtPath(
  root: DockedLayoutNode | null,
  bounds: CanvasBounds,
  path: number[],
  handlePx: number = SPLIT_HANDLE_PX,
): PixelRect | undefined {
  if (!root || bounds.width <= 0 || bounds.height <= 0) return undefined
  let node: DockedLayoutNode = root
  let rect: PixelRect = { x: 0, y: 0, width: bounds.width, height: bounds.height }
  for (const index of path) {
    if (node.type !== 'split' || index < 0 || index >= node.children.length) return undefined
    const count = node.children.length
    const sizes = normalizeSplitSizes(node.sizes, count)
    const isColumns = node.direction === 'vertical'
    const totalExtent = isColumns ? rect.width : rect.height
    const contentExtent = Math.max(0, totalExtent - handlePx * (count - 1))
    let cursor = isColumns ? rect.x : rect.y
    for (let childIndex = 0; childIndex < index; childIndex += 1) {
      cursor += (sizes[childIndex] / 100) * contentExtent + handlePx
    }
    const extent = (sizes[index] / 100) * contentExtent
    rect = isColumns
      ? { x: cursor, y: rect.y, width: extent, height: rect.height }
      : { x: rect.x, y: cursor, width: rect.width, height: extent }
    node = node.children[index]
  }
  return rect
}

export function normalizedToPixel(rect: NormalizedRect, bounds: CanvasBounds): PixelRect {
  return {
    x: rect.x * bounds.width,
    y: rect.y * bounds.height,
    width: rect.width * bounds.width,
    height: rect.height * bounds.height,
  }
}

export function pixelToNormalized(rect: PixelRect, bounds: CanvasBounds): NormalizedRect {
  if (bounds.width <= 0 || bounds.height <= 0) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: rect.x / bounds.width,
    y: rect.y / bounds.height,
    width: rect.width / bounds.width,
    height: rect.height / bounds.height,
  }
}

/**
 * Clamp a floating rectangle so it respects minimum size and never leaves a reachable slice
 * of its header off-canvas. Sizes are capped to the canvas; the box is then nudged fully into
 * view where it fits, otherwise kept reachable by its header.
 */
export function clampFloatingRect(rect: PixelRect, bounds: CanvasBounds): PixelRect {
  const { minFloatingWidth, minFloatingHeight, minReachableHeaderPx } = CANVAS_CONSTANTS
  const width = clamp(rect.width, Math.min(minFloatingWidth, bounds.width), bounds.width)
  const height = clamp(rect.height, Math.min(minFloatingHeight, bounds.height), bounds.height)

  // The whole box fits if the canvas is large enough; otherwise keep the header reachable.
  const maxX = bounds.width - width
  const maxY = bounds.height - height
  let x = clamp(rect.x, 0, Math.max(0, maxX))
  let y = clamp(rect.y, 0, Math.max(0, maxY))

  // Guard against a NaN slipping through and against a header dragged past the bottom edge.
  if (!Number.isFinite(x)) x = 0
  if (!Number.isFinite(y)) y = 0
  y = clamp(y, 0, Math.max(0, bounds.height - minReachableHeaderPx))

  return { x, y, width, height }
}

/** Compute the destination rectangle for a canvas edge / corner snap. */
export function resolveCanvasSnapRect(zone: CanvasSnapZone, bounds: CanvasBounds): PixelRect {
  const halfW = bounds.width / 2
  const halfH = bounds.height / 2
  switch (zone) {
    case 'left-half':
      return { x: 0, y: 0, width: halfW, height: bounds.height }
    case 'right-half':
      return { x: halfW, y: 0, width: halfW, height: bounds.height }
    case 'top-half':
      return { x: 0, y: 0, width: bounds.width, height: halfH }
    case 'bottom-half':
      return { x: 0, y: halfH, width: bounds.width, height: halfH }
    case 'top-left':
      return { x: 0, y: 0, width: halfW, height: halfH }
    case 'top-right':
      return { x: halfW, y: 0, width: halfW, height: halfH }
    case 'bottom-left':
      return { x: 0, y: halfH, width: halfW, height: halfH }
    case 'bottom-right':
      return { x: halfW, y: halfH, width: halfW, height: halfH }
  }
}

export function rectContains(rect: PixelRect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** A default floating rectangle centred near the drop point, clamped to the canvas. */
export function defaultFloatRectAt(
  pointerX: number,
  pointerY: number,
  bounds: CanvasBounds,
): PixelRect {
  const width = bounds.width * CANVAS_CONSTANTS.defaultFloatWidthFraction
  const height = bounds.height * CANVAS_CONSTANTS.defaultFloatHeightFraction
  return clampFloatingRect(
    { x: pointerX - width / 2, y: pointerY - 16, width, height },
    bounds,
  )
}
