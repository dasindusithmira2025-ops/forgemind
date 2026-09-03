import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversationEntry, AgentRuntimeOption, AgentWork, AgentWorkStatus, OrganizationalAgent, Project, Workspace } from '../../native/types'
import { useAgentModeStore } from './agentModeStore'
import { AgentModeSurface } from './AgentModeSurface'

const { sendAgentMessage, listAgentRuntimes, getAgentOrganization, cancelAgentWork, continueAgentWork, listAgentWorkEvents, listAgentApprovals, decideAgentApproval, listAgentCapabilities, listAgentSkills, listAgentSkillAssignments, listAgentRoutines } = vi.hoisted(() => ({
  sendAgentMessage: vi.fn().mockResolvedValue(undefined),
  listAgentRuntimes: vi.fn().mockResolvedValue([]),
  getAgentOrganization: vi.fn(),
  cancelAgentWork: vi.fn().mockResolvedValue(undefined),
  continueAgentWork: vi.fn().mockResolvedValue(undefined),
  listAgentWorkEvents: vi.fn().mockResolvedValue([]),
  listAgentApprovals: vi.fn().mockResolvedValue([]),
  decideAgentApproval: vi.fn().mockResolvedValue(undefined),
  listAgentCapabilities: vi.fn().mockResolvedValue([]),
  listAgentSkills: vi.fn().mockResolvedValue([]),
  listAgentSkillAssignments: vi.fn().mockResolvedValue([]),
  listAgentRoutines: vi.fn().mockResolvedValue([]),
}))
vi.mock('../../native/commands', () => ({
  native: { sendAgentMessage, listAgentRuntimes, getAgentOrganization, cancelAgentWork, continueAgentWork, listAgentWorkEvents, listAgentApprovals, decideAgentApproval, listAgentCapabilities, listAgentSkills, listAgentSkillAssignments, listAgentRoutines },
  asNativeError: (error: unknown) => ({ message: String(error) }),
}))

const project = { id: 'project', name: 'Paralith', rootPath: 'C:/Paralith' } as Project
const workspace = { id: 'workspace', projectId: 'project', name: 'Primary', panes: [] } as unknown as Workspace

