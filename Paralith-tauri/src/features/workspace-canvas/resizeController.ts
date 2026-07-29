import { useCallback, useEffect, useRef } from 'react'
import { CANVAS_CONSTANTS } from './canvasConstants'
import { clamp, normalizeSplitSizes, pixelToNormalized, rectAtPath, type SplitHandle } from './geometryEngine'
import { movePaneToFloat, setSizesAtPath } from './layoutOperations'
import { useCanvasStore } from './canvasStore'
import type { CanvasBounds, FloatingResizeSession, MagneticGuide, PixelRect, ResizeEdge, WorkspaceCanvasLayout } from './canvasTypes'

interface ControllerOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>
  getBounds: () => CanvasBounds
  persist: (next: WorkspaceCanvasLayout) => void
}

/** Compute the resized rectangle for one drag frame, enforcing minimum size + canvas bounds. */
export function computeResizedRect(base: PixelRect, edge: ResizeEdge, dx: number, dy: number, bounds: CanvasBounds): { rect: PixelRect; guides: MagneticGuide[] } {
  const minW = Math.min(CANVAS_CONSTANTS.minFloatingWidth, bounds.width)
  const minH = Math.min(CANVAS_CONSTANTS.minFloatingHeight, bounds.height)
  let { x, y, width, height } = base

  if (edge.includes('left')) {
    x = base.x + dx
    width = base.width - dx
  }
  if (edge.includes('right')) width = base.width + dx
  if (edge.includes('top')) {
    y = base.y + dy
    height = base.height - dy
  }
  if (edge.includes('bottom')) height = base.height + dy

  const guides: MagneticGuide[] = []
  const threshold = CANVAS_CONSTANTS.magneticAlignThreshold
  // Snap the moving edges to the canvas boundary when close.
  if (edge.includes('left') && Math.abs(x) < threshold) { width += x; x = 0; guides.push({ orientation: 'vertical', position: 0 }) }
  if (edge.includes('right') && Math.abs(x + width - bounds.width) < threshold) { width = bounds.width - x; guides.push({ orientation: 'vertical', position: bounds.width }) }
  if (edge.includes('top') && Math.abs(y) < threshold) { height += y; y = 0; guides.push({ orientation: 'horizontal', position: 0 }) }
  if (edge.includes('bottom') && Math.abs(y + height - bounds.height) < threshold) { height = bounds.height - y; guides.push({ orientation: 'horizontal', position: bounds.height }) }

  // Enforce minimums, anchoring the opposite (non-dragged) edge.
  if (width < minW) {
    if (edge.includes('left')) x = base.x + base.width - minW
    width = minW
  }
  if (height < minH) {
    if (edge.includes('top')) y = base.y + base.height - minH
    height = minH
  }
  // Keep within the canvas.
  x = clamp(x, 0, Math.max(0, bounds.width - width))
  y = clamp(y, 0, Math.max(0, bounds.height - height))
  width = Math.min(width, bounds.width - x)
  height = Math.min(height, bounds.height - y)

  return { rect: { x, y, width, height }, guides }
}

/** Resize handles for floating panes (8 edges/corners). */
export function useFloatingResizeController(options: ControllerOptions) {
  const { canvasRef } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const abortRef = useRef<AbortController | undefined>(undefined)
  const frameRef = useRef<number>(0)
  const stateRef = useRef<{ paneId: string; edge: ResizeEdge; pointerId: number; startX: number; startY: number; base: PixelRect } | undefined>(undefined)
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const runFrame = useCallback(() => {
    frameRef.current = 0
    const state = stateRef.current
    if (!state) return
    const bounds = optionsRef.current.getBounds()
    const dx = pointerRef.current.x - state.startX
    const dy = pointerRef.current.y - state.startY
    const { rect, guides } = computeResizedRect(state.base, state.edge, dx, dy, bounds)
    useCanvasStore.getState().updateResize(rect, guides)
  }, [])

  const finish = useCallback((commit: boolean) => {
    const state = stateRef.current
    stateRef.current = undefined
    abortRef.current?.abort()
    abortRef.current = undefined
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    const store = useCanvasStore.getState()
    const resize = store.resize
    if (state && canvasRef.current?.hasPointerCapture(state.pointerId)) canvasRef.current.releasePointerCapture(state.pointerId)
    if (!commit || !state || !resize || !store.layout) { store.clearResize(); return }
    const bounds = optionsRef.current.getBounds()
    const normalized = pixelToNormalized(resize.currentRect, bounds)
    const next = movePaneToFloat(store.layout, state.paneId, normalized, new Date().toISOString())
    store.clearResize()
    optionsRef.current.persist(next)
  }, [canvasRef])

  const beginResize = useCallback(
    (paneId: string, edge: ResizeEdge, baseRect: PixelRect, event: React.PointerEvent) => {
      if (event.button !== 0 || stateRef.current) return
      event.preventDefault()
      event.stopPropagation()
      stateRef.current = { paneId, edge, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, base: baseRect }
      pointerRef.current = { x: event.clientX, y: event.clientY }
      canvasRef.current?.setPointerCapture(event.pointerId)
      const session: FloatingResizeSession = { paneId, edge, pointerId: event.pointerId, startPointerX: event.clientX, startPointerY: event.clientY, startRect: baseRect, currentRect: baseRect }
      useCanvasStore.getState().startResize(session)

      const controller = new AbortController()
      abortRef.current = controller
      const signal = controller.signal
      window.addEventListener('pointermove', (moveEvent: PointerEvent) => {
        if (!stateRef.current || moveEvent.pointerId !== stateRef.current.pointerId) return
        pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
        if (!frameRef.current) frameRef.current = requestAnimationFrame(runFrame)
      }, { signal })
      window.addEventListener('pointerup', (upEvent: PointerEvent) => { if (stateRef.current && upEvent.pointerId === stateRef.current.pointerId) finish(true) }, { signal })
      window.addEventListener('pointercancel', () => finish(false), { signal })
      window.addEventListener('blur', () => finish(false), { signal })
      window.addEventListener('keydown', (keyEvent: KeyboardEvent) => { if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); finish(false) } }, { signal, capture: true })
    },
    [canvasRef, finish, runFrame],
  )

  useEffect(() => () => finish(false), [finish])
  return { beginResize }
}

