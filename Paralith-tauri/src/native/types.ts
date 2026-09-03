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

export type UsageProvider = 'claude' | 'codex'
export type UsageFreshness = 'live' | 'recent' | 'stale' | 'unavailable'
export type UsageSnapshotStatus = 'ready' | 'loading' | 'unsupported' | 'unauthenticated' | 'stale' | 'error'
export type UsageWindowKind = 'five_hour' | 'daily' | 'weekly' | 'fable_weekly'
export type UsageConfidence = 'authoritative' | 'derived' | 'estimated'
export interface UsageWindow { kind: UsageWindowKind; usedPercent: number; remainingPercent: number; resetsAt?: string; resetLabel?: string; source: 'local_session_state' | 'provider_cli' | 'supported_endpoint'; confidence: UsageConfidence; isWarning: boolean; isCritical: boolean }
export interface TokenUsageSummary { inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheCreationTokens: number; reasoningTokens: number; totalTokens: number }
export interface ProviderUsageSnapshot { provider: UsageProvider; collectedAt: string; sourceUpdatedAt?: string; freshness: UsageFreshness; source: 'local_session_state' | 'provider_cli' | 'supported_endpoint'; windows: UsageWindow[]; tokenSummary?: TokenUsageSummary; status: UsageSnapshotStatus; diagnosticCode?: string; diagnosticMessage?: string }
/**
 * One observed analytics bucket: a provider's token totals for one UTC day and one model.
 * `model` is absent when the provider transcript did not record which model served the request —
 * the tokens are still real and still counted; only the cost attribution is unknown.
 *
 * `inputTokens` is *uncached* input on both providers; the backend normalises Codex's inclusive
 * counter before persisting so the two shapes can be summed.
 */
export interface UsageDailyRow { date: string; provider: UsageProvider; model?: string; tokens: TokenUsageSummary }
export interface AiUsageDiagnostics { provider: UsageProvider; filesSeen: number; filesReused: number; filesScanned: number; elapsedMs: number; status: UsageSnapshotStatus; diagnosticCode?: string }

