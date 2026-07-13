import { useShallow } from 'zustand/react/shallow'
import type { PaneAssignment, Project, Workspace } from '../native/types'
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
}

export interface ActiveContextInput {
  project?: Project
  workspace?: Workspace
  activePaneId?: string
}

export function deriveActiveContext(state: ActiveContextInput): ActiveContext {
  const { workspace, activePaneId } = state
  // The Project of record is the workspace's parent, never a separately selected id.
  const activeProject = workspace && state.project?.id === workspace.projectId ? state.project : undefined
  const activePane = activePaneId ? workspace?.panes.find((pane) => pane.id === activePaneId) : undefined
  return {
    activeProject: workspace ? activeProject : undefined,
    activeWorkspace: workspace,
    activePane,
  }
}

export function useActiveContext(): ActiveContext {
  return useAppStore(
    useShallow((state) =>
      deriveActiveContext({
        project: state.project,
        workspace: state.workspace,
        activePaneId: state.activePaneId,
      }),
    ),
  )
}
