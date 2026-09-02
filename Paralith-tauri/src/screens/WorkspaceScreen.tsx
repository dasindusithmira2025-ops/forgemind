import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { confirm, open } from '@tauri-apps/plugin-dialog'
import { openPath } from '@tauri-apps/plugin-opener'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronDown, CircleStop, FolderOpen, PanelRightClose, PanelRightOpen, RotateCcw, TerminalSquare } from 'lucide-react'
import { TerminalPane } from '../components/terminal/TerminalPane'
import { PaneMenu } from '../components/terminal/PaneMenu'
import { dispatchTerminalAction } from '../components/terminal/terminalActions'
import { Button } from '../components/ui/Button'
import { ErrorNotice } from '../components/ui/ErrorNotice'
import { Modal } from '../components/ui/Modal'
import { TextPromptDialog } from '../components/ui/TextPromptDialog'
import { asNativeError, native } from '../native/commands'
import type { AgentProvider, AgentStateEvent, MonitorInfo, PaneAssignment, PaneGitReview, Project, ShellProfile, SplitDirection, TerminalSession, Workspace, WorkspacePlacement } from '../native/types'
import { handoffController } from '../features/workspace-windows/handoffController'
import { MonitorRecoveryWatcher } from '../features/workspace-windows/MonitorRecoveryWatcher'
import { monitorLabel } from '../features/workspace-windows/placementSelectors'
import type { WorkspaceWindowIntent } from '../features/workspace-windows/windowIntent'
import { newId, paneIds, preferredShell, providerLabel } from '../shared/layout'
import { useAppStore } from '../stores/appStore'
import { useSessionStore } from '../stores/sessionStore'
import type { SidebarOpenProject } from '../features/sidebar/sidebarTypes'
import { terminalRuntime, useWorkspaceSessions } from '../features/terminals/runtimeStore'
import { onSidebarPreferencesChanged } from '../native/events'
import { AppShell } from '../components/shell/AppShell'
import { AiUsageStatusBar } from '../features/usage/AiUsageStatusBar'
import { openAgentResumeCenter, WORKSPACE_CONFIGURATION_CHANGED } from '../features/agent-resume/events'
import { ForgeSpaceSidebar } from '../features/sidebar/components/ForgeSpaceSidebar'
import { deriveSidebarWorkspace } from '../features/sidebar/sidebarModel'
import { resyncSidebarRuntime, startSidebarRuntime, useSidebarRuntime } from '../features/sidebar/sidebarRuntimeStore'
import { hydrateSidebarPreferences, useSidebarStore } from '../features/sidebar/sidebarStore'
import type { SidebarActions, SidebarProjectGroup, SidebarWorkspace } from '../features/sidebar/sidebarTypes'
import { clampSidebarWidth } from '../features/sidebar/sidebarPreferences'
import { WorkspaceCanvas, type RenderPaneContext } from '../features/workspace-canvas/components/WorkspaceCanvas'
import { useCanvasStore } from '../features/workspace-canvas/canvasStore'
import { buildFromPersisted, normalizeRestoredLayout } from '../features/workspace-canvas/canvasPersistence'
import type { WorkspaceCanvasLayout } from '../features/workspace-canvas/canvasTypes'
import { allPaneIds, findDockPath, insertPaneBesideTarget, normalizeSplitTree, removePaneFromDockedTree } from '../features/workspace-canvas/layoutOperations'
import { applyLayoutPreset, type LayoutPresetId } from '../features/workspace-canvas/layoutPresets'
import { LayoutMenu } from '../features/workspace-canvas/components/LayoutMenu'
import { NewPaneMenu, type NewPaneOption } from '../features/workspace-canvas/components/NewPaneMenu'
import { insertZoneFor, resolvePanePlacement, SESSION_PRESSURE_THRESHOLD } from '../features/workspace-canvas/paneCreation'
import { CANVAS_CONSTANTS, WORKSPACE_CANVAS_LAYOUT_VERSION } from '../features/workspace-canvas/canvasConstants'
import { workspaceLayoutCommands, toSaveRequest } from '../native/workspaceLayoutCommands'
import { isActiveLifecycle } from '../features/swarms/swarmPresentation'
import { WorkspaceToolPanel } from '../features/code-surface/WorkspaceToolPanel'
import { ActivityPulse } from '../features/activity/ActivityPulse'
import { useWorkspacePanelStore, clampPanelWidth, type SurfaceKind } from '../features/code-surface/workspacePanelStore'
import type { AgentContextPackage } from '../features/code-surface/browser/inspectContext'

type ProviderChoice = { provider: AgentProvider; name: string; executablePath: string; args: string[]; shellProfileId?: string }
/** Only *replacing* a pane still needs a picker; every creation path resolves its own choice. */
type PendingReplace = { targetPaneId: string }
/** Where a new pane goes when the caller has an opinion; anything omitted is resolved spatially. */
type CreateRequest = { targetPaneId?: string; direction?: SplitDirection }

const AGENT_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'opencode']

