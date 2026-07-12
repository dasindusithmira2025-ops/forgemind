import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSetup } from './WorkspaceSetup'
import { useAppStore } from '../stores/appStore'
import type { LayoutNode, Workspace, WorkspaceSaveRequest } from '../native/types'

const preset = vi.fn(async (count: number, variant: string): Promise<LayoutNode> => count === 1 ? { type: 'pane', paneId: 'one' } : { type: 'split', direction: variant === 'horizontal' ? 'horizontal' : 'vertical', sizes: Array(count).fill(100 / count), children: Array.from({ length: count }, (_, index) => ({ type: 'pane' as const, paneId: `pane-${index}` })) })
const saveWorkspaceMock = vi.fn(async (request: WorkspaceSaveRequest) => ({ ...request, id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' }))
const getWorkspaceMock = vi.fn()
const existingWorkspace: Workspace = { id: 'ws-main', projectId: 'project', name: 'Main Development', layout: { type: 'pane', paneId: 'one' }, activePaneId: 'one', panes: [{ id: 'one', workspaceId: 'ws-main', title: 'Claude', provider: 'claude', executablePath: 'C:\\claude.exe', args: [], workingDirectory: 'C:\\fixture', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getProject: vi.fn().mockResolvedValue({ id: 'project', name: 'Fixture', rootPath: 'C:\\fixture', canonicalRootPath: 'c:\\fixture', majorLanguages: ['TypeScript'], isGitRepository: true, hasPackageJson: true, hasLockfile: true, gitBranch: 'main', detectedFramework: 'React', createdAt: '', updatedAt: '', lastOpenedAt: '' }),
    getWorkspace: (...args: unknown[]) => getWorkspaceMock(...args),
    suggestWorkspaceName: vi.fn().mockResolvedValue('Main Workspace'),
    listLiveSessions: vi.fn().mockResolvedValue([]),
    detectAgents: vi.fn().mockResolvedValue([{ provider: 'claude', available: false, errorCode: 'executable_not_found', errorMessage: 'Not installed', detectedAt: '' }]),
    detectShells: vi.fn().mockResolvedValue([{ id: 'shell', name: 'PowerShell', executablePath: 'C:\\pwsh.exe', args: [], available: true, source: 'detected' }]),
    getLayoutPreset: (count: number, variant: string) => preset(count, variant),
    saveWorkspace: (...args: [WorkspaceSaveRequest]) => saveWorkspaceMock(...args),
    validateWorkingDirectory: vi.fn(), validateCustomExecutable: vi.fn(),
  },
}))

const renderSetup = (entry = '/setup/project') => render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/setup/:projectId" element={<WorkspaceSetup />} /><Route path="/workspace/:workspaceId" element={<div>Workspace screen</div>} /></Routes></MemoryRouter>)

describe('Workspace Setup', () => {
  beforeEach(() => { vi.clearAllMocks(); getWorkspaceMock.mockResolvedValue(existingWorkspace); useAppStore.setState({ project: undefined }); localStorage.clear() })

  it('selects a terminal-count layout on the Layout step, then assigns terminals on the Agents step', async () => {
    renderSetup()
    await screen.findByText('Set up your workspace')

    fireEvent.click(screen.getByRole('button', { name: /^1 pane$/i }))

    fireEvent.click(screen.getByRole('button', { name: /add ai agents/i }))
    await screen.findByText('Assign terminals')
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText(/Pane 1/).length).toBeGreaterThan(0))
    expect(screen.getAllByRole('option', { name: 'PowerShell' }).length).toBeGreaterThan(0)
  })

  it('supports inline workspace naming', async () => {
    renderSetup()
    const input = await screen.findByLabelText('Workspace name')
    fireEvent.change(input, { target: { value: 'Focused work' } })
    expect(input).toHaveValue('Focused work')
  })

  it('lets you step back from Agents to Layout', async () => {
    renderSetup()
    await screen.findByText('Set up your workspace')
    fireEvent.click(screen.getByRole('button', { name: /add ai agents/i }))
    await screen.findByText('Add your AI agents')
    fireEvent.click(screen.getByRole('button', { name: /back to layout/i }))
    expect(await screen.findByText('Set up your workspace')).toBeInTheDocument()
  })

  it('create mode proposes a unique default name and mints a new workspace id', async () => {
    renderSetup()
    expect(await screen.findByText('Creating workspace')).toBeInTheDocument()
    expect(await screen.findByLabelText('Workspace name')).toHaveValue('Main Workspace')
    fireEvent.click(await screen.findByRole('button', { name: /add ai agents/i }))
    fireEvent.click(await screen.findByRole('button', { name: /launch workspace/i }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    expect(saveWorkspaceMock.mock.calls[0][0].id).not.toBe('ws-main')
  })

  it('edit mode loads the existing workspace and saves in place with the same id', async () => {
    renderSetup('/setup/project?workspaceId=ws-main')
    expect(await screen.findByText('Editing “Main Development”')).toBeInTheDocument()
    expect(await screen.findByLabelText('Workspace name')).toHaveValue('Main Development')
    expect(getWorkspaceMock).toHaveBeenCalledWith('ws-main')
    fireEvent.click(await screen.findByRole('button', { name: /add ai agents/i }))
    fireEvent.click(await screen.findByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    expect(saveWorkspaceMock.mock.calls[0][0].id).toBe('ws-main')
  })

  it('duplicate mode copies the layout into a new workspace id', async () => {
    renderSetup('/setup/project?duplicate=ws-main')
    expect(await screen.findByText('Duplicating workspace')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /add ai agents/i }))
    fireEvent.click(await screen.findByRole('button', { name: /launch workspace/i }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    expect(saveWorkspaceMock.mock.calls[0][0].id).not.toBe('ws-main')
  })
})
