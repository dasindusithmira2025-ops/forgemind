import { describe, expect, it } from 'vitest'
import { computeFitZoom, computeInitialFraming, initialZoomBand } from './canvasSelectors'

const VIEWPORT_W = 1400
const VIEWPORT_H = 800
const PADDING = 48

describe('initial graph framing is chosen for comprehension, not for fitting', () => {
  it('opens a two-table schema close enough to read a card instead of leaving it adrift', () => {
    // Two 220x180 cards side by side: a pure fit would zoom far past 1 and, clamped at 1, would
    // leave two small cards floating in an otherwise empty canvas.
    const bounds = { x: 0, y: 0, width: 560, height: 200 }
    const pureFit = computeFitZoom(bounds, VIEWPORT_W, VIEWPORT_H, PADDING)
    expect(pureFit).toBeGreaterThan(1.4)

    const framed = computeInitialFraming(bounds, 2, VIEWPORT_W, VIEWPORT_H, PADDING)!
    expect(framed.zoom).toBe(1.4)
    expect(framed.zoom).toBeGreaterThan(1)
  })

  it('never shrinks a large schema past legibility just to fit every table on screen', () => {
    // 300 tables laid out over a very large world: fitting all of it would be unreadable.
    const bounds = { x: 0, y: 0, width: 24_000, height: 14_000 }
    expect(computeFitZoom(bounds, VIEWPORT_W, VIEWPORT_H, PADDING)).toBeLessThan(0.06)

    const framed = computeInitialFraming(bounds, 300, VIEWPORT_W, VIEWPORT_H, PADDING)!
    expect(framed.zoom).toBe(initialZoomBand(300).min)
    expect(framed.zoom).toBeGreaterThanOrEqual(0.3)
  })

  it('uses a medium band for an ordinary schema, between the two extremes', () => {
    const small = initialZoomBand(3)
    const medium = initialZoomBand(20)
    const large = initialZoomBand(300)
    expect(small.max).toBeGreaterThan(medium.max)
    expect(medium.max).toBeGreaterThan(large.max)
    expect(small.min).toBeGreaterThan(large.min)
  })

  it('respects a genuine fit when it already falls inside the band', () => {
    // Twelve cards that happen to fit at ~0.7 — no clamping should occur.
    const bounds = { x: 0, y: 0, width: 1800, height: 1000 }
    const fit = computeFitZoom(bounds, VIEWPORT_W, VIEWPORT_H, PADDING)
    const framed = computeInitialFraming(bounds, 12, VIEWPORT_W, VIEWPORT_H, PADDING)!
    expect(framed.zoom).toBeCloseTo(fit, 5)
  })

  it('centres content that is smaller than the viewport', () => {
    const bounds = { x: 0, y: 0, width: 400, height: 200 }
    const framed = computeInitialFraming(bounds, 2, VIEWPORT_W, VIEWPORT_H, PADDING)!
    const renderedW = bounds.width * framed.zoom
    // Equal gap on both sides of the framed content.
    expect(framed.x).toBeCloseTo(VIEWPORT_W / 2 - renderedW / 2, 5)
  })

  it('returns nothing for a graph with no extent, so the caller leaves the viewport alone', () => {
    expect(computeInitialFraming({ x: 0, y: 0, width: 0, height: 0 }, 0, VIEWPORT_W, VIEWPORT_H, PADDING)).toBeUndefined()
    expect(computeInitialFraming({ x: 0, y: 0, width: 100, height: 100 }, 1, 0, 0, PADDING)).toBeUndefined()
  })
})
