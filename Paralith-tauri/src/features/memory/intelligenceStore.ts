/**
 * Renderer state for the automated knowledge intelligence surfaces.
 *
 * A second store rather than more fields on `memoryStore`: Review, Timeline, Search, and Overview
 * are read-mostly surfaces over *derived* knowledge, and folding them into the editor's store would
 * make every keystroke in the document re-render four panes that have nothing to do with it.
 *
 * Loads are guarded by a monotonic `loadToken`, the same rule the Memory and Database Studio stores
 * use: switching Projects, or typing a new query while a slow one is in flight, must never let an
 * older response overwrite the newer state.
 */
import { create } from 'zustand'
import { asNativeError } from '../../native/commands'
import { intelligenceApi } from './api'
import type {
  ConflictResolution,
  EmbeddingHealth,
  KnowledgeHealthReport,
  ParsedQuery,
  ProjectUnderstanding,
  ReviewQueue,
  SearchResult,
  TimelineEntry,
  TimelineKind,
} from './intelligenceTypes'

/** How many timeline rows one page holds. */
const TIMELINE_PAGE = 150

export interface TimelineFilters {
  kinds: TimelineKind[]
  actor?: string
  memoryType?: string
  branchName?: string
  itemId?: string
  /** Relative window in days. `0` means everything. */
  windowDays: number
}

export const DEFAULT_TIMELINE_FILTERS: TimelineFilters = {
  kinds: [],
  windowDays: 0,
}

interface IntelligenceState {
  projectId?: string
  loadToken: number
  error: string

  understanding?: ProjectUnderstanding
  understandingLoading: boolean
  analyzing: boolean

  review?: ReviewQueue
  reviewLoading: boolean
  /** Candidate ids the user has ticked, for a bulk accept/reject. */
  selected: string[]
  /** Ids currently being written, so a row can show its own pending state. */
  deciding: string[]

  timeline: TimelineEntry[]
  timelineLoading: boolean
  timelineFilters: TimelineFilters
  /** Whether bookkeeping events (revisions, claim edits, declined candidates) are included.
   * Off by default: they are real, but they bury the events that changed what the project
   * believes. Held in the store so leaving Activity and returning keeps the reading. */
  timelineShowAll: boolean
  actors: string[]

  /** Whether the workspace-wide search overlay is open. Search is a capability reachable from
   * every surface rather than a mode you have to navigate to, so its open state lives here and
   * not in one pane's local state. */
  searchOpen: boolean
  query: string
  searching: boolean
  results: SearchResult[]
  parsed?: ParsedQuery
  searchElapsedMs: number
  searchTruncated: boolean
  semantic?: EmbeddingHealth

  health?: KnowledgeHealthReport

  load: (projectId: string) => Promise<void>
  refreshUnderstanding: () => Promise<void>
  analyzeProject: () => Promise<void>
  refreshReview: () => Promise<void>
  toggleSelected: (candidateId: string) => void
  selectGroup: (candidateIds: string[]) => void
  clearSelection: () => void
  decide: (action: 'accept' | 'reject', candidateIds?: string[]) => Promise<void>
  resolveConflict: (conflictId: string, resolution: ConflictResolution) => Promise<void>
  setTimelineFilters: (patch: Partial<TimelineFilters>) => Promise<void>
  setTimelineShowAll: (showAll: boolean) => void
  refreshTimeline: () => Promise<void>
  setQuery: (query: string) => void
  openSearch: (query?: string) => Promise<void>
  closeSearch: () => void
  runSearch: (query?: string) => Promise<void>
  refreshHealth: () => Promise<void>
  clearError: () => void
  reset: () => void
}

const EMPTY = {
  understanding: undefined,
  understandingLoading: false,
  analyzing: false,
  review: undefined,
  reviewLoading: false,
  selected: [] as string[],
  deciding: [] as string[],
  timeline: [] as TimelineEntry[],
  timelineLoading: false,
  timelineFilters: DEFAULT_TIMELINE_FILTERS,
  timelineShowAll: false,
  actors: [] as string[],
  searchOpen: false,
  query: '',
  searching: false,
  results: [] as SearchResult[],
  parsed: undefined,
  searchElapsedMs: 0,
  searchTruncated: false,
  semantic: undefined,
  health: undefined,
  error: '',
}

/** Resolve the `since` bound for a relative window, or `null` for "everything". */
function sinceFor(windowDays: number): string | null {
  if (windowDays <= 0) return null
  return new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString()
}

