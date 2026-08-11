import { create } from 'zustand'
import { asDatabaseError, databaseApi } from './api'
import type {
  CreateDatabaseDraftBase,
  DatabaseCanvasFilters,
  DatabaseDesign,
  DatabaseDesignBundle,
  DatabaseDesignOperationKind,
  DatabaseGraphPage,
  DatabaseIssue,
  DatabaseLayer,
  DatabaseLoadState,
  DatabaseMigration,
  DatabaseObjectDetail,
  DatabaseSelection,
  DatabaseSource,
  DesignConcurrencyToken,
  SemanticId,
} from './databaseTypes'
import { emptyDatabaseSelection, isDatabaseStaleRevisionError } from './databaseTypes'
import { applyDesignOperation, type ProposedGraph } from './databaseDesignOperations'

interface DatabaseState {
  projectId?: string
  loadToken: number

  sourcesLoad: DatabaseLoadState
  sources: DatabaseSource[]
  activeSourceId?: string

  activeLayer: DatabaseLayer
  schemaLoad: DatabaseLoadState
  /** `undefined` = not fetched yet; the graph page's own emptiness is a genuinely-empty schema. */
  schemaPage?: DatabaseGraphPage

  objectDetailLoad: Record<SemanticId, DatabaseLoadState>
  objectDetails: Record<SemanticId, DatabaseObjectDetail>

  migrationsLoad: DatabaseLoadState
  migrations: DatabaseMigration[]

  issuesLoad: DatabaseLoadState
  issues: DatabaseIssue[]

  designsLoad: DatabaseLoadState
  designs: DatabaseDesign[]
  activeDesignId?: string
  activeBundle?: DatabaseDesignBundle
  activeToken?: DesignConcurrencyToken
  designError?: string
  /** Non-`undefined` while an operation is optimistically applied but not yet confirmed. */
  pendingOperationId?: string
  /** The optimistic Proposed graph overlay (UI-SPEC.md §5.1-5.2) — confirmed state lives in `activeBundle`. */
  proposedGraph: ProposedGraph
  staleRevisionNotice?: { designId: string }

  /** Ephemeral session-only selection/filter/pin state — never backend-persisted (UI-SPEC.md §7). */
  selection: DatabaseSelection
  filters: DatabaseCanvasFilters
  pinnedPositions: Record<SemanticId, { x: number; y: number }>

  reset: () => void
  loadProject: (projectId: string) => Promise<void>
  discoverSources: (force?: boolean) => Promise<void>
  selectSource: (sourceId: string, layer?: DatabaseLayer) => void
  loadSchema: () => Promise<void>
  loadObjectDetail: (objectId: SemanticId) => Promise<void>
  loadMigrations: () => Promise<void>
  loadIssues: () => Promise<void>
  loadDesigns: () => Promise<void>
  createDraft: (name: string, base: CreateDatabaseDraftBase) => Promise<void>
  /**
   * Optimistic apply, authoritative confirm (UI-SPEC.md §5.2). The operation is applied to
   * `proposedGraph` immediately, then sent to the backend with the current concurrency token. A
   * `DATABASE_DESIGN_STALE_REVISION` response rolls the optimistic change back and surfaces
   * `staleRevisionNotice` for the "design changed elsewhere / Reload design" UI; it never silently
   * rebases or drops the edit.
   */
  applyOperation: (operation: DatabaseDesignOperationKind) => Promise<void>
  dismissStaleRevisionNotice: () => void
  selectObjects: (ids: SemanticId[], options?: { additive?: boolean; focusedId?: SemanticId }) => void
  clearSelection: () => void
  setSearch: (search: string) => void
  setHideUnrelated: (value: boolean) => void
  setPinnedPosition: (id: SemanticId, position: { x: number; y: number } | undefined) => void
}

const EMPTY_LOAD: DatabaseLoadState = { status: 'idle' }

