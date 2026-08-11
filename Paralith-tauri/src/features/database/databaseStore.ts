import { create } from 'zustand'
import { asDatabaseError, databaseApi } from './api'
import type {
  CreateDatabaseDraftBase,
  DatabaseCanvasFilters,
  DatabaseComparisonMode,
  DatabaseDesign,
  DatabaseDesignBundle,
  DatabaseDesignOperationKind,
  DatabaseDiff,
  DatabaseGraphPage,
  DatabaseImplementationRun,
  DatabaseIssue,
  DatabaseLayer,
  DatabaseLoadState,
  DatabaseMigration,
  DatabaseObjectDetail,
  DatabaseSelection,
  DatabaseSnapshot,
  DatabaseSource,
  DatabaseZoomTier,
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
  /** Backend-driven level of detail. 0 = tables only, 3 = every column and constraint. */
  semanticLod: number

  comparison?: DatabaseDiff
  comparisonLoad: DatabaseLoadState
  implementationRun?: DatabaseImplementationRun
  implementationLoad: DatabaseLoadState
  observedSnapshot?: DatabaseSnapshot
  introspectionLoad: DatabaseLoadState

  reset: () => void
  loadProject: (projectId: string) => Promise<void>
  discoverSources: (force?: boolean) => Promise<void>
  selectSource: (sourceId: string, layer?: DatabaseLayer) => void
  /** Switch which layer the surfaces project: what the repository declares, what a database
   * actually contains, or what a design proposes. The three are never merged. */
  setLayer: (layer: DatabaseLayer) => void
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
  selectDesign: (designId: string | undefined) => Promise<void>
  decideDesign: (decision: 'approve' | 'reject' | 'archive', reason?: string) => Promise<void>
  compare: (mode: DatabaseComparisonMode) => Promise<void>
  clearComparison: () => void
  implementActiveDesign: (options?: { acknowledgeDestructive?: boolean; dryRun?: boolean }) => Promise<void>
  introspectSqliteFile: (projectRelativePath: string) => Promise<void>
  setSemanticLod: (lod: number) => void
  /**
   * Publish the semantic canvas state so an agent asked to act on "these tables" receives the exact
   * object IDs the user selected, never coordinates and never a screenshot.
   */
  publishCanvasState: (zoomTier: DatabaseZoomTier, visibleObjectIds: SemanticId[]) => Promise<void>
  dismissStaleRevisionNotice: () => void
  selectObjects: (ids: SemanticId[], options?: { additive?: boolean; focusedId?: SemanticId }) => void
  clearSelection: () => void
  setSearch: (search: string) => void
  setHideUnrelated: (value: boolean) => void
  setNHop: (value: number) => void
  setGroupBy: (value: DatabaseCanvasFilters['groupBy']) => void
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
  semanticLod: 2,
  comparisonLoad: EMPTY_LOAD,
  implementationLoad: EMPTY_LOAD,
  introspectionLoad: EMPTY_LOAD,

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
    semanticLod: 2,
    comparison: undefined,
    comparisonLoad: EMPTY_LOAD,
    implementationRun: undefined,
    implementationLoad: EMPTY_LOAD,
    observedSnapshot: undefined,
    introspectionLoad: EMPTY_LOAD,
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
    if (get().activeSourceId === sourceId && !layer) return
    // Designs, comparisons, and observed snapshots belong to one source. Carrying them across a
    // source switch would show one database's proposal on top of another's schema.
    set({
      activeSourceId: sourceId,
      activeLayer: layer ?? 'declared',
      schemaPage: undefined,
      schemaLoad: EMPTY_LOAD,
      selection: emptyDatabaseSelection(),
      designsLoad: EMPTY_LOAD,
      designs: [],
      activeDesignId: undefined,
      activeBundle: undefined,
      activeToken: undefined,
      proposedGraph: { tables: {}, columns: {} },
      migrationsLoad: EMPTY_LOAD,
      migrations: [],
      issuesLoad: EMPTY_LOAD,
      issues: [],
      comparison: undefined,
      comparisonLoad: EMPTY_LOAD,
      implementationRun: undefined,
      implementationLoad: EMPTY_LOAD,
      observedSnapshot: undefined,
      introspectionLoad: EMPTY_LOAD,
    })
  },

  setLayer: (layer) => {
    if (get().activeLayer === layer) return
    set({ activeLayer: layer, schemaPage: undefined, schemaLoad: EMPTY_LOAD, selection: emptyDatabaseSelection() })
    void get().loadSchema()
  },

  loadSchema: async () => {
    const { projectId, activeSourceId, activeLayer, loadToken } = get()
    if (!projectId || !activeSourceId) return
    set({ schemaLoad: { status: 'loading' } })
    try {
      const { semanticLod, activeBundle } = get()
      const page = await databaseApi.getSchema({
        projectId,
        sourceId: activeSourceId,
        layer: activeLayer,
        lod: semanticLod,
        designRevisionId: activeLayer === 'proposed' ? activeBundle?.revision.id : undefined,
      })
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
    const { projectId, activeSourceId, schemaPage } = get()
    if (!projectId || !activeSourceId) return
    // A draft is always rooted in a concrete snapshot or revision the user can point at, so two
    // drafts created from the same screen provably share a base.
    const resolvedBase: CreateDatabaseDraftBase | undefined =
      base ?? (schemaPage?.snapshot ? { kind: 'snapshot', snapshotId: schemaPage.snapshot.id } : undefined)
    if (!resolvedBase) {
      set({ designError: 'Load a schema before creating a design draft.' })
      return
    }
    set({ designError: undefined })
    try {
      const bundle = await databaseApi.createDraft({ projectId, sourceId: activeSourceId, name, base: resolvedBase })
      if (get().activeSourceId !== activeSourceId) return
      set({
        activeDesignId: bundle.design.id,
        activeBundle: bundle,
        activeToken: bundle.concurrency,
        proposedGraph: proposedGraphFromBundle(bundle),
        designs: [bundle.design, ...get().designs.filter((design) => design.id !== bundle.design.id)],
        activeLayer: 'proposed',
        schemaPage: undefined,
        schemaLoad: EMPTY_LOAD,
      })
      void get().loadSchema()
    } catch (caught) {
      set({ designError: asDatabaseError(caught).message })
    }
  },

  selectDesign: async (designId) => {
    const { projectId } = get()
    if (!designId) {
      set({
        activeDesignId: undefined,
        activeBundle: undefined,
        activeToken: undefined,
        proposedGraph: { tables: {}, columns: {} },
        activeLayer: 'declared',
        schemaPage: undefined,
        schemaLoad: EMPTY_LOAD,
      })
      return
    }
    if (!projectId) return
    set({ designError: undefined })
    try {
      const bundle = await databaseApi.getDesign({ projectId, designId })
      set({
        activeDesignId: bundle.design.id,
        activeBundle: bundle,
        activeToken: bundle.concurrency,
        proposedGraph: proposedGraphFromBundle(bundle),
        staleRevisionNotice: undefined,
        // Opening a design projects the Proposed layer, so the diagram shows what is being
        // designed rather than silently continuing to render the declared schema.
        activeLayer: 'proposed',
        schemaPage: undefined,
        schemaLoad: EMPTY_LOAD,
      })
      void get().loadSchema()
    } catch (caught) {
      set({ designError: asDatabaseError(caught).message })
    }
  },

  decideDesign: async (decision, reason) => {
    const { projectId, activeDesignId, activeToken, activeBundle } = get()
    if (!projectId || !activeDesignId || !activeToken) return
    const request = { projectId, designId: activeDesignId, concurrency: activeToken, reason }
    set({ designError: undefined })
    try {
      const result = decision === 'approve'
        ? await databaseApi.approveDesign(request)
        : decision === 'reject'
          ? await databaseApi.rejectDesign(request)
          : await databaseApi.archiveDesign(request)
      set({
        activeToken: result.concurrency,
        designs: get().designs.map((design) => (design.id === result.design.id ? result.design : design)),
        activeBundle: activeBundle ? { ...activeBundle, design: result.design } : undefined,
      })
    } catch (caught) {
      if (isDatabaseStaleRevisionError(caught)) {
        set({ staleRevisionNotice: { designId: activeDesignId } })
        return
      }
      set({ designError: asDatabaseError(caught).message })
    }
  },

  compare: async (mode) => {
    const { projectId } = get()
    if (!projectId) return
    set({ comparisonLoad: { status: 'loading' } })
    try {
      const comparison = await databaseApi.compare({ projectId, mode })
      set({ comparison, comparisonLoad: { status: 'ready' } })
    } catch (caught) {
      const error = asDatabaseError(caught)
      set({ comparisonLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  clearComparison: () => set({ comparison: undefined, comparisonLoad: EMPTY_LOAD }),

  implementActiveDesign: async (options = {}) => {
    const { projectId, activeBundle } = get()
    const approvedRevisionId = activeBundle?.design.approvedRevisionId
    if (!projectId || !activeBundle || !approvedRevisionId) {
      set({ designError: 'Approve a design revision before implementing it.' })
      return
    }
    set({ implementationLoad: { status: 'loading' }, designError: undefined })
    try {
      const run = await databaseApi.implementDesign({
        projectId,
        designId: activeBundle.design.id,
        approvedRevisionId,
        executionMode: 'implement_design',
        acknowledgeDestructive: options.acknowledgeDestructive ?? false,
        dryRun: options.dryRun ?? false,
      })
      set({ implementationRun: run, implementationLoad: { status: 'ready' } })
      if (!run.dryRun) await get().discoverSources(true)
    } catch (caught) {
      const error = asDatabaseError(caught)
      set({ implementationLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  introspectSqliteFile: async (projectRelativePath) => {
    const { projectId, activeSourceId } = get()
    if (!projectId || !activeSourceId) return
    set({ introspectionLoad: { status: 'loading' } })
    try {
      const snapshot = await databaseApi.introspectSqliteFile({
        projectId,
        sourceId: activeSourceId,
        projectRelativePath,
        explicitUserConsent: true,
      })
      set({ observedSnapshot: snapshot, introspectionLoad: { status: 'ready' } })
    } catch (caught) {
      const error = asDatabaseError(caught)
      set({ introspectionLoad: { status: 'error', errorCode: error.code, errorMessage: error.message } })
    }
  },

  setSemanticLod: (lod) => {
    const next = Math.max(0, Math.min(3, Math.round(lod)))
    if (get().semanticLod === next) return
    set({ semanticLod: next })
    void get().loadSchema()
  },

  publishCanvasState: async (zoomTier, visibleObjectIds) => {
    const { projectId, activeSourceId, activeLayer, schemaPage, activeBundle, selection, semanticLod } = get()
    if (!projectId || !activeSourceId) return
    try {
      await databaseApi.publishCanvasState({
        projectId,
        context: {
          projectId,
          sourceId: activeSourceId,
          layer: activeLayer,
          snapshotId: activeLayer === 'proposed' ? undefined : schemaPage?.snapshot?.id,
          designRevisionId: activeLayer === 'proposed' ? activeBundle?.revision.id : undefined,
          selection: {
            primaryObjectId: selection.focusedId,
            objectIds: selection.tableIds,
            edgeIds: selection.relationshipIds,
            namespaceIds: selection.namespaceIds,
          },
          viewport: {
            visibleObjectIds: visibleObjectIds.slice(0, 160),
            visibleNamespaceIds: [],
            centerObjectId: selection.focusedId,
            zoomTier,
          },
          semanticLod,
          capturedAt: new Date().toISOString(),
        },
      })
    } catch {
      // Canvas publication is best-effort context for agents; a failure must never block the UI.
    }
  },

  applyOperation: async (operation) => {
    const { projectId, activeDesignId, activeToken, proposedGraph } = get()
    if (!projectId || !activeDesignId || !activeToken) return
    // Optimistic apply: the operation renders immediately, before the network round-trip.
    const optimisticGraph = applyDesignOperation(proposedGraph, operation)
    set({ proposedGraph: optimisticGraph, pendingOperationId: `${operation.kind}:${Date.now()}` })
    try {
      const result = await databaseApi.applyDesignOperation({ projectId, designId: activeDesignId, concurrency: activeToken, operation })
      if (get().activeDesignId !== activeDesignId) return
      set({
        activeToken: result.concurrency,
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

  dismissStaleRevisionNotice: () => {
    const designId = get().staleRevisionNotice?.designId
    set({ staleRevisionNotice: undefined })
    if (designId) void get().selectDesign(designId)
  },

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
  setNHop: (value) => set({ filters: { ...get().filters, nHop: Math.max(1, Math.min(2, Math.round(value))) } }),
  setGroupBy: (value) => set({ filters: { ...get().filters, groupBy: value } }),

  setPinnedPosition: (id, position) => {
    const next = { ...get().pinnedPositions }
    if (position) next[id] = position
    else delete next[id]
    set({ pinnedPositions: next })
  },
}))

/**
 * Seed the optimistic Proposed overlay from an authoritative bundle. The backend graph is the
 * truth; this is only what lets an edit render before its round-trip completes.
 */
function proposedGraphFromBundle(bundle: DatabaseDesignBundle): ProposedGraph {
  const graph: ProposedGraph = { tables: {}, columns: {} }
  for (const object of bundle.objects) {
    if (object.kind === 'table') graph.tables[object.value.meta.identity.id] = object.value
    if (object.kind === 'column') graph.columns[object.value.meta.identity.id] = object.value
  }
  return graph
}
