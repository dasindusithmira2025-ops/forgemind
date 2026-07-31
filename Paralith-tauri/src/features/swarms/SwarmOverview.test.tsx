import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import type { SwarmDetail } from '../../native/types'

const sendSwarmMessage = vi.fn(async (..._args: unknown[]) => undefined)
const saveSwarmCommandDraft = vi.fn(async (..._args: unknown[]) => undefined)
const focusSwarmAgentTerminal = vi.fn(async (..._args: unknown[]) => 'swarm-runtime-s1')
const retrySwarmTest = vi.fn(async (..._args: unknown[]) => undefined)
const generateSwarmFixTask = vi.fn(async (..._args: unknown[]) => undefined)

vi.mock('@tauri-apps/plugin-dialog', () => ({ confirm: vi.fn(async () => true), save: vi.fn(async () => null) }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: vi.fn(async () => undefined) }))
vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    getSwarmCommandDraft: vi.fn(async () => ({ swarmId: 's1', target: '@builders', body: 'Preserve the API', updatedAt: '' })),
    saveSwarmCommandDraft: (...args: unknown[]) => saveSwarmCommandDraft(...(args as [string, string, string, string])),
    sendSwarmMessage: (...args: unknown[]) => sendSwarmMessage(...(args as [string, string, string, string])),
    focusSwarmAgentTerminal: (...args: unknown[]) => focusSwarmAgentTerminal(...(args as [string, string, string])),
    retrySwarmTest: (...args: unknown[]) => retrySwarmTest(...(args as [string, string, string])),
    generateSwarmFixTask: (...args: unknown[]) => generateSwarmFixTask(...(args as [string, string, string])),
  },
}))

import { SwarmOverview } from './SwarmOverview'
import { useSwarmStore } from './swarmStore'

const now = new Date().toISOString()
const longMission = 'Repair the backend-owned notification pipeline while preserving the public API and proving recovery across restart without replacing any project-owned state.'
const detail = {
  swarm: {
    id: 's1', projectId: 'p1', projectRoot: 'C:/project', name: 'Repair notifications', mission: longMission,
    lifecycle: 'building', phase: 'building', teamPreset: 'feature_team', maxParallel: 2, instructions: '', progress: 0,
    priority: 0, archived: false, decision: null, summary: null, reviewVerdict: null, repositoryIdentity: 'repo', gitState: {},
    safeguards: [{ code: 'api', label: 'Preserve APIs', reason: 'The mission names a public contract.' }], attachments: [], currentMilestone: 'Capture pipeline', roles: [],
    createdAt: now, updatedAt: now, startedAt: now, completedAt: null,
  },
  activity: { activeAgents: 2, totalAgents: 2, tasksTotal: 1, tasksDone: 0, tasksRunning: 1 },
  agents: [
    { id: 'coord', swarmId: 's1', allocationId: 'ac', displayName: 'Coordinator 1', role: 'coordinator', runtime: 'claude', status: 'active', currentTaskId: null, terminalSessionId: null, lastResult: null, runtimeSessionState: 'running', workingDirectory: 'C:/project', worktree: null, permissions: ['plan'], changedFiles: [], testProgress: { running: 0, passed: 0, failed: 0, skipped: 0, pending: 0 }, lastMessage: null, currentBlocker: null, recoveryState: 'none', createdAt: now, updatedAt: now },
    { id: 'builder', swarmId: 's1', allocationId: 'ab', displayName: 'Builder 1', role: 'builder', runtime: 'codex', status: 'active', currentTaskId: 'task', terminalSessionId: 'terminal', lastResult: null, runtimeSessionState: 'running', workingDirectory: 'C:/project/.worktrees/builder', worktree: 'C:/project/.worktrees/builder', permissions: ['project_write'], changedFiles: ['src/notify.rs'], testProgress: { running: 1, passed: 2, failed: 0, skipped: 0, pending: 0 }, lastMessage: 'Implementing capture', currentBlocker: null, recoveryState: 'none', createdAt: now, updatedAt: now },
  ],
  tasks: [{ id: 'task', swarmId: 's1', title: 'Implement capture pipeline', role: 'builder', status: 'running', assignedAgentId: 'builder', progress: 0, progressDeterminate: false, files: ['src/notify.rs'], dependsOn: [], attempts: 1, result: null, requiredRuntime: 'codex', blocker: null, evidenceIds: [], testIds: [], leaseUntil: null, verificationRequired: true, position: 0, createdAt: now, updatedAt: now }],
  events: [{ id: 'event', swarmId: 's1', kind: 'task_claimed', role: 'builder', agentId: 'builder', taskId: 'task', destinationAgentId: null, destinationRole: null, evidenceId: null, summary: 'Builder 1 claimed capture pipeline', level: 'info', metadata: {}, createdAt: now }],
  messages: [{ id: 'message', swarmId: 's1', category: 'assignment', senderKind: 'agent', sourceAgentId: 'coord', target: 'builder', body: 'Implement the capture pipeline', taskId: 'task', links: [], deliveryState: 'delivered', createdAt: now }],
  connections: [{ id: 'edge', swarmId: 's1', sourceAgentId: 'coord', destinationAgentId: 'builder', destinationRole: 'builder', eventType: 'assignment', taskId: 'task', summary: 'Assigned capture', evidenceId: null, createdAt: now }],
  lifecycleHistory: [],
  runtimeSessions: [{ id: 'run', swarmId: 's1', projectId: 'p1', agentId: 'builder', taskId: 'task', runtime: 'codex', providerSessionId: 'thread', terminalSessionId: 'terminal', state: 'running', resumable: true, workingDirectory: 'C:/project/.worktrees/builder', usage: {}, failureClass: null, startedAt: now, updatedAt: now, endedAt: null }],
  evidence: [], tests: [], reviews: [],
  memories: [{ id: 'context', swarmId: 's1', taskId: 'task', agentId: 'builder', memoryItemId: 'memory', revisionId: 'revision-123456789', title: 'Notification recovery procedure', memoryType: 'procedure', state: 'verified', summary: 'Reattach before replay.', context: 'Reattach before replay.', confidence: .9, sourceUris: ['file:///docs/recovery.md'], loadedAt: now }],
} as unknown as SwarmDetail

