import { ExternalLink, MonitorSmartphone, PictureInPicture2, X } from 'lucide-react'
import type { MonitorInfo, WorkspacePlacement } from '../../../native/types'
import { monitorForPlacement, monitorLabel } from '../../workspace-windows/placementSelectors'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'
import { SidebarGroup } from './SidebarGroup'

/**
 * Workspaces from the active Project that are currently displayed in DETACHED native windows on
 * other monitors. Clicking a row focuses the existing window (never creates a duplicate); the
 * inline actions cover Focus, Move to Monitor, Attach back, and Close Window.
 *
 * These are still Workspaces, so the sidebar filter narrows them exactly as it narrows the
 * attached list — a filter that left detached rows showing would contradict its own match count.
 */
export function WorkspacesOtherMonitorsSection({
  workspaces,
  visibleWorkspaces,
  placements,
  monitors,
  actions,
}: {
  workspaces: SidebarWorkspace[]
  /** The subset the filter allows through; identical to `workspaces` when no filter is active. */
  visibleWorkspaces: SidebarWorkspace[]
  placements: WorkspacePlacement[]
  monitors: MonitorInfo[]
  actions: SidebarActions
}) {
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const filtering = filterQuery.trim().length > 0

  return (
    <SidebarGroup
      id="other-monitors"
      label="Other Monitors"
      count={filtering ? visibleWorkspaces.length : workspaces.length}
      forceExpanded={filtering}
      className="ws-section-detached"
    >
      {workspaces.length === 0 ? (
        <div className="ws-empty"><p>No detached Workspaces for this Project.</p></div>
      ) : visibleWorkspaces.length === 0 ? (
        <p className="sb-no-match">No detached Workspace matches the filter.</p>
      ) : (<ul className="ws-list" role="list">
        {visibleWorkspaces.map((entry) => {
          const placement = placements.find((item) => item.workspaceId === entry.workspace.id)
          const monitor = placement ? monitorForPlacement(placement, monitors) : undefined
          const monitorName = monitor ? monitorLabel(monitor) : placement?.monitorAlias || 'Detached window'
          const running = entry.runtime.runningCount
          return (
            <li key={entry.workspace.id} className="ws-row ws-row-detached">
              <button
                type="button"
                className="ws-row-main"
                title={`Focus ${entry.workspace.name}`}
                onClick={() => actions.onFocusWorkspaceWindow?.(entry.workspace.id)}
              >
                <span className="ws-row-title">{entry.workspace.name}</span>
                <span className="ws-row-sub">
                  <MonitorSmartphone size={11} /> {monitorName} · {entry.workspace.panes.length} panes · {running} running · {entry.runtime.requiresAttention?'Attention':entry.runtime.status.replace('_',' ')}
                </span>
              </button>
              <div className="ws-row-detached-actions">
                <button type="button" aria-label="Focus window" title="Focus window" onClick={() => actions.onFocusWorkspaceWindow?.(entry.workspace.id)}>
                  <ExternalLink size={13} />
                </button>
                <button type="button" aria-label="Move to monitor" title="Move to monitor" onClick={() => actions.onMoveToMonitor?.(entry.workspace.id)}>
                  <MonitorSmartphone size={13} />
                </button>
                <button type="button" aria-label="Attach to main window" title="Attach to main window" onClick={() => actions.onAttachWorkspace?.(entry.workspace.id)}>
                  <PictureInPicture2 size={13} />
                </button>
                <button type="button" aria-label="Close workspace window" title="Close workspace window" onClick={() => actions.onCloseWorkspaceWindow?.(entry.workspace.id)}>
                  <X size={13} />
                </button>
              </div>
            </li>
          )
        })}
      </ul>)}
    </SidebarGroup>
  )
}
