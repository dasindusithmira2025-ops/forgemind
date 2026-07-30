import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { AgentResumeRecord, ResumeAgentSessionResult } from '../../native/types'

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  list: vi.fn(),
  resume: vi.fn(),
  openProject: vi.fn(),
  dismiss: vi.fn(),
  dismissAll: vi.fn(),
  remove: vi.fn(),
  relocateProject: vi.fn(),
  relocateWorktree: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => error instanceof Error ? { message: error.message } : { message: String(error) },
  native: {
    reconcileAgentResumeSessions: mocks.reconcile,
    listAgentResumeSessions: mocks.list,
    resumeAgentSession: mocks.resume,
    openProjectSession: mocks.openProject,
    dismissAgentResumeSession: mocks.dismiss,
    dismissAllAgentResumeSessions: mocks.dismissAll,
    removeAgentResumeSession: mocks.remove,
    relocateProject: mocks.relocateProject,
    relocateAgentResumeWorktree: mocks.relocateWorktree,
  },
}))

import { AgentResumeCenter } from './AgentResumeCenter'
import { OPEN_AGENT_RESUME_CENTER } from './events'

const exactId = '5bb49df0-2afe-4fe2-8fd4-8aa4ba2943a9'

function record(overrides: Partial<AgentResumeRecord> = {}): AgentResumeRecord {
  return {
    terminalSessionId: 'terminal-1',
    projectId: 'project-1',
    projectName: 'Paralith',
    workspaceId: 'workspace-1',
    workspaceName: 'Main',
    paneId: 'pane-1',
    provider: 'claude',
    providerSessionId: exactId,
    sessionTitle: 'Claude · Main',
    repositoryRoot: 'E:\\Forgespace',
    repositoryIdentity: 'E:\\Forgespace\\.git',
    worktreePath: 'E:\\Forgespace',
    branch: 'feat/resume',
    workingDirectory: 'E:\\Forgespace\\Paralith-tauri',
    launchExecutable: 'claude.exe',
    launchArguments: ['--session-id', exactId],
    originalLaunchArguments: [],
    lastActivityAt: new Date().toISOString(),
    status: 'stopped',
    shutdownReason: 'unclean_shutdown',
    recoveryStatus: 'resumable',
    commandPreview: `claude.exe --resume ${exactId}`,
    ...overrides,
  }
}

function result(item: AgentResumeRecord): ResumeAgentSessionResult {
  return {
    sourceTerminalSessionId: item.terminalSessionId,
    workspaceId: item.workspaceId,
    paneId: item.paneId,
    terminal: {
      id: `live-${item.terminalSessionId}`,
      projectId: item.projectId,
      workspaceId: item.workspaceId,
      paneId: item.paneId,
    } as ResumeAgentSessionResult['terminal'],
  }
}

function renderCenter() {
  return render(<MemoryRouter><AgentResumeCenter /></MemoryRouter>)
}

describe('AgentResumeCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    mocks.list.mockResolvedValue([])
    mocks.openProject.mockResolvedValue(undefined)
    mocks.dismiss.mockResolvedValue(undefined)
    mocks.dismissAll.mockResolvedValue(undefined)
    mocks.remove.mockResolvedValue(undefined)
  })

  it('opens after startup for a recoverable exact session and persists dismissal', async () => {
    const saved = record()
    mocks.reconcile.mockResolvedValue([saved])
    mocks.list.mockResolvedValueOnce([])
    const user = userEvent.setup()

    renderCenter()

    expect(await screen.findByRole('dialog', { name: 'Agent Resume Center' })).toBeInTheDocument()
    expect(screen.getByText(`claude.exe --resume ${exactId}`)).toBeInTheDocument()
    expect(screen.queryByText(/--last/)).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(mocks.dismiss).toHaveBeenCalledWith('terminal-1'))
    await waitFor(() => expect(screen.getByText('No agent sessions need recovery.')).toBeInTheDocument())
  })

  it('runs Resume all with bounded concurrency and reports partial failures', async () => {
    const saved = [
      record(),
      record({
        terminalSessionId: 'terminal-2',
        paneId: 'pane-2',
        provider: 'codex',
        sessionTitle: 'Codex · Review',
        commandPreview: `codex.exe resume ${exactId}`,
      }),
      record({ terminalSessionId: 'terminal-3', paneId: 'pane-3', sessionTitle: 'Claude · Tests' }),
    ]
    mocks.reconcile.mockResolvedValue(saved)
    mocks.list.mockResolvedValue(saved)
    let active = 0
    let maximum = 0
    mocks.resume.mockImplementation(async ({ terminalSessionId }: { terminalSessionId: string }) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      if (terminalSessionId === 'terminal-2') throw new Error('Codex authentication is required.')
      const item = saved.find((candidate) => candidate.terminalSessionId === terminalSessionId)!
      return result(item)
    })
    const user = userEvent.setup()

    renderCenter()
    await user.click(await screen.findByRole('button', { name: 'Resume all (3)' }))

    await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Codex authentication is required.'))
    expect(maximum).toBe(2)
    expect(mocks.openProject).toHaveBeenCalledTimes(3)
  })

  it('allows a missing original pane to be recreated in a new terminal', async () => {
    const saved = record({
      recoveryStatus: 'unavailable',
      errorCode: 'pane_missing',
      errorMessage: 'The original terminal pane no longer exists.',
    })
    mocks.reconcile.mockResolvedValue([saved])
    mocks.resume.mockResolvedValue(result(saved))
    const user = userEvent.setup()

    renderCenter()
    await waitFor(() => expect(mocks.reconcile).toHaveBeenCalled())
    window.dispatchEvent(new Event(OPEN_AGENT_RESUME_CENTER))
    const action = await screen.findByRole('button', { name: 'Resume in new terminal' })
    expect(action).toBeEnabled()
    await user.click(action)

    await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith({
      terminalSessionId: 'terminal-1',
      inNewTerminal: true,
      cols: 100,
      rows: 30,
    }))
    expect(mocks.openProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.resume.mock.invocationCallOrder[0],
    )
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Agent Resume Center' })).toBeNull())
  })
})
