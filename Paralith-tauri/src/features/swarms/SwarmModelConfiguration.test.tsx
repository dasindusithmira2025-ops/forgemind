import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type {
  CreateSwarmRequest,
  SavePresetRequest,
  SwarmLaunchPreview,
  SwarmModelCapability,
  SwarmPreset,
  SwarmRoleConfig,
} from '../../native/types'

/**
 * The Swarm model-identity contract.
 *
 * A configured member is `providerId` + canonical `modelId` + settings; every label is derived
 * from the backend registry. These tests pin the one invariant the creation flow exists to
 * uphold: a preset the registry can resolve must never reach Review & Launch carrying the
 * unconfigured sentinel, in any preset, in any load order, across duplication and persistence.
 */

const capability = (
  providerId: 'claude' | 'codex',
  modelId: string,
  displayName: string,
  recommendedRoles: string[],
  available = true,
): SwarmModelCapability => ({
  providerId,
  providerDisplayName: providerId === 'claude' ? 'Claude' : 'Codex',
  modelId,
  displayName,
  description: `${displayName} description`,
  available,
  deprecated: false,
  coding: true,
  planning: true,
  review: true,
  toolUse: true,
  vision: true,
  supportedReasoningEfforts: ['low', 'medium', 'high'],
  supportedExecutionModes: ['interactive', 'autonomous', 'review'],
  recommendedRoles,
  authenticated: available,
  runtimeVersion: '1.0.0',
})

/** Mirrors `agents::model_registry::MODELS`, including that no model id is shared across providers. */
const REGISTRY: SwarmModelCapability[] = [
  capability('claude', 'opus', 'Opus', ['coordinator', 'scout']),
  capability('claude', 'fable', 'Fable', ['scout', 'reviewer']),
  capability('claude', 'sonnet', 'Sonnet', ['builder', 'reviewer', 'debugger']),
  capability('codex', 'gpt-5.5', 'GPT-5.5', ['builder', 'integrator']),
  capability('codex', 'sol', 'SOL', ['builder', 'debugger', 'coordinator']),
  capability('codex', 'terra', 'Terra', ['reviewer', 'scout', 'debugger']),
]

const configured = (providerId: 'claude' | 'codex', modelId: string) => {
  const model = REGISTRY.find((item) => item.providerId === providerId && item.modelId === modelId)
  if (!model) throw new Error(`test fixture names an unregistered model: ${providerId}/${modelId}`)
  return {
    providerId,
    providerDisplayName: model.providerDisplayName,
    modelId,
    modelDisplayName: model.displayName,
    reasoningEffort: 'high' as const,
    executionMode: 'autonomous' as const,
    contextStrategy: 'balanced' as const,
    permissionMode: 'ask' as const,
    providerOptions: {},
    configVersion: 1,
    lastValidationStatus: 'valid' as const,
  }
}

const preset = (id: string, name: string, roles: SwarmRoleConfig[], isDefault = false): SwarmPreset => ({
  id, name, builtin: true, isDefault, maxParallel: 4, instructions: '', roles, createdAt: '', updatedAt: '',
})

/** The canonical built-in compositions, as `models::swarm::builtin_presets` serializes them. */
const BUILTIN: SwarmPreset[] = [
  preset('auto', 'Auto', [
    { role: 'coordinator', enabled: true, allocations: [{ id: 'coordinator-auto', runtime: 'auto', count: 1 }] },
    { role: 'scout', enabled: true, allocations: [{ id: 'scout-auto', runtime: 'auto', count: 1 }] },
    { role: 'builder', enabled: true, allocations: [{ id: 'builder-auto', runtime: 'auto', count: 2 }] },
    { role: 'reviewer', enabled: true, allocations: [{ id: 'reviewer-auto', runtime: 'auto', count: 1 }] },
  ], true),
  preset('quick_fix', 'Focused', [
    { role: 'coordinator', enabled: true, allocations: [{ id: 'coordinator-claude', runtime: 'claude', count: 1, modelConfig: configured('claude', 'sonnet') }] },
    { role: 'builder', enabled: true, allocations: [{ id: 'builder-claude', runtime: 'claude', count: 1, modelConfig: configured('claude', 'sonnet') }] },
    { role: 'reviewer', enabled: true, allocations: [{ id: 'reviewer-codex', runtime: 'codex', count: 1, modelConfig: configured('codex', 'gpt-5.5') }] },
  ]),
  preset('feature_team', 'Standard', [
    { role: 'coordinator', enabled: true, allocations: [{ id: 'c', runtime: 'claude', count: 1, modelConfig: configured('claude', 'sonnet') }] },
    { role: 'builder', enabled: true, allocations: [{ id: 'bc', runtime: 'claude', count: 1, modelConfig: configured('claude', 'sonnet') }, { id: 'bx', runtime: 'codex', count: 1, modelConfig: configured('codex', 'gpt-5.5') }] },
    { role: 'reviewer', enabled: true, allocations: [{ id: 'r', runtime: 'codex', count: 1, modelConfig: configured('codex', 'gpt-5.5') }] },
  ]),
  preset('deep_engineering', 'Parallel', [
    { role: 'coordinator', enabled: true, allocations: [{ id: 'c', runtime: 'auto', count: 1 }] },
    { role: 'builder', enabled: true, allocations: [{ id: 'bc', runtime: 'claude', count: 2, modelConfig: configured('claude', 'sonnet') }] },
    { role: 'reviewer', enabled: true, allocations: [{ id: 'r', runtime: 'auto', count: 1 }] },
  ]),
  preset('large', 'Large', [
    { role: 'coordinator', enabled: true, allocations: [{ id: 'c', runtime: 'claude', count: 1, modelConfig: configured('claude', 'sonnet') }] },
    { role: 'builder', enabled: true, allocations: [{ id: 'bc', runtime: 'claude', count: 3, modelConfig: configured('claude', 'sonnet') }, { id: 'bx', runtime: 'codex', count: 3, modelConfig: configured('codex', 'gpt-5.5') }] },
    { role: 'reviewer', enabled: true, allocations: [{ id: 'r', runtime: 'codex', count: 2, modelConfig: configured('codex', 'gpt-5.5') }] },
  ]),
]

