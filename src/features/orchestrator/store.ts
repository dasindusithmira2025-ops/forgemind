import { create } from 'zustand'
import { orchestratorApi } from './api'
import type {
  CapabilityDescriptor,
  CapabilityOutcome,
  OperatingMode,
  OrchestrationEvent,
  OrchestrationSession,
  OrchestrationSessionView,
  OrchestratorError,
} from './types'

interface OrchestratorState {
  /** Whether the invocation panel is open. */
  open: boolean
  /** Operating mode chosen for the next started session. */
  mode: OperatingMode
  /** The authoritative active session snapshot, loaded from the backend and reconciled via events. */
  view?: OrchestrationSessionView
  /** Capabilities available for the active session's scope. */
  capabilities: CapabilityDescriptor[]
  busy: boolean
  lastError?: OrchestratorError

  setOpen: (open: boolean) => void
  toggleOpen: () => void
  setMode: (mode: OperatingMode) => void
  clearError: () => void

  // Pure reducers — also invoked by the live event listeners. Exported behavior is covered by tests.
  applySession: (session: OrchestrationSession) => void
  applyEvent: (event: OrchestrationEvent) => void
  reset: () => void

  // Async actions against the backend (the single source of truth).
  start: (objective: string, projectId?: string | null, workspaceId?: string | null) => Promise<void>
  refresh: () => Promise<void>
  runCapability: (
    capabilityId: string,
    args: Record<string, unknown>,
    approved: boolean,
  ) => Promise<CapabilityOutcome | undefined>
  pause: () => Promise<void>
  resume: () => Promise<void>
  cancel: () => Promise<void>
}

function isOrchestratorError(value: unknown): value is OrchestratorError {
  return typeof value === 'object' && value !== null && 'code' in value && 'message' in value
}

function toError(value: unknown): OrchestratorError {
  if (isOrchestratorError(value)) return value
  return { code: 'internal_error', message: String(value), recoverable: true }
}

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  open: false,
  mode: 'assist',
  view: undefined,
  capabilities: [],
  busy: false,
  lastError: undefined,

  setOpen: (open) => set({ open }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setMode: (mode) => set({ mode }),
  clearError: () => set({ lastError: undefined }),

  applySession: (session) => {
    const view = get().view
    if (!view || view.session.id !== session.id) return
    // Guard against out-of-order delivery: never overwrite a newer snapshot with an older one.
    if (session.updatedAt < view.session.updatedAt) return
    set({ view: { ...view, session } })
  },

  applyEvent: (event) => {
    const view = get().view
    if (!view || view.session.id !== event.sessionId) return
    // Dedupe by per-session sequence (events can arrive twice or out of order).
    if (view.events.some((existing) => existing.sequence === event.sequence)) return
    const events = [...view.events, event].sort((a, b) => a.sequence - b.sequence)
    set({ view: { ...view, events } })
  },

  reset: () => set({ view: undefined, capabilities: [], lastError: undefined }),

  start: async (objective, projectId, workspaceId) => {
    if (!objective.trim() || get().busy) return
    set({ busy: true, lastError: undefined })
    try {
      const view = await orchestratorApi.createSession({
        objective,
        originatingSurface: 'invocation_bar',
        operatingMode: get().mode,
        projectId: projectId ?? null,
        workspaceId: workspaceId ?? null,
      })
      const capabilities = await orchestratorApi.listCapabilities(view.session.id)
      set({ view, capabilities, open: true })
    } catch (error) {
      set({ lastError: toError(error) })
    } finally {
      set({ busy: false })
    }
  },

  refresh: async () => {
    const view = get().view
    if (!view) return
    try {
      const [next, capabilities] = await Promise.all([
        orchestratorApi.getSession(view.session.id),
        orchestratorApi.listCapabilities(view.session.id),
      ])
      set({ view: next, capabilities })
    } catch (error) {
      set({ lastError: toError(error) })
    }
  },

  runCapability: async (capabilityId, args, approved) => {
    const view = get().view
    if (!view || get().busy) return undefined
    set({ busy: true, lastError: undefined })
    try {
      const outcome = await orchestratorApi.executeCapability({
        sessionId: view.session.id,
        capabilityId,
        arguments: args,
        approved,
      })
      // The backend is authoritative: reload the session so executions and state reflect reality.
      await get().refresh()
      if (outcome.error) set({ lastError: outcome.error })
      return outcome
    } catch (error) {
      set({ lastError: toError(error) })
      return undefined
    } finally {
      set({ busy: false })
    }
  },

  pause: async () => {
    const view = get().view
    if (!view) return
    try {
      const session = await orchestratorApi.pauseSession(view.session.id)
      get().applySession(session)
    } catch (error) {
      set({ lastError: toError(error) })
    }
  },

  resume: async () => {
    const view = get().view
    if (!view) return
    try {
      const session = await orchestratorApi.resumeSession(view.session.id)
      get().applySession(session)
    } catch (error) {
      set({ lastError: toError(error) })
    }
  },

  cancel: async () => {
    const view = get().view
    if (!view) return
    try {
      const session = await orchestratorApi.cancelSession(view.session.id)
      get().applySession(session)
    } catch (error) {
      set({ lastError: toError(error) })
    }
  },
}))
