import { useState } from 'react'
import { ChevronDown, CircleStop, FolderOpen, PanelRightClose, PanelRightOpen, RotateCcw } from 'lucide-react'
import { Button } from '../ui/Button'
import { FleetBar } from '../../features/fleet/FleetBar'
import type { FleetPaneInput } from '../../features/fleet/fleetSelectors'

export interface WorkspaceTitleBarProps {
  workspaceName: string
  gitBranch?: string | null
  fleetPanes: FleetPaneInput[]
  activePaneId?: string
  onFocusPane: (paneId: string) => void
  runningCount: number
  paneCount: number
  panelOpen: boolean
  onTogglePanel: () => void
  onRenameWorkspace: () => void
  onReconfigureWorkspace: () => void
  onNewWorkspace: () => void
  onOpenAgentResume: () => void
  onRestartAll: () => void
  onStopAll: () => void
  onOpenLauncher: () => void
  onCloseWorkspace: () => void
}

/**
 * The workspace title bar. Extracted from a single 3000-character expression inside
 * `WorkspaceScreen` so the Fleet Bar could take over the flex spacer that used to sit between the
 * workspace name and the controls.
 */
export function WorkspaceTitleBar(props: WorkspaceTitleBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const runMenu = (action: () => void) => () => { setMenuOpen(false); action() }

  return <>
    <div className="workspace-heading">
      <strong title={props.workspaceName}>{props.workspaceName}</strong>
      {props.gitBranch && <span className="branch-label" title={`Branch: ${props.gitBranch}`}>{props.gitBranch}</span>}
    </div>

    <FleetBar panes={props.fleetPanes} activePaneId={props.activePaneId} onFocusPane={props.onFocusPane} />

    <span className="compact-count">
      <span className="measured">{props.runningCount}/{props.paneCount}</span> running
    </span>

    <button
      className={`workspace-tool-panel-toggle ${props.panelOpen ? 'is-active' : ''}`}
      aria-pressed={props.panelOpen}
      aria-label={props.panelOpen ? 'Close workspace panel' : 'Open workspace panel'}
      title={`${props.panelOpen ? 'Close' : 'Open'} workspace panel (Ctrl+Shift+E)`}
      onClick={props.onTogglePanel}
    >
      {props.panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
    </button>

    <div className="workspace-menu-wrap">
      <Button variant="ghost" icon={<ChevronDown size={14} />} aria-expanded={menuOpen} aria-haspopup="menu" onClick={() => setMenuOpen((open) => !open)}>Workspace</Button>
      {menuOpen && <>
        <button className="context-scrim" aria-label="Close workspace menu" onClick={() => setMenuOpen(false)} />
        <div className="context-popover workspace-popover" role="menu">
          <button role="menuitem" onClick={runMenu(props.onRenameWorkspace)}>Rename workspace</button>
          <button role="menuitem" onClick={runMenu(props.onReconfigureWorkspace)}>Reconfigure workspace</button>
          <button role="menuitem" onClick={runMenu(props.onNewWorkspace)}>New workspace for this project</button>
          <span className="menu-separator" />
          <button role="menuitem" onClick={runMenu(props.onOpenAgentResume)}><RotateCcw size={14} />Agent Resume Center</button>
          <button role="menuitem" onClick={runMenu(props.onRestartAll)}><RotateCcw size={14} />Restart all terminals</button>
          <button role="menuitem" onClick={runMenu(props.onStopAll)}><CircleStop size={14} />Stop all terminals</button>
          <button role="menuitem" onClick={runMenu(props.onOpenLauncher)}><FolderOpen size={14} />Project launcher</button>
          <button role="menuitem" className="danger-item" onClick={runMenu(props.onCloseWorkspace)}>Close workspace</button>
        </div>
      </>}
    </div>
  </>
}
