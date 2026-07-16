import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDetectionResult,
  AppSettings,
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
} from './types'

export const native = {
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
  writeTerminalInput: (sessionId: string, data: number[]) => invoke<void>('write_terminal_input', { sessionId, data }),
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => invoke<void>('resize_terminal_session', { sessionId, cols, rows }),
  terminateTerminalSession: (sessionId: string) => invoke<void>('terminate_terminal_session', { sessionId }),
  terminateWorkspaceSessions: (workspaceId: string) => invoke<void>('terminate_workspace_sessions', { workspaceId }),
  listLiveSessions: (workspaceId?: string) => invoke<TerminalSession[]>('list_live_sessions', { workspaceId }),
  terminalSessionStatus: (sessionId: string) => invoke<TerminalSession>('terminal_session_status', { sessionId }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>('save_settings', { settings }),
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
  closeProjectSession: (projectId: string) => invoke<OpenProjectSession[]>('close_project_session', { projectId }),
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
}

export function asNativeError(error: unknown): { code: string; message: string; affectedEntity?: string; recommendedAction?: string } {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = error as { code?: string; message: string; affectedEntity?: string; recommendedAction?: string }
    return { code: value.code ?? 'unknown_error', message: value.message, affectedEntity: value.affectedEntity, recommendedAction: value.recommendedAction }
  }
  return { code: 'unknown_error', message: typeof error === 'string' ? error : 'An unexpected native error occurred.' }
}
