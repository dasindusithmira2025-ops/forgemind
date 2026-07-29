import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSetup } from './WorkspaceSetup'
import { useSetupStore } from '../features/workspace-setup/setupStore'
import type { LayoutNode, Workspace, WorkspaceSaveRequest } from '../native/types'

const preset = vi.fn(async (count: number, variant: string): Promise<LayoutNode> =>
  count === 1
    ? { type: 'pane', paneId: 'pane-0' }
    : { type: 'split', direction: variant === 'horizontal' ? 'horizontal' : 'vertical', sizes: Array(count).fill(100 / count), children: Array.from({ length: count }, (_, index) => ({ type: 'pane' as const, paneId: `pane-${index}` })) })

const saveWorkspaceMock = vi.fn(async (request: WorkspaceSaveRequest): Promise<Workspace> => ({ ...request, normalizedName: request.name.toLowerCase(), id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' }))
const getWorkspaceMock = vi.fn()
const existingWorkspace: Workspace = { id: 'ws-main', projectId: 'project', name: 'Main Development', normalizedName: 'main development', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'one' }, activePaneId: 'one', panes: [{ id: 'one', workspaceId: 'ws-main', title: 'Claude Code', provider: 'claude', executablePath: 'C:\\claude.exe', args: [], workingDirectory: 'C:\\fixture', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getProject: vi.fn().mockResolvedValue({ id: 'project', name: 'Fixture', rootPath: 'C:\\fixture', canonicalRootPath: 'c:\\fixture', majorLanguages: ['TypeScript'], isGitRepository: true, hasPackageJson: true, hasLockfile: true, gitBranch: 'main', detectedFramework: 'React', createdAt: '', updatedAt: '', lastOpenedAt: '' }),
    getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
    suggestWorkspaceName: vi.fn().mockResolvedValue('Main Workspace'),
    listLiveSessions: vi.fn().mockResolvedValue([]),
    listRecentProjects: vi.fn().mockResolvedValue([]),
    detectAgents: vi.fn().mockResolvedValue([
      { provider: 'claude', available: true, executablePath: 'C:\\claude.exe', version: '1.0', detectedAt: '' },
      { provider: 'codex', available: false, errorCode: 'executable_not_found', errorMessage: 'Not installed', detectedAt: '' },
    ]),
    detectShells: vi.fn().mockResolvedValue([{ id: 'ps', name: 'PowerShell', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' }]),
    validateWorkingDirectory: vi.fn(async (_root: string, dir: string) => dir),
    getLayoutPreset: (count: number, variant: string) => preset(count, variant),
    saveWorkspace: (...args: [WorkspaceSaveRequest]) => saveWorkspaceMock(...args),
  },
}))

const renderSetup = (entry = '/setup/project') => render(
  <MemoryRouter initialEntries={[entry]}>
    <Routes>
      <Route path="/setup/:projectId" element={<WorkspaceSetup />} />
      <Route path="/workspace/:workspaceId/configure" element={<WorkspaceSetup />} />
      <Route path="/workspace/:workspaceId" element={<div>Workspace screen</div>} />
    </Routes>
  </MemoryRouter>,
)

const goToLayout = async () => { fireEvent.click(await screen.findByRole('button', { name: /Continue to Layout/ })) }
const goToAgents = async () => { await goToLayout(); fireEvent.click(await screen.findByRole('button', { name: /Next: Add AI Agents/ })) }

describe('Workspace setup wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getWorkspaceMock.mockResolvedValue(existingWorkspace)
    useSetupStore.getState().reset()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('starts on the Start step with the project and a suggested name', async () => {
    renderSetup()
    expect(await screen.findByText('Name your workspace')).toBeInTheDocument()
    expect(screen.getByText('Fixture')).toBeInTheDocument()
    await waitFor(() => expect((screen.getByPlaceholderText('Main Workspace') as HTMLInputElement).value).toBe('Main Workspace'))
  })

  it('walks Start → Layout → Agents and launches a count-based workspace', async () => {
    renderSetup()
    await goToAgents()
    // Allocate one Claude Code across the default 4-terminal layout.
    fireEvent.click(await screen.findByRole('button', { name: 'Add one Claude Code' }))
    await waitFor(() => expect(screen.getByText('1 / 4 assigned')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Launch 4 terminals/ }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    const request = saveWorkspaceMock.mock.calls[0][0]
    expect(request.panes).toHaveLength(4)
    expect(request.panes[0].provider).toBe('claude')
    expect(request.panes.slice(1).every((pane) => pane.provider === 'powershell')).toBe(true)
    expect(await screen.findByText('Workspace screen')).toBeInTheDocument()
  })

  it('opens without AI from the Layout step using only shells', async () => {
    renderSetup()
    await goToLayout()
    fireEvent.click(await screen.findByRole('button', { name: /Open without AI/ }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    const request = saveWorkspaceMock.mock.calls[0][0]
    expect(request.panes.every((pane) => pane.provider === 'powershell')).toBe(true)
  })

  it('shows the reduction dialog when a smaller layout is chosen after allocating agents', async () => {
    renderSetup()
    await goToAgents()
    const add = await screen.findByRole('button', { name: 'Add one Claude Code' })
    fireEvent.click(add)
    fireEvent.click(add)
    await waitFor(() => expect(screen.getByText('2 / 4 assigned')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(await screen.findByRole('radio', { name: /1 terminal Solo layout/ }))
    expect(await screen.findByText(/assigns 2 agents, but the selected layout has 1 terminals/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reduce automatically' }))
    await waitFor(() => expect(screen.queryByText(/assigns 2 agents/)).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Next: Add AI Agents/ }))
    expect(await screen.findByText('1 / 1 assigned')).toBeInTheDocument()
  })

  it('reconfigures an existing workspace in place, preserving its identity', async () => {
    renderSetup('/workspace/ws-main/configure')
    expect(await screen.findByText('Editing workspace')).toBeInTheDocument()
    await goToAgents()
    fireEvent.click(await screen.findByRole('button', { name: /Launch/ }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'ws-main', projectId: 'project' })))
  })

  it('prevents duplicate launches from repeated clicks', async () => {
    renderSetup()
    await goToAgents()
    const launch = await screen.findByRole('button', { name: /Launch workspace/ })
    fireEvent.click(launch)
    fireEvent.click(launch)
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    expect(saveWorkspaceMock).toHaveBeenCalledTimes(1)
  })
})
