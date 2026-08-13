import { useEffect, useMemo, useRef } from 'react'
import { useSwarmStore } from '../../swarms/swarmStore'
import { useSidebarStore } from '../sidebarStore'
import { useSidebarPresentation } from '../useSidebarPresentation'
import type { ForgeSpaceSidebarProps, SidebarProjectGroup } from '../sidebarTypes'
import { SidebarHeader } from './SidebarHeader'
import { WorkspaceSectionHeader, WORKSPACE_SECTION_ID } from './WorkspaceSectionHeader'
import { SidebarFilter } from './SidebarFilter'
import { SwarmsSidebarSection } from '../../swarms/SwarmsSidebarSection'
import { WorkspaceListSection } from './WorkspaceListSection'
import { WorkspacesOtherMonitorsSection } from './WorkspacesOtherMonitorsSection'
import { SidebarStatusArea } from './SidebarStatusArea'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { DiagnosticsDrawer } from './DiagnosticsDrawer'

/**
 * The one canonical PARALITH sidebar. It is a controlled surface: all Project/Workspace data and
 * persistence live in WorkspaceScreen and flow in through props. This component owns only
 * presentation and the transient interaction state in `useSidebarStore`.
 *
 * The sidebar answers one question — *where am I working* — so it is one continuous dark canvas
 * with four bands and nothing decorative between them:
 *   1. header  — application identity, plus Search (the one destination that is not an entity)
 *   2. section — WORKSPACES, and the controls scoped to that list
 *   3. body    — the Workspace list, then Swarms, then Workspaces detached onto other monitors.
 *                The space below the last row is left empty on purpose: rows grow into it.
 *   4. status  — the real updater state, and the destinations that are not Workspaces
 *
 * Everything deeper than "which Workspace" stays contextual to the selected one (the workspace
 * panel, the row menu, the Project popover) rather than becoming a permanent top-level row.
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
    groups,
  } = props

  const draftWidth = useSidebarStore((state) => state.draftWidth)
  const diagnosticsOpen = useSidebarStore((state) => state.diagnosticsOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)
  const collapsedGroups = useSidebarStore((state) => state.collapsedGroups)
  const listCollapsed = collapsedGroups[WORKSPACE_SECTION_ID] ?? false
  const bodyRef = useRef<HTMLDivElement>(null)
  // Read purely for the filter's row threshold and match total; the Swarms section owns its own
  // loading, subscription, and rendering.
  const swarms = useSwarmStore((state) => state.itemsByProject[project.id])

  // The Project surface is driven by the multi-Project session state. Until that is populated (or
  // in tests/detached contexts that don't pass it) fall back to the single active Project so the
  // section header's Project popover always has an identity to show.
  const currentProjects =
    openProjects && openProjects.length > 0
      ? openProjects
      : [{ project, isActive: true, folderMissing: projectFolderMissing }]

  const activeWorkspaceName =
    workspaces.find((entry) => entry.workspace.id === activeWorkspaceId)?.workspace.name ?? 'None'

  // A caller that doesn't supply grouped data (the detached window, tests) still gets a working
  // list: one group holding the active Project's attached Workspaces.
  const sourceGroups: SidebarProjectGroup[] = useMemo(
    () =>
      groups?.length
        ? groups
        : [{ project, isActive: true, folderMissing: projectFolderMissing, workspaces }],
    [groups, project, projectFolderMissing, workspaces],
  )

  const swarmNames = useMemo(() => (swarms ?? []).map((item) => item.swarm.name), [swarms])

  // Every question about what this sidebar shows — which Projects are listed, the detached split,
  // the filter, the order, the counts — is answered once, here. Nothing below derives anything.
  const presentation = useSidebarPresentation(sourceGroups, placements, swarmNames, props.runtimeSeeded ?? false)

  const effectiveWidth = collapsed ? undefined : (draftWidth ?? width)

  // Bring the focused Workspace back on screen whenever it changes. Queries the DOM rather than
  // tracking row offsets: the list is grouped, filtered and re-sorted, so a row's position is only
  // knowable after it has rendered. Replaces the old manual "scroll to current" button — the same
  // job, without spending a permanent control on it.
  useEffect(() => {
    const row = bodyRef.current?.querySelector<HTMLElement>('[aria-current="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [activeWorkspaceId, listCollapsed])

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
          <SidebarHeader />
          <WorkspaceSectionHeader
            openProjects={currentProjects}
            recents={props.recents}
            actions={actions}
            collapsed={listCollapsed}
            count={presentation.flat.totalCount}
          />
          {presentation.showFilter && !listCollapsed && <SidebarFilter resultCount={presentation.matchCount} />}
          <div className="sidebar-body" ref={bodyRef}>
            {/* The section chevron owns the Workspace list and nothing else: Swarms and detached
                Workspaces are live state in their own right, and collapsing one list is not a
                request to stop seeing the others. */}
            <div className="sb-workspace-list" id="sidebar-workspace-list" hidden={listCollapsed}>
              <WorkspaceListSection
                presentation={presentation}
                activeWorkspaceId={activeWorkspaceId}
                switchingWorkspaceId={switchingWorkspaceId}
                loading={loadingWorkspaces}
                actions={actions}
              />
            </div>
            <SwarmsSidebarSection projectId={project.id} />
            {presentation.detached.length > 0 && (
              <WorkspacesOtherMonitorsSection
                workspaces={presentation.detached}
                visibleWorkspaces={presentation.visibleDetached}
                placements={placements}
                monitors={monitors}
                actions={actions}
              />
            )}
          </div>
          <SidebarStatusArea actions={actions} />
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
