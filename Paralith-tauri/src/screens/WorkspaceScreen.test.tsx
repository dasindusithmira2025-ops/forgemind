import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceScreen } from './WorkspaceScreen'
import { useAppStore } from '../stores/appStore'
import { useSidebarStore } from '../features/sidebar/sidebarStore'
import type { Project, SidebarPreferences, TerminalSession, Workspace, WorkspaceSaveRequest } from '../native/types'

const runtime = vi.hoisted(() => ({ sessions: [] as TerminalSession[], agentStates: {} as Record<string, never>, hydrate: vi.fn(), upsert: vi.fn(), remove: vi.fn(), clearWorkspace: vi.fn(), reconcileLiveSessions: vi.fn(), agentStateForSession: vi.fn(() => undefined) }))
// Captures the sidebar-preference broadcast so a change made in another window can be replayed.
const sidebarPreferencesChanged = vi.hoisted(() => ({ handlers: [] as Array<(preferences: SidebarPreferences) => void> }))
const restoreWorkspace = vi.fn()
const createTerminalSession = vi.fn()
const saveSettings = vi.fn()
const getWorkspace = vi.fn()
const listRecentWorkspaces = vi.fn()
const listWorkspacesForProject = vi.fn()
const terminateWorkspace = vi.fn()
const reorderWorkspaces = vi.fn()
const listSwarms = vi.fn()
const closeProjectSession = vi.fn()
const getSidebarPreferences = vi.fn()
const setSidebarPreferences = vi.fn()
const inspectRepository = vi.fn()
const saveWorkspace = vi.fn()

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath: vi.fn() }))
// The sidebar reads the cross-workspace view; the screen's own Panes read the per-Workspace one.
// Both resolve to the same fixture list, exactly as they do against the real store.
vi.mock('../features/terminals/runtimeStore', () => ({
  terminalRuntime: runtime,
  useWorkspaceSessions: () => runtime.sessions,
  useAllTerminalSessions: () => runtime.sessions,
  useAllAgentStates: () => runtime.agentStates,
}))
vi.mock('../components/terminal/TerminalPane', () => ({ TerminalPane: ({ assignment, deferred, maximized, onFocus, onMaximize, onRestart }: { assignment: { title: string }; deferred?: boolean; maximized: boolean; onFocus: () => void; onMaximize: () => void; onRestart: () => void }) => <div data-testid="terminal-pane" data-maximized={maximized} onMouseDown={onFocus}><span>{assignment.title}</span><button onClick={onMaximize}>Toggle maximize</button>{deferred && <button onMouseDown={(event) => event.stopPropagation()} onClick={onRestart}>Resume terminal</button>}</div> }))
vi.mock('../components/terminal/terminalActions', () => ({ dispatchTerminalAction: vi.fn() }))
// Only the subscription this screen actually opens is replaced; every other event helper keeps
// its real implementation so the rest of the mounted tree behaves exactly as it does untested.
vi.mock('../native/events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../native/events')>()),
  // Captures the sidebar-preference broadcast so a change from another window can be replayed.
  onSidebarPreferencesChanged: (handler: (preferences: SidebarPreferences) => void) => {
    sidebarPreferencesChanged.handlers.push(handler)
    return Promise.resolve(() => {
      sidebarPreferencesChanged.handlers = sidebarPreferencesChanged.handlers.filter((item) => item !== handler)
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
    listLiveSessions: vi.fn().mockResolvedValue([]),
    // Hydration awaits the handoff completion before probing providers; without it the creation
    // control would never leave its "detecting" state under test.
    completeWorkspaceHandoff: vi.fn().mockResolvedValue(undefined),
    subscribeTerminalOutput: vi.fn().mockResolvedValue([]), unsubscribeTerminalOutput: vi.fn().mockResolvedValue(undefined),
    restoreWorkspaceSessions: (...args: unknown[]) => restoreWorkspace(...args),
    createTerminalSession: (...args: unknown[]) => createTerminalSession(...args), terminateTerminalSession: vi.fn(), terminateWorkspaceSessions: (...args: unknown[]) => terminateWorkspace(...args),
    getPaneGitReview: vi.fn(), stagePaneFile: vi.fn(), restorePaneFile: vi.fn(), createIsolatedPaneWorktree: vi.fn(),
    inspectRepository: (...args: unknown[]) => inspectRepository(...args),
    listRepositoryWorktreeLeases: vi.fn().mockResolvedValue([]),
    getWorktreeConflictRisks: vi.fn().mockResolvedValue([]),
    listRepositoryBranches: vi.fn().mockResolvedValue([]),
    getGitHubProviderStatus: vi.fn().mockResolvedValue({ provider: 'github', host: 'github.com', authenticated: false, authenticationSource: 'gh_cli_secure_store', permissions: [], message: 'GitHub unavailable' }),
    listRepositoryApprovals: vi.fn().mockResolvedValue([]),
    refreshRepositoryRemoteProjection: vi.fn().mockResolvedValue({ projectId: 'project', provider: 'github', repository: {}, objects: [], syncStatuses: [], lastSuccessfulSync: '', stale: false }),
    listAgentProfiles: vi.fn().mockResolvedValue([]),
    removeLayoutPane: vi.fn(), splitLayoutPane: vi.fn(), validateWorkingDirectory: vi.fn(),
    getDiagnostics: vi.fn(), runHealthCheck: vi.fn(),
    listSwarms: (...args: unknown[]) => listSwarms(...args),
    openProjectSession: vi.fn(async () => [{ projectId: 'project', isActive: true, expanded: true, openedAt: '', updatedAt: '' }]),
    closeProjectSession: (...args: unknown[]) => closeProjectSession(...args),
    listWorkspacePlacements: vi.fn(async () => []), listMonitors: vi.fn(async () => []),
    setProjectLastActive: vi.fn(async () => undefined),
    saveSettings: (...args: unknown[]) => saveSettings(...args),
    getSidebarPreferences: (...args: unknown[]) => getSidebarPreferences(...args),
    setSidebarPreferences: (...args: unknown[]) => setSidebarPreferences(...args),
  },
}))

