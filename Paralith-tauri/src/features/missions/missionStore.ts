import { create } from 'zustand'
import { asNativeError } from '../../native/commands'
import type { Run } from '../runs/runTypes'
import { missionApi } from './missionApi'
import type {
  CreateMissionRequest,
  Mission,
  MissionChangedEvent,
  MissionDetail,
  MissionEventRecord,
  MissionPlanDraft,
  MissionQuery,
  MissionSummary,
  MissionTaskOutput,
} from './missionTypes'

/**
 * Backend-authoritative cache for Mission Control.
 *
 * The Rust `MissionService` owns every Mission's lifecycle. This store mirrors what the backend
 * persists and exposes action wrappers that call native commands and then refetch. It never
 * advances a Mission or a Task itself, which is what makes two windows showing the same Mission
 * agree, and what makes closing the surface irrelevant to work in flight.
 */
interface MissionState {
  missionsByProject: Record<string, MissionSummary[]>
  detailById: Record<string, MissionDetail>
  activityById: Record<string, MissionEventRecord[]>
  runsById: Record<string, Run[]>
  outputsById: Record<string, MissionTaskOutput[]>
  loadingProject?: string
  loadingDetailById: Record<string, boolean | undefined>
  pendingById: Record<string, string | undefined>
  error?: string

  loadMissions: (query: MissionQuery) => Promise<void>
  loadDetail: (missionId: string) => Promise<MissionDetail | undefined>
  loadActivity: (missionId: string) => Promise<void>
  loadRuns: (missionId: string) => Promise<void>
  loadOutputs: (missionId: string) => Promise<void>
  /** Re-read whatever this store already holds for the Mission an event names. */
  applyChange: (event: MissionChangedEvent) => Promise<void>

  createMission: (request: CreateMissionRequest) => Promise<Mission>
  prepareMission: (missionId: string) => Promise<Mission | undefined>
  startMission: (missionId: string) => Promise<void>
  cancelMission: (missionId: string) => Promise<void>
  acceptMission: (missionId: string) => Promise<void>
  revisePlan: (missionId: string, plan: MissionPlanDraft, reason: string) => Promise<void>
  retryTask: (missionId: string, taskId: string) => Promise<void>
  startTask: (missionId: string, taskId: string) => Promise<void>
  completeManualTask: (missionId: string, taskId: string) => Promise<void>
  waiveCriterion: (missionId: string, criterionId: string, reason: string) => Promise<void>
  clearError: () => void
}

/** Guards against a slow response overwriting a newer one. */
const projectRequestVersions = new Map<string, number>()
const detailRequestVersions = new Map<string, number>()

function nextVersion(versions: Map<string, number>, key: string): number {
  const version = (versions.get(key) ?? 0) + 1
  versions.set(key, version)
  return version
}

function isCurrent(versions: Map<string, number>, key: string, version: number): boolean {
  return versions.get(key) === version
}

/** The last query used per project, so an event-driven refresh preserves the active filter. */
const lastQueryByProject = new Map<string, MissionQuery>()