export const useIntelligenceStore = create<IntelligenceState>((set, get) => ({
  loadToken: 0,
  ...EMPTY,

  load: async (projectId) => {
    const token = get().loadToken + 1
    set({ ...EMPTY, projectId, loadToken: token })
    // Fired together: these four surfaces are tabs of one screen, and loading them serially would
    // make switching tabs feel like four separate page loads.
    const [understanding, review, actors, semantic, health] = await Promise.allSettled([
      intelligenceApi.understanding(projectId),
      intelligenceApi.reviewQueue(projectId),
      intelligenceApi.timelineActors(projectId),
      intelligenceApi.semanticHealth(),
      intelligenceApi.healthReport(projectId),
    ])
    if (get().loadToken !== token) return
    set({
      understanding: understanding.status === 'fulfilled' ? understanding.value : undefined,
      review: review.status === 'fulfilled' ? review.value : undefined,
      actors: actors.status === 'fulfilled' ? actors.value : [],
      semantic: semantic.status === 'fulfilled' ? semantic.value : undefined,
      health: health.status === 'fulfilled' ? health.value : undefined,
      // One failed surface reports itself; it must not blank the other three.
      error:
        review.status === 'rejected' ? asNativeError(review.reason).message : '',
    })
    await get().refreshTimeline()
  },

  refreshUnderstanding: async () => {
    const { projectId, loadToken } = get()
    if (!projectId) return
    set({ understandingLoading: true })
    try {
      const understanding = await intelligenceApi.understanding(projectId)
      if (get().loadToken !== loadToken) return
      set({ understanding, understandingLoading: false })
    } catch (caught) {
      set({ understandingLoading: false, error: asNativeError(caught).message })
    }
  },

  analyzeProject: async () => {
    const { projectId } = get()
    if (!projectId) return
    set({ analyzing: true })
    try {
      await intelligenceApi.analyzeProject(projectId)
    } catch (caught) {
      set({ error: asNativeError(caught).message })
    } finally {
      // The command only *queues* the walk. The surface stops showing a spinner immediately and
      // the result arrives through the knowledge-updated event — claiming otherwise would be a
      // progress indicator for work this window is not doing.
      set({ analyzing: false })
    }
  },

  refreshReview: async () => {
    const { projectId, loadToken } = get()
    if (!projectId) return
    set({ reviewLoading: true })
    try {
      const review = await intelligenceApi.reviewQueue(projectId)
      if (get().loadToken !== loadToken) return
      set({ review, reviewLoading: false })
    } catch (caught) {
      set({ reviewLoading: false, error: asNativeError(caught).message })
    }
  },

  toggleSelected: (candidateId) =>
    set((state) => ({
      selected: state.selected.includes(candidateId)
        ? state.selected.filter((id) => id !== candidateId)
        : [...state.selected, candidateId],
    })),

  selectGroup: (candidateIds) =>
    set((state) => {
      const everySelected = candidateIds.every((id) => state.selected.includes(id))
      return {
        selected: everySelected
          ? state.selected.filter((id) => !candidateIds.includes(id))
          : [...new Set([...state.selected, ...candidateIds])],
      }
    }),

  clearSelection: () => set({ selected: [] }),

  decide: async (action, candidateIds) => {
    const { projectId, selected } = get()
    const ids = candidateIds ?? selected
    if (!projectId || ids.length === 0) return
    set({ deciding: ids })
    try {
      await intelligenceApi.decideCandidates({ projectId, candidateIds: ids, action })
      set({ selected: [], deciding: [] })
      await Promise.all([get().refreshReview(), get().refreshHealth()])
    } catch (caught) {
      set({ deciding: [], error: asNativeError(caught).message })
    }
  },

  resolveConflict: async (conflictId, resolution) => {
    const { projectId } = get()
    if (!projectId) return
    set({ deciding: [conflictId] })
    try {
      await intelligenceApi.resolveConflict({ projectId, conflictId, resolution })
      set({ deciding: [] })
      await Promise.all([get().refreshReview(), get().refreshHealth()])
    } catch (caught) {
      set({ deciding: [], error: asNativeError(caught).message })
    }
  },

  setTimelineFilters: async (patch) => {
    set((state) => ({ timelineFilters: { ...state.timelineFilters, ...patch } }))
    await get().refreshTimeline()
  },

  setTimelineShowAll: (showAll) => set({ timelineShowAll: showAll }),

  refreshTimeline: async () => {
    const { projectId, timelineFilters, loadToken } = get()
    if (!projectId) return
    set({ timelineLoading: true })
    try {
      const timeline = await intelligenceApi.timeline({
        projectId,
        kinds: timelineFilters.kinds,
        actor: timelineFilters.actor ?? null,
        memoryType: timelineFilters.memoryType ?? null,
        branchName: timelineFilters.branchName ?? null,
        itemId: timelineFilters.itemId ?? null,
        since: sinceFor(timelineFilters.windowDays),
        limit: TIMELINE_PAGE,
      })
      if (get().loadToken !== loadToken) return
      set({ timeline, timelineLoading: false })
    } catch (caught) {
      set({ timelineLoading: false, error: asNativeError(caught).message })
    }
  },

  setQuery: (query) => set({ query }),

  /** Open the overlay, optionally running a query immediately — this is how a health count or a
   * saved example turns into results without the user retyping it. */
  openSearch: async (query) => {
    set({ searchOpen: true })
    if (query === undefined) return
    set({ query })
    await get().runSearch(query)
  },

  closeSearch: () => set({ searchOpen: false }),

  runSearch: async (query) => {
    const { projectId, loadToken } = get()
    if (!projectId) return
    const text = query ?? get().query
    set({ searching: true, query: text })
    try {
      const response = await intelligenceApi.search({ projectId, query: text, limit: 80 })
      if (get().loadToken !== loadToken) return
      set({
        results: response.results,
        parsed: response.parsed,
        searchElapsedMs: response.elapsedMs,
        searchTruncated: response.truncated,
        searching: false,
      })
    } catch (caught) {
      set({ searching: false, error: asNativeError(caught).message })
    }
  },

  refreshHealth: async () => {
    const { projectId, loadToken } = get()
    if (!projectId) return
    try {
      const health = await intelligenceApi.healthReport(projectId)
      if (get().loadToken !== loadToken) return
      set({ health })
    } catch (caught) {
      set({ error: asNativeError(caught).message })
    }
  },

  clearError: () => set({ error: '' }),

  reset: () => set((state) => ({ ...EMPTY, projectId: undefined, loadToken: state.loadToken + 1 })),
}))
