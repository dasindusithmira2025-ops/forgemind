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

// ---- Repository Command Center -----------------------------------------------------------

export type RepositoryActorKind = 'human' | 'agent' | 'system'
export interface RepositoryActor {
  kind: RepositoryActorKind
  id: string
  displayName: string
  agentRunId?: string
  model?: string
  taskId?: string
}

export type RepositoryPolicyProfile = 'conservative' | 'balanced' | 'autonomous' | 'custom'
export type RepositoryPolicyDecisionKind = 'allowed' | 'approval_required' | 'blocked'
export interface RepositoryPolicyDecision { decision: RepositoryPolicyDecisionKind; risk: string; reason: string }

export interface RepositoryOperationContext {
  projectId: string
  repositoryPath?: string
  worktreePath?: string
  actor: RepositoryActor
  baseCommit?: string
  expectedBranch?: string
  approvalId?: string
  idempotencyKey: string
  timeoutSeconds?: number
}

export type RepositoryOperation =
  | { kind: 'refresh_repository' }
  | { kind: 'stage_paths'; paths: string[] }
  | { kind: 'stage_hunks'; patch: string }
  | { kind: 'unstage_paths'; paths: string[] }
  | { kind: 'restore_paths'; paths: string[] }
  | { kind: 'create_branch'; name: string; startPoint?: string }
  | { kind: 'switch_branch'; name: string }
  | { kind: 'delete_branch'; name: string }
  | { kind: 'create_agent_worktree'; branch: string; baseCommit: string; agentId: string; taskId: string; fileScope: string[]; expiresAt?: string }
  | { kind: 'remove_worktree'; leaseId: string }
  | { kind: 'create_checkpoint'; message: string; paths: string[] }
  | { kind: 'commit_change_set'; message: string; paths: string[] }
  | { kind: 'amend_commit'; message?: string; paths: string[] }
  | { kind: 'fetch_remote'; remote: string; prune: boolean }
  | { kind: 'pull_branch'; remote: string; branch: string; rebase: boolean }
  | { kind: 'push_branch'; remote: string; branch: string; forceWithLease: boolean }
  | { kind: 'publish_branch'; remote: string; branch: string }
  | { kind: 'create_tag'; name: string; revision: string; message?: string }
  | { kind: 'delete_tag'; name: string }
  | { kind: 'create_stash'; message?: string; includeUntracked: boolean }
  | { kind: 'apply_stash'; revision: string; pop: boolean }
  | { kind: 'revert_commit'; revision: string }
  | { kind: 'cherry_pick'; revision: string }
  | { kind: 'rebase_branch'; upstream: string }
  | { kind: 'merge_branch'; branch: string; noFf: boolean }
  | { kind: 'open_draft_pull_request'; base: string; head: string; title: string; body: string }
  | { kind: 'update_pull_request'; number: number; title?: string; body?: string }
  | { kind: 'mark_pull_request_ready'; number: number }
  | { kind: 'request_review'; number: number; reviewers: string[] }
  | { kind: 'submit_review'; number: number; event: 'approve' | 'request_changes' | 'comment'; body: string }
  | { kind: 'resolve_review_thread'; threadId: string }
  | { kind: 'rerun_workflow'; runId: number; failedOnly: boolean }
  | { kind: 'cancel_workflow'; runId: number }
  | { kind: 'merge_pull_request'; number: number; method: 'merge' | 'squash' | 'rebase'; expectedHeadSha: string }
  | { kind: 'delete_remote_branch'; remote: string; branch: string }
  | { kind: 'create_release'; tag: string; title: string; notes: string; draft: boolean }