const atlas = { id: 'atlas', name: 'Atlas', role: 'Chief of Staff', brief: 'Coordinate work.', responsibilities: [], avatarSeed: 'atlas', intelligencePreference: 'automatic', workState: 'idle', pinned: true, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' } satisfies OrganizationalAgent
const chat = { id: 'chat', agentId: 'atlas', title: 'General', position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }
const entry = (over: Partial<AgentConversationEntry> = {}): AgentConversationEntry => ({
  id: 'entry', conversationId: 'chat', kind: 'user', body: 'Prepare the implementation plan.', metadata: {},
  state: 'complete', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})
const runtimes: AgentRuntimeOption[] = [
  { id: 'claude/sonnet', providerId: 'claude', providerName: 'Claude', modelId: 'sonnet', displayName: 'Sonnet', description: 'Balanced coding and review.', installed: true, authenticated: true, available: true },
  { id: 'codex/gpt-5.5', providerId: 'codex', providerName: 'Codex', modelId: 'gpt-5.5', displayName: 'GPT-5.5', description: 'Strong repository work.', installed: false, authenticated: false, available: false, unavailableReason: 'The executable was not found on PATH.' },
]

const forge = { ...atlas, id: 'forge', name: 'Forge', role: 'Engineering Lead', pinned: false, position: 1 } satisfies OrganizationalAgent
const work = (over: Partial<AgentWork> = {}): AgentWork => ({
  id: 'work-1', agentId: 'forge', delegationId: 'delegation-1',
  objective: 'Repair the Agent composer.', constraints: 'Do not commit or push.', expectedResult: 'Implementation and validation.',
  projectId: 'project', status: 'working' as AgentWorkStatus,
  providerId: 'codex', modelId: 'gpt-5.5', runtimeSource: 'agent',
  terminalSessionId: 'session-1', executionWorkspaceId: 'agent-mode-work-project', executionPaneId: 'agent-work-work-1',
  authority: { read: true, write: true, runCommands: true, commit: false, push: false, commitRequiresApproval: false, pushRequiresApproval: false },
  originConversationId: 'chat',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})
const delegation = { id: 'delegation-1', ownerAgentId: 'atlas', recipientAgentId: 'forge', objective: 'Repair the Agent composer.', relevantContext: '', constraints: 'Do not commit or push.', expectedResult: '', authorityBoundary: '', projectId: 'project', status: 'executing', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' }

function seedWork(status: AgentWorkStatus, over: Partial<AgentWork> = {}) {
  useAgentModeStore.setState((state) => ({
    snapshot: {
      ...state.snapshot,
      agents: [{ ...atlas }, { ...forge }],
      delegations: [delegation],
      work: [work({ status, ...over })],
    },
  }))
}

function seed(entries: AgentConversationEntry[], extra: Partial<Parameters<typeof useAgentModeStore.setState>[0]> = {}) {
  useAgentModeStore.setState({
    snapshot: {
      agents: [{ ...atlas }], conversations: [{ ...chat }], entries,
      delegations: [], work: [], authorities: [], productState: { selectedMode: 'agent', selectedAgentId: 'atlas', selectedConversationId: 'chat' },
    },
    ...extra,
  })
}

describe('AgentModeSurface', () => {
  beforeEach(() => {
    sendAgentMessage.mockClear()
    listAgentRuntimes.mockClear()
    // A send is followed by a snapshot refresh; return the seeded snapshot so the reload does
    // not blank the surface inside the test.
    getAgentOrganization.mockImplementation(async () => useAgentModeStore.getState().snapshot)
    useAgentModeStore.setState({ mode: 'agent', hydrated: true, busy: false, error: undefined, runtimes: [], runtimesLoaded: true, messageRuntime: {}, approvals: [], capabilities: {}, skills: [], skillAssignments: {}, routines: [], organizationLoaded: false })
  })

  it('surfaces a pending approval in the thread beside the work that raised it', () => {
    seedWork('needs_approval')
    useAgentModeStore.setState({
      snapshot: { ...useAgentModeStore.getState().snapshot, productState: { selectedMode: 'agent', selectedAgentId: 'forge', selectedConversationId: 'chat' } },
      approvals: [{
        id: 'approval-1', workId: 'work-1', agentId: 'forge', agentName: 'Forge', projectId: 'project',
        kind: 'push', summary: 'Forge wants to push', status: 'open',
        detail: { branch: 'feat/agent-mode', changedFiles: ['src/index.css'] },
        createdAt: '2026-01-01T00:00:00Z',
      }],
    })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('Forge wants to push')).toBeInTheDocument()
    // The work row must not read as finished while a person still has to answer. The label
    // appears on the run and again on the card, which is the point: one state, two places.
    expect(screen.getAllByText('Needs approval').length).toBeGreaterThan(1)
    expect(screen.getByText('Finished and waiting on your decision below.')).toBeInTheDocument()
  })

  it('does not claim nothing was published when publishing is still awaiting approval', () => {
    seedWork('completed', { authority: { read: true, write: true, runCommands: true, commit: false, push: false, commitRequiresApproval: true, pushRequiresApproval: true } })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.queryByText('No commit or push was performed.')).not.toBeInTheDocument()
  })

  it('states plainly that nothing was published when the teammate was refused outright', () => {
    seedWork('completed')
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('No commit or push was performed.')).toBeInTheDocument()
  })

  it('keeps Access, Skills and Routines out of the team rail and behind the teammate header', () => {
    seed([entry()])
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    const rail = screen.getByLabelText('Team roster')
    for (const label of ['Skills', 'Routines', 'Access']) {
      expect(rail.textContent).not.toContain(label)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Atlas settings' }))
    expect(screen.getByRole('button', { name: 'Access' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Routines' })).toBeInTheDocument()
  })

  it('uses team-first onboarding instead of an empty dashboard', () => {
    useAgentModeStore.setState({ snapshot: { agents: [], conversations: [], entries: [], delegations: [], work: [], authorities: [], productState: { selectedMode: 'agent' } } })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Build your team.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Chief of Staff' })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Chief of Staff' }))
    expect(screen.getByRole('heading', { name: 'What should this person own?' })).toBeInTheDocument()
  })

  it('turns a natural-language responsibility into an editable teammate suggestion', () => {
    useAgentModeStore.setState({ snapshot: { agents: [], conversations: [], entries: [], delegations: [], work: [], authorities: [], productState: { selectedMode: 'agent' } } })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create another role' }))
    fireEvent.change(screen.getByPlaceholderText('Manage our products and turn ideas into clear implementation plans.'), { target: { value: 'Implement repository changes and run tests.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review teammate' }))
    expect(screen.getByDisplayValue('Forge')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Engineering Lead')).toBeInTheDocument()
    expect((screen.getByRole('option', { name: 'Read / write' }) as HTMLOptionElement).selected).toBe(true)
  })

  it('keeps identity, chat and workspace-linked delegation in one dense surface', () => {
    seed([entry()])
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('PINNED')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Atlas' })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Atlas conversations' })).toHaveTextContent('General')
    expect(screen.getByText('Prepare the implementation plan.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Automatic/ })).toBeInTheDocument()
  })

  it('sends through the runtime the composer resolved and clears a one-message override', async () => {
    seed([], { runtimes })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /Automatic/ }))
    // Only a connected runtime is selectable; an unavailable one states why instead of hiding.
    expect(screen.getByRole('button', { name: /GPT-5\.5/ })).toBeDisabled()
    expect(screen.getByText('The executable was not found on PATH.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Sonnet/ }))
    expect(screen.getByRole('button', { name: /Claude Sonnet/ })).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Message Atlas'), { target: { value: 'What should we prioritize today?' } })
    fireEvent.submit(screen.getByLabelText('Message Atlas').closest('form')!)
    await vi.waitFor(() => expect(sendAgentMessage).toHaveBeenCalledWith({
      conversationId: 'chat', body: 'What should we prioritize today?', runtimeId: 'claude/sonnet', projectId: 'project',
    }))
    // A message-level choice must not become the standing default.
    expect(useAgentModeStore.getState().messageRuntime).toEqual({})
    expect(useAgentModeStore.getState().snapshot.agents[0].intelligencePreference).toBe('automatic')
  })

  it('shows a live turn as in-flight with a way to stop it, and records what answered', () => {
    seed([
      entry({ id: 'question' }),
      entry({ id: 'answer', kind: 'agent', body: '', state: 'streaming', runtimeProvider: 'claude', runtimeModel: 'sonnet' }),
    ])
    const { rerender } = render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('Responding…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Stop response' })).toBeInTheDocument()

    seed([
      entry({ id: 'question' }),
      entry({ id: 'answer', kind: 'agent', body: 'Ship the notification repair.', state: 'complete', runtimeProvider: 'claude', runtimeModel: 'sonnet' }),
    ])
    rerender(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('Ship the notification repair.')).toBeInTheDocument()
    expect(screen.getByTitle('Answered on claude sonnet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop response' })).not.toBeInTheDocument()
  })

  it('reports a provider limit as a runtime block rather than a lost answer', () => {
    seed([entry({ id: 'answer', kind: 'agent', body: 'Partial work so far.', state: 'blocked', runtimeProvider: 'codex' })])
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByText('Partial work so far.')).toBeInTheDocument()
    expect(screen.getByText(/Runtime limit reached/)).toBeInTheDocument()
  })

  it('does not leave a new teammate staring at an empty canvas', () => {
    seed([])
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Atlas is your chief of staff.' })).toBeInTheDocument()
    expect(screen.getByText('Coordinate work.')).toBeInTheDocument()
    expect(screen.getByText('Paralith')).toBeInTheDocument()
  })

  it('renders delegated work as real execution, not as an organizational record', async () => {
    seed([entry()], { runtimes })
    seedWork('working')
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    // Canonical work state, read from the Run rather than guessed in the UI.
    expect(await screen.findByText('Working')).toBeInTheDocument()
    expect(screen.getByText('Atlas \u2192 Forge')).toBeInTheDocument()
    // Runtime provenance is visible; the teammate is still the teammate.
    expect(screen.getByText('Codex GPT-5.5')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    expect(cancelAgentWork).toHaveBeenCalledWith('work-1')
  })

  it('opens the exact execution in Code, not the project root', async () => {
    const onOpenCode = vi.fn()
    seed([entry()], { runtimes })
    seedWork('working')
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={onOpenCode} />)
    fireEvent.click(await screen.findByRole('button', { name: /Open in Code/ }))
    expect(onOpenCode).toHaveBeenCalledWith(expect.objectContaining({
      id: 'work-1', executionWorkspaceId: 'agent-mode-work-project', executionPaneId: 'agent-work-work-1',
    }))
  })

  it('treats a provider limit as a pause with a connected way forward, never a silent switch', async () => {
    seed([entry()], { runtimes })
    seedWork('provider_limit', { statusReason: 'This runtime reached its usage limit.' })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(await screen.findByText('Paused \u00b7 provider limit')).toBeInTheDocument()
    // Only a genuinely connected alternative may be offered. Codex ran out, and the unavailable
    // entry in `runtimes` must never be proposed as a way to continue.
    fireEvent.click(screen.getByRole('button', { name: 'Continue on Claude' }))
    expect(continueAgentWork).toHaveBeenCalledWith('work-1', 'claude/sonnet')
    expect(screen.queryByRole('button', { name: /Continue on Codex/ })).not.toBeInTheDocument()
  })

  it('keeps evidence one click away instead of in the transcript', async () => {
    listAgentWorkEvents.mockResolvedValueOnce([
      { id: 'e1', workId: 'work-1', sequence: 1, kind: 'started', summary: 'Started engineering work', level: 'info', metadata: {}, createdAt: '2026-01-01T00:01:00Z' },
      { id: 'e2', workId: 'work-1', sequence: 2, kind: 'validation', summary: 'Running validation', level: 'info', metadata: {}, createdAt: '2026-01-01T00:02:00Z' },
    ])
    seed([entry()], { runtimes })
    seedWork('completed', { resultSummary: 'Fixed the runtime override leak.' })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(await screen.findByText('Fixed the runtime override leak.')).toBeInTheDocument()
    // The work ran without commit authority and says so, rather than leaving it implied.
    expect(screen.getByText('No commit or push was performed.')).toBeInTheDocument()
    expect(screen.queryByText('Running validation')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Evidence' }))
    expect(await screen.findByText('Running validation')).toBeInTheDocument()
    expect(listAgentWorkEvents).toHaveBeenCalledWith('work-1')
  })
})
