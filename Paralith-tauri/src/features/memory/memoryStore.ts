/**
 * Context Fabric renderer state.
 *
 * The store owns *view* state only: which memory is open, what the draft in the editor says, and
 * the last responses the backend returned. It never derives knowledge itself — slugs, links,
 * backlinks, quality and search ranking are all computed in Rust, because they must be identical
 * for an agent reading through the command boundary and for a human reading this UI.
 *
 * Loads are guarded by a monotonic `loadToken`. Switching memories quickly, or switching Projects,
 * must not let a slow in-flight response overwrite the newer selection — the same rule the
 * Database Studio store uses.
 */
import { create } from 'zustand'
import { asNativeError } from '../../native/commands'
import { memoryApi } from './api'
import type {
  ClaimStatus,
  ContextPack,
  GraphNodeKind,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeJob,
  KnowledgeUpdatedEvent,
  MemoryConnections,
  MemoryDetail,
  MemoryQuality,
  MemoryRevisionSummary,
  MemorySearchHit,
  MemorySummary,
} from './memoryTypes'

/**
 * Which surface Brain is showing.
 *
 * Three, not seven. The previous set — Overview, Knowledge, Graph, Decisions, Activity, Review,
 * Context — asked the user to know the shape of the knowledge system before they could ask it
 * anything. The questions a developer actually arrives with are "what does this project look
 * like", "let me ask something", and "let me look around", so those are the three.
 *
 * The other four did not disappear; they stopped being top-level. Knowledge, Graph, Decisions and
 * Activity became ways of looking around (see `ExploreMode`), Review became contextual — it exists
 * only while Brain genuinely needs a person — and Context moved to the agent run that received it,
 * which is the only place a compiled context is worth reading.
 */
export type BrainView = 'home' | 'ask' | 'explore'

/**
 * Ways of looking around. `history` is the old Timeline and Activity read as one question, and
 * `map` is the graph, which is a way to answer "how is this connected" rather than a place to
 * live.
 */
export type ExploreMode = 'all' | 'systems' | 'decisions' | 'history' | 'map'

/**
 * Anywhere Brain can be told to go.
 *
 * One destination union rather than two navigation actions: every call site that wants the map or
 * the knowledge list means "take me there", and making it first select Explore and then select a
 * mode would be two calls that must not be interleaved with anything.
 */
export type BrainDestination = BrainView | ExploreMode

const EXPLORE_MODES: ExploreMode[] = ['all', 'systems', 'decisions', 'history', 'map']

export function isExploreMode(destination: BrainDestination): destination is ExploreMode {
  return (EXPLORE_MODES as BrainDestination[]).includes(destination)
}

/** Which half of the Activity surface is showing: knowledge change history, or the job queue. */
export type ActivityTab = 'changes' | 'automation'

/** User-adjustable graph scope. Held in the store rather than the component so switching to the
 * document and back does not silently reset the view the user set up. */
export interface GraphControls {
  /** `undefined` focus means the project-wide graph. */
  focusItemId?: string
  depth: number
  includeKinds: GraphNodeKind[]
  minConfidence: number
}

export const DEFAULT_GRAPH_CONTROLS: GraphControls = {
  depth: 1,
  includeKinds: [],
  minConfidence: 0,
}

/** Which right-hand inspector section is expanded. Progressive disclosure: one at a time. */
export type InspectorSection = 'properties' | 'connections' | 'claims' | 'evidence' | 'history'

export interface MemoryDraft {
  title: string
  body: string
  memoryType: string
}

interface MemoryState {
  projectId?: string
  loadToken: number

  listLoading: boolean
  items: MemorySummary[]
  /** Populated only while a query is active; otherwise the list above is what the sidebar shows. */
  query: string
  searching: boolean
  results: MemorySearchHit[]

  activeId?: string
  detailLoading: boolean
  detail?: MemoryDetail
  /** Unsaved editor content for the memory currently open. `undefined` means the editor matches
   * the loaded revision. */
  draft?: MemoryDraft
  /** Unsaved drafts for memories that are not currently open, keyed by item id (`__new__` for a
   * memory that has never been saved).
   *
   * Without this, clicking another memory in the list would silently throw away whatever the user
   * had typed. Drafts survive navigation and are cleared only by an explicit save or discard. */
  drafts: Record<string, MemoryDraft>
  saving: boolean

