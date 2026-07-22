import { Suspense, lazy } from 'react'
import { Files, Globe, Maximize2, Minimize2, PanelRightClose } from 'lucide-react'
import './workspaceToolPanel.css'
import type { WorkspaceTool } from './workspacePanelStore'
import { BrowserSurface, type BrowserContextInfo } from './browser/BrowserSurface'
import type { AgentContextPackage } from './browser/inspectContext'

// Lazy so Monaco and the whole editor bundle are only fetched the first time the panel is opened —
// the terminal-only startup path never loads the editor runtime.
const CodeSurface = lazy(() => import('./CodeSurface').then((module) => ({ default: module.CodeSurface })))

interface ToolDef {
  id: WorkspaceTool
  label: string
  icon: typeof Files
  shortcut: string
}

// Only tools with a real, complete surface are listed. Browser and Editor are the primary tools;
// Search, Source Control and Agent Changes are added here as their surfaces land — there are
// deliberately no placeholder/dead entries or overflow stubs.
const TOOLS: ToolDef[] = [
  { id: 'browser', label: 'Browser', icon: Globe, shortcut: 'Ctrl+Shift+E' },
  { id: 'files', label: 'Editor', icon: Files, shortcut: 'Ctrl+Shift+E' },
]

export interface WorkspaceToolPanelProps {
  projectId: string
  projectRootPath: string
  workspaceId: string
  /** Whether the panel is the visible surface. Kept mounted-but-hidden when false so editor and
   * browser state survive a collapse; also gates each surface's focus-scoped shortcuts and hides the
   * native browser webview (which HTML display:none cannot clip). */
  visible: boolean
  maximized: boolean
  tool: WorkspaceTool
  browserContext: BrowserContextInfo
  onSendToAgent?: (pkg: AgentContextPackage) => Promise<void> | void
  onToolChange: (tool: WorkspaceTool) => void
  onToggleMaximize: () => void
  onClose: () => void
}

/**
 * The docked right-side workspace-tool panel. A compact tool bar switches between the Browser and
 * Editor surfaces, both of which stay mounted so their state (editor tabs/buffers, browser URL/zoom)
 * survives switching. It never owns the terminal canvas, so opening, resizing, collapsing or
 * maximizing it cannot remount or resize any PTY.
 */
export function WorkspaceToolPanel({
  projectId,
  projectRootPath,
  workspaceId,
  visible,
  maximized,
  tool,
  browserContext,
  onSendToAgent,
  onToolChange,
  onToggleMaximize,
  onClose,
}: WorkspaceToolPanelProps) {
  return (
    <aside
      className="workspace-tool-panel"
      style={{ display: visible ? undefined : 'none' }}
      aria-label="Workspace tools"
      aria-hidden={!visible}
    >
      <div className="tool-panel-main">
        <div className="tool-panel-header">
          <nav className="tool-switcher" aria-label="Workspace tool switcher">
            {TOOLS.map((item) => {
              const Icon = item.icon
              const selected = item.id === tool
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`tool-switch-btn ${selected ? 'is-active' : ''}`}
                  aria-pressed={selected}
                  aria-label={item.label}
                  title={item.label}
                  onClick={() => onToolChange(item.id)}
                >
                  <Icon size={15} aria-hidden />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>
          <span className="tool-panel-spacer" />
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
          {/* Browser stays mounted; it hides its own native webview when not the active surface. */}
          <BrowserSurface active={visible && tool === 'browser'} context={browserContext} onSendToAgent={onSendToAgent} />
          {/* Editor stays mounted (display-toggled) so tabs and unsaved buffers survive switching. */}
          <div className="tool-surface-host" style={{ display: tool === 'files' ? undefined : 'none' }}>
            <Suspense fallback={<div className="code-editor-loading" aria-label="Loading Editor" />}>
              <CodeSurface
                projectId={projectId}
                projectRootPath={projectRootPath}
                workspaceId={workspaceId}
                active={visible && tool === 'files'}
              />
            </Suspense>
          </div>
        </div>
      </div>
    </aside>
  )
}
