/**
 * Search as a workspace capability rather than a destination.
 *
 * Making Search a top-level mode meant a user had to leave whatever they were reading, land on a
 * near-empty page, and type. As an overlay it opens over the surface they are already on, and
 * navigating to a result closes it and takes them there — the query is a way through the
 * workspace, not a room inside it.
 *
 * The panel itself is `MemorySearch`, unchanged: this file owns only the scrim, the focus move
 * and the dismissal rules.
 */
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useIntelligenceStore } from '../intelligenceStore'
import { MemorySearch } from './MemorySearch'

export function MemorySearchOverlay() {
  const open = useIntelligenceStore((state) => state.searchOpen)
  const close = useIntelligenceStore((state) => state.closeSearch)
  const panel = useRef<HTMLDivElement>(null)

  // Focus lands on the query field, because opening search and then having to click the input is
  // the whole reason a palette is faster than a page.
  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
  }, [open])

  // Escape closes from anywhere while the palette is up, not only while the panel holds focus.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!open) return null

  return (
    <div
      className="memory-search-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panel}
        className="memory-search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search project intelligence"
      >
        <button
          type="button"
          className="memory-icon-button memory-search-close"
          aria-label="Close search"
          onClick={close}
        >
          <X size={14} />
        </button>
        <MemorySearch onNavigate={close} />
      </div>
    </div>
  )
}