/** `presets` and `registry` are mutable so a test can model an outage or a load-order race. */
let presets: SwarmPreset[] = []
let registry: SwarmModelCapability[] = []
let presetGate: Promise<void> = Promise.resolve()
let registryGate: Promise<void> = Promise.resolve()
let lastRequest: CreateSwarmRequest | undefined
const saved: SavePresetRequest[] = []

const previewSwarmLaunch = vi.fn(async (request: CreateSwarmRequest): Promise<SwarmLaunchPreview> => {
  lastRequest = request
  return {
    name: 'Generated Name', projectId: request.projectId, projectRoot: 'C:\\project', roles: request.roles ?? [],
    totalAgents: request.roles?.flatMap((role) => role.allocations).reduce((sum, allocation) => sum + allocation.count, 0) ?? 0,
    maxParallel: request.maxParallel ?? 4, safeguards: [], attachments: [],
    runtimeReadiness: [
      { runtime: 'claude', installed: true, authenticated: true, available: true, version: '2', message: 'Authenticated and ready.' },
      { runtime: 'codex', installed: true, authenticated: true, available: true, version: '1', message: 'Authenticated and ready.' },
    ],
    warnings: [], canLaunch: true,
  }
})

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(async () => null), confirm: vi.fn(async () => true) }))
vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
  native: {
    getProject: vi.fn(async () => ({ id: 'p1', name: 'Paralith', rootPath: 'C:\\project' })),
    listSwarmPresets: vi.fn(async () => { await presetGate; return presets }),
    listSwarmModelRegistry: vi.fn(async () => { await registryGate; return registry }),
    listSwarms: vi.fn(async () => []),
    previewSwarmLaunch: (...args: unknown[]) => previewSwarmLaunch(...(args as [CreateSwarmRequest])),
    createSwarm: vi.fn(async (request: CreateSwarmRequest) => ({ id: 'new-swarm', projectId: request.projectId, name: 'Generated', lifecycle: 'draft', progress: 0 })),
    startSwarm: vi.fn(async () => undefined),
    saveSwarmPreset: vi.fn(async (request: SavePresetRequest) => {
      saved.push(request)
      const stored: SwarmPreset = {
        id: request.id ?? `custom-${saved.length}`, name: request.name, builtin: false,
        isDefault: request.isDefault ?? false, maxParallel: request.maxParallel, instructions: request.instructions ?? '',
        // Round-trip through JSON exactly as SQLite `config_json` does, so a serialization gap
        // in the roster payload would surface here rather than only in production.
        roles: JSON.parse(JSON.stringify(request.roles)) as SwarmRoleConfig[],
        createdAt: '', updatedAt: '',
      }
      presets = [...presets.filter((item) => item.id !== stored.id), stored]
      return stored
    }),
    deleteSwarmPreset: vi.fn(async () => undefined),
  },
}))

import { SwarmCreatePanel } from './SwarmCreatePanel'
import { useSwarmStore } from './swarmStore'

/** Every model cell the roster is currently showing, in roster order. */
function rosterModels(): string[] {
  return Array.from(document.querySelectorAll('.swarm-roster-summary'))
    .map((row) => row.querySelectorAll('.swarm-runtime-mark')[1]?.textContent ?? '')
}

function readinessCells(): string[] {
  return Array.from(document.querySelectorAll('.swarm-readiness-pending, .swarm-readiness-ready'))
    .map((node) => node.textContent ?? '')
}

