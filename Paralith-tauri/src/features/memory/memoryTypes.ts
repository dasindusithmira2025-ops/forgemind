/**
 * Context Fabric wire contracts.
 *
 * These mirror `src-tauri/src/models/memory.rs` field for field. They are hand-maintained rather
 * than generated, so the rule is the same one the Database Studio types follow: a change on one
 * side without the other is a type error at the first call site, not a runtime surprise.
 */

/** Knowledge-quality ladder. A memory is promoted as evidence accumulates, never silently deleted. */
export type MemoryQuality =
  | 'working'
  | 'observed'
  | 'supported'
  | 'verified'
  | 'canonical'
  | 'deprecated'
  | 'superseded'

/** Lifecycle of one verifiable statement inside a memory. */
export type ClaimStatus =
  | 'open'
  | 'supported'
  | 'verified'
  | 'contradicted'
  | 'superseded'
  | 'retracted'

/** List/search/graph row. Carries no body: a list of a thousand memories is not a thousand documents. */
export interface MemorySummary {
  id: string
  projectId: string
  slug: string
  title: string
  memoryType: string
  state: string
  quality: MemoryQuality
  importance: number
  confidence: number
  summary: string
  pinned: boolean
  tags: string[]
  workspaceId: string | null
  branchName: string | null
  verifiedAt: string | null
  staleReason: string | null
  revisionNumber: number
  createdAt: string
  updatedAt: string
}

export interface MemoryProperty {
  key: string
  value: string
}

/** A `[[wikilink]]`. `targetItemId` is null when the target does not exist yet — an ordinary state. */
export interface MemoryLink {
  targetSlug: string
  targetText: string
  targetItemId: string | null
  anchor: string | null
  alias: string | null
}

export interface MemoryBacklink {
  sourceItemId: string
  sourceSlug: string
  sourceTitle: string
  sourceType: string
  excerpt: string
}

/** A memory that names this one in prose without linking to it. Never promoted automatically. */
export interface UnlinkedMention {
  sourceItemId: string
  sourceSlug: string
  sourceTitle: string
  matchedText: string
  excerpt: string
}

/** Provenance. `file` sources are guaranteed by the backend to resolve inside the Project root. */
export interface MemorySource {
  id: string
  sourceType: string
  uri: string
  filePath: string | null
  lineStart: number | null
  lineEnd: number | null
  gitCommit: string | null
  branchName: string | null
  excerpt: string | null
  capturedAt: string
}

export interface MemoryClaim {
  id: string
  itemId: string
  ordinal: number
  statement: string
  status: ClaimStatus
  confidence: number
  validFrom: string | null
  validUntil: string | null
  supersededByClaimId: string | null
  verifiedAt: string | null
  sources: MemorySource[]
  createdAt: string
  updatedAt: string
}

export interface MemoryRelation {
  id: string
  relationType: string
  fromItemId: string
  toItemId: string
  toSlug: string
  toTitle: string
  confidence: number
  createdBy: string
  createdAt: string
}

export interface MemoryRevisionSummary {
  id: string
  revisionNumber: number
  title: string
  summary: string
  confidence: number
  extractionMethod: string
  modelId: string | null
  contentHash: string
  createdAt: string
}

/** The full document. `MemorySummary` is flattened into this by serde, so its fields are inline. */
export interface MemoryDetail extends MemorySummary {
  body: string
  properties: MemoryProperty[]
  outgoingLinks: MemoryLink[]
  claims: MemoryClaim[]
  sources: MemorySource[]
  relations: MemoryRelation[]
  revisionId: string
  /** Relative path of the portable Markdown mirror, or null when it could not be written. */
  filePath: string | null
}

export interface MemoryConnections {
  backlinks: MemoryBacklink[]
  unlinkedMentions: UnlinkedMention[]
  orphan: boolean
}

export interface MemorySearchHit extends MemorySummary {
  snippet: string
  score: number
  /** Retrieval attribution: why this hit came back. Consumed by the inspector, not decoration. */
  matchReason: string
}

export interface SaveMemoryRequest {
  projectId: string
  itemId?: string | null
  title: string
  body: string
  memoryType?: string | null
  workspaceId?: string | null
  branchName?: string | null
  writeFile?: boolean | null
}

export interface SearchMemoryRequest {
  projectId: string
  query: string
  limit?: number | null
}

export interface SetMemoryQualityRequest {
  projectId: string
  itemId: string
  quality: MemoryQuality
}

export interface SaveClaimRequest {
  projectId: string
  itemId: string
  claimId?: string | null
  statement: string
  status: ClaimStatus
  confidence?: number | null
  validFrom?: string | null
  validUntil?: string | null
}

export interface AttachSourceRequest {
  projectId: string
  itemId: string
  claimId?: string | null
  sourceType: string
  filePath?: string | null
  lineStart?: number | null
  lineEnd?: number | null
  uri?: string | null
  excerpt?: string | null
}

