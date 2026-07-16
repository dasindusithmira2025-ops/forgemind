import { CircleStop, Copy, RefreshCw, Search, SplitSquareHorizontal, SplitSquareVertical, Trash2 } from 'lucide-react'

export interface PaneMenuState {
  paneId: string
  x: number
  y: number
}

/**
 * The three-dots pane action menu shown from a {@link TerminalPane} header. Shared by the main
 * WorkspaceScreen and the DETACHED workspace window so a pane menu behaves identically on every
 * monitor. `compact` hides the actions that depend on the provider-insert flow (split, duplicate,
 * replace, change directory, remove), which only the full main window wires up.
 */
export function PaneMenu({ menu, compact = false, onClose, onAction }: { menu: { x: number; y: number }; compact?: boolean; onClose: () => void; onAction: (action: string) => void }) {
  return <>
    <button className="context-scrim" aria-label="Close pane menu" onClick={onClose} />
    <div className="context-popover pane-popover" style={{ left: menu.x, top: menu.y }}>
      <button onClick={() => onAction('focus')}>Focus pane</button>
      <button onClick={() => onAction('rename')}>Rename pane</button>
      {!compact && <>
        <button onClick={() => onAction('split_right')}><SplitSquareVertical size={14} />Split right</button>
        <button onClick={() => onAction('split_down')}><SplitSquareHorizontal size={14} />Split down</button>
        <button onClick={() => onAction('duplicate')}>Duplicate configuration</button>
        <button onClick={() => onAction('replace')}>Replace agent or shell</button>
        <button onClick={() => onAction('directory')}>Change working directory</button>
      </>}
      <span className="menu-separator" />
      <button onClick={() => onAction('search')}><Search size={14} />Search terminal</button>
      <button onClick={() => onAction('copy')}><Copy size={14} />Copy terminal output</button>
      <button onClick={() => onAction('paste')}>Paste</button>
      <button onClick={() => onAction('select_all')}>Select all</button>
      <button onClick={() => onAction('clear')}>Clear display</button>
      <span className="menu-separator" />
      <button onClick={() => onAction('restart')}><RefreshCw size={14} />Restart terminal</button>
      <button onClick={() => onAction('stop')}><CircleStop size={14} />Stop process</button>
      {!compact && <button className="danger-item" onClick={() => onAction('close')}><Trash2 size={14} />Close pane</button>}
    </div>
  </>
}
