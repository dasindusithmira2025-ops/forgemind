import { create } from 'zustand'
import type { AgentDetectionResult, AppSettings, Project, RecentWorkspace, ShellProfile, TerminalSession, Workspace } from '../native/types'

export const defaultSettings: AppSettings = {
  sidebarOpen: true,
  uiScale: 1,
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
  reopenLastWorkspace: false,
  restoreBehavior: 'ask',
}

interface AppStore {
  project?: Project
  workspace?: Workspace
  recentProjects: Project[]
  recentWorkspaces: RecentWorkspace[]
  detections: AgentDetectionResult[]
  shells: ShellProfile[]
  sessions: Record<string, TerminalSession>
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
  upsertSession: (session: TerminalSession) => void
  markSessionExited: (sessionId: string, exitCode?: number) => void
  removeSession: (sessionId: string) => void
  clearSessions: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  recentProjects: [], recentWorkspaces: [], detections: [], shells: [], sessions: {}, settings: defaultSettings,
  setProject: (project) => set({ project }),
  setWorkspace: (workspace) => set({ workspace, activePaneId: workspace?.activePaneId ?? workspace?.panes[0]?.id }),
  setRecentProjects: (recentProjects) => set({ recentProjects }),
  setRecentWorkspaces: (recentWorkspaces) => set({ recentWorkspaces }),
  setDetections: (detections) => set({ detections }),
  setShells: (shells) => set({ shells }),
  setActivePane: (activePaneId) => set({ activePaneId }),
  setSettings: (settings) => set({ settings }),
  upsertSession: (session) => set((state) => ({ sessions: { ...state.sessions, [session.id]: session } })),
  markSessionExited: (sessionId, exitCode) => set((state) => {
    const session = state.sessions[sessionId]
    if (!session || session.status !== 'running') return state
    return { sessions: { ...state.sessions, [sessionId]: { ...session, status: 'exited', exitCode, endedAt: new Date().toISOString(), processId: undefined } } }
  }),
  removeSession: (sessionId) => set((state) => {
    const sessions = { ...state.sessions }
    delete sessions[sessionId]
    return { sessions }
  }),
  clearSessions: () => set({ sessions: {} }),
}))
