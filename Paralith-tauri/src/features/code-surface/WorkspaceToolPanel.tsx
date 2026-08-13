import { Suspense, lazy } from 'react'
import { Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import './workspaceToolPanel.css'
import type { PaneAssignment, TerminalSession } from '../../native/types'
import type { SurfaceKind } from './workspacePanelStore'
import { SurfaceTabBar } from './SurfaceTabBar'
import { SurfaceEmptyState } from './SurfaceEmptyState'
import { BrowserSurface, type BrowserContextInfo } from './browser/BrowserSurface'
import type { AgentContextPackage } from './browser/inspectContext'
import { DiffSurface } from './surfaces/DiffSurface'
import { AgentsSurface } from './surfaces/AgentsSurface'

// Lazy so Monaco and the whole editor bundle are only fetched once the Files surface is actually
// opened — the terminal-only startup path never loads the editor runtime.
const CodeSurface = lazy(() => import('./CodeSurface').then((module) => ({ default: module.CodeSurface })))

export interface WorkspaceToolPanelProps {
  projectId: string
  projectRootPath: string
  workspaceId: string
  /** Whether the panel is the visible surface. Kept mounted-but-hidden when false so open surfaces'
   * state survives a collapse; also gates each surface's focus-scoped shortcuts and hides the
   * native browser webview (which HTML display:none cannot clip). */
  visible: boolean
  maximized: boolean
  surfaces: SurfaceKind[]
  activeSurface?: SurfaceKind
  browserContext: BrowserContextInfo
  agents: { panes: PaneAssignment[]; sessions: TerminalSession[]; activePaneId?: string; onFocusPane: (paneId: string) => void }
  onSendToAgent?: (pkg: AgentContextPackage) => Promise<void> | void
  onSelectSurface: (kind: SurfaceKind) => void
  onOpenSurface: (kind: SurfaceKind) => void
  onCloseSurface: (kind: SurfaceKind) => void
  onReorderSurface: (kind: SurfaceKind, toIndex: number) => void
  onToggleMaximize: () => void
  onClose: () => void
}

/**
 * The docked right-side Surface Workspace: a registry-driven tab strip switches between tool
 * surfaces (Files, Browser, Diff, Agents). Each open surface stays mounted while present in
 * `surfaces` (display-toggled, not unmounted) so its state — editor tabs/buffers, browser URL/zoom,
 * diff staging selection, scroll position — survives switching tabs; it mounts only once opened, so
 * a surface the user never opens never pays its runtime's startup cost. It never owns the terminal
 * canvas, so opening, resizing, collapsing or maximizing it cannot remount or resize any PTY.
 */
export function WorkspaceToolPanel({
  projectId,
  projectRootPath,
  workspaceId,
  visible,
  maximized,
  surfaces,
  activeSurface,
  browserContext,
  agents,
  onSendToAgent,
  onSelectSurface,
  onOpenSurface,
  onCloseSurface,
  onReorderSurface,
  onToggleMaximize,
  onClose,
}: WorkspaceToolPanelProps) {
  const isOpen = (kind: SurfaceKind) => surfaces.includes(kind)
  const isActive = (kind: SurfaceKind) => visible && kind === activeSurface

  return (
    <aside
      className="workspace-tool-panel"
      style={{ display: visible ? undefined : 'none' }}
      aria-label="Workspace surfaces"
      aria-hidden={!visible}
    >
      <div className="tool-panel-main">
        <div className="tool-panel-header">
          <SurfaceTabBar
            surfaces={surfaces}
            activeSurface={activeSurface}
            onSelect={onSelectSurface}
            onClose={onCloseSurface}
            onReorder={onReorderSurface}
            onOpen={onOpenSurface}
          />
          <div className="tool-panel-actions">
            <button
              type="button"
              title={maximized ? 'Restore panel size' : 'Maximize panel'}
              aria-label={maximized ? 'Restore panel size' : 'Maximize panel'}
              aria-pressed={maximized}
              onClick={onToggleMaximize}
            >
              {maximized ? <Minimize2 size={14} aria-hidden /> : <Maximize2 size={14} aria-hidden />}
            </button>
            <button type="button" title="Close panel (Ctrl+Shift+E)" aria-label="Close panel" onClick={onClose}>
              <PanelRightClose size={15} aria-hidden />
            </button>
          </div>
        </div>

        <div className="tool-panel-body">
          {surfaces.length === 0 && <SurfaceEmptyState onOpen={onOpenSurface} />}

          {isOpen('browser') && (
            <div className="tool-surface-host" style={{ display: isActive('browser') ? undefined : 'none' }}>
              <BrowserSurface active={isActive('browser')} context={browserContext} onSendToAgent={onSendToAgent} />
            </div>
          )}

          {isOpen('files') && (
            <div className="tool-surface-host" style={{ display: isActive('files') ? undefined : 'none' }}>
              <Suspense fallback={<div className="code-editor-loading" aria-label="Loading Editor" />}>
                <CodeSurface projectId={projectId} projectRootPath={projectRootPath} workspaceId={workspaceId} active={isActive('files')} />
              </Suspense>
            </div>
          )}

          {isOpen('diff') && (
            <div className="tool-surface-host" style={{ display: isActive('diff') ? undefined : 'none' }}>
              <DiffSurface projectId={projectId} />
            </div>
          )}

          {isOpen('agents') && (
            <div className="tool-surface-host" style={{ display: isActive('agents') ? undefined : 'none' }}>
              <AgentsSurface
                workspaceId={workspaceId}
                panes={agents.panes}
                sessions={agents.sessions}
                activePaneId={agents.activePaneId}
                onFocusPane={agents.onFocusPane}
              />
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
