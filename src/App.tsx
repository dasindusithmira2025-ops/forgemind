import { lazy, Suspense, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { native } from './native/commands'
import { useAppStore } from './stores/appStore'
import { terminalRuntime } from './features/terminals/runtimeStore'
import { detachedWorkspaceId } from './native/windowContext'
import type { HandoffTicket } from './native/types'

const ProjectLauncher = lazy(() => import('./screens/ProjectLauncher').then((module) => ({ default: module.ProjectLauncher })))
const WorkspaceSetup = lazy(() => import('./screens/WorkspaceSetup').then((module) => ({ default: module.WorkspaceSetup })))
const WorkspaceScreen = lazy(() => import('./screens/WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })))
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))
const DetachedWorkspaceWindow = lazy(() => import('./screens/DetachedWorkspaceWindow').then((module) => ({ default: module.DetachedWorkspaceWindow })))
const MissionControl = lazy(() => import('./screens/MissionControl').then((module) => ({ default: module.MissionControl })))
const MissionComposerRoute = lazy(() => import('./screens/MissionControl').then((module) => ({ default: module.MissionComposerRoute })))
const LegacyMissionControlRedirect = lazy(() => import('./screens/MissionControl').then((module) => ({ default: module.LegacyMissionControlRedirect })))
const MemoryScreen = lazy(() => import('./screens/MemoryScreen').then((module) => ({ default: module.MemoryScreen })))

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
  useEffect(()=>{let stop:(()=>void)|undefined;void listen<HandoffTicket>('workspace-attach-requested',(event)=>{navigate(`/workspace/${event.payload.workspaceId}`)}).then((unlisten)=>{stop=unlisten});return()=>stop?.()},[navigate])
  return null
}

export default function App() {
  const setSettings = useAppStore((state) => state.setSettings)
  const uiScale = useAppStore((state) => state.settings.uiScale)

  useEffect(() => {
    if (!detachedWorkspaceId) {
      void native.getSettings().then(setSettings).catch(() => undefined)
      void native.reconcileMissionRecovery().catch(() => undefined)
    }
    void terminalRuntime.start().catch(() => undefined)
    return () => terminalRuntime.stop()
  }, [setSettings])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  // A detached Workspace window (label `ws-<id>`) renders the compact single-Workspace shell
  // instead of the full router — no Project launcher, no global sidebar. Terminal runtime +
  // settings are already started by the effects above so the detached renderer re-subscribes
  // to the still-running PTYs.
  if (detachedWorkspaceId) {
    return (
      <Suspense fallback={<div className="route-loading" aria-label="Loading ForgeMind"><span /><span /><span /></div>}>
        <DetachedWorkspaceWindow workspaceId={detachedWorkspaceId} />
      </Suspense>
    )
  }

  return (
    <HashRouter>
      <StartupWorkspaceRedirect />
      <WorkspaceHandoffListener />
      <Suspense fallback={<div className="route-loading" aria-label="Loading ForgeMind"><span /><span /><span /></div>}>
      <Routes>
        <Route path="/" element={<ProjectLauncher />} />
        <Route path="/setup/:projectId" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId/configure" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} />
        <Route path="/project/:projectId/missions/new" element={<MissionComposerRoute />} />
        <Route path="/project/:projectId/missions/:missionId/tasks/:taskId" element={<MissionControl />} />
        <Route path="/project/:projectId/missions/:missionId" element={<MissionControl />} />
        <Route path="/project/:projectId/missions" element={<MissionControl />} />
        <Route path="/project/:projectId/memory" element={<MemoryScreen />} />
        <Route path="/missions" element={<LegacyMissionControlRedirect />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </HashRouter>
  )
}
