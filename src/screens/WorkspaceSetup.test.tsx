import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSetup } from './WorkspaceSetup'
import { useAppStore } from '../stores/appStore'
import type { LayoutNode, Workspace, WorkspaceSaveRequest } from '../native/types'

const preset = vi.fn(async (count: number, variant: string): Promise<LayoutNode> => count === 1 ? { type: 'pane', paneId: 'one' } : { type: 'split', direction: variant === 'horizontal' ? 'horizontal' : 'vertical', sizes: Array(count).fill(100 / count), children: Array.from({ length: count }, (_, index) => ({ type: 'pane' as const, paneId: `pane-${index}` })) })
const saveWorkspaceMock = vi.fn(async (request: WorkspaceSaveRequest) => ({ ...request, normalizedName: request.name.toLowerCase(), id: request.id ?? 'workspace', createdAt: '', updatedAt: '', lastOpenedAt: '' }))
const getWorkspaceMock = vi.fn()
const existingWorkspace: Workspace = { id: 'ws-main', projectId: 'project', name: 'Main Development', normalizedName: 'main development', restoreBehavior: 'inherit', layout: { type: 'pane', paneId: 'one' }, activePaneId: 'one', panes: [{ id: 'one', workspaceId: 'ws-main', title: 'Claude', provider: 'claude', executablePath: 'C:\\claude.exe', args: [], workingDirectory: 'C:\\fixture', workingDirectoryMode: 'project_relative', positionOrder: 0 }], createdAt: '', updatedAt: '', lastOpenedAt: '' }

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
    validateWorkingDirectory: vi.fn(), validateCustomExecutable: vi.fn(), saveCustomShell: vi.fn(),
  },
}))

const renderSetup = (entry = '/setup/project') => render(<MemoryRouter initialEntries={[entry]}><Routes><Route path="/setup/:projectId" element={<WorkspaceSetup />} /><Route path="/workspace/:workspaceId/configure" element={<WorkspaceSetup />} /><Route path="/workspace/:workspaceId" element={<div>Workspace screen</div>} /></Routes></MemoryRouter>)

describe('Workspace Setup', () => {
  beforeEach(() => { vi.clearAllMocks(); getWorkspaceMock.mockResolvedValue(existingWorkspace); useAppStore.setState({ project: undefined }); localStorage.clear() })

  it('uses the configuration, assignment, and provider zones together', async () => {
    renderSetup()
    expect(await screen.findByText('Layout presets')).toBeInTheDocument()
    expect(screen.getByText('Assign your workspace')).toBeInTheDocument()
    expect(screen.getByText('Agent library')).toBeInTheDocument()
    expect(screen.getByText('Unavailable')).toBeInTheDocument()
  })

  it('selects explicit vertical and horizontal two-Pane layouts', async () => {
    renderSetup()
    await screen.findByText('Assign your workspace')
    fireEvent.click(screen.getByRole('button', { name: '2H Pane layout' }))
    await waitFor(() => expect(preset).toHaveBeenCalledWith(2, 'horizontal'))
    fireEvent.click(screen.getByRole('button', { name: '2V Pane layout' }))
    await waitFor(() => expect(preset).toHaveBeenCalledWith(2, 'vertical'))
  })

  it('creates a uniquely named Workspace and persists canonical restore metadata', async () => {
    renderSetup()
    expect(await screen.findByText('Creating workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Launch workspace' }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalled())
    expect(saveWorkspaceMock.mock.calls[0][0]).toEqual(expect.objectContaining({ projectId: 'project', name: 'Main Workspace', restoreBehavior: 'inherit' }))
  })

  it('supports the explicit configure route and preserves Workspace identity', async () => {
    renderSetup('/workspace/ws-main/configure')
    expect(await screen.findByText('Editing “Main Development”')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save and launch' }))
    await waitFor(() => expect(saveWorkspaceMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'ws-main', projectId: 'project' })))
  })
})
