import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceScreen } from './WorkspaceScreen'
import { useAppStore } from '../stores/appStore'
import type { Project, TerminalSession, Workspace, WorkspaceSaveRequest } from '../native/types'

const createSession = vi.fn()
const terminateSession = vi.fn()
const saveSettings = vi.fn()
const getWorkspace = vi.fn()
const listRecentWorkspaces = vi.fn()
const onTerminalExit = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../native/events', () => ({ onTerminalExit }))
vi.mock('../components/terminal/TerminalPane', () => ({ TerminalPane: ({ assignment, maximized, onMaximize }: { assignment: { title: string }; maximized: boolean; onMaximize: () => void }) => <div data-testid="terminal-pane" data-maximized={maximized}><span>{assignment.title}</span><button onClick={onMaximize}>Toggle maximize</button></div> }))
vi.mock('../components/terminal/terminalActions', () => ({ dispatchTerminalAction: vi.fn() }))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getProject: vi.fn(),
    getWorkspace: (...args: unknown[]) => getWorkspace(...args),
    saveWorkspace: vi.fn(async (request: WorkspaceSaveRequest) => ({ ...request, id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' })),
    listRecentWorkspaces: (...args: unknown[]) => listRecentWorkspaces(...args),
    detectAgents: vi.fn().mockResolvedValue([]),
    detectShells: vi.fn().mockResolvedValue([{ id: 'shell', name: 'PowerShell', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' }]),
    listLiveSessions: vi.fn().mockResolvedValue([]),
    createTerminalSession: (...args: unknown[]) => createSession(...args),
    terminateTerminalSession: (...args: unknown[]) => terminateSession(...args),
    terminateWorkspaceSessions: vi.fn().mockResolvedValue(undefined),
    removeLayoutPane: vi.fn(), splitLayoutPane: vi.fn(), validateWorkingDirectory: vi.fn(),
    saveSettings: (...args: unknown[]) => saveSettings(...args),
  },
}))

const project: Project = { id: 'project', name: 'Fixture', rootPath: 'C:\\fixture', canonicalRootPath: 'c:\\fixture', majorLanguages: ['Rust'], isGitRepository: true, hasPackageJson: false, hasLockfile: false, gitBranch: 'main', createdAt: '', updatedAt: '', lastOpenedAt: '' }
const workspace: Workspace = { id: 'workspace', projectId: 'project', name: 'Fresh workspace', layout: { type: 'pane', paneId: 'pane' }, activePaneId: 'pane', panes: [{ id: 'pane', workspaceId: 'workspace', title: 'PowerShell', provider: 'powershell', executablePath: 'C:\\pwsh.exe', args: [], workingDirectory: 'C:\\fixture', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: new Date().toISOString() }
const session: TerminalSession = { id: 'session', workspaceId: 'workspace', paneId: 'pane', provider: 'powershell', title: 'PowerShell', workingDirectory: 'C:\\fixture', status: 'running', processId: 7, startedAt: new Date().toISOString(), outputTail: [], nextSequence: 0 }
const secondWorkspace: Workspace = { ...workspace, id: 'workspace-two', name: 'Second workspace', panes: workspace.panes.map((pane) => ({ ...pane, id: 'pane-two', workspaceId: 'workspace-two' })), layout: { type: 'pane', paneId: 'pane-two' }, activePaneId: 'pane-two' }

describe('Workspace screen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createSession.mockResolvedValue(session)
    onTerminalExit.mockResolvedValue(() => undefined)
    saveSettings.mockImplementation(async (value) => value)
    getWorkspace.mockResolvedValue(secondWorkspace)
    const recentWorkspaces = [workspace, secondWorkspace].map((item) => ({ workspace: item, projectName: project.name, projectPath: project.rootPath, projectMissing: false }))
    listRecentWorkspaces.mockResolvedValue(recentWorkspaces)
    useAppStore.setState({ project, workspace, recentWorkspaces, sessions: {}, activePaneId: 'pane', settings: { ...useAppStore.getState().settings, sidebarOpen: true } })
  })

  it('starts fresh terminal sessions for the stored workspace on mount', async () => {
    render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1))
  })

  it('disposes a delayed terminal event subscription after unmount', async () => {
    let resolveListener!: (unsubscribe: () => void) => void
    const unsubscribe = vi.fn()
    onTerminalExit.mockReturnValueOnce(new Promise((resolve) => { resolveListener = resolve }))
    const view = render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    view.unmount()
    resolveListener(unsubscribe)
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
  })

  it('maximizes and restores a pane without removing it', async () => {
    render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    const pane = await screen.findByTestId('terminal-pane')
    expect(pane).toHaveAttribute('data-maximized', 'false')
    fireEvent.click(screen.getByText('Toggle maximize'))
    expect(pane).toHaveAttribute('data-maximized', 'true')
    fireEvent.click(screen.getByText('Toggle maximize'))
    expect(pane).toHaveAttribute('data-maximized', 'false')
  })

  it('persists the sidebar visibility through native settings', async () => {
    render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith(expect.objectContaining({ sidebarOpen: false })))
    expect(useAppStore.getState().settings.sidebarOpen).toBe(false)
  })

  it('replaces the terminal action with workspace creation and lists created workspaces', async () => {
    render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    await screen.findByTestId('terminal-pane')
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New terminal' })).not.toBeInTheDocument()
    expect(screen.getByText('Second workspace')).toBeInTheDocument()
  })

  it('switches workspaces through same-window routing', async () => {
    render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)
    await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByRole('button', { name: /Open Second workspace/i }))
    await waitFor(() => expect(getWorkspace).toHaveBeenCalledWith('workspace-two'))
    expect(await screen.findByRole('button', { name: 'Second workspace, current workspace' })).toBeInTheDocument()
  })
})
