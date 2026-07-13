import { describe, expect, it } from 'vitest'
import { computeResizedRect } from './resizeController'
import type { PixelRect } from './canvasTypes'

const bounds = { width: 1000, height: 800 }
const base: PixelRect = { x: 300, y: 200, width: 400, height: 300 }

describe('computeResizedRect', () => {
  it('grows from the right edge', () => {
    const { rect } = computeResizedRect(base, 'right', 60, 0, bounds)
    expect(rect.width).toBe(460)
    expect(rect.x).toBe(300)
  })

  it('grows from the left edge, moving the origin', () => {
    const { rect } = computeResizedRect(base, 'left', -50, 0, bounds)
    expect(rect.x).toBe(250)
    expect(rect.width).toBe(450)
  })

  it('enforces the minimum floating width, anchoring the opposite edge on a left drag', () => {
    const { rect } = computeResizedRect(base, 'left', 1000, 0, bounds)
    expect(rect.width).toBe(360)
    // Right edge stays put at base.x + base.width = 700.
    expect(rect.x + rect.width).toBe(700)
  })

  it('keeps the rectangle inside the canvas', () => {
    const { rect } = computeResizedRect({ x: 900, y: 0, width: 400, height: 300 }, 'right', 500, 0, bounds)
    expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width)
  })

  it('snaps a moving edge to the canvas boundary and reports a guide', () => {
    const { rect, guides } = computeResizedRect({ x: 8, y: 200, width: 400, height: 300 }, 'left', -8, 0, bounds)
    expect(rect.x).toBe(0)
    expect(guides.some((guide) => guide.orientation === 'vertical' && guide.position === 0)).toBe(true)
  })

  it('resizes a corner on both axes', () => {
    const { rect } = computeResizedRect(base, 'bottom-right', 40, 30, bounds)
    expect(rect.width).toBe(440)
    expect(rect.height).toBe(330)
  })
})
