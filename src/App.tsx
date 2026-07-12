import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { native } from './native/commands'
import { useAppStore } from './stores/appStore'

const ProjectLauncher = lazy(() => import('./screens/ProjectLauncher').then((module) => ({ default: module.ProjectLauncher })))
const WorkspaceSetup = lazy(() => import('./screens/WorkspaceSetup').then((module) => ({ default: module.WorkspaceSetup })))
const WorkspaceScreen = lazy(() => import('./screens/WorkspaceScreen').then((module) => ({ default: module.WorkspaceScreen })))
const SettingsScreen = lazy(() => import('./screens/SettingsScreen').then((module) => ({ default: module.SettingsScreen })))

export default function App() {
  const setSettings = useAppStore((state) => state.setSettings)
  const uiScale = useAppStore((state) => state.settings.uiScale)

  useEffect(() => {
    void native.getSettings().then(setSettings).catch(() => undefined)
  }, [setSettings])

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale))
  }, [uiScale])

  return (
    <HashRouter>
      <Suspense fallback={<div className="route-loading" aria-label="Loading ForgeMind"><span /><span /><span /></div>}>
      <Routes>
        <Route path="/" element={<ProjectLauncher />} />
        <Route path="/setup/:projectId" element={<WorkspaceSetup />} />
        <Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </HashRouter>
  )
}