export const useMissionStore = create<MissionState>((set, get) => ({
  missionsByProject: {},
  detailById: {},
  activityById: {},
  runsById: {},
  outputsById: {},
  loadingDetailById: {},
  pendingById: {},

  loadMissions: async (query) => {
    const version = nextVersion(projectRequestVersions, query.projectId)
    lastQueryByProject.set(query.projectId, query)
    set({ loadingProject: query.projectId, error: undefined })
    try {
      const missions = await missionApi.list(query)
      if (!isCurrent(projectRequestVersions, query.projectId, version)) return
      set((state) => ({
        missionsByProject: { ...state.missionsByProject, [query.projectId]: missions },
        loadingProject: undefined,
      }))
    } catch (error) {
      if (!isCurrent(projectRequestVersions, query.projectId, version)) return
      set({ loadingProject: undefined, error: asNativeError(error).message })
    }
  },

  loadDetail: async (missionId) => {
    const version = nextVersion(detailRequestVersions, missionId)
    set((state) => ({ loadingDetailById: { ...state.loadingDetailById, [missionId]: true } }))
    try {
      const detail = await missionApi.detail(missionId)
      if (!isCurrent(detailRequestVersions, missionId, version)) return undefined
      set((state) => ({
        detailById: { ...state.detailById, [missionId]: detail },
        loadingDetailById: { ...state.loadingDetailById, [missionId]: false },
      }))
      return detail
    } catch (error) {
      if (!isCurrent(detailRequestVersions, missionId, version)) return undefined
      set((state) => ({
        loadingDetailById: { ...state.loadingDetailById, [missionId]: false },
        error: asNativeError(error).message,
      }))
      return undefined
    }
  },

  loadActivity: async (missionId) => {
    try {
      const events = await missionApi.activity(missionId, 300)
      set((state) => ({ activityById: { ...state.activityById, [missionId]: events } }))
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  loadRuns: async (missionId) => {
    try {
      const runs = await missionApi.runs(missionId)
      set((state) => ({ runsById: { ...state.runsById, [missionId]: runs } }))
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  loadOutputs: async (missionId) => {
    try {
      const outputs = await missionApi.taskOutputs(missionId)
      set((state) => ({ outputsById: { ...state.outputsById, [missionId]: outputs } }))
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  applyChange: async (event) => {
    const query = lastQueryByProject.get(event.projectId)
    const work: Promise<unknown>[] = []
    if (query) work.push(get().loadMissions(query))
    // Only refetch what the surface is actually showing; an event for an unopened Mission must
    // not cost a round trip.
    if (get().detailById[event.missionId]) work.push(get().loadDetail(event.missionId))
    if (get().activityById[event.missionId]) work.push(get().loadActivity(event.missionId))
    if (get().runsById[event.missionId]) work.push(get().loadRuns(event.missionId))
    if (get().outputsById[event.missionId]) work.push(get().loadOutputs(event.missionId))
    await Promise.all(work)
  },

  createMission: async (request) => {
    set({ error: undefined })
    try {
      const mission = await missionApi.create(request)
      const query = lastQueryByProject.get(request.projectId)
      if (query) await get().loadMissions(query)
      return mission
    } catch (error) {
      set({ error: asNativeError(error).message })
      throw error
    }
  },

  prepareMission: async (missionId) => {
    set((state) => ({ pendingById: { ...state.pendingById, [missionId]: 'preparing' } }))
    try {
      const mission = await missionApi.prepare(missionId)
      await refresh(get, mission.projectId, missionId)
      return mission
    } catch (error) {
      set({ error: asNativeError(error).message })
      // The Mission is still there with its Preflight and its recorded failure; re-read so the
      // surface shows the real state rather than an optimistic one.
      await get().loadDetail(missionId)
      return undefined
    } finally {
      set((state) => ({ pendingById: { ...state.pendingById, [missionId]: undefined } }))
    }
  },

  startMission: async (missionId) => {
    await act(set, get, missionId, 'starting', () => missionApi.start(missionId))
  },

  cancelMission: async (missionId) => {
    await act(set, get, missionId, 'cancelling', () => missionApi.cancel(missionId))
  },

  acceptMission: async (missionId) => {
    await act(set, get, missionId, 'accepting', () => missionApi.accept(missionId))
  },

  revisePlan: async (missionId, plan, reason) => {
    await act(set, get, missionId, 'revising', () =>
      missionApi.revisePlan(missionId, plan, reason),
    )
  },

  retryTask: async (missionId, taskId) => {
    await act(set, get, missionId, 'retrying', async () => {
      await missionApi.retryTask(taskId)
      return undefined
    })
  },

  startTask: async (missionId, taskId) => {
    await act(set, get, missionId, 'starting-task', async () => {
      await missionApi.startTask(taskId)
      return undefined
    })
  },

  completeManualTask: async (missionId, taskId) => {
    await act(set, get, missionId, 'completing-task', async () => {
      await missionApi.completeManualTask(taskId)
      return undefined
    })
  },

  waiveCriterion: async (missionId, criterionId, reason) => {
    await act(set, get, missionId, 'waiving', async () => {
      await missionApi.waiveCriterion(criterionId, reason)
      return undefined
    })
  },

  clearError: () => set({ error: undefined }),
}))

/** Re-read every view this store currently holds for one Mission. */
async function refresh(
  get: () => MissionState,
  projectId: string | undefined,
  missionId: string,
): Promise<void> {
  const state = get()
  const query = projectId ? lastQueryByProject.get(projectId) : undefined
  const work: Promise<unknown>[] = [state.loadDetail(missionId)]
  if (query) work.push(state.loadMissions(query))
  if (state.activityById[missionId]) work.push(state.loadActivity(missionId))
  if (state.runsById[missionId]) work.push(state.loadRuns(missionId))
  if (state.outputsById[missionId]) work.push(state.loadOutputs(missionId))
  await Promise.all(work)
}

/**
 * Run one domain action, then re-read. The pending flag is per Mission so a busy control is
 * disabled without freezing the rest of the surface, and a failure surfaces the backend's own
 * message rather than a generic one.
 */
async function act(
  set: (partial: Partial<MissionState> | ((state: MissionState) => Partial<MissionState>)) => void,
  get: () => MissionState,
  missionId: string,
  pending: string,
  operation: () => Promise<Mission | undefined>,
): Promise<void> {
  set((state) => ({ pendingById: { ...state.pendingById, [missionId]: pending } }))
  try {
    const mission = await operation()
    await refresh(get, mission?.projectId ?? get().detailById[missionId]?.mission.projectId, missionId)
  } catch (error) {
    set({ error: asNativeError(error).message })
    await get().loadDetail(missionId)
  } finally {
    set((state) => ({ pendingById: { ...state.pendingById, [missionId]: undefined } }))
  }
}

/** Test-only reset of the module-level request bookkeeping. */
export function resetMissionStoreVersions(): void {
  projectRequestVersions.clear()
  detailRequestVersions.clear()
  lastQueryByProject.clear()
}
