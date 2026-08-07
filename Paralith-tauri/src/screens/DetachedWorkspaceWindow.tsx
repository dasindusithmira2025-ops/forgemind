import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { CircleStop, RotateCcw, PictureInPicture2 } from 'lucide-react'
import { asNativeError, native } from '../native/commands'
import type { PaneAssignment, Project, Workspace } from '../native/types'
import { useAppStore } from '../stores/appStore'
import { terminalRuntime, useWorkspaceSessions } from '../features/terminals/runtimeStore'
import { applyPaneRename } from '../features/terminals/paneRename'
import { onPaneRenamed } from '../native/events'
import { AppShell } from '../components/shell/AppShell'
import { AiUsageStatusBar } from '../features/usage/AiUsageStatusBar'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { TerminalPane } from '../components/terminal/TerminalPane'
import { PaneMenu, type PaneMenuState } from '../components/terminal/PaneMenu'
import { dispatchTerminalAction, type TerminalAction } from '../components/terminal/terminalActions'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { WorkspaceCanvas, type RenderPaneContext } from '../features/workspace-canvas/components/WorkspaceCanvas'
import { useCanvasStore } from '../features/workspace-canvas/canvasStore'
import { buildFromPersisted } from '../features/workspace-canvas/canvasPersistence'
import type { WorkspaceCanvasLayout } from '../features/workspace-canvas/canvasTypes'
import { workspaceLayoutCommands, toSaveRequest } from '../native/workspaceLayoutCommands'

/**
 * The compact single-Workspace shell shown inside a DETACHED native window (label `ws-<id>`).
 * It reuses the exact same {@link WorkspaceCanvas} + {@link TerminalPane} as the main window so
 * the live terminals/xterm never remount during a handoff — the PTYs stay alive in Rust and
 * this renderer merely re-subscribes from live sessions and claims the interactive lease.
 *
 * It intentionally contains no Project launcher, no global sidebar, and no second backend —
 * just a title bar (Project + Workspace), the canvas, a minimal Workspace menu, and a status
 * bar. See the detached-workspace capability (narrow ACL) in src-tauri/capabilities.
 */
