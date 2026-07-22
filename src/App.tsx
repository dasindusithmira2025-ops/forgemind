import { lazy, Suspense, useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { native } from './native/commands'
import { useAppStore } from './stores/appStore'
import { terminalRuntime } from './features/terminals/runtimeStore'
import { detachedWorkspaceId } from './native/windowContext'
import type { HandoffTicket, StartupStatus, UpdateStatus } from './native/types'
import { RecoveryScreen } from './screens/RecoveryScreen'
import { initThemeRuntime } from './theme/themeStore'

const ProjectLauncher = lazy(() => import('./screens/ProjectLauncher').then((module) => ({ default: module.ProjectLauncher })))
const WorkspaceSetup = lazy(() => import('./screens/WorkspaceSetup').then((module) => ({ default: module.WorkspaceSetup })))
const WorkspaceScreen = lazy(() => import('./screens/WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })))
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))
const RepositoryScreen = lazy(() => import('./screens/RepositoryScreen').then((module) => ({ default: module.RepositoryScreen })))
const SwarmsScreen = lazy(() => import('./screens/SwarmsScreen').then((module) => ({ default: module.SwarmsScreen })))
const DetachedWorkspaceWindow = lazy(() => import('./screens/DetachedWorkspaceWindow').then((module) => ({ default: module.DetachedWorkspaceWindow })))

function StartupWorkspaceRedirect() {
  const navigate = useNavigate()

  useEffect(() => {
    // Startup-only behavior: returning to the launcher later in the same renderer session
    // must remain an explicit user action instead of immediately bouncing back.
    const hash = window.location.hash
    if (hash && hash !== '#' && hash !== '#/') return
    let active = true
    void (async () => {
      const settings = await native.getSettings()
      if (!active || !settings.reopenLastWorkspace) return
      const sessions = await native.listOpenProjects()
      const current = sessions.find((item) => item.isActive) ?? sessions[0]
      if (active && current?.lastWorkspaceId) { navigate(`/workspace/${current.lastWorkspaceId}`, { replace: true }); return }
      const recent = await native.listRecentWorkspaces()
      const candidate = recent.find((item) => !item.projectMissing)
      if (active && candidate) navigate(`/workspace/${candidate.workspace.id}`, { replace: true })
    })().catch(() => undefined)
    return () => { active = false }
  }, [navigate])

  return null
}

function WorkspaceHandoffListener(){
  const navigate=useNavigate()
  useEffect(()=>{let cancelled=false;let stop:(()=>void)|undefined;void listen<HandoffTicket>('workspace-attach-requested',(event)=>{navigate(`/workspace/${event.payload.workspaceId}`)}).then((unlisten)=>{if(cancelled)unlisten();else stop=unlisten});return()=>{cancelled=true;stop?.()}},[navigate])
  return null
}

export default function App() {
  const setSettings = useAppStore((state) => state.setSettings)
  const uiScale = useAppStore((state) => state.settings.uiScale)
  const uiDensity = useAppStore((state) => state.settings.uiDensity)
  const [startup, setStartup] = useState<StartupStatus | null>()
  const [whatsNew, setWhatsNew] = useState<UpdateStatus>()
  const [updateReady, setUpdateReady] = useState<UpdateStatus>()
  const [updateDismissed, setUpdateDismissed] = useState(false)

  // Theme synchronisation for this window: reconcile the persisted selection, follow OS appearance
  // when set to System, and apply live theme-change broadcasts from any other window. Runs in the
  // main window and every detached workspace window; the inline bootstrap already painted the
  // cached theme before mount, so this only reconciles and keeps windows in sync.
  useEffect(() => initThemeRuntime(), [])

  // Unobtrusive, cross-window update notification. The Rust coordinator broadcasts every lifecycle
  // change; we surface a small banner only once a compatible update is available or downloaded, and
  // never in a detached Workspace window (updates are driven from the primary window).
  useEffect(() => {
    if (detachedWorkspaceId) return
    let cancelled = false
    let stop: (() => void) | undefined
    void listen<UpdateStatus>('update-status', (event) => {
      const phase = event.payload.journal.phase
      if (phase === 'available' || phase === 'downloaded') { setUpdateReady(event.payload); setUpdateDismissed(false) }
      else if (phase === 'installation_started' || phase === 'idle' || phase === 'no_update') setUpdateReady(undefined)
    }).then((unlisten) => { if (cancelled) unlisten(); else stop = unlisten })
    return () => { cancelled = true; stop?.() }
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      if (detachedWorkspaceId) {
        setStartup(null)
        const settings = await native.getSettings()
        if (!active) return
        setSettings(settings)
        await terminalRuntime.start()
        return
      }
      const status = await native.getStartupStatus()
      if (!active) return
      setStartup(status)
      if (status.recoveryMode) return
      const settings = await native.getSettings()
      if (!active) return
      setSettings(settings)
      await terminalRuntime.start()
      if (!active) return
      const confirmed = await native.confirmHealthyStartup()
      if (confirmed.journal.phase === 'healthy_startup_confirmed' && confirmed.journal.targetVersion === confirmed.build.version) setWhatsNew(confirmed)
      if (settings.automaticUpdateChecks) void native.checkForUpdates().catch(() => undefined)
    })().catch(() => { if (active) void native.getStartupStatus().then(setStartup).catch(() => setStartup(null)) })
    return () => { active = false; terminalRuntime.stop() }
  }, [setSettings])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  useEffect(() => {
    document.documentElement.dataset.density = uiDensity
  }, [uiDensity])

  // A detached Workspace window (label `ws-<id>`) renders the compact single-Workspace shell
  // instead of the full router — no Project launcher, no global sidebar. Terminal runtime +
  // settings are already started by the effects above so the detached renderer re-subscribes
  // to the still-running PTYs.
  if (detachedWorkspaceId) {
    return (
      <Suspense fallback={<div className="route-loading" aria-label="Loading PARALITH"><span /><span /><span /></div>}>
        <DetachedWorkspaceWindow workspaceId={detachedWorkspaceId} />
      </Suspense>
    )
  }

  if (startup === undefined) return <div className="route-loading" aria-label="Starting PARALITH safely"><span /><span /><span /></div>
  if (startup?.recoveryMode) return <RecoveryScreen startup={startup} />

  return (
    <HashRouter>
      <StartupWorkspaceRedirect />
      <WorkspaceHandoffListener />
      <Suspense fallback={<div className="route-loading" aria-label="Loading PARALITH"><span /><span /><span /></div>}>
      <Routes>
        <Route path="/" element={<ProjectLauncher />} />
        <Route path="/setup/:projectId" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId/configure" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} />
        <Route path="/repository/:projectId" element={<RepositoryScreen />} />
        <Route path="/swarms/:projectId" element={<SwarmsScreen />} />
        <Route path="/swarms/:projectId/:swarmId" element={<SwarmsScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      {whatsNew && <aside className="whats-new" aria-label="What's new"><span>UPDATED · {whatsNew.build.edition.toUpperCase()}</span><h2>PARALITH {whatsNew.build.version} is healthy.</h2><p>{Array.isArray(whatsNew.build.bundledRelease.highlights) ? (whatsNew.build.bundledRelease.highlights as string[]).join(' · ') : 'The signed update passed migration and startup health checks.'}</p><button onClick={() => setWhatsNew(undefined)}>Dismiss</button></aside>}
      {updateReady && !updateDismissed && <aside className="update-toast" role="status" aria-label="Update available"><div><strong>PARALITH {updateReady.journal.available?.version} is {updateReady.journal.phase === 'downloaded' ? 'ready to install' : 'available'}.</strong><span>{updateReady.journal.phase === 'downloaded' ? 'A signed update has been verified and can be installed when you are ready.' : 'A signed update is available for this edition.'}</span></div><div className="update-toast-actions"><a href="#/settings?section=updates" onClick={() => setUpdateDismissed(true)}>Review</a><button onClick={() => setUpdateDismissed(true)}>Later</button></div></aside>}
    </HashRouter>
  )
}
