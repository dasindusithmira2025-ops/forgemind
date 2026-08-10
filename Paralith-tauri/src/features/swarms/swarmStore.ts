import { create } from 'zustand'
import { native, asNativeError } from '../../native/commands'
import type {
  CreateSwarmRequest,
  SavePresetRequest,
  Swarm,
  SwarmDetail,
  SwarmListItem,
  SwarmPreset,
} from '../../native/types'

/**
 * Backend-authoritative cache for Paralith Swarms. The Rust `SwarmService` owns every Swarm's
 * lifecycle, task graph, and agents; this store only mirrors what the backend persists and
 * exposes thin action wrappers that call native commands and then refetch. It never advances a
 * Swarm's state itself, so a frontend reload or window move never disturbs a running Swarm — the
 * store simply re-reads the authoritative state on mount and on every `swarm-changed` event.
 */
interface SwarmState {
  presets: SwarmPreset[]
  /** Sidebar list items keyed by projectId. */
  itemsByProject: Record<string, SwarmListItem[]>
  /** Full detail keyed by swarmId (Overview / Team / Work views). */
  detailById: Record<string, SwarmDetail>
  loadingProject?: string
  error?: string
  pendingBySwarm: Record<string, string | undefined>

  loadPresets: () => Promise<void>
  loadSwarms: (projectId: string, includeArchived?: boolean) => Promise<void>
  loadDetail: (projectId: string, swarmId: string) => Promise<SwarmDetail | undefined>
  /** Refresh whatever we currently hold for a swarm id (used by the swarm-changed event). */
  refresh: (projectId: string, swarmId: string) => Promise<void>

  create: (request: CreateSwarmRequest) => Promise<Swarm>
  start: (swarmId: string) => Promise<void>
  pause: (swarmId: string) => Promise<void>
  resume: (swarmId: string) => Promise<void>
  stop: (swarmId: string, hard?: boolean) => Promise<void>
  archive: (swarmId: string, archived: boolean) => Promise<void>
  remove: (swarmId: string) => Promise<void>
  rename: (swarmId: string, name: string) => Promise<void>
  accept: (swarmId: string) => Promise<void>
  resolveDecision: (swarmId: string, choice: 'recommended' | 'alternative' | 'stop') => Promise<void>
  addBuilder: (swarmId: string) => Promise<void>
  message: (swarmId: string, target: string, body: string) => Promise<void>
  resolveAttention: (swarmId: string, requestId: string, response: string, approved: boolean) => Promise<void>
  retry: (swarmId: string, memberId?: string) => Promise<void>
  savePreset: (request: SavePresetRequest) => Promise<void>
  deletePreset: (presetId: string) => Promise<void>
  clearError: () => void
}

const projectRequestVersions = new Map<string, number>()
const detailRequestVersions = new Map<string, number>()

function projectOf(state: SwarmState, swarmId: string): string | undefined {
  const detail = state.detailById[swarmId]
  if (detail) return detail.swarm.projectId
  for (const [projectId, items] of Object.entries(state.itemsByProject)) {
    if (items.some((item) => item.swarm.id === swarmId)) return projectId
  }
  return undefined
}

