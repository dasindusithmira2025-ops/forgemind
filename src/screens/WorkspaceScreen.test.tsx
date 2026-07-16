import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceScreen } from './WorkspaceScreen'
import { useAppStore } from '../stores/appStore'
import { useSidebarStore } from '../features/sidebar/sidebarStore'
import type { Project, TerminalSession, Workspace, WorkspaceSaveRequest } from '../native/types'

const runtime = vi.hoisted(() => ({ sessions: [] as TerminalSession[], hydrate: vi.fn(), upsert: vi.fn(), remove: vi.fn(), clearWorkspace: vi.fn() }))
const restoreWorkspace = vi.fn()
const saveSettings = vi.fn()
const getWorkspace = vi.fn()
const listRecentWorkspaces = vi.fn()
const listWorkspacesForProject = vi.fn()
const terminateWorkspace = vi.fn()
const reorderWorkspaces = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }))
vi.mock('../features/terminals/runtimeStore', () => ({ terminalRuntime: runtime, useWorkspaceSessions: () => runtime.sessions }))
vi.mock('../components/terminal/TerminalPane', () => ({ TerminalPane: ({ assignment, maximized, onMaximize }: { assignment: { title: string }; maximized: boolean; onMaximize: () => void }) => <div data-testid="terminal-pane" data-maximized={maximized}><span>{assignment.title}</span><button onClick={onMaximize}>Toggle maximize</button></div> }))
vi.mock('../components/terminal/terminalActions', () => ({ dispatchTerminalAction: vi.fn() }))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getProject: vi.fn(async () => project), getWorkspace: (...args: unknown[]) => getWorkspace(...args),
    saveWorkspace: vi.fn(async (request: WorkspaceSaveRequest) => ({ ...request, normalizedName: request.name.toLowerCase(), id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' })),
    listRecentWorkspaces: (...args: unknown[]) => listRecentWorkspaces(...args),
    listWorkspacesForProject: (...args: unknown[]) => listWorkspacesForProject(...args),
    setLastActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    reorderWorkspaces: (...args: unknown[]) => reorderWorkspaces(...args),
    duplicateWorkspace: vi.fn().mockResolvedValue(undefined),
    renameWorkspace: vi.fn(), removeRecentWorkspace: vi.fn(), deleteWorkspaceConfiguration: vi.fn(), relocateProject: vi.fn(), openProject: vi.fn(),
    detectAgents: vi.fn().mockResolvedValue([]), detectShells: vi.fn().mockResolvedValue([{ id: 'shell', name: 'PowerShell', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' }]),
    listLiveSessions: vi.fn().mockResolvedValue([]), restoreWorkspaceSessions: (...args: unknown[]) => restoreWorkspace(...args),
    createTerminalSession: vi.fn(), terminateTerminalSession: vi.fn(), terminateWorkspaceSessions: (...args: unknown[]) => terminateWorkspace(...args),
    removeLayoutPane: vi.fn(), splitLayoutPane: vi.fn(), validateWorkingDirectory: vi.fn(),
    getDiagnostics: vi.fn(), runHealthCheck: vi.fn(),
    saveSettings: (...args: unknown[]) => saveSettings(...args),
  },
}))

const project: Project = { id: 'project', name: 'Fixture', rootPath: 'C:\\fixture', canonicalRootPath: 'c:\\fixture', majorLanguages: ['Rust'], isGitRepository: true, hasPackageJson: false, hasLockfile: false, gitBranch: 'main', detectedFramework: 'Next.js', createdAt: '', updatedAt: '', lastOpenedAt: '' }
const workspace: Workspace = { id: 'workspace', projectId: 'project', name: 'Fresh workspace', normalizedName: 'fresh workspace', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'pane' }, activePaneId: 'pane', panes: [{ id: 'pane', workspaceId: 'workspace', title: 'PowerShell', provider: 'powershell', executablePath: 'C:\\pwsh.exe', args: [], workingDirectory: 'C:\\fixture', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: new Date().toISOString() }
const session: TerminalSession = { id: 'session', projectId: 'project', workspaceId: 'workspace', paneId: 'pane', provider: 'powershell', executable: 'C:\\pwsh.exe', arguments: [], title: 'PowerShell', workingDirectory: 'C:\\fixture', status: 'running', processId: 7, startedAt: new Date().toISOString(), outputTail: [], nextSequence: 0, restorationState: 'restored', droppedOutputBytes: 0 }
const secondWorkspace: Workspace = { ...workspace, id: 'workspace-two', name: 'Second workspace', normalizedName: 'second workspace', panes: workspace.panes.map((pane) => ({ ...pane, id: 'pane-two', workspaceId: 'workspace-two' })), layout: { type: 'pane', paneId: 'pane-two' }, activePaneId: 'pane-two' }

describe('Workspace screen', () => {
  beforeEach(() => {
    vi.clearAllMocks(); runtime.sessions = [session]
    useSidebarStore.setState({ projectSwitcherOpen: false, diagnosticsOpen: false, menuWorkspaceId: undefined, draggingWorkspaceId: undefined })
    restoreWorkspace.mockResolvedValue({ workspaceId: 'workspace', sessions: [session], deferredPaneIds: [], failures: [], budget: 4 })
    terminateWorkspace.mockResolvedValue(undefined)
    reorderWorkspaces.mockResolvedValue(undefined)
    saveSettings.mockImplementation(async (value) => value); getWorkspace.mockResolvedValue(secondWorkspace)
    listRecentWorkspaces.mockResolvedValue([workspace, secondWorkspace].map((item) => ({ workspace: item, projectName: project.name, projectPath: project.rootPath, projectMissing: false })))
    listWorkspacesForProject.mockResolvedValue([workspace, secondWorkspace])
    useAppStore.setState({ project, workspace, recentWorkspaces: [], activePaneId: 'pane', settings: { ...useAppStore.getState().settings, sidebarOpen: true, sidebarWidth: 300, restoreBehavior: 'restart_agents' } })
  })

  const renderWorkspace = () => render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)

  it('restores through the bounded native scheduler', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(restoreWorkspace).toHaveBeenCalledWith('workspace', 4, 'restart_agents'))
  })

  it('renders the focused sidebar without removed navigation surfaces', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    expect(screen.getByLabelText('PARALITH')).toBeInTheDocument()
    expect(screen.getByText('Project Selection')).toBeInTheDocument()
    expect(screen.getByText('Current Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Fixture/ })).toBeInTheDocument()
    expect(screen.getByText('Workspaces — This Window')).toBeInTheDocument()
    expect(screen.getByText('Workspaces — Other Monitors')).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeInTheDocument()
    // Removed navigation must not exist anywhere.
    for (const name of ['Agents', 'Files', 'Source Control', 'Preview', 'Terminal Grid', 'Workspace overview']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('marks the active Workspace and derives runtime status from real sessions', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const active = await screen.findByRole('button', { name: /Fresh workspace, active/ })
    expect(active.closest('.ws-row')).toHaveAttribute('aria-current', 'true')
  })

  it('maximizes and restores a Pane without rewriting layout', async () => {
    renderWorkspace(); const pane = await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByText('Toggle maximize')); expect(pane).toHaveAttribute('data-maximized', 'true')
    fireEvent.click(screen.getByText('Toggle maximize')); expect(pane).toHaveAttribute('data-maximized', 'false')
  })

  it('persists sidebar collapse through typed settings', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebarOpen: false })))
  })

  it('persists sidebar width through typed settings', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const handle = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebarWidth: 308 })))
  })

  it('switches same-Project Workspaces through single-window routing', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    fireEvent.click(await screen.findByRole('button', { name: /Second workspace,/ }))
    await waitFor(() => expect(getWorkspace).toHaveBeenCalledWith('workspace-two'))
  })

  it('stops owned sessions before switching when the inactive policy is stop', async () => {
    useAppStore.setState({ settings: { ...useAppStore.getState().settings, inactiveWorkspaceProcesses: 'stop' } })
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    fireEvent.click(await screen.findByRole('button', { name: /Second workspace,/ }))
    await waitFor(() => expect(terminateWorkspace).toHaveBeenCalledWith('workspace'))
  })

  it('reorders Workspaces from the keyboard and persists the new order', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const active = await screen.findByRole('button', { name: /Fresh workspace, active/ })
    fireEvent.keyDown(active, { key: 'ArrowDown', altKey: true })
    await waitFor(() => expect(reorderWorkspaces).toHaveBeenCalledWith('project', ['workspace-two', 'workspace']))
  })

  it('keeps deferred Panes mounted and resumable', async () => {
    runtime.sessions = []
    restoreWorkspace.mockResolvedValue({ workspaceId: 'workspace', sessions: [], deferredPaneIds: ['pane'], failures: [], budget: 1 })
    renderWorkspace()
    expect(await screen.findByTestId('terminal-pane')).toBeInTheDocument()
  })
})
