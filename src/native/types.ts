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
  workingDirectory: string
  positionOrder: number
}

export interface Workspace {
  id: string
  projectId: string
  name: string
  layout: LayoutNode
  activePaneId?: string
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
  workspaceId: string
  paneId: string
  provider: AgentProvider
  title: string
  workingDirectory: string
  status: 'running' | 'exited' | 'terminated' | 'disconnected' | 'failed'
  processId?: number
  startedAt: string
  endedAt?: string
  exitCode?: number
  outputTail: number[]
  nextSequence: number
}

export interface CreateTerminalRequest {
  workspaceId: string
  paneId: string
  provider: AgentProvider
  title: string
  executablePath: string
  args: string[]
  workingDirectory: string
  cols: number
  rows: number
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

export interface AppSettings {
  sidebarOpen: boolean
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
}

export interface NativeError {
  code: string
  message: string
  recoverable: boolean
  detail?: string
  affectedEntity?: string
}
