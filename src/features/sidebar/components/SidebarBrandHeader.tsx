import { ChevronsLeft, FolderOpen, Rocket, Settings } from 'lucide-react'
import { Brand } from '../../../components/ui/Brand'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/**
 * Brand header. Expanded: logo + wordmark + collapse. The logo opens a small menu of real
 * actions only. It deliberately shows no Project/Workspace identity or provider counts.
 */
export function SidebarBrandHeader({ actions }: { actions: SidebarActions }) {
  const menuOpen = useSidebarStore((state) => state.logoMenuOpen)
  const setMenuOpen = useSidebarStore((state) => state.setLogoMenuOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)

  return (
    <header className="sidebar-brand">
      <div className="sidebar-logo-wrap">
        <button
          type="button"
          className="sidebar-logo"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="PARALITH menu"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <Brand />
        </button>
        {menuOpen && (
          <>
            <button className="context-scrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
            <div className="context-popover sidebar-logo-menu" role="menu">
              <button role="menuitem" onClick={() => { setMenuOpen(false); actions.onOpenLauncher() }}>
                <Rocket size={14} />
                Project launcher
              </button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); actions.onOpenProjectFolder() }}>
                <FolderOpen size={14} />
                Open project folder
              </button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); actions.onOpenSettings() }}>
                <Settings size={14} />
                Settings
              </button>
              <button role="menuitem" onClick={() => { setMenuOpen(false); setDiagnostics(true) }}>
                Diagnostics
              </button>
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        className="sidebar-collapse-btn"
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
        onClick={actions.onToggleCollapse}
      >
        <ChevronsLeft size={16} />
      </button>
    </header>
  )
}
