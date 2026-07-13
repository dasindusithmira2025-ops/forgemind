import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { native } from './native/commands'
import { useAppStore } from './stores/appStore'
import { terminalRuntime } from './features/terminals/runtimeStore'

const ProjectLauncher = lazy(() => import('./screens/ProjectLauncher').then((module) => ({ default: module.ProjectLauncher })))
const WorkspaceSetup = lazy(() => import('./screens/WorkspaceSetup').then((module) => ({ default: module.WorkspaceSetup })))
const WorkspaceScreen = lazy(() => import('./screens/WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })))
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))

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
      const recent = await native.listRecentWorkspaces()
      const candidate = recent.find((item) => !item.projectMissing)
      if (active && candidate) navigate(`/workspace/${candidate.workspace.id}`, { replace: true })
    })().catch(() => undefined)
    return () => { active = false }
  }, [navigate])

  return null
}

export default function App() {
  const setSettings = useAppStore((state) => state.setSettings)
  const uiScale = useAppStore((state) => state.settings.uiScale)

  useEffect(() => {
    void native.getSettings().then(setSettings).catch(() => undefined)
    void terminalRuntime.start().catch(() => undefined)
    return () => terminalRuntime.stop()
  }, [setSettings])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  return (
    <HashRouter>
      <StartupWorkspaceRedirect />
      <Suspense fallback={<div className="route-loading" aria-label="Loading ForgeMind"><span /><span /><span /></div>}>
      <Routes>
        <Route path="/" element={<ProjectLauncher />} />
        <Route path="/setup/:projectId" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId/configure" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </HashRouter>
  )
}
