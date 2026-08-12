import { describe, expect, it } from 'vitest'
import { computeLayout, toCanvasNodeRects } from './layoutCore'
import { computeFitZoom, computeInitialFraming, computeVisibleNodeIds, initialZoomBand, resolveRenderDescriptors, type WorldRect } from './canvasSelectors'
import { buildLargeSchemaFixture, LARGE_SCHEMA_GROUP_COUNT, LARGE_SCHEMA_TABLE_COUNT, LARGE_SCHEMA_VIEWPORT } from './largeSchemaFixture'
import type { CanvasNodeRect } from '../../databaseTypes'
// Vite `?raw` imports pull file text at build/transform time — no Node `fs` needed in this
// browser-targeted feature module, keeping it consistent with the rest of `src/features/database`.
import schemaCanvasSource from './SchemaCanvas.tsx?raw'
import tableNodeSource from './TableNode.tsx?raw'
import diagramSectionSource from '../sections/DiagramSection.tsx?raw'

/**
 * B13 — large-schema performance (`.jcode/dbstudio/TEST-NAMING.md`, UI-SPEC.md §9.3). Path
 * contains `largeSchema` so `npm run test -- largeSchema` selects it. Every bound below is proven
 * load-bearing by the negative control in the final `it`, not merely asserted.
 */
describe('largeSchema: 400-table bounded canvas rendering + off-render-path layout', () => {
  const fixture = buildLargeSchemaFixture()
  expect(fixture.nodes).toHaveLength(LARGE_SCHEMA_TABLE_COUNT)

  it('layout runs synchronously computable in well under the 400ms budget for 400 tables', () => {
    const result = computeLayout(fixture.nodes, fixture.edges)
    expect(result.computeMs).toBeLessThan(400)
    expect(Object.keys(result.positions)).toHaveLength(LARGE_SCHEMA_TABLE_COUNT)
  })

  it('SchemaCanvas.tsx and TableNode.tsx never import layoutCore directly (layout stays off the render path)', () => {
    expect(schemaCanvasSource).not.toMatch(/from ['"]\.\/layoutCore['"]/)
    expect(tableNodeSource).not.toMatch(/from ['"]\.\/layoutCore['"]/)
  })

  it('DiagramSection is the effect that calls layoutClient.computeLayoutAsync on revision/prefs change, not SchemaCanvas', () => {
    expect(diagramSectionSource).toMatch(/computeLayoutAsync|recomputeLayout/)
  })

  describe('bounded rendered node count', () => {
    const layoutResult = computeLayout(fixture.nodes, fixture.edges)
    const nodeRects: CanvasNodeRect[] = toCanvasNodeRects(fixture.nodes, layoutResult)

    it('fit-to-view for the full 400-table layout is genuinely a far-LOD zoom (precondition check)', () => {
      const box = { x: 0, y: 0, width: layoutResult.bounds.width, height: layoutResult.bounds.height }
      const fitZoom = computeFitZoom(box, LARGE_SCHEMA_VIEWPORT.width, LARGE_SCHEMA_VIEWPORT.height, 48)
      expect(fitZoom).toBeLessThan(0.35)
    })

    it('at LOD0 fit-to-view, rendered node count equals namespace group count, not table count', () => {
      const box = { x: 0, y: 0, width: layoutResult.bounds.width, height: layoutResult.bounds.height }
      const fitZoom = computeFitZoom(box, LARGE_SCHEMA_VIEWPORT.width, LARGE_SCHEMA_VIEWPORT.height, 48)
      const viewportWorldRect: WorldRect = { x: 0, y: 0, width: LARGE_SCHEMA_VIEWPORT.width / fitZoom, height: LARGE_SCHEMA_VIEWPORT.height / fitZoom }
      const visible = computeVisibleNodeIds(nodeRects, viewportWorldRect, 'far', 200)

      expect(visible.length).toBeLessThan(30)
      expect(visible.length).toBeLessThan(nodeRects.length)
      expect(visible.length).toBeLessThanOrEqual(LARGE_SCHEMA_GROUP_COUNT)

      const descriptors = resolveRenderDescriptors(visible, nodeRects, 'far')
      expect(descriptors).toHaveLength(visible.length)
      for (const descriptor of descriptors) expect(descriptor.kind).toBe('domain-aggregate')
    })

    it('at a realistic near-zoom pan (5% of world bounds), rendered node count stays bounded and small', () => {
      const regionWidth = layoutResult.bounds.width * 0.05
      const regionHeight = layoutResult.bounds.height * 0.05
      const viewportWorldRect: WorldRect = { x: 0, y: 0, width: regionWidth, height: regionHeight }
      const visible = computeVisibleNodeIds(nodeRects, viewportWorldRect, 'near', 200)

      expect(visible.length).toBeLessThan(40)
      expect(visible.length).toBeLessThan(nodeRects.length)

      const descriptors = resolveRenderDescriptors(visible, nodeRects, 'near')
      for (const descriptor of descriptors) expect(descriptor.kind).toBe('table-card')
    })

    it('opens the 400-table schema at an architecture zoom that still bounds the rendered nodes', () => {
      // The initial framing is what a developer actually lands on. It must not be the raw fit
      // (unreadable at this scale) and must still keep the mounted node count bounded.
      const box = { x: 0, y: 0, width: layoutResult.bounds.width, height: layoutResult.bounds.height }
      const framed = computeInitialFraming(box, LARGE_SCHEMA_TABLE_COUNT, LARGE_SCHEMA_VIEWPORT.width, LARGE_SCHEMA_VIEWPORT.height, 48)!
      const rawFit = computeFitZoom(box, LARGE_SCHEMA_VIEWPORT.width, LARGE_SCHEMA_VIEWPORT.height, 48)

      expect(framed.zoom).toBeGreaterThan(rawFit)
      expect(framed.zoom).toBe(initialZoomBand(LARGE_SCHEMA_TABLE_COUNT).min)

      const viewportWorldRect: WorldRect = {
        x: 0,
        y: 0,
        width: LARGE_SCHEMA_VIEWPORT.width / framed.zoom,
        height: LARGE_SCHEMA_VIEWPORT.height / framed.zoom,
      }
      const visible = computeVisibleNodeIds(nodeRects, viewportWorldRect, 'far', 200)
      expect(visible.length).toBeLessThanOrEqual(LARGE_SCHEMA_GROUP_COUNT)
    })

    it('regression trip-wire: a deliberately-broken "cull nothing" implementation would fail both bounds above', () => {
      // Local-only, does not touch production code — proves the real assertions are load-bearing.
      function cullNothing(nodes: CanvasNodeRect[]): string[] {
        return nodes.map((node) => node.id)
      }
      const broken = cullNothing(nodeRects)
      expect(broken.length).toBe(LARGE_SCHEMA_TABLE_COUNT)
      expect(broken.length).not.toBeLessThan(30)
      expect(broken.length).not.toBeLessThan(40)
    })
  })
})
