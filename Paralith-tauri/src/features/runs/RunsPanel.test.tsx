import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Run, RunDetail, RunInboxSummary, RunQuery } from './runTypes'

const backend = {
  runs: [] as Run[],
  detail: null as RunDetail | null,
  summary: { running: 0, waitingApproval: 0, reviewReady: 0, failed: 0, interrupted: 0 } as RunInboxSummary,
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    projectId: 'p1',
    workspaceId: null,
    parentRunId: null,
    rootRunId: 'run-1',
    retryOfRunId: null,
    swarmId: null,
    swarmTaskId: null,
    runType: 'agent_task',
    executionStrategy: 'single_agent',
    isolation: 'isolated_worktree',
    objective: 'Fix the detach regression',
    providerId: 'claude',
    modelId: null,
    reasoningEffort: null,
    terminalSessionId: null,
    providerSessionId: null,
    workingDirectory: null,
    worktreePath: null,
    branchName: null,
    contextPackId: null,
    status: 'running',
    statusReason: null,
    triggerSource: 'manual',
    requestedBy: 'user',
    errorCode: null,
    errorMessage: null,
    resultSummary: null,
    createdAt: '2026-08-23T10:00:00Z',
    queuedAt: '2026-08-23T10:00:00Z',
    startedAt: '2026-08-23T10:00:00Z',
    completedAt: null,
    updatedAt: '2026-08-23T10:00:00Z',
    metadata: {},
    ...overrides,
  }
}

const cancel = vi.fn(async (runId: string) => ({ ...backend.runs[0], id: runId, status: 'cancelled' as const }))
const create = vi.fn(async (request: { projectId: string; objective: string; isolation: string }) => {
  const run = makeRun({ id: 'run-new', objective: request.objective, status: 'queued' })
  backend.runs = [run, ...backend.runs]
  return run
})
const resolveApproval = vi.fn(async (_approvalId: string, _approved: boolean, _note?: string) => makeRun({ status: 'running' }))

vi.mock('./runApi', () => ({
  runApi: {
    list: async (query: RunQuery) => backend.runs.filter((run) => run.projectId === query.projectId),
    create: (...args: unknown[]) => create(...(args as [{ projectId: string; objective: string; isolation: string }])),
    cancel: (...args: unknown[]) => cancel(...(args as [string])),
    retry: async () => backend.runs[0],
    detail: async (): Promise<RunDetail> =>
      backend.detail ?? { run: backend.runs[0], events: [], approvals: [], children: [] },
    inboxSummary: async () => backend.summary,
    resolveApproval: (...args: unknown[]) => resolveApproval(...(args as [string, boolean])),
  },
}))

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({
    code: 'unknown_error',
    message: error instanceof Error ? error.message : String(error),
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => undefined),
}))

import { RunsPanel } from './RunsPanel'
import { resetRunStoreVersions, useRunStore } from './runStore'

