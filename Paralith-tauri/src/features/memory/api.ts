/**
 * Context Fabric Tauri boundary.
 *
 * This is the one place `src/features/memory/**` calls `invoke`. The store and components never
 * import `@tauri-apps/api/core` directly, which mirrors `native/commands.ts` and the Database
 * Studio precedent and gives the feature a single mockable seam.
 *
 * Every command is implemented in `src-tauri/src/commands/memory_commands.rs`, where the Project
 * scope is re-derived from the window. Passing a `projectId` here is a request, not an
 * authorization: a window that cannot reach that Project is refused by the backend.
 */
import { invoke } from '@tauri-apps/api/core'
import type {
  AttachSourceRequest,
  ContextPack,
  ContextRequest,
  GraphRequest,
  ImpactReport,
  KnowledgeGraph,
  KnowledgeHealth,
  KnowledgeJob,
  MemoryClaim,
  MemoryConnections,
  MemoryDetail,
  MemoryRelation,
  MemoryRevisionSummary,
  MemorySearchHit,
  MemorySummary,
  SaveClaimRequest,
  SaveMemoryRequest,
  SaveRelationRequest,
  SearchMemoryRequest,
  SetMemoryQualityRequest,
} from './memoryTypes'
import type {
  AgentHandoff,
  DecideCandidateRequest,
  EmbeddingHealth,
  KnowledgeCandidate,
  KnowledgeConflict,
  KnowledgeHealthReport,
  ParsedQuery,
  ProjectUnderstanding,
  ResolveConflictRequest,
  ReviewQueue,
  SearchRequest,
  SearchResponse,
  TimelineEntry,
  TimelineRequest,
} from './intelligenceTypes'

function invokeFabric<T>(
  command: 'fabric_memory' | 'fabric_intelligence',
  operation: string,
  payload: unknown = {},
) {
  return invoke<T>(command, { operation, payload })
}

const invokeMemory = <T>(operation: string, payload?: unknown) =>
  invokeFabric<T>('fabric_memory', operation, payload)

const invokeIntelligence = <T>(operation: string, payload?: unknown) =>
  invokeFabric<T>('fabric_intelligence', operation, payload)

export const memoryApi = {
  list: (projectId: string, limit?: number) =>
    invokeMemory<MemorySummary[]>('memory_list', { projectId, limit }),
  get: (projectId: string, itemId: string) =>
    invokeMemory<MemoryDetail>('memory_get', { projectId, itemId }),
  search: (request: SearchMemoryRequest) =>
    invokeMemory<MemorySearchHit[]>('memory_search', { request }),
  connections: (projectId: string, itemId: string) =>
    invokeMemory<MemoryConnections>('memory_connections', { projectId, itemId }),
  history: (projectId: string, itemId: string) =>
    invokeMemory<MemoryRevisionSummary[]>('memory_history', { projectId, itemId }),
  revisionBody: (projectId: string, itemId: string, revisionId: string) =>
    invokeMemory<string>('memory_revision_body', { projectId, itemId, revisionId }),
  save: (request: SaveMemoryRequest) => invokeMemory<MemoryDetail>('memory_save', { request }),
  setQuality: (request: SetMemoryQualityRequest) =>
    invokeMemory<MemoryDetail>('memory_set_quality', { request }),
  setPinned: (projectId: string, itemId: string, pinned: boolean) =>
    invokeMemory<void>('memory_set_pinned', { projectId, itemId, pinned }),
  archive: (projectId: string, itemId: string) =>
    invokeMemory<void>('memory_archive', { projectId, itemId }),
  saveClaim: (request: SaveClaimRequest) =>
    invokeMemory<MemoryClaim[]>('memory_save_claim', { request }),
  deleteClaim: (projectId: string, itemId: string, claimId: string) =>
    invokeMemory<MemoryClaim[]>('memory_delete_claim', { projectId, itemId, claimId }),
  attachSource: (request: AttachSourceRequest) =>
    invokeMemory<MemoryDetail>('memory_attach_source', { request }),
  saveRelation: (request: SaveRelationRequest) =>
    invokeMemory<MemoryRelation[]>('memory_save_relation', { request }),
  deleteRelation: (projectId: string, itemId: string, relationId: string) =>
    invokeMemory<MemoryRelation[]>('memory_delete_relation', { projectId, itemId, relationId }),
  graph: (request: GraphRequest) => invokeMemory<KnowledgeGraph>('memory_graph', { request }),
  impact: (projectId: string, filePath: string, limit?: number) =>
    invokeMemory<ImpactReport>('memory_impact', { projectId, filePath, limit }),
  health: (projectId: string) => invokeMemory<KnowledgeHealth>('memory_health', { projectId }),
  /** An empty `reason` clears the flag rather than setting it. */
  markStale: (projectId: string, itemIds: string[], reason?: string) =>
    invokeMemory<number>('memory_mark_stale', { projectId, itemIds, reason }),
  /** Compile a bounded, attributed slice of project knowledge for an agent or a task. */
  compileContext: (request: ContextRequest) =>
    invokeMemory<ContextPack>('context_compile', { request }),
  /** `[relationTypes, sourceTypes]` — the closed vocabularies, so pickers cannot drift. */
  vocabulary: () => invokeMemory<[string[], string[]]>('memory_vocabulary'),

  /** The knowledge job queue: what the automatic lifecycle has done, is doing, or failed at. */
  jobs: (projectId: string, activeOnly?: boolean, limit?: number) =>
    invokeMemory<KnowledgeJob[]>('memory_jobs', { projectId, activeOnly, limit }),
  /** Resolves `false` when the job had already started — a running handler cannot be interrupted. */
  cancelJob: (projectId: string, jobId: string) =>
    invokeMemory<boolean>('memory_job_cancel', { projectId, jobId }),
  /** Queue impact analysis for paths the watcher cannot see (a merge, an agent's changed files). */
  analyzeImpact: (projectId: string, paths: string[], trigger?: string) =>
    invokeMemory<boolean>('memory_analyze_impact', { projectId, paths, trigger }),
}

