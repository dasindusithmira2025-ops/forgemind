import { create } from 'zustand'
import type { AgentDetectionResult, AppSettings, Project, RecentWorkspace, ShellProfile, Workspace } from '../native/types'

export const defaultSettings: AppSettings = {
  sidebarOpen: true,
  sidebarWidth: 300,
  sidebarGroupBy: 'project',
  sidebarSortMode: 'manual',
  sidebarCollapsedGroups: [],
  uiScale: 1,
  uiDensity: 'standard',
  themeId: 'paralith-dark',
  terminalFontSize: 13,
  terminalFontFamily: 'Cascadia Mono, Consolas, monospace',
  terminalLineHeight: 1.15,
  cursorStyle: 'block',
  claudeExecutablePath: undefined,
  codexExecutablePath: undefined,
  opencodeExecutablePath: undefined,
  scrollbackSize: 10_000,
  copyOnSelect: false,
  confirmMultilinePaste: true,
  confirmClosePane: true,
  autoRenameAgentTerminals: true,
  reopenLastWorkspace: false,
  restoreBehavior: 'ask',
  outputLogRetention: 'tail_only',
  restorationLaunchBudget: 4,
  defaultLayout: 'auto',
  defaultPaneCount: 4,
  inactiveWorkspaceProcesses: 'keep_running',
  inactiveWorkspaceRendering: 'hibernate',
  automaticUpdateChecks: true,
  settingsVersion: 3,
}

interface AppStore {
  project?: Project
  workspace?: Workspace
  recentProjects: Project[]
  recentWorkspaces: RecentWorkspace[]
  detections: AgentDetectionResult[]
  shells: ShellProfile[]
  activePaneId?: string
  settings: AppSettings
  setProject: (project?: Project) => void
  setWorkspace: (workspace?: Workspace) => void
  setRecentProjects: (recentProjects: Project[]) => void
  setRecentWorkspaces: (recentWorkspaces: RecentWorkspace[]) => void
  setDetections: (detections: AgentDetectionResult[]) => void
  setShells: (shells: ShellProfile[]) => void
  setActivePane: (paneId?: string) => void
  setSettings: (settings: AppSettings) => void
}

export const useAppStore = create<AppStore>((set) => ({
  recentProjects: [], recentWorkspaces: [], detections: [], shells: [], settings: defaultSettings,
  setProject: (project) => set({ project }),
  setWorkspace: (workspace) => set({ workspace, activePaneId: workspace?.activePaneId ?? workspace?.panes[0]?.id }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setRecentWorkspaces: (recentWorkspaces) => set({ recentWorkspaces }),
  setDetections: (detections) => set({ detections }),
  setShells: (shells) => set({ shells }),
  setActivePane: (activePaneId) => set({ activePaneId }),
  setSettings: (settings) => set({ settings }),
}))