describe('RunsPanel', () => {
  beforeEach(() => {
    backend.runs = []
    backend.detail = null
    backend.summary = { running: 0, waitingApproval: 0, reviewReady: 0, failed: 0, interrupted: 0 }
    vi.clearAllMocks()
    resetRunStoreVersions()
    useRunStore.setState({
      runsByProject: {},
      detailById: {},
      summaryByProject: {},
      loadingProject: undefined,
      loadingDetailById: {},
      pendingByRun: {},
      error: undefined,
    })
  })

  it('explains the empty state instead of rendering a blank surface', async () => {
    render(<RunsPanel projectId="p1" />)
    expect(
      await screen.findByText('No Runs yet. Start one to give an agent a bounded objective.'),
    ).toBeInTheDocument()
  })

  it('renders a Run with its real persisted status, agent and isolation', async () => {
    backend.runs = [makeRun({ branchName: 'paralith/run-abc' })]
    render(<RunsPanel projectId="p1" />)

    const row = (await screen.findByText('Fix the detach regression')).closest('li')!
    // Scoped to the row: "Running" is also the inbox filter's label, and a status must be read
    // from the Run itself, never from a chip that happens to share the word.
    expect(row).toHaveTextContent('Running')
    expect(screen.getByText('claude')).toBeInTheDocument()
    expect(screen.getByText('Isolated worktree')).toBeInTheDocument()
    expect(screen.getByText('paralith/run-abc')).toBeInTheDocument()
  })

  it('offers Stop on an executing Run and asks the backend to cancel it', async () => {
    backend.runs = [makeRun()]
    render(<RunsPanel projectId="p1" />)

    const stop = await screen.findByRole('button', { name: 'Stop Fix the detach regression' })
    await userEvent.click(stop)
    expect(cancel).toHaveBeenCalledWith('run-1', false)
  })

  it('offers Retry, not Stop, on a finished Run', async () => {
    backend.runs = [makeRun({ status: 'failed', completedAt: '2026-08-23T10:01:00Z' })]
    render(<RunsPanel projectId="p1" />)

    expect(await screen.findByRole('button', { name: 'Retry Fix the detach regression' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop Fix the detach regression' })).not.toBeInTheDocument()
  })

  it('shows an open approval as a blocking decision and records the answer', async () => {
    backend.runs = [makeRun({ status: 'waiting_approval' })]
    backend.detail = {
      run: backend.runs[0],
      events: [],
      approvals: [
        {
          id: 'approval-1',
          runId: 'run-1',
          projectId: 'p1',
          kind: 'permission',
          summary: 'Allow writing to package.json?',
          payload: {},
          status: 'open',
          decidedBy: null,
          decisionNote: null,
          createdAt: '2026-08-23T10:00:30Z',
          decidedAt: null,
        },
      ],
      children: [],
    }
    render(<RunsPanel projectId="p1" />)

    await userEvent.click(await screen.findByText('Fix the detach regression'))
    expect(await screen.findByText('Allow writing to package.json?')).toBeInTheDocument()
    // The user must be told the request is durable, because that is the actual behavior.
    expect(
      screen.getByText('This Run is paused until you decide. The request survives closing this panel.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(resolveApproval).toHaveBeenCalledWith('approval-1', true, undefined)
  })

  it('surfaces a failure cause rather than a generic message', async () => {
    backend.runs = [makeRun({ status: 'failed', errorCode: 'provider_exit', errorMessage: 'exit code 1' })]
    backend.detail = { run: backend.runs[0], events: [], approvals: [], children: [] }
    render(<RunsPanel projectId="p1" />)

    await userEvent.click(await screen.findByText('Fix the detach regression'))
    expect(await screen.findByText('provider_exit')).toBeInTheDocument()
    expect(screen.getByText(/exit code 1/)).toBeInTheDocument()
  })

  it('lists child Runs so a Swarm tree is legible from its parent', async () => {
    backend.runs = [makeRun({ runType: 'swarm_coordinator', executionStrategy: 'swarm' })]
    backend.detail = {
      run: backend.runs[0],
      events: [],
      approvals: [],
      children: [makeRun({ id: 'worker-1', objective: 'Implement the fix', runType: 'swarm_worker' })],
    }
    render(<RunsPanel projectId="p1" />)

    await userEvent.click(await screen.findByText('Fix the detach regression'))
    expect(await screen.findByText('Child Runs')).toBeInTheDocument()
    expect(screen.getByText('Implement the fix')).toBeInTheDocument()
  })

  it('starts a write-capable Run in an isolated worktree by default', async () => {
    render(<RunsPanel projectId="p1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'New Run' }))

    await userEvent.type(screen.getByRole('textbox'), 'Repair the updater manifest')
    await userEvent.click(screen.getByRole('button', { name: 'Start Run' }))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({
      projectId: 'p1',
      objective: 'Repair the updater manifest',
      isolation: 'isolated_worktree',
      executionStrategy: 'single_agent',
    })
  })

  it('drops to read-only isolation when the user disallows changes', async () => {
    render(<RunsPanel projectId="p1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'New Run' }))
    await userEvent.type(screen.getByRole('textbox'), 'Audit the auth flow')
    await userEvent.click(screen.getByRole('checkbox', { name: /Allow changes/ }))
    expect(screen.getByText('Read-only. The agent cannot modify any file.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Start Run' }))
    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create.mock.calls[0][0]).toMatchObject({ isolation: 'shared_read_only' })
  })

  it('cannot start a Run with no objective', async () => {
    render(<RunsPanel projectId="p1" />)
    await userEvent.click(await screen.findByRole('button', { name: 'New Run' }))
    expect(screen.getByRole('button', { name: 'Start Run' })).toBeDisabled()
    expect(create).not.toHaveBeenCalled()
  })

  it('filters to the Runs that need a person when the inbox chip is used', async () => {
    backend.runs = [makeRun()]
    backend.summary = { running: 1, waitingApproval: 2, reviewReady: 1, failed: 0, interrupted: 0 }
    render(<RunsPanel projectId="p1" />)

    // The chip shows the real aggregate: waiting_approval + review_ready.
    expect(await screen.findByText('Needs you')).toBeInTheDocument()
    const chip = screen.getByText('Needs you').closest('button')!
    expect(chip).toHaveTextContent('3')

    await userEvent.click(chip)
    await waitFor(() => expect(chip.className).toContain('is-active'))
  })

  it('reports interrupted Runs rather than hiding them', async () => {
    backend.summary = { running: 0, waitingApproval: 0, reviewReady: 0, failed: 0, interrupted: 2 }
    render(<RunsPanel projectId="p1" />)
    expect(await screen.findByText('2 interrupted')).toBeInTheDocument()
  })
})