export const useDatabaseStore = create<DatabaseState>((set, get) => ({
  loadToken: 0,
  sourcesLoad: EMPTY_LOAD,
  sources: [],
  activeLayer: 'declared',
  schemaLoad: EMPTY_LOAD,
  objectDetailLoad: {},
  objectDetails: {},
  migrationsLoad: EMPTY_LOAD,
  migrations: [],
  issuesLoad: EMPTY_LOAD,
  issues: [],
  designsLoad: EMPTY_LOAD,
  designs: [],
  proposedGraph: { tables: {}, columns: {} },
  selection: emptyDatabaseSelection(),
  filters: { hideUnrelated: false },
  pinnedPositions: {},

  reset: () => set({
    projectId: undefined,
    sourcesLoad: EMPTY_LOAD,
    sources: [],
    activeSourceId: undefined,
    activeLayer: 'declared',
    schemaLoad: EMPTY_LOAD,
    schemaPage: undefined,
    objectDetailLoad: {},
    objectDetails: {},
    migrationsLoad: EMPTY_LOAD,
    migrations: [],
    issuesLoad: EMPTY_LOAD,
    issues: [],
    designsLoad: EMPTY_LOAD,
    designs: [],
    activeDesignId: undefined,
    activeBundle: undefined,
    activeToken: undefined,
    designError: undefined,
    pendingOperationId: undefined,
    proposedGraph: { tables: {}, columns: {} },
    staleRevisionNotice: undefined,
    selection: emptyDatabaseSelection(),
    filters: { hideUnrelated: false },
    pinnedPositions: {},
  }),

  loadProject: async (projectId) => {
    if (get().projectId !== projectId) get().reset()
    const token = get().loadToken + 1
    set({ projectId, loadToken: token })
    await get().discoverSources()
  },

  discoverSources: async (force = false) => {
    const projectId = get().projectId
    if (!projectId) return
    const token = get().loadToken
    set({ sourcesLoad: { status: 'loading' } })
    try {
      const response = await databaseApi.discoverSources({ projectId, force })
      if (get().loadToken !== token) return
      set({
        sourcesLoad: { status: 'ready' },
        sources: response.sources,
        activeSourceId: get().activeSourceId ?? response.sources[0]?.id,
      })
    } catch (caught) {
      if (get().loadToken !== token) return
      const error = asDatabaseError(caught)
      set({ sourcesLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  selectSource: (sourceId, layer) => {
    set({ activeSourceId: sourceId, activeLayer: layer ?? get().activeLayer, schemaPage: undefined, schemaLoad: EMPTY_LOAD, selection: emptyDatabaseSelection() })
  },

  loadSchema: async () => {
    const { projectId, activeSourceId, activeLayer, loadToken } = get()
    if (!projectId || !activeSourceId) return
    set({ schemaLoad: { status: 'loading' } })
    try {
      const page = await databaseApi.getSchema({ projectId, sourceId: activeSourceId, layer: activeLayer, lod: 0 })
      if (get().loadToken !== loadToken || get().activeSourceId !== activeSourceId) return
      set({ schemaLoad: { status: 'ready' }, schemaPage: page })
    } catch (caught) {
      if (get().loadToken !== loadToken || get().activeSourceId !== activeSourceId) return
      const error = asDatabaseError(caught)
      set({ schemaLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  loadObjectDetail: async (objectId) => {
    const { projectId, activeSourceId, objectDetails, objectDetailLoad } = get()
    if (!projectId || !activeSourceId || objectDetails[objectId] || objectDetailLoad[objectId]?.status === 'loading') return
    set({ objectDetailLoad: { ...get().objectDetailLoad, [objectId]: { status: 'loading' } } })
    try {
      const detail = await databaseApi.getObject({ projectId, sourceId: activeSourceId, objectId })
      if (get().projectId !== projectId) return
      set({
        objectDetails: { ...get().objectDetails, [objectId]: detail },
        objectDetailLoad: { ...get().objectDetailLoad, [objectId]: { status: 'ready' } },
      })
    } catch (caught) {
      if (get().projectId !== projectId) return
      const error = asDatabaseError(caught)
      set({ objectDetailLoad: { ...get().objectDetailLoad, [objectId]: { status: 'error', errorCode: error.code, errorMessage: error.message } } })
    }
  },

  loadMigrations: async () => {
    const { projectId, activeSourceId } = get()
    if (!projectId || !activeSourceId) return
    set({ migrationsLoad: { status: 'loading' } })
    try {
      const migrations = await databaseApi.listMigrations({ projectId, sourceId: activeSourceId })
      if (get().activeSourceId !== activeSourceId) return
      set({ migrationsLoad: { status: 'ready' }, migrations })
    } catch (caught) {
      if (get().activeSourceId !== activeSourceId) return
      const error = asDatabaseError(caught)
      set({ migrationsLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  loadIssues: async () => {
    const { projectId, activeSourceId } = get()
    if (!projectId || !activeSourceId) return
    set({ issuesLoad: { status: 'loading' } })
    try {
      const issues = await databaseApi.listIssues({ projectId, sourceId: activeSourceId })
      if (get().activeSourceId !== activeSourceId) return
      set({ issuesLoad: { status: 'ready' }, issues })
    } catch (caught) {
      if (get().activeSourceId !== activeSourceId) return
      const error = asDatabaseError(caught)
      set({ issuesLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  loadDesigns: async () => {
    const { projectId, activeSourceId } = get()
    if (!projectId || !activeSourceId) return
    set({ designsLoad: { status: 'loading' } })
    try {
      const designs = await databaseApi.listDesigns({ projectId, sourceId: activeSourceId })
      if (get().activeSourceId !== activeSourceId) return
      set({ designsLoad: { status: 'ready' }, designs })
    } catch (caught) {
      if (get().activeSourceId !== activeSourceId) return
      const error = asDatabaseError(caught)
      set({ designsLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  createDraft: async (name, base) => {
    const { projectId, activeSourceId } = get()
    if (!projectId || !activeSourceId) return
    set({ designError: undefined })
    try {
      const bundle = await databaseApi.createDraft({ projectId, sourceId: activeSourceId, name, base })
      if (get().activeSourceId !== activeSourceId) return
      set({
        activeDesignId: bundle.design.id,
        activeBundle: bundle,
        activeToken: { expectedHeadRevisionId: bundle.revision.id, expectedRevisionNumber: bundle.revision.revisionNumber },
        designs: [bundle.design, ...get().designs],
      })
    } catch (caught) {
      set({ designError: asDatabaseError(caught).message })
    }
  },

  applyOperation: async (operation) => {
    const { projectId, activeDesignId, activeToken, proposedGraph } = get()
    if (!projectId || !activeDesignId || !activeToken) return
    // Optimistic apply: the operation renders immediately, before the network round-trip.
    const optimisticGraph = applyDesignOperation(proposedGraph, operation)
    set({ proposedGraph: optimisticGraph, pendingOperationId: `${operation.kind}:${Date.now()}` })
    try {
      const result = await databaseApi.applyDesignOperation({ projectId, designId: activeDesignId, token: activeToken, operation })
      if (get().activeDesignId !== activeDesignId) return
      set({
        activeToken: result.token,
        designs: get().designs.map((design) => design.id === result.design.id ? result.design : design),
        pendingOperationId: undefined,
      })
    } catch (caught) {
      if (get().activeDesignId !== activeDesignId) return
      if (isDatabaseStaleRevisionError(caught)) {
        // Roll the optimistic change back rather than silently rebasing or dropping it.
        set({ proposedGraph, pendingOperationId: undefined, staleRevisionNotice: { designId: activeDesignId } })
        return
      }
      set({ proposedGraph, pendingOperationId: undefined, designError: asDatabaseError(caught).message })
    }
  },

  dismissStaleRevisionNotice: () => set({ staleRevisionNotice: undefined }),

  selectObjects: (ids, options = {}) => {
    const current = get().selection
    const next: DatabaseSelection = options.additive
      ? { ...current, tableIds: [...new Set([...current.tableIds, ...ids])] }
      : { ...emptyDatabaseSelection(), tableIds: ids }
    next.focusedId = options.focusedId ?? ids.at(-1) ?? current.focusedId
    set({ selection: next })
  },

  clearSelection: () => set({ selection: emptyDatabaseSelection() }),

  setSearch: (search) => set({ filters: { ...get().filters, search } }),
  setHideUnrelated: (value) => set({ filters: { ...get().filters, hideUnrelated: value } }),

  setPinnedPosition: (id, position) => {
    const next = { ...get().pinnedPositions }
    if (position) next[id] = position
    else delete next[id]
    set({ pinnedPositions: next })
  },
}))
