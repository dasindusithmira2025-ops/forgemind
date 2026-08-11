import { Database, FolderGit2, Search } from 'lucide-react'
import { useOrchestratorStore } from '../../orchestrator/store'
import type { SidebarActions } from '../sidebarTypes'

/**
 * The navigation zone: the sidebar's *destinations*, above the entity list.
 *
 * Separating "where can I go" from "what am I working on" is the single structural idea behind
 * this sidebar. Everything below this zone is one list of Workspaces; everything in it is a
 * route. A row is only ever added here when it has a real destination — a nav row that opens
 * nothing teaches the user that the zone is decorative.
 *
 * The search control is a button styled as a field rather than a real input: it opens the
 * Orchestrator's command panel, and an input that steals focus but forwards every keystroke
 * somewhere else is worse than a button that says what it does. Its shortcut hint stays hidden
 * until hover so the resting sidebar shows names, not chrome.
 */
export function SidebarNav({ actions }: { actions: SidebarActions }) {
  const setOrchestratorOpen = useOrchestratorStore((state) => state.setOpen)

  return (
    <nav className="sb-nav" aria-label="Go to">
      <button
        type="button"
        className="sb-nav-search"
        aria-label="Search — open the Orchestrator command panel"
        onClick={() => setOrchestratorOpen(true)}
      >
        <Search size={13} className="sb-nav-search-icon" aria-hidden />
        <span className="sb-nav-search-label">Search</span>
        <span className="sb-nav-keys" aria-hidden>
          <kbd>Ctrl</kbd>
          <kbd>Space</kbd>
        </span>
      </button>

      {actions.onOpenRepository && (
        <button type="button" className="sb-nav-row" onClick={actions.onOpenRepository}>
          <FolderGit2 size={16} className="sb-nav-icon" aria-hidden />
          <span className="sb-nav-label">Repository</span>
        </button>
      )}

      {actions.onOpenDatabase && (
        <button type="button" className="sb-nav-row" onClick={actions.onOpenDatabase}>
          <Database size={16} className="sb-nav-icon" aria-hidden />
          <span className="sb-nav-label">Database</span>
        </button>
      )}
    </nav>
  )
}
