import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { CANVAS_CONSTANTS } from '../canvasConstants'
import type { PaneView } from '../canvasSelectors'
import type { PixelRect, ResizeEdge } from '../canvasTypes'

const RESIZE_EDGES: ResizeEdge[] = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right']

interface TerminalPaneWindowProps {
  view: PaneView
  active: boolean
  dragging: boolean
  dragOffset?: { dx: number; dy: number }
  /** While the pane is resizing its live rect overrides the placement rect. */
  overrideRect?: PixelRect
  settling: boolean
  reducedMotion: boolean
  onResizeStart: (edge: ResizeEdge, event: ReactPointerEvent) => void
  children: ReactNode
}

/**
 * A single pane placed on the canvas. It is an absolutely-positioned, stably-keyed sibling of
 * every other pane window — geometry, z-order and drag transform change here, but the child
 * terminal (and therefore its xterm instance and PTY) is never unmounted or re-keyed.
 */
export function TerminalPaneWindow({ view, active, dragging, dragOffset, overrideRect, settling, reducedMotion, onResizeStart, children }: TerminalPaneWindowProps) {
  const rect = overrideRect ?? view.rect
  const showResize = view.kind === 'floating' && !view.maximized && !dragging

  const style: React.CSSProperties = {
    position: 'absolute',
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
    zIndex: dragging ? 2_000_000 : view.zIndex,
    transform: dragging && dragOffset ? `translate3d(${dragOffset.dx}px, ${dragOffset.dy}px, 0)` : undefined,
    transition:
      dragging || reducedMotion
        ? 'none'
        : settling
          ? `left ${CANVAS_CONSTANTS.settleAnimationMs}ms var(--ease-out, ease-out), top ${CANVAS_CONSTANTS.settleAnimationMs}ms var(--ease-out, ease-out), width ${CANVAS_CONSTANTS.settleAnimationMs}ms var(--ease-out, ease-out), height ${CANVAS_CONSTANTS.settleAnimationMs}ms var(--ease-out, ease-out)`
          : undefined,
  }

  const className = [
    'pane-window',
    view.kind,
    active ? 'active' : '',
    dragging ? 'dragging' : '',
    view.maximized ? 'maximized' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={style} data-pane-window={view.paneId}>
      {children}
      {showResize &&
        RESIZE_EDGES.map((edge) => (
          <div
            key={edge}
            className={`pane-resize-handle ${edge}`}
            onPointerDown={(event) => onResizeStart(edge, event)}
            role="separator"
            aria-label={`Resize ${edge}`}
          />
        ))}
    </div>
  )
}
