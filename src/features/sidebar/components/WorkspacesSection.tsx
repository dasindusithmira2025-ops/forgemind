import { useCallback } from 'react'
import { Plus } from 'lucide-react'
import { useSidebarStore } from '../sidebarStore'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'
import { WorkspaceContextMenu } from './WorkspaceContextMenu'
import { WorkspaceRow } from './WorkspaceRow'

/**
 * The flexible middle region: the reorderable Workspaces list for the current Project. Drag
 * reordering is committed once, on drop; keyboard Move Up/Down provides an equal alternative.
 */
export function WorkspacesSection({
  workspaces,
  activeWorkspaceId,
  switchingWorkspaceId,
  loading,
  actions,
}: {
  workspaces: SidebarWorkspace[]
  activeWorkspaceId: string
  switchingWorkspaceId?: string
  loading?: boolean
  actions: SidebarActions
}) {
  const draggingWorkspaceId = useSidebarStore((state) => state.draggingWorkspaceId)
  const dropTargetWorkspaceId = useSidebarStore((state) => state.dropTargetWorkspaceId)
  const menuWorkspaceId = useSidebarStore((state) => state.menuWorkspaceId)
  const menuAnchor = useSidebarStore((state) => state.menuAnchor)
  const setDragging = useSidebarStore((state) => state.setDraggingWorkspace)
  const setDropTarget = useSidebarStore((state) => state.setDropTarget)
  const setMenu = useSidebarStore((state) => state.setMenuWorkspace)

  const commitDrop = useCallback(
    (targetId: string) => {
      const sourceId = draggingWorkspaceId
      setDragging(undefined)
      setDropTarget(undefined)
      if (!sourceId || sourceId === targetId) return
      const ids = workspaces.map((entry) => entry.workspace.id)
      const from = ids.indexOf(sourceId)
      const to = ids.indexOf(targetId)
      if (from < 0 || to < 0) return
      const next = [...ids]
      next.splice(from, 1)
      next.splice(to, 0, sourceId)
      // Persist only after the drop settles — never on every pointer move.
      actions.onReorder(next)
    },
    [draggingWorkspaceId, workspaces, actions, setDragging, setDropTarget],
  )

  return (
    <section className="ws-section" aria-label="Workspaces">
      <header className="ws-section-head">
        <span className="section-label">Workspaces</span>
        <button
          type="button"
          className="ws-section-add"
          aria-label="New workspace"
          title="New workspace"
          onClick={actions.onNewWorkspace}
        >
          <Plus size={15} />
        </button>
      </header>

      {loading ? (
        <ul className="ws-list" aria-hidden>
          {[0, 1, 2].map((key) => (
            <li key={key} className="ws-row ws-row-skeleton">
              <span className="ws-skel-dot" />
              <span className="ws-skel-lines">
                <span className="ws-skel-line" />
                <span className="ws-skel-line short" />
              </span>
            </li>
          ))}
        </ul>
      ) : workspaces.length === 0 ? (
        <div className="ws-empty">
          <p>No workspaces yet for this project.</p>
          <button type="button" className="button button-secondary" onClick={actions.onNewWorkspace}>
            <Plus size={14} />
            Create a workspace
          </button>
        </div>
      ) : (
        <ul className="ws-list" role="list">
          {workspaces.map((entry) => (
            <WorkspaceRow
              key={entry.workspace.id}
              entry={entry}
              active={entry.workspace.id === activeWorkspaceId}
              switching={entry.workspace.id === switchingWorkspaceId}
              dragging={entry.workspace.id === draggingWorkspaceId}
              dropTarget={entry.workspace.id === dropTargetWorkspaceId}
              menuOpen={entry.workspace.id === menuWorkspaceId}
              actions={actions}
              onOpenMenu={setMenu}
              onDragStart={setDragging}
              onDragEnter={setDropTarget}
              onDragEnd={() => {
                setDragging(undefined)
                setDropTarget(undefined)
              }}
              onDrop={commitDrop}
            />
          ))}
        </ul>
      )}

      {menuWorkspaceId && (
        <WorkspaceContextMenu
          workspaceId={menuWorkspaceId}
          anchor={menuAnchor}
          actions={actions}
          onClose={() => setMenu(undefined)}
        />
      )}
    </section>
  )
}
