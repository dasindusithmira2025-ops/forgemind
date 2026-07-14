import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDetectionResult,
  AppSettings,
  DiagnosticsSnapshot,
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
  Workspace,
  WorkspaceSaveRequest,
  OpenProjectSession,
  WorkspacePlacement,
  MonitorInfo,
  MonitorRecoveryReport,
  HandoffTicket,
} from './types'
import type {
  DispatchResult,
  EvidenceRecord,
  Mission,
  MissionBundle,
  MissionPlanSuggestion,
  MissionTask,
  ProjectContext,
  ProjectContextDiscovery,
  RecoveryState,
  ReviewSnapshot,
  SaveMissionRequest,
  SaveTaskRequest,
  VerificationProfile,
  VerificationResult,
  WorktreeRecord,
} from '../features/mission-control/missionTypes'
import type {
  CaptureOutcome,
  MemoryHealth,
  MemoryItem,
  MemoryRebuildResult,
  MemorySearchResponse,
  MemorySource,
} from '../features/memory/memoryTypes'

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
  attachWorkspace: (workspaceId: string) => invoke<HandoffTicket>('attach_workspace', { workspaceId }),
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

  // Mission Control is always Project-scoped. The backend independently verifies ownership.
  saveMission: (request: SaveMissionRequest) => invoke<MissionBundle>('save_mission', { request }),
  listMissions: (projectId: string) => invoke<Mission[]>('list_missions', { projectId }),
  getMissionBundle: (projectId: string, missionId: string) => invoke<MissionBundle>('get_mission_bundle', { projectId, missionId }),
  getProjectMissionDraft: (projectId: string) => invoke<MissionBundle | null>('get_project_mission_draft', { projectId }),
  deleteDraftMission: (projectId: string, missionId: string) => invoke<void>('delete_draft_mission', { projectId, missionId }),
  saveMissionTask: (projectId: string, request: SaveTaskRequest) => invoke<MissionTask>('save_mission_task', { projectId, request }),
  suggestMissionPlan: (projectId: string, missionId: string) => invoke<MissionPlanSuggestion[]>('suggest_mission_plan', { projectId, missionId }),
  dispatchMissionTask: (projectId: string, taskId: string, allowNonIsolated = false, baseRef?: string) =>
    invoke<DispatchResult>('dispatch_mission_task', { projectId, request: { taskId, allowNonIsolated, baseRef } }),
  refreshMissionTask: (projectId: string, taskId: string) => invoke<MissionTask>('refresh_mission_task', { projectId, taskId }),
  collectTaskEvidence: (projectId: string, taskId: string) => invoke<EvidenceRecord[]>('collect_task_evidence', { projectId, taskId }),
  getTaskReview: (projectId: string, taskId: string) => invoke<ReviewSnapshot>('get_task_review', { projectId, taskId }),
  acceptMissionTask: (projectId: string, taskId: string) => invoke<MissionTask>('accept_mission_task', { projectId, taskId }),
  retryMissionTask: (projectId: string, taskId: string) => invoke<MissionTask>('retry_mission_task', { projectId, taskId }),
  stopMissionTask: (projectId: string, taskId: string) => invoke<MissionTask>('stop_mission_task', { projectId, taskId }),
  mergeMissionTask: (projectId: string, taskId: string) => invoke<WorktreeRecord>('merge_mission_task', { projectId, taskId }),
  discardMissionTask: (projectId: string, taskId: string) => invoke<WorktreeRecord>('discard_mission_task', { projectId, taskId }),
  cleanupMergedTaskWorktree: (projectId: string, taskId: string) => invoke<WorktreeRecord>('cleanup_merged_task_worktree', { projectId, taskId }),
  rollbackMissionMerge: (projectId: string, taskId: string) => invoke<WorktreeRecord>('rollback_mission_merge', { projectId, taskId }),
  runTaskVerification: (projectId: string, taskId: string, checkId?: string) => invoke<VerificationResult[]>('run_task_verification', { projectId, taskId, checkId }),
  cancelTaskVerification: (projectId: string, taskId: string, checkId: string) => invoke<boolean>('cancel_task_verification', { projectId, taskId, checkId }),
  addManualTaskEvidence: (projectId: string, taskId: string, criterionId: string, summary: string, passed: boolean) =>
    invoke<EvidenceRecord>('add_manual_task_evidence', { projectId, taskId, criterionId, summary, passed }),
  requestTaskChanges: (projectId: string, taskId: string, instruction: string) => invoke<MissionTask>('request_task_changes', { projectId, taskId, instruction }),
  reconcileMissionRecovery: (projectId?: string) => invoke<RecoveryState[]>('reconcile_mission_recovery', { projectId }),
  recoverMissionSession: (projectId: string, recoveryId: string, action: 'retry'|'mark-failed'|'reattach'|'clean-up') =>
    invoke<RecoveryState>('recover_mission_session', { projectId, recoveryId, action }),
  discoverProjectContext: (projectId: string) => invoke<ProjectContextDiscovery>('discover_project_context', { projectId }),
  saveProjectContext: (context: ProjectContext) => invoke<void>('save_project_context', { context }),
  getProjectContext: (projectId: string) => invoke<ProjectContext | null>('get_project_context', { projectId }),
  saveVerificationProfile: (request: { id?: string; projectId: string; name: string; checks: VerificationProfile['checks']; approved: boolean }) =>
    invoke<VerificationProfile>('save_verification_profile', { request }),
  listVerificationProfiles: (projectId: string) => invoke<VerificationProfile[]>('list_verification_profiles', { projectId }),

  // Durable Project Memory. No command accepts an unscoped item or source identifier.
  memorySearch: (projectId: string, query: string, limit = 50) => invoke<MemorySearchResponse>('memory_search', { projectId, query, limit }),
  memoryGetItem: (projectId: string, itemId: string) => invoke<MemoryItem>('memory_get_item', { projectId, itemId }),
  memoryGetSources: (projectId: string, itemId: string) => invoke<MemorySource[]>('memory_get_sources', { projectId, itemId }),
  memoryCaptureFile: (projectId: string, filePath: string, workspaceId?: string) => invoke<CaptureOutcome>('memory_capture_file', { projectId, workspaceId, filePath }),
  memoryAddNote: (projectId: string, title: string, body: string, memoryType = 'note', workspaceId?: string) =>
    invoke<CaptureOutcome>('memory_add_note', { projectId, workspaceId, title, body, memoryType }),
  memoryResolveSourcePath: (projectId: string, sourceId: string) => invoke<string>('memory_resolve_source_path', { projectId, sourceId }),
  memoryHealth: (projectId: string) => invoke<MemoryHealth>('memory_health', { projectId }),
  memoryRebuildIndex: (projectId: string) => invoke<MemoryRebuildResult>('memory_rebuild_index', { projectId }),
}

export function asNativeError(error: unknown): { code: string; message: string; affectedEntity?: string; recommendedAction?: string } {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = error as { code?: string; message: string; affectedEntity?: string; recommendedAction?: string }
    return { code: value.code ?? 'unknown_error', message: value.message, affectedEntity: value.affectedEntity, recommendedAction: value.recommendedAction }
  }
  return { code: 'unknown_error', message: typeof error === 'string' ? error : 'An unexpected native error occurred.' }
}