export interface RepositoryOperationRequest { context: RepositoryOperationContext; operation: RepositoryOperation }
export type RepositoryOperationStatus = 'queued' | 'running' | 'awaiting_approval' | 'succeeded' | 'failed' | 'cancelled' | 'needs_recovery'
export interface RepositoryOperationRecord {
  id: string; projectId: string; kind: string; status: RepositoryOperationStatus
  policy: RepositoryPolicyDecision; result?: unknown; errorCode?: string; errorMessage?: string
  createdAt: string; startedAt?: string; completedAt?: string
}
export interface RepositoryOperationEvent {
  operationId: string; projectId: string; kind: string; phase: string; message: string; percent?: number; at: string
}
export interface RepositoryFileStatus {
  path: string; originalPath?: string; indexStatus: string; worktreeStatus: string; conflicted: boolean
  untracked: boolean; renamed: boolean; deleted: boolean; submodule: boolean
}
export interface RepositoryHealth {
  gitAvailable: boolean; worktreeValid: boolean; bare: boolean; shallow: boolean
  mergeInProgress: boolean; rebaseInProgress: boolean; cherryPickInProgress: boolean; revertInProgress: boolean
  indexLocked: boolean; submodulesPresent: boolean; gitLfsAvailable: boolean; warnings: string[]
}
export interface RepositorySnapshot {
  projectId: string; repositoryPath: string; worktreePath: string; branch?: string; headSha: string; upstream?: string
  ahead: number; behind: number; remotes: string[]; files: RepositoryFileStatus[]; health: RepositoryHealth; capturedAt: string
}
export interface RepositoryBranchSummary {
  name: string; fullRef: string; kind: 'local' | 'remote'; current: boolean; headSha: string; upstream?: string
  ahead: number; behind: number; latestSubject: string; latestCommitAt: string
}
export interface RepositoryDiffRequest {
  projectId: string; repositoryPath?: string; worktreePath?: string; path?: string; staged: boolean
  contextLines?: number; offset?: number; limit?: number
}
export interface RepositoryDiff { text: string; totalBytes: number; offset: number; truncated: boolean; binary: boolean }
export interface RepositoryWorktreeLease {
  id: string; projectId: string; repositoryPath: string; worktreePath: string; branchName: string; baseCommit: string
  agentId: string; taskId: string; fileScope: string[]; status: string; createdAt: string; lastActivityAt: string
  expiresAt?: string; cleanupState: string
}
export interface RepositoryApprovalRequest {
  id: string; operationId: string; projectId: string; operationKind: string; actor: RepositoryActor; branch?: string
  commitSha: string; risk: string; reason: string; expectedEffects: string; recoveryStrategy: string
  stateFingerprint: string; status: string; expiresAt: string; approvedBy?: string; approvedAt?: string; finalResult?: unknown
}
export interface ApprovalDecisionRequest { projectId: string; approvalId: string; approved: boolean; humanId: string; reason?: string }
export interface RepositoryApprovalOutcome { approval: RepositoryApprovalRequest; operation?: RepositoryOperationRecord }
export interface RepositoryPolicyConfiguration { projectId: string; profile: RepositoryPolicyProfile; customRules: Record<string, unknown>; protectedBranches: string[] }
export interface MergeReadinessRequest { projectId: string; repositoryPath?: string; pullRequestNumber: number; expectedHeadSha?: string }
export interface MergeReadiness {
  ready: boolean; blockingReasons: string[]; warnings: string[]; requiredActions: string[]; evidence: unknown
  evaluatedAt: string; sourceHeadSha: string; sourceUpdatedAt?: string
}
export interface ProviderAccountStatus { provider: string; host: string; authenticated: boolean; accountLogin?: string; authenticationSource: string; permissions: string[]; message: string }
export interface WorktreeConflictRisk { leftLeaseId: string; rightLeaseId: string; overlappingPaths: string[]; inferred: boolean }
export interface RemoteProjectionRequest { projectId: string; repositoryPath?: string }
export interface WorkflowRunDetailRequest { projectId: string; repositoryPath?: string; runId: number }
export interface PullRequestDetailRequest { projectId: string; repositoryPath?: string; number: number }
export interface RemoteProjectionObject { kind: string; externalId: string; payload: unknown; fetchedAt: string; stale: boolean; deleted: boolean }
export interface RemoteSyncStatus {
  category: string; status: 'healthy' | 'stale' | 'failed'; lastAttemptAt?: string; lastSuccessfulSync?: string
  staleSince?: string; errorCode?: string; errorMessage?: string; requiredPermission?: string; recoveryAction?: string
}
export interface RemoteProjection {
  projectId: string; provider: string; repository: unknown; objects: RemoteProjectionObject[]
  syncStatuses: RemoteSyncStatus[]; rateLimit?: unknown; lastSuccessfulSync: string; stale: boolean
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

// ---- Paralith Swarms ----------------------------------------------------------------------
// The backend is the authority for every field here; the frontend only renders these.

export type SwarmLifecycle =
  | 'draft' | 'preparing' | 'understanding' | 'planning' | 'running' | 'verifying'
  | 'decision_needed' | 'paused' | 'stopping' | 'reviewing' | 'ready' | 'completed'
  | 'failed' | 'cancelled' | 'recovering' | 'archived'

export type SwarmPhase = 'understanding' | 'planning' | 'building' | 'verifying' | 'ready'

export type SwarmRole = 'coordinator' | 'scout' | 'builder' | 'debugger' | 'reviewer' | 'integrator'

export type SwarmRuntimeKind = 'auto' | 'claude' | 'codex'

export type SwarmAgentStatus =
  | 'idle' | 'activating' | 'working' | 'waiting' | 'paused' | 'failed' | 'stopped'

export type SwarmTaskStatus =
  | 'pending' | 'ready' | 'assigned' | 'running' | 'blocked' | 'verifying' | 'review'
  | 'done' | 'failed' | 'cancelled'

export interface SwarmRoleConfig {
  role: SwarmRole
  runtime: SwarmRuntimeKind
  desiredCount: number
  enabled: boolean
}

export interface SwarmAgent {
  id: string
  swarmId: string
  role: SwarmRole
  runtime: SwarmRuntimeKind
  status: SwarmAgentStatus
  currentTaskId?: string | null
  terminalSessionId?: string | null
  lastResult?: string | null
  createdAt: string
  updatedAt: string
}

export interface SwarmTask {
  id: string
  swarmId: string
  title: string
  role: SwarmRole
  status: SwarmTaskStatus
  assignedAgentId?: string | null
  progress: number
  files: string[]
  dependsOn: string[]
  attempts: number
  result?: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export interface SwarmEvent {
  id: string
  swarmId: string
  kind: string
  role?: SwarmRole | null
  agentId?: string | null
  taskId?: string | null
  summary: string
  level: string
  createdAt: string
}

export interface SwarmDecision {
  problem: string
  reason: string
  recommended: string
  recommendationReasons: string[]
  alternative: string
  raisedAt: string
}

export interface SwarmSummary {
  outcome: string
  filesChanged: number
  testsPassed: number
  scenariosVerified: number
  unresolvedConflicts: number
  notes: string[]
  teamUsed: string[]
  durationSeconds: number
}

export interface Swarm {
  id: string
  projectId: string
  projectRoot: string
  name: string
  mission: string
  lifecycle: SwarmLifecycle
  phase: SwarmPhase
  teamPreset: string
  maxParallel: number
  instructions: string
  progress: number
  priority: number
  archived: boolean
  decision?: SwarmDecision | null
  summary?: SwarmSummary | null
  reviewVerdict?: string | null
  roles: SwarmRoleConfig[]
  createdAt: string
  updatedAt: string
  startedAt?: string | null
  completedAt?: string | null
}

export interface SwarmActivity {
  activeAgents: number
  totalAgents: number
  tasksTotal: number
  tasksDone: number
  tasksRunning: number
}

export interface SwarmListItem {
  swarm: Swarm
  activity: SwarmActivity
}

export interface SwarmDetail {
  swarm: Swarm
  activity: SwarmActivity
  agents: SwarmAgent[]
  tasks: SwarmTask[]
  events: SwarmEvent[]
}

export interface SwarmPreset {
  id: string
  name: string
  builtin: boolean
  isDefault: boolean
  maxParallel: number
  instructions: string
  roles: SwarmRoleConfig[]
  createdAt: string
  updatedAt: string
}

export interface CreateSwarmRequest {
  projectId: string
  mission: string
  name?: string
  presetId: string
  maxParallel?: number
  instructions?: string
  roles?: SwarmRoleConfig[]
}

export type ProjectCloseSwarmBehavior = 'keep_running' | 'pause_and_close'

export interface SwarmChangedEvent {
  projectId: string
  swarmId: string
}

export interface SavePresetRequest {
  id?: string
  name: string
  maxParallel: number
  instructions: string
  roles: SwarmRoleConfig[]
}
