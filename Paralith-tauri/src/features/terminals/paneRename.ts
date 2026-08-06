import type { PaneRenamedEvent, Workspace } from '../../native/types'

/**
 * Apply a backend Pane rename to a Workspace held in renderer state.
 *
 * The backend has already persisted the title, so this is a pure projection — no save is issued
 * from here, which is what keeps a rename from racing the authoritative write. The identical
 * Workspace reference is returned whenever nothing changed, so an unrelated event can never
 * re-render the canvas and remount a live terminal.
 */
export function applyPaneRename(workspace: Workspace | undefined, event: PaneRenamedEvent): Workspace | undefined {
  if (!workspace || workspace.id !== event.workspaceId) return workspace
  const pane = workspace.panes.find((item) => item.id === event.paneId)
  if (!pane || pane.title === event.title) return workspace
  return {
    ...workspace,
    panes: workspace.panes.map((item) => (item.id === event.paneId ? { ...item, title: event.title } : item)),
  }
}
