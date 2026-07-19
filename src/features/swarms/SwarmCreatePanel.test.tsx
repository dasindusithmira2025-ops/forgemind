import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SwarmPreset } from '../../native/types'

const presets: SwarmPreset[] = [
  {
    id: 'auto', name: 'Auto Team', builtin: true, isDefault: true, maxParallel: 6, instructions: '',
    roles: [
      { role: 'coordinator', enabled: true, allocations: [{ id: 'c1', runtime: 'auto', count: 1 }] },
      { role: 'builder', enabled: true, allocations: [{ id: 'b1', runtime: 'auto', count: 2 }] },
    ],
    createdAt: '', updatedAt: '',
  },
  {
    id: 'feature_team', name: 'Feature Team', builtin: true, isDefault: false, maxParallel: 6, instructions: '',
    roles: [
      { role: 'coordinator', enabled: true, allocations: [{ id: 'c2', runtime: 'auto', count: 1 }] },
      {
        role: 'builder', enabled: true,
        allocations: [
          { id: 'bc', runtime: 'claude', count: 2 },
          { id: 'bx', runtime: 'codex', count: 1 },
        ],
      },
      { role: 'reviewer', enabled: true, allocations: [{ id: 'r2', runtime: 'auto', count: 1 }] },
    ],
    createdAt: '', updatedAt: '',
  },
]

type CreateRequest = { projectId: string; mission: string; presetId: string; roles?: unknown }
let createdSwarm: { id: string; projectId: string; name: string; lifecycle: string; progress: number } | undefined
let lastCreateRequest: CreateRequest | undefined
const createSwarm = vi.fn(async (request: CreateRequest) => {
  lastCreateRequest = request
  createdSwarm = { id: 'new-swarm', projectId: request.projectId, name: request.mission, lifecycle: 'draft', progress: 0 }
  return createdSwarm
})
const startSwarm = vi.fn(async (_projectId: string, _swarmId: string) => undefined)

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    listSwarmPresets: vi.fn(async () => presets),
    listSwarms: vi.fn(async () => (createdSwarm ? [{ swarm: createdSwarm, activity: {} }] : [])),
    createSwarm: (...args: unknown[]) => createSwarm(...(args as [CreateRequest])),
    startSwarm: (...args: unknown[]) => startSwarm(...(args as [string, string])),
  },
}))

import { SwarmCreatePanel } from './SwarmCreatePanel'
import { useSwarmStore } from './swarmStore'

describe('SwarmCreatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdSwarm = undefined
    lastCreateRequest = undefined
    useSwarmStore.setState({ presets: [], itemsByProject: {}, detailById: {}, error: undefined })
  })

  it('loads presets and requires a mission before starting', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Auto Team')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Start Swarm/i }))
    expect(await screen.findByText(/Describe what you want/i)).toBeInTheDocument()
    expect(createSwarm).not.toHaveBeenCalled()
  })

  it('creates and starts a real swarm with the chosen preset', async () => {
    const onCreated = vi.fn()
    render(<SwarmCreatePanel projectId="p1" onCreated={onCreated} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Feature Team')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/Fix multi-window/i), 'Repair the notification system')
    await userEvent.click(screen.getByText('Feature Team'))
    await userEvent.click(screen.getByRole('button', { name: /Start Swarm/i }))

    await waitFor(() => expect(createSwarm).toHaveBeenCalledOnce())
    expect(createSwarm).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', mission: 'Repair the notification system', presetId: 'feature_team' }),
    )
    expect(startSwarm).toHaveBeenCalledWith('p1', 'new-swarm')
    expect(onCreated).toHaveBeenCalledWith('new-swarm')
  })

  it("shows a preset's mixed-agent summary", async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Feature Team')).toBeInTheDocument())
    // Feature Team card summarises its team; Builders total 3 across Claude + Codex.
    expect(screen.getByText(/Builders ×3/)).toBeInTheDocument()
  })

  it('edits Builder allocations: add a runtime, prevent duplicates, change count, and total updates', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Custom Team')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Custom Team'))

    // The default Builders pool is Auto ×2 → total 2.
    expect(screen.getByLabelText('Builders total agents')).toHaveTextContent('2 agents')

    // Add a Claude allocation to Builders.
    const addBuilders = screen.getByLabelText('Add agent type to Builders')
    await userEvent.selectOptions(addBuilders, 'claude')
    expect(screen.getByLabelText('Claude count in Builders')).toBeInTheDocument()
    expect(screen.getByLabelText('Builders total agents')).toHaveTextContent('3 agents')

    // Duplicate prevention: Claude is no longer offered as an addable agent type.
    expect(within(addBuilders as HTMLSelectElement).queryByRole('option', { name: 'Claude' })).toBeNull()

    // Increase Claude count → total rises; collapsed summary reflects the mix.
    await userEvent.click(screen.getByLabelText('Increase Claude in Builders'))
    expect(screen.getByLabelText('Claude count in Builders')).toHaveValue(2)
    expect(screen.getByLabelText('Builders summary')).toHaveTextContent('Auto ×2 + Claude ×2')
    // Whole team: coordinator 1 + scout 1 + builders 4 + reviewer 1 = 7.
    expect(screen.getByText('Team capacity').closest('.swarm-team-total')).toHaveTextContent('7 agents')

    // Remove the Claude allocation.
    await userEvent.click(screen.getByLabelText('Remove Claude from Builders'))
    expect(screen.queryByLabelText('Claude count in Builders')).toBeNull()
    expect(screen.getByLabelText('Builders total agents')).toHaveTextContent('2 agents')
  })

  it('persists mixed Builder allocations through the create request', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Custom Team')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Custom Team'))
    await userEvent.type(screen.getByPlaceholderText(/Fix multi-window/i), 'Build the mixed feature')
    await userEvent.selectOptions(screen.getByLabelText('Add agent type to Builders'), 'codex')
    await userEvent.click(screen.getByRole('button', { name: /Start Swarm/i }))

    await waitFor(() => expect(createSwarm).toHaveBeenCalledOnce())
    const roles = (lastCreateRequest?.roles ?? []) as { role: string; allocations: { runtime: string; count: number }[] }[]
    const builders = roles.find((role) => role.role === 'builder')
    expect(builders?.allocations.map((a) => a.runtime)).toEqual(['auto', 'codex'])
  })

  it('lets a preset be duplicated into the editor, preserving mixed allocations', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Feature Team')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Feature Team'))
    await userEvent.click(screen.getByRole('button', { name: /Customize/i }))

    // The Builders pool arrives with both Claude ×2 and Codex ×1 preserved.
    expect(screen.getByLabelText('Claude count in Builders')).toHaveValue(2)
    expect(screen.getByLabelText('Codex count in Builders')).toHaveValue(1)
    expect(screen.getByLabelText('Builders total agents')).toHaveTextContent('3 agents')
  })
})