/** Stable id for a creation option. Shell profiles share a provider, so the profile id decides. */
function choiceOptionId(choice: ProviderChoice): string {
  return `${choice.provider}:${choice.shellProfileId ?? choice.executablePath}`
}

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
  const launchingPaneIds = useRef(new Set<string>())
  const [collapsed, setCollapsed] = useState(!settings.sidebarOpen)
  const [sidebarWidth, setSidebarWidth] = useState(clampSidebarWidth(settings.sidebarWidth))
  const [sidebarSaving, setSidebarSaving] = useState(false)
  const maximizedPaneId = useCanvasStore((state) => state.layout?.maximizedPaneId)
  const [reducedMotion] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches))
  const [workspaceMenu, setWorkspaceMenu] = useState(false)
  const [paneMenu, setPaneMenu] = useState<{ paneId: string; x: number; y: number }>()
  const [pendingReplace, setPendingReplace] = useState<PendingReplace>()
  // Guards the create path against a double-fire (double click, key repeat) landing two panes on
  // the same revision-checked save. The ref is the guard - state only drives the disabled button,
  // and a second click in the same frame would still read the stale state value.
  const creatingPaneRef = useRef(false)
  const [creatingPane, setCreatingPane] = useState(false)
  const [renameTarget, setRenameTarget] = useState<{ kind: 'workspace' | 'pane'; workspaceId?: string; paneId?: string; initialValue: string }>()
  const [choices, setChoices] = useState<ProviderChoice[]>([])
  // Provider detection runs off the hydration path, so "nothing available" is only true once it
  // has finished. Until then the creation control says it is still looking.
  const [detectingProviders, setDetectingProviders] = useState(true)
  const [projectWorkspaces, setProjectWorkspaces] = useState<Workspace[]>([])
  // Workspaces of the *other* open Projects, keyed by Project id. The active Project keeps its
  // own `projectWorkspaces` state because reorder/move write through it optimistically.
  const [workspacesByProject, setWorkspacesByProject] = useState<Record<string, Workspace[]>>({})
  // The cross-workspace runtime view. Live for *every* open Project, not just the one on screen:
  // the sidebar's rows span them all, and a row that only updates when its Project happens to be
  // focused is a row that lies most of the time.
  const sidebarRuntime = useSidebarRuntime()
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string>()
  const [deferredPaneIds, setDeferredPaneIds] = useState<string[]>([])
  const [placements, setPlacements] = useState<WorkspacePlacement[]>([])
  const [monitors, setMonitors] = useState<MonitorInfo[]>([])
  const [monitorPicker, setMonitorPicker] = useState<string>()
  const [gitReview, setGitReview] = useState<{ paneId: string; review: PaneGitReview }>()
  const [gitReviewBusy, setGitReviewBusy] = useState(false)
  // The docked workspace-tool panel (Files editor + future tools) lives in its own per-workspace
  // store so opening/resizing it never remounts the terminal canvas and its state is decoupled
  // from this component. The terminal canvas always stays mounted beside it.
  const panelOpen = useWorkspacePanelStore((state) => state.open)
  const panelMounted = useWorkspacePanelStore((state) => state.mounted)
  const panelWidth = useWorkspacePanelStore((state) => state.width)
  const panelMaximized = useWorkspacePanelStore((state) => state.maximized)
  const panelSurfaces = useWorkspacePanelStore((state) => state.surfaces)
  const panelActiveSurface = useWorkspacePanelStore((state) => state.activeSurface)
  const [panelResizing, setPanelResizing] = useState(false)
  const [projectClosePrompt, setProjectClosePrompt] = useState<{ projectId: string; projectName: string; activeSwarms: number }>()
  const [projectCloseBusy, setProjectCloseBusy] = useState(false)
  // Project switching is passive navigation: it must never summon WebView2's native confirm
  // dialog (and its system alert sound) just to restore the selected Project's last Workspace.
  const quietRestoreWorkspaceId = useRef<string | undefined>(undefined)
  const canvasSaveChain = useRef<Promise<void>>(Promise.resolve())
  // Multi-Project session: which Projects are open in the main window (authority = Rust
  // WindowRegistry; this store is a low-frequency UI cache). Drives the Current Projects section.
  const openProjectSessions = useSessionStore((state) => state.openProjects)
  const projectCache = useSessionStore((state) => state.projects)
  const paneSession = useCallback((paneId: string) => sessions.find((session) => session.paneId === paneId), [sessions])
  const attentionQueue = useMemo(() => sessions
    .map((session): { session: TerminalSession; state: AgentStateEvent } | undefined => {
      const state = terminalRuntime.agentStateForSession(session.id)
      if (!state?.attentionSince) return undefined
      return { session, state }
    })
    .filter((item): item is { session: TerminalSession; state: AgentStateEvent } => Boolean(item))
    .sort((a, b) => (a.state.attentionSince ?? '').localeCompare(b.state.attentionSince ?? '')), [sessions])

  const focusNextAttention = useCallback(() => {
    const target = attentionQueue[0]
    if (!target) return
    setActivePane(target.session.paneId)
    dispatchTerminalAction(target.session.paneId, 'focus')
  }, [attentionQueue, setActivePane])

  const scanProviders = useCallback(async () => {
    const customPaths = [
      settings.claudeExecutablePath && { provider: 'claude', path: settings.claudeExecutablePath },
      settings.codexExecutablePath && { provider: 'codex', path: settings.codexExecutablePath },
      settings.opencodeExecutablePath && { provider: 'opencode', path: settings.opencodeExecutablePath },
    ].filter((item): item is { provider: string; path: string } => Boolean(item))
    const [detections, shells] = await Promise.all([native.detectAgents(false, customPaths), native.detectShells()])
      .finally(() => setDetectingProviders(false))
    setDetections(detections); setShells(shells)
    const ready: ProviderChoice[] = [
      ...detections.filter((item) => item.available && item.executablePath).map((item) => ({ provider: item.provider, name: providerLabel(item.provider), executablePath: item.executablePath!, args: [] })),
      ...shells.map((shell) => shellChoice(shell)),
    ]
    setChoices(ready)
    return ready
  }, [setDetections, setShells, settings.claudeExecutablePath, settings.codexExecutablePath, settings.opencodeExecutablePath])

  // Creation options derived from the detected agents and shells. The default is the configured
  // shell (falling back to the first available one) so the fast path never opens a menu to decide
  // what a "standard terminal" is.
  const defaultChoice = useMemo(() => preferredShell(choices, settings.defaultShell) ?? choices[0], [choices, settings.defaultShell])
  const paneOptions = useMemo<NewPaneOption[]>(() => choices.map((choice) => {
    const agent = AGENT_PROVIDERS.includes(choice.provider)
    return {
      id: choiceOptionId(choice),
      label: choice.name,
      hint: agent ? 'New agent session beside the focused pane' : 'New shell beside the focused pane',
      kind: agent ? 'agent' : 'shell',
    }
  }), [choices])
  const agentMenuOptions = useMemo(
    () => choices.filter((choice) => AGENT_PROVIDERS.includes(choice.provider)).map((choice) => ({ optionId: choiceOptionId(choice), label: choice.name })),
    [choices],
  )
  const choiceForOption = useCallback((optionId: string) => choices.find((choice) => choiceOptionId(choice) === optionId), [choices])

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

  const launchAll = useCallback(async (currentWorkspace: Workspace, freshOverride = false, allowRestorePrompt = true) => {
    const fresh = forceFresh || freshOverride
    terminalRuntime.clearWorkspace(currentWorkspace.id)
    const configuredBehavior = currentWorkspace.restoreBehavior === 'inherit' ? settings.restoreBehavior : currentWorkspace.restoreBehavior
    if (configuredBehavior === 'ask' && !fresh && allowRestorePrompt) {
      const restore = await confirm('Restore the saved Pane assignments now? Choose Cancel to keep every Pane deferred until you resume it.', { title: 'Restore Workspace', kind: 'info' })
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
        // Workspace records can gain backend-owned panes while another route is open (notably
        // Swarm agent terminals). Always re-read the authoritative record on route entry; using
        // the same-id store snapshot strands newly created panes and focuses the wrong agent.
        const loadedWorkspace = await native.getWorkspace(workspaceId)
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
        let alreadyLive = false
        if (forceFresh) {
          // Reuse the saved configuration but start brand-new Terminal Sessions.
          await native.terminateWorkspaceSessions(loadedWorkspace.id).catch(() => undefined)
        }
        // Register this renderer before taking the replay snapshot. Inactive PTYs keep running,
        // but only the workspace currently rendered by this window receives output events.
        const liveSessions = await native.subscribeTerminalOutput(loadedWorkspace.id)
        if (!live) {
          await native.unsubscribeTerminalOutput(loadedWorkspace.id).catch(() => undefined)
          return
        }
        if (liveSessions.length > 0) { terminalRuntime.hydrate(liveSessions); alreadyLive = true }
        // A superseded hydration (rapid workspace switch, remount) must never reach launchAll:
        // its restore would spawn terminals for a screen no longer on display, and with the
        // keep-running policy those sessions silently accumulate in the background.
        if (!live) return
        // Switching back to a Workspace whose Terminal Sessions are still running has nothing to
        // restore, so suppress the "Restore saved Panes?" prompt — re-asking on every tab switch is
        // pure noise. The prompt still appears on a genuine cold open (no live sessions yet).
        const allowRestorePrompt = !alreadyLive && quietRestoreWorkspaceId.current !== loadedWorkspace.id
        quietRestoreWorkspaceId.current = undefined
        await launchAll(loadedWorkspace, false, allowRestorePrompt)
        // If a detached window requested an attach, the main renderer only commits ownership
        // after its canvas, replay tail, and terminal subscriptions are ready.
        await native.completeWorkspaceHandoff(loadedWorkspace.id).catch((caught)=>{
          if(asNativeError(caught).code!=='handoff_not_pending')throw caught
        })
        // Provider version probes can take seconds when a CLI or WSL is unhealthy. They populate
        // menus, but they are not required to reconnect or restore saved PTYs, so keep them off
        // the critical workspace hydration path.
        void scanProviders().catch(() => undefined)
      } catch (caught) { if (live) setError(asNativeError(caught).message) }
      finally { if (live) { setLoading(false); setSwitchingWorkspaceId(undefined) } }
    })()
    return () => {
      live = false
      void native.unsubscribeTerminalOutput(workspaceId).catch(() => undefined)
    }
    // Workspace identity controls hydration. Actions update local state directly.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  useEffect(() => { setCollapsed(!settings.sidebarOpen); setSidebarWidth(clampSidebarWidth(settings.sidebarWidth)) }, [settings.sidebarOpen, settings.sidebarWidth])

  // Run an optional startup command (from the setup wizard) once, in the first pane, after its
  // session is live. Guarded by a sessionStorage flag so it only fires for a freshly-launched
  // workspace and never re-runs on restore or workspace switches.
  const startupRan = useRef(false)
  useEffect(() => {
    if (startupRan.current || !workspace) return
    const key = `forgemind.startup.${workspace.id}`
    let command: string | null = null
    try { command = sessionStorage.getItem(key) } catch { command = null }
    if (!command) return
    const firstPane = workspace.panes[0]
    const session = firstPane ? sessions.find((item) => item.paneId === firstPane.id && item.status === 'running') : undefined
    if (!session) return
    startupRan.current = true
    try { sessionStorage.removeItem(key) } catch { /* ignore */ }
    void native.writeTerminalInput(session.id, Array.from(new TextEncoder().encode(`${command}\r`))).catch(() => undefined)
  }, [sessions, workspace])

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

  // ---- Docked workspace-tool panel --------------------------------------------------------
  // Restore this Workspace's own panel state (open/width/maximized/tool). init() no-ops when the
  // id is unchanged, so a remount never clobbers live state.
  useEffect(() => { useWorkspacePanelStore.getState().init(workspaceId) }, [workspaceId])

  const togglePanel = useCallback(() => {
    const store = useWorkspacePanelStore.getState()
    if (store.open) store.closePanel()
    else store.openPanel()
  }, [])

  const openSourceControl = useCallback(() => {
    useWorkspacePanelStore.getState().openSurface('diff')
  }, [])

  // Focus a Pane from the Agents surface: same "select + focus the terminal" pair the attention
  // chip uses, just addressable by an arbitrary paneId instead of always the oldest waiting one.
  const focusPane = useCallback((paneId: string) => {
    setActivePane(paneId)
    dispatchTerminalAction(paneId, 'focus')
  }, [setActivePane])

  // "Send to Active Agent" from the Browser's Inspect mode: paste the focused, sanitized context
  // package into the active pane's terminal so the user can review it and press Enter to submit.
  // No trailing newline is written, so it can never auto-run in a plain shell.
  const sendContextToAgent = useCallback(async (pkg: AgentContextPackage) => {
    const session = activePaneId ? sessions.find((item) => item.paneId === activePaneId) : undefined
    if (!session || session.status !== 'running') {
      setError('Focus a running terminal to receive the selected element context.')
      return
    }
    try {
      await native.writeTerminalInput(session.id, Array.from(new TextEncoder().encode(pkg.prompt)))
      dispatchTerminalAction(session.paneId, 'focus')
    } catch (caught) {
      setError(asNativeError(caught).message)
    }
  }, [activePaneId, sessions])

  // Drag the divider between the terminal and the panel. Width updates are rAF-throttled and only
  // mutate a CSS variable + the store — the layout tree is never rebuilt, so terminals never remount.
  const startPanelResize = useCallback((event: ReactPointerEvent) => {
    event.preventDefault()
    const host = event.currentTarget.parentElement as HTMLElement | null
    const startX = event.clientX
    const startWidth = useWorkspacePanelStore.getState().width
    setPanelResizing(true)
    let frame = 0
    const move = (moveEvent: PointerEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        // Dragging left (toward the terminal) widens the panel.
        const delta = startX - moveEvent.clientX
        const hostWidth = host?.clientWidth ?? window.innerWidth
        const maxByHost = hostWidth - 226 // keep the terminal usable + the resize track
        useWorkspacePanelStore.getState().setWidth(Math.max(240, Math.min(clampPanelWidth(startWidth + delta), maxByHost)))
      })
    }
    const up = () => {
      if (frame) cancelAnimationFrame(frame)
      setPanelResizing(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  const refreshWorkspaces = useCallback(async (currentProjectId?: string) => {
    const projectId = currentProjectId ?? project?.id
    // The sidebar list spans every open Project, so fetch the background Projects' Workspaces
    // too. Their runtime no longer comes from here at all — it is carried by events through the
    // cross-workspace runtime view — so this is a catalog read only.
    const backgroundIds = openProjectSessions
      .map((session) => session.projectId)
      .filter((id) => id !== projectId)
    try {
      const [recent, list, background] = await Promise.all([
        native.listRecentWorkspaces(),
        projectId ? native.listWorkspacesForProject(projectId) : Promise.resolve([] as Workspace[]),
        Promise.all(
          backgroundIds.map(async (id) =>
            // A background Project whose folder vanished must not fail the whole refresh.
            [id, await native.listWorkspacesForProject(id).catch(() => [] as Workspace[])] as const,
          ),
        ),
      ])
      setRecentWorkspaces(recent)
      setProjectWorkspaces(list)
      setWorkspacesByProject(Object.fromEntries(background))
      // Repair anything the runtime view missed while nothing was listening — a Session that died
      // during a reload, or one belonging to a Project that was just opened.
      void resyncSidebarRuntime().catch(() => undefined)
    } catch (caught) {
      setError(asNativeError(caught).message)
    }
  }, [project?.id, openProjectSessions, setRecentWorkspaces])

  // Load Workspace placements + monitors (low-frequency; never terminal output). Drives the
  // "This window" vs "Other monitors" sidebar split and the Move-to-Monitor picker.
  const refreshPlacements = useCallback(async (currentProjectId?: string) => {
    const projectId = currentProjectId ?? project?.id
    if (!projectId) return
    try {
      const [placementList, monitorList] = await Promise.all([
        native.listWorkspacePlacements(projectId),
        native.listMonitors().catch(() => [] as MonitorInfo[]),
      ])
      setPlacements(placementList)
      setMonitors(monitorList)
    } catch { /* placement is non-essential UI cache; never block the workspace on it */ }
  }, [project?.id])

  const handleMonitorChanged = useCallback(() => {
    void refreshPlacements()
  }, [refreshPlacements])

  useEffect(() => { void refreshWorkspaces(); void refreshPlacements() }, [refreshWorkspaces, refreshPlacements, workspaceId])

  // Seed the cross-workspace runtime view once, so Sessions that were already running before this
  // window existed are known without waiting for an event that will never arrive for them.
  useEffect(() => { void startSidebarRuntime().catch(() => undefined) }, [])

  // Sidebar view preferences live in the settings database, not in this renderer. Read them back
  // on mount and follow the broadcast, so no window drifts from the persisted choice.
  useEffect(() => {
    void hydrateSidebarPreferences().catch(() => undefined)
    const pending = onSidebarPreferencesChanged((preferences) => {
      useSidebarStore.getState().applyPreferences(preferences)
    })
    return () => { void pending.then((unlisten) => unlisten()).catch(() => undefined) }
  }, [])

  // ---- Multi-Project session (several Projects open at once in the main window) ------------
  // Register the focused Project as open+active and cache the other open Projects' metadata so
  // the Current Projects section can name them. Best-effort: never block the workspace on it.
  const registerOpenProject = useCallback(async (openedProject: Project) => {
    try {
      const list = await native.openProjectSession(openedProject.id, true)
      const store = useSessionStore.getState()
      store.setOpenProjects(list)
      store.upsertProject(openedProject)
      await Promise.all(list.map(async (session) => {
        if (session.projectId !== openedProject.id && !useSessionStore.getState().projects[session.projectId]) {
          const meta = await native.getProject(session.projectId).catch(() => undefined)
          if (meta) useSessionStore.getState().upsertProject(meta)
        }
      }))
    } catch { /* session cache is best-effort */ }
  }, [])

  useEffect(() => { if (project) void registerOpenProject(project) }, [project, registerOpenProject])

  // Remember this Project's last-active Workspace + Pane so focusing it later restores exactly
  // this view. Kept separate per Project so switching never leaks one Project's state into another.
  useEffect(() => {
    if (!project?.id || !workspace?.id) return
    try {
      void native.setProjectLastActive(project.id, workspace.id, activePaneId)?.catch(() => undefined)
    } catch { /* binding unavailable (e.g. tests / older backend) */ }
  }, [project?.id, workspace?.id, activePaneId])

  // Focus an already-open Project without closing the others: mark it active in the session,
  // then navigate to its remembered last Workspace (or its first, or setup when it has none).
  const selectProject = useCallback(async (projectId: string) => {
    if (projectId === project?.id) return
    try {
      const list = await native.setActiveProject(projectId)
      useSessionStore.getState().setOpenProjects(list)
      const target = list.find((session) => session.projectId === projectId)
      let nextWorkspaceId = target?.lastWorkspaceId
      if (!nextWorkspaceId) {
        const list = await native.listWorkspacesForProject(projectId).catch(() => [] as Workspace[])
        nextWorkspaceId = list[0]?.id
      }
      if (nextWorkspaceId) {
        quietRestoreWorkspaceId.current = nextWorkspaceId
        setSwitchingWorkspaceId(nextWorkspaceId)
        navigate(`/workspace/${nextWorkspaceId}`)
      }
      else navigate(`/setup/${projectId}`)
    } catch (caught) { setError(asNativeError(caught).message) }
  }, [project?.id, navigate])

  const openProjectFromSelection = useCallback(async (projectId: string) => {
    if (openProjectSessions.some((session)=>session.projectId===projectId)) { await selectProject(projectId); return }
    try {
      const sessions=await native.openProjectSession(projectId,true)
      useSessionStore.getState().setOpenProjects(sessions)
      const meta=await native.getProject(projectId);useSessionStore.getState().upsertProject(meta)
      const target=sessions.find((session)=>session.projectId===projectId)
      const workspaces=await native.listWorkspacesForProject(projectId)
      const next=target?.lastWorkspaceId??workspaces[0]?.id
      if (next) quietRestoreWorkspaceId.current = next
      navigate(next?`/workspace/${next}`:`/setup/${projectId}`)
    } catch (caught) { setError(asNativeError(caught).message) }
  },[navigate,openProjectSessions,selectProject])

  // Complete a Project close after the Swarm policy is explicit. The backend validates the
  // Project/Swarm binding again and atomically refuses an omitted choice if active work exists.
  const completeProjectClose = useCallback(async (
    projectId: string,
    swarmBehavior?: 'keep_running' | 'pause_and_close',
  ) => {
    setProjectCloseBusy(true)
    try {
      if (settings.inactiveWorkspaceProcesses !== 'keep_running') {
        const stop = settings.inactiveWorkspaceProcesses === 'stop'
          || window.confirm('Stop this project\'s running terminals? Choose Cancel to leave them running in the background.')
        if (stop) {
          const projectWorkspaceList = await native.listWorkspacesForProject(projectId).catch(() => [] as Workspace[])
          await Promise.all(projectWorkspaceList.map((item) => native.terminateWorkspaceSessions(item.id).catch(() => undefined)))
        }
      }
      let list = await native.closeProjectSession(projectId, swarmBehavior)
      const closedActive = projectId === project?.id
      if (closedActive && list.length > 0 && !list.some((session) => session.isActive)) {
        list = await native.setActiveProject(list[list.length - 1].projectId)
      }
      useSessionStore.getState().setOpenProjects(list)
      if (closedActive) {
        const next = list.find((session) => session.isActive) ?? list[0]
        const nextWorkspaceId = next?.lastWorkspaceId
        if (nextWorkspaceId) { setSwitchingWorkspaceId(nextWorkspaceId); navigate(`/workspace/${nextWorkspaceId}`) }
        else navigate('/')
      }
      setProjectClosePrompt(undefined)
    } catch (caught) { setError(asNativeError(caught).message) }
    finally { setProjectCloseBusy(false) }
  }, [project?.id, navigate, settings.inactiveWorkspaceProcesses])

  // Closing with active Swarms is always a three-way decision: keep running, pause-and-close,
  // or cancel. The selected Project is already known; the dialog never asks for it again.
  const closeProject = useCallback(async (projectId: string) => {
    try {
      const activeSwarms = (await native.listSwarms(projectId)).filter((item) =>
        isActiveLifecycle(item.swarm.lifecycle),
      ).length
      if (activeSwarms > 0) {
        setProjectClosePrompt({
          projectId,
          projectName: projectCache[projectId]?.name ?? (project?.id === projectId ? project.name : 'Project'),
          activeSwarms,
        })
        return
      }
      await completeProjectClose(projectId)
    } catch (caught) { setError(asNativeError(caught).message) }
  }, [completeProjectClose, project?.id, project?.name, projectCache])

  // ---- Multi-monitor Workspace handoff (client guards; PTYs stay alive in Rust) -----------
  const runHandoff = useCallback(async (id: string, intent: WorkspaceWindowIntent, options?: { monitorId?: string }) => {
    const placement = placements.find((item) => item.workspaceId === id)
    try {
      return await handoffController.run(id, placement, intent, options)
    } catch (caught) {
      setError(asNativeError(caught).message)
      return undefined
    } finally {
      await refreshPlacements()
    }
  }, [placements, refreshPlacements])

  const openInNewWindow = useCallback(async (id: string) => {
    const wasActive = id === workspace?.id
    const placement = await runHandoff(id, 'open-in-new-window')
    // If the now-detached Workspace was the one on the main canvas, move the main window to
    // another attached Workspace so there is never a stale/read-only duplicate view here.
    // A failed handoff must leave the current route in place: otherwise its error disappears
    // with the Workspace screen and the user is left thinking the command did nothing.
    if (wasActive && placement?.mode === 'detached') {
      const fallback = projectWorkspaces.find((item) => item.id !== id)
      if (fallback) { setSwitchingWorkspaceId(fallback.id); navigate(`/workspace/${fallback.id}`) }
      else navigate('/')
    }
  }, [runHandoff, workspace?.id, projectWorkspaces, navigate])

  // Focus a detached Workspace's window, or recreate it if it was closed with "Keep running in
  // background". detach_workspace focuses an existing window or rebuilds a missing one, so this
  // never spawns a duplicate — it just brings a backgrounded Workspace back on screen.
  const focusOrReopen = useCallback(async (id: string) => {
    try {
      await native.focusWorkspaceWindow(id)
    } catch {
      try {
        await native.detachWorkspace(id)
      } catch (caught) {
        setError(asNativeError(caught).message)
      }
    }
    await refreshPlacements()
  }, [refreshPlacements])

  const chooseMonitor = useCallback(async (monitorId: string) => {
    const id = monitorPicker
    setMonitorPicker(undefined)
    if (id) await runHandoff(id, 'move-to-monitor', { monitorId })
  }, [monitorPicker, runHandoff])

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
    const targetWorkspaceId = store.workspaceId
    syncWorkspaceLayout(next)
    // Revision-checked writes must be serialized. Rapid keyboard docking or a pane mutation
    // followed by a drag previously sent the same revision twice; the loser then rolled the UI
    // back underneath the user's newer action.
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
      // Do not destroy a newer optimistic layout if an earlier queued save failed.
      if (current.layout === next) {
        current.setLayout(previous)
        syncWorkspaceLayout(previous)
      }
      setError(asNativeError(caught).message)
    })
  }, [syncWorkspaceLayout])

  // Composition presets. A preset only rewrites placement in the canvas layout — pane ids, their
  // terminal sessions and their PTYs are untouched — so rearranging a busy workspace never costs
  // an agent its process. The whole set is marked settling so neighbours reflow as one movement.
  const applyPreset = useCallback((preset: LayoutPresetId) => {
    const store = useCanvasStore.getState()
    const current = store.layout
    if (!current) return
    const next = applyLayoutPreset(current, preset)
    if (next === current) return
    store.markSettling(allPaneIds(next))
    store.setLayout(next)
    persistCanvas(next, current)
    window.setTimeout(() => useCanvasStore.getState().clearSettling(), CANVAS_CONSTANTS.settleAnimationMs + 40)
  }, [persistCanvas])

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

  useEffect(() => {
    const refresh = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceId: string; paneId: string }>).detail
      if (!detail || detail.workspaceId !== workspaceId) return
      void native.getWorkspace(workspaceId).then((next) => {
        setLocalWorkspace(next)
        setWorkspace(next)
        resyncCanvas(next)
        setActivePane(detail.paneId)
      }).catch((caught) => setError(asNativeError(caught).message))
    }
    window.addEventListener(WORKSPACE_CONFIGURATION_CHANGED, refresh)
    return () => window.removeEventListener(WORKSPACE_CONFIGURATION_CHANGED, refresh)
  }, [resyncCanvas, setActivePane, setWorkspace, workspaceId])

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
    if (launchingPaneIds.current.has(paneId)) return
    const assignment = workspace.panes.find((pane) => pane.id === paneId)
    if (!assignment) return
    launchingPaneIds.current.add(paneId)
    try {
      const session = paneSession(paneId)
      if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
      if (session) terminalRuntime.remove(session.id)
      setDeferredPaneIds((current) => current.filter((id) => id !== paneId))
      await launchPane(assignment, workspace)
    } finally {
      launchingPaneIds.current.delete(paneId)
    }
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

  const isolatePaneWorktree = async (paneId: string) => {
    if (!workspace) return
    const session = paneSession(paneId)
    if (session?.status === 'running' && !window.confirm('Create an isolated git worktree for this pane and restart its terminal there?')) return
    try {
      if (session?.status === 'running') await native.terminateTerminalSession(session.id)
      if (session) terminalRuntime.remove(session.id)
      const result = await native.createIsolatedPaneWorktree(workspace.id, paneId)
      setLocalWorkspace(result.workspace)
      setWorkspace(result.workspace)
      setProjectWorkspaces((items) => items.map((item) => item.id === result.workspace.id ? result.workspace : item))
      const pane = result.workspace.panes.find((item) => item.id === paneId)
      if (pane) await launchPane(pane, result.workspace)
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message }))
    }
  }

  const openPaneReview = async (paneId: string) => {
    if (!workspace) return
    setGitReviewBusy(true)
    try {
      const review = await native.getPaneGitReview(workspace.id, paneId)
      setGitReview({ paneId, review })
    } catch (caught) {
      setPaneErrors((current) => ({ ...current, [paneId]: asNativeError(caught).message }))
    } finally {
      setGitReviewBusy(false)
    }
  }

  const stageReviewFile = async (path: string) => {
    if (!workspace || !gitReview) return
    setGitReviewBusy(true)
    try {
      const review = await native.stagePaneFile(workspace.id, gitReview.paneId, path)
      setGitReview({ paneId: gitReview.paneId, review })
    } catch (caught) { setError(asNativeError(caught).message) }
    finally { setGitReviewBusy(false) }
  }

  const restoreReviewFile = async (path: string) => {
    if (!workspace || !gitReview) return
    if (!window.confirm(`Discard staged, unstaged, conflicted, or untracked changes for ${path}? This only affects the selected repository path.`)) return
    setGitReviewBusy(true)
    try {
      const review = await native.restorePaneFile(workspace.id, gitReview.paneId, path, true)
      setGitReview({ paneId: gitReview.paneId, review })
    } catch (caught) { setError(asNativeError(caught).message) }
    finally { setGitReviewBusy(false) }
  }

  const restartPaneFromWorkspace = async (paneId: string, source: Workspace) => {
    const session = paneSession(paneId)
    if (session?.status === 'running') await native.terminateTerminalSession(session.id).catch(() => undefined)
    if (session) terminalRuntime.remove(session.id)
    const pane = source.panes.find((item) => item.id === paneId)
    if (pane) await launchPane(pane, source)
  }

  const replacePane = async (choice: ProviderChoice) => {
    if (!workspace || !pendingReplace) return
    const target = workspace.panes.find((pane) => pane.id === pendingReplace.targetPaneId)
    if (!target) return
    const session = paneSession(target.id)
    if (session?.status === 'running' && !window.confirm('Replace this terminal? The current process will stop.')) return
    if (session?.status === 'running') await native.terminateTerminalSession(session.id)
    if (session) terminalRuntime.remove(session.id)
    const pane = { ...target, provider: choice.provider, title: choice.name, executablePath: choice.executablePath, args: choice.args, shellProfileId: choice.shellProfileId }
    const next = await persist({ ...workspace, panes: workspace.panes.map((item) => item.id === pane.id ? pane : item) })
    setPendingReplace(undefined); await launchPane(pane, next)
  }

  /**
   * Create a pane and start its session. Placement is resolved from the live canvas geometry, so
   * the new pane is tiled beside the focused context along whichever axis still leaves both sides
   * usable — never appended as one more equal cell. `request` lets an explicit action (Split right,
   * New terminal here) pin the target and/or axis; everything it omits is resolved spatially.
   *
   * The new pane inherits the target's working directory and directory mode, which is how a
   * worktree-isolated context is expressed — so "beside my worktree pane" lands in that worktree
   * while still starting an independent process. `duplicate` copies the whole assignment instead.
   */
  const createPane = async (spec: { choice?: ProviderChoice; duplicate?: PaneAssignment }, request?: CreateRequest) => {
    if (!workspace || !project || creatingPaneRef.current) return
    const choice = spec.choice ?? defaultChoice
    if (!spec.duplicate && !choice) { setError(detectingProviders ? 'Still detecting available agents and shells. Try again in a moment.' : 'No agent or shell is available to start a new terminal.'); return }

    const canvas = useCanvasStore.getState()
    const docked = canvas.layout?.dockedRoot ?? workspace.layout
    const focusPaneId = request?.targetPaneId ?? canvas.layout?.activePaneId ?? activePaneId
    const placement = resolvePanePlacement(canvas.layout, canvas.bounds, focusPaneId, paneIds(docked)[0])
    // An explicit axis means the user asked for that shape at that pane; only the axis-free
    // actions defer to the spatial choice of target.
    const requestedTarget = request?.direction ? request.targetPaneId : undefined
    const targetPaneId = requestedTarget && findDockPath(docked, requestedTarget) ? requestedTarget : placement.targetPaneId
    const direction = request?.direction ?? placement.direction
    if (!findDockPath(docked, targetPaneId)) { setError('The workspace layout has no pane to place a new terminal beside.'); return }

    const context = workspace.panes.find((pane) => pane.id === targetPaneId)
    const source = spec.duplicate
    const newPaneId = newId()
    creatingPaneRef.current = true
    setCreatingPane(true)
    try {
      const layout = normalizeSplitTree(insertPaneBesideTarget(docked, targetPaneId, newPaneId, insertZoneFor(direction))) ?? docked
      const pane: PaneAssignment = source
        ? { ...source, id: newPaneId, workspaceId: workspace.id, title: `${source.title} copy`, positionOrder: workspace.panes.length }
        : {
            id: newPaneId,
            workspaceId: workspace.id,
            title: choice!.name,
            provider: choice!.provider,
            executablePath: choice!.executablePath,
            args: choice!.args,
            shellProfileId: choice!.shellProfileId,
            workingDirectory: context?.workingDirectory || project.rootPath,
            workingDirectoryMode: context?.workingDirectoryMode ?? 'project_relative',
            positionOrder: workspace.panes.length,
          }
      const next = await persist({ ...workspace, layout, panes: [...workspace.panes, pane], activePaneId: newPaneId })
      setActivePane(newPaneId)
      await launchPane(pane, next)
      dispatchTerminalAction(newPaneId, 'focus')
    } catch (caught) {
      setError(asNativeError(caught).message)
    } finally {
      creatingPaneRef.current = false
      setCreatingPane(false)
    }
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

  const revealProjectById=useCallback(async(projectId:string)=>{const meta=projectId===project?.id?project:(projectCache[projectId]??await native.getProject(projectId));await openPath(meta.rootPath)},[project,projectCache])
  const refreshProjectById=useCallback(async(projectId:string)=>{if(projectId===project?.id){await refreshProject();return}const meta=projectCache[projectId]??await native.getProject(projectId);const refreshed=await native.openProject(meta.rootPath);useSessionStore.getState().upsertProject(refreshed)},[project?.id,projectCache,refreshProject])

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
    onSelectProject: (id) => void selectProject(id),
    onCloseProject: (id) => void closeProject(id),
    onOpenProject: (id) => void openProjectFromSelection(id),
    onCreateProjectWorkspace: (id) => navigate(`/setup/${id}`),
    onRevealProject: (id) => void revealProjectById(id),
    onRefreshProjectById: (id) => void refreshProjectById(id),
    onOpenLauncher: () => navigate('/'),
    onOpenSettings: () => navigate('/settings'),
    onOpenRepository: openSourceControl,
    onOpenDatabase: () => { if (project) navigate(`/database/${project.id}`) },
    onOpenMemory: () => { if (project) navigate(`/memory/${project.id}`) },
    onOpenUsage: () => navigate('/usage'),
    onToggleCollapse: toggleCollapse,
    onResizeCommit: commitSidebarWidth,
    onOpenInNewWindow: (id) => void openInNewWindow(id),
    onAttachWorkspace: (id) => void runHandoff(id, 'attach-to-main'),
    onFocusWorkspaceWindow: (id) => void focusOrReopen(id),
    onMoveToMonitor: (id) => setMonitorPicker(id),
    onCloseWorkspaceWindow: (id) => void runHandoff(id, 'close-window'),
  }), [switchWorkspace, openFresh, newWorkspace, renameWorkspaceById, reconfigureWorkspaceById, duplicateWorkspace, restartWorkspaceById, stopWorkspaceById, moveWorkspace, reorderWorkspaces, removeFromRecents, deleteWorkspaceById, openProjectFolder, locateFolder, refreshProject, navigate, toggleCollapse, commitSidebarWidth, openInNewWindow, runHandoff, focusOrReopen, selectProject, closeProject, openProjectFromSelection, revealProjectById, refreshProjectById, project, openSourceControl])

  const sidebarWorkspaces: SidebarWorkspace[] = useMemo(
    () =>
      projectWorkspaces.map((item) =>
        deriveSidebarWorkspace(item, sidebarRuntime, item.id === workspaceId ? deferredPaneIds : []),
      ),
    [projectWorkspaces, sidebarRuntime, workspaceId, deferredPaneIds],
  )

  // Every open Project with its Workspaces — the grouped primary list. The active Project reuses
  // `sidebarWorkspaces` (which already folds in this screen's live sessions and deferred Panes);
  // background Projects derive purely from the global snapshot.
  const sidebarGroups: SidebarProjectGroup[] = useMemo(() => {
    return openProjectSessions
      .map((session): SidebarProjectGroup | undefined => {
        const isCurrent = session.projectId === project?.id
        const meta = isCurrent ? project : projectCache[session.projectId]
        if (!meta) return undefined
        const workspaces = isCurrent
          ? sidebarWorkspaces
          : (workspacesByProject[session.projectId] ?? []).map((item) =>
              deriveSidebarWorkspace(item, sidebarRuntime, []),
            )
        const folderMissing =
          recentWorkspaces.find((item) => item.workspace.projectId === session.projectId)?.projectMissing ?? false
        const running = workspaces.reduce((sum, item) => sum + item.runtime.runningCount, 0)
        return {
          project: meta,
          isActive: session.isActive,
          folderMissing,
          workspaces,
          runtimeSummary: folderMissing
            ? 'Folder unavailable'
            : running > 0
              ? `${running} running`
              : undefined,
        }
      })
      .filter((item): item is SidebarProjectGroup => Boolean(item))
  }, [
    openProjectSessions,
    project,
    projectCache,
    sidebarWorkspaces,
    workspacesByProject,
    sidebarRuntime,
    recentWorkspaces,
  ])

  const projectFolderMissing = useMemo(() => {
    if (!project) return false
    const record = recentWorkspaces.find((item) => item.workspace.projectId === project.id)
    return record?.projectMissing ?? false
  }, [project, recentWorkspaces])

  const sidebarOpenProjects: SidebarOpenProject[] = useMemo(() => {
    return openProjectSessions
      .map((session): SidebarOpenProject | undefined => {
        const meta = session.projectId === project?.id ? project : projectCache[session.projectId]
        if (!meta) return undefined
        const missing=recentWorkspaces.find((item)=>item.workspace.projectId===session.projectId)?.projectMissing??false
        const attention=session.projectId===project?.id&&sidebarWorkspaces.some((item)=>item.runtime.requiresAttention)
        return {
          project: meta,
          isActive: session.isActive,
          folderMissing: missing,
          state: missing ? 'missing' : attention ? 'attention' : session.isActive ? 'active' : 'background',
          runtimeSummary: session.isActive ? `${sidebarWorkspaces.reduce((sum,item)=>sum+item.runtime.runningCount,0)} running terminals` : 'Background · terminals retained',
        }
      })
      .filter((item): item is SidebarOpenProject => Boolean(item))
  }, [openProjectSessions, projectCache, project, recentWorkspaces, sidebarWorkspaces])

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (!workspace) return
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleCollapse(); return }
      if (event.ctrlKey && event.key.toLowerCase() === 'b' && !event.shiftKey) { event.preventDefault(); toggleCollapse(); return }
      // Toggle the docked Files panel. Works from either terminal or editor focus.
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'e') { event.preventDefault(); togglePanel(); return }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'p') { event.preventDefault(); focusNextAttention(); return }
      // Tidy the composition. Placement-only, so it is safe to fire from any focus in the canvas.
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); applyPreset('tidy'); return }
      if (event.ctrlKey && event.altKey && /^[1-9]$/.test(event.key)) {
        event.preventDefault(); const target = projectWorkspaces[Number(event.key) - 1]; if (target && target.id !== workspace.id) void switchWorkspace(target.id); return
      }
      if (!activePaneId) return
      // Terminal/pane shortcuts must never fire while Monaco (or anything in the tool panel) owns
      // focus — otherwise editing would silently split panes, close terminals, etc.
      if (document.activeElement?.closest('.workspace-tool-panel')) return
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'f') { event.preventDefault(); dispatchTerminalAction(activePaneId, 'search') }
      // Creation is a one-key action: a standard terminal, placed beside the focused pane, no
      // picker. Ctrl+Shift+\ and Ctrl+Shift+- pin the axis for when the shape matters.
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); void createPane({}) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Backslash') { event.preventDefault(); void createPane({}, { targetPaneId: activePaneId, direction: 'vertical' }) }
      if (event.ctrlKey && event.shiftKey && event.code === 'Minus') { event.preventDefault(); void createPane({}, { targetPaneId: activePaneId, direction: 'horizontal' }) }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'w') { event.preventDefault(); void closePane(activePaneId) }
      if (event.ctrlKey && event.shiftKey && event.key === 'Enter') { event.preventDefault(); useCanvasStore.getState().toggleMaximize(activePaneId) }
      if (event.ctrlKey && event.key === ',') { event.preventDefault(); navigate('/settings') }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'g') { event.preventDefault(); openSourceControl(); return }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'o') { event.preventDefault(); navigate('/') }
      if (event.ctrlKey && (event.key === 'PageDown' || event.key === 'PageUp')) {
        event.preventDefault(); const ids = paneIds(workspace.layout); const index = ids.indexOf(activePaneId); const delta = event.key === 'PageDown' ? 1 : -1; setActivePane(ids[(index + delta + ids.length) % ids.length]);
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  // closePane reads current state and is intentionally rebound with the other workspace values.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [activePaneId, applyPreset, focusNextAttention, navigate, setActivePane, workspace, projectWorkspaces, switchWorkspace, toggleCollapse, togglePanel, openSourceControl])

  // Render one terminal for a pane inside its canvas window. The docking canvas owns geometry,
  // placement and the header drag handle; this only wires the terminal + its pane actions. The
  // TerminalPane keeps a stable React key (its paneId) so its xterm/PTY never remount on moves.
  const renderPane = (paneId: string, ctx: RenderPaneContext) => {
    const assignment = workspace?.panes.find((pane) => pane.id === paneId)
    if (!assignment) return <div className="terminal-failure"><ErrorNotice message="This layout pane has no saved assignment." /></div>
    const session = sessions.find((item) => item.paneId === paneId)
    return <>
      <TerminalPane assignment={assignment} session={session} deferred={deferredPaneIds.includes(paneId)} active={ctx.active} maximized={ctx.maximized} settings={settings}
        onFocus={() => {
          setActivePane(paneId)
          // Only a real pointer focus resumes a budget-deferred Pane. Hydration changes the
          // shared active Pane several times; treating those state writes as user intent leaked
          // extra agent processes immediately after startup and defeated the global budget.
          if (deferredPaneIds.includes(paneId)) void restartPane(paneId)
        }}
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
    titleBar={<><div className="workspace-heading"><strong title={workspace.name}>{workspace.name}</strong>{project.gitBranch && <span className="branch-label" title={`Branch: ${project.gitBranch}`}>{project.gitBranch}</span>}</div><div className="titlebar-spacer" /><ActivityPulse />{attentionQueue.length > 0 && <button className="attention-chip" onClick={focusNextAttention} title="Ctrl+Shift+P focuses the oldest agent needing attention">{attentionQueue.length} agent{attentionQueue.length === 1 ? '' : 's'} waiting</button>}<span className={`compact-count ${running >= SESSION_PRESSURE_THRESHOLD ? 'is-pressured' : ''}`} title={running >= SESSION_PRESSURE_THRESHOLD ? `${running} live sessions — this many concurrent terminals and agents can slow the machine` : undefined}>{running}/{workspace.panes.length} running</span><NewPaneMenu options={paneOptions} defaultOptionId={defaultChoice ? choiceOptionId(defaultChoice) : undefined} liveSessions={running} idleSessions={Math.max(0, workspace.panes.length - running)} busy={creatingPane} detecting={detectingProviders} onCreate={(optionId) => void createPane({ choice: choiceForOption(optionId) })} onDuplicateContext={() => { const pane = workspace.panes.find((item) => item.id === activePaneId) ?? workspace.panes[0]; if (pane) void createPane({ duplicate: pane }) }} onInspectSessions={openAgentResumeCenter} /><LayoutMenu paneCount={workspace.panes.length} onApply={applyPreset} /><button className={`workspace-tool-panel-toggle ${panelOpen ? 'is-active' : ''}`} aria-pressed={panelOpen} aria-label={panelOpen ? 'Close workspace panel' : 'Open workspace panel'} title={`${panelOpen ? 'Close' : 'Open'} workspace panel (Ctrl+Shift+E)`} onClick={() => togglePanel()}>{panelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}</button><div className="workspace-menu-wrap"><Button variant="ghost" icon={<ChevronDown size={14} />} aria-expanded={workspaceMenu} aria-haspopup="menu" onClick={() => setWorkspaceMenu((value) => !value)}>Workspace</Button>{workspaceMenu && <><button className="context-scrim" aria-label="Close workspace menu" onClick={() => setWorkspaceMenu(false)} /><div className="context-popover workspace-popover" role="menu"><button role="menuitem" onClick={() => { setWorkspaceMenu(false); renameWorkspaceById(workspace.id) }}>Rename workspace</button><button role="menuitem" onClick={reconfigureWorkspace}>Reconfigure workspace</button><button role="menuitem" onClick={() => navigate(`/setup/${project.id}`)}>New workspace for this project</button><span className="menu-separator" /><button role="menuitem" onClick={() => { setWorkspaceMenu(false); openAgentResumeCenter() }}><RotateCcw size={14} />Agent Resume Center</button><button role="menuitem" onClick={() => void restartAll()}><RotateCcw size={14} />Restart all terminals</button><button role="menuitem" onClick={() => void stopAll()}><CircleStop size={14} />Stop all terminals</button><button role="menuitem" onClick={openLauncher}><FolderOpen size={14} />Project launcher</button><button role="menuitem" className="danger-item" onClick={() => void closeWorkspace()}>Close workspace</button></div></>}</div></>}
    sidebar={<ForgeSpaceSidebar project={project} activeWorkspaceId={workspace.id} workspaces={sidebarWorkspaces} recents={recentWorkspaces} collapsed={collapsed} width={sidebarWidth} switchingWorkspaceId={switchingWorkspaceId} projectFolderMissing={projectFolderMissing} loadingWorkspaces={projectWorkspaces.length === 0 && loading} actions={sidebarActions} placements={placements} monitors={monitors} openProjects={sidebarOpenProjects} groups={sidebarGroups} runtimeSeeded={sidebarRuntime.seeded} />}
    canvas={<>{error && <div className="workspace-error"><ErrorNotice message={error} onRetry={() => void restartAll()} /></div>}<MonitorRecoveryWatcher monitors={monitors} onChanged={handleMonitorChanged} /><div className={`workspace-surface-host${panelOpen && !panelMaximized ? ' has-panel' : ''}${panelOpen && panelMaximized ? ' is-panel-max' : ''}${panelResizing ? ' is-resizing' : ''}`} style={{ '--tool-panel-width': `${panelWidth}px` } as CSSProperties}><section className="terminal-canvas"><WorkspaceCanvas reducedMotion={reducedMotion} persist={persistCanvas} onFocusPane={setActivePane} renderPane={renderPane} /></section>{panelOpen && !panelMaximized && <div className="tool-panel-resizer" role="separator" aria-orientation="vertical" aria-label="Resize workspace panel" onPointerDown={startPanelResize} />}{panelMounted && <WorkspaceToolPanel projectId={project.id} projectRootPath={project.rootPath} workspaceId={workspace.id} visible={panelOpen} maximized={panelMaximized} surfaces={panelSurfaces} activeSurface={panelActiveSurface} browserContext={{ workspaceId: workspace.id, workspaceName: workspace.name, projectId: project.id, projectName: project.name, worktree: project.gitBranch ?? undefined, agentLabel: activePane?.title }} agents={{ panes: workspace.panes, sessions, activePaneId, onFocusPane: focusPane }} onSendToAgent={sendContextToAgent} onSelectSurface={(kind: SurfaceKind) => useWorkspacePanelStore.getState().focusSurface(kind)} onOpenSurface={(kind: SurfaceKind) => useWorkspacePanelStore.getState().openSurface(kind)} onCloseSurface={(kind: SurfaceKind) => useWorkspacePanelStore.getState().closeSurface(kind)} onReorderSurface={(kind: SurfaceKind, index: number) => useWorkspacePanelStore.getState().reorderSurface(kind, index)} onToggleMaximize={() => useWorkspacePanelStore.getState().toggleMaximized()} onClose={() => useWorkspacePanelStore.getState().closePanel()} />}</div></>}
    statusBar={<><span>{project.gitBranch || 'No branch'}</span><span className="status-path" title={project.rootPath}>{project.name}</span><span>{running}/{workspace.panes.length} running</span><span>{activePane?.title || 'No active pane'}</span><AiUsageStatusBar />{attentionQueue.length > 0 && <span className="status-alert">{attentionQueue.length} agent attention</span>}{Object.keys(paneErrors).some((id) => paneErrors[id]) && <span className="status-alert">Pane error</span>}</>}
  >
    {projectClosePrompt && <Modal title={`Close ${projectClosePrompt.projectName}?`} onClose={() => { if (!projectCloseBusy) setProjectClosePrompt(undefined) }}><div className="restore-summary"><div><strong>{projectClosePrompt.activeSwarms} active Swarm{projectClosePrompt.activeSwarms === 1 ? '' : 's'}</strong><span>Swarm state remains bound to this Project.</span></div><p>Keep the Swarms running in the background, or pause them before closing the Project session.</p><div className="modal-actions"><Button variant="ghost" disabled={projectCloseBusy} onClick={() => setProjectClosePrompt(undefined)}>Cancel</Button><Button variant="secondary" data-autofocus disabled={projectCloseBusy} onClick={() => void completeProjectClose(projectClosePrompt.projectId, 'pause_and_close')}>Pause and close</Button><Button variant="primary" disabled={projectCloseBusy} onClick={() => void completeProjectClose(projectClosePrompt.projectId, 'keep_running')}>Keep running</Button></div></div></Modal>}
    {pendingReplace && <Modal title="Replace terminal" onClose={() => setPendingReplace(undefined)}><div className="provider-picker">{choices.length === 0 ? <ErrorNotice message="No available agents or shells were detected." onRetry={() => void scanProviders()} /> : choices.map((choice) => <button key={choiceOptionId(choice)} onClick={() => void replacePane(choice)}><TerminalSquare size={18} /><div><strong>{choice.name}</strong><span>Available · {providerLabel(choice.provider)}</span></div></button>)}</div></Modal>}
    {renameTarget && <TextPromptDialog title={renameTarget.kind === 'workspace' ? 'Rename workspace' : 'Rename terminal'} label={renameTarget.kind === 'workspace' ? 'Workspace name' : 'Terminal title'} initialValue={renameTarget.initialValue} confirmLabel="Rename" onClose={() => setRenameTarget(undefined)} onConfirm={(value) => void confirmRename(value)} />}
    {monitorPicker && <Modal title="Move workspace to monitor" onClose={() => setMonitorPicker(undefined)}><div className="provider-picker">{monitors.length === 0 ? <ErrorNotice message="No additional monitors were detected." /> : monitors.map((monitor) => <button key={monitor.id} onClick={() => void chooseMonitor(monitor.id)}><TerminalSquare size={18} /><div><strong>{monitorLabel(monitor)}{monitor.isPrimary ? ' · Primary' : ''}</strong><span>{monitor.bounds.width}×{monitor.bounds.height} · {Math.round(monitor.scaleFactor * 100)}% · {monitor.windowCount} window{monitor.windowCount === 1 ? '' : 's'}</span></div></button>)}</div></Modal>}
    {gitReview && <Modal title="Pane review" onClose={() => setGitReview(undefined)}><div className="pane-review"><div className="pane-review-meta"><strong>{gitReview.review.branch || 'detached'}</strong><span title={gitReview.review.workingDirectory}>{gitReview.review.workingDirectory}</span>{gitReview.review.diffTruncated && <em>Diff truncated</em>}</div>{gitReview.review.conflicts.length > 0 && <ErrorNotice message={`${gitReview.review.conflicts.length} conflicted file(s): ${gitReview.review.conflicts.join(', ')}`} />}{gitReview.review.files.length === 0 ? <p className="empty-copy">No git changes for this pane.</p> : <div className="pane-review-files">{gitReview.review.files.map((file) => <div key={file.path} className={file.conflicted ? 'conflicted' : ''}><code>{file.indexStatus}{file.worktreeStatus}</code><span title={file.path}>{file.path}</span><button disabled={gitReviewBusy} onClick={() => void stageReviewFile(file.path)}>Stage</button><button disabled={gitReviewBusy} onClick={() => void restoreReviewFile(file.path)}>Discard</button></div>)}</div>}<pre className="pane-review-diff">{gitReview.review.diff || 'No unstaged or staged diff output.'}</pre></div></Modal>}
    {paneMenu && <PaneMenu menu={paneMenu} agents={agentMenuOptions} onClose={() => setPaneMenu(undefined)} onAction={(action) => { const paneId = paneMenu.paneId; setPaneMenu(undefined); if (action === 'resume_agents') openAgentResumeCenter(); if (action === 'rename') void renamePane(paneId); if (action === 'new_terminal') void createPane({}, { targetPaneId: paneId }); if (action === 'split_right') void createPane({}, { targetPaneId: paneId, direction: 'vertical' }); if (action === 'split_down') void createPane({}, { targetPaneId: paneId, direction: 'horizontal' }); if (action.startsWith('new:')) void createPane({ choice: choiceForOption(action.slice(4)) }, { targetPaneId: paneId }); if (action === 'duplicate') { const pane = workspace.panes.find((item) => item.id === paneId); if (pane) void createPane({ duplicate: pane }, { targetPaneId: paneId }) } if (action === 'replace') setPendingReplace({ targetPaneId: paneId }); if (action === 'directory') void changeDirectory(paneId); if (action === 'isolate_worktree') void isolatePaneWorktree(paneId); if (action === 'review_changes') void openPaneReview(paneId); if (action === 'restart') void restartPane(paneId); if (action === 'stop') void stopPane(paneId); if (action === 'close') void closePane(paneId); if (['search','copy','paste','select_all','clear','focus'].includes(action)) dispatchTerminalAction(paneId, action as Parameters<typeof dispatchTerminalAction>[1]) }} />}
  </AppShell>
}

function shellChoice(shell: ShellProfile): ProviderChoice {
  const provider: AgentProvider = shell.name.startsWith('PowerShell') || shell.name === 'Windows PowerShell' ? 'powershell' : shell.name === 'Command Prompt' ? 'command_prompt' : shell.name.startsWith('WSL') ? 'wsl' : 'custom_shell'
  return { provider, name: shell.name, executablePath: shell.executablePath, args: shell.args, shellProfileId: shell.id }
}

