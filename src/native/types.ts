export type AgentProvider =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'powershell'
  | 'command_prompt'
  | 'wsl'
  | 'custom_shell'

export type SplitDirection = 'horizontal' | 'vertical'

export type LayoutNode =
  | { type: 'pane'; paneId: string }
  | {
      type: 'split'
      direction: SplitDirection
      sizes: number[]
      children: LayoutNode[]
    }

export interface Project {
  id: string
  name: string
  rootPath: string
  canonicalRootPath: string
  gitBranch?: string
  detectedFramework?: string
  packageManager?: string
  majorLanguages: string[]
  isGitRepository: boolean
  hasPackageJson: boolean
  hasLockfile: boolean
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface AgentDetectionResult {
  provider: AgentProvider
  available: boolean
  executablePath?: string
  version?: string
  errorCode?: string
  errorMessage?: string
  detectedAt: string
}

export interface ShellProfile {
  id: string
  name: string
  executablePath: string
  args: string[]
  available: boolean
  source: 'detected' | 'custom'
}

export interface PaneAssignment {
  id: string
  workspaceId?: string
  title: string
  provider: AgentProvider
  executablePath: string
  args: string[]
  shellProfileId?: string
  profileId?: string
  workingDirectory: string
  workingDirectoryMode: 'project_relative' | 'custom'
  positionOrder: number
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  normalizedName: string
  layout: LayoutNode
  activePaneId?: string
  restoreBehavior: 'inherit' | 'ask' | 'restart_agents' | 'fresh_shells'
  panes: PaneAssignment[]
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface WorkspaceSaveRequest {
  id?: string
  projectId: string
  name: string
  layout: LayoutNode
  activePaneId?: string
  restoreBehavior: Workspace['restoreBehavior']
  panes: PaneAssignment[]
}

export interface RecentWorkspace {
  workspace: Workspace
  projectName: string
  projectPath: string
  projectMissing: boolean
}

export interface ProjectOverview {
  project: Project
  workspaces: Workspace[]
  folderMissing: boolean
}

export interface TerminalSession {
  id: string
  projectId: string
  workspaceId: string
  paneId: string
  provider: AgentProvider
  executable: string
  arguments: string[]
  title: string
  workingDirectory: string
  status: 'running' | 'exited' | 'terminated' | 'disconnected' | 'failed'
  processId?: number
  startedAt: string
  endedAt?: string
  exitCode?: number
  outputTail: number[]
  nextSequence: number
  logPath?: string
  restorationState: 'not_requested' | 'stale' | 'restored' | 'deferred' | 'failed'
  droppedOutputBytes: number
}

export interface StartTerminalRequest {
  workspaceId: string
  paneId: string
  cols: number
  rows: number
  restorationAttempt?: boolean
}

export interface TerminalOutputEvent {
  sessionId: string
  paneId: string
  sequence: number
  timestamp: string
  data: number[]
}

export interface TerminalExitEvent {
  sessionId: string
  paneId: string
  exitCode?: number
  timestamp: string
}

export interface TerminalStatusEvent {
  session: TerminalSession
  lifecycleEvent: string
}

export interface RestorationProgress {
  workspaceId: string
  paneId: string
  state: 'starting' | 'running' | 'failed' | 'deferred'
  completed: number
  total: number
}

export interface RestorationFailure {
  paneId: string
  code: string
  message: string
  attempts: number
}

export interface RestorationResult {
  workspaceId: string
  sessions: TerminalSession[]
  deferredPaneIds: string[]
  failures: RestorationFailure[]
  budget: number
}

export interface AgentProfile {
  id: string
  provider: AgentProvider
  name: string
  executablePath: string
  version?: string
  available: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentSession {
  terminalSessionId: string
  projectId: string
  workspaceId: string
  paneId: string
  profileId?: string
  provider: AgentProvider
  providerSessionId?: string
  transcriptPath?: string
  status: string
  createdAt: string
  updatedAt: string
}

export interface HealthReport {
  healthy: boolean
  schemaVersion: number
  foreignKeyViolations: number
  staleLiveSessions: number
  quarantinedRecords: number
  messages: string[]
}

export interface RepairSummary {
  inspected: number
  repaired: number
  quarantined: number
  entries: Array<{ code: string; entityType: string; entityId?: string; detail: string }>
}

export interface DiagnosticsSnapshot {
  applicationVersion: string
  databasePath: string
  logDirectory: string
  schemaVersion: number
  backupPath?: string
  liveTerminalCount: number
  health: HealthReport
}

export interface AppSettings {
  sidebarOpen: boolean
  sidebarWidth: number
  uiScale: number
  terminalFontSize: number
  terminalFontFamily: string
  terminalLineHeight: number
  cursorStyle: 'block' | 'underline' | 'bar'
  defaultShell?: string
  claudeExecutablePath?: string
  codexExecutablePath?: string
  opencodeExecutablePath?: string
  scrollbackSize: number
  copyOnSelect: boolean
  confirmMultilinePaste: boolean
  confirmClosePane: boolean
  reopenLastWorkspace: boolean
  restoreBehavior: 'ask' | 'restart_agents' | 'fresh_shells'
  outputLogRetention: 'tail_only' | 'rotating_log'
  restorationLaunchBudget: number
  defaultLayout: string
  defaultPaneCount: number
  inactiveWorkspaceProcesses: 'keep_running' | 'ask' | 'stop'
  inactiveWorkspaceRendering: 'hibernate'
  settingsVersion: number
}

export interface NativeError {
  code: string
  message: string
  recoverable: boolean
  detail?: string
  affectedEntity?: string
  recommendedAction?: string
  sourceLayer: string
}

// ---- Multi-Project + multi-monitor Workspace package -------------------------------------

export type PlacementMode = 'attached' | 'detached'

export interface WindowGeometry {
  x: number
  y: number
  width: number
  height: number
}

export interface MonitorRect {
  x: number
  y: number
  width: number
  height: number
}

/** Which Projects are open in the main session, plus each one's last-active Workspace/Pane. */
export interface OpenProjectSession {
  projectId: string
  isActive: boolean
  lastWorkspaceId?: string
  lastPaneId?: string
  expanded: boolean
  openedAt: string
  updatedAt: string
}

/** Where a Workspace is displayed. Authoritative in Rust; renderers cache it. */
export interface WorkspacePlacement {
  workspaceId: string
  mode: PlacementMode
  windowLabel?: string
  monitorId?: string
  preferredMonitorId?: string
  monitorAlias?: string
  geometry?: WindowGeometry
  maximized: boolean
  fullscreen: boolean
  placementRevision: number
  lastFocusAt?: string
  /** Window label currently holding the exclusive interactive lease, if any. */
  leaseOwnerLabel?: string
  leaseId?: string
}

export interface HandoffTicket {
  operationId: string
  workspaceId: string
  fromWindowLabel?: string
  toWindowLabel: string
  targetMode: PlacementMode
  expectedRevision: number
  leaseId: string
}

export interface MonitorInfo {
  id: string
  name: string
  alias?: string
  bounds: MonitorRect
  workArea: MonitorRect
  scaleFactor: number
  isPrimary: boolean
  windowCount: number
}

/** A detached Workspace window rescued onto the primary work area after its monitor vanished. */
export interface RecoveredWindow {
  workspaceId: string
  windowLabel: string
  geometry: WindowGeometry
  preferredMonitorId?: string
  preferredMonitorAlias?: string
}

/** A displaced Workspace whose preferred monitor is connected again (offer to move it back). */
export interface ReconnectOffer {
  workspaceId: string
  monitorId: string
  monitorAlias?: string
}

/** Result of a monitor-recovery sweep: rescued windows + reconnect offers. */
export interface MonitorRecoveryReport {
  recovered: RecoveredWindow[]
  reconnectable: ReconnectOffer[]
}
