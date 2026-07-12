import { useShallow } from 'zustand/react/shallow'
import type { PaneAssignment, Project, TerminalSession, Workspace } from '../native/types'
import { useAppStore } from './appStore'

/**
 * The one canonical active context. Every screen derives the active Project, Workspace,
 * Pane, and Terminal Session from the same place — `activeWorkspaceId` (the loaded
 * workspace) and `activePaneId` — instead of independently guessing from routes, recent
 * rows, or stale selected IDs. The Project is always taken from `Workspace.projectId`.
 */
export interface ActiveContext {
  activeProject?: Project
  activeWorkspace?: Workspace
  activePane?: PaneAssignment
  activeTerminalSession?: TerminalSession
}

export interface ActiveContextInput {
  project?: Project
  workspace?: Workspace
  activePaneId?: string
  sessions: Record<string, TerminalSession>
}

export function deriveActiveContext(state: ActiveContextInput): ActiveContext {
  const { workspace, activePaneId, sessions } = state
  // The Project of record is the workspace's parent, never a separately selected id.
  const activeProject =
    workspace && state.project?.id === workspace.projectId ? state.project : state.project
  const activePane = activePaneId ? workspace?.panes.find((pane) => pane.id === activePaneId) : undefined
  const paneSessions = Object.values(sessions).filter((session) => session.paneId === activePaneId)
  // Only one live session may be attached to a pane at a time; prefer it, else the latest record.
  const activeTerminalSession =
    paneSessions.find((session) => session.status === 'running') ??
    paneSessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  return {
    activeProject: workspace ? activeProject : undefined,
    activeWorkspace: workspace,
    activePane,
    activeTerminalSession,
  }
}

export function useActiveContext(): ActiveContext {
  return useAppStore(
    useShallow((state) =>
      deriveActiveContext({
        project: state.project,
        workspace: state.workspace,
        activePaneId: state.activePaneId,
        sessions: state.sessions,
      }),
    ),
  )
}
