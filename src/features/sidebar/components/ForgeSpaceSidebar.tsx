import { useSidebarStore } from '../sidebarStore'
import { SIDEBAR_COLLAPSED_WIDTH } from '../sidebarPreferences'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { SidebarBrandHeader } from './SidebarBrandHeader'
import { CurrentProjectsSection } from './CurrentProjectsSection'
import { WorkspacesSection } from './WorkspacesSection'
import { WorkspacesOtherMonitorsSection } from './WorkspacesOtherMonitorsSection'
import { ProjectSelectionSection } from './ProjectSelectionSection'
import { SidebarUtilities } from './SidebarUtilities'
import { CollapsedSidebar } from './CollapsedSidebar'
import { SidebarResizeHandle } from './SidebarResizeHandle'
import { DiagnosticsDrawer } from './DiagnosticsDrawer'

/**
 * The one canonical ForgeMind sidebar. It is a controlled surface: all Project/Workspace
 * data and persistence live in WorkspaceScreen and flow in through props. This component
 * owns only presentation and the transient interaction state in `useSidebarStore`.
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

  // The "Current Projects" section is driven by the multi-Project session state. Until that is
  // populated (or in tests/detached contexts that don't pass it) fall back to showing just the
  // single active Project so the section is never empty.
  const currentProjects =
    openProjects && openProjects.length > 0
      ? openProjects
      : [{ project, isActive: true, folderMissing: projectFolderMissing }]
  const draftWidth = useSidebarStore((state) => state.draftWidth)
  const diagnosticsOpen = useSidebarStore((state) => state.diagnosticsOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)

  const activeWorkspaceName =
    workspaces.find((entry) => entry.workspace.id === activeWorkspaceId)?.workspace.name ?? 'None'

  // Split the active Project's Workspaces into the two sections: those attached to THIS window
  // vs those detached onto other monitors. Placements are authoritative (from the Rust
  // registry); when absent (default) every Workspace is attached — unchanged behavior.
  const detachedIds = new Set(placements.filter((item) => item.mode === 'detached').map((item) => item.workspaceId))
  const attachedWorkspaces = workspaces.filter((entry) => !detachedIds.has(entry.workspace.id))
  const detachedWorkspaces = workspaces.filter((entry) => detachedIds.has(entry.workspace.id))

  const effectiveWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : (draftWidth ?? width)

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
          <ProjectSelectionSection recents={props.recents} openProjectIds={new Set(currentProjects.map((entry)=>entry.project.id))} actions={actions}/>
          <CurrentProjectsSection openProjects={currentProjects} actions={actions} />
          <WorkspacesSection
            workspaces={attachedWorkspaces}
            activeWorkspaceId={activeWorkspaceId}
            switchingWorkspaceId={switchingWorkspaceId}
            loading={loadingWorkspaces}
            actions={actions}
          />
          <WorkspacesOtherMonitorsSection
            workspaces={detachedWorkspaces}
            placements={placements}
            monitors={monitors}
            actions={actions}
          />
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
