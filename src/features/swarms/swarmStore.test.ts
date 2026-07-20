import { beforeEach, describe, expect, it, vi } from 'vitest'

// A minimal in-memory fake of the native command surface. The store must be backend-authoritative:
// it never advances Swarm state itself, only mirrors what these commands return.
const state = {
  swarms: [] as { swarm: { id: string; projectId: string; name: string; lifecycle: string; progress: number }; activity: unknown }[],
  detail: null as unknown,
}

const listSwarms = vi.fn(async () => state.swarms)
const createSwarm = vi.fn(async (request: { projectId: string; mission: string }) => {
  const swarm = { id: 's1', projectId: request.projectId, name: request.mission, lifecycle: 'draft', progress: 0 }
  state.swarms = [{ swarm, activity: {} }]
  return swarm
})
const startSwarm = vi.fn(async (_projectId: string, _swarmId: string) => {
  state.swarms = state.swarms.map((item) => ({ ...item, swarm: { ...item.swarm, lifecycle: 'building', progress: 0.2 } }))
})
const getSwarmDetail = vi.fn(async (projectId: string, id: string) => ({
  swarm: { id, projectId, name: 'S', lifecycle: 'building', progress: 0.2 },
  activity: {}, agents: [], tasks: [], events: [], messages: [], connections: [], lifecycleHistory: [], runtimeSessions: [], evidence: [], tests: [], memories: [], reviews: [],
}))
const deleteSwarm = vi.fn(async (_projectId: string, _swarmId: string) => { state.swarms = [] })

vi.mock('../../native/commands', () => ({
  asNativeError: (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) }),
  native: {
    listSwarmPresets: vi.fn(async () => []),
    listSwarms: (...args: unknown[]) => listSwarms(...(args as [])),
    createSwarm: (...args: unknown[]) => createSwarm(...(args as [{ projectId: string; mission: string }])),
    startSwarm: (...args: unknown[]) => startSwarm(...(args as [string, string])),
    getSwarmDetail: (...args: unknown[]) => getSwarmDetail(...(args as [string, string])),
    deleteSwarm: (...args: unknown[]) => deleteSwarm(...(args as [string, string])),
  },
}))

import { useSwarmStore } from './swarmStore'

describe('swarmStore (backend-authoritative)', () => {
  beforeEach(() => {
    state.swarms = []
    state.detail = null
    vi.clearAllMocks()
    useSwarmStore.setState({ presets: [], itemsByProject: {}, detailById: {}, error: undefined })
  })

  it('creates a swarm and reloads the project list from the backend', async () => {
    const swarm = await useSwarmStore.getState().create({ projectId: 'p1', mission: 'Fix bug', presetId: 'auto' })
    expect(swarm.id).toBe('s1')
    expect(createSwarm).toHaveBeenCalledOnce()
    expect(listSwarms).toHaveBeenCalledWith('p1', false)
    expect(useSwarmStore.getState().itemsByProject.p1).toHaveLength(1)
  })

  it('loads detail and mirrors backend state without mutating it locally', async () => {
    const detail = await useSwarmStore.getState().loadDetail('p1', 's1')
    expect(detail?.swarm.lifecycle).toBe('building')
    expect(useSwarmStore.getState().detailById.s1?.swarm.progress).toBe(0.2)
  })

  it('start action refreshes detail + list via the engine, never advancing state itself', async () => {
    await useSwarmStore.getState().create({ projectId: 'p1', mission: 'Fix bug', presetId: 'auto' })
    await useSwarmStore.getState().loadDetail('p1', 's1')
    await useSwarmStore.getState().start('s1')
    expect(startSwarm).toHaveBeenCalledWith('p1', 's1')
    // Progress reflects the backend response, not a local increment.
    expect(useSwarmStore.getState().itemsByProject.p1[0].swarm.lifecycle).toBe('building')
  })

  it('surfaces native errors instead of throwing them unhandled for lifecycle actions', async () => {
    deleteSwarm.mockRejectedValueOnce(new Error('swarm_running'))
    await useSwarmStore.getState().create({ projectId: 'p1', mission: 'Fix bug', presetId: 'auto' })
    await expect(useSwarmStore.getState().remove('s1')).rejects.toThrow('swarm_running')
    expect(useSwarmStore.getState().error).toBe('swarm_running')
  })
})