export function DetachedWorkspaceWindow({ workspaceId }: { workspaceId: string }) {
  const settings = useAppStore((state) => state.settings)
  const activePaneId = useAppStore((state) => state.activePaneId)
  const setActivePane = useAppStore((state) => state.setActivePane)
  const sessions = useWorkspaceSessions(workspaceId)
  const [workspace, setWorkspace] = useState<Workspace>()
  const [project, setProject] = useState<Project>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paneErrors, setPaneErrors] = useState<Record<string, string>>({})
  const [paneMenu, setPaneMenu] = useState<PaneMenuState>()
  const [renameTarget, setRenameTarget] = useState<{ paneId: string; initialValue: string }>()
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches))
  const canvasSaveChain = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loadedWorkspace = await native.getWorkspace(workspaceId)
        const loadedProject = await native.getProject(loadedWorkspace.projectId)
        if (!live) return
        setWorkspace(loadedWorkspace)
        setProject(loadedProject)
        // Seed the docking canvas from persisted layout, exactly like the main window.
        const canvasRecord = await workspaceLayoutCommands
          .getCanvasLayout(loadedWorkspace.id)
          .catch(() => ({ revision: 0, canvasJson: null }))
        if (!live) return
        useCanvasStore.getState().init(loadedWorkspace.id, buildFromPersisted(loadedWorkspace, canvasRecord.canvasJson), canvasRecord.revision)
        // Re-subscribe to the still-running Terminal Sessions — PTYs were never stopped.
        const liveSessions = await native.listLiveSessions(loadedWorkspace.id)
        if (!live) return
        if (liveSessions.length > 0) terminalRuntime.hydrate(liveSessions)
        setActivePane(loadedWorkspace.activePaneId ?? loadedWorkspace.panes[0]?.id)
        // This is the atomic cut-over point. Until now this native window was hidden and the
        // old renderer retained input ownership. Rust now transfers the lease and reveals us.
        await native.completeWorkspaceHandoff(loadedWorkspace.id)
      } catch (caught) {
        const rolledBack=await native.failWorkspaceHandoff(workspaceId).then(()=>true).catch(()=>false)
        if(!rolledBack)await getCurrentWindow().show().catch(()=>undefined)
        if (live) setError(asNativeError(caught).message)
      } finally {
        if (live) setLoading(false)
      }
    })()
    return () => {
      live = false
    }
  }, [workspaceId, setActivePane])

  // A task submitted to an agent Pane retitles that Pane. Rust persists the title and emits the
  // rename to this window's label as well as the main one, so a detached Workspace shows the new
  // header without owning the write.
  useEffect(() => {
    let live = true
    const pending = onPaneRenamed((event) => {
      if (!live || event.workspaceId !== workspaceId) return
      setWorkspace((current) => applyPaneRename(current, event))
    })
    return () => {
      live = false
      void pending.then((unlisten) => unlisten()).catch(() => undefined)
    }
  }, [workspaceId])

  // Re-claim the lease whenever this window regains focus, so input ownership follows the
  // window the user is actually interacting with.
  useEffect(() => {
    const reclaim = () => void native.claimWorkspaceLease(workspaceId).catch(() => undefined)
    window.addEventListener('focus', reclaim)
    return () => window.removeEventListener('focus', reclaim)
  }, [workspaceId])

  const persistCanvas = useCallback((next: WorkspaceCanvasLayout, previous: WorkspaceCanvasLayout) => {
    const store = useCanvasStore.getState()
    if (!store.workspaceId) return
    const targetWorkspaceId = store.workspaceId
    setActivePane(next.activePaneId)
    canvasSaveChain.current = canvasSaveChain.current.then(async () => {
      const current = useCanvasStore.getState()
      if (current.workspaceId !== targetWorkspaceId) return
      const result = await workspaceLayoutCommands.saveCanvasLayout(
        toSaveRequest(targetWorkspaceId, current.revision, next),
      )
      if (useCanvasStore.getState().workspaceId === targetWorkspaceId) {
        useCanvasStore.getState().setRevision(result.revision)
      }
    }).catch((caught) => {
      const current = useCanvasStore.getState()
      if (current.workspaceId !== targetWorkspaceId) return
      if (current.layout === next) current.setLayout(previous)
      setError(asNativeError(caught).message)
    })
  }, [setActivePane])

  const paneSession = useCallback((paneId: string) => sessions.find((session) => session.paneId === paneId), [sessions])

  const restartPane = useCallback(async (paneId: string, assignment: PaneAssignment) => {
    const session = paneSession(paneId)
    if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
    if (session) terminalRuntime.remove(session.id)
    setPaneErrors((current) => ({ ...current, [paneId]: '' }))
    try {
      const created = await native.createTerminalSession({ workspaceId, paneId: assignment.id, cols: 80, rows: 24 })
      terminalRuntime.upsert(created)
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message }))
    }
  }, [paneSession, workspaceId])

  const stopPane = useCallback(async (paneId: string) => {
    const session = paneSession(paneId)
    if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
  }, [paneSession])

  // Rename persists only the pane title on the Workspace record; the canvas layout references
  // panes by id, so it needs no resync. Updating local state re-renders the pane header title.
  const confirmRename = useCallback(async (value: string) => {
    const target = renameTarget
    setRenameTarget(undefined)
    if (!target || !workspace || value === target.initialValue) return
    const panes = workspace.panes.map((pane) => pane.id === target.paneId ? { ...pane, title: value } : pane)
    try {
      const saved = await native.saveWorkspace({ id: workspace.id, projectId: workspace.projectId, name: workspace.name, layout: workspace.layout, activePaneId: workspace.activePaneId, restoreBehavior: workspace.restoreBehavior, panes })
      setWorkspace(saved)
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [target.paneId]: asNativeError(caught).message }))
    }
  }, [renameTarget, workspace])

  // The native window's close button (the [x], Alt+F4, OS chrome) must not silently kill the
  // running terminals. We intercept the close request and ask what to do. `closeGuard` lets the
  // chosen action actually close the window: the backend calls that close the window would
  // otherwise re-trigger this handler and loop.
  const closeGuard = useRef(false)
  const [closePolicyOpen, setClosePolicyOpen] = useState(false)
  const [closeBusy, setCloseBusy] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    const unlisten = win.onCloseRequested((event) => {
      if (closeGuard.current) return // a policy action is deliberately closing the window
      event.preventDefault()
      setClosePolicyOpen(true)
    })
    return () => {
      void unlisten.then((stop) => stop()).catch(() => undefined)
    }
  }, [])

  useEffect(()=>{
    const win=getCurrentWindow();let timer:number|undefined
    const persist=()=>{if(timer)window.clearTimeout(timer);timer=window.setTimeout(()=>void native.persistWorkspaceWindowGeometry(workspaceId).catch(()=>undefined),300)}
    const listeners=Promise.all([win.onMoved(persist),win.onResized(persist)])
    return()=>{if(timer)window.clearTimeout(timer);void listeners.then((items)=>items.forEach((stop)=>stop())).catch(()=>undefined)}
  },[workspaceId])

  // Run a close-policy choice. Any error re-arms the guard so the window stays open and the
  // user can retry rather than being stranded with a half-closed window.
  const runClosePolicy = useCallback(
    async (action: () => Promise<void>) => {
      setCloseBusy(true)
      closeGuard.current = true
      try {
        await action()
        // The backend (attach / close) closes this window; nothing more to do here.
      } catch (caught) {
        closeGuard.current = false
        setCloseBusy(false)
        setClosePolicyOpen(false)
        setError(asNativeError(caught).message)
      }
    },
    [],
  )

  const attachToMain = useCallback(
    () => runClosePolicy(() => native.attachWorkspace(workspaceId).then(() => undefined)),
    [runClosePolicy, workspaceId],
  )
  const keepRunningInBackground = useCallback(
    () => runClosePolicy(() => native.closeWorkspaceWindow(workspaceId)),
    [runClosePolicy, workspaceId],
  )
  const stopTerminalsAndClose = useCallback(
    () =>
      runClosePolicy(async () => {
        await native.terminateWorkspaceSessions(workspaceId).catch(() => undefined)
        await native.closeWorkspaceWindow(workspaceId)
      }),
    [runClosePolicy, workspaceId],
  )

  const renderPane = useCallback((paneId: string, ctx: RenderPaneContext) => {
    const assignment = workspace?.panes.find((pane) => pane.id === paneId)
    if (!assignment) return <div className="terminal-failure"><ErrorNotice message="This layout pane has no saved assignment." /></div>
    const session = sessions.find((item) => item.paneId === paneId)
    return <>
      <TerminalPane assignment={assignment} session={session} active={ctx.active} maximized={ctx.maximized} settings={settings}
        onFocus={() => setActivePane(paneId)}
        onMaximize={() => useCanvasStore.getState().toggleMaximize(paneId)}
        onClose={() => void stopPane(paneId)}
        onRestart={() => void restartPane(paneId, assignment)}
        onStop={() => void stopPane(paneId)}
        onMenu={(anchor) => { const rect = anchor.getBoundingClientRect(); setPaneMenu({ paneId, x: Math.min(rect.left, window.innerWidth - 230), y: rect.bottom + 4 }) }}
        onHeaderPointerDown={ctx.onHeaderPointerDown} />
      {paneErrors[paneId] && <div className="pane-native-error"><ErrorNotice message={paneErrors[paneId]} onRetry={() => void restartPane(paneId, assignment)} /></div>}
    </>
  }, [workspace, sessions, settings, paneErrors, setActivePane, stopPane, restartPane])

  if (loading) return <div className="workspace-loading"><div className="workspace-loading-header" /><div className="workspace-loading-grid" /></div>
  if (!workspace || !project) return <main className="centered-error"><ErrorNotice message={error || 'The workspace could not be loaded.'} /></main>

  const running = sessions.filter((session) => session.status === 'running').length
  const activePane = workspace.panes.find((pane) => pane.id === activePaneId)

  return <AppShell className="workspace-shell detached-shell" sidebarOpen={false}
    titleBar={<>
      <div className="workspace-heading"><strong>{workspace.name}</strong><span className="branch-label">{project.name}</span></div>
      <div className="titlebar-spacer" />
      <span className="compact-count">{running}/{workspace.panes.length} running</span>
      <Button variant="ghost" icon={<PictureInPicture2 size={14} />} onClick={() => void attachToMain()}>Attach to main window</Button>
    </>}
    canvas={<>{error && <div className="workspace-error"><ErrorNotice message={error} /></div>}<section className="terminal-canvas"><WorkspaceCanvas reducedMotion={reducedMotion} persist={persistCanvas} onFocusPane={setActivePane} renderPane={renderPane} /></section></>}
    statusBar={<>
      <span>{project.gitBranch || 'No branch'}</span>
      <span className="status-path" title={project.rootPath}>{project.name}</span>
      <span>{running}/{workspace.panes.length} running</span>
      <span>{activePane?.title || 'No active pane'}</span>
      <AiUsageStatusBar />
      <button className="status-inline-action" onClick={() => void native.terminateWorkspaceSessions(workspaceId).catch(() => undefined)}><CircleStop size={12} />Stop all</button>
      <button className="status-inline-action" onClick={() => workspace.panes.forEach((pane) => void restartPane(pane.id, pane))}><RotateCcw size={12} />Restart all</button>
    </>}
  >
    {closePolicyOpen && (
      <Modal title="Close this workspace window?" onClose={() => { if (!closeBusy) setClosePolicyOpen(false) }}>
        <div className="close-policy">
          <p className="close-policy-lead">
            <strong>{workspace.name}</strong> has {running} running terminal{running === 1 ? '' : 's'}. Choose what happens to them.
          </p>
          <div className="close-policy-actions">
            <button className="close-policy-option" disabled={closeBusy} onClick={() => void attachToMain()}>
              <strong>Attach to main window</strong>
              <span>Move this workspace back into the main PARALITH window. Terminals keep running.</span>
            </button>
            <button className="close-policy-option" disabled={closeBusy} onClick={() => void keepRunningInBackground()}>
              <strong>Keep running in background</strong>
              <span>Close this window but leave the terminals running. Reopen it later from the sidebar.</span>
            </button>
            <button className="close-policy-option danger" disabled={closeBusy} onClick={() => void stopTerminalsAndClose()}>
              <strong>Stop terminals and close</strong>
              <span>End every process in this workspace, then close the window.</span>
            </button>
            <button className="close-policy-option ghost" disabled={closeBusy} onClick={() => setClosePolicyOpen(false)}>
              <strong>Cancel</strong>
              <span>Keep this window open.</span>
            </button>
          </div>
        </div>
      </Modal>
    )}
    {paneMenu && <PaneMenu menu={paneMenu} compact onClose={() => setPaneMenu(undefined)} onAction={(action) => {
      const paneId = paneMenu.paneId
      setPaneMenu(undefined)
      const assignment = workspace.panes.find((pane) => pane.id === paneId)
      if (action === 'focus') { setActivePane(paneId); dispatchTerminalAction(paneId, 'focus'); return }
      if (action === 'rename') { if (assignment) setRenameTarget({ paneId, initialValue: assignment.title }); return }
      if (action === 'restart') { if (assignment) void restartPane(paneId, assignment); return }
      if (action === 'stop') { void stopPane(paneId); return }
      if (['search', 'copy', 'paste', 'select_all', 'clear'].includes(action)) dispatchTerminalAction(paneId, action as TerminalAction)
    }} />}
    {renameTarget && <TextPromptDialog title="Rename terminal" label="Terminal title" initialValue={renameTarget.initialValue} confirmLabel="Rename" onClose={() => setRenameTarget(undefined)} onConfirm={(value) => void confirmRename(value)} />}
  </AppShell>
}
