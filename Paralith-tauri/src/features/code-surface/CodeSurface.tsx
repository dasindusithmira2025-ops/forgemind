import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, FileX2, PanelLeft, Save, SaveAll, Search } from 'lucide-react'
import './codeSurface.css'
import { native } from '../../native/commands'
import { onProjectFileChanged } from '../../native/events'
import { ErrorNotice } from '../../components/ui/ErrorNotice'
import { baseName, isDirty, useEditorStore, type EditorTab } from './editorStore'
import { parentDir, useExplorerStore } from './explorerStore'
import { FileExplorer } from './FileExplorer'
import { EditorTabs } from './EditorTabs'
import { QuickOpen } from './QuickOpen'

const MonacoEditorPane = lazy(() => import('./MonacoEditorPane'))
const DiffOverlay = lazy(() => import('./MonacoEditorPane').then((module) => ({ default: module.DiffOverlay })))

interface CodeSurfaceProps {
  projectId: string
  projectRootPath: string
  workspaceId: string
  /** Whether the Code surface is the visible surface. Global shortcuts bind only when active so
   * a focused terminal is never affected. */
  active: boolean
}

export function CodeSurface({ projectId, projectRootPath, workspaceId, active }: CodeSurfaceProps) {
  const initExplorer = useExplorerStore((state) => state.init)
  const init = useEditorStore((state) => state.init)
  const tabs = useEditorStore((state) => state.tabs)
  const activePath = useEditorStore((state) => state.activePath)
  const openFile = useEditorStore((state) => state.openFile)
  const save = useEditorStore((state) => state.save)
  const saveAll = useEditorStore((state) => state.saveAll)
  const setBuffer = useEditorStore((state) => state.setBuffer)
  const closeTabAction = useEditorStore((state) => state.closeTab)
  const forceCloseTab = useEditorStore((state) => state.forceCloseTab)
  const resolveIncoming = useEditorStore((state) => state.resolveIncoming)
  const setQuickOpen = useEditorStore((state) => state.setQuickOpen)
  const quickOpen = useEditorStore((state) => state.quickOpen)
  const comparing = useEditorStore((state) => state.comparing)
  const setComparing = useEditorStore((state) => state.setComparing)
  const recent = useEditorStore((state) => state.recent)
  const explorerWidth = useEditorStore((state) => state.explorerWidth)
  const setExplorerWidth = useEditorStore((state) => state.setExplorerWidth)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  // When the docked panel is dragged narrow, the explorer + editor cannot both stay usable, so the
  // explorer becomes an on-demand drawer over the editor. The active file/buffer is untouched.
  const [narrow, setNarrow] = useState(false)
  const [explorerOpen, setExplorerOpen] = useState(true)
  const surfaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    init(projectId, workspaceId)
    initExplorer(projectId)
  }, [init, initExplorer, projectId, workspaceId])

  // Track the surface width so a narrow panel switches to the explorer-drawer layout. Observing the
  // element (not window) keeps this correct when only the panel — not the window — is resized.
  useEffect(() => {
    const node = surfaceRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    const NARROW_AT = 480
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? node.clientWidth
      setNarrow((current) => {
        const next = width > 0 && width < NARROW_AT
        if (next && !current) setExplorerOpen(false)
        if (!next && current) setExplorerOpen(true)
        return next
      })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // One watcher subscription per mounted Code surface. External/agent changes refresh the
  // affected directories and reconcile open buffers without ever overwriting unsaved work.
  useEffect(() => {
    if (!projectId) return
    let unlisten: (() => void) | undefined
    let cancelled = false
    void native.watchProjectFiles(projectId).catch(() => undefined)
    void onProjectFileChanged((batch) => {
      if (batch.projectId !== projectId) return
      const directories = new Set<string>()
      for (const change of batch.changes) {
        directories.add(parentDir(change.relativePath))
        void useEditorStore.getState().applyExternalChange(change.relativePath, change.kind)
      }
      for (const directory of directories) useExplorerStore.getState().invalidate(directory)
    }).then((stop) => { if (cancelled) stop(); else unlisten = stop })
    return () => {
      cancelled = true
      unlisten?.()
      void native.unwatchProjectFiles(projectId).catch(() => undefined)
    }
  }, [projectId])

  const closeTab = useCallback(
    (path: string) => {
      if (closeTabAction(path) === 'needs-confirm') {
        if (window.confirm(`${path.split('/').pop()} has unsaved changes. Close without saving?`)) forceCloseTab(path)
      }
    },
    [closeTabAction, forceCloseTab],
  )

  // Surface-level shortcuts: Quick Open and Save All. Bound only while the panel is visible AND
  // focus is inside it (or nothing is focused) — so a focused terminal never has its keystrokes
  // stolen by the editor. Monaco's own Save/Close commands are editor-scoped and already safe.
  useEffect(() => {
    if (!active) return
    const handle = (event: KeyboardEvent) => {
      const target = document.activeElement
      const ownsFocus =
        !target || target === document.body || (surfaceRef.current?.contains(target) ?? false)
      if (!ownsFocus) return
      if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault(); setQuickOpen(true)
      } else if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault(); void saveAll()
      } else if (event.key === 'Escape') {
        if (useEditorStore.getState().quickOpen) setQuickOpen(false)
        else if (useEditorStore.getState().comparing) setComparing(undefined)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [active, saveAll, setQuickOpen, setComparing])

  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = explorerWidth
      const move = (moveEvent: PointerEvent) => setExplorerWidth(startWidth + (moveEvent.clientX - startX))
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [explorerWidth, setExplorerWidth],
  )

  const activeTab = tabs.find((tab) => tab.path === activePath)
  const explorerVisible = !narrow || explorerOpen

  return (
    <div className={`code-surface ${narrow ? 'is-narrow' : ''}`} ref={surfaceRef}>
      {explorerVisible && (
        <div className="code-explorer-pane" style={narrow ? undefined : { width: explorerWidth }}>
          <FileExplorer
            projectId={projectId}
            projectRootPath={projectRootPath}
            activePath={activePath}
            onOpenFile={(path, options) => {
              void openFile(path, options)
              // In the drawer layout, opening a file returns focus to the editor.
              if (narrow) setExplorerOpen(false)
            }}
            onDeletedPath={(path) => tabs.some((tab) => tab.path === path) && forceCloseTab(path)}
          />
        </div>
      )}
      {!narrow && (
        <div className="code-explorer-resize" role="separator" aria-orientation="vertical" onPointerDown={startResize} />
      )}
      {narrow && explorerOpen && (
        <button className="code-explorer-scrim" aria-label="Close explorer" onClick={() => setExplorerOpen(false)} />
      )}

      <div className="code-editor-pane">
        {/* No open document means no document chrome: an empty 34px header holding two disabled
          * icons is exactly the wasted surface this redesign is removing. The narrow layout keeps
          * it, because that is where the explorer drawer toggle lives. */}
        {(tabs.length > 0 || narrow) && (
        <div className="code-editor-header">
          {narrow && (
            <button
              className="code-explorer-toggle"
              title={explorerOpen ? 'Hide explorer' : 'Show explorer'}
              aria-label={explorerOpen ? 'Hide explorer' : 'Show explorer'}
              aria-pressed={explorerOpen}
              onClick={() => setExplorerOpen((value) => !value)}
            >
              <PanelLeft size={15} />
            </button>
          )}
          <EditorTabs onCloseTab={closeTab} />
          <div className="code-editor-actions">
            <button title="Save (Ctrl+S)" aria-label="Save file" disabled={!activeTab || !isDirty(activeTab)} onClick={() => activeTab && void save(activeTab.path)}><Save size={14} /></button>
            <button title="Save all (Ctrl+Shift+S)" aria-label="Save all files" disabled={!tabs.some(isDirty)} onClick={() => void saveAll()}><SaveAll size={14} /></button>
          </div>
        </div>
        )}

        {activeTab && <FileBar tab={activeTab} cursor={cursor} />}

        <div className="code-editor-body">
          {!activeTab ? (
            <EmptyEditor recent={recent} onOpen={(path) => void openFile(path)} onQuickOpen={() => setQuickOpen(true)} />
          ) : activeTab.status === 'loading' ? (
            <div className="code-editor-loading" aria-label="Opening file" />
          ) : activeTab.status === 'error' ? (
            <div className="code-editor-message">
              <ErrorNotice message={activeTab.errorMessage ?? 'This file could not be opened.'} onRetry={() => void openFile(activeTab.path)} />
            </div>
          ) : activeTab.binary ? (
            <div className="code-editor-message"><FileX2 size={28} /><p>This is a binary file and cannot be shown in the text editor.</p></div>
          ) : (
            <>
              {activeTab.incoming && (
                <ConflictBanner
                  reason={activeTab.incoming.reason}
                  deleted={activeTab.incoming.deleted}
                  onCompare={() => setComparing(activeTab.path)}
                  onReload={() => resolveIncoming(activeTab.path, 'reload')}
                  onKeep={() => resolveIncoming(activeTab.path, 'keep')}
                  onSave={() => void save(activeTab.path)}
                  onClose={() => forceCloseTab(activeTab.path)}
                />
              )}
              {!activeTab.incoming && activeTab.reloadedAt && <div className="code-reload-note">Reloaded with the latest version from disk.</div>}
              {activeTab.saveError && <div className="code-editor-message inline"><ErrorNotice message={activeTab.saveError.message} onRetry={() => void save(activeTab.path)} /></div>}
              {activeTab.readonly && <div className="code-readonly-note">Read-only file — changes cannot be saved.</div>}
              <Suspense fallback={<div className="code-editor-loading" aria-label="Loading editor" />}>
                <MonacoEditorPane
                  path={activeTab.path}
                  value={activeTab.content}
                  readOnly={activeTab.readonly}
                  onChange={(value) => setBuffer(activeTab.path, value)}
                  onSave={() => void save(activeTab.path)}
                  onSaveAll={() => void saveAll()}
                  onQuickOpen={() => setQuickOpen(true)}
                  onCloseTab={() => closeTab(activeTab.path)}
                  onCursor={(line, column) => setCursor({ line, column })}
                />
              </Suspense>
            </>
          )}
        </div>

      </div>

      {comparing && activeTab?.incoming && !activeTab.incoming.deleted && (
        <div className="code-diff-overlay">
          <div className="code-diff-head">
            <strong>Compare · {activeTab.name}</strong>
            <button onClick={() => setComparing(undefined)}>Close</button>
          </div>
          <Suspense fallback={<div className="code-editor-loading" aria-label="Loading comparison" />}>
            <DiffOverlay
              original={activeTab.incoming.content ?? ''}
              modified={activeTab.content}
              originalTitle="On disk (incoming)"
              modifiedTitle="Your buffer"
            />
          </Suspense>
        </div>
      )}

      {quickOpen && (
        <QuickOpen
          projectId={projectId}
          onOpen={(path) => void openFile(path)}
          onClose={() => setQuickOpen(false)}
        />
      )}
    </div>
  )
}

function ConflictBanner({ reason, deleted, onCompare, onReload, onKeep, onSave, onClose }: {
  reason: 'external' | 'conflict'
  deleted: boolean
  onCompare: () => void
  onReload: () => void
  onKeep: () => void
  onSave: () => void
  onClose: () => void
}) {
  if (deleted) {
    return (
      <div className="code-conflict is-danger" role="alert">
        <AlertTriangle size={15} />
        <span>This file was deleted on disk. Your unsaved buffer is preserved.</span>
        <div className="code-conflict-actions">
          <button onClick={onSave}>Save to recreate</button>
          <button onClick={onClose}>Close tab</button>
        </div>
      </div>
    )
  }
  return (
    <div className="code-conflict" role="alert">
      <AlertTriangle size={15} />
      <span>{reason === 'conflict' ? 'This file changed on disk since you opened it — the save was stopped to avoid overwriting it.' : 'This file changed on disk while you have unsaved edits.'}</span>
      <div className="code-conflict-actions">
        <button onClick={onCompare}>Compare changes</button>
        <button onClick={onReload}>Reload file</button>
        <button onClick={onKeep}>Keep my version</button>
      </div>
    </div>
  )
}

/** One thin row carrying the file's path and its buffer facts. This replaces the separate editor
 * status bar: workspace-level state belongs in the app's global status bar, so a second permanent
 * footer inside the surface was only costing vertical room. */
function FileBar({ tab, cursor }: { tab: EditorTab; cursor: { line: number; column: number } }) {
  const segments = tab.path.split('/')
  const ready = tab.status === 'ready' && !tab.binary
  return (
    <div className="code-filebar">
      <div className="code-breadcrumbs" aria-label="File path" title={tab.path}>
        {segments.map((segment, index) => (
          <span key={index}>
            {segment}
            {index < segments.length - 1 && <span className="code-breadcrumb-sep">›</span>}
          </span>
        ))}
      </div>
      {ready && (
        <div className="code-filebar-meta">
          {isDirty(tab) && <span className="code-status-flag">Unsaved</span>}
          {tab.readonly && <span className="code-status-flag">Read-only</span>}
          <span>Ln {cursor.line}, Col {cursor.column}</span>
          <span>{lineEndingLabel(tab.lineEnding)}</span>
          <span>{encodingLabel(tab.encoding)}</span>
        </div>
      )}
    </div>
  )
}

/** Quiet but useful: the two ways in, plus the files this workspace actually touched. Deliberately
 * not a welcome dashboard — the editor is a work surface, not a landing page. */
function EmptyEditor({ recent, onOpen, onQuickOpen }: { recent: string[]; onOpen: (path: string) => void; onQuickOpen: () => void }) {
  return (
    <div className="code-editor-empty">
      <div className="code-empty-actions">
        <span className="code-empty-hint">Select a file in the Explorer</span>
        <button type="button" className="code-empty-quickopen" onClick={onQuickOpen}>
          <Search size={13} aria-hidden />
          Quick Open
          <kbd>Ctrl</kbd><kbd>P</kbd>
        </button>
      </div>
      {recent.length > 0 && (
        <div className="code-empty-recent">
          <span className="code-empty-label">Recently opened</span>
          {recent.slice(0, 5).map((path) => (
            <button key={path} type="button" title={path} onClick={() => onOpen(path)}>
              <span className="code-empty-recent-name">{baseName(path)}</span>
              <span className="code-empty-recent-path">{path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function lineEndingLabel(ending: string): string {
  switch (ending) {
    case 'crlf': return 'CRLF'
    case 'lf': return 'LF'
    case 'mixed': return 'Mixed EOL'
    default: return '—'
  }
}

function encodingLabel(encoding: string): string {
  switch (encoding) {
    case 'utf8_bom': return 'UTF-8 BOM'
    case 'utf8': return 'UTF-8'
    default: return encoding
  }
}
