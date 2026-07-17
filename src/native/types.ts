export type AgentProvider =
  | 'claude'
  | 'codex'
  | 'opencode'
  | 'powershell'
  | 'command_prompt'
  | 'wsl'
  | 'custom_shell'

export type AgentActivityState =
  | 'working'
  | 'needs_input'
  | 'needs_permission'
  | 'idle'
  | 'finished'
  | 'failed'

export type AgentStateSource =
  | 'heuristic'
  | 'shell_integration'
  | 'provider_hook'
  | 'process_exit'

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
  data: Uint8Array
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
  agentState: AgentActivityState
  agentStateSource: AgentStateSource
  agentStateReason: string
  agentAttentionSince?: string
  agentStateUpdatedAt: string
  createdAt: string
  updatedAt: string
}

export interface AgentStateEvent {
  terminalSessionId: string
  projectId: string
  workspaceId: string
  paneId: string
  provider: AgentProvider
  state: AgentActivityState
  source: AgentStateSource
  reason: string
  attentionSince?: string
  updatedAt: string
}

export interface GitChangedFile {
  path: string
  indexStatus: string
  worktreeStatus: string
  conflicted: boolean
}

export interface PaneGitReview {
  repositoryPath: string
  workingDirectory: string
  branch: string
  files: GitChangedFile[]
  diff: string
  diffTruncated: boolean
  conflicts: string[]
}

export interface IsolatedWorktreeResult {
  workspace: Workspace
  repositoryPath: string
  worktreePath: string
  branchName: string
  baseRef: string
}

export interface HealthReport {
  healthy: boolean
  schemaVersion: number
  integrityCheck: string
  foreignKeyViolations: number
  staleLiveSessions: number
  quarantinedRecords: number
  messages: string[]
}

export type ReadinessStatus = 'pass' | 'warning' | 'fail'
export interface ReadinessCheck {
  id: string
  label: string
  status: ReadinessStatus
  detail: string
  action?: string
}
export interface ReadinessReport {
  checkedAt: string
  firstRun: boolean
  ready: boolean
  checks: ReadinessCheck[]
}

export interface RepairSummary {
  inspected: number
  repaired: number
  quarantined: number
  entries: Array<{ code: string; entityType: string; entityId?: string; detail: string }>
}

export interface DiagnosticsSnapshot {
  product: string
  company: string
  appIdentifier: string
  applicationVersion: string
  edition: string
  buildCommit: string
  buildTimestamp: string
  releaseChannel: string
  target: string
  architecture: string
  databasePath: string
  logDirectory: string
  schemaVersion: number
  backupPath?: string
  backupDirectory: string
  liveTerminalCount: number
  updaterEndpointStatus: string
  lastUpdateCheck?: string
  lastUpdateResult?: string
  pendingUpdate?: string
  backupStatus: string
  migrationStatus: string
  legacyMigrationStatus: string
  legacyMigrationMessage: string
  legacyMigrationBackup?: string
  installerType: string
  updateDataDirectory: string
  updateLogEntries: string[]
  health: HealthReport
  readiness: ReadinessReport
}

export type ProductEdition = 'stable' | 'preview'
export type UpdatePhase = 'idle'|'checking'|'no_update'|'available'|'downloading'|'downloaded'|'restart_requested'|'installation_started'|'first_launch_pending'|'migration_started'|'health_check_started'|'healthy_startup_confirmed'|'failed'|'recovery_mode'
export interface BuildInfo {
  product: string
  edition: ProductEdition
  version: string
  gitCommit: string
  buildTimestamp: string
  releaseChannel: string
  databaseSchemaVersion: number
  target: string
  architecture: string
  appIdentifier: string
  updateEndpoint: string
  updaterPublicKeyProvisioned: boolean
  bundledRelease: Record<string, unknown>
}
export interface AvailableUpdate {
  version: string
  releaseNotes: string
  publishedAt?: string
  edition: string
  channel: string
  schemaVersion: number
  minimumSchemaVersion: number
  maximumSchemaVersion: number
  rolloutPercent: number
  commit?: string
  buildTimestamp?: string
  previousInstallerUrl?: string
}
export interface UpdateJournal {
  phase: UpdatePhase
  fromVersion: string
  targetVersion?: string
  fromSchemaVersion: number
  targetSchemaVersion?: number
  lastCheckAt?: string
  lastResult?: string
  signatureVerified: boolean
  downloadReceived: number
  downloadTotal?: number
  installOnExit: boolean
  firstLaunchAttempts: number
  latestBackupPath?: string
  previousInstallerUrl?: string
  error?: string
  available?: AvailableUpdate
  history: Array<{ phase: UpdatePhase; at: string; detail?: string }>
}
export interface UpdateStatus {
  build: BuildInfo
  journal: UpdateJournal
  endpointConfigured: boolean
  endpointStatus: string
  installerType: string
  recoveryMode: boolean
  updateDataDirectory: string
}
export interface SafeRestartClientState { unsavedEditorState: boolean; unsavedSettings: boolean; unsavedMissionDraft: boolean }
export interface SafeRestartAssessment extends SafeRestartClientState {
  safe: boolean
  runningTerminals: number
  activeAgents: number
  activeMissions: number
  pendingDatabaseWrites: number
  blockers: string[]
}
export interface StartupStatus {
  recoveryMode: boolean
  failingAppVersion?: string
  failingSchemaVersion?: number
  message?: string
  latestBackupPath?: string
  previousInstallerUrl?: string
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
  automaticUpdateChecks: boolean
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