  connections?: MemoryConnections
  history: MemoryRevisionSummary[]
  /** Body of the historical revision being previewed, keyed by revision id. */
  revisionPreview?: { revisionId: string; body: string }

  view: BrainView
  exploreMode: ExploreMode
  /** Whether the focused review flow is open.
   *
   * Review is not a destination. It exists only while Brain has something it genuinely cannot
   * decide alone, so it is a state the workspace can be *in* rather than a tab that sits there
   * saying zero. Any navigation closes it. */
  reviewOpen: boolean
  /** Which History segment is open. Held in the store so leaving History and coming back does
   * not silently drop the user on the other half. */
  activityTab: ActivityTab
  /** What the Context surface last compiled, plus the inputs it used. Held in the store so
   * switching views does not discard a pack the user is reading. */
  contextTask: string
  contextBudget: string
  contextPack?: ContextPack
  contextLoading: boolean
  graph?: KnowledgeGraph
  graphLoading: boolean
  graphControls: GraphControls
  health?: KnowledgeHealth
  /** The automatic lifecycle's job queue for this Project, newest first. */
  jobs: KnowledgeJob[]
  jobsLoading: boolean

  relationTypes: string[]
  sourceTypes: string[]
  error: string

  load: (projectId: string) => Promise<void>
  setQuery: (query: string) => Promise<void>
  open: (itemId: string) => Promise<void>
  closeActive: () => void
  startNew: () => void
  editDraft: (patch: Partial<MemoryDraft>) => void
  discardDraft: () => void
  save: () => Promise<void>
  setQuality: (quality: MemoryQuality) => Promise<void>
  togglePinned: () => Promise<void>
  archive: () => Promise<void>
  saveClaim: (statement: string, status: ClaimStatus, claimId?: string) => Promise<void>
  deleteClaim: (claimId: string) => Promise<void>
  attachSource: (input: {
    sourceType: string
    filePath?: string
    uri?: string
    excerpt?: string
    claimId?: string
  }) => Promise<void>
  saveRelation: (toItemId: string, relationType: string) => Promise<void>
  deleteRelation: (relationId: string) => Promise<void>
  setView: (destination: BrainDestination) => Promise<void>
  openReview: () => void
  closeReview: () => void
  setActivityTab: (tab: ActivityTab) => Promise<void>
  setContextTask: (task: string) => void
  setContextBudget: (budget: string) => void
  compileContext: () => Promise<void>
  setGraphControls: (patch: Partial<GraphControls>) => Promise<void>
  refreshGraph: () => Promise<void>
  refreshJobs: () => Promise<void>
  cancelJob: (jobId: string) => Promise<void>
  applyKnowledgeUpdate: (event: KnowledgeUpdatedEvent) => void
  previewRevision: (revisionId: string) => Promise<void>
  clearRevisionPreview: () => void
  clearError: () => void
  reset: () => void
}

const EMPTY = {
  listLoading: false,
  items: [] as MemorySummary[],
  query: '',
  searching: false,
  results: [] as MemorySearchHit[],
  activeId: undefined,
  detailLoading: false,
  detail: undefined,
  draft: undefined,
  drafts: {} as Record<string, MemoryDraft>,
  saving: false,
  connections: undefined,
  history: [] as MemoryRevisionSummary[],
  revisionPreview: undefined,
  view: 'home' as BrainView,
  exploreMode: 'all' as ExploreMode,
  reviewOpen: false,
  activityTab: 'changes' as ActivityTab,
  contextTask: '',
  contextBudget: 'balanced',
  contextPack: undefined,
  contextLoading: false,
  graph: undefined,
  graphLoading: false,
  graphControls: DEFAULT_GRAPH_CONTROLS,
  health: undefined,
  jobs: [] as KnowledgeJob[],
  jobsLoading: false,
  error: '',
}

/** A draft for a memory that has not been created yet. */
export const NEW_MEMORY_DRAFT: MemoryDraft = { title: '', body: '', memoryType: 'note' }

/** Draft key for a memory that has never been saved. */
export const NEW_DRAFT_KEY = '__new__'

/**
 * Park the draft the editor is holding so navigating away cannot lose it, and return the updated
 * map. An empty new-memory draft is dropped rather than parked — reopening "New" should give a
 * clean sheet, not resurrect a blank one.
 */