export interface SaveRelationRequest {
  projectId: string
  fromItemId: string
  toItemId: string
  relationType: string
  confidence?: number | null
}

/** Memory types offered in the editor. The backend accepts any string; this is the curated set. */
export const MEMORY_TYPES = [
  'decision',
  'component',
  'convention',
  'constraint',
  'requirement',
  'bug',
  'incident',
  'security',
  'performance',
  'runbook',
  'research',
  'risk',
  'note',
] as const

export const QUALITY_ORDER: MemoryQuality[] = [
  'working',
  'observed',
  'supported',
  'verified',
  'canonical',
  'deprecated',
  'superseded',
]

export const CLAIM_STATUSES: ClaimStatus[] = [
  'open',
  'supported',
  'verified',
  'contradicted',
  'superseded',
  'retracted',
]

// ---- Graph ---------------------------------------------------------------------------------
// Mirrors `src-tauri/src/models/graph.rs`. Node ids are namespaced by kind (`memory:<uuid>`,
// `file:<path>`, `tag:<tag>`) so a mixed graph can be keyed without collisions.

export type GraphNodeKind = 'memory' | 'file' | 'commit' | 'tag'
export type GraphEdgeKind = 'relation' | 'link' | 'evidence' | 'tag'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  label: string
  sublabel: string
  itemId?: string | null
  memoryType?: string | null
  quality?: MemoryQuality | null
  importance: number
  stale: boolean
  degree: number
  /** Hops from the focus node; absent in a global graph. */
  distance?: number | null
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: GraphEdgeKind
  label: string
  confidence: number
  directed: boolean
}

export interface KnowledgeGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
  /** The node cap was reached — the view is a slice, not the whole project. */
  truncated: boolean
  focusId?: string | null
}

export interface GraphRequest {
  projectId: string
  focusItemId?: string | null
  depth?: number | null
  includeKinds?: GraphNodeKind[]
  relationTypes?: string[]
  memoryTypes?: string[]
  minConfidence?: number | null
  branchName?: string | null
  includeArchived?: boolean | null
  limit?: number | null
}

export interface ImpactHit extends MemorySummary {
  reason: string
  distance: number
}

export interface ImpactReport {
  filePath: string
  hits: ImpactHit[]
  /** Ids of hits that are `verified` or `canonical` — the highest-risk ones to leave unchecked. */
  needsVerification: string[]
  truncated: boolean
}

export interface KnowledgeHealth {
  total: number
  byQuality: [string, number][]
  byType: [string, number][]
  stale: number
  orphans: number
  missingEvidence: number
  brokenLinks: number
  contradictedClaims: number
  staleCanonical: number
}

/** Edge kinds a user can toggle, with the label the legend shows. */
export const GRAPH_EDGE_KINDS: { kind: GraphEdgeKind; label: string }[] = [
  { kind: 'relation', label: 'Relations' },
  { kind: 'link', label: 'Links' },
  { kind: 'evidence', label: 'Evidence' },
  { kind: 'tag', label: 'Tags' },
]

// ---- Context Packs -------------------------------------------------------------------------
// Mirrors `src-tauri/src/models/context.rs`.

export type ContextSectionKind =
  | 'task_contract'
  | 'constraints'
  | 'architecture'
  | 'code'
  | 'predecessors'
  | 'database'
  | 'repository'
  | 'prior_failures'
  | 'tests'
  | 'related'

/** Why one memory is in a pack. Weights add, so two routes to the same memory outrank one. */
export interface ContextReason {
  source: string
  detail: string
  weight: number
}

export interface ContextEntry {
  itemId: string
  title: string
  memoryType: string
  quality: MemoryQuality
  section: ContextSectionKind
  text: string
  tokens: number
  score: number
  stale: boolean
  reasons: ContextReason[]
  sourceType?: string
  sourceId?: string | null
  revisionId?: string | null
  confidence?: number | null
  sourceUris?: string[]
  truncated?: boolean
}

/** A candidate that was found and then cut. `reason` distinguishes a budget cut from a policy one. */
export interface ContextRejection {
  itemId: string
  title: string
  score: number
  reason: string
}

export interface ContextSection {
  kind: ContextSectionKind
  label: string
  entries: ContextEntry[]
}

export interface ContextConflict {
  leftItemId: string
  leftTitle: string
  rightItemId: string
  rightTitle: string
}

/** A prior agent run summarized into the pack. Kept apart from `sections`: a handoff is what
 * happened, not what the project knows. */
export interface ContextHandoff {
  id: string
  agent: string
  task: string
  outcome: string
  text: string
  tokens: number
  createdAt: string
}

