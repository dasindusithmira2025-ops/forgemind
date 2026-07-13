import { useCallback, useEffect, useRef } from 'react'
import { CANVAS_CONSTANTS } from './canvasConstants'
import { clamp, defaultFloatRectAt } from './geometryEngine'
import { computeCanvasView, floatingPixelRects } from './canvasSelectors'
import { applyDrop } from './layoutOperations'
import { computeMagneticAdjustment, resolveDropTarget } from './snapResolver'
import { useCanvasStore } from './canvasStore'
import type { CanvasBounds, DockDropTarget, PaneDragSession, PanePlacementKind, PixelRect, WorkspaceCanvasLayout } from './canvasTypes'

/**
 * Pointer-driven drag engine for pane windows. Uses native Pointer Events (never HTML5 DnD),
 * pointer capture, a movement activation threshold, rAF-batched preview updates, and clean
 * cancellation on Escape / pointer-cancel / window blur. It mutates only transient store state
 * during the gesture and commits the layout exactly once on a valid drop.
 *
 * All per-gesture listeners are bound through a single AbortController so teardown can never
 * leak, regardless of how many times the host component re-renders mid-drag.
 */

interface DragControllerOptions {
  canvasRef: React.RefObject<HTMLDivElement | null>
  getBounds: () => CanvasBounds
  persist: (next: WorkspaceCanvasLayout) => void
  disabled?: boolean
}

interface PendingState {
  paneId: string
  placement: PanePlacementKind
  pointerId: number
  startClientX: number
  startClientY: number
  baseRect: PixelRect
  offsetX: number
  offsetY: number
  activated: boolean
}

