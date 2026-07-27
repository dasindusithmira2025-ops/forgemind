import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDetectionResult,
  AppSettings,
  BrowserBounds,
  DiagnosticsSnapshot,
  SafeRestartAssessment,
  SafeRestartClientState,
  StartupStatus,
  UpdateStatus,
  HealthReport,
  LayoutNode,
  Project,
  ProjectOverview,
  RecentWorkspace,
  ShellProfile,
  SplitDirection,
  TerminalSession,
  RestorationResult,
  RepairSummary,
  StartTerminalRequest,
  AgentProfile,
  AgentSession,
  IsolatedWorktreeResult,
  PaneGitReview,
  Workspace,
  WorkspaceSaveRequest,
  OpenProjectSession,
  WorkspacePlacement,
  MonitorInfo,
  MonitorRecoveryReport,
  HandoffTicket,
  ApprovalDecisionRequest,
  MergeReadiness,
  MergeReadinessRequest,
  ProviderAccountStatus,
  PullRequestDetailRequest,
  RepositoryApprovalOutcome,
  RepositoryBranchSummary,
  RepositoryApprovalRequest,
  RepositoryDiff,
  RepositoryDiffRequest,
  RepositoryOperationRecord,
  RepositoryOperationRequest,
  RepositoryPolicyConfiguration,
  RemoteProjection,
  RemoteProjectionObject,
  RemoteProjectionRequest,
  RepositoryIntelligence,
  RepositoryIntelligenceRequest,
  WorkflowRunDetailRequest,
  RepositorySnapshot,
  RepositoryWorktreeLease,
  WorktreeConflictRisk,
  Swarm,
  SwarmListItem,
  SwarmDetail,
  SwarmPreset,
  CreateSwarmRequest,
  ProjectCloseSwarmBehavior,
  SavePresetRequest,
  SwarmRuntimeReadiness,
  SwarmModelCapability,
  SwarmExecutionDefaults,
  SwarmMemberModelConfig,
  SwarmLaunchPreview,
  SwarmCommandDraft,
  DirectoryListing,
  FileContents,
  FileWriteResult,
  FsEntryInfo,
  FsPath,
  ProjectFileIndex,
  ProviderUsageSnapshot,
  AiUsageDiagnostics,
} from './types'

