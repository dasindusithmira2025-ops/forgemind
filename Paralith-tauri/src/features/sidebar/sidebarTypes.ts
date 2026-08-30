import type { MonitorInfo, Project, RecentWorkspace, TerminalSession, Workspace, WorkspacePlacement } from '../../native/types'
import type { PaneAgentState } from './sidebarAgentStatus'

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
  /** Running Panes that are *not* blocked on a human; `waitingCount` holds those separately. */
  runningCount: number
  waitingCount: number
  exitedCount: number
  failedCount: number
  disconnectedCount: number
  deferredCount: number
  activeProviders: string[]
  status: WorkspaceRuntimeStatus
  requiresAttention: boolean
  /**
   * When this Workspace's longest-waiting Pane started waiting, if any is. Orders Workspaces
   * inside the same attention class so the one ignored longest sorts first.
   */
  attentionSince?: string
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

/**
 * One open Project together with its Workspaces, as the grouped sidebar list renders it.
 *
 * This is the unit the sidebar's primary list is built from since the Project rail was absorbed
 * into group headers: the list spans every open Project rather than only the active one, so a
 * background Project's Workspaces are reachable without switching first.
 */
export interface SidebarProjectGroup {
  project: Project
  isActive: boolean
  folderMissing: boolean
  /** This Project's Workspaces in persisted order, each with derived runtime facts. */
  workspaces: SidebarWorkspace[]
  /** Short human summary of the Project's live terminals, shown in the group header. */
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
  /**
   * This Workspace's resolved per-Pane agent states. Supplied already resolved (rather than as raw
   * events plus a clock) so the derivation stays a pure function of its inputs. Omitting it yields
   * the Session-only view — correct, just blind to Panes that are blocked on a human.
   */
  paneAgentStates?: PaneAgentState[]
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
  onRevealProject?: (projectId: string) => void
  onRefreshProjectById?: (projectId: string) => void
  onOpenSettings: () => void
  /** Open workspace-scoped Source Control for the active project/worktree. */
  onOpenRepository?: () => void
  /** Open the Database Studio surface for the active project. */
  onOpenDatabase?: () => void
  /** Open the Context Fabric (Memory) surface for the active project. */
  onOpenMemory?: () => void
  /** Open Usage analytics. Application-scoped: token consumption is observed per machine. */
  onOpenUsage?: () => void
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
  /**
   * Every open Project with its own Workspaces — the source for the grouped primary list. When
   * omitted (the detached window, tests) the sidebar synthesises a single group from `project`
   * and `workspaces`, so the list degrades to the previous single-Project behaviour.
   */
  groups?: SidebarProjectGroup[]
  /**
   * Whether the cross-workspace runtime view has been read once. The list is scoped to Projects
   * with live work, and before the first read "nothing is running" is an artefact of not having
   * asked yet — so the scoping waits for this rather than hiding Projects on first paint.
   */
  runtimeSeeded?: boolean
}
