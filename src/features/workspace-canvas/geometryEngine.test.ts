import { describe, expect, it } from 'vitest'
import {
  calculateDockedRects,
  clampFloatingRect,
  normalizeSplitSizes,
  normalizedToPixel,
  pixelToNormalized,
  resolveCanvasSnapRect,
  SPLIT_HANDLE_PX,
} from './geometryEngine'
import type { DockedLayoutNode } from './canvasTypes'

const bounds = { width: 1000, height: 800 }

describe('normalizeSplitSizes', () => {
  it('scales arbitrary sizes to sum 100', () => {
    expect(normalizeSplitSizes([1, 3], 2)).toEqual([25, 75])
  })
  it('falls back to equal shares when sizes are invalid', () => {
    expect(normalizeSplitSizes([0, -1], 2)).toEqual([50, 50])
    expect(normalizeSplitSizes([], 4)).toEqual([25, 25, 25, 25])
  })
})

describe('calculateDockedRects', () => {
  it('gives a single pane the whole canvas', () => {
    const { rects } = calculateDockedRects({ type: 'pane', paneId: 'a' }, bounds)
    expect(rects.a).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
  })

  it('splits width for a vertical (column) split and reserves a handle gutter', () => {
    const tree: DockedLayoutNode = {
      type: 'split',
      direction: 'vertical',
      sizes: [50, 50],
      children: [{ type: 'pane', paneId: 'l' }, { type: 'pane', paneId: 'r' }],
    }
    const { rects, handles } = calculateDockedRects(tree, bounds)
    const content = bounds.width - SPLIT_HANDLE_PX
    expect(rects.l.width).toBeCloseTo(content / 2)
    expect(rects.l.height).toBe(800)
    expect(rects.r.x).toBeCloseTo(content / 2 + SPLIT_HANDLE_PX)
    expect(handles).toHaveLength(1)
    expect(handles[0].orientation).toBe('vertical')
  })

  it('splits height for a horizontal (row) split', () => {
    const tree: DockedLayoutNode = {
      type: 'split',
      direction: 'horizontal',
      sizes: [25, 75],
      children: [{ type: 'pane', paneId: 't' }, { type: 'pane', paneId: 'b' }],
    }
    const { rects, handles } = calculateDockedRects(tree, bounds)
    const content = bounds.height - SPLIT_HANDLE_PX
    expect(rects.t.height).toBeCloseTo(content * 0.25)
    expect(rects.t.width).toBe(1000)
    expect(handles[0].orientation).toBe('horizontal')
  })

  it('computes nested 2x2 grid rectangles without overlap', () => {
    const row = (a: string, b: string): DockedLayoutNode => ({
      type: 'split', direction: 'vertical', sizes: [50, 50],
      children: [{ type: 'pane', paneId: a }, { type: 'pane', paneId: b }],
    })
    const tree: DockedLayoutNode = { type: 'split', direction: 'horizontal', sizes: [50, 50], children: [row('a', 'b'), row('c', 'd')] }
    const { rects } = calculateDockedRects(tree, bounds)
    expect(Object.keys(rects).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(rects.a.y).toBe(0)
    expect(rects.c.y).toBeGreaterThan(rects.a.y)
    expect(rects.b.x).toBeGreaterThan(rects.a.x)
  })

  it('returns nothing for a null tree or degenerate bounds', () => {
    expect(calculateDockedRects(null, bounds).rects).toEqual({})
    expect(calculateDockedRects({ type: 'pane', paneId: 'a' }, { width: 0, height: 0 }).rects).toEqual({})
  })
})

describe('clampFloatingRect', () => {
  it('enforces minimum size', () => {
    const clamped = clampFloatingRect({ x: 0, y: 0, width: 10, height: 10 }, bounds)
    expect(clamped.width).toBe(360)
    expect(clamped.height).toBe(220)
  })

  it('pulls an off-screen rectangle back into the canvas', () => {
    const clamped = clampFloatingRect({ x: 5000, y: 5000, width: 400, height: 300 }, bounds)
    expect(clamped.x).toBeLessThanOrEqual(bounds.width - 400)
    expect(clamped.y).toBeLessThanOrEqual(bounds.height - 220)
    expect(clamped.x).toBeGreaterThanOrEqual(0)
  })

  it('keeps the header reachable when the box is taller than the canvas', () => {
    const clamped = clampFloatingRect({ x: 0, y: -50, width: 400, height: 2000 }, { width: 500, height: 300 })
    expect(clamped.y).toBeGreaterThanOrEqual(0)
    expect(clamped.y).toBeLessThanOrEqual(300 - 48)
  })
})

describe('normalized <-> pixel round trip', () => {
  it('is stable', () => {
    const rect = { x: 100, y: 80, width: 300, height: 200 }
    const normalized = pixelToNormalized(rect, bounds)
    expect(normalizedToPixel(normalized, bounds)).toEqual(rect)
  })
})

describe('resolveCanvasSnapRect', () => {
  it('resolves halves', () => {
    expect(resolveCanvasSnapRect('left-half', bounds)).toEqual({ x: 0, y: 0, width: 500, height: 800 })
    expect(resolveCanvasSnapRect('bottom-half', bounds)).toEqual({ x: 0, y: 400, width: 1000, height: 400 })
  })
  it('resolves all four corners', () => {
    expect(resolveCanvasSnapRect('top-left', bounds)).toEqual({ x: 0, y: 0, width: 500, height: 400 })
    expect(resolveCanvasSnapRect('top-right', bounds)).toEqual({ x: 500, y: 0, width: 500, height: 400 })
    expect(resolveCanvasSnapRect('bottom-left', bounds)).toEqual({ x: 0, y: 400, width: 500, height: 400 })
    expect(resolveCanvasSnapRect('bottom-right', bounds)).toEqual({ x: 500, y: 400, width: 500, height: 400 })
  })
})
