import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { CreateSwarmRequest, SwarmLaunchPreview, SwarmModelCapability, SwarmPreset } from '../../native/types'

const models: SwarmModelCapability[] = [{
  providerId: 'claude', providerDisplayName: 'Claude', modelId: 'sonnet', displayName: 'Sonnet',
  description: 'Balanced coding.', available: false, deprecated: false, replacementModelId: null,
  coding: true, planning: true, review: true, toolUse: true, vision: true,
  supportedReasoningEfforts: ['low', 'medium', 'high'], supportedExecutionModes: ['interactive', 'autonomous', 'review'],
  recommendedRoles: ['coordinator', 'builder', 'reviewer'], authenticated: false, runtimeVersion: '2',
}, {
  providerId: 'codex', providerDisplayName: 'Codex', modelId: 'gpt-5.5', displayName: 'GPT-5.5',
  description: 'General coding.', available: true, deprecated: false, replacementModelId: null,
  coding: true, planning: true, review: true, toolUse: true, vision: true,
  supportedReasoningEfforts: ['low', 'medium', 'high'], supportedExecutionModes: ['interactive', 'autonomous', 'review'],
  recommendedRoles: ['coordinator', 'builder', 'reviewer'], authenticated: true, runtimeVersion: '1',
}]

const presets: SwarmPreset[] = [
  {
    id: 'auto', name: 'Auto', builtin: true, isDefault: true, maxParallel: 4, instructions: '',
    roles: [
      { role: 'coordinator', enabled: true, allocations: [{ id: 'c', runtime: 'auto', count: 1 }] },
      { role: 'builder', enabled: true, allocations: [{ id: 'b', runtime: 'auto', count: 2 }] },
    ], createdAt: '', updatedAt: '',
  },
  {
    id: 'feature_team', name: 'Standard', builtin: true, isDefault: false, maxParallel: 4, instructions: '',
    roles: [
      { role: 'coordinator', enabled: true, allocations: [{ id: 'c2', runtime: 'claude', count: 1 }] },
      { role: 'scout', enabled: true, allocations: [{ id: 's2', runtime: 'claude', count: 1 }] },
      { role: 'builder', enabled: true, allocations: [{ id: 'bc', runtime: 'claude', count: 1 }, { id: 'bx', runtime: 'codex', count: 1 }] },
      { role: 'reviewer', enabled: true, allocations: [{ id: 'r2', runtime: 'codex', count: 1 }] },
    ], createdAt: '', updatedAt: '',
  },
]

let blockLaunch = false
let failStart = false
let created: Record<string, unknown> | undefined
const createSwarm = vi.fn(async (request: CreateSwarmRequest) => {
  created = { id: 'new-swarm', projectId: request.projectId, name: 'Generated', lifecycle: 'draft', progress: 0 }
  return created
})
const startSwarm = vi.fn(async (_projectId: string, _swarmId: string) => {
  if (failStart) throw new Error('Runtime preparation failed')
})
const previewSwarmLaunch = vi.fn(async (request: CreateSwarmRequest): Promise<SwarmLaunchPreview> => ({
  name: 'Repair Notifications', projectId: request.projectId, projectRoot: 'C:\\project', roles: request.roles ?? [],
  totalAgents: request.roles?.flatMap((role) => role.allocations).reduce((sum, allocation) => sum + allocation.count, 0) ?? 0,
  maxParallel: request.maxParallel ?? 4,
  safeguards: [{ code: 'scope', label: 'Stay inside the Project', reason: 'Project isolation is enforced.' }],
  attachments: request.attachments ?? [],
  runtimeReadiness: [
    { runtime: 'claude', installed: true, authenticated: true, available: true, version: '2', message: 'Authenticated and ready.' },
    { runtime: 'codex', installed: true, authenticated: !blockLaunch, available: !blockLaunch, version: '1', message: blockLaunch ? 'Authentication is required.' : 'Authenticated and ready.' },
  ],
  warnings: blockLaunch ? ['Codex: Authentication is required.'] : [],
  canLaunch: !blockLaunch,
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null) }))
vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
  native: {
    getProject: vi.fn(async () => ({ id: 'p1', name: 'Paralith', rootPath: 'C:\\project' })),
    listSwarmPresets: vi.fn(async () => presets),
    listSwarmModelRegistry: vi.fn(async () => models),
    listSwarms: vi.fn(async () => created ? [{ swarm: created, activity: {} }] : []),
    previewSwarmLaunch: (...args: unknown[]) => previewSwarmLaunch(...(args as [CreateSwarmRequest])),
    createSwarm: (...args: unknown[]) => createSwarm(...(args as [CreateSwarmRequest])),
    startSwarm: (...args: unknown[]) => startSwarm(...(args as [string, string])),
  },
}))

