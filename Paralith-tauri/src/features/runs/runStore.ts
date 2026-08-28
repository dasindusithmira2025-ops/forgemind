import { create } from 'zustand'
import { asNativeError } from '../../native/commands'
import { runApi } from './runApi'
import type {
  CreateRunRequest,
  Run,
  RunChangedEvent,
  RunDetail,
  RunInboxSummary,
  RunQuery,
} from './runTypes'

/**
 * Backend-authoritative cache for the canonical Run Engine.
 *
 * The Rust `RunService` owns every Run's lifecycle. This store only mirrors what the backend
 * persists and exposes action wrappers that call native commands and then refetch. It never
 * advances a Run itself, so closing a pane, moving a window or reloading the renderer cannot
 * disturb a running Run — the store simply re-reads authoritative state on mount and on every
 * `run-changed` event.
 */
interface RunState {
  runsByProject: Record<string, Run[]>
  detailById: Record<string, RunDetail>
  summaryByProject: Record<string, RunInboxSummary>
  loadingProject?: string
  loadingDetailById: Record<string, boolean | undefined>
  pendingByRun: Record<string, string | undefined>
  error?: string

  loadRuns: (query: RunQuery) => Promise<void>
  loadDetail: (runId: string) => Promise<RunDetail | undefined>
  loadSummary: (projectId: string) => Promise<void>
  /** Re-read whatever this store already holds for the Run a `run-changed` event names. */
  applyChange: (event: RunChangedEvent) => Promise<void>

  createRun: (request: CreateRunRequest) => Promise<Run>
  cancelRun: (runId: string, hard?: boolean) => Promise<void>
  retryRun: (runId: string) => Promise<Run>
  resolveApproval: (approvalId: string, approved: boolean, note?: string) => Promise<void>
  clearError: () => void
}

/**
 * Guards against a slow response overwriting a newer one. Each in-flight load records the
 * version it started at; a response whose version is stale is dropped rather than applied.
 */
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
const lastQueryByProject = new Map<string, RunQuery>()

export const useRunStore = create<RunState>((set, get) => ({
  runsByProject: {},
  detailById: {},
  summaryByProject: {},
  loadingDetailById: {},
  pendingByRun: {},

  loadRuns: async (query) => {
    const version = nextVersion(projectRequestVersions, query.projectId)
    lastQueryByProject.set(query.projectId, query)
    set({ loadingProject: query.projectId, error: undefined })
    try {
      const runs = await runApi.list(query)
      if (!isCurrent(projectRequestVersions, query.projectId, version)) return
      set((state) => ({
        runsByProject: { ...state.runsByProject, [query.projectId]: runs },
        loadingProject: undefined,
      }))
    } catch (error) {
      if (!isCurrent(projectRequestVersions, query.projectId, version)) return
      set({ loadingProject: undefined, error: asNativeError(error).message })
    }
  },

  loadDetail: async (runId) => {
    const version = nextVersion(detailRequestVersions, runId)
    set((state) => ({
      loadingDetailById: { ...state.loadingDetailById, [runId]: true },
    }))
    try {
      const detail = await runApi.detail(runId)
      if (!isCurrent(detailRequestVersions, runId, version)) return undefined
      set((state) => ({
        detailById: { ...state.detailById, [runId]: detail },
        loadingDetailById: { ...state.loadingDetailById, [runId]: false },
      }))
      return detail
    } catch (error) {
      if (!isCurrent(detailRequestVersions, runId, version)) return undefined
      set((state) => ({
        loadingDetailById: { ...state.loadingDetailById, [runId]: false },
        error: asNativeError(error).message,
      }))
      return undefined
    }
  },

  loadSummary: async (projectId) => {
    try {
      const summary = await runApi.inboxSummary(projectId)
      set((state) => ({
        summaryByProject: { ...state.summaryByProject, [projectId]: summary },
      }))
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  applyChange: async (event) => {
    const query = lastQueryByProject.get(event.projectId)
    const work: Promise<unknown>[] = [get().loadSummary(event.projectId)]
    if (query) work.push(get().loadRuns(query))
    // Only refetch detail the surface is actually showing; an event for an unopened Run must
    // not cost a round trip.
    if (get().detailById[event.runId]) work.push(get().loadDetail(event.runId))
    await Promise.all(work)
  },

  createRun: async (request) => {
    set({ error: undefined })
    try {
      const run = await runApi.create(request)
      const query = lastQueryByProject.get(request.projectId)
      if (query) await get().loadRuns(query)
      await get().loadSummary(request.projectId)
      return run
    } catch (error) {
      const native = asNativeError(error)
      set({ error: native.message })
      throw error
    }
  },

  cancelRun: async (runId, hard = false) => {
    set((state) => ({ pendingByRun: { ...state.pendingByRun, [runId]: 'cancelling' } }))
    try {
      const run = await runApi.cancel(runId, hard)
      await get().applyChange({
        projectId: run.projectId,
        runId: run.id,
        rootRunId: run.rootRunId,
        parentRunId: run.parentRunId,
        swarmId: run.swarmId,
        status: run.status,
        kind: 'cancelled',
        sequence: 0,
        updatedAt: run.updatedAt,
      })
    } catch (error) {
      set({ error: asNativeError(error).message })
    } finally {
      set((state) => ({ pendingByRun: { ...state.pendingByRun, [runId]: undefined } }))
    }
  },

  retryRun: async (runId) => {
    set((state) => ({ pendingByRun: { ...state.pendingByRun, [runId]: 'retrying' } }))
    try {
      const run = await runApi.retry(runId)
      const query = lastQueryByProject.get(run.projectId)
      if (query) await get().loadRuns(query)
      await get().loadSummary(run.projectId)
      return run
    } catch (error) {
      set({ error: asNativeError(error).message })
      throw error
    } finally {
      set((state) => ({ pendingByRun: { ...state.pendingByRun, [runId]: undefined } }))
    }
  },

  resolveApproval: async (approvalId, approved, note) => {
    try {
      const run = await runApi.resolveApproval(approvalId, approved, note)
      await get().applyChange({
        projectId: run.projectId,
        runId: run.id,
        rootRunId: run.rootRunId,
        parentRunId: run.parentRunId,
        swarmId: run.swarmId,
        status: run.status,
        kind: 'approval_resolved',
        sequence: 0,
        updatedAt: run.updatedAt,
      })
    } catch (error) {
      set({ error: asNativeError(error).message })
    }
  },

  clearError: () => set({ error: undefined }),
}))

/** Test-only reset of the module-level request bookkeeping. */
export function resetRunStoreVersions(): void {
  projectRequestVersions.clear()
  detailRequestVersions.clear()
  lastQueryByProject.clear()
}
