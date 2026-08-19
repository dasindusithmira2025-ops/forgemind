/**
 * Visual harness entry point.
 *
 * Mounts the *real* screens against stubbed Tauri IPC so the design system can be inspected and
 * screenshotted in a browser. `?surface=<id>` selects what to render; the index lists them all.
 * This never ships — it is reachable only through `vite.visual.config.ts`.
 */
import { StrictMode, Suspense, lazy, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import '../src/index.css'
import { applyTheme } from '../src/theme/applyTheme'
import { coerceThemeId, resolveTheme } from '../src/theme/registry'
import { useAppStore } from '../src/stores/appStore'
import { settings } from './fixtures'

const ProjectLauncher = lazy(() => import('../src/screens/ProjectLauncher').then((m) => ({ default: m.ProjectLauncher })))
const WorkspaceScreen = lazy(() => import('../src/screens/WorkspaceScreen').then((m) => ({ default: m.WorkspaceScreen })))
const WorkspaceSetup = lazy(() => import('../src/screens/WorkspaceSetup').then((m) => ({ default: m.WorkspaceSetup })))
const SettingsScreen = lazy(() => import('../src/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const RepositoryScreen = lazy(() => import('../src/screens/RepositoryScreen').then((m) => ({ default: m.RepositoryScreen })))
const DatabaseScreen = lazy(() => import('../src/screens/DatabaseScreen').then((m) => ({ default: m.DatabaseScreen })))
const SwarmsScreen = lazy(() => import('../src/screens/SwarmsScreen').then((m) => ({ default: m.SwarmsScreen })))
const UsageScreen = lazy(() => import('../src/screens/UsageScreen').then((m) => ({ default: m.UsageScreen })))
const MemoryScreen = lazy(() => import('../src/screens/MemoryScreen').then((m) => ({ default: m.MemoryScreen })))
const Primitives = lazy(() => import('./Primitives').then((m) => ({ default: m.Primitives })))

const SURFACES: Record<string, { label: string; path: string; element: ReactElement; route: string }> = {
  primitives: { label: 'Design primitives', path: '/', route: '/', element: <Primitives /> },
  launcher: { label: 'Project launcher', path: '/', route: '/', element: <ProjectLauncher /> },
  workspace: { label: 'Workspace (4 terminals)', path: '/workspace/ws-main', route: '/workspace/:workspaceId', element: <WorkspaceScreen /> },
  setup: { label: 'Workspace creation', path: '/setup/proj-paralith', route: '/setup/:projectId', element: <WorkspaceSetup /> },
  settings: { label: 'Settings', path: '/settings', route: '/settings', element: <SettingsScreen /> },
  repository: { label: 'Repository command center', path: '/repository/proj-paralith', route: '/repository/:projectId', element: <RepositoryScreen /> },
  database: { label: 'Database studio', path: '/database/proj-paralith', route: '/database/:projectId', element: <DatabaseScreen /> },
  memory: { label: 'Memory (Context Fabric)', path: '/memory/proj-paralith', route: '/memory/:projectId', element: <MemoryScreen /> },
  usage: { label: 'Usage analytics', path: '/usage', route: '/usage', element: <UsageScreen /> },
  swarms: { label: 'Swarms', path: '/swarms/proj-paralith', route: '/swarms/:projectId', element: <SwarmsScreen /> },
  swarm: { label: 'Swarm (running)', path: '/swarms/proj-paralith/swarm-1', route: '/swarms/:projectId/:swarmId', element: <SwarmsScreen /> },
}

function Index() {
  return (
    <div style={{ padding: 32, display: 'grid', gap: 8, alignContent: 'start' }}>
      <h1 style={{ fontSize: 'var(--font-2xl)', fontWeight: 700 }}>Paralith visual harness</h1>
      <p style={{ color: 'var(--muted)', fontSize: 'var(--font-md)' }}>Real screens, stubbed IPC. Append <code>?surface=…</code>.</p>
      <ul style={{ display: 'grid', gap: 4, listStyle: 'none', padding: 0, marginTop: 16 }}>
        {Object.entries(SURFACES).map(([id, surface]) => (
          <li key={id}><a href={`?surface=${id}`} style={{ color: 'var(--accent)', fontSize: 'var(--font-md)' }}>{surface.label}</a></li>
        ))}
      </ul>
    </div>
  )
}

const params = new URLSearchParams(window.location.search)
const surfaceId = params.get('surface') ?? ''
const themeId = params.get('theme') ?? 'paralith-dark'
const density = params.get('density') ?? 'standard'
const scale = params.get('scale') ?? '1'
const surface = SURFACES[surfaceId]

applyTheme(resolveTheme(themeId, true), coerceThemeId(themeId))
document.documentElement.dataset.density = density
document.documentElement.style.setProperty('--ui-scale', scale)
useAppStore.getState().setSettings({ ...settings, uiDensity: density, uiScale: Number(scale) } as never)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="route-loading"><span /><span /><span /></div>}>
      {surface
        ? <MemoryRouter initialEntries={[surface.path]}><Routes><Route path={surface.route} element={surface.element} /></Routes></MemoryRouter>
        : <Index />}
    </Suspense>
  </StrictMode>,
)