export interface ContextPack {
  projectId: string
  task: string
  budgetTokens: number
  usedTokens: number
  sections: ContextSection[]
  rejected: ContextRejection[]
  conflicts: ContextConflict[]
  candidatesConsidered: number
  elapsedMs: number
  compiledAt: string
  handoffs: ContextHandoff[]
  /** Served from the Context Pack cache rather than recompiled. */
  cached: boolean
  /** Whether semantic candidates actually contributed — false whenever semantics are off. */
  semanticUsed: boolean
  compilerVersion?: string
  diagnostics?: {
    providerCandidates: Record<string, number>
    deduplicatedCandidates: number
    staleCandidates: number
    truncatedEntries: number
    semanticStatus: string
    providerErrors: string[]
  }
}

export interface ContextRequest {
  projectId: string
  task: string
  focusFiles?: string[]
  focusItemIds?: string[]
  budget?: string | null
  budgetTokens?: number | null
  /** A unified-query string used as an extra candidate source, e.g. `type:constraint`. */
  filter?: string | null
  role?: string | null
  branchName?: string | null
  bypassCache?: boolean
  semantic?: boolean
  taskId?: string | null
  mission?: string | null
  taskDescription?: string | null
  agentId?: string | null
  agentRunId?: string | null
  provider?: string | null
  model?: string | null
  reasoningEffort?: string | null
  worktree?: string | null
  workingDirectory?: string | null
  acceptanceRequirements?: string[]
  operatorInstructions?: string[]
}

/** Named budgets, with the token ceiling each one resolves to in the backend. */
export const CONTEXT_BUDGETS: { value: string; label: string; tokens: number }[] = [
  { value: 'minimal', label: 'Minimal', tokens: 3000 },
  { value: 'balanced', label: 'Balanced', tokens: 6000 },
  { value: 'deep', label: 'Deep', tokens: 12000 },
  { value: 'exhaustive', label: 'Exhaustive', tokens: 24000 },
]

/**
 * Automated knowledge lifecycle.
 *
 * Mirrors `src-tauri/src/models/knowledge.rs`. A job is how a repository change becomes a
 * staleness flag, and the row is kept visible because an automatic write to knowledge that cannot
 * be inspected is indistinguishable from one that never happened.
 */
export type KnowledgeJobKind =
  | 'analyze_impact'
  | 'analyze_project'
  | 'process_candidates'
  | 'extract_handoff'

export type KnowledgeJobStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface KnowledgeJob {
  id: string
  projectId: string
  kind: KnowledgeJobKind
  status: KnowledgeJobStatus
  /** JSON. For `analyze_impact` it parses as {@link AnalyzeImpactPayload}. */
  payload: string
  attempts: number
  maxAttempts: number
  dedupKey: string | null
  /** JSON handler summary on success. For `analyze_impact` it parses as {@link ImpactOutcome}. */
  result: string | null
  error: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export interface AnalyzeImpactPayload {
  paths: string[]
  /** Structured changes in current jobs. Omitted by pre-intelligence-loop rows. */
  changes?: ChangedPath[]
  /** What moved the paths — `file change`, a commit subject, a merge. */
  trigger: string
}

export type FileChangeKind = 'created' | 'modified' | 'deleted'

export interface ChangedPath {
  path: string
  kind: FileChangeKind
}

export interface ChangeUnderstanding {
  changedPaths: ChangedPath[]
  changeKind: string
  beforeSummary: string | null
  afterSummary: string | null
  affectedSymbols: string[]
  affectedProjectFacts: string[]
  affectedMemoryIds: string[]
  contradictedMemoryIds: string[]
  candidateNewKnowledge: string[]
  confidence: number
  evidence: string[]
}

/** A memory the policy saw and deliberately left alone, with the reason it refused. */
export interface SkippedHit {
  itemId: string
  reason: string
}

export interface ImpactOutcome {
  pathsAnalyzed: number
  understandings: ChangeUnderstanding[]
  markedStale: string[]
  superseded: string[]
  learned: string[]
  needsReview: string[]
  skipped: SkippedHit[]
}

export interface AnalyzeProjectPayload {
  /** Older empty payloads are accepted by Rust via its serde default. */
  trigger: string
}

export interface AnalyzeProjectOutcome {
  filesScanned: number
  factsFound: number
  factsChanged: number
  candidatesQueued: number
  revision: number
}

export interface ExtractHandoffPayload {
  handoffId: string
}

export interface CandidateOutcome {
  processed: number
  autoAccepted: number
  queuedForReview: number
  rejected: number
  duplicatesIgnored: number
  conflictsOpened: number
}

/** Emitted when a lifecycle job changed something a knowledge surface displays. */
export interface KnowledgeUpdatedEvent {
  projectId: string
  jobId: string
  kind: KnowledgeJobKind
  changedItemIds: string[]
}

/** Statuses that mean the job has not finished. */
export const ACTIVE_JOB_STATUSES: KnowledgeJobStatus[] = ['queued', 'running', 'retrying']
