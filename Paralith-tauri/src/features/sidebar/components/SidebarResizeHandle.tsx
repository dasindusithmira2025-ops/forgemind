import { useCallback, useEffect, useRef } from 'react'
import { useSidebarStore } from '../sidebarStore'
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, clampSidebarWidth } from '../sidebarPreferences'

/**
 * A subtle right-edge resize handle. Width follows the pointer live (via the store's
 * draftWidth) but is only clamped and persisted once, on pointer-up — never on every move,
 * and never in a feedback loop with the persisted setting.
 */
export function SidebarResizeHandle({
  width,
  onCommit,
}: {
  width: number
  onCommit: (width: number) => void
}) {
  const setDraftWidth = useSidebarStore((state) => state.setDraftWidth)
  const setResizing = useSidebarStore((state) => state.setResizing)
  const startX = useRef(0)
  const startWidth = useRef(width)

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      startX.current = event.clientX
      startWidth.current = width
      setResizing(true)
      ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
    },
    [width, setResizing],
  )

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!useSidebarStore.getState().resizing) return
      const next = clampSidebarWidth(startWidth.current + (event.clientX - startX.current))
      setDraftWidth(next)
    },
    [setDraftWidth],
  )

  const finish = useCallback(() => {
    const state = useSidebarStore.getState()
    if (!state.resizing) return
    const next = state.draftWidth
    setResizing(false)
    setDraftWidth(undefined)
    if (next !== undefined && next !== width) onCommit(next)
  }, [onCommit, setDraftWidth, setResizing, width])

  // Keyboard resize: arrow keys nudge width in 8px steps and commit immediately.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const delta = event.key === 'ArrowRight' ? 8 : -8
      onCommit(clampSidebarWidth(width + delta))
    },
    [onCommit, width],
  )

  useEffect(() => () => setResizing(false), [setResizing])

  return (
    <div
      className="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onKeyDown={onKeyDown}
    />
  )
}