export function usePaneDragController(options: DragControllerOptions) {
  const { canvasRef } = options
  const optionsRef = useRef(options)
  optionsRef.current = options

  const pendingRef = useRef<PendingState | undefined>(undefined)
  const abortRef = useRef<AbortController | undefined>(undefined)
  const frameRef = useRef<number>(0)
  const pointerRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  const clientToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY }
    },
    [canvasRef],
  )

  const runFrame = useCallback(() => {
    frameRef.current = 0
    const pending = pendingRef.current
    if (!pending?.activated) return
    const bounds = optionsRef.current.getBounds()
    const store = useCanvasStore.getState()
    const layout = store.layout
    if (!layout) return

    const point = clientToCanvas(pointerRef.current.x, pointerRef.current.y)
    let previewRect: PixelRect = {
      x: point.x - pending.offsetX,
      y: point.y - pending.offsetY,
      width: pending.baseRect.width,
      height: pending.baseRect.height,
    }

    const view = computeCanvasView(layout, bounds)
    const dockedRects: Record<string, PixelRect> = {}
    for (const pane of view.panes) if (pane.kind === 'docked') dockedRects[pane.paneId] = pane.rect
    const floating = floatingPixelRects(layout, bounds)

    let target: DockDropTarget = resolveDropTarget({
      pointerX: point.x,
      pointerY: point.y,
      bounds,
      previewRect,
      dockedRects,
      floating,
      draggedPaneId: pending.paneId,
      previous: store.drag?.activeDropTarget,
    })

    let guides = store.guides
    if (target.kind === 'float') {
      const others = floating.filter((entry) => entry.paneId !== pending.paneId).map((entry) => entry.rect)
      const magnetic = computeMagneticAdjustment(previewRect, bounds, others)
      previewRect = { x: previewRect.x + magnetic.dx, y: previewRect.y + magnetic.dy, width: previewRect.width, height: previewRect.height }
      target = { kind: 'float', rect: previewRect }
      guides = magnetic.guides
    } else {
      guides = []
    }

    store.updateDrag({ previewRect, activeDropTarget: target, guides })
  }, [clientToCanvas])

  const scheduleFrame = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(runFrame)
  }, [runFrame])

  const finish = useCallback(
    (commit: boolean) => {
      const pending = pendingRef.current
      pendingRef.current = undefined
      abortRef.current?.abort()
      abortRef.current = undefined
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      if (pending && canvasRef.current?.hasPointerCapture(pending.pointerId)) {
        canvasRef.current.releasePointerCapture(pending.pointerId)
      }

      const store = useCanvasStore.getState()
      const drag = store.drag
      if (!commit || !pending?.activated || !drag || !store.layout) {
        store.clearDrag()
        return
      }
      const layout = store.layout
      const bounds = optionsRef.current.getBounds()
      const isReturnHome =
        drag.activeDropTarget?.kind === 'float' &&
        pending.placement === 'docked' &&
        pointerInside(clientToCanvas(pointerRef.current.x, pointerRef.current.y), pending.baseRect)
      const resolved: DockDropTarget | undefined = isReturnHome ? { kind: 'return-home' } : drag.activeDropTarget
      const next = applyDrop(layout, drag, resolved, bounds, new Date().toISOString())
      store.clearDrag()
      if (next !== layout) {
        store.markSettling([drag.paneId])
        optionsRef.current.persist(next)
        window.setTimeout(() => useCanvasStore.getState().clearSettling(), CANVAS_CONSTANTS.settleAnimationMs + 40)
      }
    },
    [canvasRef, clientToCanvas],
  )

  const beginHeaderDrag = useCallback(
    (paneId: string, placement: PanePlacementKind, baseRect: PixelRect, event: React.PointerEvent) => {
      if (optionsRef.current.disabled || event.button !== 0 || pendingRef.current) return
      const targetEl = event.target as HTMLElement
      if (targetEl.closest('button, input, a, .terminal-controls, .terminal-search')) return

      const point = clientToCanvas(event.clientX, event.clientY)
      pendingRef.current = {
        paneId,
        placement,
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        baseRect,
        offsetX: clamp(point.x - baseRect.x, 0, baseRect.width),
        offsetY: clamp(point.y - baseRect.y, 0, baseRect.height),
        activated: false,
      }
      pointerRef.current = { x: event.clientX, y: event.clientY }

      const controller = new AbortController()
      abortRef.current = controller
      const signal = controller.signal

      window.addEventListener(
        'pointermove',
        (moveEvent: PointerEvent) => {
          const pending = pendingRef.current
          if (!pending || moveEvent.pointerId !== pending.pointerId) return
          pointerRef.current = { x: moveEvent.clientX, y: moveEvent.clientY }
          if (!pending.activated) {
            const distance = Math.hypot(moveEvent.clientX - pending.startClientX, moveEvent.clientY - pending.startClientY)
            if (distance < CANVAS_CONSTANTS.dragActivationThreshold) return
            pending.activated = true
            canvasRef.current?.setPointerCapture(pending.pointerId)
            const session: PaneDragSession = {
              paneId: pending.paneId,
              sourcePlacement: pending.placement,
              pointerId: pending.pointerId,
              pointerOffsetX: pending.offsetX,
              pointerOffsetY: pending.offsetY,
              previewRect: pending.baseRect,
              startedAt: performance.now(),
              phase: 'dragging',
            }
            useCanvasStore.getState().startDrag(session)
          }
          scheduleFrame()
        },
        { signal },
      )
      window.addEventListener('pointerup', (upEvent: PointerEvent) => {
        if (pendingRef.current && upEvent.pointerId === pendingRef.current.pointerId) finish(true)
      }, { signal })
      window.addEventListener('pointercancel', () => finish(false), { signal })
      window.addEventListener('blur', () => finish(false), { signal })
      window.addEventListener(
        'keydown',
        (keyEvent: KeyboardEvent) => {
          if (keyEvent.key === 'Escape') {
            keyEvent.preventDefault()
            keyEvent.stopPropagation()
            finish(false)
          }
        },
        { signal, capture: true },
      )
    },
    [canvasRef, clientToCanvas, finish, scheduleFrame],
  )

  useEffect(() => () => finish(false), [finish])

  return { beginHeaderDrag }
}

/** Convenience for programmatic float (keyboard / context menu). */
export function floatRectForKeyboard(bounds: CanvasBounds): PixelRect {
  return defaultFloatRectAt(bounds.width / 2, bounds.height / 3, bounds)
}

function pointerInside(point: { x: number; y: number }, rect: PixelRect): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}
