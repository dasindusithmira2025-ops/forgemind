import { describe, expect, it } from 'vitest'
import {
  applyHideUnrelated,
  computeBoundingBox,
  computeFitZoom,
  computeLod,
  computeVisibleNodeIds,
  highlightedEdges,
  nHopNodes,
  resolveRenderDescriptors,
  type WorldRect,
} from './canvasSelectors'
import type { CanvasEdgeRef, CanvasNodeRect } from '../../databaseTypes'

describe('computeLod', () => {
  it('boundary values match the far/medium/near thresholds', () => {
    expect(computeLod(0.349)).toBe('far')
    expect(computeLod(0.35)).toBe('medium')
    expect(computeLod(0.849)).toBe('medium')
    expect(computeLod(0.85)).toBe('near')
  })
})

function node(id: string, x: number, y: number, groupId: string, w = 200, h = 120): CanvasNodeRect {
  return { id, x, y, w, h, groupId }
}

describe('computeVisibleNodeIds', () => {
  it('returns exactly the intersecting set at medium/near LOD', () => {
    const nodes = [node('a', 0, 0, 'g1'), node('b', 500, 0, 'g1'), node('c', 1000, 0, 'g2')]
    const viewport: WorldRect = { x: 0, y: 0, width: 300, height: 300 }
    expect(computeVisibleNodeIds(nodes, viewport, 'near', 0).sort()).toEqual(['a'])
  })

  it('respects overscan', () => {
    const nodes = [node('a', 0, 0, 'g1'), node('b', 310, 0, 'g1')]
    const viewport: WorldRect = { x: 0, y: 0, width: 300, height: 300 }
    expect(computeVisibleNodeIds(nodes, viewport, 'near', 0).sort()).toEqual(['a'])
    expect(computeVisibleNodeIds(nodes, viewport, 'near', 50).sort()).toEqual(['a', 'b'])
  })

  it('at LOD0 (far) returns group-aggregate ids, not table ids, even when tables individually intersect', () => {
    const nodes = [node('t1', 0, 0, 'g1'), node('t2', 250, 0, 'g1'), node('t3', 1000, 0, 'g2')]
    const viewport: WorldRect = { x: 0, y: 0, width: 500, height: 300 }
    const visible = computeVisibleNodeIds(nodes, viewport, 'far', 0)
    expect(visible).toEqual(['g1'])
    expect(visible).not.toContain('t1')
    expect(visible).not.toContain('t2')
  })
})

describe('resolveRenderDescriptors', () => {
  it('resolves LOD0 ids to domain-aggregate descriptors', () => {
    const nodes = [node('t1', 0, 0, 'g1')]
    const descriptors = resolveRenderDescriptors(['g1'], nodes, 'far')
    expect(descriptors).toEqual([{ id: 'g1', kind: 'domain-aggregate', groupId: 'g1' }])
  })

  it('resolves medium/near ids to table-card descriptors', () => {
    const nodes = [node('t1', 0, 0, 'g1')]
    const descriptors = resolveRenderDescriptors(['t1'], nodes, 'near')
    expect(descriptors).toEqual([{ id: 't1', kind: 'table-card', groupId: 'g1' }])
  })
})

function edge(from: string, to: string): CanvasEdgeRef {
  return { id: `${from}->${to}`, from, to }
}

describe('nHopNodes', () => {
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
  it('hop 0 returns only the selection', () => {
    expect(nHopNodes(new Set(['a']), edges, 0)).toEqual(new Set(['a']))
  })
  it('hop 1 returns direct neighbors', () => {
    expect(nHopNodes(new Set(['b']), edges, 1)).toEqual(new Set(['b', 'a', 'c']))
  })
  it('hop 2 expands transitively', () => {
    expect(nHopNodes(new Set(['a']), edges, 2)).toEqual(new Set(['a', 'b', 'c']))
  })
})

describe('highlightedEdges', () => {
  it('returns edges touching the selection', () => {
    const edges = [edge('a', 'b'), edge('c', 'd')]
    expect(highlightedEdges(new Set(['a']), edges)).toEqual([edges[0]])
  })
})

describe('applyHideUnrelated', () => {
  it('intersects visible ids with the N-hop neighborhood when a selection exists', () => {
    const edges = [edge('a', 'b'), edge('c', 'd')]
    const visible = ['a', 'b', 'c', 'd']
    expect(applyHideUnrelated(visible, new Set(['a']), edges, 1).sort()).toEqual(['a', 'b'])
  })
  it('is a no-op when nothing is selected', () => {
    const visible = ['a', 'b']
    expect(applyHideUnrelated(visible, new Set(), [], 1)).toEqual(visible)
  })
})

describe('computeBoundingBox and computeFitZoom', () => {
  it('computes the box spanning all nodes', () => {
    const nodes = [node('a', 0, 0, 'g1', 100, 100), node('b', 300, 200, 'g1', 100, 100)]
    expect(computeBoundingBox(nodes)).toEqual({ x: 0, y: 0, width: 400, height: 300 })
  })
  it('fits the box within a viewport with padding', () => {
    const zoom = computeFitZoom({ x: 0, y: 0, width: 1000, height: 500 }, 1000, 1000, 20)
    expect(zoom).toBeCloseTo(0.96, 2)
  })
})
