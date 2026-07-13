import { useSidebarStore } from '../sidebarStore'
import { SIDEBAR_COLLAPSED_WIDTH } from '../sidebarPreferences'
import type { ForgeSpaceSidebarProps } from '../sidebarTypes'
import { SidebarBrandHeader } from './SidebarBrandHeader'
import { CurrentProjectBlock } from './CurrentProjectBlock'
import { WorkspacesSection } from './WorkspacesSection'
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
    recents,
    collapsed,
    width,
    switchingWorkspaceId,
    projectFolderMissing,
    loadingWorkspaces,
    actions,
  } = props
  const draftWidth = useSidebarStore((state) => state.draftWidth)
  const diagnosticsOpen = useSidebarStore((state) => state.diagnosticsOpen)
  const setDiagnostics = useSidebarStore((state) => state.setDiagnosticsOpen)

  const activeWorkspaceName =
    workspaces.find((entry) => entry.workspace.id === activeWorkspaceId)?.workspace.name ?? 'None'

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
          <CurrentProjectBlock
            project={project}
            recents={recents}
            projectFolderMissing={projectFolderMissing}
            actions={actions}
          />
          <WorkspacesSection
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            switchingWorkspaceId={switchingWorkspaceId}
            loading={loadingWorkspaces}
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
