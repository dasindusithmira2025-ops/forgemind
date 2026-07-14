import { ExternalLink, MonitorSmartphone, PictureInPicture2, X } from 'lucide-react'
import type { MonitorInfo, WorkspacePlacement } from '../../../native/types'
import { monitorForPlacement, monitorLabel } from '../../workspace-windows/placementSelectors'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'

/**
 * The fourth sidebar section: Workspaces from the active Project that are currently displayed
 * in DETACHED native windows on other monitors. Clicking a row focuses the existing window
 * (never creates a duplicate); the inline actions cover Focus, Move to Monitor, Attach back,
 * and Close Window. The section remains visible when empty so the sidebar's information
 * architecture is stable and contains exactly the four approved primary sections.
 */
export function WorkspacesOtherMonitorsSection({
  workspaces,
  placements,
  monitors,
  actions,
}: {
  workspaces: SidebarWorkspace[]
  placements: WorkspacePlacement[]
  monitors: MonitorInfo[]
  actions: SidebarActions
}) {
  return (
    <section className="ws-section ws-section-detached" aria-label="Workspaces — Other Monitors">
      <header className="ws-section-head">
        <span className="section-label">Workspaces — Other Monitors</span>
        <span className="ws-section-count">{workspaces.length}</span>
      </header>
      {workspaces.length===0?<div className="ws-empty"><p>No detached Workspaces for this Project.</p></div>:<ul className="ws-list" role="list">
        {workspaces.map((entry) => {
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
      </ul>}
    </section>
  )
}
