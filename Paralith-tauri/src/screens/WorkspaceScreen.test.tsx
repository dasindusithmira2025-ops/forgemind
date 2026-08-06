import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceScreen } from './WorkspaceScreen'
import { useAppStore } from '../stores/appStore'
import { useSidebarStore } from '../features/sidebar/sidebarStore'
import type { PaneRenamedEvent, Project, TerminalSession, Workspace, WorkspaceSaveRequest } from '../native/types'

const runtime = vi.hoisted(() => ({ sessions: [] as TerminalSession[], hydrate: vi.fn(), upsert: vi.fn(), remove: vi.fn(), clearWorkspace: vi.fn(), agentStateForSession: vi.fn(() => undefined) }))
// Captures the backend Pane-rename subscription so a broadcast can be replayed into the screen.
const paneRenamed = vi.hoisted(() => ({ handlers: [] as Array<(event: PaneRenamedEvent) => void> }))
const restoreWorkspace = vi.fn()
const saveWorkspace = vi.fn()
const createTerminalSession = vi.fn()
const saveSettings = vi.fn()
const getWorkspace = vi.fn()
const listRecentWorkspaces = vi.fn()
const listWorkspacesForProject = vi.fn()
const terminateWorkspace = vi.fn()
const reorderWorkspaces = vi.fn()
const listSwarms = vi.fn()
const closeProjectSession = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }))
vi.mock('../features/terminals/runtimeStore', () => ({ terminalRuntime: runtime, useWorkspaceSessions: () => runtime.sessions }))
vi.mock('../components/terminal/TerminalPane', () => ({ TerminalPane: ({ assignment, deferred, maximized, onFocus, onMaximize, onRestart }: { assignment: { title: string }; deferred?: boolean; maximized: boolean; onFocus: () => void; onMaximize: () => void; onRestart: () => void }) => <div data-testid="terminal-pane" data-maximized={maximized} onMouseDown={onFocus}><span>{assignment.title}</span><button onClick={onMaximize}>Toggle maximize</button>{deferred && <button onMouseDown={(event) => event.stopPropagation()} onClick={onRestart}>Resume terminal</button>}</div> }))
vi.mock('../components/terminal/terminalActions', () => ({ dispatchTerminalAction: vi.fn() }))
// Only the Pane-rename subscription is replaced; every other event helper keeps its real
// implementation so the rest of the mounted tree behaves exactly as it does untested.
vi.mock('../native/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/events')>()),
  onPaneRenamed: (handler: (event: PaneRenamedEvent) => void) => {
    paneRenamed.handlers.push(handler)
    return Promise.resolve(() => {
      paneRenamed.handlers = paneRenamed.handlers.filter((item) => item !== handler)
    })
  },
}))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getProject: vi.fn(async () => project), getWorkspace: (...args: unknown[]) => getWorkspace(...args),
    saveWorkspace: (...args: unknown[]) => saveWorkspace(...args),
    listRecentWorkspaces: (...args: unknown[]) => listRecentWorkspaces(...args),
    listWorkspacesForProject: (...args: unknown[]) => listWorkspacesForProject(...args),
    setLastActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    reorderWorkspaces: (...args: unknown[]) => reorderWorkspaces(...args),
    duplicateWorkspace: vi.fn().mockResolvedValue(undefined),
    renameWorkspace: vi.fn(), removeRecentWorkspace: vi.fn(), deleteWorkspaceConfiguration: vi.fn(), relocateProject: vi.fn(), openProject: vi.fn(),
    detectAgents: vi.fn().mockResolvedValue([]), detectShells: vi.fn().mockResolvedValue([{ id: 'shell', name: 'PowerShell', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' }]),
    listLiveSessions: vi.fn().mockResolvedValue([]), restoreWorkspaceSessions: (...args: unknown[]) => restoreWorkspace(...args),
    createTerminalSession: (...args: unknown[]) => createTerminalSession(...args), terminateTerminalSession: vi.fn(), terminateWorkspaceSessions: (...args: unknown[]) => terminateWorkspace(...args),
    getPaneGitReview: vi.fn(), stagePaneFile: vi.fn(), restorePaneFile: vi.fn(), createIsolatedPaneWorktree: vi.fn(),
    removeLayoutPane: vi.fn(), splitLayoutPane: vi.fn(), validateWorkingDirectory: vi.fn(),
    getDiagnostics: vi.fn(), runHealthCheck: vi.fn(),
    listSwarms: (...args: unknown[]) => listSwarms(...args),
    openProjectSession: vi.fn(async () => [{ projectId: 'project', isActive: true, expanded: true, openedAt: '', updatedAt: '' }]),
    closeProjectSession: (...args: unknown[]) => closeProjectSession(...args),
    listWorkspacePlacements: vi.fn(async () => []), listMonitors: vi.fn(async () => []),
    setProjectLastActive: vi.fn(async () => undefined),
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
    useSidebarStore.setState({ projectSwitcherOpen: false, listOptionsOpen: false, diagnosticsOpen: false, menuWorkspaceId: undefined, draggingWorkspaceId: undefined, filterQuery: '', groupBy: 'project', sortMode: 'manual', collapsedGroups: {} })
    restoreWorkspace.mockResolvedValue({ workspaceId: 'workspace', sessions: [session], deferredPaneIds: [], failures: [], budget: 4 })
    createTerminalSession.mockResolvedValue(session)
    terminateWorkspace.mockResolvedValue(undefined)
    reorderWorkspaces.mockResolvedValue(undefined)
    saveSettings.mockImplementation(async (value) => value)
    saveWorkspace.mockImplementation(async (request: WorkspaceSaveRequest) => ({ ...request, normalizedName: request.name.toLowerCase(), id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' }))
    getWorkspace.mockImplementation(async (id: string) => id === secondWorkspace.id ? secondWorkspace : workspace)
    listRecentWorkspaces.mockResolvedValue([workspace, secondWorkspace].map((item) => ({ workspace: item, projectName: project.name, projectPath: project.rootPath, projectMissing: false })))
    listWorkspacesForProject.mockResolvedValue([workspace, secondWorkspace])
    listSwarms.mockResolvedValue([])
    closeProjectSession.mockResolvedValue([])
    useAppStore.setState({ project, workspace, recentWorkspaces: [], activePaneId: 'pane', settings: { ...useAppStore.getState().settings, sidebarOpen: true, sidebarWidth: 300, restoreBehavior: 'restart_agents' } })
    paneRenamed.handlers = []
  })

  const renderWorkspace = () => render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)

  it('restores through the bounded native scheduler', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(restoreWorkspace).toHaveBeenCalledWith('workspace', 4, 'restart_agents'))
  })

  it('renders the four sidebar zones without removed navigation surfaces', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    // Zone 1 — nav: destinations only, each with a real target.
    expect(screen.getByRole('navigation', { name: 'Go to' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Search/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repository' })).toBeInTheDocument()
    // Zone 2 — list header: the title names the current grouping.
    expect(screen.getByText('Projects')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open a Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    // Zone 3 — scroll body: one group per open Project, plus Swarms. "Other Monitors" appears
    // only when a Workspace is detached; the fixture has none.
    expect(screen.getByRole('region', { name: 'Fixture' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Swarms' })).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(2)
    expect(screen.queryByText('Other Monitors')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New swarm' })).toBeInTheDocument()
    // Zone 4 — toolbar: identity plus the least-used controls.
    expect(screen.getByLabelText('PARALITH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeInTheDocument()
    // Two Workspaces and no Swarms is under the filter threshold, so the field stays hidden.
    expect(screen.queryByRole('searchbox', { name: 'Filter Workspaces and Swarms' })).not.toBeInTheDocument()
    // Removed navigation must not exist anywhere.
    for (const name of ['Agents', 'Files', 'Source Control', 'Preview', 'Terminal Grid', 'Workspace overview']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
  })

  it('gives every sidebar action exactly one entry point', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    // Collapse, Settings, and Diagnostics each used to exist twice over (header + footer rail,
    // and again in the brand-logo menu). They now live only in the toolbar.
    expect(screen.getAllByRole('button', { name: 'Collapse sidebar' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Diagnostics' })).toHaveLength(1)
    // Closing a Project lives only in the Project surface, never as a bare group-header control.
    expect(screen.queryByRole('button', { name: 'Close project Fixture' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open a Project' }))
    expect(await screen.findByRole('dialog', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Close project Fixture' })).toHaveLength(1)
  })

  it('groups Workspaces by Project and flips to one flat list on demand', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    // Default grouping: a section per open Project, titled with the Project's name.
    expect(screen.getByRole('region', { name: 'Fixture' })).toBeInTheDocument()
    expect(screen.getByText('Projects')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'List options' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Workspaces' }))

    // Flat grouping: one ungrouped list, and the title says so.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Workspaces' })).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Fixture' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Workspaces' })).getByText('Fresh workspace')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Workspaces' })).getByText('Second workspace')).toBeInTheDocument()
  })

  it('suspends drag reordering while the attention order is active', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const group = () => within(screen.getByRole('region', { name: 'Fixture' }))
    // Manual order is draggable: a drop index maps onto the persisted order.
    expect(group().getAllByTitle('Drag to reorder').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'List options' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Needs you' }))

    // Attention order owns the sequence, so the handle that implies "you own it" disappears.
    await waitFor(() => expect(group().queryByTitle('Drag to reorder')).not.toBeInTheDocument())
  })

  it('filters both primary lists once they are long enough to need it', async () => {
    listSwarms.mockResolvedValue(
      ['Refactor auth', 'Upgrade deps', 'Docs sweep', 'Flaky tests'].map((name, index) => ({
        swarm: { id: `swarm-${index}`, projectId: 'project', projectRoot: 'c:\\fixture', name, lifecycle: 'planning', progress: 0.1 },
        activity: {},
      })),
    )
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const filter = await screen.findByRole('searchbox', { name: 'Filter Workspaces and Swarms' })
    const workspaceList = () => within(screen.getByRole('region', { name: 'Fixture' }))
    const swarmList = () => within(screen.getByRole('region', { name: 'Swarms' }))

    fireEvent.change(filter, { target: { value: 'second' } })
    await waitFor(() => expect(workspaceList().queryByText('Fresh workspace')).not.toBeInTheDocument())
    expect(workspaceList().getByText('Second workspace')).toBeInTheDocument()
    expect(swarmList().queryByText('Refactor auth')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('1 match')

    // The same query narrows Swarms. A Project group with no match drops out entirely — an empty
    // header would read as "this Project has nothing", not "nothing here matched" — so the list
    // says so once, on its own behalf.
    fireEvent.change(filter, { target: { value: 'auth' } })
    await waitFor(() => expect(swarmList().getByText('Refactor auth')).toBeInTheDocument())
    expect(screen.queryByRole('region', { name: 'Fixture' })).not.toBeInTheDocument()
    expect(screen.getByText('No Workspace matches the filter.')).toBeInTheDocument()
    expect(swarmList().queryByText('Docs sweep')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(workspaceList().getByText('Fresh workspace')).toBeInTheDocument())
    expect(swarmList().getByText('Docs sweep')).toBeInTheDocument()
  })

  it('offers keep-running, pause-and-close, or cancel for active Project Swarms', async () => {
    listSwarms.mockResolvedValue([{ swarm: { id: 'swarm', projectId: 'project', projectRoot: 'c:\\fixture', name: 'Active', lifecycle: 'running', progress: 0.2 }, activity: {} }])
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByRole('button', { name: 'Open a Project' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Close project Fixture' }))
    expect(await screen.findByText('1 active Swarm')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep running' })).toBeInTheDocument()
    expect(closeProjectSession).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Pause and close' }))
    await waitFor(() => expect(closeProjectSession).toHaveBeenCalledWith('project', 'pause_and_close'))
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
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
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
    const pane = await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(restoreWorkspace).toHaveBeenCalled())
    expect(createTerminalSession).not.toHaveBeenCalled()

    fireEvent.mouseDown(pane)
    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1))
  })

  it('launches a deferred Pane once when its Resume button is pressed', async () => {
    runtime.sessions = []
    restoreWorkspace.mockResolvedValue({ workspaceId: 'workspace', sessions: [], deferredPaneIds: ['pane'], failures: [], budget: 1 })
    renderWorkspace()
    const resume = await screen.findByRole('button', { name: 'Resume terminal' })

    fireEvent.mouseDown(resume)
    fireEvent.click(resume)
    await waitFor(() => expect(createTerminalSession).toHaveBeenCalledTimes(1))
  })

  // A task sent to an agent renames its Pane in Rust, which persists the title and broadcasts it.
  // The screen must adopt that title without issuing a save of its own.
  it('adopts a Pane title derived from the task sent to its agent', async () => {
    renderWorkspace()
    await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(paneRenamed.handlers.length).toBeGreaterThan(0))

    const broadcast = (patch: Partial<PaneRenamedEvent> = {}) => paneRenamed.handlers.forEach((handler) => handler({
      workspaceId: 'workspace', paneId: 'pane', sessionId: 'session', title: 'Fix login bug', source: 'agent_task', ...patch,
    }))

    broadcast()
    expect(await within(screen.getByTestId('terminal-pane')).findByText('Fix login bug')).toBeInTheDocument()
    // The status bar names the active Pane from the same record.
    expect(screen.getAllByText('Fix login bug').length).toBeGreaterThan(1)
    // Rust already persisted the title; saving again here would race that write.
    expect(saveWorkspace).not.toHaveBeenCalled()

    // An event for a Workspace this screen does not show must be ignored.
    broadcast({ workspaceId: 'workspace-two', title: 'Other task' })
    await waitFor(() => expect(screen.queryByText('Other task')).not.toBeInTheDocument())
  })
})
