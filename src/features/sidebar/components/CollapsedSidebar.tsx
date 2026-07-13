import { Activity, ChevronsRight, Folder, MoreHorizontal, Settings, TerminalSquare } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'
import { runtimeStatusLabel, runtimeStatusText } from '../sidebarSelectors'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { WorkspaceRuntimeIndicator } from './WorkspaceRuntimeIndicator'

const MAX_VISIBLE = 9

/**
 * The 52px collapsed rail. Shows the logo, a Project indicator, per-Workspace status icons
 * (each with a rich tooltip), and the utilities. No hidden row bodies are rendered.
 */
export function CollapsedSidebar({
  project,
  workspaces,
  activeWorkspaceId,
  projectFolderMissing,
  actions,
}: Pick<
  ForgeSpaceSidebarProps,
  'project' | 'workspaces' | 'activeWorkspaceId' | 'projectFolderMissing' | 'actions'
>) {
  const setProjectSwitcher = useSidebarStore((state) => state.setProjectSwitcherOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  const visible = workspaces.slice(0, MAX_VISIBLE)
  const overflow = workspaces.length - visible.length

  return (
    <nav className="sidebar-collapsed" aria-label="Workspace sidebar (collapsed)">
      <button
        type="button"
        className="collapsed-logo"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onClick={actions.onToggleCollapse}
      >
        <span className="brand-mark">
          <TerminalSquare size={16} strokeWidth={1.7} />
        </span>
      </button>

      <button
        type="button"
        className={`collapsed-project ${projectFolderMissing ? 'is-missing' : ''}`}
        aria-label={`Project: ${project.name}`}
        title={`${project.name}${projectFolderMissing ? ' · Folder unavailable' : ''}`}
        onClick={() => {
          actions.onToggleCollapse()
          setProjectSwitcher(true)
        }}
      >
        <Folder size={16} />
      </button>

      <ul className="collapsed-list" role="list">
        {visible.map((entry) => {
          const active = entry.workspace.id === activeWorkspaceId
          const tooltip = `${entry.workspace.name}\n${entry.workspace.panes.length} panes · ${runtimeStatusText(
            entry.runtime,
          )}\n${entry.providers.text}`
          return (
            <li key={entry.workspace.id}>
              <button
                type="button"
                className={`collapsed-ws ${active ? 'is-active' : ''}`}
                aria-current={active ? 'true' : undefined}
                aria-label={`${entry.workspace.name}, ${runtimeStatusLabel(entry.runtime.status)}`}
                title={tooltip}
                onClick={() => !active && actions.onSelectWorkspace(entry.workspace.id)}
              >
                <WorkspaceRuntimeIndicator status={entry.runtime.status} />
              </button>
            </li>
          )
        })}
        {overflow > 0 && (
          <li>
            <button
              type="button"
              className="collapsed-ws collapsed-overflow"
              aria-label={`${overflow} more workspaces`}
              title={`${overflow} more workspaces — expand to view`}
              onClick={actions.onToggleCollapse}
            >
              <MoreHorizontal size={15} />
            </button>
          </li>
        )}
      </ul>

      <div className="collapsed-utilities">
        <button type="button" aria-label="Settings" title="Settings" onClick={actions.onOpenSettings}>
          <Settings size={16} />
        </button>
        <button type="button" aria-label="Diagnostics" title="Diagnostics" onClick={() => setDiagnostics(true)}>
          <Activity size={16} />
        </button>
        <button
          type="button"
          aria-label="Expand sidebar"
          title="Expand sidebar"
          onClick={actions.onToggleCollapse}
        >
          <ChevronsRight size={16} />
        </button>
      </div>
    </nav>
  )
}
