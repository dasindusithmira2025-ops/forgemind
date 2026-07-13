import { useCallback, useEffect, useMemo, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, CircleStop, Copy, FolderOpen, RefreshCw, RotateCcw, Search, SplitSquareHorizontal, SplitSquareVertical, TerminalSquare, Trash2 } from 'lucide-react'
import { TerminalPane } from '../components/terminal/TerminalPane'
import { dispatchTerminalAction } from '../components/terminal/terminalActions'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Modal } from '../components/ui/Modal'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentProvider, PaneAssignment, Project, ShellProfile, SplitDirection, TerminalSession, Workspace } from '../native/types'
import { newId, paneIds, providerLabel } from '../shared/layout'
import { useAppStore } from '../stores/appStore'
import { terminalRuntime, useWorkspaceSessions } from '../features/terminals/runtimeStore'
import { AppShell } from '../components/shell/AppShell'
import { ForgeSpaceSidebar } from '../features/sidebar/components/ForgeSpaceSidebar'
import { deriveProviderSummary, deriveWorkspaceRuntimeSummary, groupSessionsByWorkspace } from '../features/sidebar/sidebarSelectors'
import type { SidebarActions, SidebarWorkspace } from '../features/sidebar/sidebarTypes'
import { clampSidebarWidth } from '../features/sidebar/sidebarPreferences'
import { WorkspaceCanvas, type RenderPaneContext } from '../features/workspace-canvas/components/WorkspaceCanvas'
import { useCanvasStore } from '../features/workspace-canvas/canvasStore'
import { buildFromPersisted, normalizeRestoredLayout } from '../features/workspace-canvas/canvasPersistence'
import { WORKSPACE_CANVAS_LAYOUT_VERSION } from '../features/workspace-canvas/canvasConstants'
import type { WorkspaceCanvasLayout } from '../features/workspace-canvas/canvasTypes'
import { normalizeSplitTree, removePaneFromDockedTree } from '../features/workspace-canvas/layoutOperations'
import { workspaceLayoutCommands, toSaveRequest } from '../native/workspaceLayoutCommands'

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
  const sessions = useWorkspaceSessions(workspaceId)
  const settings = useAppStore((state) => state.settings)
  const setWorkspace = useAppStore((state) => state.setWorkspace)
  const setProject = useAppStore((state) => state.setProject)
  const setDetections = useAppStore((state) => state.setDetections)
  const setShells = useAppStore((state) => state.setShells)
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
  const [collapsed, setCollapsed] = useState(!settings.sidebarOpen)
  const [sidebarWidth, setSidebarWidth] = useState(clampSidebarWidth(settings.sidebarWidth))
  const [sidebarSaving, setSidebarSaving] = useState(false)
  const maximizedPaneId = useCanvasStore((state) => state.layout?.maximizedPaneId)
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches))
  const [workspaceMenu, setWorkspaceMenu] = useState(false)
  const [paneMenu, setPaneMenu] = useState<{ paneId: string; x: number; y: number }>()
  const [pendingInsert, setPendingInsert] = useState<PendingInsert>()
  const [renameTarget, setRenameTarget] = useState<{ kind: 'workspace' | 'pane'; workspaceId?: string; paneId?: string; initialValue: string }>()
  const [choices, setChoices] = useState<ProviderChoice[]>([])
  const [projectWorkspaces, setProjectWorkspaces] = useState<Workspace[]>([])
  const [liveSessionsSnapshot, setLiveSessionsSnapshot] = useState<TerminalSession[]>([])
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string>()
  const [deferredPaneIds, setDeferredPaneIds] = useState<string[]>([])
  const paneSession = useCallback((paneId: string) => sessions.find((session) => session.paneId === paneId), [sessions])

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
      const session = await native.createTerminalSession({ workspaceId: currentWorkspace.id, paneId: assignment.id, cols: 80, rows: 24 })
      terminalRuntime.upsert(session)
      return session
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [assignment.id]: asNativeError(caught).message }))
      return undefined
    }
  }, [])

  const launchAll = useCallback(async (currentWorkspace: Workspace, freshOverride = false) => {
    const fresh = forceFresh || freshOverride
    terminalRuntime.clearWorkspace(currentWorkspace.id)
    const configuredBehavior = currentWorkspace.restoreBehavior === 'inherit' ? settings.restoreBehavior : currentWorkspace.restoreBehavior
    if (configuredBehavior === 'ask' && !fresh) {
      const restore = window.confirm('Restore the saved Pane assignments now? Choose Cancel to keep every Pane deferred until you resume it.')
      if (!restore) {
        setDeferredPaneIds(currentWorkspace.panes.map((pane) => pane.id))
        setActivePane(currentWorkspace.activePaneId ?? currentWorkspace.panes[0]?.id)
        return
      }
    }
    // "Open with fresh terminals" means new processes for the saved assignments; the
    // distinct fresh-shells restoration policy intentionally replaces agents with shells.
    const behavior = fresh ? 'restart_agents' : configuredBehavior === 'ask' ? 'restart_agents' : configuredBehavior
    const result = await native.restoreWorkspaceSessions(currentWorkspace.id, settings.restorationLaunchBudget, behavior)
    terminalRuntime.hydrate(result.sessions)
    setDeferredPaneIds(result.deferredPaneIds)
    setPaneErrors(Object.fromEntries(result.failures.map((failure) => [failure.paneId, failure.message])))
    if (result.sessions.length === 0 && result.failures.length > 0) setError('No terminal session could be started. Resolve the affected Pane assignments and retry.')
    setActivePane(currentWorkspace.activePaneId ?? currentWorkspace.panes[0]?.id)
  }, [forceFresh, setActivePane, settings.restorationLaunchBudget, settings.restoreBehavior])

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const loadedWorkspace = storedWorkspace?.id === workspaceId ? storedWorkspace : await native.getWorkspace(workspaceId)
        const loadedProject = project?.id === loadedWorkspace.projectId ? project : await native.getProject(loadedWorkspace.projectId)
        if (!live) return
        setLocalWorkspace(loadedWorkspace); setWorkspace(loadedWorkspace)
        setLocalProject(loadedProject); setProject(loadedProject)
        // Hydrate the docking canvas: read the persisted floating layer (migrating a pre-canvas
        // workspace) and seed the store before terminals render, so placement is correct first paint.
        const canvasRecord = await workspaceLayoutCommands.getCanvasLayout(loadedWorkspace.id).catch(() => ({ revision: 0, canvasJson: null }))
        if (!live) return
        useCanvasStore.getState().init(loadedWorkspace.id, buildFromPersisted(loadedWorkspace, canvasRecord.canvasJson), canvasRecord.revision)
        // Record this Workspace as the Project's most recently active so a later switch can
        // restore it. Best-effort — it must never block hydration.
        void native.setLastActiveWorkspace(loadedWorkspace.id).catch(() => undefined)
        await scanProviders()
        if (!live) return
        if (forceFresh) {
          // Reuse the saved configuration but start brand-new Terminal Sessions.
          await native.terminateWorkspaceSessions(loadedWorkspace.id).catch(() => undefined)
        } else {
          const liveSessions = await native.listLiveSessions(loadedWorkspace.id)
          if (liveSessions.length > 0) terminalRuntime.hydrate(liveSessions)
        }
        await launchAll(loadedWorkspace)
      } catch (caught) { if (live) setError(asNativeError(caught).message) }
      finally { if (live) { setLoading(false); setSwitchingWorkspaceId(undefined) } }
    })()
    return () => { live = false }
    // Workspace identity controls hydration. Actions update local state directly.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => { setCollapsed(!settings.sidebarOpen); setSidebarWidth(clampSidebarWidth(settings.sidebarWidth)) }, [settings.sidebarOpen, settings.sidebarWidth])

  const persistSidebar = useCallback(async (patch: Partial<Pick<typeof settings, 'sidebarOpen' | 'sidebarWidth'>>) => {
    if (sidebarSaving) return
    setSidebarSaving(true)
    const previous = settings
    const nextSettings = { ...settings, ...patch }
    setSettings(nextSettings)
    try {
      setSettings(await native.saveSettings(nextSettings))
    } catch (caught) {
      setSettings(previous)
      setCollapsed(!previous.sidebarOpen)
      setSidebarWidth(clampSidebarWidth(previous.sidebarWidth))
      setError(asNativeError(caught).message)
    } finally {
      setSidebarSaving(false)
    }
  }, [settings, setSettings, sidebarSaving])

  const toggleCollapse = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    void persistSidebar({ sidebarOpen: !next })
  }, [collapsed, persistSidebar])

  const commitSidebarWidth = useCallback((width: number) => {
    const clamped = clampSidebarWidth(width)
    setSidebarWidth(clamped)
    void persistSidebar({ sidebarWidth: clamped })
  }, [persistSidebar])

  const refreshWorkspaces = useCallback(async (currentProjectId?: string) => {
    const projectId = currentProjectId ?? project?.id
    try {
      const [recent, live, list] = await Promise.all([
        native.listRecentWorkspaces(),
        native.listLiveSessions(),
        projectId ? native.listWorkspacesForProject(projectId) : Promise.resolve([] as Workspace[]),
      ])
      setRecentWorkspaces(recent)
      setLiveSessionsSnapshot(live)
      setProjectWorkspaces(list)
    } catch (caught) {
      setError(asNativeError(caught).message)
    }
  }, [project?.id, setRecentWorkspaces])

  useEffect(() => { void refreshWorkspaces() }, [refreshWorkspaces, workspaceId])

  // Mirror the canvas store's docked tree + active pane into WorkspaceScreen's workspace state so
  // pane-config operations (split, close, replace…) keep operating on a consistent docked tree.
  const syncWorkspaceLayout = useCallback((layout: WorkspaceCanvasLayout) => {
    setLocalWorkspace((current) => (current ? { ...current, layout: layout.dockedRoot ?? current.layout, activePaneId: layout.activePaneId } : current))
    setActivePane(layout.activePaneId)
  }, [setActivePane])

  // Persist a committed canvas layout through the typed, revision-checked Tauri command. Rolls
  // back the optimistic store + workspace state on failure, always keeping terminals alive.
  const persistCanvas = useCallback((next: WorkspaceCanvasLayout, previous: WorkspaceCanvasLayout) => {
    const store = useCanvasStore.getState()
    if (!store.workspaceId) return
    syncWorkspaceLayout(next)
    void workspaceLayoutCommands
      .saveCanvasLayout(toSaveRequest(store.workspaceId, store.revision, next))
      .then((result) => useCanvasStore.getState().setRevision(result.revision))
      .catch((caught) => {
        useCanvasStore.getState().setLayout(previous)
        syncWorkspaceLayout(previous)
        setError(asNativeError(caught).message)
      })
  }, [syncWorkspaceLayout])

  // After a pane-config change re-persisted through save_workspace, fold the new docked tree back
  // into the canvas so canvas_json stays authoritative on reload. normalizeRestoredLayout tiles
  // every pane (the canvas has no floating layer), so a new/removed pane lands in the tree.
  const resyncCanvas = useCallback((source: Workspace) => {
    const store = useCanvasStore.getState()
    const current = store.layout
    if (!current) return
    const merged = normalizeRestoredLayout(
      {
        version: WORKSPACE_CANVAS_LAYOUT_VERSION,
        dockedRoot: source.layout,
        floatingPanes: current.floatingPanes,
        activePaneId: source.activePaneId ?? current.activePaneId,
        maximizedPaneId: current.maximizedPaneId,
        nextFloatingZIndex: current.nextFloatingZIndex,
      },
      source.panes.map((pane) => pane.id),
    )
    store.setLayout(merged)
    persistCanvas(merged, current)
  }, [persistCanvas])

  const persist = useCallback(async (next: Workspace) => {
    const saved = await native.saveWorkspace({
      id: next.id,
      projectId: next.projectId,
      name: next.name,
      layout: next.layout,
      activePaneId: next.activePaneId,
      restoreBehavior: next.restoreBehavior,
      panes: next.panes,
    })
    setLocalWorkspace(saved); setWorkspace(saved)
    resyncCanvas(saved)
    void refreshWorkspaces()
    return saved
  }, [refreshWorkspaces, resyncCanvas, setWorkspace])

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
    if (session) terminalRuntime.remove(session.id)
    setDeferredPaneIds((current) => current.filter((id) => id !== paneId))
    await launchPane(assignment, workspace)
  }

  const closePane = async (paneId: string) => {
    if (!workspace || workspace.panes.length <= 1) { setPaneErrors((current) => ({ ...current, [paneId]: 'At least one terminal pane must remain.' })); return }
    const session = paneSession(paneId)
    if (session?.status === 'running' && settings.confirmClosePane && !window.confirm('Stop the running process and close this pane?')) return
    if (session?.status === 'running') await native.terminateTerminalSession(session.id)
    if (session) terminalRuntime.remove(session.id)
    try {
      const canvas = useCanvasStore.getState().layout
      const panes = workspace.panes.filter((pane) => pane.id !== paneId).map((pane, index) => ({ ...pane, positionOrder: index }))
      const active = workspace.activePaneId === paneId ? panes[0]?.id : workspace.activePaneId
      // Remove the pane from the docked tree; the canvas resync below re-tiles the survivors.
      const newDocked = normalizeSplitTree(removePaneFromDockedTree(canvas?.dockedRoot ?? workspace.layout, paneId))
      const layout = newDocked ?? { type: 'pane' as const, paneId: panes[0]!.id }
      if (canvas && canvas.maximizedPaneId === paneId) useCanvasStore.getState().setLayout({ ...canvas, maximizedPaneId: undefined })
      await persist({ ...workspace, layout, panes, activePaneId: active })
      setActivePane(active)
    } catch (caught) { setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message })) }
  }

  const renamePane = async (paneId: string) => {
    if (!workspace) return
    const pane = workspace.panes.find((item) => item.id === paneId)
    if (pane) setRenameTarget({ kind: 'pane', paneId, initialValue: pane.title })
  }

  const confirmRename = async (value: string) => {
    const target = renameTarget
    setRenameTarget(undefined)
    if (!target || value === target.initialValue) return
    try {
      if (target.kind === 'workspace') {
        if (target.workspaceId && target.workspaceId !== workspace?.id) {
          await native.renameWorkspace(target.workspaceId, value)
          void refreshWorkspaces()
        } else if (workspace) {
          await persist({ ...workspace, name: value })
        }
      } else if (workspace) {
        await persist({ ...workspace, panes: workspace.panes.map((item) => item.id === target.paneId ? { ...item, title: value } : item) })
      }
    } catch (caught) { setError(asNativeError(caught).message) }
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
    if (session) terminalRuntime.remove(session.id)
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
      if (session) terminalRuntime.remove(session.id)
      const pane = { ...target, provider: choice.provider, title: choice.name, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId }
      const next = await persist({ ...workspace, panes: workspace.panes.map((item) => item.id === pane.id ? pane : item) })
      setPendingInsert(undefined); await launchPane(pane, next); return
    }
    const newPaneId = newId()
    const layout = await native.splitLayoutPane(workspace.layout, target.id, pendingInsert.direction, newPaneId)
    const source = pendingInsert.duplicate
    const pane: PaneAssignment = source ? { ...source, id: newPaneId, workspaceId: workspace.id, title: `${source.title} copy`, positionOrder: workspace.panes.length } : { id: newPaneId, workspaceId: workspace.id, title: choice.name, provider: choice.provider, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId, workingDirectory: target.workingDirectory || project.rootPath, workingDirectoryMode: 'project_relative', positionOrder: workspace.panes.length }
    const next = await persist({ ...workspace, layout, panes: [...workspace.panes, pane], activePaneId: newPaneId })
    setPendingInsert(undefined); setActivePane(newPaneId); await launchPane(pane, next)
  }

  const stopAll = useCallback(async () => { if (workspace) { await native.terminateWorkspaceSessions(workspace.id); terminalRuntime.clearWorkspace(workspace.id) } }, [workspace])
  const restartAll = useCallback(async () => { if (!workspace) return; await native.terminateWorkspaceSessions(workspace.id).catch(() => undefined); await launchAll(workspace, true) }, [launchAll, workspace])
  const openLauncher = () => { navigate('/'); setWorkspaceMenu(false) }
  const closeWorkspace = async () => {
    await stopAll(); setWorkspace(undefined); setProject(undefined); navigate('/')
  }

  // Reconfigure edits THIS workspace in place (same id). If terminals are live, we stop
  // them first rather than silently mutating pane configuration under running processes.
  const reconfigureWorkspace = () => {
    if (!workspace || !project) return
    const anyRunning = sessions.some((session) => session.status === 'running')
    if (anyRunning && !window.confirm('This workspace has running terminals. Stop them and reconfigure?')) return
    setWorkspaceMenu(false)
    if (anyRunning) void stopAll()
    navigate(`/workspace/${workspace.id}/configure`)
  }

  const switchWorkspace = useCallback(async (nextWorkspaceId: string) => {
    if (nextWorkspaceId === workspace?.id || switchingWorkspaceId) return
    const hasRunningProcesses = sessions.some((session) => session.status === 'running')
    if (hasRunningProcesses && settings.inactiveWorkspaceProcesses === 'ask') {
      const keepRunning = window.confirm('Keep this Workspace\'s terminals running in the background? Choose Cancel to stop them before switching.')
      if (!keepRunning) await stopAll()
    } else if (hasRunningProcesses && settings.inactiveWorkspaceProcesses === 'stop') {
      await stopAll()
    }
    setSwitchingWorkspaceId(nextWorkspaceId)
    setError('')
    setWorkspaceMenu(false)
    navigate(`/workspace/${nextWorkspaceId}`)
  }, [navigate, sessions, settings.inactiveWorkspaceProcesses, stopAll, switchingWorkspaceId, workspace?.id])

  // ---- Sidebar-driven Workspace actions ---------------------------------------------------
  const newWorkspace = useCallback(() => { if (project) navigate(`/setup/${project.id}`) }, [navigate, project])

  const openFresh = useCallback(async (id: string) => {
    if (id === workspace?.id) { await restartAll(); return }
    setSwitchingWorkspaceId(id)
    navigate(`/workspace/${id}?fresh=1`)
  }, [navigate, restartAll, workspace?.id])

  const duplicateWorkspace = useCallback(async (id: string) => {
    try { await native.duplicateWorkspace(id); await refreshWorkspaces() }
    catch (caught) { setError(asNativeError(caught).message) }
  }, [refreshWorkspaces])

  const renameWorkspaceById = useCallback((id: string) => {
    const target = id === workspace?.id ? workspace : projectWorkspaces.find((item) => item.id === id)
    if (target) setRenameTarget({ kind: 'workspace', workspaceId: id, initialValue: target.name })
  }, [projectWorkspaces, workspace])

  const reconfigureWorkspaceById = useCallback((id: string) => {
    if (id === workspace?.id) { reconfigureWorkspace(); return }
    navigate(`/workspace/${id}/configure`)
    // reconfigureWorkspace closes over current workspace; safe to omit from deps.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, workspace?.id])

  const restartWorkspaceById = useCallback(async (id: string) => {
    if (id === workspace?.id) { await restartAll(); return }
    await switchWorkspace(id)
  }, [restartAll, switchWorkspace, workspace?.id])

  const stopWorkspaceById = useCallback(async (id: string) => {
    try { await native.terminateWorkspaceSessions(id); terminalRuntime.clearWorkspace(id); await refreshWorkspaces() }
    catch (caught) { setError(asNativeError(caught).message) }
  }, [refreshWorkspaces])

  const reorderWorkspaces = useCallback(async (orderedIds: string[]) => {
    if (!project) return
    const previous = projectWorkspaces
    const byId = new Map(previous.map((item) => [item.id, item]))
    const next = orderedIds.map((id) => byId.get(id)).filter((item): item is Workspace => Boolean(item))
    setProjectWorkspaces(next) // optimistic
    try {
      await native.reorderWorkspaces(project.id, orderedIds)
    } catch (caught) {
      setProjectWorkspaces(previous) // rollback
      setError(asNativeError(caught).message)
    }
  }, [project, projectWorkspaces])

  const moveWorkspace = useCallback((id: string, direction: -1 | 1) => {
    const ids = projectWorkspaces.map((item) => item.id)
    const index = ids.indexOf(id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= ids.length) return
    const next = [...ids]
    ;[next[index], next[target]] = [next[target], next[index]]
    void reorderWorkspaces(next)
  }, [projectWorkspaces, reorderWorkspaces])

  const removeFromRecents = useCallback(async (id: string) => {
    try {
      await native.removeRecentWorkspace(id)
      await refreshWorkspaces()
      if (id === workspace?.id) navigate('/')
    } catch (caught) { setError(asNativeError(caught).message) }
  }, [navigate, refreshWorkspaces, workspace?.id])

  const deleteWorkspaceById = useCallback(async (id: string) => {
    const target = id === workspace?.id ? workspace : projectWorkspaces.find((item) => item.id === id)
    if (!window.confirm(`Delete the workspace configuration "${target?.name ?? 'this workspace'}"? Its terminals will stop. Project files are never touched.`)) return
    try {
      await native.deleteWorkspaceConfiguration(id)
      if (id === workspace?.id) {
        const fallback = projectWorkspaces.find((item) => item.id !== id)
        if (fallback) { setSwitchingWorkspaceId(fallback.id); navigate(`/workspace/${fallback.id}`) }
        else navigate('/')
      } else {
        await refreshWorkspaces()
      }
    } catch (caught) { setError(asNativeError(caught).message) }
  }, [navigate, projectWorkspaces, refreshWorkspaces, workspace])

  const openProjectFolder = useCallback(() => { if (project) void openPath(project.rootPath).catch(() => undefined) }, [project])

  const locateFolder = useCallback(async () => {
    if (!project) return
    const selected = await open({ directory: true, multiple: false, title: 'Locate project folder' })
    if (!selected || Array.isArray(selected)) return
    try {
      const relocated = await native.relocateProject(project.id, selected)
      setLocalProject(relocated); setProject(relocated)
      await refreshWorkspaces(relocated.id)
    } catch (caught) { setError(asNativeError(caught).message) }
  }, [project, refreshWorkspaces, setProject])

  const refreshProject = useCallback(async () => {
    if (!project) return
    try {
      const refreshed = await native.openProject(project.rootPath)
      setLocalProject(refreshed); setProject(refreshed)
    } catch { /* folder may be missing; refreshWorkspaces still runs */ }
    await refreshWorkspaces(project.id)
  }, [project, refreshWorkspaces, setProject])

  const sidebarActions: SidebarActions = useMemo(() => ({
    onSelectWorkspace: (id) => void switchWorkspace(id),
    onOpenFresh: (id) => void openFresh(id),
    onNewWorkspace: newWorkspace,
    onRenameWorkspace: renameWorkspaceById,
    onReconfigureWorkspace: reconfigureWorkspaceById,
    onDuplicateWorkspace: (id) => void duplicateWorkspace(id),
    onRestartWorkspace: (id) => void restartWorkspaceById(id),
    onStopWorkspace: (id) => void stopWorkspaceById(id),
    onMoveWorkspace: moveWorkspace,
    onReorder: (ids) => void reorderWorkspaces(ids),
    onRemoveRecent: (id) => void removeFromRecents(id),
    onDeleteWorkspace: (id) => void deleteWorkspaceById(id),
    onOpenProjectFolder: openProjectFolder,
    onLocateFolder: () => void locateFolder(),
    onRefreshProject: () => void refreshProject(),
    onOpenLauncher: () => navigate('/'),
    onOpenSettings: () => navigate('/settings'),
    onToggleCollapse: toggleCollapse,
    onResizeCommit: commitSidebarWidth,
  }), [switchWorkspace, openFresh, newWorkspace, renameWorkspaceById, reconfigureWorkspaceById, duplicateWorkspace, restartWorkspaceById, stopWorkspaceById, moveWorkspace, reorderWorkspaces, removeFromRecents, deleteWorkspaceById, openProjectFolder, locateFolder, refreshProject, navigate, toggleCollapse, commitSidebarWidth])

  const sidebarWorkspaces: SidebarWorkspace[] = useMemo(() => {
    const grouped = groupSessionsByWorkspace(liveSessionsSnapshot)
    return projectWorkspaces.map((item) => {
      const isActive = item.id === workspaceId
      const workspaceSessions = isActive ? sessions : (grouped.get(item.id) ?? [])
      const runtime = deriveWorkspaceRuntimeSummary({
        workspaceId: item.id,
        configuredPaneCount: item.panes.length,
        sessions: workspaceSessions,
        deferredPaneIds: isActive ? deferredPaneIds : [],
      })
      return { workspace: item, runtime, providers: deriveProviderSummary(item) }
    })
  }, [projectWorkspaces, liveSessionsSnapshot, sessions, workspaceId, deferredPaneIds])

  const projectFolderMissing = useMemo(() => {
    if (!project) return false
    const record = recentWorkspaces.find((item) => item.workspace.projectId === project.id)
    return record?.projectMissing ?? false
  }, [project, recentWorkspaces])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!workspace) return
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleCollapse(); return }
      if (event.ctrlKey && event.key.toLowerCase() === 'b' && !event.shiftKey) { event.preventDefault(); toggleCollapse(); return }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); return }
      if (event.ctrlKey && event.altKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault(); const target = projectWorkspaces[Number(event.key) - 1]; if (target && target.id !== workspace.id) void switchWorkspace(target.id); return
      }
      if (!activePaneId) return
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); dispatchTerminalAction(activePaneId, 'search') }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'vertical' }) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Backslash') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'vertical' }) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Minus') { event.preventDefault(); setPendingInsert({ targetPaneId: activePaneId, direction: 'horizontal' }) }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'w') { event.preventDefault(); void closePane(activePaneId) }
      if (event.ctrlKey && event.shiftKey && event.key === 'Enter') { event.preventDefault(); useCanvasStore.getState().toggleMaximize(activePaneId) }
      if (event.ctrlKey && event.key === ',') { event.preventDefault(); navigate('/settings') }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); navigate('/') }
      if (event.ctrlKey && (event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault(); const ids = paneIds(workspace.layout); const index = ids.indexOf(activePaneId); const delta = event.key === 'PageDown' ? 1 : -1; setActivePane(ids[(index + delta + ids.length) % ids.length]);
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  // closePane reads current state and is intentionally rebound with the other workspace values.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaneId, navigate, setActivePane, workspace, projectWorkspaces, switchWorkspace, toggleCollapse])

  // Render one terminal for a pane inside its canvas window. The docking canvas owns geometry,
  // placement and the header drag handle; this only wires the terminal + its pane actions. The
  // TerminalPane keeps a stable React key (its paneId) so its xterm/PTY never remount on moves.
  const renderPane = (paneId: string, ctx: RenderPaneContext) => {
    const assignment = workspace?.panes.find((pane) => pane.id === paneId)
    if (!assignment) return <div className="terminal-failure"><ErrorNotice message="This layout pane has no saved assignment." /></div>
    const session = sessions.find((item) => item.paneId === paneId)
    return <>
      <TerminalPane assignment={assignment} session={session} deferred={deferredPaneIds.includes(paneId)} active={ctx.active} maximized={ctx.maximized} settings={settings}
        onFocus={() => setActivePane(paneId)}
        onMaximize={() => useCanvasStore.getState().toggleMaximize(paneId)}
        onClose={() => void closePane(paneId)} onRestart={() => void restartPane(paneId)} onStop={() => void stopPane(paneId)}
        onMenu={(anchor) => { const rect = anchor.getBoundingClientRect(); setPaneMenu({ paneId, x: Math.min(rect.left, window.innerWidth - 230), y: rect.bottom + 4 }) }}
        onHeaderPointerDown={ctx.onHeaderPointerDown} />
      {paneErrors[paneId] && <div className="pane-native-error"><ErrorNotice message={paneErrors[paneId]} onRetry={() => void restartPane(paneId)} /></div>}
    </>
  }

  if (loading) return <div className="workspace-loading"><div className="workspace-loading-header" /><div className="workspace-loading-sidebar" /><div className="workspace-loading-grid" /></div>
  if (!workspace || !project) return <main className="centered-error"><ErrorNotice message={error || 'The workspace could not be loaded.'} /><Button onClick={() => navigate('/')}>Return to launcher</Button></main>
  const running = sessions.filter((session) => session.status === 'running').length
  const activePane = workspace.panes.find((pane) => pane.id === activePaneId)

  return <AppShell className={`workspace-shell ${switchingWorkspaceId ? 'workspace-switching' : ''}`} sidebarOpen={!maximizedPaneId}
    titleBar={<><div className="workspace-heading"><strong>{activePane?.title || workspace.name}</strong>{project.gitBranch && <span className="branch-label">{project.gitBranch}</span>}</div><div className="titlebar-spacer" /><span className="compact-count">{running}/{workspace.panes.length} running</span><div className="workspace-menu-wrap"><Button variant="ghost" icon={<ChevronDown size={14} />} aria-expanded={workspaceMenu} aria-haspopup="menu" onClick={() => setWorkspaceMenu((value) => !value)}>Workspace</Button>{workspaceMenu && <><button className="context-scrim" aria-label="Close workspace menu" onClick={() => setWorkspaceMenu(false)} /><div className="context-popover workspace-popover" role="menu"><button role="menuitem" onClick={() => { setWorkspaceMenu(false); renameWorkspaceById(workspace.id) }}>Rename workspace</button><button role="menuitem" onClick={reconfigureWorkspace}>Reconfigure workspace</button><button role="menuitem" onClick={() => navigate(`/setup/${project.id}`)}>New workspace for this project</button><span className="menu-separator" /><button role="menuitem" onClick={() => void restartAll()}><RotateCcw size={14} />Restart all terminals</button><button role="menuitem" onClick={() => void stopAll()}><CircleStop size={14} />Stop all terminals</button><button role="menuitem" onClick={openLauncher}><FolderOpen size={14} />Project launcher</button><button role="menuitem" className="danger-item" onClick={() => void closeWorkspace()}>Close workspace</button></div></>}</div></>}
    sidebar={<ForgeSpaceSidebar project={project} activeWorkspaceId={workspace.id} workspaces={sidebarWorkspaces} recents={recentWorkspaces} collapsed={collapsed} width={sidebarWidth} switchingWorkspaceId={switchingWorkspaceId} projectFolderMissing={projectFolderMissing} loadingWorkspaces={projectWorkspaces.length === 0 && loading} actions={sidebarActions} />}
    canvas={<>{error && <div className="workspace-error"><ErrorNotice message={error} onRetry={() => void restartAll()} /></div>}<section className="terminal-canvas"><WorkspaceCanvas reducedMotion={reducedMotion} persist={persistCanvas} onFocusPane={setActivePane} renderPane={renderPane} /></section></>}
    statusBar={<><span>{project.gitBranch || 'No branch'}</span><span className="status-path" title={project.rootPath}>{project.name}</span><span>{running}/{workspace.panes.length} running</span><span>{activePane?.title || 'No active pane'}</span>{Object.keys(paneErrors).some((id) => paneErrors[id]) && <span className="status-alert">Needs attention</span>}</>}
  >
    {pendingInsert && <Modal title={pendingInsert.replace ? 'Replace terminal' : 'Choose terminal'} onClose={() => setPendingInsert(undefined)}><div className="provider-picker">{choices.length === 0 ? <ErrorNotice message="No available agents or shells were detected." onRetry={() => void scanProviders()} /> : choices.map((choice) => <button key={`${choice.provider}:${choice.name}`} onClick={() => void insertOrReplace(choice)}><TerminalSquare size={18} /><div><strong>{choice.name}</strong><span>Available · {providerLabel(choice.provider)}</span></div></button>)}</div></Modal>}
    {renameTarget && <TextPromptDialog title={renameTarget.kind === 'workspace' ? 'Rename workspace' : 'Rename terminal'} label={renameTarget.kind === 'workspace' ? 'Workspace name' : 'Terminal title'} initialValue={renameTarget.initialValue} confirmLabel="Rename" onClose={() => setRenameTarget(undefined)} onConfirm={(value) => void confirmRename(value)} />}
    {paneMenu && <PaneMenu menu={paneMenu} onClose={() => setPaneMenu(undefined)} onAction={(action) => { const paneId = paneMenu.paneId; setPaneMenu(undefined); if (action === 'rename') void renamePane(paneId); if (action === 'split_right') setPendingInsert({ targetPaneId: paneId, direction: 'vertical' }); if (action === 'split_down') setPendingInsert({ targetPaneId: paneId, direction: 'horizontal' }); if (action === 'duplicate') { const pane = workspace.panes.find((item) => item.id === paneId); if (pane) setPendingInsert({ targetPaneId: paneId, direction: 'vertical', duplicate: pane }) } if (action === 'replace') setPendingInsert({ targetPaneId: paneId, direction: 'vertical', replace: true }); if (action === 'directory') void changeDirectory(paneId); if (action === 'restart') void restartPane(paneId); if (action === 'stop') void stopPane(paneId); if (action === 'close') void closePane(paneId); if (['search','copy','paste','select_all','clear','focus'].includes(action)) dispatchTerminalAction(paneId, action as Parameters<typeof dispatchTerminalAction>[1]) }} />}
  </AppShell>
}

function PaneMenu({ menu, onClose, onAction }: { menu: { x: number; y: number }; onClose: () => void; onAction: (action: string) => void }) {
  return <><button className="context-scrim" aria-label="Close pane menu" onClick={onClose} /><div className="context-popover pane-popover" style={{ left: menu.x, top: menu.y }}><button onClick={() => onAction('focus')}>Focus pane</button><button onClick={() => onAction('rename')}>Rename pane</button><button onClick={() => onAction('split_right')}><SplitSquareVertical size={14} />Split right</button><button onClick={() => onAction('split_down')}><SplitSquareHorizontal size={14} />Split down</button><button onClick={() => onAction('duplicate')}>Duplicate configuration</button><button onClick={() => onAction('replace')}>Replace agent or shell</button><button onClick={() => onAction('directory')}>Change working directory</button><span className="menu-separator" /><button onClick={() => onAction('search')}><Search size={14} />Search terminal</button><button onClick={() => onAction('copy')}><Copy size={14} />Copy terminal output</button><button onClick={() => onAction('paste')}>Paste</button><button onClick={() => onAction('select_all')}>Select all</button><button onClick={() => onAction('clear')}>Clear display</button><span className="menu-separator" /><button onClick={() => onAction('restart')}><RefreshCw size={14} />Restart terminal</button><button onClick={() => onAction('stop')}><CircleStop size={14} />Stop process</button><button className="danger-item" onClick={() => onAction('close')}><Trash2 size={14} />Close pane</button></div></>
}

function shellChoice(shell: ShellProfile): ProviderChoice {
  const provider: AgentProvider = shell.name.startsWith('PowerShell') || shell.name === 'Windows PowerShell' ? 'powershell' : shell.name === 'Command Prompt' ? 'command_prompt' : shell.name.startsWith('WSL') ? 'wsl' : 'custom_shell'
  return { provider, name: shell.name, executablePath: shell.executablePath, args: shell.args, shellProfileId: shell.id }
}

