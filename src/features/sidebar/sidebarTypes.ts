import type { Project, RecentWorkspace, TerminalSession, Workspace } from '../../native/types'

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
  onOpenSettings: () => void
  onToggleCollapse: () => void
  onResizeCommit: (width: number) => void
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
}