/**
 * The automated knowledge intelligence boundary.
 *
 * Kept as a second object rather than merged into `memoryApi` so the Memory surface's original
 * contract stays readable: everything below is *derived* knowledge — what the analyzer detected,
 * what the pipeline proposed, and what is waiting for a person.
 */
export const intelligenceApi = {
  /** What the deterministic analyzer has detected about this Project. */
  understanding: (projectId: string) =>
    invokeIntelligence<ProjectUnderstanding>('knowledge_understanding', { projectId }),
  /** Queue a re-read. Resolves `false` when an analysis is already pending. */
  analyzeProject: (projectId: string) =>
    invokeIntelligence<boolean>('knowledge_analyze_project', { projectId }),

  /** Everything waiting for a human, ordered by the risk of leaving it alone. */
  reviewQueue: (projectId: string) =>
    invokeIntelligence<ReviewQueue>('knowledge_review_queue', { projectId }),
  /** Accept or reject candidates. Resolves with the memory ids that now exist. */
  decideCandidates: (request: DecideCandidateRequest) =>
    invokeIntelligence<string[]>('knowledge_decide_candidates', { request }),
  /** Settle one contradiction. Never bulk — see the backend note. */
  resolveConflict: (request: ResolveConflictRequest) =>
    invokeIntelligence<string[]>('knowledge_resolve_conflict', { request }),
  conflicts: (projectId: string, status?: string) =>
    invokeIntelligence<KnowledgeConflict[]>('knowledge_conflicts', { projectId, status }),
  candidates: (projectId: string, status?: string, limit?: number) =>
    invokeIntelligence<KnowledgeCandidate[]>('knowledge_candidates', { projectId, status, limit }),

  /** The evolution of project knowledge — distinct from the operational job feed. */
  timeline: (request: TimelineRequest) =>
    invokeIntelligence<TimelineEntry[]>('knowledge_timeline', { request }),
  /** Actors that have actually appeared, so the filter cannot offer one that never did anything. */
  timelineActors: (projectId: string) =>
    invokeIntelligence<string[]>('knowledge_timeline_actors', { projectId }),
  handoffs: (projectId: string, limit?: number) =>
    invokeIntelligence<AgentHandoff[]>('knowledge_handoffs', { projectId, limit }),

  /** Unified structured + lexical search across every knowledge store. */
  search: (request: SearchRequest) =>
    invokeIntelligence<SearchResponse>('knowledge_search', { request }),
  /** Parse without running, for live syntax feedback in the search field. */
  parseQuery: (query: string) =>
    invokeIntelligence<ParsedQuery>('knowledge_parse_query', { query }),
  /** Whether semantic retrieval is genuinely available, and why not when it is not. */
  semanticHealth: () => invokeIntelligence<EmbeddingHealth>('knowledge_semantic_health'),

  /** Core health plus the intelligence counts, each carrying the query that lists it. */
  healthReport: (projectId: string) =>
    invokeIntelligence<KnowledgeHealthReport>('knowledge_health_report', { projectId }),
}
