import { describe, expect, it } from 'vitest'
import { computeLayout, toCanvasNodeRects, type LayoutEdgeInput, type LayoutNodeInput } from './layoutCore'

function nodes(n: number, groups: number): LayoutNodeInput[] {
  return Array.from({ length: n }, (_, index) => ({
    id: `t${index}`,
    w: 200,
    h: 120,
    group: `g${index % groups}`,
  }))
}

describe('computeLayout', () => {
  it('is deterministic: same input produces the same positions', () => {
    const input = nodes(20, 4)
    const edges: LayoutEdgeInput[] = []
    const first = computeLayout(input, edges)
    const second = computeLayout(input, edges)
    expect(second.positions).toEqual(first.positions)
  })

  it('places every node at a finite, non-NaN position with no exact overlap between distinct nodes', () => {
    const input = nodes(30, 5)
    const result = computeLayout(input, [])
    const seen = new Set<string>()
    for (const node of input) {
      const position = result.positions[node.id]
      expect(position).toBeDefined()
      expect(Number.isFinite(position.x)).toBe(true)
      expect(Number.isFinite(position.y)).toBe(true)
      const key = `${position.x},${position.y}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('respects pinned positions and excludes them from automatic placement', () => {
    const input = nodes(10, 2)
    const pinned = { t0: { x: 9999, y: 9999 } }
    const result = computeLayout(input, [], { pinned })
    expect(result.positions.t0).toEqual({ x: 9999, y: 9999 })
  })

  it('only recomputes newly-appeared objects when previously-pinned ids are supplied for every existing node', () => {
    const input = nodes(5, 1)
    const first = computeLayout(input, [])
    // Simulate "pin everything from the previous layout" then add one new node.
    const pinned = { ...first.positions }
    const grown = [...input, { id: 't5', w: 200, h: 120, group: 'g0' }]
    const second = computeLayout(grown, [], { pinned })
    for (const node of input) expect(second.positions[node.id]).toEqual(first.positions[node.id])
    expect(second.positions.t5).toBeDefined()
  })
})

describe('toCanvasNodeRects', () => {
  it('maps layout positions into CanvasNodeRect shape', () => {
    const input = nodes(2, 1)
    const result = computeLayout(input, [])
    const rects = toCanvasNodeRects(input, result)
    expect(rects).toHaveLength(2)
    for (const rect of rects) {
      expect(rect.w).toBe(200)
      expect(rect.h).toBe(120)
      expect(rect.groupId).toBe('g0')
    }
  })
})
