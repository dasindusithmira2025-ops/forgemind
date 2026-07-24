import { useSwarmStore } from '../../swarms/swarmStore'
import { matchesSidebarFilter } from '../sidebarSelectors'
import { useSidebarStore } from '../sidebarStore'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { SidebarBrandHeader } from './SidebarBrandHeader'
import { SidebarProjectRail } from './SidebarProjectRail'
import { SidebarFilter, MIN_ROWS_FOR_FILTER } from './SidebarFilter'
import { SwarmsSidebarSection } from '../../swarms/SwarmsSidebarSection'
import { WorkspacesSection } from './WorkspacesSection'
import { WorkspacesOtherMonitorsSection } from './WorkspacesOtherMonitorsSection'
import { SidebarUtilities } from './SidebarUtilities'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { DiagnosticsDrawer } from './DiagnosticsDrawer'

/**
 * The one canonical PARALITH sidebar. It is a controlled surface: all Project/Workspace data and
 * persistence live in WorkspaceScreen and flow in through props. This component owns only
 * presentation and the transient interaction state in `useSidebarStore`.
 *
 * Four stacked zones, in order of how often they are touched:
 *   1. brand header — identity, plus the single Collapse control
 *   2. Project rail — which Project is focused and what else is still running (pinned)
 *   3. scroll body — Workspaces, Swarms, Other Monitors, with sticky group headers and a
 *      filter over the two primary lists
 *   4. utilities rail — Repository / Settings / Diagnostics (pinned)
 * Everything Project-shaped that isn't "which one am I in" lives behind the rail's one popover,
 * so no action in the sidebar has a second entry point.
 */
export function ForgeSpaceSidebar(props: ForgeSpaceSidebarProps) {
  const {
    project,
    activeWorkspaceId,
    workspaces,
    collapsed,
    width,
    switchingWorkspaceId,
    projectFolderMissing,
    loadingWorkspaces,
    actions,
    placements = [],
    monitors = [],
    openProjects,
  } = props

  // The Project rail is driven by the multi-Project session state. Until that is populated (or in
  // tests/detached contexts that don't pass it) fall back to the single active Project so the
  // rail always has an identity to show.
  const currentProjects =
    openProjects && openProjects.length > 0
      ? openProjects
      : [{ project, isActive: true, folderMissing: projectFolderMissing }]
  const draftWidth = useSidebarStore((state) => state.draftWidth)
  const diagnosticsOpen = useSidebarStore((state) => state.diagnosticsOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  // Read purely for the filter's row threshold and match total; the Swarms section owns its own
  // loading, subscription, and rendering.
  const swarms = useSwarmStore((state) => state.itemsByProject[project.id])

  const activeWorkspaceName =
    workspaces.find((entry) => entry.workspace.id === activeWorkspaceId)?.workspace.name ?? 'None'

  // Split the active Project's Workspaces into the two sections: those attached to THIS window
  // vs those detached onto other monitors. Placements are authoritative (from the Rust
  // registry); when absent (default) every Workspace is attached — unchanged behavior.
  const detachedIds = new Set(placements.filter((item) => item.mode === 'detached').map((item) => item.workspaceId))
  const attachedWorkspaces = workspaces.filter((entry) => !detachedIds.has(entry.workspace.id))
  const detachedWorkspaces = workspaces.filter((entry) => detachedIds.has(entry.workspace.id))

  // One filter, applied to whatever text each row actually shows.
  const matchesFilter = (entry: (typeof workspaces)[number]) =>
    matchesSidebarFilter(filterQuery, entry.workspace.name, entry.providers.text)
  const visibleWorkspaces = attachedWorkspaces.filter(matchesFilter)
  const visibleDetached = detachedWorkspaces.filter(matchesFilter)
  const swarmList = swarms ?? []
  const visibleSwarmCount = swarmList.filter((item) => matchesSidebarFilter(filterQuery, item.swarm.name)).length
  const totalRows = workspaces.length + swarmList.length
  const showFilter = totalRows >= MIN_ROWS_FOR_FILTER
  const matchCount = visibleWorkspaces.length + visibleDetached.length + visibleSwarmCount

  const effectiveWidth = collapsed ? undefined : (draftWidth ?? width)

  return (
    <nav
      className={`forge-sidebar ${collapsed ? 'is-collapsed' : ''}`}
      aria-label="Workspace navigation"
      style={{ width: effectiveWidth }}
    >
      {collapsed ? (
        <CollapsedSidebar
          project={project}
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          projectFolderMissing={projectFolderMissing}
          actions={actions}
        />
      ) : (
        <>
          <SidebarBrandHeader actions={actions} />
          <SidebarProjectRail openProjects={currentProjects} recents={props.recents} actions={actions} />
          {showFilter && <SidebarFilter resultCount={matchCount} />}
          <div className="sidebar-body">
            <WorkspacesSection
              workspaces={attachedWorkspaces}
              visibleWorkspaces={visibleWorkspaces}
              activeWorkspaceId={activeWorkspaceId}
              switchingWorkspaceId={switchingWorkspaceId}
              loading={loadingWorkspaces}
              actions={actions}
            />
            <SwarmsSidebarSection projectId={project.id} />
            {detachedWorkspaces.length > 0 && (
              <WorkspacesOtherMonitorsSection
                workspaces={detachedWorkspaces}
                visibleWorkspaces={visibleDetached}
                placements={placements}
                monitors={monitors}
                actions={actions}
              />
            )}
          </div>
          <SidebarUtilities actions={actions} />
          <SidebarResizeHandle width={width} onCommit={actions.onResizeCommit} />
        </>
      )}

      {diagnosticsOpen && (
        <DiagnosticsDrawer
          project={project}
          activeWorkspaceName={activeWorkspaceName}
          workspaces={workspaces}
          onClose={() => setDiagnostics(false)}
        />
      )}
    </nav>
  )
}
