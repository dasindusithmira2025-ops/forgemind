/**
 * Automated knowledge intelligence wire contracts.
 *
 * Mirrors `src-tauri/src/models/intelligence.rs` and `src-tauri/src/models/query.rs` field for
 * field. Hand-maintained like `memoryTypes.ts`, on the same rule: a change on one side without the
 * other is a type error at the first call site rather than a runtime surprise.
 */

// ---- Project understanding --------------------------------------------------------------------

/** Why the analyzer believes a fact. A fact with no evidence cannot be represented. */
export interface FactEvidence {
  path: string
  /** `manifest`, `config`, `directory`, `file`, or `content`. */
  kind: string
  excerpt: string | null
}

export interface ProjectFact {
  dimension: string
  value: string
  detail: string | null
  confidence: number
  evidence: FactEvidence[]
}

export interface UnderstandingGroup {
  dimension: string
  facts: ProjectFact[]
}

export interface ProjectUnderstanding {
  projectId: string
  /** Monotonic; part of the Context Pack cache key. `0` means the Project has never been analyzed. */
  revision: number
  generatedAt: string | null
  groups: UnderstandingGroup[]
  filesScanned: number
}

/** Display labels for the dimensions the backend emits. An unknown dimension falls back to its
 * raw value rather than being dropped, so a newer analyzer cannot make this build hide findings. */
export const DIMENSION_LABELS: Record<string, string> = {
  language: 'Languages',
  framework: 'Frameworks',
  desktop_runtime: 'Desktop runtime',
  package_manager: 'Package managers',
  workspace: 'Workspace',
  application: 'Applications',
  module: 'Modules',
  entry_point: 'Entry points',
  api_surface: 'API surface',
  database: 'Databases',
  schema: 'Schema',
  test_system: 'Testing',
  build_system: 'Build',
  ci_system: 'CI',
  deployment_system: 'Deployment',
  container: 'Containers',
  dependency: 'Dependencies',
  document: 'Documents',
  convention: 'Conventions',
}

export function dimensionLabel(dimension: string): string {
  return DIMENSION_LABELS[dimension] ?? dimension.replace(/_/g, ' ')
}

// ---- Entities ------------------------------------------------------------------------------------

export interface KnowledgeEntity {
  id: string
  projectId: string
  kind: string
  canonicalName: string
  normalizedName: string
  aliases: string[]
  sourceIdentity: string | null
  createdAt: string
  updatedAt: string
}

// ---- Candidates ----------------------------------------------------------------------------------

export type CandidateOrigin = 'deterministic' | 'handoff' | 'document' | 'model' | 'manual'

export type RiskClass = 'routine' | 'notable' | 'high'

export type CandidateStatus =
  | 'pending'
  | 'accepted'
  | 'auto_accepted'
  | 'rejected'
  | 'merged'
  | 'conflict'

/** An extraction artifact, never canonical Memory. Policy decides whether the project adopts it. */
export interface KnowledgeCandidate {
  id: string
  projectId: string
  kind: string
  subject: string
  predicate: string
  object: string
  statement: string
  suggestedMemoryType: string
  confidence: number
  origin: CandidateOrigin
  riskClass: RiskClass
  status: CandidateStatus
  entityId: string | null
  itemId: string | null
  branchName: string | null
  createdBy: string
  dedupHash: string
  decisionReason: string | null
  evidence: FactEvidence[]
  createdAt: string
  decidedAt: string | null
}

// ---- Conflicts -----------------------------------------------------------------------------------

export type ConflictClass =
  | 'direct_contradiction'
  | 'possible_supersession'
  | 'branch_divergence'
  | 'temporal_change'
  | 'source_mismatch'
  | 'unknown'

export type ConflictStatus = 'open' | 'resolved' | 'dismissed' | 'investigating'

export type ConflictResolution =
  | 'keep_left'
  | 'keep_right'
  | 'supersede_left'
  | 'supersede_right'
  | 'temporal'
  | 'divergent'
  | 'merge'
  | 'investigate'
  | 'dismiss'

export interface KnowledgeConflict {
  id: string
  projectId: string
  subjectEntityId: string | null
  subject: string
  predicate: string
  leftItemId: string | null
  leftClaimId: string | null
  leftLabel: string
  leftValue: string
  rightItemId: string | null
  rightClaimId: string | null
  rightLabel: string
  rightValue: string
  classification: ConflictClass
  confidence: number
  status: ConflictStatus
  resolution: ConflictResolution | null
  detail: string
  createdAt: string
  resolvedAt: string | null
}