/** Resize handles between docked panes (adjusts two adjacent split sizes). */
export function useSplitResizeController(options: ControllerOptions) {
  const { canvasRef } = options
  const optionsRef = useRef(options)
  optionsRef.current = options
  const abortRef = useRef<AbortController | undefined>(undefined)
  const frameRef = useRef<number>(0)
  const stateRef = useRef<{ handle: SplitHandle; pointerId: number; startX: number; startY: number; startSizes: number[]; contentExtent: number; minPct: number } | undefined>(undefined)
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const runFrame = useCallback(() => {
    frameRef.current = 0
    const state = stateRef.current
    const store = useCanvasStore.getState()
    if (!state || !store.layout?.dockedRoot) return
    const isColumns = state.handle.direction === 'vertical'
    const delta = isColumns ? pointerRef.current.x - state.startX : pointerRef.current.y - state.startY
    const deltaPct = state.contentExtent > 0 ? (delta / state.contentExtent) * 100 : 0
    const i = state.handle.index
    const pair = state.startSizes[i] + state.startSizes[i + 1]
    const nextI = clamp(state.startSizes[i] + deltaPct, state.minPct, pair - state.minPct)
    const sizes = [...state.startSizes]
    sizes[i] = nextI
    sizes[i + 1] = pair - nextI
    const dockedRoot = setSizesAtPath(store.layout.dockedRoot, state.handle.path, sizes)
    store.setLayout({ ...store.layout, dockedRoot })
  }, [])

  const finish = useCallback((commit: boolean) => {
    const state = stateRef.current
    stateRef.current = undefined
    abortRef.current?.abort()
    abortRef.current = undefined
    if (frameRef.current) cancelAnimationFrame(frameRef.current)
    frameRef.current = 0
    const store = useCanvasStore.getState()
    if (state && canvasRef.current?.hasPointerCapture(state.pointerId)) canvasRef.current.releasePointerCapture(state.pointerId)
    if (commit && store.layout) optionsRef.current.persist(store.layout)
  }, [canvasRef])

  const beginSplitResize = useCallback(
    (handle: SplitHandle, event: React.PointerEvent) => {
      if (event.button !== 0 || stateRef.current) return
      event.preventDefault()
      const bounds = optionsRef.current.getBounds()
      const store = useCanvasStore.getState()
      const splitRect = rectAtPath(store.layout?.dockedRoot ?? null, bounds, handle.path)
      if (!splitRect || !store.layout?.dockedRoot) return
      const split = pathSplit(store.layout.dockedRoot, handle.path)
      if (!split) return
      const isColumns = handle.direction === 'vertical'
      const count = split.children.length
      const totalExtent = isColumns ? splitRect.width : splitRect.height
      const contentExtent = Math.max(1, totalExtent - 6 * (count - 1))
      const minPx = isColumns ? CANVAS_CONSTANTS.minDockedWidth : CANVAS_CONSTANTS.minDockedHeight
      const minPct = Math.min(45, (minPx / contentExtent) * 100)
      stateRef.current = { handle, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startSizes: normalizeSplitSizes(split.sizes, count), contentExtent, minPct }
      pointerRef.current = { x: event.clientX, y: event.clientY }
      canvasRef.current?.setPointerCapture(event.pointerId)

      const controller = new AbortController()
      abortRef.current = controller
      const signal = controller.signal
      window.addEventListener('pointermove', (moveEvent: PointerEvent) => {
        if (!stateRef.current || moveEvent.pointerId !== stateRef.current.pointerId) return
        pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
        if (!frameRef.current) frameRef.current = requestAnimationFrame(runFrame)
      }, { signal })
      window.addEventListener('pointerup', (upEvent: PointerEvent) => { if (stateRef.current && upEvent.pointerId === stateRef.current.pointerId) finish(true) }, { signal })
      window.addEventListener('pointercancel', () => finish(false), { signal })
      window.addEventListener('blur', () => finish(false), { signal })
    },
    [canvasRef, finish, runFrame],
  )

  useEffect(() => () => finish(false), [finish])
  return { beginSplitResize }
}

function pathSplit(root: WorkspaceCanvasLayout['dockedRoot'], path: number[]): Extract<NonNullable<WorkspaceCanvasLayout['dockedRoot']>, { type: 'split' }> | undefined {
  let node = root
  for (const index of path) {
    if (!node || node.type !== 'split') return undefined
    node = node.children[index]
  }
  return node && node.type === 'split' ? node : undefined
}
