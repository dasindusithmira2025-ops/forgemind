import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { SURFACE_REGISTRY, surfaceDef, type SurfaceKind } from './surfaceRegistry'

export interface SurfaceTabBarProps {
  surfaces: SurfaceKind[]
  activeSurface?: SurfaceKind
  onSelect: (kind: SurfaceKind) => void
  onClose: (kind: SurfaceKind) => void
  onReorder: (kind: SurfaceKind, toIndex: number) => void
  onOpen: (kind: SurfaceKind) => void
}

/**
 * The compact tab strip for the right-panel Surface Workspace, plus the "+" picker that opens the
 * remaining registered surfaces. Singleton enforcement is the store's job (`openSurface`), not this
 * component's — the picker just declines to *offer* a kind that's already open, since every current
 * kind is a singleton and there is never anything useful a second click could do.
 */
export function SurfaceTabBar({ surfaces, activeSurface, onSelect, onClose, onReorder, onOpen }: SurfaceTabBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const dragKind = useRef<SurfaceKind | null>(null)
  const availableToAdd = SURFACE_REGISTRY.filter((def) => !surfaces.includes(def.kind))

  return (
    <nav className="surface-tab-bar" aria-label="Workspace surfaces">
      <div className="surface-tabs" role="tablist">
        {surfaces.map((kind) => {
          const def = surfaceDef(kind)
          const Icon = def.icon
          const selected = kind === activeSurface
          return (
            <div
              key={kind}
              role="tab"
              aria-selected={selected}
              tabIndex={0}
              draggable
              className={`surface-tab ${selected ? 'is-active' : ''}`}
              title={def.label}
              onClick={() => onSelect(kind)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(kind) }
              }}
              onMouseDown={(event) => {
                // Middle-click closes, matching desktop tab-strip convention.
                if (event.button === 1) { event.preventDefault(); onClose(kind) }
              }}
              onDragStart={() => { dragKind.current = kind }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const from = dragKind.current
                dragKind.current = null
                if (!from || from === kind) return
                onReorder(from, surfaces.indexOf(kind))
              }}
            >
              <Icon size={13} aria-hidden />
              <span className="surface-tab-label">{def.label}</span>
              <button
                type="button"
                className="surface-tab-close"
                aria-label={`Close ${def.label}`}
                title={`Close ${def.label}`}
                onClick={(event) => { event.stopPropagation(); onClose(kind) }}
              >
                <X size={12} aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
      <div className="surface-add-wrap menu-wrap">
        <button
          type="button"
          className="surface-add-btn"
          aria-label="Open surface"
          aria-haspopup="menu"
          aria-expanded={pickerOpen}
          title="Open surface"
          onClick={() => setPickerOpen((value) => !value)}
        >
          <Plus size={15} aria-hidden />
        </button>
        {pickerOpen && (
          <>
            <button className="context-scrim" aria-label="Close surface picker" onClick={() => setPickerOpen(false)} />
            <div
              className="context-popover surface-picker"
              role="menu"
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setPickerOpen(false) } }}
            >
              {availableToAdd.length === 0
                ? <span className="surface-picker-empty">All surfaces are open</span>
                : availableToAdd.map((def) => {
                  const Icon = def.icon
                  return (
                    <button key={def.kind} role="menuitem" onClick={() => { onOpen(def.kind); setPickerOpen(false) }}>
                      <Icon size={14} aria-hidden />{def.label}
                    </button>
                  )
                })}
            </div>
          </>
        )}
      </div>
    </nav>
  )
}
