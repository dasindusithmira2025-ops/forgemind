import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { computeCanvasView } from '../canvasSelectors'
import { useCanvasStore } from '../canvasStore'
import { usePaneDragController } from '../dragController'
import { useSplitResizeController } from '../resizeController'
import { dockPaneAtCanvasEdge } from '../layoutOperations'
import type { CanvasBounds, CanvasSnapZone, PanePlacementKind, WorkspaceCanvasLayout } from '../canvasTypes'
import { TerminalPaneWindow } from './TerminalPaneWindow'
import { DockingOverlayLayer } from './DockingOverlayLayer'
import { SplitResizeHandleLayer } from './SplitResizeHandleLayer'

const FALLBACK_BOUNDS: CanvasBounds = { width: 1280, height: 800 }

export interface RenderPaneContext {
  placement: PanePlacementKind
  active: boolean
  maximized: boolean
  onHeaderPointerDown: (event: ReactPointerEvent) => void
}

interface WorkspaceCanvasProps {
  reducedMotion: boolean
  /** Persist a committed layout; `previous` is supplied so the parent can roll back on failure. */
  persist: (next: WorkspaceCanvasLayout, previous: WorkspaceCanvasLayout) => void
  onFocusPane: (paneId: string) => void
  renderPane: (paneId: string, context: RenderPaneContext) => ReactNode
}

/**
 * The docking canvas. It owns geometry, drag/resize orchestration and overlays; it renders one
 * stably-keyed {@link TerminalPaneWindow} per pane so the live terminals inside never remount as
 * their placement changes. Persisted layout lives in {@link useCanvasStore}; this component turns
 * it into pixels and interaction.
 */
export function WorkspaceCanvas({ reducedMotion, persist, onFocusPane, renderPane }: WorkspaceCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const layout = useCanvasStore((state) => state.layout)
  const bounds = useCanvasStore((state) => state.bounds)
  const drag = useCanvasStore((state) => state.drag)
  const guides = useCanvasStore((state) => state.guides)
  const settlingPaneIds = useCanvasStore((state) => state.settlingPaneIds)

  const getBounds = useCallback((): CanvasBounds => useCanvasStore.getState().bounds, [])

  const commitPersist = useCallback(
    (next: WorkspaceCanvasLayout) => {
      const previous = useCanvasStore.getState().layout
      useCanvasStore.getState().setLayout(next)
      if (previous) persist(next, previous)
    },
    [persist],
  )

  const { beginHeaderDrag } = usePaneDragController({ canvasRef, getBounds, persist: commitPersist })
  const { beginSplitResize } = useSplitResizeController({ canvasRef, getBounds, persist: commitPersist })

  // Measure the usable canvas; floating rects are normalised so they scale with these bounds.
  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const measure = () => useCanvasStore.getState().setBounds({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Before the first ResizeObserver measurement (and in non-layout test environments) fall back
  // to nominal bounds so panes still mount; real geometry snaps in as soon as bounds are known.
  const effectiveBounds = bounds.width > 0 && bounds.height > 0 ? bounds : FALLBACK_BOUNDS
  const view = useMemo(() => computeCanvasView(layout, effectiveBounds), [layout, effectiveBounds])

  const activate = useCallback(
    (paneId: string) => {
      useCanvasStore.getState().setActivePane(paneId)
      useCanvasStore.getState().bringToFront(paneId)
      onFocusPane(paneId)
    },
    [onFocusPane],
  )

  // Keyboard placement: Ctrl+Shift+Arrow docks the active pane as a full-length column / row
  // against the matching canvas edge (the keyboard equivalent of a canvas-edge snap).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const state = useCanvasStore.getState()
      const current = state.layout
      if (!current?.activePaneId) return
      const paneId = current.activePaneId
      const arrow = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]
      if (!arrow) return

      if (event.ctrlKey && event.shiftKey && !event.altKey) {
        const zone: CanvasSnapZone = arrow === 'left' ? 'left-half' : arrow === 'right' ? 'right-half' : arrow === 'up' ? 'top-half' : 'bottom-half'
        event.preventDefault()
        commitPersist(dockPaneAtCanvasEdge(current, paneId, zone))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commitPersist])

  const draggedView = drag ? view.panes.find((pane) => pane.paneId === drag.paneId) : undefined
  const maximized = Boolean(view.maximizedPaneId)

  return (
    <div className="workspace-canvas" ref={canvasRef}>
      <div className="pane-window-layer">
        {view.panes.map((pane) => {
          const isDragging = drag?.paneId === pane.paneId && drag.phase === 'dragging'
          const dragOffset = isDragging && drag ? { dx: drag.previewRect.x - pane.rect.x, dy: drag.previewRect.y - pane.rect.y } : undefined
          const isActive = pane.paneId === view.activePaneId
          return (
            <TerminalPaneWindow
              key={pane.paneId}
              view={pane}
              active={isActive}
              dragging={isDragging}
              dragOffset={dragOffset}
              settling={settlingPaneIds.includes(pane.paneId)}
              reducedMotion={reducedMotion}
            >
              <div className="pane-window-focus" onPointerDownCapture={() => activate(pane.paneId)}>
                {renderPane(pane.paneId, {
                  placement: pane.kind,
                  active: isActive,
                  maximized: pane.maximized,
                  onHeaderPointerDown: (event) => beginHeaderDrag(pane.paneId, pane.kind, pane.rect, event),
                })}
              </div>
            </TerminalPaneWindow>
          )
        })}
      </div>

      <SplitResizeHandleLayer handles={view.handles} onResizeStart={beginSplitResize} disabled={maximized || Boolean(drag)} />

      <DockingOverlayLayer dropTarget={drag?.activeDropTarget} sourceRect={draggedView?.rect} guides={guides} dragging={Boolean(drag)} />
    </div>
  )
}