import { SwarmCreatePanel } from './SwarmCreatePanel'
import { useSwarmStore } from './swarmStore'

describe('SwarmCreatePanel V2', () => {
  beforeEach(() => {
    blockLaunch = false
    failStart = false
    created = undefined
    vi.clearAllMocks()
    useSwarmStore.setState({ presets: [], itemsByProject: {}, detailById: {}, error: undefined })
  })

  it('uses the required Team, Mission, Review and Launch sequence', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await screen.findByText('Auto')
    expect(screen.getByRole('button', { name: /01Team/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
    expect(await screen.findByText(/Describe the engineering outcome/i)).toBeInTheDocument()
    expect(previewSwarmLaunch).not.toHaveBeenCalled()
  })

  it('shows mixed Claude and Codex agents as individual identities', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await userEvent.click(await screen.findByText('Standard'))
    expect(screen.getByText('Builder 1')).toBeInTheDocument()
    expect(screen.getByText('Builder 2')).toBeInTheDocument()
    expect(screen.getAllByText('Claude').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Codex').length).toBeGreaterThan(0)
  })

  it('validates with the backend before creating and launching', async () => {
    const onCreated = vi.fn()
    render(<SwarmCreatePanel projectId="p1" onCreated={onCreated} onCancel={() => {}} />)
    await userEvent.click(await screen.findByText('Standard'))
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    await userEvent.type(screen.getByPlaceholderText(/What should this team/i), 'Repair the notification delivery pipeline')
    await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
    expect(await screen.findByText('Repair Notifications')).toBeInTheDocument()
    expect(screen.getByText('Stay inside the Project')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Launch Swarm/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-swarm'))
    expect(previewSwarmLaunch).toHaveBeenCalledBefore(createSwarm)
    expect(startSwarm).toHaveBeenCalledWith('p1', 'new-swarm')
    expect(onCreated).toHaveBeenCalledWith('new-swarm')
  })

  it('blocks launch when a configured runtime is unauthenticated', async () => {
    blockLaunch = true
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await userEvent.click(await screen.findByText('Standard'))
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    await userEvent.type(screen.getByPlaceholderText(/What should this team/i), 'Repair the notification delivery pipeline')
    await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
    expect(await screen.findByText('Launch is blocked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Launch Swarm/i })).toBeDisabled()
    expect(createSwarm).not.toHaveBeenCalled()
  })

  it('keeps the durable draft visible when start fails after creation', async () => {
    failStart = true
    const onCreated = vi.fn()
    render(<SwarmCreatePanel projectId="p1" onCreated={onCreated} onCancel={() => {}} />)
    await userEvent.click(await screen.findByText('Standard'))
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    await userEvent.type(screen.getByPlaceholderText(/What should this team/i), 'Repair the notification delivery pipeline')
    await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Launch Swarm/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('new-swarm'))
    expect(createSwarm).toHaveBeenCalledTimes(1)
    expect(startSwarm).toHaveBeenCalledTimes(1)
  })

  it('adds a member with the provider selected by the model registry', async () => {
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await screen.findByText('Auto')
    await userEvent.click(screen.getByRole('button', { name: /Add agent/i }))
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    await userEvent.type(screen.getByPlaceholderText(/What should this team/i), 'Repair the notification delivery pipeline')
    await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
    await waitFor(() => expect(previewSwarmLaunch).toHaveBeenCalled())
    const request = previewSwarmLaunch.mock.calls.at(-1)?.[0]
    const builders = request?.roles?.find((role) => role.role === 'builder')?.allocations ?? []
    expect(builders.at(-1)?.runtime).toBe('codex')
    expect(builders.at(-1)?.modelConfig?.providerId).toBe('codex')
  })
})