export const native = {
  getAiUsageSnapshots: () => invoke<ProviderUsageSnapshot[]>('get_ai_usage_snapshots'),
  refreshAiUsage: () => invoke<ProviderUsageSnapshot[]>('refresh_ai_usage'),
  getAiUsageDiagnostics: () => invoke<AiUsageDiagnostics[]>('get_ai_usage_diagnostics'),
  openProject: (path: string) => invoke<Project>('open_project', { path }),
  getProject: (projectId: string) => invoke<Project>('get_project', { projectId }),
  listRecentProjects: () => invoke<Project[]>('list_recent_projects'),
  listProjectsOverview: () => invoke<ProjectOverview[]>('list_projects_overview'),
  removeRecentProject: (projectId: string) => invoke<void>('remove_project_from_recent', { projectId }),
  relocateProject: (projectId: string, path: string) => invoke<Project>('relocate_project', { projectId, path }),
  validateWorkingDirectory: (projectRoot: string, workingDirectory: string, allowExternal = false) =>
    invoke<string>('validate_working_directory', { projectRoot, workingDirectory, allowExternal }),
  detectAgents: (force = false, customPaths: Array<{ provider: string; path: string }> = []) =>
    invoke<AgentDetectionResult[]>('detect_agents', { force, customPaths }),
  detectShells: () => invoke<ShellProfile[]>('detect_shells'),
  saveCustomShell: (name: string, path: string, args: string[] = []) => invoke<ShellProfile>('save_custom_shell', { name, path, args }),
  validateCustomExecutable: (path: string) => invoke<string>('validate_custom_executable', { path }),
  getLayoutPreset: (count: number, variant = '') => invoke<LayoutNode>('get_layout_preset', { count, variant }),
  splitLayoutPane: (layout: LayoutNode, paneId: string, direction: SplitDirection, newPaneId: string) =>
    invoke<LayoutNode>('split_layout_pane', { layout, paneId, direction, newPaneId }),
  removeLayoutPane: (layout: LayoutNode, paneId: string) => invoke<LayoutNode>('remove_layout_pane', { layout, paneId }),
  saveWorkspace: (request: WorkspaceSaveRequest) => invoke<Workspace>('save_workspace', { request }),
  getWorkspace: (workspaceId: string) => invoke<Workspace>('get_workspace', { workspaceId }),
  listWorkspacesForProject: (projectId: string) => invoke<Workspace[]>('list_workspaces_for_project', { projectId }),
  suggestWorkspaceName: (projectId: string) => invoke<string>('suggest_workspace_name', { projectId }),
  listRecentWorkspaces: () => invoke<RecentWorkspace[]>('list_recent_workspaces'),
  removeRecentWorkspace: (workspaceId: string) => invoke<void>('remove_recent_workspace', { workspaceId }),
  deleteWorkspaceConfiguration: (workspaceId: string) => invoke<void>('delete_workspace_configuration', { workspaceId }),
  renameWorkspace: (workspaceId: string, name: string) => invoke<Workspace>('rename_workspace', { workspaceId, name }),
  reorderWorkspaces: (projectId: string, orderedIds: string[]) => invoke<void>('reorder_workspaces', { projectId, orderedIds }),
  duplicateWorkspace: (workspaceId: string) => invoke<Workspace>('duplicate_workspace', { workspaceId }),
  setLastActiveWorkspace: (workspaceId: string) => invoke<void>('set_last_active_workspace', { workspaceId }),
  createTerminalSession: (request: StartTerminalRequest) => invoke<TerminalSession>('create_terminal_session', { request }),
  restoreWorkspaceSessions: (workspaceId: string, budget?: number, behavior?: AppSettings['restoreBehavior']) => invoke<RestorationResult>('restore_workspace_sessions', { workspaceId, budget, behavior }),
  resetRestorationCircuit: (workspaceId: string, paneId: string) => invoke<void>('reset_restoration_circuit', { workspaceId, paneId }),
  getPaneGitReview: (workspaceId: string, paneId: string) => invoke<PaneGitReview>('get_pane_git_review', { workspaceId, paneId }),
  stagePaneFile: (workspaceId: string, paneId: string, path: string) => invoke<PaneGitReview>('stage_pane_file', { workspaceId, paneId, path }),
  restorePaneFile: (workspaceId: string, paneId: string, path: string, confirmed: boolean) => invoke<PaneGitReview>('restore_pane_file', { workspaceId, paneId, path, confirmed }),
  createIsolatedPaneWorktree: (workspaceId: string, paneId: string) =>
    invoke<IsolatedWorktreeResult>('create_isolated_pane_worktree', { workspaceId, paneId }),
  inspectRepository: (projectId: string, repositoryPath?: string, worktreePath?: string) =>
    invoke<RepositorySnapshot>('inspect_repository', { projectId, repositoryPath, worktreePath }),
  listRepositoryBranches: (projectId: string, repositoryPath?: string) =>
    invoke<RepositoryBranchSummary[]>('list_repository_branches', { projectId, repositoryPath }),
  getRepositoryDiff: (request: RepositoryDiffRequest) => invoke<RepositoryDiff>('get_repository_diff', { request }),
  executeRepositoryOperation: (request: RepositoryOperationRequest) =>
    invoke<RepositoryOperationRecord>('execute_repository_operation', { request }),
  cancelRepositoryOperation: (projectId: string, operationId: string) =>
    invoke<boolean>('cancel_repository_operation', { projectId, operationId }),
  getRepositoryOperation: (projectId: string, operationId: string) =>
    invoke<RepositoryOperationRecord>('get_repository_operation', { projectId, operationId }),
  getRepositoryPolicy: (projectId: string) => invoke<RepositoryPolicyConfiguration>('get_repository_policy', { projectId }),
  saveRepositoryPolicy: (configuration: RepositoryPolicyConfiguration, humanId: string) =>
    invoke<RepositoryPolicyConfiguration>('save_repository_policy', { configuration, humanId }),
  listRepositoryApprovals: (projectId: string, pendingOnly = true) =>
    invoke<RepositoryApprovalRequest[]>('list_repository_approvals', { projectId, pendingOnly }),
  decideRepositoryApproval: (request: ApprovalDecisionRequest) =>
    invoke<RepositoryApprovalOutcome>('decide_repository_approval', { request }),
  listRepositoryWorktreeLeases: (projectId: string) =>
    invoke<RepositoryWorktreeLease[]>('list_repository_worktree_leases', { projectId }),
  getWorktreeConflictRisks: (projectId: string) =>
    invoke<WorktreeConflictRisk[]>('get_worktree_conflict_risks', { projectId }),
  getGitHubProviderStatus: (projectId: string, host = 'github.com') =>
    invoke<ProviderAccountStatus>('get_github_provider_status', { projectId, host }),
  refreshRepositoryRemoteProjection: (request: RemoteProjectionRequest) =>
    invoke<RemoteProjection>('refresh_repository_remote_projection', { request }),
  refreshRepositoryIntelligence: (request: RepositoryIntelligenceRequest) =>
    invoke<RepositoryIntelligence>('refresh_repository_intelligence', { request }),
  getRepositoryIntelligence: (projectId: string, repositoryPath?: string) =>
    invoke<RepositoryIntelligence | null>('get_repository_intelligence', { projectId, repositoryPath }),
  getRepositoryWorkflowRunDetail: (request: WorkflowRunDetailRequest) =>
    invoke<RemoteProjectionObject>('get_repository_workflow_run_detail', { request }),
  getRepositoryPullRequestDetail: (request: PullRequestDetailRequest) =>
    invoke<RemoteProjectionObject>('get_repository_pull_request_detail', { request }),
  evaluateMergeReadiness: (request: MergeReadinessRequest) =>
    invoke<MergeReadiness>('evaluate_merge_readiness', { request }),
  writeTerminalInput: (sessionId: string, data: number[]) => invoke<void>('write_terminal_input', { sessionId, data }),
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => invoke<void>('resize_terminal_session', { sessionId, cols, rows }),
  terminateTerminalSession: (sessionId: string) => invoke<void>('terminate_terminal_session', { sessionId }),
  terminateWorkspaceSessions: (workspaceId: string) => invoke<void>('terminate_workspace_sessions', { workspaceId }),
  listLiveSessions: (workspaceId?: string) => invoke<TerminalSession[]>('list_live_sessions', { workspaceId }),
  terminalSessionStatus: (sessionId: string) => invoke<TerminalSession>('terminal_session_status', { sessionId }),
  /** Save clipboard/dropped image bytes to a temp file and return its absolute path (to type into a terminal). */
  saveDroppedImage: (data: number[], extension?: string) => invoke<string>('save_dropped_image', { data, extension }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>('save_settings', { settings }),
  /** Read the persisted theme id. Callable from any window (main + detached). */
  getThemePreference: () => invoke<string>('get_theme_preference'),
  /** Persist the selected theme id and broadcast a `theme-changed` event to every window. Main window only. */
  setThemePreference: (themeId: string) => invoke<void>('set_theme_preference', { themeId }),
  /**
   * Paint the OS-drawn window frame (caption fill, caption text, border) from the active theme.
   * CSS cannot reach the frame, so without this the caption keeps the system accent colour.
   * Applies to every window, so detached workspaces follow a theme change too.
   */
  applyWindowChrome: (chrome: { caption: string; text: string; border: string }) =>
    invoke<void>('apply_window_chrome', { chrome }),
  listAgentProfiles: () => invoke<AgentProfile[]>('list_agent_profiles'),
  listAgentSessions: (workspaceId: string) => invoke<AgentSession[]>('list_agent_sessions', { workspaceId }),
  getDiagnostics: () => invoke<DiagnosticsSnapshot>('get_diagnostics'),
  runHealthCheck: () => invoke<HealthReport>('run_health_check'),
  exportRedactedSupportBundle: () => invoke<string>('export_redacted_support_bundle'),
  getUpdateStatus: () => invoke<UpdateStatus>('get_update_status'),
  getStartupStatus: () => invoke<StartupStatus>('get_startup_status'),
  checkForUpdates: () => invoke<UpdateStatus>('check_for_updates'),
  downloadUpdate: () => invoke<UpdateStatus>('download_update'),
  assessSafeRestart: (client: SafeRestartClientState) => invoke<SafeRestartAssessment>('assess_safe_restart', { client }),
  installDownloadedUpdate: (client: SafeRestartClientState, confirmed = false) => invoke<void>('install_downloaded_update', { client, confirmed }),
  installUpdateOnExit: (client: SafeRestartClientState, confirmed = false) => invoke<UpdateStatus>('install_update_on_exit', { client, confirmed }),
  retryUpdate: () => invoke<UpdateStatus>('retry_update'),
  confirmHealthyStartup: () => invoke<UpdateStatus>('confirm_healthy_startup'),
  stageDatabaseBackupRestore: (backupPath: string) => invoke<void>('stage_database_backup_restore', { backupPath }),
  startInSafeMode: () => invoke<void>('start_in_safe_mode'),
  restartAfterRecovery: () => invoke<void>('restart_after_recovery'),
  repairDatabaseMetadata: () => invoke<RepairSummary>('repair_database_metadata'),

  // ---- Multi-Project + multi-monitor Workspace package ----------------------------------
  listOpenProjects: () => invoke<OpenProjectSession[]>('list_open_projects'),
  openProjectSession: (projectId: string, makeActive = true) =>
    invoke<OpenProjectSession[]>('open_project_session', { projectId, makeActive }),
  setActiveProject: (projectId: string) => invoke<OpenProjectSession[]>('set_active_project', { projectId }),
  closeProjectSession: (projectId: string, swarmBehavior?: ProjectCloseSwarmBehavior) =>
    invoke<OpenProjectSession[]>('close_project_session', { projectId, swarmBehavior }),
  setProjectLastActive: (projectId: string, workspaceId?: string, paneId?: string) =>
    invoke<void>('set_project_last_active', { projectId, workspaceId, paneId }),
  setProjectExpanded: (projectId: string, expanded: boolean) =>
    invoke<void>('set_project_expanded', { projectId, expanded }),
  listWorkspacePlacements: (projectId: string) =>
    invoke<WorkspacePlacement[]>('list_workspace_placements', { projectId }),
  getWorkspacePlacement: (workspaceId: string) =>
    invoke<WorkspacePlacement>('get_workspace_placement', { workspaceId }),
  claimWorkspaceLease: (workspaceId: string) => invoke<string>('claim_workspace_lease', { workspaceId }),
  detachWorkspace: (workspaceId: string) => invoke<HandoffTicket>('detach_workspace', { workspaceId }),
  attachWorkspace: (workspaceId: string) => invoke<WorkspacePlacement>('attach_workspace', { workspaceId }),
  completeWorkspaceHandoff: (workspaceId: string) => invoke<WorkspacePlacement>('complete_workspace_handoff', { workspaceId }),
  failWorkspaceHandoff: (workspaceId: string) => invoke<void>('fail_workspace_handoff', { workspaceId }),
  focusWorkspaceWindow: (workspaceId: string) => invoke<void>('focus_workspace_window', { workspaceId }),
  closeWorkspaceWindow: (workspaceId: string) => invoke<void>('close_workspace_window', { workspaceId }),
  moveWorkspaceToMonitor: (workspaceId: string, monitorId: string) =>
    invoke<WorkspacePlacement>('move_workspace_to_monitor', { workspaceId, monitorId }),
  persistWorkspaceWindowGeometry: (workspaceId:string)=>invoke<WorkspacePlacement>('persist_workspace_window_geometry',{workspaceId}),
  recoverWorkspaceWindows: () => invoke<MonitorRecoveryReport>('recover_workspace_windows'),
  listMonitors: () => invoke<MonitorInfo[]>('list_monitors'),
  setMonitorAlias: (monitorKey: string, alias: string) => invoke<void>('set_monitor_alias', { monitorKey, alias }),

  // ---- Paralith Swarms --------------------------------------------------------------------
  listSwarmPresets: () => invoke<SwarmPreset[]>('list_swarm_presets'),
  listSwarmRuntimeReadiness: () => invoke<SwarmRuntimeReadiness[]>('list_swarm_runtime_readiness'),
  listSwarmModelRegistry: () => invoke<SwarmModelCapability[]>('list_swarm_model_registry'),
  getSwarmExecutionDefaults: (projectId: string, swarmId: string) => invoke<SwarmExecutionDefaults>('get_swarm_execution_defaults', { projectId, swarmId }),
  saveSwarmExecutionDefaults: (projectId: string, swarmId: string, defaults: SwarmExecutionDefaults) => invoke<void>('save_swarm_execution_defaults', { projectId, swarmId, defaults }),
  applySwarmExecutionDefaults: (projectId: string, swarmId: string, memberIds: string[]) => invoke<number>('apply_swarm_execution_defaults', { projectId, swarmId, memberIds }),
  validateSwarmMemberModelConfig: (projectId: string, swarmId: string, memberId: string) => invoke<SwarmMemberModelConfig>('validate_swarm_member_model_config', { projectId, swarmId, memberId }),
  updateSwarmMemberModelConfig: (projectId: string, swarmId: string, memberId: string, config: SwarmMemberModelConfig) => invoke<SwarmMemberModelConfig>('update_swarm_member_model_config', { projectId, swarmId, memberId, config }),
  previewSwarmLaunch: (request: CreateSwarmRequest) => invoke<SwarmLaunchPreview>('preview_swarm_launch', { request }),
  saveSwarmPreset: (request: SavePresetRequest) => invoke<SwarmPreset>('save_swarm_preset', { request }),
  deleteSwarmPreset: (presetId: string) => invoke<void>('delete_swarm_preset', { presetId }),
  createSwarm: (request: CreateSwarmRequest) => invoke<Swarm>('create_swarm', { request }),
  listSwarms: (projectId: string, includeArchived = false) =>
    invoke<SwarmListItem[]>('list_swarms', { projectId, includeArchived }),
  getSwarmDetail: (projectId: string, swarmId: string) => invoke<SwarmDetail>('get_swarm_detail', { projectId, swarmId }),
  renameSwarm: (projectId: string, swarmId: string, name: string) => invoke<Swarm>('rename_swarm', { projectId, swarmId, name }),
  startSwarm: (projectId: string, swarmId: string) => invoke<void>('start_swarm', { projectId, swarmId }),
  pauseSwarm: (projectId: string, swarmId: string) => invoke<void>('pause_swarm', { projectId, swarmId }),
  resumeSwarm: (projectId: string, swarmId: string) => invoke<void>('resume_swarm', { projectId, swarmId }),
  stopSwarm: (projectId: string, swarmId: string, hard = false) => invoke<void>('stop_swarm', { projectId, swarmId, hard }),
  archiveSwarm: (projectId: string, swarmId: string, archived: boolean) => invoke<void>('archive_swarm', { projectId, swarmId, archived }),
  deleteSwarm: (projectId: string, swarmId: string) => invoke<void>('delete_swarm', { projectId, swarmId }),
  exportSwarmReport: (projectId: string, swarmId: string, destination: string) => invoke<void>('export_swarm_report', { projectId, swarmId, destination }),
  setSwarmPriority: (projectId: string, swarmId: string, priority: number) => invoke<void>('set_swarm_priority', { projectId, swarmId, priority }),
  focusSwarmAgentTerminal: (projectId: string, swarmId: string, agentId: string) => invoke<string>('focus_swarm_agent_terminal', { projectId, swarmId, agentId }),
  sendSwarmMessage: (projectId: string, swarmId: string, target: string, body: string) =>
    invoke<void>('send_swarm_message', { projectId, request: { swarmId, target, body } }),
  retrySwarmTest: (projectId: string, swarmId: string, testId: string) => invoke<void>('retry_swarm_test', { projectId, swarmId, testId }),
  generateSwarmFixTask: (projectId: string, swarmId: string, testId: string) => invoke<void>('generate_swarm_fix_task', { projectId, swarmId, testId }),
  getSwarmCommandDraft: (projectId: string, swarmId: string) => invoke<SwarmCommandDraft | null>('get_swarm_command_draft', { projectId, swarmId }),
  saveSwarmCommandDraft: (projectId: string, swarmId: string, target: string, body: string) => invoke<void>('save_swarm_command_draft', { projectId, swarmId, target, body }),
  acceptSwarmResult: (projectId: string, swarmId: string) => invoke<void>('accept_swarm_result', { projectId, swarmId }),
  resolveSwarmDecision: (projectId: string, swarmId: string, choice: 'recommended' | 'alternative' | 'stop') => invoke<void>('resolve_swarm_decision', { projectId, swarmId, choice }),
  resolveSwarmAttention: (projectId: string, swarmId: string, requestId: string, response: string, approved: boolean) => invoke<void>('resolve_swarm_attention', { projectId, swarmId, requestId, response, approved }),
  retrySwarm: (projectId: string, swarmId: string, memberId?: string) => invoke<void>('retry_swarm', { projectId, swarmId, memberId: memberId ?? null }),
  addSwarmBuilder: (projectId: string, swarmId: string) => invoke<void>('add_swarm_builder', { projectId, swarmId }),

  // ---- Code surface (project-scoped, path-guarded filesystem) -----------------------------
  listProjectDirectory: (projectId: string, relativePath = '') =>
    invoke<DirectoryListing>('list_project_directory', { projectId, relativePath }),
  readProjectFile: (projectId: string, relativePath: string) =>
    invoke<FileContents>('read_project_file', { projectId, relativePath }),
  writeProjectFile: (projectId: string, relativePath: string, content: string, expectedSha256?: string) =>
    invoke<FileWriteResult>('write_project_file', { projectId, relativePath, content, expectedSha256 }),
  createProjectFile: (projectId: string, relativePath: string) =>
    invoke<FsEntryInfo>('create_project_file', { projectId, relativePath }),
  createProjectDirectory: (projectId: string, relativePath: string) =>
    invoke<FsEntryInfo>('create_project_directory', { projectId, relativePath }),
  renameProjectEntry: (projectId: string, from: string, to: string) =>
    invoke<FsEntryInfo>('rename_project_entry', { projectId, from, to }),
  copyProjectEntry: (projectId: string, from: string, to: string) =>
    invoke<FsEntryInfo>('copy_project_entry', { projectId, from, to }),
  deleteProjectEntry: (projectId: string, relativePath: string, recursive = false) =>
    invoke<FsPath>('delete_project_entry', { projectId, relativePath, recursive }),
  searchProjectFiles: (projectId: string, limit?: number) =>
    invoke<ProjectFileIndex>('search_project_files', { projectId, limit }),
  watchProjectFiles: (projectId: string) => invoke<void>('watch_project_files', { projectId }),
  unwatchProjectFiles: (projectId: string) => invoke<void>('unwatch_project_files', { projectId }),

  // Embedded development browser (isolated native child webview beside the terminal canvas).
  openBrowserView: (workspaceId: string, bounds: BrowserBounds, url?: string) =>
    invoke<void>('open_browser_view', { workspaceId, bounds, url }),
  browserNavigate: (workspaceId: string, url: string) => invoke<void>('browser_navigate', { workspaceId, url }),
  browserReload: (workspaceId: string) => invoke<void>('browser_reload', { workspaceId }),
  browserStop: (workspaceId: string) => invoke<void>('browser_stop', { workspaceId }),
  browserSetBounds: (workspaceId: string, bounds: BrowserBounds) =>
    invoke<void>('browser_set_bounds', { workspaceId, bounds }),
  browserSetVisible: (workspaceId: string, visible: boolean) =>
    invoke<void>('browser_set_visible', { workspaceId, visible }),
  browserSetZoom: (workspaceId: string, factor: number) => invoke<void>('browser_set_zoom', { workspaceId, factor }),
  browserSetInspect: (workspaceId: string, enable: boolean) =>
    invoke<void>('browser_set_inspect', { workspaceId, enable }),
  closeBrowserView: (workspaceId: string) => invoke<void>('close_browser_view', { workspaceId }),
}

export function asNativeError(error: unknown): { code: string; message: string; affectedEntity?: string; recommendedAction?: string } {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = error as { code?: string; message: string; affectedEntity?: string; recommendedAction?: string }
    return { code: value.code ?? 'unknown_error', message: value.message, affectedEntity: value.affectedEntity, recommendedAction: value.recommendedAction }
  }
  return { code: 'unknown_error', message: typeof error === 'string' ? error : 'An unexpected native error occurred.' }
}
