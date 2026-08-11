/**
 * Promise wrapper around the layout Worker, with a same-thread synchronous fallback for
 * environments without `Worker` (Vitest's jsdom environment). `layoutCore` itself stays
 * unit-testable in isolation; this module is what `DiagramSection`'s effect calls, and it is the
 * only place besides `layoutWorker.ts` that imports `layoutCore` for actual computation — never
 * `SchemaCanvas.tsx` or `TableNode.tsx`.
 */
import { computeLayout, type LayoutEdgeInput, type LayoutNodeInput, type LayoutPreferences, type LayoutResult } from './layoutCore'
import type { LayoutWorkerRequest, LayoutWorkerResponse } from './layoutWorker'

let worker: Worker | undefined
let workerAttempted = false
const pending = new Map<string, (result: LayoutResult) => void>()

function getWorker(): Worker | undefined {
  if (workerAttempted) return worker
  workerAttempted = true
  if (typeof Worker === 'undefined') return undefined
  try {
    worker = new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<LayoutWorkerResponse>) => {
      const resolve = pending.get(event.data.requestId)
      if (resolve) {
        pending.delete(event.data.requestId)
        resolve({ positions: event.data.positions, bounds: event.data.bounds, computeMs: event.data.computeMs })
      }
    }
    return worker
  } catch {
    return undefined
  }
}

let requestCounter = 0

/**
 * Compute layout off the render path. Uses the Worker when available; falls back to the same
 * synchronous `computeLayout` call (still off any React render/effect body, just not
 * thread-parallel) when no Worker exists — this keeps tests deterministic without requiring a
 * real Worker polyfill, per UI-SPEC.md §3.1.
 */
export function computeLayoutAsync(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], prefs: LayoutPreferences = {}): Promise<LayoutResult> {
  const activeWorker = getWorker()
  if (!activeWorker) return Promise.resolve(computeLayout(nodes, edges, prefs))

  requestCounter += 1
  const requestId = `layout-${requestCounter}`
  return new Promise((resolve) => {
    pending.set(requestId, resolve)
    const request: LayoutWorkerRequest = { requestId, nodes, edges, prefs }
    activeWorker.postMessage(request)
  })
}

/** Test/dev hook to force the synchronous fallback path regardless of Worker availability. */
export function computeLayoutSync(nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], prefs: LayoutPreferences = {}): LayoutResult {
  return computeLayout(nodes, edges, prefs)
}
