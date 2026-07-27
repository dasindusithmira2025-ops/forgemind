import { Activity, FolderGit2, Settings } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions } from '../sidebarTypes'

/**
 * Pinned footer rail: Repository, Settings, Diagnostics.
 *
 * Deliberately a single row of icon buttons rather than four full-width labelled rows — those
 * cost ~128px of the sidebar's height for actions used a few times a session, and the fourth
 * ("Collapse") duplicated the header control that now owns collapsing outright.
 */
export function SidebarUtilities({ actions }: { actions: SidebarActions }) {
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  return (
    <div className="sidebar-utilities">
      {actions.onOpenRepository && (
        <button
          type="button"
          className="sidebar-util"
          aria-label="Repository"
          title="Repository"
          onClick={actions.onOpenRepository}
        >
          <FolderGit2 size={16} />
        </button>
      )}
      <button
        type="button"
        className="sidebar-util"
        aria-label="Settings"
        title="Settings"
        onClick={actions.onOpenSettings}
      >
        <Settings size={16} />
      </button>
      <button
        type="button"
        className="sidebar-util"
        aria-label="Diagnostics"
        title="Diagnostics"
        onClick={() => setDiagnostics(true)}
      >
        <Activity size={16} />
      </button>
    </div>
  )
}
