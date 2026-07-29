import type { PointerEvent as ReactPointerEvent } from 'react'
import type { SplitHandle } from '../geometryEngine'

interface SplitResizeHandleLayerProps {
  handles: SplitHandle[]
  onResizeStart: (handle: SplitHandle, event: ReactPointerEvent) => void
  disabled: boolean
}

/** Draggable dividers between docked panes. Hidden while a pane is maximized or being dragged. */
export function SplitResizeHandleLayer({ handles, onResizeStart, disabled }: SplitResizeHandleLayerProps) {
  if (disabled) return null
  return (
    <div className="split-handle-layer">
      {handles.map((handle) => (
        <div
          key={`${handle.path.join('-')}:${handle.index}:${handle.orientation}`}
          className={`split-resize-handle ${handle.orientation}`}
          style={{ position: 'absolute', left: handle.rect.x, top: handle.rect.y, width: handle.rect.width, height: handle.rect.height }}
          onPointerDown={(event) => onResizeStart(handle, event)}
          role="separator"
          aria-orientation={handle.orientation === 'vertical' ? 'vertical' : 'horizontal'}
        />
      ))}
    </div>
  )
}
