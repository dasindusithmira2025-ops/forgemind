import { memo, useCallback, type CSSProperties } from 'react'
import { MoreVertical, X } from 'lucide-react'
import { runtimeStatusText } from '../sidebarSelectors'
import type { SidebarActions, SidebarWorkspace } from '../sidebarTypes'
import { workspaceIdentityColor } from '../workspaceIdentity'
import { WorkspaceRuntimeIndicator } from './WorkspaceRuntimeIndicator'

interface WorkspaceRowProps {
  entry: SidebarWorkspace
  active: boolean
  switching: boolean
  dragging: boolean
  dropTarget: boolean
  menuOpen: boolean
  /** False while a filter is narrowing the list, where a drop index would be meaningless. */
  reorderable: boolean
  /**
   * The owning Project's name, shown only when the row's group does not already state it — i.e.
   * the flat list spanning several open Projects. Without it two Workspaces called "main" from
   * different Projects are indistinguishable.
   */
  projectName?: string
  actions: SidebarActions
  onOpenMenu: (id?: string, anchor?: { x: number; y: number }) => void
  onDragStart: (id: string) => void
  onDragEnter: (id: string) => void
  onDragEnd: () => void
  onDrop: (id: string) => void
}

/**
 * One Workspace row: identity mark, name, pane count, and the actions scoped to it.
 *
 * One line, not two. The second line used to restate the runtime in words on every row at all
 * times, which made a list of eight Workspaces sixteen lines of text to scan; the indicator and
 * the row's tooltip carry the same facts without spending the height. Colour on the row is the
 * Workspace's own identity (see `workspaceIdentity`) — it tints the dot, the count and the
 * selected state, so "which one am I in" is answered by hue before any text is read.
 *
 * Memoized so a runtime change to a single Workspace only rerenders that row.
 */
function WorkspaceRowImpl({
  entry,
  active,
  switching,
  dragging,
  dropTarget,
  menuOpen,
  reorderable,
  projectName,
  actions,
  onOpenMenu,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: WorkspaceRowProps) {
  const { workspace, runtime, providers } = entry
  const paneCount = workspace.panes.length
  // Nothing to stop when nothing is running, so the control that stops it is not offered.
  const running = runtime.status !== 'closed'

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

  // Everything the removed second line used to say, plus the providers, in the row's own tooltip.
  const detail = [
    workspace.name,
    runtime.status === 'closed' ? 'Not running' : runtimeStatusText(runtime),
    providers.text,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <li
      className={`ws-row ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''} ${
        dropTarget ? 'is-drop-target' : ''
      } ${switching ? 'is-switching' : ''} ${reorderable ? 'is-reorderable' : ''}`}
      style={{ '--ws-identity': workspaceIdentityColor(workspace.id) } as CSSProperties}
      aria-current={active ? 'true' : undefined}
      draggable={reorderable}
      onDragStart={() => reorderable && onDragStart(workspace.id)}
      onDragEnter={() => reorderable && onDragEnter(workspace.id)}
      onDragOver={(event) => reorderable && event.preventDefault()}
      onDrop={() => reorderable && onDrop(workspace.id)}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        className="ws-row-main"
        title={detail}
        aria-label={`${workspace.name}${projectName ? ` in ${projectName}` : ''}, ${runtime.status}, ${paneCount} panes`}
        onClick={() => !active && actions.onSelectWorkspace(workspace.id)}
        onDoubleClick={(event) => event.preventDefault()}
        onKeyDown={onKeyDown}
      >
        <WorkspaceRuntimeIndicator status={runtime.status} />
        <span className="ws-row-name">{workspace.name}</span>
        {projectName && <span className="ws-row-project">{projectName}</span>}
        <span
          className="ws-pane-badge"
          aria-label={`${paneCount} configured terminal pane${paneCount === 1 ? '' : 's'}`}
        >
          {paneCount}
        </span>
      </button>

      {/* Fixed width whether or not the controls are showing, so a row never reflows under the
          pointer and a long name never truncates differently on hover. */}
      <span className="ws-row-actions">
        {running && (
          <button
            type="button"
            className="ws-row-close"
            aria-label={`Stop ${workspace.name} terminals`}
            title="Stop workspace terminals"
            onClick={(event) => {
              event.stopPropagation()
              actions.onStopWorkspace(workspace.id)
            }}
          >
            <X size={14} />
          </button>
        )}
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
      </span>
    </li>
  )
}

export const WorkspaceRow = memo(WorkspaceRowImpl)
