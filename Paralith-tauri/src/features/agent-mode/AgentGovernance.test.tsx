import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentApproval, AgentCapability, AgentRoutine, AgentSkill, OrganizationalAgent, Project } from '../../native/types'
import { useAgentModeStore } from './agentModeStore'
import { AgentSettingsPanel, ApprovalCard } from './AgentGovernance'

const commands = vi.hoisted(() => ({
  listAgentCapabilities: vi.fn(),
  setAgentCapability: vi.fn(),
  listAgentApprovals: vi.fn().mockResolvedValue([]),
  decideAgentApproval: vi.fn().mockResolvedValue(undefined),
  listAgentSkills: vi.fn().mockResolvedValue([]),
  listAgentSkillAssignments: vi.fn().mockResolvedValue([]),
  saveAgentSkill: vi.fn().mockResolvedValue(undefined),
  deleteAgentSkill: vi.fn().mockResolvedValue(undefined),
  setAgentSkillAssigned: vi.fn().mockResolvedValue(undefined),
  listAgentRoutines: vi.fn().mockResolvedValue([]),
  saveAgentRoutine: vi.fn().mockResolvedValue(undefined),
  deleteAgentRoutine: vi.fn().mockResolvedValue(undefined),
  runAgentRoutineNow: vi.fn().mockResolvedValue(undefined),
  getAgentOrganization: vi.fn(),
}))
vi.mock('../../native/commands', () => ({
  native: commands,
  asNativeError: (error: unknown) => ({ message: String(error) }),
}))

const project = { id: 'project', name: 'Paralith', rootPath: 'C:/Paralith' } as Project
const forge = {
  id: 'forge', name: 'Forge', role: 'Engineering Lead', brief: 'Own implementation quality.',
  responsibilities: [], avatarSeed: 'forge', intelligencePreference: 'automatic', workState: 'idle',
  pinned: false, position: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
} satisfies OrganizationalAgent

const capabilities: AgentCapability[] = [
  { agentId: 'forge', capability: 'delegate_work', decision: 'allow' },
  { agentId: 'forge', capability: 'workspace_read', decision: 'allow' },
  { agentId: 'forge', capability: 'workspace_write', decision: 'allow' },
  { agentId: 'forge', capability: 'run_commands', decision: 'allow' },
  { agentId: 'forge', capability: 'commit', decision: 'ask' },
  { agentId: 'forge', capability: 'push', decision: 'deny' },
]

const approval = (over: Partial<AgentApproval> = {}): AgentApproval => ({
  id: 'approval-1', workId: 'work-1', agentId: 'forge', agentName: 'Forge', projectId: 'project',
  kind: 'push', summary: 'Forge wants to push · Repair the composer', status: 'open',
  detail: {
    branch: 'feat/agent-mode',
    changedFiles: ['src/features/agent-mode/AgentModeSurface.tsx', 'src/index.css'],
    reportedValidation: '887 frontend tests passed',
    reportedUnresolved: 'none',
    runtime: 'codex',
  },
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
})

function resetStore() {
  useAgentModeStore.setState({
    mode: 'agent', hydrated: true, busy: false, error: undefined,
    approvals: [], capabilities: {}, skills: [], skillAssignments: {}, routines: [], organizationLoaded: false,
    snapshot: {
      agents: [forge], conversations: [], entries: [], delegations: [], work: [],
      authorities: [{ agentId: 'forge', projectId: 'project', access: 'read_write', grantedAt: '2026-01-01T00:00:00Z' }],
      productState: { selectedMode: 'agent', selectedAgentId: 'forge' },
    },
  })
}