describe('SwarmOverview live backend projection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSwarmStore.setState({ itemsByProject: { p1: [{ swarm: detail.swarm, activity: detail.activity }] }, detailById: { s1: detail }, error: undefined })
  })

  it('renders backend agents and persisted collaboration without exposing the full mission', () => {
    const { container } = render(<MemoryRouter><SwarmOverview detail={detail} /></MemoryRouter>)
    expect(screen.getAllByText('Coordinator 1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Builder 1').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.swarm-connections line')).toHaveLength(1)
    expect(screen.queryByText(longMission)).not.toBeInTheDocument()
    expect(screen.getByText('progress indeterminate')).toBeInTheDocument()
    expect(screen.queryByText('42%')).not.toBeInTheDocument()
  })

  it('supports Chat, Activity, Work Memory, targeted drafts, and the real terminal action', async () => {
    const { container } = render(<MemoryRouter><SwarmOverview detail={detail} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Chat' }))
    expect(screen.getByText('Implement the capture pipeline')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByText('Builder 1 claimed capture pipeline')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    await userEvent.click(screen.getByRole('button', { name: 'Terminals' }))
    expect(screen.getByText('Codex · running')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open full terminal' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Memory' }))
    expect(screen.getByText('Notification recovery procedure')).toBeInTheDocument()
    expect(screen.getByText(/revision-123/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Canvas' }))
    await userEvent.click(container.querySelector('.swarm-agent-node.role-builder') as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Open terminal/i }))
    await waitFor(() => expect(focusSwarmAgentTerminal).toHaveBeenCalledWith('p1', 's1', 'builder'))

    const input = screen.getByPlaceholderText(/Give the team/i)
    await waitFor(() => expect(input).toHaveValue('Preserve the API'))
    await userEvent.clear(input)
    await userEvent.type(input, 'Keep migrations reversible')
    await userEvent.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(sendSwarmMessage).toHaveBeenCalledWith('p1', 's1', '@builders', 'Keep migrations reversible')
  }, 15_000)

  it('keeps routine file reads out of the meaningful activity stream', async () => {
    const withRoutineRead = {
      ...detail,
      events: [
        ...detail.events,
        { ...detail.events[0], id: 'read', kind: 'file_read', summary: 'Read C:/project/src/notify.rs' },
      ],
    } as SwarmDetail
    render(<MemoryRouter><SwarmOverview detail={withRoutineRead} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByText('Builder 1 claimed capture pipeline')).toBeInTheDocument()
    expect(screen.queryByText('Read C:/project/src/notify.rs')).not.toBeInTheDocument()
  })

  it('routes failed-test retry and repair actions to backend task creation', async () => {
    const failed = {
      ...detail,
      tests: [{ id: 'test-failed', swarmId: 's1', taskId: 'task', agentId: 'builder', name: 'cargo test --workspace', command: 'cargo test --workspace', status: 'failed', summary: 'exit code 101', logUri: null, startedAt: now, completedAt: now }],
    } as SwarmDetail
    render(<MemoryRouter><SwarmOverview detail={failed} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Work' }))
    await userEvent.click(screen.getByRole('button', { name: 'Tests' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(retrySwarmTest).toHaveBeenCalledWith('p1', 's1', 'test-failed')
    await userEvent.click(screen.getByRole('button', { name: 'Generate fix task' }))
    expect(generateSwarmFixTask).toHaveBeenCalledWith('p1', 's1', 'test-failed')
  })

  it('can launch a duplicated draft from its backend-backed overview', async () => {
    const start = vi.fn(async () => undefined)
    const draft = {
      ...detail,
      swarm: { ...detail.swarm, lifecycle: 'draft', phase: 'understanding', startedAt: null },
      agents: [],
      tasks: [],
    } as SwarmDetail
    useSwarmStore.setState({ start })
    render(<MemoryRouter><SwarmOverview detail={draft} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Validate & launch' }))
    expect(start).toHaveBeenCalledWith('s1')
  })

  it('shows messages addressed to the selected agent, not just ones it sent', async () => {
    // The backend addresses an individual agent by its raw id (`record_swarm_agent_message`
    // targets `destination.id`), so filtering by agent must match the target as well as the
    // sender. Matching only `@${agentId}` hid every inbound handoff and review request.
    render(<MemoryRouter><SwarmOverview detail={detail} /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Chat' }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '' }), 'builder')
    expect(screen.getByText('Implement the capture pipeline')).toBeInTheDocument()
  })

  it('holds Accept while another lifecycle operation is still in flight', async () => {
    // Accept is a lifecycle transition like Pause/Stop and must respect the same in-flight guard,
    // otherwise it can race a Stop or Retry the user already issued.
    const accept = vi.fn(async () => undefined)
    const ready = { ...detail, swarm: { ...detail.swarm, lifecycle: 'ready_for_review' } } as SwarmDetail
    useSwarmStore.setState({ accept, pendingBySwarm: { s1: 'stop' } })
    render(<MemoryRouter><SwarmOverview detail={ready} /></MemoryRouter>)

    expect(screen.getByRole('button', { name: 'Accept result' })).toBeDisabled()
    useSwarmStore.setState({ pendingBySwarm: {} })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept result' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Accept result' }))
    expect(accept).toHaveBeenCalledWith('s1')
  })

  it('binds an attention decision to the persisted request id', async () => {
    const resolveAttention = vi.fn(async () => undefined)
    const waiting = {
      ...detail,
      swarm: { ...detail.swarm, lifecycle: 'decision_required' },
      attentionRequests: [{ id: 'permission-1', swarmId: 's1', swarmRunId: 'run-1', agentRunId: 'attempt-1', memberId: 'builder', taskId: 'task', requestKind: 'permission', summary: 'Builder 1 requests PowerShell', safePayload: { command: 'npm test' }, status: 'open', response: null, createdAt: now, expiresAt: now, resolvedAt: null }],
    } as SwarmDetail
    useSwarmStore.setState({ resolveAttention })
    render(<MemoryRouter><SwarmOverview detail={waiting} /></MemoryRouter>)

    expect(screen.getByText('command: npm test')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Response for agent'), 'Run the scoped test only')
    await userEvent.click(screen.getByRole('button', { name: 'Approve and continue' }))
    expect(resolveAttention).toHaveBeenCalledWith('s1', 'permission-1', 'Run the scoped test only', true)
  })
})
