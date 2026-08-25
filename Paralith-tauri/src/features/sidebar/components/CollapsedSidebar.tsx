import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, BarChart3, Boxes, BrainCircuit, Database, Folder, GitBranch, MoreHorizontal, Settings } from 'lucide-react'
import { Brand } from '../../../components/ui/Brand'
import { useSwarmStore } from '../../swarms/swarmStore'
import { isActiveLifecycle, lifecycleLabel, lifecycleTone } from '../../swarms/swarmPresentation'
import { useSidebarStore } from '../sidebarStore'
import { runtimeStatusLabel, runtimeStatusText } from '../sidebarSelectors'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { workspaceIdentityColor } from '../workspaceIdentity'
import { WorkspaceRuntimeIndicator } from './WorkspaceRuntimeIndicator'
import { CollapsedUpdateAction } from './SidebarStatusArea'

const MAX_VISIBLE = 9

/**
 * The collapsed rail. Shows the logo, the Project indicator, per-Workspace status icons (each
 * with a rich tooltip), a Swarm indicator when the Project has any, and the utilities.
 *
 * The rail mirrors the expanded sidebar's zones rather than being a reduced subset of them: it
 * previously dropped Swarms entirely, so a running Swarm became invisible the moment the sidebar
 * was collapsed. Exactly one control expands the sidebar (the logo); the Project button opens the
 * Project surface directly instead of expanding first and setting a flag nothing rendered.
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
  const navigate = useNavigate()
  const setProjectSwitcher = useSidebarStore((state) => state.setProjectSwitcherOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  const swarms = useSwarmStore((state) => state.itemsByProject[project.id]) ?? []
  const visible = workspaces.slice(0, MAX_VISIBLE)
  const overflow = workspaces.length - visible.length

  // The rail has room for one Swarm signal, so surface the one that most needs attention:
  // anything running beats anything idle, and lifecycleTone already ranks by urgency.
  const leadSwarm = swarms.find((item) => isActiveLifecycle(item.swarm.lifecycle)) ?? swarms[0]

  return (
    <nav className="sidebar-collapsed" aria-label="Workspace sidebar (collapsed)">
      <button
        type="button"
        className="collapsed-logo"
        aria-label="Expand sidebar"
        title="Expand sidebar"
        onClick={actions.onToggleCollapse}
      >
        <Brand compact />
      </button>

      <button
        type="button"
        className={`collapsed-project ${projectFolderMissing ? 'is-missing' : ''}`}
        aria-label={`Project: ${project.name}`}
        title={`${project.name}${projectFolderMissing ? ' · Folder unavailable' : ''}`}
        onClick={() => {
          // Expand, then open the Project surface in the rail that is now visible.
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
                // Same identity colour as the expanded row, so collapsing changes the size of the
                // mark and nothing about what it means.
                style={{ '--ws-identity': workspaceIdentityColor(entry.workspace.id) } as CSSProperties}
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

      {leadSwarm && (
        <button
          type="button"
          className="collapsed-swarms"
          aria-label={`Swarms: ${swarms.length}, ${lifecycleLabel(leadSwarm.swarm.lifecycle)}`}
          title={`${swarms.length} Swarm${swarms.length === 1 ? '' : 's'} · ${lifecycleLabel(
            leadSwarm.swarm.lifecycle,
          )}`}
          onClick={() => navigate(`/swarms/${project.id}`)}
        >
          <Boxes size={16} />
          <span className={`collapsed-swarms-dot tone-${lifecycleTone(leadSwarm.swarm.lifecycle)}`} aria-hidden />
        </button>
      )}

      {/* Mirrors the expanded footer rail exactly, so collapsing never hides a utility. */}
      <div className="collapsed-utilities">
        {actions.onOpenRepository && (
          <button type="button" aria-label="Source Control" title="Source Control" onClick={actions.onOpenRepository}>
            <GitBranch size={16} />
          </button>
        )}
        {actions.onOpenMemory && (
          <button type="button" aria-label="Memory" title="Memory" onClick={actions.onOpenMemory}>
            <BrainCircuit size={15} />
          </button>
        )}
        {actions.onOpenDatabase && (
          <button type="button" aria-label="Database" title="Database" onClick={actions.onOpenDatabase}>
            <Database size={16} />
          </button>
        )}
        {actions.onOpenUsage && (
          <button type="button" aria-label="Usage" title="Usage" onClick={actions.onOpenUsage}>
            <BarChart3 size={16} />
          </button>
        )}
        <button type="button" aria-label="Settings" title="Settings" onClick={actions.onOpenSettings}>
          <Settings size={16} />
        </button>
        <button type="button" aria-label="Diagnostics" title="Diagnostics" onClick={() => setDiagnostics(true)}>
          <Activity size={16} />
        </button>
      </div>

      {/* The expanded footer's capsule, at rail width: an icon and an attention marker, never a
          widened rail. */}
      <CollapsedUpdateAction />
    </nav>
  )
}
