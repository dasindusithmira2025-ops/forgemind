import { SURFACE_REGISTRY, type SurfaceKind } from './surfaceRegistry'

/**
 * Shown in the right panel while no surface is open (first use, or every tab was closed). Reads the
 * same registry as the tab bar's "+" picker, so adding a surface kind never requires touching this.
 */
export function SurfaceEmptyState({ onOpen }: { onOpen: (kind: SurfaceKind) => void }) {
  return (
    <div className="surface-empty-state">
      <div className="surface-empty-heading">
        <h2>Open a surface</h2>
        <p>Choose what to show in the right panel.</p>
      </div>
      <div className="surface-empty-grid">
        {SURFACE_REGISTRY.map((def) => {
          const Icon = def.icon
          return (
            <button key={def.kind} type="button" className="surface-empty-card" onClick={() => onOpen(def.kind)}>
              <Icon size={16} aria-hidden />
              <span className="surface-empty-card-label">{def.label}</span>
              <span className="surface-empty-card-desc">{def.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
