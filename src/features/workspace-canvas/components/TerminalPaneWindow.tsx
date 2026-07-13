import type { ReactNode } from 'react'
import { CANVAS_CONSTANTS } from '../canvasConstants'
import type { PaneView } from '../canvasSelectors'

interface TerminalPaneWindowProps {
  view: PaneView
  active: boolean
  dragging: boolean
  dragOffset?: { dx: number; dy: number }
  settling: boolean
  reducedMotion: boolean
  children: ReactNode
}

/**
 * A single pane placed on the canvas. It is an absolutely-positioned, stably-keyed sibling of
 * every other pane window — geometry and drag transform change here, but the child terminal (and
 * therefore its xterm instance and PTY) is never unmounted or re-keyed. In the strict-tiling model
 * panes never overlap, so z-order is flat: the only pane lifted above the rest is the one actively
 * being dragged (its translucent ghost) or a maximized pane.
 */
export function TerminalPaneWindow({ view, active, dragging, dragOffset, settling, reducedMotion, children }: TerminalPaneWindowProps) {
  const rect = view.rect

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
    </div>
  )
}