export const useSwarmStore = create<SwarmState>((set, get) => ({
  presets: [],
  itemsByProject: {},
  detailById: {},
  pendingBySwarm: {},

  loadPresets: async () => {
    try {
      const presets = await native.listSwarmPresets()
      set({ presets })
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  loadSwarms: async (projectId, includeArchived = false) => {
    const requestVersion = (projectRequestVersions.get(projectId) ?? 0) + 1
    projectRequestVersions.set(projectId, requestVersion)
    set({ loadingProject: projectId })
    try {
      const items = await native.listSwarms(projectId, includeArchived)
      if (projectRequestVersions.get(projectId) !== requestVersion) return
      set((state) => ({
        itemsByProject: { ...state.itemsByProject, [projectId]: items },
        loadingProject: undefined,
      }))
    } catch (error) {
      if (projectRequestVersions.get(projectId) !== requestVersion) return
      set({ error: asNativeError(error).message, loadingProject: undefined })
    }
  },

  loadDetail: async (projectId, swarmId) => {
    const requestVersion = (detailRequestVersions.get(swarmId) ?? 0) + 1
    detailRequestVersions.set(swarmId, requestVersion)
    try {
      const detail = await native.getSwarmDetail(projectId, swarmId)
      if (detailRequestVersions.get(swarmId) !== requestVersion) return undefined
      set((state) => {
        const current = state.detailById[swarmId]
        if (current && current.swarm.revision > detail.swarm.revision) return state
        return { detailById: { ...state.detailById, [swarmId]: detail } }
      })
      return detail
    } catch (error) {
      if (detailRequestVersions.get(swarmId) !== requestVersion) return undefined
      const native = asNativeError(error)
      // A Swarm deleted in another window reaches us as a `swarm-changed` notification followed by
      // a 404 on the detail it announced. That is the expected end of that Swarm, not a failure to
      // report: drop the stale cache entry instead of parking an error banner over the workspace.
      if (native.code === 'swarm_not_found') {
        set((state) => {
          if (!state.detailById[swarmId]) return state
          const detailById = { ...state.detailById }
          delete detailById[swarmId]
          return { detailById }
        })
        return undefined
      }
      set({ error: native.message })
      return undefined
    }
  },

  refresh: async (projectId, swarmId) => {
    const state = get()
    const tasks: Promise<unknown>[] = []
    if (state.detailById[swarmId]) tasks.push(state.loadDetail(projectId, swarmId))
    tasks.push(state.loadSwarms(projectId))
    await Promise.all(tasks)
  },

  create: async (request) => {
    try {
      const swarm = await native.createSwarm(request)
      await get().loadSwarms(request.projectId)
      return swarm
    } catch (error) {
      const message = asNativeError(error).message
      set({ error: message })
      throw new Error(message)
    }
  },

  start: async (swarmId) => runAction(set, get, swarmId, 'start', (projectId) => native.startSwarm(projectId, swarmId)),
  pause: async (swarmId) => runAction(set, get, swarmId, 'pause', (projectId) => native.pauseSwarm(projectId, swarmId)),
  resume: async (swarmId) => runAction(set, get, swarmId, 'resume', (projectId) => native.resumeSwarm(projectId, swarmId)),
  stop: async (swarmId, hard = false) => runAction(set, get, swarmId, 'stop', (projectId) => native.stopSwarm(projectId, swarmId, hard)),
  archive: async (swarmId, archived) => runAction(set, get, swarmId, 'archive', (projectId) => native.archiveSwarm(projectId, swarmId, archived)),
  rename: async (swarmId, name) => runAction(set, get, swarmId, 'rename', (projectId) => native.renameSwarm(projectId, swarmId, name)),
  accept: async (swarmId) => runAction(set, get, swarmId, 'accept', (projectId) => native.acceptSwarmResult(projectId, swarmId)),
  resolveDecision: async (swarmId, choice) => runAction(set, get, swarmId, 'decision', (projectId) => native.resolveSwarmDecision(projectId, swarmId, choice)),
  addBuilder: async (swarmId) => runAction(set, get, swarmId, 'add_builder', (projectId) => native.addSwarmBuilder(projectId, swarmId)),
  message: async (swarmId, target, body) =>
    runAction(set, get, swarmId, 'message', (projectId) => native.sendSwarmMessage(projectId, swarmId, target, body)),
  resolveAttention: async (swarmId, requestId, response, approved) =>
    runAction(set, get, swarmId, 'attention', (projectId) => native.resolveSwarmAttention(projectId, swarmId, requestId, response, approved)),
  retry: async (swarmId, memberId) =>
    runAction(set, get, swarmId, 'retry', (projectId) => native.retrySwarm(projectId, swarmId, memberId)),

  remove: async (swarmId) => {
    const projectId = projectOf(get(), swarmId)
    try {
      if (!projectId) throw new Error('The Swarm is not bound to a loaded Project.')
      await native.deleteSwarm(projectId, swarmId)
      set((state) => {
        const detailById = { ...state.detailById }
        delete detailById[swarmId]
        return { detailById }
      })
      await get().loadSwarms(projectId)
    } catch (error) {
      const message = asNativeError(error).message
      set({ error: message })
      throw new Error(message)
    }
  },

  savePreset: async (request) => {
    try {
      await native.saveSwarmPreset(request)
      await get().loadPresets()
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  deletePreset: async (presetId) => {
    try {
      await native.deleteSwarmPreset(presetId)
      await get().loadPresets()
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  clearError: () => set({ error: undefined }),
}))

async function runAction(
  set: (partial: Partial<SwarmState>) => void,
  get: () => SwarmState,
  swarmId: string,
  operation: string,
  action: (projectId: string) => Promise<unknown>,
): Promise<void> {
  // The guards below run before this call owns the pending marker. Releasing it in `finally`
  // regardless would clear the marker belonging to the operation that is *still in flight*, so a
  // rejected second click re-enables every control and lets a third click issue a genuinely
  // concurrent lifecycle command. Only the invocation that acquired the marker may release it.
  let acquired = false
  try {
    const projectId = projectOf(get(), swarmId)
    if (!projectId) throw new Error('The Swarm is not bound to a loaded Project.')
    if (get().pendingBySwarm[swarmId]) throw new Error('Another Swarm operation is still in progress.')
    set({ pendingBySwarm: { ...get().pendingBySwarm, [swarmId]: operation } })
    acquired = true
    await action(projectId)
    await get().refresh(projectId, swarmId)
  } catch (error) {
    const message = asNativeError(error).message
    set({ error: message })
    throw new Error(message)
  } finally {
    if (acquired) set({ pendingBySwarm: { ...get().pendingBySwarm, [swarmId]: undefined } })
  }
}
