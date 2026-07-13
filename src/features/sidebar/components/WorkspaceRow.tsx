import { memo, useCallback } from 'react'
import { GripVertical, MoreVertical } from 'lucide-react'
import { runtimeStatusText } from '../sidebarSelectors'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'
import { WorkspaceRuntimeIndicator } from './WorkspaceRuntimeIndicator'

interface WorkspaceRowProps {
  entry: SidebarWorkspace
  active: boolean
  switching: boolean
  dragging: boolean
  dropTarget: boolean
  menuOpen: boolean
  actions: SidebarActions
  onOpenMenu: (id?: string, anchor?: { x: number; y: number }) => void
  onDragStart: (id: string) => void
  onDragEnter: (id: string) => void
  onDragEnd: () => void
  onDrop: (id: string) => void
}

/**
 * One Workspace row. Memoized so a runtime change to a single Workspace only rerenders that
 * row. The whole row is a button; the overflow trigger and drag handle are nested controls.
 */
function WorkspaceRowImpl({
  entry,
  active,
  switching,
  dragging,
  dropTarget,
  menuOpen,
  actions,
  onOpenMenu,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: WorkspaceRowProps) {
  const { workspace, runtime, providers } = entry
  const paneCount = workspace.panes.length

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Keyboard reorder alternative to drag-and-drop (Alt+Arrow), plus menu (Shift+F10).
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault()
        actions.onMoveWorkspace(workspace.id, -1)
      } else if (event.altKey && event.key === 'ArrowDown') {
        event.preventDefault()
        actions.onMoveWorkspace(workspace.id, 1)
      } else if (event.shiftKey && event.key === 'F10') {
        event.preventDefault()
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
        onOpenMenu(workspace.id, { x: rect.right - 8, y: rect.bottom })
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!active) actions.onSelectWorkspace(workspace.id)
      }
    },
    [actions, workspace.id, active, onOpenMenu],
  )

  return (
    <li
      className={`ws-row ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''} ${
        dropTarget ? 'is-drop-target' : ''
      } ${switching ? 'is-switching' : ''}`}
      aria-current={active ? 'true' : undefined}
      draggable
      onDragStart={() => onDragStart(workspace.id)}
      onDragEnter={() => onDragEnter(workspace.id)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={() => onDrop(workspace.id)}
      onDragEnd={onDragEnd}
    >
      <span className="ws-row-accent" aria-hidden />
      <button
        type="button"
        className="ws-row-main"
        aria-label={`${workspace.name}, ${runtime.status}, ${paneCount} panes`}
        onClick={() => !active && actions.onSelectWorkspace(workspace.id)}
        onDoubleClick={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <WorkspaceRuntimeIndicator status={runtime.status} />
        <span className="ws-row-body">
          <span className="ws-row-title-line">
            <strong className="ws-row-name">{workspace.name}</strong>
            <span
              className="ws-pane-badge"
              title={`${paneCount} configured terminal pane${paneCount === 1 ? '' : 's'}`}
              aria-label={`${paneCount} configured terminal pane${paneCount === 1 ? '' : 's'}`}
            >
              {paneCount}
            </span>
          </span>
          <span className="ws-row-secondary" title={providers.labels.join(' · ')}>
            {runtime.status === 'closed' ? providers.text || 'Not running' : runtimeStatusText(runtime)}
          </span>
        </span>
      </button>
      <span
        className="ws-row-handle"
        aria-hidden
        title="Drag to reorder"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <GripVertical size={13} />
      </span>
      <button
        type="button"
        className="ws-row-menu"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${workspace.name} actions`}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          onOpenMenu(menuOpen ? undefined : workspace.id, { x: rect.right, y: rect.bottom })
        }}
      >
        <MoreVertical size={15} />
      </button>
    </li>
  )
}

export const WorkspaceRow = memo(WorkspaceRowImpl)