const project: Project = { id: 'project', name: 'Fixture', rootPath: 'C:\\fixture', canonicalRootPath: 'c:\\fixture', majorLanguages: ['Rust'], isGitRepository: true, hasPackageJson: false, hasLockfile: false, gitBranch: 'main', detectedFramework: 'Next.js', createdAt: '', updatedAt: '', lastOpenedAt: '' }
const workspace: Workspace = { id: 'workspace', projectId: 'project', name: 'Fresh workspace', normalizedName: 'fresh workspace', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'pane' }, activePaneId: 'pane', panes: [{ id: 'pane', workspaceId: 'workspace', title: 'PowerShell', provider: 'powershell', executablePath: 'C:\\pwsh.exe', args: [], workingDirectory: 'C:\\fixture', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: new Date().toISOString() }
const session: TerminalSession = { id: 'session', projectId: 'project', workspaceId: 'workspace', paneId: 'pane', provider: 'powershell', executable: 'C:\\pwsh.exe', arguments: [], title: 'PowerShell', workingDirectory: 'C:\\fixture', status: 'running', processId: 7, startedAt: new Date().toISOString(), outputTail: [], nextSequence: 0, restorationState: 'restored', droppedOutputBytes: 0 }
const secondWorkspace: Workspace = { ...workspace, id: 'workspace-two', name: 'Second workspace', normalizedName: 'second workspace', panes: workspace.panes.map((pane) => ({ ...pane, id: 'pane-two', workspaceId: 'workspace-two' })), layout: { type: 'pane', paneId: 'pane-two' }, activePaneId: 'pane-two' }

describe('Workspace screen', () => {
  beforeEach(() => {
    vi.clearAllMocks(); runtime.sessions = [session]; runtime.agentStates = {}
    // `preferencesHydrated` starts true so the store behaves as it does after startup: a setter
    // that fired before hydration is deliberately not written back, which would otherwise make
    // every preference assertion depend on the hydration race.
    useSidebarStore.setState({ projectSwitcherOpen: false, listOptionsOpen: false, diagnosticsOpen: false, menuWorkspaceId: undefined, draggingWorkspaceId: undefined, filterQuery: '', groupBy: 'project', sortMode: 'manual', collapsedGroups: {}, frozenOrder: [], sortEpoch: 0, preferencesHydrated: true })
    getSidebarPreferences.mockResolvedValue({ groupBy: 'project', sortMode: 'manual', collapsedGroups: [] })
    setSidebarPreferences.mockResolvedValue(undefined)
    inspectRepository.mockResolvedValue({ projectId: 'project', repositoryPath: 'C:\\fixture', worktreePath: 'C:\\fixture', branch: 'main', headSha: '0123456789012345678901234567890123456789', upstream: 'origin/main', ahead: 0, behind: 0, remotes: ['origin'], files: [], health: { gitAvailable: true, worktreeValid: true, bare: false, shallow: false, mergeInProgress: false, rebaseInProgress: false, cherryPickInProgress: false, revertInProgress: false, indexLocked: false, submodulesPresent: false, gitLfsAvailable: true, warnings: [] }, capturedAt: '' })
    restoreWorkspace.mockResolvedValue({ workspaceId: 'workspace', sessions: [session], deferredPaneIds: [], failures: [], budget: 4 })
    createTerminalSession.mockResolvedValue(session)
    saveWorkspace.mockImplementation(async (request: WorkspaceSaveRequest) => ({ ...request, normalizedName: request.name.toLowerCase(), id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' }))
    terminateWorkspace.mockResolvedValue(undefined)
    reorderWorkspaces.mockResolvedValue(undefined)
    saveSettings.mockImplementation(async (value) => value)
    getWorkspace.mockImplementation(async (id: string) => id === secondWorkspace.id ? secondWorkspace : workspace)
    listRecentWorkspaces.mockResolvedValue([workspace, secondWorkspace].map((item) => ({ workspace: item, projectName: project.name, projectPath: project.rootPath, projectMissing: false })))
    listWorkspacesForProject.mockResolvedValue([workspace, secondWorkspace])
    listSwarms.mockResolvedValue([])
    closeProjectSession.mockResolvedValue([])
    useAppStore.setState({ project, workspace, recentWorkspaces: [], activePaneId: 'pane', settings: { ...useAppStore.getState().settings, sidebarOpen: true, sidebarWidth: 300, restoreBehavior: 'restart_agents' } })
  })

  const renderWorkspace = () => render(<MemoryRouter initialEntries={['/workspace/workspace']}><Routes><Route path="/workspace/:workspaceId" element={<WorkspaceScreen />} /></Routes></MemoryRouter>)

  it('restores through the bounded native scheduler', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    await waitFor(() => expect(restoreWorkspace).toHaveBeenCalledWith('workspace', 4, 'restart_agents'))
  })

  it('renders the four sidebar bands without removed navigation surfaces', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    // Band 1 — header: application identity, plus the one destination that is not an entity.
    expect(screen.getByLabelText('PARALITH')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Search/ })).toBeInTheDocument()
    // Band 2 — section header: the list is Workspaces, and the controls are scoped to it.
    expect(screen.getByText('Workspaces')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse workspace list' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open a Project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'List options' })).toBeInTheDocument()
    // Band 3 — scroll body: one group per open Project, plus Swarms. "Other Monitors" appears
    // only when a Workspace is detached; the fixture has none. With a single Project open the
    // group keeps its labelled region but drops the visible header the section above restates.
    expect(screen.getByRole('region', { name: 'Fixture' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Swarms' })).toBeInTheDocument()
    expect(screen.getAllByRole('region')).toHaveLength(2)
    expect(screen.queryByText('Other Monitors')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New swarm' })).toBeInTheDocument()
    // Band 4 — status: the destinations that are not Workspaces. No update is available in the
    // fixture, so no update control exists at all rather than a dead disabled one.
    expect(screen.getByRole('button', { name: 'Source Control' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Diagnostics' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update now|Install & restart/ })).not.toBeInTheDocument()
    // The nav band of destination rows is gone; nothing re-creates it.
    expect(screen.queryByRole('navigation', { name: 'Go to' })).not.toBeInTheDocument()
    // Two Workspaces and no Swarms is under the filter threshold, so the field stays hidden.
    expect(screen.queryByRole('searchbox', { name: 'Filter Workspaces and Swarms' })).not.toBeInTheDocument()
    // Removed navigation must not exist anywhere.
    for (const name of ['Agents', 'Files', 'Preview', 'Terminal Grid', 'Workspace overview']) {
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

  it('opens Source Control in the workspace panel with the active worktree path', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    fireEvent.click(screen.getByRole('button', { name: 'Source Control' }))
    await waitFor(() => expect(inspectRepository).toHaveBeenCalledWith('project', 'C:\\fixture', 'C:\\fixture'))
    expect(screen.getByRole('tab', { name: 'Source Control' })).toBeInTheDocument()
  })

  it('collapses the Workspace list alone, and persists that through typed settings', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    const list = () => document.getElementById('sidebar-workspace-list') as HTMLElement
    expect(list()).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse workspace list' }))

    // The Workspace rows go; Swarms and the pinned bands are not the chevron's business.
    await waitFor(() => expect(list()).not.toBeVisible())
    expect(screen.getByRole('region', { name: 'Swarms' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Expand workspace list' })).toBeInTheDocument()
    await waitFor(() =>
      expect(setSidebarPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ collapsedGroups: expect.arrayContaining(['workspaces-section']) }),
      ),
    )
  })

  it('groups Workspaces by Project and flips to one flat list on demand', async () => {
    renderWorkspace(); await screen.findByTestId('terminal-pane')
    // Default grouping: a labelled section per open Project.
    expect(screen.getByRole('region', { name: 'Fixture' })).toBeInTheDocument()

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
    const rows = () => screen.getByRole('region', { name: 'Fixture' }).querySelectorAll('.ws-row[draggable="true"]')
    // Manual order is draggable: a drop index maps onto the persisted order.
    expect(rows().length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'List options' }))
    fireEvent.click(await screen.findByRole('radio', { name: 'Needs you' }))

    // Attention order owns the sequence, so rows stop accepting a drop entirely.
    await waitFor(() => expect(rows()).toHaveLength(0))
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

  it('creates a pane beside the focused context without opening a picker', async () => {
    renderWorkspace()
    await screen.findByTestId('terminal-pane')
    const create = await screen.findByRole('button', { name: 'Terminal' })
    await waitFor(() => expect(create).toBeEnabled())

    fireEvent.click(create)

    await waitFor(() => expect(saveWorkspace).toHaveBeenCalled())
    const request = saveWorkspace.mock.calls.at(-1)![0] as WorkspaceSaveRequest
    expect(request.layout).toMatchObject({ type: 'split' })
    expect(request.panes).toHaveLength(2)
    // The new pane inherits the target's directory, which is how a worktree context is carried.
    expect(request.panes[1].workingDirectory).toBe(workspace.panes[0].workingDirectory)
    expect(request.activePaneId).toBe(request.panes[1].id)
    // No modal stood between the click and the running terminal.
    expect(screen.queryByText('Choose terminal')).toBeNull()
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
})
