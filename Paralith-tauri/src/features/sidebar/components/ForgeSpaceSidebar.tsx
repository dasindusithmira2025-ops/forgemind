import { useCallback, useMemo, useRef } from 'react'
import { useSwarmStore } from '../../swarms/swarmStore'
import { matchesSidebarFilter } from '../sidebarSelectors'
import { useSidebarStore } from '../sidebarStore'
import type { ForgeSpaceSidebarProps, SidebarProjectGroup } from '../sidebarTypes'
import { SidebarNav } from './SidebarNav'
import { SidebarListHeader } from './SidebarListHeader'
import { SidebarFilter, MIN_ROWS_FOR_FILTER } from './SidebarFilter'
import { SwarmsSidebarSection } from '../../swarms/SwarmsSidebarSection'
import { WorkspaceListSection } from './WorkspaceListSection'
import { WorkspacesOtherMonitorsSection } from './WorkspacesOtherMonitorsSection'
import { SidebarToolbar } from './SidebarToolbar'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { DiagnosticsDrawer } from './DiagnosticsDrawer'

/**
 * The one canonical PARALITH sidebar. It is a controlled surface: all Project/Workspace data and
 * persistence live in WorkspaceScreen and flow in through props. This component owns only
 * presentation and the transient interaction state in `useSidebarStore`.
 *
 * Four fixed bands around exactly one scroll region:
 *   1. nav — the sidebar's destinations (Search, Repository). Routes, never entities.
 *   2. list header — what the list is (Projects / Workspaces) and the controls scoped to it
 *   3. scroll body — the Workspace list across every open Project, then Swarms, then any
 *      Workspaces detached onto other monitors
 *   4. toolbar — identity plus the least-used controls, furthest from where the eye starts
 *
 * The single-entry-point rule still holds: everything Project-shaped beyond "which one is this"
 * lives behind the list header's one Project popover.
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
  const filterQuery = useSidebarStore((state) => state.filterQuery)
  const bodyRef = useRef<HTMLDivElement>(null)
  // Read purely for the filter's row threshold and match total; the Swarms section owns its own
  // loading, subscription, and rendering.
  const swarms = useSwarmStore((state) => state.itemsByProject[project.id])

  // The Project rail is driven by the multi-Project session state. Until that is populated (or in
  // tests/detached contexts that don't pass it) fall back to the single active Project so the
  // header's Project popover always has an identity to show.
  const currentProjects =
    openProjects && openProjects.length > 0
      ? openProjects
      : [{ project, isActive: true, folderMissing: projectFolderMissing }]

  const activeWorkspaceName =
    workspaces.find((entry) => entry.workspace.id === activeWorkspaceId)?.workspace.name ?? 'None'

  // Split this window's Workspaces from those detached onto other monitors. Placements are
  // authoritative (from the Rust registry); when absent (default) every Workspace is attached.
  const detachedIds = new Set(placements.filter((item) => item.mode === 'detached').map((item) => item.workspaceId))

  // A caller that doesn't supply grouped data (the detached window, tests) still gets a working
  // list: one group holding the active Project's attached Workspaces.
  const listGroups: SidebarProjectGroup[] = useMemo(() => {
    const source: SidebarProjectGroup[] = groups?.length
      ? groups
      : [{ project, isActive: true, folderMissing: projectFolderMissing, workspaces }]
    // Detached Workspaces have their own section; showing them in both would double-count.
    return source
      .map((group) => ({
        ...group,
        workspaces: group.workspaces.filter((entry) => !detachedIds.has(entry.workspace.id)),
      }))
      .filter((group) => group.workspaces.length > 0 || group.isActive)
    // `detachedIds` is derived from `placements` each render; depend on the source instead.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, project, projectFolderMissing, workspaces, placements])

  const detachedWorkspaces = workspaces.filter((entry) => detachedIds.has(entry.workspace.id))
  const visibleDetached = detachedWorkspaces.filter((entry) =>
    matchesSidebarFilter(filterQuery, entry.workspace.name, entry.providers.text),
  )

  // One filter over both primary lists, so the field can report a single honest match total.
  const listWorkspaces = listGroups.flatMap((group) => group.workspaces)
  const visibleListCount = listWorkspaces.filter((entry) =>
    matchesSidebarFilter(filterQuery, entry.workspace.name, entry.providers.text),
  ).length
  const swarmList = swarms ?? []
  const visibleSwarmCount = swarmList.filter((item) => matchesSidebarFilter(filterQuery, item.swarm.name)).length
  const totalRows = listWorkspaces.length + detachedWorkspaces.length + swarmList.length
  const showFilter = totalRows >= MIN_ROWS_FOR_FILTER
  const matchCount = visibleListCount + visibleDetached.length + visibleSwarmCount

  const effectiveWidth = collapsed ? undefined : (draftWidth ?? width)

  // Bring the focused Workspace back on screen. Queries the DOM rather than tracking row offsets:
  // the list is grouped, filtered and re-sorted, so the row's position is only knowable after it
  // has rendered.
  const scrollToActive = useCallback(() => {
    bodyRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])

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
          <SidebarNav actions={actions} />
          <SidebarListHeader openProjects={currentProjects} recents={props.recents} actions={actions} />
          {showFilter && <SidebarFilter resultCount={matchCount} />}
          <div className="sidebar-body" ref={bodyRef}>
            <WorkspaceListSection
              groups={listGroups}
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
          <SidebarToolbar actions={actions} onScrollToActive={activeWorkspaceId ? scrollToActive : undefined} />
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