export const CONFLICT_CLASS_LABELS: Record<ConflictClass, string> = {
  direct_contradiction: 'Contradiction',
  possible_supersession: 'Possibly superseded',
  branch_divergence: 'Branch divergence',
  temporal_change: 'Changed over time',
  source_mismatch: 'Source mismatch',
  unknown: 'Unclassified',
}

/** The resolutions offered in the UI, in the order a reviewer usually wants them.
 *
 * None of these deletes the losing evidence — `supersede_*` demotes it to `superseded` and records
 * a `supersedes` relation, and the rest only record the judgement. */
export const CONFLICT_RESOLUTIONS: { value: ConflictResolution; label: string; hint: string }[] = [
  { value: 'supersede_left', label: 'Right supersedes left', hint: 'Left is demoted, not deleted.' },
  {
    value: 'supersede_right',
    label: 'Left supersedes right',
    hint: 'Right is demoted, not deleted.',
  },
  { value: 'temporal', label: 'Both, at different times', hint: 'The value changed.' },
  { value: 'divergent', label: 'Both, on different branches', hint: 'Neither is wrong.' },
  { value: 'investigate', label: 'Investigate', hint: 'Stays open, marked as being looked at.' },
  { value: 'dismiss', label: 'Not a conflict', hint: 'Closes without changing either side.' },
]

// ---- Handoffs -------------------------------------------------------------------------------------

/** What an agent run actually did, generated from real artifacts. Empty sections mean the run
 * genuinely produced nothing there — never a placeholder. */
export interface AgentHandoff {
  id: string
  projectId: string
  runId: string | null
  swarmId: string | null
  taskId: string | null
  agent: string
  model: string | null
  goal: string
  task: string
  outcome: string
  workCompleted: string[]
  filesCreated: string[]
  filesModified: string[]
  filesDeleted: string[]
  decisions: string[]
  findings: string[]
  tests: string[]
  commands: string[]
  evidenceIds: string[]
  failures: string[]
  remainingWork: string[]
  recommendedNext: string | null
  branchName: string | null
  worktreePath: string | null
  commitSha: string | null
  createdAt: string
}

// ---- Review -----------------------------------------------------------------------------------------

export type ReviewSection =
  | 'canonical_conflict'
  | 'conflict'
  | 'stale_canonical'
  | 'high_risk_candidate'
  | 'duplicate'
  | 'missing_evidence'
  | 'candidate'

export interface ReviewItem {
  section: ReviewSection
  id: string
  title: string
  detail: string
  riskClass: RiskClass
  candidate: KnowledgeCandidate | null
  conflict: KnowledgeConflict | null
  itemId: string | null
  createdAt: string
}

export interface ReviewGroup {
  section: ReviewSection
  label: string
  /** Whether the whole group may be actioned in one gesture. Never true for contradictions. */
  bulkActionable: boolean
  items: ReviewItem[]
}

export interface ReviewQueue {
  sections: ReviewGroup[]
  total: number
  truncated: boolean
}

export interface DecideCandidateRequest {
  projectId: string
  candidateIds: string[]
  action: 'accept' | 'reject'
  title?: string | null
  note?: string | null
}

export interface ResolveConflictRequest {
  projectId: string
  conflictId: string
  resolution: ConflictResolution
  note?: string | null
}

// ---- Timeline ----------------------------------------------------------------------------------------

export type TimelineKind =
  | 'memory_created'
  | 'memory_revised'
  | 'quality_changed'
  | 'marked_stale'
  | 'verified'
  | 'claim_changed'
  | 'candidate_accepted'
  | 'candidate_rejected'
  | 'conflict_opened'
  | 'conflict_resolved'
  | 'handoff_recorded'
  | 'understanding_updated'

export const TIMELINE_LABELS: Record<TimelineKind, string> = {
  memory_created: 'created',
  memory_revised: 'revised',
  quality_changed: 'quality changed',
  marked_stale: 'marked stale',
  verified: 'verified',
  claim_changed: 'claim changed',
  candidate_accepted: 'learned',
  candidate_rejected: 'rejected',
  conflict_opened: 'conflict opened',
  conflict_resolved: 'conflict resolved',
  handoff_recorded: 'agent handoff',
  understanding_updated: 'project re-read',
}

