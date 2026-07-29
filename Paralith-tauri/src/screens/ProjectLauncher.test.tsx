import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectLauncher } from './ProjectLauncher'
import { useAppStore } from '../stores/appStore'
import type { Project, ProjectOverview, Workspace } from '../native/types'

const openMock = vi.fn()
const openProjectMock = vi.fn()
const listProjectsOverviewMock = vi.fn()
const listWorkspacesForProjectMock = vi.fn()
const removeRecentProjectMock = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: (...args: unknown[]) => openMock(...args) }))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
  native: {
    openProject: (...args: unknown[]) => openProjectMock(...args),
    listProjectsOverview: (...args: unknown[]) => listProjectsOverviewMock(...args),
    listWorkspacesForProject: (...args: unknown[]) => listWorkspacesForProjectMock(...args),
    removeRecentProject: (...args: unknown[]) => removeRecentProjectMock(...args),
    removeRecentWorkspace: vi.fn(), deleteWorkspaceConfiguration: vi.fn(), relocateProject: vi.fn(), renameWorkspace: vi.fn(),
  },
}))

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'project', name: 'Demo Project', rootPath: 'C:\\code\\demo', canonicalRootPath: 'c:\\code\\demo',
  gitBranch: 'main', detectedFramework: undefined, packageManager: undefined, majorLanguages: ['TypeScript'],
  isGitRepository: true, hasPackageJson: true, hasLockfile: true, createdAt: '', updatedAt: '', lastOpenedAt: new Date().toISOString(), ...overrides,
})
const workspace = (id: string, name: string): Workspace => ({
  id, projectId: 'project', name, normalizedName: name.toLowerCase(), restoreBehavior: 'inherit', layout: { type: 'pane', paneId: `${id}-pane` }, activePaneId: `${id}-pane`,
  panes: [{ id: `${id}-pane`, title: 'Claude', provider: 'claude', executablePath: 'c', args: [], workingDirectory: 'C:\\code\\demo', workingDirectoryMode: 'project_relative', positionOrder: 0 }],
  createdAt: '', updatedAt: '', lastOpenedAt: new Date().toISOString(),
})
const overview = (workspaces: Workspace[], folderMissing = false): ProjectOverview => ({ project: project(), workspaces, folderMissing })

function Location() { const location = useLocation(); return <div data-testid="location">{location.pathname + location.search}</div> }
const renderLauncher = () => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route path="/" element={<><ProjectLauncher /><Location /></>} />
      <Route path="*" element={<Location />} />
    </Routes>
  </MemoryRouter>,
)

describe('Project Launcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listProjectsOverviewMock.mockResolvedValue([])
    useAppStore.setState({ project: undefined, workspace: undefined })
  })

  it('shows the honest empty state and opens the native folder picker', async () => {
    openMock.mockResolvedValue(null)
    renderLauncher()
    expect(await screen.findByText('No recent projects yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Project Folder' }))
    await waitFor(() => expect(openMock).toHaveBeenCalled())
  })

  it('groups workspaces under their parent project with distinct entity labels', async () => {
    listProjectsOverviewMock.mockResolvedValue([overview([workspace('w1', 'Main Development'), workspace('w2', 'Frontend Focus')])])
    renderLauncher()
    expect(await screen.findByText('Demo Project')).toBeInTheDocument()
    expect(screen.getByText('Project')).toBeInTheDocument()
    expect(screen.getAllByText('Workspace').length).toBe(2)
    expect(screen.getByText('Main Development')).toBeInTheDocument()
    expect(screen.getByText('Frontend Focus')).toBeInTheDocument()
  })

  it('opens a saved workspace by workspace id, not project id', async () => {
    listProjectsOverviewMock.mockResolvedValue([overview([workspace('w1', 'Main Development')])])
    renderLauncher()
    await screen.findByText('Main Development')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/workspace/w1'))
  })

  it('routes to setup when opening a project that has no workspaces', async () => {
    listProjectsOverviewMock.mockResolvedValue([overview([])])
    openProjectMock.mockResolvedValue(project())
    listWorkspacesForProjectMock.mockResolvedValue([])
    renderLauncher()
    await screen.findByText('Demo Project')
    fireEvent.click(screen.getByRole('button', { name: /More actions for project Demo Project/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh metadata' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/setup/project'))
  })

  it('shows a workspace chooser when opening a project with multiple workspaces', async () => {
    listProjectsOverviewMock.mockResolvedValue([overview([workspace('w1', 'Main Development'), workspace('w2', 'Frontend Focus')])])
    openProjectMock.mockResolvedValue(project())
    listWorkspacesForProjectMock.mockResolvedValue([workspace('w1', 'Main Development'), workspace('w2', 'Frontend Focus')])
    renderLauncher()
    await screen.findByText('Demo Project')
    fireEvent.click(screen.getByRole('button', { name: /More actions for project Demo Project/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Refresh metadata' }))
    expect(await screen.findByText('Open a workspace in Demo Project')).toBeInTheDocument()
  })

  it('removing a project from recents keeps the folder and refreshes', async () => {
    listProjectsOverviewMock.mockResolvedValue([overview([workspace('w1', 'Main Development')])])
    removeRecentProjectMock.mockResolvedValue(undefined)
    renderLauncher()
    await screen.findByText('Demo Project')
    fireEvent.click(screen.getByRole('button', { name: /More actions for project Demo Project/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove project from recents' }))
    await waitFor(() => expect(removeRecentProjectMock).toHaveBeenCalledWith('project'))
  })
})
