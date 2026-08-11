/**
 * Web Worker entry point for `layoutCore.computeLayout`. Loaded via
 * `new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })` in
 * `layoutClient.ts` — a browser-native API, not a new dependency (UI-SPEC.md §3.1).
 *
 * This file is intentionally the *only* place that imports `layoutCore` for production layout
 * work; `SchemaCanvas.tsx`/`TableNode.tsx` never import it directly, which is what keeps layout
 * off the render path (verified by `largeSchema.bench.test.ts`'s structural source check).
 */
import { computeLayout, type LayoutEdgeInput, type LayoutNodeInput, type LayoutPreferences } from './layoutCore'

export interface LayoutWorkerRequest {
  requestId: string
  nodes: LayoutNodeInput[]
  edges: LayoutEdgeInput[]
  prefs: LayoutPreferences
}

export interface LayoutWorkerResponse {
  requestId: string
  positions: Record<string, { x: number; y: number }>
  bounds: { width: number; height: number }
  computeMs: number
}

self.onmessage = (event: MessageEvent<LayoutWorkerRequest>) => {
  const { requestId, nodes, edges, prefs } = event.data
  const result = computeLayout(nodes, edges, prefs)
  const response: LayoutWorkerResponse = { requestId, positions: result.positions, bounds: result.bounds, computeMs: result.computeMs }
  self.postMessage(response)
}
