/**
 * Paralith Brain wire contracts.
 *
 * Mirrors `src-tauri/src/models/brain.rs` field for field, hand-maintained on the same rule as
 * `memoryTypes.ts` and `intelligenceTypes.ts`: a change on one side without the other is a type
 * error at the first call site rather than a runtime surprise.
 *
 * Brain is the product surface over the existing Context Fabric. Nothing here is a second store —
 * every field is projected from memories, claims, evidence, relations, the timeline, and the
 * deterministic project analysis that already exist.
 */
import type { TimelineEntry } from './intelligenceTypes'
import type { ContextPack } from './memoryTypes'

/** What Brain understood a question to be asking for. Drives which stores were retrieved. */
export type BrainIntent =
  | 'rationale'
  | 'mechanism'
  | 'change'
  | 'location'
  | 'experience'
  | 'general'

export const BRAIN_INTENT_LABELS: Record<BrainIntent, string> = {
  rationale: 'Why',
  mechanism: 'How it works',
  change: 'What changed',
  location: 'Where',
  experience: 'What was tried',
  general: 'What we know',
}

/** One piece of real evidence behind an answer. `id` always addresses a stored row. */
export interface BrainSource {
  /** `memory`, `claim`, `handoff`, `fact`, `conflict`, `candidate`, `entity`, or `evidence`. */
  kind: string
  id: string
  itemId: string | null
  title: string
  excerpt: string
  uri: string | null
  quality: string | null
  stale: boolean
  confidence: number | null
  /** Why this row was retrieved, carried through from retrieval rather than invented. */
  matchReason: string
  updatedAt: string
}

export interface BrainRelated {
  itemId: string
  title: string
  memoryType: string
  /** `relation:<type>` or `backlink` — how it connects, not a score. */
  connection: string
}

export interface BrainAnswer {
  question: string
  intent: BrainIntent
  subject: string
  answer: string
  /** `deterministic`. Surfaced so the UI never implies a model wrote the text when none did. */
  synthesis: string
  sources: BrainSource[]
  related: BrainRelated[]
  history: TimelineEntry[]
  considered: number
  elapsedMs: number
}

export interface BrainQuery {
  projectId: string
  question: string
  limit?: number
}

/** A coherent area of the project the knowledge base actually has material about. */
export interface BrainSystem {
  id: string
  name: string
  /** `knowledge` when assembled from Memory, `analysis` when from the deterministic analyzer. */
  origin: string
  summary: string
  knowledgeCount: number
  decisionCount: number
  staleCount: number
  itemIds: string[]
  updatedAt: string
}

export interface BrainRetainRequest {
  projectId: string
  statement: string
  subject?: string
  memoryType?: string
  confidence?: number
  evidence?: string[]
  correctsItemId?: string
}

/**
 * What Brain did with a proposal. Never "written": a proposal enters the candidate funnel and the
 * existing dedupe, conflict, and policy pipeline decides what becomes project truth.
 */
export interface BrainRetainOutcome {
  /** `queued_as_candidate` or `rejected_duplicate`. */
  status: string
  candidatesQueued: number
  detail: string
}

/** The exact context one execution attempt received, read back from the immutable record. */
export interface CompiledContextPack {
  id: string
  projectId: string
  taskId: string
  agentRunId: string
  compilerVersion: string
  createdAt: string
  pack: ContextPack
}
