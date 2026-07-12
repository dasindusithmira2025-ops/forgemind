import { invoke } from '@tauri-apps/api/core'
import type {
  AgentDetectionResult,
  AppSettings,
  CreateTerminalRequest,
  LayoutNode,
  Project,
  ProjectOverview,
  RecentWorkspace,
  ShellProfile,
  SplitDirection,
  TerminalSession,
  Workspace,
  WorkspaceSaveRequest,
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
  renameWorkspace: (workspaceId: string, name: string) => invoke<Workspace>('rename_workspace', { workspaceId, name }),
  createTerminalSession: (request: CreateTerminalRequest) => invoke<TerminalSession>('create_terminal_session', { request }),
  writeTerminalInput: (sessionId: string, data: number[]) => invoke<void>('write_terminal_input', { sessionId, data }),
  resizeTerminalSession: (sessionId: string, cols: number, rows: number) => invoke<void>('resize_terminal_session', { sessionId, cols, rows }),
  terminateTerminalSession: (sessionId: string) => invoke<void>('terminate_terminal_session', { sessionId }),
  terminateWorkspaceSessions: (workspaceId: string) => invoke<void>('terminate_workspace_sessions', { workspaceId }),
  listLiveSessions: (workspaceId?: string) => invoke<TerminalSession[]>('list_live_sessions', { workspaceId }),
  terminalSessionStatus: (sessionId: string) => invoke<TerminalSession>('terminal_session_status', { sessionId }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>('save_settings', { settings }),
}

export function asNativeError(error: unknown): { code: string; message: string; affectedEntity?: string } {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const value = error as { code?: string; message: string; affectedEntity?: string }
    return { code: value.code ?? 'unknown_error', message: value.message, affectedEntity: value.affectedEntity }
  }
  return { code: 'unknown_error', message: typeof error === 'string' ? error : 'An unexpected native error occurred.' }
}
