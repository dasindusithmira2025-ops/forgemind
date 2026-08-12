import { create } from 'zustand'
import type { DatabaseSemanticLod, SemanticId } from '../../databaseTypes'
import { computeInitialFraming, computeLod, type WorldRect } from './canvasSelectors'
import { computeLayoutAsync } from './layoutClient'
import type { LayoutEdgeInput, LayoutNodeInput } from './layoutCore'

export interface CanvasViewport {
  x: number
  y: number
  zoom: number
}

const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 0.6 }
const MIN_ZOOM = 0.08
const MAX_ZOOM = 2.5

interface DatabaseCanvasState {
  viewport: CanvasViewport
  lod: DatabaseSemanticLod
  positions: Record<SemanticId, { x: number; y: number }>
  bounds: { width: number; height: number }
  layoutComputeMs?: number
  layoutFingerprint?: string
  /** The fingerprint of the most recently *requested* recompute, used to drop stale resolutions. */
  requestedFingerprint?: string
  layoutPending: boolean
  /**
   * The graph identity the current viewport was automatically framed for. Re-framing happens when
   * this changes (a different source, layer or schema revision) and never otherwise, so a viewport
   * the developer panned or zoomed by hand survives selection, search, hover and re-layout.
   */
  framedKey?: string

  setViewport: (viewport: Partial<CanvasViewport>) => void
  zoomAround: (delta: number, anchorScreenX: number, anchorScreenY: number, containerRect: DOMRect) => void
  fitToRect: (bounds: { x: number; y: number; width: number; height: number }, screenW: number, screenH: number, paddingPx: number) => void
  /**
   * Recompute layout off the render path. `pinned` positions are excluded from recomputation and
   * kept verbatim, so a schema change never rearranges a user-customized layout (UI-SPEC.md §3.1).
   */
  recomputeLayout: (nodes: LayoutNodeInput[], edges: LayoutEdgeInput[], pinned: Record<SemanticId, { x: number; y: number }>, fingerprint: string) => Promise<void>
  /**
   * Frame a newly-loaded graph for comprehension. A no-op when `key` has already been framed, which
   * is what makes this safe to call from a render effect without fighting the user's own viewport.
   */
  frameGraph: (bounds: WorldRect, nodeCount: number, screenW: number, screenH: number, paddingPx: number, key: string) => void
  /** Centre `point` without changing zoom below a readable floor — used by search and reveal. */
  centerOn: (point: { x: number; y: number }, screenW: number, screenH: number, minZoom?: number) => void
}

export const useDatabaseCanvasStore = create<DatabaseCanvasState>((set, get) => ({
  viewport: DEFAULT_VIEWPORT,
  lod: computeLod(DEFAULT_VIEWPORT.zoom),
  positions: {},
  bounds: { width: 0, height: 0 },
  layoutPending: false,

  setViewport: (partial) => {
    const next = { ...get().viewport, ...partial }
    set({ viewport: next, lod: computeLod(next.zoom) })
  },

  zoomAround: (delta, anchorScreenX, anchorScreenY, containerRect) => {
    const { viewport } = get()
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * (1 - delta / 500)))
    // Keep the world point under the cursor stationary while zooming.
    const worldX = (anchorScreenX - containerRect.left - viewport.x) / viewport.zoom
    const worldY = (anchorScreenY - containerRect.top - viewport.y) / viewport.zoom
    const nextX = anchorScreenX - containerRect.left - worldX * nextZoom
    const nextY = anchorScreenY - containerRect.top - worldY * nextZoom
    set({ viewport: { x: nextX, y: nextY, zoom: nextZoom }, lod: computeLod(nextZoom) })
  },

  fitToRect: (bounds, screenW, screenH, paddingPx) => {
    if (bounds.width <= 0 || bounds.height <= 0) return
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(
      (screenW - paddingPx * 2) / bounds.width,
      (screenH - paddingPx * 2) / bounds.height,
    )))
    const x = paddingPx - bounds.x * zoom + Math.max(0, (screenW - paddingPx * 2 - bounds.width * zoom) / 2)
    const y = paddingPx - bounds.y * zoom + Math.max(0, (screenH - paddingPx * 2 - bounds.height * zoom) / 2)
    set({ viewport: { x, y, zoom }, lod: computeLod(zoom) })
  },

  frameGraph: (bounds, nodeCount, screenW, screenH, paddingPx, key) => {
    if (get().framedKey === key) return
    const framed = computeInitialFraming(bounds, nodeCount, screenW, screenH, paddingPx)
    if (!framed) return
    set({ viewport: framed, lod: computeLod(framed.zoom), framedKey: key })
  },

  centerOn: (point, screenW, screenH, minZoom = 0.7) => {
    const { viewport } = get()
    const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, viewport.zoom))
    set({
      viewport: { x: screenW / 2 - point.x * zoom, y: screenH / 2 - point.y * zoom, zoom },
      lod: computeLod(zoom),
    })
  },

  recomputeLayout: async (nodes, edges, pinned, fingerprint) => {
    if (get().layoutFingerprint === fingerprint && !get().layoutPending) return
    set({ layoutPending: true, requestedFingerprint: fingerprint })
    const result = await computeLayoutAsync(nodes, edges, { pinned })
    // Stale-result guard: if another recompute started after this one, drop this resolution.
    if (get().requestedFingerprint !== fingerprint) return
    set({
      positions: result.positions,
      bounds: result.bounds,
      layoutComputeMs: result.computeMs,
      layoutFingerprint: fingerprint,
      layoutPending: false,
    })
  },

}))
