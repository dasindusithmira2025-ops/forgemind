/**
 * Deterministic 400-table / ~12-namespace fixture for `largeSchema.bench.test.ts`. Shared so the
 * canvas store and any future consumer build the identical fixture the benchmark itself asserts
 * against.
 */
import type { LayoutEdgeInput, LayoutNodeInput } from './layoutCore'

export const LARGE_SCHEMA_TABLE_COUNT = 400
export const LARGE_SCHEMA_GROUP_COUNT = 12
export const LARGE_SCHEMA_VIEWPORT = { width: 1440, height: 900 }

export interface LargeSchemaFixture {
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
}

/** ~1.5 edges/table, mostly intra-group with a few cross-group references. */
export function buildLargeSchemaFixture(): LargeSchemaFixture {
  const nodes: LayoutNodeInput[] = Array.from({ length: LARGE_SCHEMA_TABLE_COUNT }, (_, index) => ({
    id: `table_${index}`,
    w: 220,
    h: 140,
    group: `namespace_${index % LARGE_SCHEMA_GROUP_COUNT}`,
  }))

  const edges: LayoutEdgeInput[] = []
  for (let index = 0; index < LARGE_SCHEMA_TABLE_COUNT; index += 1) {
    const edgeCount = index % 2 === 0 ? 2 : 1 // averages 1.5 edges/table
    for (let step = 1; step <= edgeCount; step += 1) {
      const crossGroup = (index + step) % 17 === 0
      const targetIndex = crossGroup
        ? (index + LARGE_SCHEMA_TABLE_COUNT / 2 + step) % LARGE_SCHEMA_TABLE_COUNT
        : (index + step) % LARGE_SCHEMA_TABLE_COUNT
      if (targetIndex === index) continue
      edges.push({ from: `table_${index}`, to: `table_${targetIndex}` })
    }
  }

  return { nodes, edges }
}