export interface TimelineEntry {
  id: string
  projectId: string
  at: string
  kind: TimelineKind
  summary: string
  detail: string | null
  actor: string
  itemId: string | null
  itemTitle: string | null
  entityId: string | null
  memoryType: string | null
  branchName: string | null
  taskId: string | null
}

export interface TimelineRequest {
  projectId: string
  since?: string | null
  until?: string | null
  kinds?: string[]
  itemId?: string | null
  entityId?: string | null
  memoryType?: string | null
  actor?: string | null
  branchName?: string | null
  taskId?: string | null
  limit?: number | null
}

// ---- Unified query and search ------------------------------------------------------------------------

export type SearchDomain =
  | 'memory'
  | 'claim'
  | 'entity'
  | 'candidate'
  | 'handoff'
  | 'conflict'
  | 'fact'

export const SEARCH_DOMAIN_LABELS: Record<SearchDomain, string> = {
  memory: 'Memory',
  claim: 'Claim',
  entity: 'Entity',
  candidate: 'Candidate',
  handoff: 'Handoff',
  conflict: 'Conflict',
  fact: 'Project fact',
}

/** The parsed query tree, exactly as the backend ran it. Surfaced so the UI can show what was
 * understood rather than silently returning a narrower set than the user asked for. */
export type QueryExpression =
  | { node: 'all' }
  | { node: 'and'; fields: QueryExpression[] }
  | { node: 'or'; fields: QueryExpression[] }
  | { node: 'not'; fields: QueryExpression }
  | { node: 'field'; fields: unknown }
  | { node: 'text'; fields: string }

export interface ParsedQuery {
  expression: QueryExpression
  /** Non-fatal complaints. The query still ran; these say what was not understood. */
  diagnostics: string[]
}

export interface SearchResult {
  domain: SearchDomain
  id: string
  itemId: string | null
  title: string
  excerpt: string
  /** `lexical` or `filter`. */
  matchReason: string
  score: number
  memoryType: string | null
  quality: string | null
  stale: boolean
  confidence: number | null
  branchName: string | null
  updatedAt: string
}

export interface SearchRequest {
  projectId: string
  query: string
  domains?: string[]
  limit?: number | null
  semantic?: boolean
}

export interface SearchResponse {
  results: SearchResult[]
  parsed: ParsedQuery
  total: number
  truncated: boolean
  elapsedMs: number
  semanticUsed: boolean
}

/** Whether semantic retrieval is genuinely available. The UI keys off `available`, never off the
 * configured mode, so an unconfigured provider reads as off instead of silently failing. */
export interface EmbeddingHealth {
  mode: string
  provider: string
  model: string
  dimensions: number
  available: boolean
  detail: string | null
}

// ---- Health -------------------------------------------------------------------------------------------

/** A count plus the query that lists exactly the rows it counted. A number with no click-through
 * would be a score, and this product does not have scores. */
export interface HealthMetric {
  key: string
  label: string
  count: number
  query: string
  severity: 'neutral' | 'warn' | 'alert'
}

export interface KnowledgeHealthReport {
  total: number
  byQuality: [string, number][]
  byType: [string, number][]
  stale: number
  orphans: number
  missingEvidence: number
  brokenLinks: number
  contradictedClaims: number
  staleCanonical: number
  metrics: HealthMetric[]
  understandingRevision: number
  understandingGeneratedAt: string | null
}

/** Query examples shown in the empty search state. Every one of these runs. */
export const SEARCH_EXAMPLES: { query: string; hint: string }[] = [
  { query: 'type:decision quality:canonical', hint: 'Authoritative decisions' },
  { query: 'stale:true quality:canonical', hint: 'Knowledge a change put in question' },
  { query: 'type:(bug OR incident)', hint: 'Either type' },
  { query: 'NOT type:note', hint: 'Everything but notes' },
  { query: 'evidence:src/auth', hint: 'Backed by a file under a path' },
  { query: 'verified:<30d', hint: 'Confirmed in the last month' },
  { query: 'is:conflict', hint: 'Open contradictions' },
  { query: 'is:handoff', hint: 'What agents reported' },
]
