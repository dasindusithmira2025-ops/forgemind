import { useEffect, useRef } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CircleStop,
  FolderInput,
  Pencil,
  RotateCcw,
  Settings2,
  SquareStack,
  Trash2,
} from 'lucide-react'
import type { SidebarActions } from '../sidebarTypes'

export type WorkspaceMenuAction =
  | 'open'
  | 'open_fresh'
  | 'rename'
  | 'reconfigure'
  | 'duplicate'
  | 'restart'
  | 'stop'
  | 'move_up'
  | 'move_down'
  | 'remove_recent'
  | 'delete'

/**
 * The Workspace overflow menu — compact and grouped exactly as the spec requires. Focus is
 * trapped to arrow-key navigation so it is fully keyboard operable (Shift+F10 opens it).
 */
export function WorkspaceContextMenu({
  workspaceId,
  anchor,
  actions,
  onClose,
}: {
  workspaceId: string
  anchor?: { x: number; y: number }
  actions: SidebarActions
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Anchor near the trigger, clamped into the viewport (menu ~250px tall / 240px wide).
  const left = anchor ? Math.min(anchor.x, window.innerWidth - 232) : 60
  const top = anchor ? Math.min(anchor.y + 2, window.innerHeight - 396) : 120

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')
    first?.focus()
  }, [])

  const run = (action: WorkspaceMenuAction) => {
    onClose()
    switch (action) {
      case 'open':
        return actions.onSelectWorkspace(workspaceId)
      case 'open_fresh':
        return actions.onOpenFresh(workspaceId)
      case 'rename':
        return actions.onRenameWorkspace(workspaceId)
      case 'reconfigure':
        return actions.onReconfigureWorkspace(workspaceId)
      case 'duplicate':
        return actions.onDuplicateWorkspace(workspaceId)
      case 'restart':
        return actions.onRestartWorkspace(workspaceId)
      case 'stop':
        return actions.onStopWorkspace(workspaceId)
      case 'move_up':
        return actions.onMoveWorkspace(workspaceId, -1)
      case 'move_down':
        return actions.onMoveWorkspace(workspaceId, 1)
      case 'remove_recent':
        return actions.onRemoveRecent(workspaceId)
      case 'delete':
        return actions.onDeleteWorkspace(workspaceId)
    }
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return (
    <>
      <button className="context-scrim" aria-label="Close workspace menu" onClick={onClose} />
      <div
        ref={ref}
        className="context-popover ws-context-menu"
        role="menu"
        style={{ left, top }}
        onKeyDown={onKeyDown}
      >
        <button role="menuitem" onClick={() => run('open')}>
          Open workspace
        </button>
        <button role="menuitem" onClick={() => run('open_fresh')}>
          Open with fresh terminals
        </button>
        <span className="menu-separator" />
        <button role="menuitem" onClick={() => run('rename')}>
          <Pencil size={14} />
          Rename workspace
        </button>
        <button role="menuitem" onClick={() => run('reconfigure')}>
          <Settings2 size={14} />
          Reconfigure workspace
        </button>
        <button role="menuitem" onClick={() => run('duplicate')}>
          <SquareStack size={14} />
          Duplicate workspace
        </button>
        <span className="menu-separator" />
        <button role="menuitem" onClick={() => run('restart')}>
          <RotateCcw size={14} />
          Restart assigned terminals
        </button>
        <button role="menuitem" onClick={() => run('stop')}>
          <CircleStop size={14} />
          Stop all workspace terminals
        </button>
        <span className="menu-separator" />
        <button role="menuitem" onClick={() => run('move_up')}>
          <ArrowUp size={14} />
          Move up
        </button>
        <button role="menuitem" onClick={() => run('move_down')}>
          <ArrowDown size={14} />
          Move down
        </button>
        <span className="menu-separator" />
        <button role="menuitem" onClick={() => run('remove_recent')}>
          <FolderInput size={14} />
          Remove from recents
        </button>
        <button role="menuitem" className="danger-item" onClick={() => run('delete')}>
          <Trash2 size={14} />
          Delete workspace configuration
        </button>
      </div>
    </>
  )
}