describe('ApprovalCard', () => {
  beforeEach(() => {
    resetStore()
    for (const command of Object.values(commands)) command.mockClear()
    commands.getAgentOrganization.mockImplementation(async () => useAgentModeStore.getState().snapshot)
    commands.listAgentApprovals.mockResolvedValue([])
    commands.decideAgentApproval.mockResolvedValue(approval({ status: 'executed' }))
  })

  it('separates what Paralith observed from what the runtime merely reported', () => {
    render(<ApprovalCard approval={approval()} />)
    expect(screen.getByText('Forge wants to push')).toBeInTheDocument()
    expect(screen.getByText('feat/agent-mode')).toBeInTheDocument()
    expect(screen.getByText('2 files')).toBeInTheDocument()
    // The validation is the runtime's claim, and the card must say so rather than presenting it
    // as a fact Paralith checked.
    expect(screen.getByText('Reported validation')).toBeInTheDocument()
    expect(screen.getByText('887 frontend tests passed')).toBeInTheDocument()
  })

  it('offers exactly two answers and sends the one that was chosen', async () => {
    render(<ApprovalCard approval={approval()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve once' }))
    await waitFor(() => expect(commands.decideAgentApproval).toHaveBeenCalledWith('approval-1', true, undefined))
  })

  it('records a denial rather than silently dismissing the request', async () => {
    render(<ApprovalCard approval={approval()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(commands.decideAgentApproval).toHaveBeenCalledWith('approval-1', false, undefined))
  })

  it('does not claim changed files when Paralith observed none', () => {
    render(<ApprovalCard approval={approval({ detail: { branch: 'main', changedFiles: [] } })} />)
    expect(screen.getByText('None observed')).toBeInTheDocument()
    expect(screen.queryByText('Reported validation')).not.toBeInTheDocument()
  })

  it('does not present an unresolved value of "none" as an outstanding problem', () => {
    render(<ApprovalCard approval={approval()} />)
    expect(screen.queryByText('Reported unresolved')).not.toBeInTheDocument()
  })
})

describe('AgentSettingsPanel', () => {
  beforeEach(() => {
    resetStore()
    for (const command of Object.values(commands)) command.mockClear()
    commands.getAgentOrganization.mockImplementation(async () => useAgentModeStore.getState().snapshot)
    commands.listAgentCapabilities.mockResolvedValue(capabilities)
    commands.setAgentCapability.mockResolvedValue(capabilities)
    commands.listAgentSkills.mockResolvedValue([])
    commands.listAgentSkillAssignments.mockResolvedValue([])
    commands.listAgentRoutines.mockResolvedValue([])
  })

  it('shows the real capability posture, with publishing marked out from editing', async () => {
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    expect(await screen.findByText('Commit')).toBeInTheDocument()
    // A decision group is a three-way control, and the stored decision is the pressed one.
    const commitRow = screen.getByText('Commit').closest('li') as HTMLElement
    expect(commitRow.querySelector('[aria-pressed="true"]')?.textContent).toBe('Ask')
    const pushRow = screen.getByText('Push').closest('li') as HTMLElement
    expect(pushRow.querySelector('[aria-pressed="true"]')?.textContent).toBe('Deny')
    expect(pushRow.className).toContain('is-consequential')
  })

  it('states the Project grant it is operating inside rather than implying global access', async () => {
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    expect(await screen.findByText('Paralith')).toBeInTheDocument()
    expect(screen.getByText('Read and write')).toBeInTheDocument()
  })

  it('sends a capability change through the backend, never only to local state', async () => {
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    await screen.findByText('Push')
    const pushRow = screen.getByText('Push').closest('li') as HTMLElement
    const allow = Array.from(pushRow.querySelectorAll('button')).find((button) => button.textContent === 'Allow')!
    fireEvent.click(allow)
    await waitFor(() => expect(commands.setAgentCapability).toHaveBeenCalledWith('forge', 'push', 'allow'))
  })

  it('creates a Skill through the backend and refuses to save one without a procedure', async () => {
    const skill: AgentSkill = {
      id: 'skill-1', name: 'Release checklist', summary: 'How we ship', appliesWhen: 'Preparing a release',
      procedure: 'Run the suite, review the diff, tag.', validation: 'npm test', expectedResult: 'A reviewed tag',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }
    commands.saveAgentSkill.mockResolvedValue(skill)
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Skills' }))
    fireEvent.click(screen.getByRole('button', { name: /New Skill/ }))
    const save = screen.getByRole('button', { name: 'Save Skill' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Release checklist' } })
    // A name alone is not a procedure, and the control says so before the backend has to.
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Procedure'), { target: { value: 'Run the suite, review the diff, tag.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save Skill' }))
    await waitFor(() => expect(commands.saveAgentSkill).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Release checklist', procedure: 'Run the suite, review the diff, tag.', id: undefined,
    })))
  })

  it('reports a Routine schedule from stored state and runs one on demand', async () => {
    const routine: AgentRoutine = {
      id: 'routine-1', agentId: 'forge', name: 'Competitor review', objective: 'Summarise what changed.',
      constraints: 'Read only.', projectId: 'project', cadence: 'daily', enabled: true,
      nextRunAt: '2026-01-02T09:00:00Z', lastRunAt: '2026-01-01T09:00:00Z', lastStatus: 'started',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    }
    commands.listAgentRoutines.mockResolvedValue([routine])
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Routines' }))
    expect(await screen.findByText('Competitor review')).toBeInTheDocument()
    expect(screen.getByText(/daily · next/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Run now/ }))
    await waitFor(() => expect(commands.runAgentRoutineNow).toHaveBeenCalledWith('routine-1'))
  })

  it('shows a paused Routine as paused rather than as one about to run', async () => {
    commands.listAgentRoutines.mockResolvedValue([{
      id: 'routine-2', agentId: 'forge', name: 'Weekly audit', objective: 'Audit dependencies.',
      constraints: '', projectId: 'project', cadence: 'weekly', enabled: false,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    } satisfies AgentRoutine])
    render(<AgentSettingsPanel agent={forge} project={project} onClose={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Routines' }))
    expect(await screen.findByText('Paused')).toBeInTheDocument()
    expect(screen.queryByText(/next/)).not.toBeInTheDocument()
  })
})
