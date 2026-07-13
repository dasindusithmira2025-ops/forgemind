import { describe, expect, it } from 'vitest'
import {
  computeMagneticAdjustment,
  dockZoneRect,
  resolveCanvasSnapZone,
  resolveDockZone,
  resolveDropTarget,
} from './snapResolver'
import type { PixelRect } from './canvasTypes'

const bounds = { width: 1000, height: 800 }

describe('resolveCanvasSnapZone', () => {
  it('detects each half at the edge', () => {
    expect(resolveCanvasSnapZone(5, 400, bounds, false)).toBe('left-half')
    expect(resolveCanvasSnapZone(995, 400, bounds, false)).toBe('right-half')
    expect(resolveCanvasSnapZone(500, 5, bounds, false)).toBe('top-half')
    expect(resolveCanvasSnapZone(500, 795, bounds, false)).toBe('bottom-half')
  })

  it('resolves a corner to the nearer edge (no corner zones in strict tiling)', () => {
    // Slightly closer to the left edge than the top → left wins.
    expect(resolveCanvasSnapZone(2, 6, bounds, false)).toBe('left-half')
    // Slightly closer to the bottom edge than the right → bottom wins.
    expect(resolveCanvasSnapZone(994, 798, bounds, false)).toBe('bottom-half')
  })

  it('returns nothing away from any edge', () => {
    expect(resolveCanvasSnapZone(500, 400, bounds, false)).toBeUndefined()
  })

  it('applies hysteresis: an active zone sticks past the activation band', () => {
    // 30px in: beyond the 20px activation band, so a fresh detection sees nothing...
    expect(resolveCanvasSnapZone(28, 400, bounds, false)).toBeUndefined()
    // ...but if left-half is already active, the widened band (20 + 9) still holds it.
    expect(resolveCanvasSnapZone(28, 400, bounds, true)).toBe('left-half')
  })
})

describe('resolveDockZone', () => {
  const rect: PixelRect = { x: 0, y: 0, width: 400, height: 300 }
  it('resolves the centre', () => {
    expect(resolveDockZone(200, 150, rect)).toBe('center')
  })
  it('resolves each edge', () => {
    expect(resolveDockZone(10, 150, rect)).toBe('left')
    expect(resolveDockZone(390, 150, rect)).toBe('right')
    expect(resolveDockZone(200, 8, rect)).toBe('top')
    expect(resolveDockZone(200, 292, rect)).toBe('bottom')
  })
})

describe('dockZoneRect', () => {
  const target: PixelRect = { x: 100, y: 100, width: 400, height: 200 }
  it('halves for edges and fills for centre', () => {
    expect(dockZoneRect(target, 'left')).toEqual({ x: 100, y: 100, width: 200, height: 200 })
    expect(dockZoneRect(target, 'bottom')).toEqual({ x: 100, y: 200, width: 400, height: 100 })
    expect(dockZoneRect(target, 'center')).toEqual(target)
  })
})

describe('resolveDropTarget', () => {
  const dockedRects: Record<string, PixelRect> = {
    a: { x: 0, y: 0, width: 500, height: 800 },
    b: { x: 500, y: 0, width: 500, height: 800 },
  }

  it('prefers a canvas edge snap near the boundary', () => {
    const target = resolveDropTarget({ pointerX: 4, pointerY: 400, bounds, previewRect: dockedRects.a, dockedRects, floating: [], draggedPaneId: 'a' })
    expect(target.kind).toBe('canvas-snap')
  })

  it('docks onto a hovered pane away from the edge', () => {
    const target = resolveDropTarget({ pointerX: 520, pointerY: 400, bounds, previewRect: dockedRects.a, dockedRects, floating: [], draggedPaneId: 'a' })
    expect(target.kind).toBe('pane-dock')
    if (target.kind === 'pane-dock') expect(target.targetPaneId).toBe('b')
  })

  it('returns home over empty space (no floating fallback)', () => {
    const preview = { x: 300, y: 300, width: 360, height: 220 }
    const target = resolveDropTarget({ pointerX: 480, pointerY: 400, bounds, previewRect: preview, dockedRects: {}, floating: [], draggedPaneId: 'a' })
    expect(target).toEqual({ kind: 'return-home' })
  })

  it('never targets the dragged pane itself: hovering only its own tile stays home', () => {
    const target = resolveDropTarget({ pointerX: 250, pointerY: 400, bounds, previewRect: dockedRects.a, dockedRects, floating: [], draggedPaneId: 'a' })
    expect(target.kind).toBe('return-home')
  })
})

describe('computeMagneticAdjustment', () => {
  it('snaps a near-edge rectangle to the canvas boundary and reports a guide', () => {
    const rect: PixelRect = { x: 4, y: 300, width: 360, height: 220 }
    const result = computeMagneticAdjustment(rect, bounds, [])
    expect(result.dx).toBe(-4)
    expect(result.guides.some((guide) => guide.orientation === 'vertical')).toBe(true)
  })

  it('leaves a far-from-edge rectangle untouched', () => {
    const rect: PixelRect = { x: 400, y: 300, width: 200, height: 200 }
    const result = computeMagneticAdjustment(rect, bounds, [])
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.guides).toHaveLength(0)
  })
})