async function renderPanel(anchor = 'Auto') {
  render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
  await screen.findByText(anchor)
  await waitFor(() => expect(rosterModels().length).toBeGreaterThan(0))
}

async function reachReview() {
  await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
  await userEvent.type(screen.getByPlaceholderText(/What should this team/i), 'Repair the notification pipeline')
  await userEvent.click(screen.getByRole('button', { name: /Review launch/i }))
  await screen.findByText('Generated Name')
}

/** The launch-blocking assertion, stated once: the request the backend would validate carries a
 *  canonical model identity for every member, and nothing on screen says otherwise. */
function expectNoUnconfiguredMember() {
  const allocations = (lastRequest?.roles ?? []).flatMap((role) => role.allocations)
  expect(allocations.length).toBeGreaterThan(0)
  for (const allocation of allocations) {
    expect(allocation.modelConfig).toBeTruthy()
    expect(allocation.modelConfig?.modelId).not.toBe('unconfigured')
    expect(REGISTRY.some((model) =>
      model.providerId === allocation.modelConfig?.providerId && model.modelId === allocation.modelConfig?.modelId,
    )).toBe(true)
  }
  expect(screen.queryByText('Model not configured')).toBeNull()
}

describe('Swarm model identity contract', () => {
  beforeEach(() => {
    presets = BUILTIN.map((item) => ({ ...item }))
    registry = REGISTRY
    presetGate = Promise.resolve()
    registryGate = Promise.resolve()
    lastRequest = undefined
    saved.length = 0
    vi.clearAllMocks()
    useSwarmStore.setState({ presets: [], itemsByProject: {}, detailById: {}, error: undefined })
  })

  it.each(BUILTIN.map((item) => item.name))('resolves a canonical model for every member of the %s preset', async (name) => {
    await renderPanel()
    await userEvent.click(screen.getByText(name))
    await waitFor(() => expect(rosterModels().length).toBeGreaterThan(0))
    expect(rosterModels().every((label) => label !== 'Model not configured')).toBe(true)
    await reachReview()
    expectNoUnconfiguredMember()
  })

  it.each(BUILTIN.map((item) => item.name))('preserves canonical models when the %s preset is duplicated', async (name) => {
    await renderPanel()
    await userEvent.click(screen.getByText(name))
    await waitFor(() => expect(rosterModels().length).toBeGreaterThan(0))
    const before = rosterModels()

    await userEvent.click(screen.getByRole('button', { name: /Duplicate/i }))
    await waitFor(() => expect(saved).toHaveLength(1))
    // The duplicate is saved, reloaded from persistence, and re-selected. The models it comes back
    // with must be the ones that were on screen — not defaults, and never the sentinel.
    await waitFor(() => expect(rosterModels()).toEqual(before))
    expect(saved[0].name).toBe(`${name} copy`)
    for (const allocation of saved[0].roles.flatMap((role) => role.allocations)) {
      if (allocation.count === 0) continue
      expect(allocation.modelConfig?.modelId).not.toBe('unconfigured')
    }
    await reachReview()
    expectNoUnconfiguredMember()
  })

  it('resolves models when the registry arrives after the presets', async () => {
    let release = () => {}
    registryGate = new Promise((resolve) => { release = () => resolve() })
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    await screen.findByText('Focused')
    await userEvent.click(screen.getByText('Focused'))
    // No registry yet: the flow must not invent identities, and must not let one through.
    expect(rosterModels()).toEqual([])
    release()
    await waitFor(() => expect(rosterModels()).toEqual(['Sonnet', 'Sonnet', 'GPT-5.5']))
    await reachReview()
    expectNoUnconfiguredMember()
  })

  it('resolves models when the presets arrive after the registry', async () => {
    let release = () => {}
    presetGate = new Promise((resolve) => { release = () => resolve() })
    render(<SwarmCreatePanel projectId="p1" onCreated={vi.fn()} onCancel={() => {}} />)
    release()
    await screen.findByText('Focused')
    await userEvent.click(screen.getByText('Focused'))
    await waitFor(() => expect(rosterModels()).toEqual(['Sonnet', 'Sonnet', 'GPT-5.5']))
    await reachReview()
    expectNoUnconfiguredMember()
  })

  it('re-resolves the model when the provider changes, and persists the new identity', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('Focused'))
    await waitFor(() => expect(rosterModels()[0]).toBe('Sonnet'))
    await userEvent.click(screen.getByRole('button', { name: /Coordinator 1/ }))
    await userEvent.selectOptions(screen.getByLabelText('Provider'), 'codex')
    // Codex recommends SOL for a coordinator; the label follows the canonical id, not the reverse.
    await waitFor(() => expect(rosterModels()[0]).toBe('SOL'))
    await reachReview()
    expect(lastRequest?.roles?.find((role) => role.role === 'coordinator')?.allocations[0].modelConfig)
      .toMatchObject({ providerId: 'codex', modelId: 'sol' })
    expectNoUnconfiguredMember()
  })

  it('commits a model selection to the roster the review snapshot is built from', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('Focused'))
    await waitFor(() => expect(rosterModels()[0]).toBe('Sonnet'))
    await userEvent.click(screen.getByRole('button', { name: /Coordinator 1/ }))
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'opus')
    await waitFor(() => expect(rosterModels()[0]).toBe('Opus'))
    await reachReview()
    expect(screen.getByText(/Claude \/ Opus/)).toBeInTheDocument()
    expect(lastRequest?.roles?.find((role) => role.role === 'coordinator')?.allocations[0].modelConfig)
      .toMatchObject({ providerId: 'claude', modelId: 'opus' })
    expectNoUnconfiguredMember()
  })

  it('keeps the selected model across Team → Mission → Review and back', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('Focused'))
    await userEvent.click(await screen.findByRole('button', { name: /Coordinator 1/ }))
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'opus')
    await waitFor(() => expect(rosterModels()[0]).toBe('Opus'))
    await reachReview()
    await userEvent.click(screen.getByRole('button', { name: /^Back$/ }))
    await userEvent.click(await screen.findByRole('button', { name: /01Team/i }))
    await waitFor(() => expect(rosterModels()[0]).toBe('Opus'))
    await reachReview()
    expect(lastRequest?.roles?.find((role) => role.role === 'coordinator')?.allocations[0].modelConfig?.modelId).toBe('opus')
    expectNoUnconfiguredMember()
  })

  it('reports a preset model the registry no longer publishes as outdated, not unconfigured', async () => {
    presets = [preset('legacy', 'Legacy', [
      { role: 'builder', enabled: true, allocations: [{ id: 'b', runtime: 'claude', count: 1, modelConfig: { ...configured('claude', 'sonnet'), modelId: 'claude-3-retired', modelDisplayName: 'Sonnet' } }] },
    ], true)]
    await renderPanel('Legacy')
    // The stale canonical id is surfaced, and the display label it was serialized with is not
    // trusted: a label can never stand in for an identity the registry cannot confirm.
    expect(rosterModels()[0]).toBe('Unavailable model “claude-3-retired”')
    expect(readinessCells()).toContain('Model no longer available')
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Select a registered model for: Builder 1 \(Model no longer available\)/)
    expect(previewSwarmLaunch).not.toHaveBeenCalled()
  })

  it('reports an empty registry honestly and refuses to continue', async () => {
    registry = []
    await renderPanel()
    expect(rosterModels().every((label) => label === 'Model not configured')).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /Continue to mission/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Select a registered model for/)
    expect(previewSwarmLaunch).not.toHaveBeenCalled()
  })

  it('marks a resolved model whose provider is unauthenticated as provider-not-ready, not unconfigured', async () => {
    registry = REGISTRY.map((model) => model.providerId === 'codex' ? { ...model, available: false, authenticated: false } : model)
    await renderPanel()
    await userEvent.click(screen.getByText('Focused'))
    await waitFor(() => expect(rosterModels()).toEqual(['Sonnet', 'Sonnet', 'GPT-5.5']))
    expect(readinessCells()).toContain('Provider not ready')
    expect(screen.queryByText('Model not configured')).toBeNull()
    // The identity is sound, so the flow proceeds and the backend preview stays the authority on
    // whether the runtime may actually start.
    await reachReview()
    expectNoUnconfiguredMember()
  })

  it('round-trips a saved custom preset through persistence without losing model identities', async () => {
    await renderPanel()
    await userEvent.click(screen.getByText('Focused'))
    await userEvent.click(await screen.findByRole('button', { name: /Coordinator 1/ }))
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'opus')
    await waitFor(() => expect(rosterModels()[0]).toBe('Opus'))
    await userEvent.click(screen.getByRole('button', { name: /Save custom/i }))
    await waitFor(() => expect(saved).toHaveLength(1))

    // Reload the panel from scratch: the custom preset must come back with the same identities.
    cleanup()
    useSwarmStore.setState({ presets: [] })
    const stored = presets.find((item) => !item.builtin)
    expect(stored?.roles.find((role) => role.role === 'coordinator')?.allocations[0].modelConfig)
      .toMatchObject({ providerId: 'claude', modelId: 'opus' })
    await renderPanel()
    await userEvent.click(screen.getByText('Focused copy'))
    await waitFor(() => expect(rosterModels()).toEqual(['Opus', 'Sonnet', 'GPT-5.5']))
    await reachReview()
    expectNoUnconfiguredMember()
  })
})