function stashDraft(
  drafts: Record<string, MemoryDraft>,
  key: string | undefined,
  draft: MemoryDraft | undefined,
): Record<string, MemoryDraft> {
  if (!draft) return drafts
  const owner = key ?? NEW_DRAFT_KEY
  if (owner === NEW_DRAFT_KEY && !draft.title.trim() && !draft.body.trim()) {
    const { [owner]: _dropped, ...rest } = drafts
    return rest
  }
  return { ...drafts, [owner]: draft }
}

/** Forget the parked draft for one memory, after it was saved or explicitly discarded. */
function clearDraft(
  drafts: Record<string, MemoryDraft>,
  key: string | undefined,
): Record<string, MemoryDraft> {
  const { [key ?? NEW_DRAFT_KEY]: _removed, ...rest } = drafts
  return rest
}

/**
 * Whether a mutation's response is still relevant when it lands.
 *
 * Every mutation here reads the open memory, awaits the backend, then writes the result back. If
 * the user opened another memory (or switched Project) while that was in flight, applying the
 * response would overwrite the inspector with a different memory's claims, evidence, or relations.
 * The write is safe on the backend either way — this only decides whether the UI adopts it.
 */
function stillViewing(state: MemoryState, token: number, itemId: string): boolean {
  return state.loadToken === token && state.activeId === itemId
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  ...EMPTY,
  loadToken: 0,
  relationTypes: [],
  sourceTypes: [],

  async load(projectId) {
    // A Project switch invalidates every in-flight response and every cached row.
    const token = get().loadToken + 1
    set({ ...EMPTY, projectId, loadToken: token, listLoading: true })
    try {
      const [items, vocabulary] = await Promise.all([
        memoryApi.list(projectId),
        get().relationTypes.length ? Promise.resolve(null) : memoryApi.vocabulary(),
      ])
      if (get().loadToken !== token) return
      set({
        items,
        listLoading: false,
        ...(vocabulary ? { relationTypes: vocabulary[0], sourceTypes: vocabulary[1] } : {}),
      })
    } catch (caught) {
      if (get().loadToken !== token) return
      set({ listLoading: false, error: asNativeError(caught).message })
    }
  },

  async setQuery(query) {
    const { projectId } = get()
    set({ query })
    if (!projectId) return
    if (!query.trim()) {
      set({ results: [], searching: false })
      return
    }
    const token = get().loadToken
    set({ searching: true })
    try {
      const results = await memoryApi.search({ projectId, query })
      // Discard a response that arrived after the query moved on or the Project changed.
      if (get().loadToken !== token || get().query !== query) return
      set({ results, searching: false })
    } catch (caught) {
      if (get().loadToken !== token) return
      set({ searching: false, error: asNativeError(caught).message })
    }
  },

  async open(itemId) {
    const state = get()
    const { projectId } = state
    if (!projectId) return
    if (state.activeId === itemId && state.detail) return
    const token = state.loadToken
    // Park whatever the editor is holding under the memory it belongs to, and restore any draft
    // previously parked for the one being opened.
    const drafts = stashDraft(state.drafts, state.activeId, state.draft)
    set({
      activeId: itemId,
      detailLoading: true,
      drafts,
      draft: drafts[itemId],
      revisionPreview: undefined,
    })
    try {
      // The document, its neighbourhood, and its history are three reads so that opening a memory
      // stays one small query and the inspector fills in behind it.
      const [detail, connections, history] = await Promise.all([
        memoryApi.get(projectId, itemId),
        memoryApi.connections(projectId, itemId),
        memoryApi.history(projectId, itemId),
      ])
      if (get().loadToken !== token || get().activeId !== itemId) return
      set({ detail, connections, history, detailLoading: false })
    } catch (caught) {
      if (get().loadToken !== token || get().activeId !== itemId) return
      set({ detailLoading: false, error: asNativeError(caught).message })
    }
  },

  closeActive() {
    const state = get()
    set({
      activeId: undefined,
      detail: undefined,
      drafts: stashDraft(state.drafts, state.activeId, state.draft),
      draft: undefined,
      connections: undefined,
      history: [],
      revisionPreview: undefined,
    })
  },

  startNew() {
    const state = get()
    const drafts = stashDraft(state.drafts, state.activeId, state.draft)
    set({
      activeId: undefined,
      detail: undefined,
      connections: undefined,
      history: [],
      revisionPreview: undefined,
      drafts,
      // Resume an unfinished new memory rather than starting over on top of it.
      draft: drafts[NEW_DRAFT_KEY] ?? { ...NEW_MEMORY_DRAFT },
    })
  },

  editDraft(patch) {
    const { draft, detail } = get()
    const base: MemoryDraft = draft ??
      (detail
        ? { title: detail.title, body: detail.body, memoryType: detail.memoryType }
        : { ...NEW_MEMORY_DRAFT })
    set({ draft: { ...base, ...patch } })
  },

  discardDraft() {
    const state = get()
    set({ draft: undefined, drafts: clearDraft(state.drafts, state.activeId) })
  },

  async save() {
    const { projectId, draft, activeId, loadToken: token } = get()
    if (!projectId || !draft) return
    set({ saving: true, error: '' })
    try {
      const saved = await memoryApi.save({
        projectId,
        itemId: activeId ?? null,
        title: draft.title,
        body: draft.body,
        memoryType: draft.memoryType,
      })
      const [items, connections, history] = await Promise.all([
        memoryApi.list(projectId),
        memoryApi.connections(projectId, saved.id),
        memoryApi.history(projectId, saved.id),
      ])
      // The Project changed while the write was in flight: the memory is saved, but none of this
      // response belongs to what the user is looking at now.
      if (get().loadToken !== token) return

      // The draft is now a revision, so its parked copy must go. `activeId` is undefined when this
      // save created the memory, in which case the slot to clear is `__new__` — clearing both
      // unconditionally would discard an unrelated unfinished new memory.
      const drafts = clearDraft(get().drafts, activeId)

      if (get().activeId !== activeId) {
        // The user opened another memory while this one was saving. Take the refreshed list and
        // retire the saved draft, but do not drag them back to the memory they left — and do not
        // touch `draft`, which now belongs to whatever they opened.
        set({ items, drafts, saving: false })
      } else {
        set({
          detail: saved,
          activeId: saved.id,
          items,
          connections,
          history,
          draft: undefined,
          drafts,
          saving: false,
        })
      }
      // A save changes titles and bodies, so an open search result set is now stale.
      if (get().query.trim()) void get().setQuery(get().query)
    } catch (caught) {
      if (get().loadToken !== token) return
      // The draft is deliberately kept: a rejected save (a secret, a missing title) must not cost
      // the user their text.
      set({ saving: false, error: asNativeError(caught).message })
    }
  },

  async setQuality(quality) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const detail = await memoryApi.setQuality({ projectId, itemId: activeId, quality })
      if (!stillViewing(get(), token, activeId)) return
      set({ detail, items: replaceSummary(get().items, detail) })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async togglePinned() {
    const { projectId, activeId, detail, loadToken: token } = get()
    if (!projectId || !activeId || !detail) return
    try {
      await memoryApi.setPinned(projectId, activeId, !detail.pinned)
      const items = await memoryApi.list(projectId)
      if (get().loadToken !== token) return
      // The list ordering changed for everyone, so it is applied either way; the open document is
      // only touched if it is still the one that was pinned.
      set(
        stillViewing(get(), token, activeId)
          ? { items, detail: { ...detail, pinned: !detail.pinned } }
          : { items },
      )
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async archive() {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      await memoryApi.archive(projectId, activeId)
      const items = await memoryApi.list(projectId)
      if (get().loadToken !== token) return
      const closing = get().activeId === activeId
      // An archived memory can have no pending edits left to restore. The live draft is dropped
      // first: `closeActive` parks whatever the editor still holds, which would otherwise put the
      // draft straight back into the map this line just cleared it from.
      set({
        items,
        drafts: clearDraft(get().drafts, activeId),
        ...(closing ? { draft: undefined } : {}),
      })
      if (closing) get().closeActive()
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async saveClaim(statement, status, claimId) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const claims = await memoryApi.saveClaim({
        projectId,
        itemId: activeId,
        claimId: claimId ?? null,
        statement,
        status,
      })
      const current = get()
      if (!stillViewing(current, token, activeId) || !current.detail) return
      set({ detail: { ...current.detail, claims } })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async deleteClaim(claimId) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const claims = await memoryApi.deleteClaim(projectId, activeId, claimId)
      const current = get()
      if (!stillViewing(current, token, activeId) || !current.detail) return
      set({ detail: { ...current.detail, claims } })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async attachSource(input) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const detail = await memoryApi.attachSource({
        projectId,
        itemId: activeId,
        claimId: input.claimId ?? null,
        sourceType: input.sourceType,
        filePath: input.filePath ?? null,
        uri: input.uri ?? null,
        excerpt: input.excerpt ?? null,
      })
      if (!stillViewing(get(), token, activeId)) return
      set({ detail })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async saveRelation(toItemId, relationType) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const relations = await memoryApi.saveRelation({
        projectId,
        fromItemId: activeId,
        toItemId,
        relationType,
      })
      const current = get()
      if (!stillViewing(current, token, activeId) || !current.detail) return
      set({ detail: { ...current.detail, relations } })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  async deleteRelation(relationId) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const relations = await memoryApi.deleteRelation(projectId, activeId, relationId)
      const current = get()
      if (!stillViewing(current, token, activeId) || !current.detail) return
      set({ detail: { ...current.detail, relations } })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  /**
   * Navigate. Accepts a primary view or an Explore mode directly, so "show me the map" is one
   * call rather than a select-then-select the caller has to sequence correctly.
   */
  async setView(destination) {
    const explore = isExploreMode(destination)
    const view: BrainView = explore ? 'explore' : destination
    const exploreMode = explore ? destination : get().exploreMode
    const current = get()
    if (current.view === view && current.exploreMode === exploreMode && !current.reviewOpen) return
    // Any deliberate navigation leaves the review flow. Review is something Brain asks *of* the
    // user; carrying it under a different surface would make it a mode after all.
    set({ view, exploreMode, reviewOpen: false })
    // Home draws its architecture snapshot from the same graph payload, but it fetches that itself
    // and only when it has none — returning Home must not cost a graph query every time.
    if (view === 'explore' && exploreMode === 'map') await get().refreshGraph()
    if (view === 'explore' && exploreMode === 'history') await get().refreshJobs()
  },

  openReview: () => set({ reviewOpen: true }),

  closeReview: () => set({ reviewOpen: false }),

  async setActivityTab(tab) {
    if (get().activityTab === tab) return
    set({ activityTab: tab })
    if (tab === 'automation') await get().refreshJobs()
  },

  /** Reload the job queue. Cheap and bounded; called on open and after a lifecycle event. */
  async refreshJobs() {
    const { projectId } = get()
    if (!projectId) return
    const token = get().loadToken
    set({ jobsLoading: true })
    try {
      const jobs = await memoryApi.jobs(projectId)
      if (get().loadToken !== token) return
      set({ jobs, jobsLoading: false })
    } catch (caught) {
      if (get().loadToken !== token) return
      set({ jobsLoading: false, error: asNativeError(caught).message })
    }
  },

  /**
   * Cancel queued knowledge work.
   *
   * The backend refuses a job that already started, and the refusal is reported rather than
   * swallowed: a control that silently does nothing is worse than one that says why it could not.
   */
  async cancelJob(jobId) {
    const { projectId } = get()
    if (!projectId) return
    try {
      const cancelled = await memoryApi.cancelJob(projectId, jobId)
      if (!cancelled) {
        set({ error: 'That job had already started, so it ran to completion.' })
      }
      await get().refreshJobs()
    } catch (caught) {
      set({ error: asNativeError(caught).message })
    }
  },

  /**
   * Adopt a lifecycle event.
   *
   * Events are broadcast to every window, so the Project guard is the first thing checked — a
   * detached Workspace window must not refresh its knowledge because a different Project's
   * analysis finished. Rows the event names are re-read rather than patched in place, because the
   * event carries ids, not state: the backend stays the only thing that decides what a memory says.
   */
  applyKnowledgeUpdate(event) {
    const { projectId, activeId, view, exploreMode, loadToken: token } = get()
    if (!projectId || event.projectId !== projectId) return
    if (view === 'explore' && exploreMode === 'history') void get().refreshJobs()
    if (event.changedItemIds.length === 0) return
    void (async () => {
      try {
        const items = await memoryApi.list(projectId)
        if (get().loadToken !== token) return
        set({ items })
        // Only re-read the open document when it is one of the memories that actually changed —
        // a staleness sweep must not reload a document the user is editing for no reason.
        if (!activeId || !event.changedItemIds.includes(activeId)) return
        const detail = await memoryApi.get(projectId, activeId)
        if (!stillViewing(get(), token, activeId)) return
        set({ detail })
      } catch (caught) {
        if (get().loadToken === token) set({ error: asNativeError(caught).message })
      }
    })()
  },

  setContextTask(task) {
    set({ contextTask: task })
  },

  setContextBudget(budget) {
    set({ contextBudget: budget })
  },

  /**
   * Compile a pack for the task the user typed.
   *
   * The memory currently open is passed as an explicit focus, so "what would an agent see if it
   * started from here" is one click rather than a re-typed query. Guarded by `loadToken` like
   * every other read.
   */
  async compileContext() {
    const { projectId, contextTask, contextBudget, activeId, detail } = get()
    if (!projectId) return
    const token = get().loadToken
    set({ contextLoading: true })
    try {
      const contextPack = await memoryApi.compileContext({
        projectId,
        task: contextTask,
        budget: contextBudget,
        focusItemIds: activeId ? [activeId] : [],
        // The memory's own mirror path is a real file the pack should weigh, when it has one.
        focusFiles: detail?.filePath ? [detail.filePath] : [],
      })
      if (get().loadToken !== token) return
      set({ contextPack, contextLoading: false })
    } catch (caught) {
      if (get().loadToken !== token) return
      set({ contextLoading: false, error: asNativeError(caught).message })
    }
  },

  async setGraphControls(patch) {
    set({ graphControls: { ...get().graphControls, ...patch } })
    await get().refreshGraph()
  },

  /**
   * Fetch the graph and the health counts for the current controls.
   *
   * Guarded by `loadToken` like every other read: a slow graph for one Project must not paint
   * over a newer one. The focus defaults to the open memory, so selecting a memory in the rail
   * and opening the Map lands on its neighbourhood rather than the whole project.
   *
   * Only Home and Explore → Map draw from this payload, so nothing else pays for the query.
   */
  async refreshGraph() {
    const { projectId, graphControls, activeId, view, exploreMode } = get()
    const drawsGraph = view === 'home' || (view === 'explore' && exploreMode === 'map')
    if (!projectId || !drawsGraph) return
    const token = get().loadToken
    set({ graphLoading: true })
    try {
      const [graph, health] = await Promise.all([
        memoryApi.graph({
          projectId,
          focusItemId: graphControls.focusItemId ?? activeId ?? null,
          depth: graphControls.depth,
          includeKinds: graphControls.includeKinds,
          minConfidence: graphControls.minConfidence || null,
        }),
        memoryApi.health(projectId),
      ])
      if (get().loadToken !== token) return
      set({ graph, health, graphLoading: false })
    } catch (caught) {
      if (get().loadToken !== token) return
      set({ graphLoading: false, error: asNativeError(caught).message })
    }
  },

  async previewRevision(revisionId) {
    const { projectId, activeId, loadToken: token } = get()
    if (!projectId || !activeId) return
    try {
      const body = await memoryApi.revisionBody(projectId, activeId, revisionId)
      if (!stillViewing(get(), token, activeId)) return
      set({ revisionPreview: { revisionId, body } })
    } catch (caught) {
      if (get().loadToken === token) set({ error: asNativeError(caught).message })
    }
  },

  clearRevisionPreview() {
    set({ revisionPreview: undefined })
  },

  clearError() {
    set({ error: '' })
  },

  reset() {
    set({ ...EMPTY, projectId: undefined, loadToken: get().loadToken + 1 })
  },
}))

function replaceSummary(items: MemorySummary[], updated: MemorySummary): MemorySummary[] {
  return items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
}

/** True when the editor holds changes that differ from the loaded revision. */
export function hasUnsavedChanges(state: {
  draft?: MemoryDraft
  detail?: MemoryDetail
}): boolean {
  if (!state.draft) return false
  if (!state.detail) return Boolean(state.draft.title.trim() || state.draft.body.trim())
  return (
    state.draft.title !== state.detail.title ||
    state.draft.body !== state.detail.body ||
    state.draft.memoryType !== state.detail.memoryType
  )
}

/** Rows the list should render: search results while a query is active, otherwise everything. */
export function visibleMemories(state: {
  query: string
  results: MemorySearchHit[]
  items: MemorySummary[]
}): MemorySummary[] {
  return state.query.trim() ? state.results : state.items
}
