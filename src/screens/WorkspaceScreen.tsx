import { useCallback, useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Group, Panel, Separator, type Layout as PanelLayout } from 'react-resizable-panels'
import { ChevronDown, CircleStop, Copy, FolderOpen, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, RotateCcw, Search, SplitSquareHorizontal, SplitSquareVertical, TerminalSquare, Trash2 } from 'lucide-react'
import { TerminalPane } from '../components/terminal/TerminalPane'
import { dispatchTerminalAction } from '../components/terminal/terminalActions'
import { Brand } from '../components/ui/Brand'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Modal } from '../components/ui/Modal'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import { onTerminalExit } from '../native/events'
import type { AgentProvider, LayoutNode, PaneAssignment, Project, ShellProfile, SplitDirection, TerminalSession, Workspace } from '../native/types'
import { newId, paneIds, providerLabel } from '../shared/layout'
import { useAppStore } from '../stores/appStore'

type ProviderChoice = { provider: AgentProvider; name: string; executablePath: string; args: string[]; shellProfileId?: string }
type PendingInsert = { targetPaneId: string; direction: SplitDirection; replace?: boolean; duplicate?: PaneAssignment }

export function WorkspaceScreen() {
  const { workspaceId = '' } = useParams()
  const [searchParams] = useSearchParams()
  // "Open with fresh terminals" reuses the same saved Workspace but forces new sessions.
  const forceFresh = searchParams.get('fresh') === '1'
  const navigate = useNavigate()
  const storedWorkspace = useAppStore((state) => state.workspace)
  const storedProject = useAppStore((state) => state.project)
  const sessions = useAppStore((state) => state.sessions)
  const settings = useAppStore((state) => state.settings)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setProject = useAppStore((state) => state.setProject)
  const setDetections = useAppStore((state) => state.setDetections)
  const setShells = useAppStore((state) => state.setShells)
  const upsertSession = useAppStore((state) => state.upsertSession)
  const markSessionExited = useAppStore((state) => state.markSessionExited)
  const removeSession = useAppStore((state) => state.removeSession)
  const clearSessions = useAppStore((state) => state.clearSessions)
  const activePaneId = useAppStore((state) => state.activePaneId)
  const setActivePane = useAppStore((state) => state.setActivePane)
  const setSettings = useAppStore((state) => state.setSettings)
  const recentWorkspaces = useAppStore((state) => state.recentWorkspaces)
  const setRecentWorkspaces = useAppStore((state) => state.setRecentWorkspaces)
  const [workspace, setLocalWorkspace] = useState<Workspace | undefined>(storedWorkspace?.id === workspaceId ? storedWorkspace : undefined)
  const [project, setLocalProject] = useState<Project | undefined>(storedProject)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paneErrors, setPaneErrors] = useState<Record<string, string>>({})
  const [sidebarOpen, setSidebarOpen] = useState(settings.sidebarOpen)
  const [sidebarSaving, setSidebarSaving] = useState(false)
  const [maximizedPaneId, setMaximizedPaneId] = useState<string>()
  const [workspaceMenu, setWorkspaceMenu] = useState(false)
  const [paneMenu, setPaneMenu] = useState<{ paneId: string; x: number; y: number }>()
  const [pendingInsert, setPendingInsert] = useState<PendingInsert>()
  const [renameTarget, setRenameTarget] = useState<{ kind: 'workspace' | 'pane'; paneId?: string; initialValue: string }>()
  const [choices, setChoices] = useState<ProviderChoice[]>([])
  const [workspaceRunning, setWorkspaceRunning] = useState<Record<string, number>>({})
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string>()
  const [refreshingWorkspaces, setRefreshingWorkspaces] = useState(false)
  const launchGeneration = useRef(0)

  const paneSession = useCallback((paneId: string) => Object.values(sessions).find((session) => session.paneId === paneId), [sessions])

  const scanProviders = useCallback(async () => {
    const customPaths = [
      settings.claudeExecutablePath && { provider: 'claude', path: settings.claudeExecutablePath },
      settings.codexExecutablePath && { provider: 'codex', path: settings.codexExecutablePath },
      settings.opencodeExecutablePath && { provider: 'opencode', path: settings.opencodeExecutablePath },
    ].filter((item): item is { provider: string; path: string } => Boolean(item))
    const [detections, shells] = await Promise.all([native.detectAgents(false, customPaths), native.detectShells()])
    setDetections(detections); setShells(shells)
    const ready: ProviderChoice[] = [
      ...detections.filter((item) => item.available && item.executablePath).map((item) => ({ provider: item.provider, name: providerLabel(item.provider), executablePath: item.executablePath!, args: [] })),
      ...shells.map((shell) => shellChoice(shell)),
    ]
    setChoices(ready)
    return ready
  }, [setDetections, setShells, settings.claudeExecutablePath, settings.codexExecutablePath, settings.opencodeExecutablePath])

  const launchPane = useCallback(async (assignment: PaneAssignment, currentWorkspace: Workspace) => {
    setPaneErrors((current) => ({ ...current, [assignment.id]: '' }))
    try {
      const session = await native.createTerminalSession({ workspaceId: currentWorkspace.id, paneId: assignment.id, provider: assignment.provider, title: assignment.title, executablePath: assignment.executablePath, args: assignment.args, workingDirectory: assignment.workingDirectory, cols: 80, rows: 24 })
      upsertSession(session)
      return session
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [assignment.id]: asNativeError(caught).message }))
      return undefined
    }
  }, [upsertSession])

  const launchAll = useCallback(async (currentWorkspace: Workspace) => {
    const generation = ++launchGeneration.current
    clearSessions()
    const results = await Promise.all(currentWorkspace.panes.map((pane) => launchPane(pane, currentWorkspace)))
    if (generation === launchGeneration.current && results.every((result) => !result)) setError('No terminal session could be started. Reconfigure unavailable executables and try again.')
    setActivePane(currentWorkspace.activePaneId ?? currentWorkspace.panes[0]?.id)
  }, [clearSessions, launchPane, setActivePane])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loadedWorkspace = storedWorkspace?.id === workspaceId ? storedWorkspace : await native.getWorkspace(workspaceId)
        const loadedProject = project?.id === loadedWorkspace.projectId ? project : await native.getProject(loadedWorkspace.projectId)
        if (!live) return
        setLocalWorkspace(loadedWorkspace); setWorkspace(loadedWorkspace)
        setLocalProject(loadedProject); setProject(loadedProject)
        await scanProviders()
        if (!live) return
        if (forceFresh) {
          // Reuse the saved configuration but start brand-new Terminal Sessions.
          await native.terminateWorkspaceSessions(loadedWorkspace.id).catch(() => undefined)
        } else {
          const liveSessions = await native.listLiveSessions(loadedWorkspace.id)
          if (liveSessions.length > 0) {
            clearSessions()
            for (const session of liveSessions) upsertSession(session)
            setActivePane(loadedWorkspace.activePaneId ?? loadedWorkspace.panes[0]?.id)
            return
          }
        }
        await launchAll(loadedWorkspace)
      } catch (caught) { if (live) setError(asNativeError(caught).message) }
      finally { if (live) { setLoading(false); setSwitchingWorkspaceId(undefined) } }
    })()
    return () => { live = false }
    // Workspace identity controls hydration. Actions update local state directly.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    let unsubscribe: (() => void) | undefined
    void onTerminalExit((event) => markSessionExited(event.sessionId, event.exitCode)).then((fn) => {
      if (cancelled) fn()
      else unsubscribe = fn
    })
    return () => { cancelled = true; unsubscribe?.() }
  }, [markSessionExited])

  useEffect(() => { setSidebarOpen(settings.sidebarOpen) }, [settings.sidebarOpen])

  const toggleSidebar = async () => {
    if (sidebarSaving) return
    setSidebarSaving(true)
    const previous = sidebarOpen
    const nextSettings = { ...settings, sidebarOpen: !previous }
    setSidebarOpen(!previous)
    setSettings(nextSettings)
    try {
      setSettings(await native.saveSettings(nextSettings))
      setSidebarSaving(false)
    } catch (caught) {
      setSidebarOpen(previous)
      setSettings(settings)
      setSidebarSaving(false)
      setError(asNativeError(caught).message)
    }
  }

  const refreshWorkspaces = useCallback(async () => {
    setRefreshingWorkspaces(true)
    try {
      const [recent, liveSessions] = await Promise.all([
        native.listRecentWorkspaces(),
        native.listLiveSessions(),
      ])
      setRecentWorkspaces(recent)
      setWorkspaceRunning(liveSessions.reduce<Record<string, number>>((counts, session) => {
        if (session.status === 'running') counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1
        return counts
      }, {}))
    } catch (caught) {
      setError(asNativeError(caught).message)
    } finally {
      setRefreshingWorkspaces(false)
    }
  }, [setRecentWorkspaces])

  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces, workspaceId])

  const persist = useCallback(async (next: Workspace) => {
    const saved = await native.saveWorkspace({
      id: next.id,
      projectId: next.projectId,
      name: next.name,
      layout: next.layout,
      activePaneId: next.activePaneId,
      panes: next.panes,
    })
    setLocalWorkspace(saved); setWorkspace(saved)
    void refreshWorkspaces()
    return saved
  }, [refreshWorkspaces, setWorkspace])

  const updateLayoutSizes = (path: number[], panelLayout: PanelLayout) => {
    if (!workspace) return
    const next = { ...workspace, layout: setSizesAtPath(workspace.layout, path, Object.values(panelLayout)), updatedAt: new Date().toISOString() }
    setLocalWorkspace(next); setWorkspace(next)
    void persist(next).catch((caught) => setError(asNativeError(caught).message))
  }

  const stopPane = async (paneId: string) => {
    const session = paneSession(paneId)
    if (!session || session.status !== 'running') return
    try { await native.terminateTerminalSession(session.id) } catch (caught) { setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message })) }
  }

  const restartPane = async (paneId: string) => {
    if (!workspace) return
    const assignment = workspace.panes.find((pane) => pane.id === paneId)
    if (!assignment) return
    const session = paneSession(paneId)
    if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
    if (session) removeSession(session.id)
    await launchPane(assignment, workspace)
  }

  const closePane = async (paneId: string) => {
    if (!workspace || workspace.panes.length <= 1) { setPaneErrors((current) => ({ ...current, [paneId]: 'At least one terminal pane must remain.' })); return }
    const session = paneSession(paneId)
    if (session?.status === 'running' && settings.confirmClosePane && !window.confirm('Stop the running process and close this pane?')) return
    if (session?.status === 'running') await native.terminateTerminalSession(session.id)
    if (session) removeSession(session.id)
    try {
      const layout = await native.removeLayoutPane(workspace.layout, paneId)
      const panes = workspace.panes.filter((pane) => pane.id !== paneId).map((pane, index) => ({ ...pane, positionOrder: index }))
      const active = workspace.activePaneId === paneId ? panes[0]?.id : workspace.activePaneId
      await persist({ ...workspace, layout, panes, activePaneId: active })
      setActivePane(active); if (maximizedPaneId === paneId) setMaximizedPaneId(undefined)
    } catch (caught) { setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message })) }
  }

  const renamePane = async (paneId: string) => {
    if (!workspace) return
    const pane = workspace.panes.find((item) => item.id === paneId)
    if (pane) setRenameTarget({ kind: 'pane', paneId, initialValue: pane.title })
  }

  const renameWorkspace = async () => {
    if (!workspace) return
    setRenameTarget({ kind: 'workspace', initialValue: workspace.name })
  }

  const confirmRename = async (value: string) => {
    const target = renameTarget
    setRenameTarget(undefined)
    if (!workspace || !target || value === target.initialValue) return
    if (target.kind === 'workspace') await persist({ ...workspace, name: value })
    else await persist({ ...workspace, panes: workspace.panes.map((item) => item.id === target.paneId ? { ...item, title: value } : item) })
  }

  const changeDirectory = async (paneId: string) => {
    if (!workspace || !project) return
    const selected = await open({ directory: true, multiple: false, defaultPath: project.rootPath, title: 'Change terminal working directory' })
    if (!selected || Array.isArray(selected)) return
    try {
      const directory = await native.validateWorkingDirectory(project.rootPath, selected, false)
      const next = await persist({ ...workspace, panes: workspace.panes.map((pane) => pane.id === paneId ? { ...pane, workingDirectory: directory } : pane) })
      await restartPaneFromWorkspace(paneId, next)
    } catch (caught) { setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message })) }
  }

  const restartPaneFromWorkspace = async (paneId: string, source: Workspace) => {
    const session = paneSession(paneId)
    if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
    if (session) removeSession(session.id)
    const pane = source.panes.find((item) => item.id === paneId)
    if (pane) await launchPane(pane, source)
  }

  const insertOrReplace = async (choice: ProviderChoice) => {
    if (!workspace || !pendingInsert || !project) return
    const target = workspace.panes.find((pane) => pane.id === pendingInsert.targetPaneId)
    if (!target) return
    if (pendingInsert.replace) {
      const session = paneSession(target.id)
      if (session?.status === 'running' && !window.confirm('Replace this terminal? The current process will stop.')) return
      if (session?.status === 'running') await native.terminateTerminalSession(session.id)
      if (session) removeSession(session.id)
      const pane = { ...target, provider: choice.provider, title: choice.name, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId }
      const next = await persist({ ...workspace, panes: workspace.panes.map((item) => item.id === pane.id ? pane : item) })
      setPendingInsert(undefined); await launchPane(pane, next); return
    }
    const newPaneId = newId()
    const layout = await native.splitLayoutPane(workspace.layout, target.id, pendingInsert.direction, newPaneId)
    const source = pendingInsert.duplicate
    const pane: PaneAssignment = source ? { ...source, id: newPaneId, workspaceId: workspace.id, title: `${source.title} copy`, positionOrder: workspace.panes.length } : { id: newPaneId, workspaceId: workspace.id, title: choice.name, provider: choice.provider, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId, workingDirectory: target.workingDirectory || project.rootPath, positionOrder: workspace.panes.length }
    const next = await persist({ ...workspace, layout, panes: [...workspace.panes, pane], activePaneId: newPaneId })
    setPendingInsert(undefined); setActivePane(newPaneId); await launchPane(pane, next)
  }

  const stopAll = async () => { if (workspace) await native.terminateWorkspaceSessions(workspace.id); clearSessions() }
  const restartAll = async () => { if (!workspace) return; await native.terminateWorkspaceSessions(workspace.id).catch(() => undefined); await launchAll(workspace) }
  const openLauncher = () => { navigate('/'); setWorkspaceMenu(false) }
  const closeWorkspace = async () => {
    await stopAll(); setWorkspace(undefined); setProject(undefined); navigate('/')
  }

  // Reconfigure edits THIS workspace in place (same id). If terminals are live, we stop
  // them first rather than silently mutating pane configuration under running processes.
  const reconfigureWorkspace = () => {
    if (!workspace || !project) return
    const anyRunning = Object.values(sessions).some((session) => session.status === 'running')
    if (anyRunning && !window.confirm('This workspace has running terminals. Stop them and reconfigure?')) return
    setWorkspaceMenu(false)
    if (anyRunning) void stopAll()
    navigate(`/setup/${project.id}?workspaceId=${workspace.id}`)
  }

  const switchWorkspace = (nextWorkspaceId: string) => {
    if (nextWorkspaceId === workspace?.id || switchingWorkspaceId) return
    setSwitchingWorkspaceId(nextWorkspaceId)
    setError('')
    setWorkspaceMenu(false)
    navigate(`/workspace/${nextWorkspaceId}`)
  }

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!workspace || !activePaneId) return
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); dispatchTerminalAction(activePaneId, 'search') }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'vertical' }) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Backslash') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'vertical' }) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Minus') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'horizontal' }) }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'w') { event.preventDefault(); void closePane(activePaneId) }
      if (event.ctrlKey && event.shiftKey && event.key === 'Enter') { event.preventDefault(); setMaximizedPaneId((value) => value === activePaneId ? undefined : activePaneId) }
      if (event.ctrlKey && event.key === ',') { event.preventDefault(); navigate('/settings') }
      if (event.ctrlKey && (event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault(); const ids = paneIds(workspace.layout); const index = ids.indexOf(activePaneId); const delta = event.key === 'PageDown' ? 1 : -1; setActivePane(ids[(index + delta + ids.length) % ids.length]);
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  // closePane reads current state and is intentionally rebound with the other workspace values.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaneId, navigate, setActivePane, workspace])

  if (loading) return <div className="workspace-loading"><div className="workspace-loading-header" /><div className="workspace-loading-sidebar" /><div className="workspace-loading-grid" /></div>
  if (!workspace || !project) return <main className="centered-error"><ErrorNotice message={error || 'The workspace could not be loaded.'} /><Button onClick={() => navigate('/')}>Return to launcher</Button></main>
  const running = Object.values(sessions).filter((session) => session.status === 'running').length
  const agentRunning = Object.values(sessions).filter((session) => session.status === 'running' && ['claude', 'codex', 'opencode'].includes(session.provider)).length

  return <main className={`workspace-shell ${sidebarOpen ? '' : 'sidebar-collapsed'} ${switchingWorkspaceId ? 'workspace-switching' : ''}`}>
    <header className="workspace-header"><Button variant="ghost" icon={sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />} aria-label="Toggle sidebar" disabled={sidebarSaving} onClick={() => void toggleSidebar()} /><Brand compact /><div className="workspace-heading"><strong>{project.name}</strong><span>/</span><span>{workspace.name}</span></div>{project.gitBranch && <span className="branch-label">{project.gitBranch}</span>}<div className="workspace-header-stats"><span>{workspace.panes.length} terminals</span><span>{agentRunning} agents running</span></div><div className="workspace-menu-wrap"><Button variant="ghost" icon={<ChevronDown size={14} />} aria-expanded={workspaceMenu} aria-haspopup="menu" onClick={() => setWorkspaceMenu((value) => !value)}>Workspace</Button>{workspaceMenu && <><button className="context-scrim" aria-label="Close workspace menu" onClick={() => setWorkspaceMenu(false)} /><div className="context-popover workspace-popover" role="menu"><button role="menuitem" onClick={() => { setWorkspaceMenu(false); void renameWorkspace() }}>Rename workspace</button><button role="menuitem" onClick={reconfigureWorkspace}>Reconfigure workspace</button><button role="menuitem" onClick={() => navigate(`/setup/${project.id}`)}>New workspace for this project</button><button role="menuitem" onClick={() => void restartAll()}><RotateCcw size={14} />Restart all terminals</button><button role="menuitem" onClick={() => void stopAll()}><CircleStop size={14} />Stop all terminals</button><button role="menuitem" onClick={openLauncher}><FolderOpen size={14} />Back to projects</button><button role="menuitem" className="danger-item" onClick={() => void closeWorkspace()}>Close workspace</button></div></>}</div></header>
    {error && <div className="workspace-error"><ErrorNotice message={error} onRetry={() => void restartAll()} /></div>}
    <div className="workspace-body">
      {sidebarOpen && <aside className="workspace-sidebar"><div className="sidebar-content"><div className="ws-switcher"><div className="ws-switcher-head"><span className="section-label">Workspaces</span><button aria-label="Refresh workspaces" title="Refresh workspaces" disabled={refreshingWorkspaces} onClick={() => void refreshWorkspaces()}><RefreshCw className={refreshingWorkspaces ? 'is-spinning' : ''} size={13} /></button></div><div className="ws-list">{recentWorkspaces.map((item) => {
        const current = item.workspace.id === workspace.id
        const liveCount = current ? running : (workspaceRunning[item.workspace.id] ?? 0)
        return <div className={`ws-item ${current ? 'current' : ''} ${item.projectMissing ? 'missing' : ''}`} key={item.workspace.id}>
          <button className="ws-item-main" aria-current={current ? 'page' : undefined} aria-label={current ? `${item.workspace.name}, current workspace` : `Open ${item.workspace.name}`} disabled={current || item.projectMissing || Boolean(switchingWorkspaceId)} title={item.projectMissing ? `${item.projectPath} is unavailable` : `Open ${item.workspace.name}`} onClick={() => switchWorkspace(item.workspace.id)}>
            <span className={`ws-dot ${liveCount > 0 ? 'live' : ''}`} />
            <span className="ws-item-copy"><span className="ws-name">{item.workspace.name}</span><span className="ws-project-name">{item.projectName}</span></span>
          </button>
          {liveCount > 0 && <span className={`ws-badge ${current ? 'accent' : ''}`} title={`${liveCount} running`}>{liveCount}</span>}
        </div>
      })}</div>{recentWorkspaces.length === 0 && <p className="ws-empty">Your created workspaces will appear here.</p>}</div></div><Button className="new-workspace-button" variant="primary" icon={<Plus size={15} />} onClick={() => navigate(`/setup/${project.id}`)}>New workspace</Button></aside>}
      <section className="terminal-canvas"><RecursiveLayout node={workspace.layout} path={[]} workspace={workspace} sessions={sessions} activePaneId={activePaneId} maximizedPaneId={maximizedPaneId} settings={settings} paneErrors={paneErrors} onFocus={(paneId) => { setActivePane(paneId); if (workspace.activePaneId !== paneId) { const next = { ...workspace, activePaneId: paneId }; setLocalWorkspace(next); setWorkspace(next); void persist(next).catch(() => undefined) } }} onMaximize={(paneId) => setMaximizedPaneId((value) => value === paneId ? undefined : paneId)} onClose={closePane} onRestart={restartPane} onStop={stopPane} onMenu={(paneId, anchor) => { const rect = anchor.getBoundingClientRect(); setPaneMenu({ paneId, x: Math.min(rect.left, window.innerWidth - 230), y: rect.bottom + 4 }) }} onSizes={updateLayoutSizes} /></section>
    </div>
    <footer className="status-bar"><span>{project.gitBranch || 'No branch'}</span><span className="status-path" title={project.rootPath}>{project.rootPath}</span><span>{running}/{workspace.panes.length} running</span><span>{activePaneId ? workspace.panes.find((pane) => pane.id === activePaneId)?.title : 'No active pane'}</span></footer>
    {pendingInsert && <Modal title={pendingInsert.replace ? 'Replace terminal' : 'Choose terminal'} onClose={() => setPendingInsert(undefined)}><div className="provider-picker">{choices.length === 0 ? <ErrorNotice message="No available agents or shells were detected." onRetry={() => void scanProviders()} /> : choices.map((choice) => <button key={`${choice.provider}:${choice.name}`} onClick={() => void insertOrReplace(choice)}><TerminalSquare size={18} /><div><strong>{choice.name}</strong><span>{choice.executablePath}</span></div></button>)}</div></Modal>}
    {renameTarget && <TextPromptDialog title={renameTarget.kind === 'workspace' ? 'Rename workspace' : 'Rename terminal'} label={renameTarget.kind === 'workspace' ? 'Workspace name' : 'Terminal title'} initialValue={renameTarget.initialValue} confirmLabel="Rename" onClose={() => setRenameTarget(undefined)} onConfirm={(value) => void confirmRename(value)} />}
    {paneMenu && <PaneMenu menu={paneMenu} onClose={() => setPaneMenu(undefined)} onAction={(action) => { const paneId = paneMenu.paneId; setPaneMenu(undefined); if (action === 'rename') void renamePane(paneId); if (action === 'split_right') setPendingInsert({ targetPaneId: paneId, direction: 'vertical' }); if (action === 'split_down') setPendingInsert({ targetPaneId: paneId, direction: 'horizontal' }); if (action === 'duplicate') { const pane = workspace.panes.find((item) => item.id === paneId); if (pane) setPendingInsert({ targetPaneId: paneId, direction: 'vertical', duplicate: pane }) } if (action === 'replace') setPendingInsert({ targetPaneId: paneId, direction: 'vertical', replace: true }); if (action === 'directory') void changeDirectory(paneId); if (action === 'restart') void restartPane(paneId); if (action === 'stop') void stopPane(paneId); if (action === 'close') void closePane(paneId); if (['search','copy','paste','select_all','clear','focus'].includes(action)) dispatchTerminalAction(paneId, action as Parameters<typeof dispatchTerminalAction>[1]) }} />}
  </main>
}

interface RecursiveProps { node: LayoutNode; path: number[]; workspace: Workspace; sessions: Record<string, TerminalSession>; activePaneId?: string; maximizedPaneId?: string; settings: ReturnType<typeof useAppStore.getState>['settings']; paneErrors: Record<string, string>; onFocus: (paneId: string) => void; onMaximize: (paneId: string) => void; onClose: (paneId: string) => void; onRestart: (paneId: string) => void; onStop: (paneId: string) => void; onMenu: (paneId: string, anchor: HTMLElement) => void; onSizes: (path: number[], layout: PanelLayout) => void }

function RecursiveLayout(props: RecursiveProps) {
  const { node } = props
  if (node.type === 'pane') {
    const assignment = props.workspace.panes.find((pane) => pane.id === node.paneId)
    if (!assignment) return <div className="terminal-failure"><ErrorNotice message="This layout pane has no saved assignment." /></div>
    const session = Object.values(props.sessions).find((item) => item.paneId === node.paneId)
    return <div className="pane-slot"><TerminalPane assignment={assignment} session={session} active={props.activePaneId === node.paneId} maximized={props.maximizedPaneId === node.paneId} settings={props.settings} onFocus={() => props.onFocus(node.paneId)} onMaximize={() => props.onMaximize(node.paneId)} onClose={() => props.onClose(node.paneId)} onRestart={() => props.onRestart(node.paneId)} onStop={() => props.onStop(node.paneId)} onMenu={(anchor) => props.onMenu(node.paneId, anchor)} />{props.paneErrors[node.paneId] && <div className="pane-native-error"><ErrorNotice message={props.paneErrors[node.paneId]} onRetry={() => props.onRestart(node.paneId)} /></div>}</div>
  }
  const ids = node.children.map((child) => paneIds(child)[0])
  const defaultLayout = Object.fromEntries(ids.map((id, index) => [id, node.sizes[index] ?? 100 / ids.length]))
  return <Group id={`split-${props.path.join('-') || 'root'}`} orientation={node.direction} defaultLayout={defaultLayout} onLayoutChanged={(layout, meta) => meta.isUserInteraction && props.onSizes(props.path, layout)}>{node.children.flatMap((child, index) => {
    const id = ids[index]
    const items = [<Panel id={id} key={`panel-${id}`} minSize="12%"><RecursiveLayout {...props} node={child} path={[...props.path, index]} /></Panel>]
    if (index < node.children.length - 1) items.push(<Separator id={`separator-${props.path.join('-')}-${index}`} key={`separator-${id}`} className={`resize-handle ${node.direction}`} />)
    return items
  })}</Group>
}

function PaneMenu({ menu, onClose, onAction }: { menu: { x: number; y: number }; onClose: () => void; onAction: (action: string) => void }) {
  return <><button className="context-scrim" aria-label="Close pane menu" onClick={onClose} /><div className="context-popover pane-popover" style={{ left: menu.x, top: menu.y }}><button onClick={() => onAction('focus')}>Focus pane</button><button onClick={() => onAction('rename')}>Rename pane</button><button onClick={() => onAction('split_right')}><SplitSquareVertical size={14} />Split right</button><button onClick={() => onAction('split_down')}><SplitSquareHorizontal size={14} />Split down</button><button onClick={() => onAction('duplicate')}>Duplicate configuration</button><button onClick={() => onAction('replace')}>Replace agent or shell</button><button onClick={() => onAction('directory')}>Change working directory</button><span className="menu-separator" /><button onClick={() => onAction('search')}><Search size={14} />Search terminal</button><button onClick={() => onAction('copy')}><Copy size={14} />Copy terminal output</button><button onClick={() => onAction('paste')}>Paste</button><button onClick={() => onAction('select_all')}>Select all</button><button onClick={() => onAction('clear')}>Clear display</button><span className="menu-separator" /><button onClick={() => onAction('restart')}><RefreshCw size={14} />Restart terminal</button><button onClick={() => onAction('stop')}><CircleStop size={14} />Stop process</button><button className="danger-item" onClick={() => onAction('close')}><Trash2 size={14} />Close pane</button></div></>
}

function shellChoice(shell: ShellProfile): ProviderChoice {
  const provider: AgentProvider = shell.name.startsWith('PowerShell') || shell.name === 'Windows PowerShell' ? 'powershell' : shell.name === 'Command Prompt' ? 'command_prompt' : shell.name.startsWith('WSL') ? 'wsl' : 'custom_shell'
  return { provider, name: shell.name, executablePath: shell.executablePath, args: shell.args, shellProfileId: shell.id }
}

function setSizesAtPath(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (node.type === 'pane') return node
  if (path.length === 0) return { ...node, sizes }
  const [head, ...tail] = path
  return { ...node, children: node.children.map((child, index) => index === head ? setSizesAtPath(child, tail, sizes) : child) }
}
