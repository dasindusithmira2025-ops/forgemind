import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SwarmPreset } from '../../native/types'

const presets: SwarmPreset[] = [
  { id: 'auto', name: 'Auto Team', builtin: true, isDefault: true, maxParallel: 6, instructions: '', roles: [
    { role: 'coordinator', runtime: 'auto', desiredCount: 1, enabled: true },
    { role: 'builder', runtime: 'auto', desiredCount: 2, enabled: true },
  ], createdAt: '', updatedAt: '' },
  { id: 'quick_fix', name: 'Quick Fix', builtin: true, isDefault: false, maxParallel: 3, instructions: '', roles: [
    { role: 'builder', runtime: 'auto', desiredCount: 1, enabled: true },
  ], createdAt: '', updatedAt: '' },
]

let createdSwarm: { id: string; projectId: string; name: string; lifecycle: string; progress: number } | undefined
const createSwarm = vi.fn(async (request: { projectId: string; mission: string; presetId: string }) => {
  createdSwarm = { id: 'new-swarm', projectId: request.projectId, name: request.mission, lifecycle: 'draft', progress: 0 }
  return createdSwarm
})
const startSwarm = vi.fn(async (_projectId: string, _swarmId: string) => undefined)

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: String(error) }),
  native: {
    listSwarmPresets: vi.fn(async () => presets),
    listSwarms: vi.fn(async () => createdSwarm ? [{ swarm: createdSwarm, activity: {} }] : []),
    createSwarm: (...args: unknown[]) => createSwarm(...(args as [{ projectId: string; mission: string; presetId: string }])),
    startSwarm: (...args: unknown[]) => startSwarm(...(args as [string, string])),
  },
}))

import { SwarmCreatePanel } from './SwarmCreatePanel'
import { useSwarmStore } from './swarmStore'

describe('SwarmCreatePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createdSwarm = undefined
    useSwarmStore.setState({ presets: [], itemsByProject: {}, detailById: {}, error: undefined })
  })

  it('loads presets and requires a mission before starting', async () => {
    const onCreated = vi.fn()
    render(<SwarmCreatePanel projectId="p1" onCreated={onCreated} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Auto Team')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Start Swarm/i }))
    expect(await screen.findByText(/Describe what you want/i)).toBeInTheDocument()
    expect(createSwarm).not.toHaveBeenCalled()
  })

  it('creates and starts a real swarm with the chosen preset', async () => {
    const onCreated = vi.fn()
    render(<SwarmCreatePanel projectId="p1" onCreated={onCreated} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Quick Fix')).toBeInTheDocument())

    await userEvent.type(screen.getByPlaceholderText(/Fix multi-window/i), 'Repair the notification system')
    await userEvent.click(screen.getByText('Quick Fix'))
    await userEvent.click(screen.getByRole('button', { name: /Start Swarm/i }))

    await waitFor(() => expect(createSwarm).toHaveBeenCalledOnce())
    expect(createSwarm).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', mission: 'Repair the notification system', presetId: 'quick_fix' }),
    )
    expect(startSwarm).toHaveBeenCalledWith('p1', 'new-swarm')
    expect(onCreated).toHaveBeenCalledWith('new-swarm')
  })

  it('reveals per-role runtime assignment for a Custom Team', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={() => {}} onCancel={() => {}} />)
    await waitFor(() => expect(screen.getByText('Custom Team')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Custom Team'))
    expect(screen.getByLabelText('Builders runtime')).toBeInTheDocument()
    expect(screen.getByLabelText('Reviewer runtime')).toBeInTheDocument()
  })
})
