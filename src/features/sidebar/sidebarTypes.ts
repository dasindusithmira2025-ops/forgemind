import type { MonitorInfo, Project, RecentWorkspace, TerminalSession, Workspace, WorkspacePlacement } from '../../native/types'

/**
 * The canonical runtime state of one Workspace, derived from real Terminal Sessions rather
 * than guessed from stale UI. See `deriveWorkspaceRuntimeSummary`.
 */
export type WorkspaceRuntimeStatus =
  | 'closed'
  | 'starting'
  | 'active'
  | 'partially_active'
  | 'waiting'
  | 'attention'
  | 'stopping'
  | 'failed'

export interface WorkspaceRuntimeSummary {
  workspaceId: string
  configuredPaneCount: number
  startingCount: number
  runningCount: number
  waitingCount: number
  exitedCount: number
  failedCount: number
  disconnectedCount: number
  deferredCount: number
  activeProviders: string[]
  status: WorkspaceRuntimeStatus
  requiresAttention: boolean
  updatedAt: string
}

/** Concise provider identities for a Workspace row: `Claude · Codex · OpenCode · +2`. */
export interface ProviderSummary {
  labels: string[]
  visible: string[]
  overflow: number
  text: string
}

/** One Workspace as the sidebar renders it — configuration plus derived runtime facts. */
export interface SidebarWorkspace {
  workspace: Workspace
  runtime: WorkspaceRuntimeSummary
  providers: ProviderSummary
}

/** One open Project as the "Current Projects" section renders it. Several may be open at once
 *  in the main window; exactly one is active (focused). Background Projects keep their terminals
 *  running per the configured policy. */
export interface SidebarOpenProject {
  project: Project
  isActive: boolean
  folderMissing?: boolean
  state?: 'active'|'background'|'missing'|'attention'
  runtimeSummary?: string
}

/** Inputs the runtime derivation needs; kept explicit so the selector stays pure/testable. */
export interface RuntimeDerivationInput {
  workspaceId: string
  configuredPaneCount: number
  sessions: TerminalSession[]
  deferredPaneIds?: string[]
  stopping?: boolean
  updatedAt?: string
}

/**
 * The sidebar is a controlled surface: WorkspaceScreen owns Project/Workspace/runtime data
 * and persistence, and passes these callbacks. The sidebar never mutates persistence itself.
 */
export interface SidebarActions {
  onSelectWorkspace: (workspaceId: string) => void
  onOpenFresh: (workspaceId: string) => void
  onNewWorkspace: () => void
  onRenameWorkspace: (workspaceId: string) => void
  onReconfigureWorkspace: (workspaceId: string) => void
  onDuplicateWorkspace: (workspaceId: string) => void
  onRestartWorkspace: (workspaceId: string) => void
  onStopWorkspace: (workspaceId: string) => void
  onMoveWorkspace: (workspaceId: string, direction: -1 | 1) => void
  onReorder: (orderedIds: string[]) => void
  onRemoveRecent: (workspaceId: string) => void
  onDeleteWorkspace: (workspaceId: string) => void
  onOpenProjectFolder: () => void
  onLocateFolder: () => void
  onRefreshProject: () => void
  onOpenLauncher: () => void
  // ---- Multi-Project session (main window; several Projects open at once) ------------------
  /** Focus an already-open Project (never closes the others). */
  onSelectProject?: (projectId: string) => void
  /** Close an open Project's session, applying the background-terminal policy. */
  onCloseProject?: (projectId: string) => void
  onOpenProject?: (projectId: string) => void
  onCreateProjectWorkspace?: (projectId: string) => void
  onOpenProjectMission?: (projectId: string) => void
  onOpenProjectMemory?: (projectId: string) => void
  onRevealProject?: (projectId: string) => void
  onRefreshProjectById?: (projectId: string) => void
  onOpenSettings: () => void
  onToggleCollapse: () => void
  onResizeCommit: (width: number) => void
  // ---- Multi-monitor Workspace placement (optional; present only in the main window) ------
  /** Detach a Workspace into its own native window (or focus it if already detached). */
  onOpenInNewWindow?: (workspaceId: string) => void
  /** Bring a detached Workspace back into the main window. */
  onAttachWorkspace?: (workspaceId: string) => void
  /** Raise and focus an already-detached Workspace window (never duplicates it). */
  onFocusWorkspaceWindow?: (workspaceId: string) => void
  /** Open the Move-to-Monitor picker for a detached Workspace. */
  onMoveToMonitor?: (workspaceId: string) => void
  /** Close a detached Workspace's native window. */
  onCloseWorkspaceWindow?: (workspaceId: string) => void
}

export interface ForgeSpaceSidebarProps {
  project: Project
  activeWorkspaceId: string
  workspaces: SidebarWorkspace[]
  recents: RecentWorkspace[]
  collapsed: boolean
  width: number
  switchingWorkspaceId?: string
  projectFolderMissing: boolean
  loadingWorkspaces?: boolean
  actions: SidebarActions
  /** Placement per Workspace; drives the This-Window vs Other-Monitors split. Optional so the
   *  detached window (which never renders the full sidebar) and tests can omit it. */
  placements?: WorkspacePlacement[]
  /** Connected monitors, for Move-to-Monitor and the Other-Monitors row subtitles. */
  monitors?: MonitorInfo[]
  /** Every Project currently open in the main window (the "Current Projects" section). When
   *  omitted the section falls back to showing just the single active `project`. */
  openProjects?: SidebarOpenProject[]
}
