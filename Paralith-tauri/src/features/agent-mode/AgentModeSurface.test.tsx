import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentConversationEntry, AgentRuntimeOption, OrganizationalAgent, Project, Workspace } from '../../native/types'
import { useAgentModeStore } from './agentModeStore'
import { AgentModeSurface } from './AgentModeSurface'

const { sendAgentMessage, listAgentRuntimes, getAgentOrganization } = vi.hoisted(() => ({
  sendAgentMessage: vi.fn().mockResolvedValue(undefined),
  listAgentRuntimes: vi.fn().mockResolvedValue([]),
  getAgentOrganization: vi.fn(),
}))
vi.mock('../../native/commands', () => ({
  native: { sendAgentMessage, listAgentRuntimes, getAgentOrganization },
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

function seed(entries: AgentConversationEntry[], extra: Partial<Parameters<typeof useAgentModeStore.setState>[0]> = {}) {
  useAgentModeStore.setState({
    snapshot: {
      agents: [{ ...atlas }], conversations: [{ ...chat }], entries,
      delegations: [], authorities: [], productState: { selectedMode: 'agent', selectedAgentId: 'atlas', selectedConversationId: 'chat' },
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
    useAgentModeStore.setState({ mode: 'agent', hydrated: true, busy: false, error: undefined, runtimes: [], runtimesLoaded: true, messageRuntime: {} })
  })

  it('uses team-first onboarding instead of an empty dashboard', () => {
    useAgentModeStore.setState({ snapshot: { agents: [], conversations: [], entries: [], delegations: [], authorities: [], productState: { selectedMode: 'agent' } } })
    render(<AgentModeSurface visible project={project} workspace={workspace} onOpenCode={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Build your team.' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Chief of Staff' })).toBeInTheDocument()
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create Chief of Staff' }))
    expect(screen.getByRole('heading', { name: 'What should this person own?' })).toBeInTheDocument()
  })

  it('turns a natural-language responsibility into an editable teammate suggestion', () => {
    useAgentModeStore.setState({ snapshot: { agents: [], conversations: [], entries: [], delegations: [], authorities: [], productState: { selectedMode: 'agent' } } })
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
})