export type TelemetryState = 'ready' | 'stale' | 'unavailable' | 'unauthenticated' | 'error'
export type TelemetryConfidence = 'confirmed' | 'estimated'
export interface SystemTelemetrySnapshot {
  sampledAt: string
  cpuPercent?: number
  memoryUsedBytes?: number
  memoryTotalBytes?: number
  diskUsedBytes?: number
  diskTotalBytes?: number
  state: TelemetryState
  confidence: TelemetryConfidence
  diagnosticMessage?: string
}
export interface ContributionDay { date: string; count: number }
export interface GithubActivitySnapshot {
  fetchedAt?: string
  sourceUpdatedAt?: string
  login?: string
  name?: string
  repositories?: number
  totalContributions?: number
  activeDays?: number
  averageContributionsPerActiveDay?: number
  bestDay?: ContributionDay
  contributions: ContributionDay[]
  state: TelemetryState
  confidence: TelemetryConfidence
  diagnosticCode?: string
  diagnosticMessage?: string
}
export interface UsageTelemetrySnapshot {
  system: SystemTelemetrySnapshot
  github: GithubActivitySnapshot
  lastSuccessfulRefresh?: string
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

export type AgentResumeStatus =
  | 'reconciling'
  | 'resumable'
  | 'launching'
  | 'running'
  | 'detached'
  | 'restored'
  | 'unavailable'
  | 'completed'

export interface AgentResumeRecord {
  terminalSessionId: string
  projectId: string
  projectName: string
  workspaceId: string
  workspaceName: string
  paneId: string
  provider: 'claude' | 'codex'
  providerSessionId?: string
  sessionTitle: string
  repositoryRoot: string
  repositoryIdentity: string
  worktreePath: string
  branch?: string
  workingDirectory: string
  launchExecutable: string
  launchArguments: string[]
  originalLaunchArguments: string[]
  lastActivityAt: string
  status: string
  shutdownReason: string
  recoveryStatus: AgentResumeStatus
  dismissedAt?: string
  errorCode?: string
  errorMessage?: string
  runningTerminalSessionId?: string
  commandPreview: string
}

export interface ResumeAgentSessionRequest {
  terminalSessionId: string
  inNewTerminal: boolean
  cols: number
  rows: number
}

export interface ResumeAgentSessionResult {
  sourceTerminalSessionId: string
  terminal: TerminalSession
  workspaceId: string
  paneId: string
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

/** The normalized Activity vocabulary. Mirrors `models::activity` on the Rust side. */
export type ActivitySource = 'agent' | 'github' | 'system'

export type ActivityState =
  | 'queued'
  | 'running'
  | 'waiting_for_user'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type ActivityInterruption =
  | 'provider_limit'
  | 'authentication_required'
  | 'permission_required'
  | 'network_failure'
  | 'process_exit'
  | 'dependency_failure'
  | 'user_cancelled'
  | 'unknown'

export interface ActivityStep {
  key: string
  label: string
  state: ActivityState
}

export interface ActivityApproval {
  runId: number
  environment: string
  environmentIds: number[]
  canApprove: boolean
  restriction?: string
}

export interface ActivityDetail {
  workflowPath?: string
  branch?: string
  commitSha?: string
  runNumber?: number
  attempt?: number
  url?: string
  environment?: string
  event?: string
  provider?: string
  workspaceId?: string
  paneId?: string
  terminalSessionId?: string
}

export interface ActivityThread {
  id: string
  projectId: string
  source: ActivitySource
  title: string
  summary: string
  state: ActivityState
  interruption?: ActivityInterruption
  reason?: string
  steps: ActivityStep[]
  approval?: ActivityApproval
  detail: ActivityDetail
  startedAt: string
  updatedAt: string
  observedAt: string
  resolvedAt?: string
  revision: number
}

export interface ActivityChangedEvent {
  thread: ActivityThread
  created: boolean
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

// ---- Source Control / repository service -------------------------------------------------

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
export interface RepositoryCommitSummary {
  sha: string; parents: string[]; authorName: string; authorEmail: string; authoredAt: string
  committerName: string; committerEmail: string; committedAt: string; subject: string
  /** Git decorations for this commit (branch tips, tags, HEAD), exactly as Git reports them. */
  refs: string[]
  /** Raw `%G?` status: G, B, U, X, Y, R, E or N. Never normalized into a verdict by the backend. */
  signature: string
}
export interface RepositoryHistoryRequest {
  projectId: string; repositoryPath?: string; worktreePath?: string; revision?: string; path?: string
  author?: string; search?: string; skip?: number; limit?: number
}
export interface RepositoryHistoryPage {
  commits: RepositoryCommitSummary[]; skip: number; hasMore: boolean; revision: string; path?: string
}
export interface RepositoryCommitFile {
  path: string; previousPath?: string; status: string
  /** `null` for binary files, where Git reports no line count. */
  additions: number | null; deletions: number | null; binary: boolean
}
export interface RepositoryCommitDetail {
  commit: RepositoryCommitSummary; body: string; files: RepositoryCommitFile[]
  additions: number; deletions: number; filesTruncated: boolean; merge: boolean
}
export interface RepositoryCommitDetailRequest {
  projectId: string; repositoryPath?: string; worktreePath?: string; revision: string
}
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
export type RepositoryGraphNodeKind =
  | 'repository' | 'worktree' | 'branch' | 'commit' | 'change_set' | 'file' | 'symbol' | 'test' | 'workflow' | 'risk'
export type RepositoryGraphEdgeKind =
  | 'contains' | 'points_to' | 'modifies' | 'declares' | 'depends_on' | 'tests' | 'builds' | 'blocked_by'
  | 'supported_by' | 'verified_by'
export type RepositoryGraphSourceKind =
  | 'git' | 'filesystem' | 'ast' | 'github' | 'workflow' | 'test' | 'agent' | 'memory'
/**
 * How a node or edge came to exist. `confidence` below 1 marks a heuristic relationship (stem
 * matching, textual reference) rather than an exact one — the UI must present those as leads.
 */
export interface RepositoryGraphProvenance {
  source: RepositoryGraphSourceKind; repositoryId: string; snapshot: string; observedAt: string
  extractorVersion: string; confidence: number; evidenceRef?: string
}
export interface RepositoryGraphNode {
  id: string; repositoryId: string; nodeType: RepositoryGraphNodeKind; externalKey: string; label: string
  metadata: unknown; contentHash: string; provenance: RepositoryGraphProvenance
}
export interface RepositoryGraphEdge {
  id: string; repositoryId: string; sourceNodeId: string; targetNodeId: string; edgeType: RepositoryGraphEdgeKind
  metadata: unknown; provenance: RepositoryGraphProvenance
}
export interface RepositoryGraphSnapshot {
  id: string; repositoryId: string; projectId: string; worktreePath: string; headSha: string; statusHash: string
  extractorVersion: string; createdAt: string; nodes: RepositoryGraphNode[]; edges: RepositoryGraphEdge[]
}
export interface RepositoryImpactItem { path: string; reason: string; confidence: number; evidence: string[] }
export interface RepositoryRiskSignal {
  code: string; severity: 'critical' | 'high' | 'medium' | 'low'; summary: string; evidence: string[]
}
export interface RepositoryImpactExplanation {
  targetType: string; target: string; relationship: string; reason: string; evidence: string[]; confidence: number
}
export interface RepositoryImpactSummary {
  changedFiles: string[]; changedSymbols: RepositoryImpactItem[]; directDependents: RepositoryImpactItem[]
  relatedTests: RepositoryImpactItem[]; relatedWorkflows: RepositoryImpactItem[]; riskSignals: RepositoryRiskSignal[]
  missingTestSignals: RepositoryRiskSignal[]; explanations: RepositoryImpactExplanation[]; generatedAt: string
}
export interface RepositoryIntelligenceRequest {
  projectId: string; repositoryPath?: string; worktreePath?: string; paths?: string[]; depth?: number
}
export interface RepositoryIntelligence {
  projectId: string; repositoryId: string; worktreePath: string; headSha: string; statusHash: string
  graph: RepositoryGraphSnapshot; impact: RepositoryImpactSummary
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
  runtime: RuntimeHealthSnapshot
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

export interface TerminalRuntimeResource {
  sessionId: string
  projectId: string
  workspaceId: string
  paneId: string
  provider: AgentProvider
  status: string
  processId?: number
  startedAt: string
  outputBytes: number
  outputBatches: number
  droppedOutputBytes: number
  inputWrites: number
  inputBytes: number
  resizeRequests: number
}

export interface TerminalRuntimeDiagnostics {
  managedProcessCount: number
  ptySessionCount: number
  creatingSessionCount: number
  orphanSessionCount: number
  processTypes: Record<string, number>
  lifecycleStates: Record<string, number>
  outputBytes: number
  outputBatches: number
  rendererDeliveries: number
  suppressedDeliveries: number
  droppedOutputBytes: number
  inputWrites: number
  inputBytes: number
  resizeRequests: number
  activeOutputSubscribers: number
  resources: TerminalRuntimeResource[]
}

export interface RuntimeHealthSnapshot {
  capturedAt: string
  terminals: TerminalRuntimeDiagnostics
  projectWatchers: number
  watcherSubscribers: number
  browserViews: number
  browserOperations: number
  knowledgeJobs: {
    queued: number
    running: number
    retrying: number
    failed: number
    payloadBytes: number
  }
  databaseBytes: number
  walBytes: number
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
export interface SafeRestartClientState { unsavedEditorState: boolean; unsavedSettings: boolean; unsavedBrowserState: boolean }
export interface SafeRestartAssessment extends SafeRestartClientState {
  safe: boolean
  /** Installation may proceed (after confirming soft blockers). False only when hard-blocked. */
  installable: boolean
  /** A Git mutation is in flight; installation is refused even with confirmation. */
  hardBlocked: boolean
  runningTerminals: number
  activeAgents: number
  activeSwarms: number
  detachedWindows: number
  gitMutationActive: boolean
  pendingDatabaseWrites: number
  /** Reviewable blockers the user can confirm to proceed. */
  blockers: string[]
  /** Blockers that must be resolved first and cannot be overridden. */
  hardBlockers: string[]
}
/** Payload of the throttled `update-progress` event broadcast during a download. */
export interface UpdateDownloadProgress { received: number; total?: number }
export interface StartupStatus {
  recoveryMode: boolean
  failingAppVersion?: string
  failingSchemaVersion?: number
  message?: string
  latestBackupPath?: string
  previousInstallerUrl?: string
}

/**
 * How the sidebar's primary list is grouped.
 *   `project` — one collapsible section per open Project (the default).
 *   `flat`    — every Workspace from every open Project in one ungrouped list.
 */
export type SidebarGroupBy = 'project' | 'flat'

/**
 * How the sidebar's primary list is ordered.
 *   `manual`    — the persisted per-Project order the user drags into place (the default).
 *   `attention` — Workspaces that need a human first.
 */
export type SidebarSortMode = 'manual' | 'attention'

/**
 * The sidebar's persisted view state. Split from `AppSettings` because that is main-window-only;
 * these carry nothing privileged and every window that draws a sidebar needs them.
 */
export interface SidebarPreferences {
  groupBy: SidebarGroupBy
  sortMode: SidebarSortMode
  /** Ids of the sections the user has collapsed. Only collapsed sections are persisted. */
  collapsedGroups: string[]
}

export interface AppSettings {
  sidebarOpen: boolean
  sidebarWidth: number
  sidebarGroupBy: SidebarGroupBy
  sidebarSortMode: SidebarSortMode
  sidebarCollapsedGroups: string[]
  uiScale: number
  uiDensity: 'comfortable' | 'standard' | 'compact'
  /** Selected appearance theme id (e.g. 'paralith-dark', 'system'). See src/theme. */
  themeId: string
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
  | 'draft' | 'validating' | 'preparing' | 'understanding' | 'planning' | 'building'
  | 'verifying' | 'decision_required' | 'pausing' | 'paused' | 'resuming' | 'recovering'
  | 'reviewing' | 'ready_for_review' | 'completed' | 'failed' | 'stopping' | 'cancelled' | 'archived'

export type SwarmPhase = 'understanding' | 'planning' | 'building' | 'verifying' | 'ready'

export type SwarmRole = 'coordinator' | 'scout' | 'builder' | 'debugger' | 'reviewer' | 'integrator'

export type SwarmRuntimeKind = 'auto' | 'claude' | 'codex'
export type SwarmModelValidationStatus = 'valid' | 'unvalidated' | 'provider_unavailable' | 'authentication_required' | 'model_unavailable' | 'unsupported_option' | 'deprecated_model' | 'configuration_error'
export interface SwarmFallbackModelConfig { providerId: string; modelId: string; policy: 'when_unavailable' | 'when_provider_cannot_start' | 'require_approval' }
export interface SwarmMemberModelConfig { providerId: string; providerDisplayName: string; modelId: string; modelDisplayName: string; reasoningEffort: 'low' | 'medium' | 'high' | 'max'; executionMode: 'interactive' | 'autonomous' | 'review'; contextStrategy: 'minimal' | 'balanced' | 'full'; permissionMode: 'ask' | 'trusted' | 'restricted'; fallback?: SwarmFallbackModelConfig | null; providerOptions: Record<string, unknown>; configVersion: number; lastValidationStatus: SwarmModelValidationStatus; lastValidatedAt?: string | null }
export interface SwarmExecutionDefaults { member?: SwarmMemberModelConfig | null }
export interface SwarmModelCapability { providerId: string; providerDisplayName: string; modelId: string; displayName: string; description: string; available: boolean; deprecated: boolean; replacementModelId?: string | null; coding: boolean; planning: boolean; review: boolean; toolUse: boolean; vision: boolean; supportedReasoningEfforts: string[]; supportedExecutionModes: string[]; recommendedRoles: string[]; authenticated: boolean; runtimeVersion?: string | null }

export type SwarmAgentStatus =
  | 'starting' | 'active' | 'idle' | 'queued' | 'waiting' | 'blocked' | 'reviewing'
  | 'paused' | 'failed' | 'recovering' | 'completed'

export type SwarmTaskStatus =
  | 'proposed' | 'ready' | 'queued' | 'claimed' | 'running' | 'blocked' | 'waiting'
  | 'verifying' | 'reviewing' | 'failed' | 'cancelled' | 'completed'

export interface SwarmRoleAllocation {
  /** Stable allocation identity, preserved across edits and preset duplication. */
  id: string
  runtime: SwarmRuntimeKind
  count: number
  modelConfig?: SwarmMemberModelConfig | null
}

export interface SwarmRoleConfig {
  role: SwarmRole
  enabled: boolean
  /** Ordered agent-runtime allocations forming this role's schedulable pool. */
  allocations: SwarmRoleAllocation[]
}

export interface SwarmAgent {
  id: string
  swarmId: string
  role: SwarmRole
  runtime: SwarmRuntimeKind
  modelConfig: SwarmMemberModelConfig
  /** The configured allocation this worker was staffed from, when applicable. */
  allocationId?: string | null
  displayName: string
  status: SwarmAgentStatus
  currentTaskId?: string | null
  terminalSessionId?: string | null
  lastResult?: string | null
  runtimeSessionState: string
  workingDirectory?: string | null
  worktree?: string | null
  permissions: string[]
  changedFiles: string[]
  testProgress: SwarmTestProgress
  lastMessage?: string | null
  currentBlocker?: string | null
  recoveryState: string
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
  progressDeterminate: boolean
  files: string[]
  dependsOn: string[]
  attempts: number
  result?: string | null
  requiredRuntime?: SwarmRuntimeKind | null
  blocker?: string | null
  evidenceIds: string[]
  testIds: string[]
  leaseUntil?: string | null
  verificationRequired: boolean
  repairForTaskId?: string | null
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
  destinationAgentId?: string | null
  destinationRole?: SwarmRole | null
  evidenceId?: string | null
  summary: string
  level: string
  metadata: Record<string, unknown>
  sequence: number
  createdAt: string
}

export interface SwarmRun {
  id: string; swarmId: string; projectId: string; objective: string; status: string
  phase: SwarmPhase; progress: number; maxParallel: number; failurePolicy: string
  cancellationRequestedAt?: string | null; failure?: Record<string, unknown> | null
  resultSummary?: SwarmSummary | null; createdAt: string; startedAt?: string | null
  finishedAt?: string | null; updatedAt: string
}
export interface SwarmAgentRun {
  id: string; swarmRunId: string; swarmId: string; memberId: string; taskId?: string | null
  terminalSessionId?: string | null; processId?: number | null; status: string; attempt: number
  requestedProviderId: string; requestedModelId: string; resolvedProviderId: string; resolvedModelId: string; reasoningEffort: string; fallbackUsed: boolean; fallbackReason?: string | null; providerRuntimeVersion?: string | null; executionConfigSnapshot: SwarmMemberModelConfig
  exitCode?: number | null; failureReason?: string | null; cancellationReason?: string | null
  structuredResult?: Record<string, unknown> | null; filesChanged: string[]; evidenceIds: string[]
  createdAt: string; startedAt?: string | null; finishedAt?: string | null; updatedAt: string
}
export interface SwarmAttentionRequest {
  id: string; swarmId: string; swarmRunId: string; agentRunId: string; memberId: string
  taskId?: string | null; requestKind: string; summary: string; safePayload: Record<string, unknown>
  status: string; response?: string | null; createdAt: string; expiresAt: string; resolvedAt?: string | null
}

export interface SwarmDecision {
  id: string
  problem: string
  reason: string
  recommended: string
  recommendationReasons: string[]
  alternative: string
  raisedAt: string
  status: string
  choice?: string | null
}

export interface SwarmTestProgress { running: number; passed: number; failed: number; skipped: number; pending: number }
export interface SwarmSafeguard { code: string; label: string; reason: string }
export interface SwarmMessage {
  id: string; swarmId: string; category: string; senderKind: string; sourceAgentId?: string | null
  target: string; body: string; taskId?: string | null; links: string[]; deliveryState: string; createdAt: string
}
export interface SwarmCommandDraft { swarmId: string; target: string; body: string; updatedAt: string }
export interface SwarmConnectionEvent {
  id: string; swarmId: string; sourceAgentId: string; destinationAgentId?: string | null
  destinationRole?: SwarmRole | null; eventType: string; taskId?: string | null; summary: string
  evidenceId?: string | null; createdAt: string
}
export interface SwarmLifecycleTransition {
  id: string; swarmId: string; fromState?: SwarmLifecycle | null; toState: SwarmLifecycle; reason: string; createdAt: string
}
export interface SwarmRuntimeSession {
  id: string; swarmId: string; projectId: string; agentId: string; taskId?: string | null
  runtime: SwarmRuntimeKind; providerSessionId?: string | null; terminalSessionId?: string | null
  state: string; resumable: boolean; workingDirectory: string; usage: Record<string, unknown>
  failureClass?: string | null; startedAt: string; updatedAt: string; endedAt?: string | null
}
export interface SwarmEvidence {
  id: string; swarmId: string; taskId?: string | null; agentId?: string | null; criterion: string
  evidenceType: string; title: string; summary: string; sourceUri?: string | null; payload: Record<string, unknown>; verified: boolean; createdAt: string
}
export interface SwarmTestRecord {
  id: string; swarmId: string; taskId?: string | null; agentId?: string | null; name: string
  command?: string | null; status: string; summary: string; logUri?: string | null
  startedAt?: string | null; completedAt?: string | null
}
export interface SwarmMemoryContext {
  id: string; swarmId: string; taskId: string; agentId: string; memoryItemId: string; revisionId: string
  title: string; memoryType: string; state: string; summary: string; context: string; confidence: number
  sourceUris: string[]; loadedAt: string
}
export interface SwarmReviewRecord {
  id: string; swarmId: string; taskId?: string | null; reviewerAgentId: string; subjectAgentId?: string | null
  verdict: string; riskLevel: string; notes: string; evidenceIds: string[]; createdAt: string
}
export interface SwarmRuntimeReadiness {
  runtime: SwarmRuntimeKind; installed: boolean; authenticated: boolean; available: boolean
  version?: string | null; message: string
}
export interface SwarmLaunchPreview {
  name: string; projectId: string; projectRoot: string; roles: SwarmRoleConfig[]; totalAgents: number
  maxParallel: number; safeguards: SwarmSafeguard[]; attachments: string[]
  runtimeReadiness: SwarmRuntimeReadiness[]; warnings: string[]; canLaunch: boolean
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
  repositoryIdentity?: string | null
  gitState: Record<string, unknown>
  safeguards: SwarmSafeguard[]
  attachments: string[]
  currentMilestone?: string | null
  revision: number
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
  messages: SwarmMessage[]
  connections: SwarmConnectionEvent[]
  lifecycleHistory: SwarmLifecycleTransition[]
  runtimeSessions: SwarmRuntimeSession[]
  evidence: SwarmEvidence[]
  tests: SwarmTestRecord[]
  memories: SwarmMemoryContext[]
  reviews: SwarmReviewRecord[]
  runs: SwarmRun[]
  agentRuns: SwarmAgentRun[]
  attentionRequests: SwarmAttentionRequest[]
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
  attachments?: string[]
}

export type ProjectCloseSwarmBehavior = 'keep_running' | 'pause_and_close'

export interface SwarmChangedEvent {
  projectId: string
  swarmId: string
  revision: number
  eventSequence: number
  updatedAt: string
}

export interface SavePresetRequest {
  id?: string
  name: string
  maxParallel: number
  instructions: string
  isDefault?: boolean
  roles: SwarmRoleConfig[]
}

// ---- Code surface / filesystem -----------------------------------------------------------
export type FileKind = 'file' | 'directory' | 'symlink'
export type FileEncoding = 'utf8' | 'utf8_bom' | 'binary'
export type LineEnding = 'lf' | 'crlf' | 'mixed' | 'none'
export type FileChangeKind = 'created' | 'modified' | 'deleted'

export interface DirectoryEntry {
  name: string
  relativePath: string
  kind: FileKind
  size: number
  modifiedMs: number | null
  isSymlink: boolean
  symlinkBroken: boolean
  isHidden: boolean
  readonly: boolean
}

export interface DirectoryListing {
  projectId: string
  relativePath: string
  entries: DirectoryEntry[]
  truncated: boolean
  totalEntries: number
}

export interface FileContents {
  projectId: string
  relativePath: string
  content: string | null
  sha256: string
  size: number
  encoding: FileEncoding
  lineEnding: LineEnding
  binary: boolean
  readonly: boolean
}

export interface FileWriteResult {
  projectId: string
  relativePath: string
  sha256: string
  size: number
  modifiedMs: number | null
}

export interface FsEntryInfo {
  projectId: string
  relativePath: string
  name: string
  kind: FileKind
  size: number
  modifiedMs: number | null
}

export interface FsPath {
  projectId: string
  relativePath: string
}

export interface ProjectFileIndex {
  projectId: string
  files: string[]
  truncated: boolean
}

export interface ProjectFileChange {
  relativePath: string
  kind: FileChangeKind
}

export interface ProjectFileChangeBatch {
  projectId: string
  changes: ProjectFileChange[]
}

/** Geometry (CSS/logical pixels, relative to the window content area) for the embedded browser view. */
export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export type ProductMode = 'code' | 'agent'
export type AgentWorkState = 'idle' | 'working' | 'waiting' | 'needs_approval' | 'blocked' | 'failed' | 'complete'

export interface OrganizationalAgent {
  id: string; name: string; role: string; brief: string; responsibilities: string[]
  avatarSeed: string; intelligencePreference: string; workState: AgentWorkState
  workStateDetail?: string; pinned: boolean; position: number; createdAt: string; updatedAt: string
}
export interface AgentConversation {
  id: string; agentId: string; title: string; position: number
  /** Conversation-level runtime. Undefined inherits the Agent's preference. */
  runtimePreference?: string
  createdAt: string; updatedAt: string
}
/** Lifecycle of one turn. Only agent turns leave `complete`. */
export type AgentTurnState = 'preparing' | 'streaming' | 'complete' | 'failed' | 'cancelled' | 'blocked'
export interface AgentConversationEntry {
  id: string; conversationId: string
  kind: 'user' | 'agent' | 'event' | 'delegation' | 'approval' | 'evidence'
  authorAgentId?: string; body: string; metadata: Record<string, unknown>
  state: AgentTurnState
  /** Which runtime produced this turn. Provenance, never identity. */
  runtimeProvider?: string; runtimeModel?: string; runtimeAccount?: string
  parentEntryId?: string; errorCode?: string
  createdAt: string; updatedAt: string
}
/** One selectable intelligence, derived from what is installed and signed in on this machine. */
export interface AgentRuntimeOption {
  id: string; providerId: string; providerName: string; modelId: string
  displayName: string; description: string
  installed: boolean; authenticated: boolean; available: boolean
  unavailableReason?: string; version?: string
}
export interface SendAgentMessageInput {
  conversationId: string; body: string
  /** Applies to this turn only; never mutates the conversation or Agent default. */
  runtimeId?: string
  projectId?: string
}
export interface AgentDelegation {
  id: string; ownerAgentId: string; recipientAgentId: string; objective: string; relevantContext: string
  constraints: string; expectedResult: string; authorityBoundary: string; parentDelegationId?: string
  projectId?: string; workspaceId?: string; runId?: string; status: string; statusReason?: string
  createdAt: string; updatedAt: string
}
/** Canonical lifecycle of one unit of Agent Work. Persisted as a Run status; the rail, the work
 * list, notifications and restart recovery all read this same vocabulary. */
export type AgentWorkStatus =
  | 'queued' | 'preparing' | 'working' | 'waiting_user' | 'needs_approval'
  | 'blocked' | 'provider_limit' | 'verifying' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
/** What a unit of work is permitted to do. Derived from the Agent's standing grant, narrowed by
 * the delegation's constraints — never widened. */
export interface AgentWorkAuthority { read: boolean; write: boolean; runCommands: boolean; commit: boolean; push: boolean }
/** Real execution. A delegation is the handoff; this is the work being done. */
export interface AgentWork {
  id: string; agentId: string; delegationId?: string; parentWorkId?: string
  objective: string; constraints: string; expectedResult: string
  projectId: string; workspaceId?: string
  status: AgentWorkStatus; statusReason?: string
  /** Which runtime actually took the work, and how it was chosen. Provenance, never identity. */
  providerId?: string; modelId?: string; runtimeSource?: string
  terminalSessionId?: string; workingDirectory?: string
  /** The workspace and pane the provider session runs in — what "Open in Code" focuses. */
  executionWorkspaceId?: string; executionPaneId?: string
  authority: AgentWorkAuthority
  originConversationId?: string
  resultSummary?: string; errorCode?: string; errorMessage?: string
  createdAt: string; startedAt?: string; completedAt?: string; updatedAt: string
}
/** One inspectable step. The evidence behind a claim, not a transcript. */
export interface AgentWorkEvent {
  id: string; workId: string; sequence: number; kind: string; summary: string
  level: string; metadata: Record<string, unknown>; createdAt: string
}
export interface StartAgentWorkInput {
  agentId: string; delegationId?: string; parentWorkId?: string
  objective: string; constraints?: string; expectedResult?: string
  projectId: string; workspaceId?: string; originConversationId?: string; runtimeId?: string
}
export interface AgentWorkspaceAuthority { agentId: string; projectId: string; workspaceId?: string; access: 'read' | 'read_write'; grantedAt: string }
export interface AgentProductState { selectedMode: ProductMode; selectedAgentId?: string; selectedConversationId?: string }
export interface AgentOrganizationSnapshot {
  agents: OrganizationalAgent[]; conversations: AgentConversation[]; entries: AgentConversationEntry[]
  delegations: AgentDelegation[]; work: AgentWork[]; authorities: AgentWorkspaceAuthority[]
  productState: AgentProductState
}
export interface CreateOrganizationalAgentInput {
  name: string; role: string; brief: string; responsibilities: string[]; intelligencePreference: string
  projectId?: string; workspaceId?: string; projectAccess?: 'none' | 'read' | 'read_write'
}
export interface CreateAgentDelegationInput {
  ownerAgentId: string; recipientAgentId: string; objective: string; relevantContext: string
  constraints: string; expectedResult: string; authorityBoundary: string; parentDelegationId?: string
  projectId?: string; workspaceId?: string
  /** Start real work as soon as the delegation is recorded. Without it the delegation is only an
   * organizational handoff. */
  execute?: boolean
  /** Runtime for the resulting work. Inherits the recipient's preference when absent. */
  runtimeId?: string
  /** Conversation to report the structured result back into. */
  originConversationId?: string
}

/** Lifecycle + security events emitted by an embedded browser view. `payload` on `inspect-selected`
 * is an opaque base64url string that the frontend decodes and re-sanitizes before use. */
export type BrowserEvent =
  | { kind: 'load-started'; workspaceId: string; url: string }
  | { kind: 'load-finished'; workspaceId: string; url: string }
  | { kind: 'title-changed'; workspaceId: string; title: string }
  | { kind: 'nav-blocked'; workspaceId: string; url: string; scheme: string }
  | { kind: 'inspect-selected'; workspaceId: string; payload: string }
