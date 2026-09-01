import { CircleStop, Copy, CopyPlus, Plus, RefreshCw, Search, SplitSquareHorizontal, SplitSquareVertical, Trash2 } from 'lucide-react'

export interface PaneMenuState {
  paneId: string
  x: number
  y: number
}

/** An agent that can be started in a new pane beside this one, e.g. `{ optionId, label }`. */
export interface PaneMenuAgent {
  optionId: string
  label: string
}

/**
 * The three-dots pane action menu shown from a {@link TerminalPane} header. Shared by the main
 * WorkspaceScreen and the DETACHED workspace window so a pane menu behaves identically on every
 * monitor. `compact` hides the actions that depend on the provider-insert flow (split, duplicate,
 * replace, change directory, remove), which only the full main window wires up.
 *
 * The creation actions emit immediately — a pane-local "New terminal here" that opened a picker
 * would be slower than the thing it replaces. Only "Replace agent or shell" still needs a choice,
 * because there is no sensible default for overwriting a pane the user already configured.
 */
export function PaneMenu({ menu, compact = false, agents = [], onClose, onAction }: { menu: { x: number; y: number }; compact?: boolean; agents?: PaneMenuAgent[]; onClose: () => void; onAction: (action: string) => void }) {
  return <>
    <button className="context-scrim" aria-label="Close pane menu" onClick={onClose} />
    <div className="context-popover pane-popover" style={{ left: menu.x, top: menu.y }}>
      <button onClick={() => onAction('focus')}>Focus pane</button>
      <button onClick={() => onAction('rename')}>Rename pane</button>
      {!compact && <>
        <span className="menu-separator" />
        <button onClick={() => onAction('new_terminal')}><Plus size={14} />New terminal here</button>
        <button onClick={() => onAction('split_right')}><SplitSquareVertical size={14} />Split right</button>
        <button onClick={() => onAction('split_down')}><SplitSquareHorizontal size={14} />Split down</button>
        {agents.map((agent) => (
          <button key={agent.optionId} onClick={() => onAction(`new:${agent.optionId}`)}><Plus size={14} />New {agent.label} here</button>
        ))}
        <button onClick={() => onAction('duplicate')}><CopyPlus size={14} />Duplicate context</button>
        <span className="menu-separator" />
        <button onClick={() => onAction('replace')}>Replace agent or shell</button>
        <button onClick={() => onAction('directory')}>Change working directory</button>
        <button onClick={() => onAction('isolate_worktree')}>Isolate in worktree</button>
      </>}
      <span className="menu-separator" />
      <button onClick={() => onAction('review_changes')}>Review pane changes</button>
      <button onClick={() => onAction('resume_agents')}><RefreshCw size={14} />Agent Resume Center</button>
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
