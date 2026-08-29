import type { ChangedPath, SkippedHit } from './memoryTypes'

type JsonObject = Record<string, unknown>

export interface NormalizedAnalyzeImpactPayload {
  paths?: string[]
  changes?: ChangedPath[]
  trigger?: string
}

export interface NormalizedImpactOutcome {
  pathsAnalyzed?: number
  understandings?: NormalizedChangeUnderstanding[]
  markedStale?: string[]
  superseded?: string[]
  learned?: string[]
  needsReview?: string[]
  skipped?: SkippedHit[]
}

export interface NormalizedAnalyzeProjectOutcome {
  filesScanned?: number
  factsFound?: number
  factsChanged?: number
  candidatesQueued?: number
  revision?: number
}

export interface NormalizedCandidateOutcome {
  processed?: number
  autoAccepted?: number
  queuedForReview?: number
  rejected?: number
  duplicatesIgnored?: number
  conflictsOpened?: number
}

export interface NormalizedChangeUnderstanding {
  changedPaths?: ChangedPath[]
  changeKind?: string
  beforeSummary?: string | null
  afterSummary?: string | null
  affectedSymbols?: string[]
  affectedProjectFacts?: string[]
  affectedMemoryIds?: string[]
  contradictedMemoryIds?: string[]
  candidateNewKnowledge?: string[]
  confidence?: number
  evidence?: string[]
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(value: string | null): JsonObject | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    return isObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stringField(object: JsonObject, key: string): string | undefined {
  const value = object[key]
  return typeof value === 'string' ? value : undefined
}

function nullableStringField(object: JsonObject, key: string): string | null | undefined {
  const value = object[key]
  if (value === null) return null
  return typeof value === 'string' ? value : undefined
}

function numberField(object: JsonObject, key: string): number | undefined {
  const value = object[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArrayField(object: JsonObject, key: string): string[] | undefined {
  const value = object[key]
  if (!Array.isArray(value) || !value.every((item): item is string => typeof item === 'string')) {
    return undefined
  }
  return value
}

function changedPath(value: unknown): ChangedPath | null {
  if (!isObject(value)) return null
  const path = stringField(value, 'path')
  const kind = stringField(value, 'kind')
  return path && kind && (kind === 'created' || kind === 'modified' || kind === 'deleted')
    ? { path, kind }
    : null
}

function changedPathArrayField(object: JsonObject, key: string): ChangedPath[] | undefined {
  const value = object[key]
  if (!Array.isArray(value)) return undefined
  const paths = value.map(changedPath)
  return paths.every((path): path is ChangedPath => path !== null) ? paths : undefined
}

function skippedHit(value: unknown): SkippedHit | null {
  if (!isObject(value)) return null
  const itemId = stringField(value, 'itemId')
  const reason = stringField(value, 'reason')
  return itemId && reason ? { itemId, reason } : null
}

function skippedArrayField(object: JsonObject, key: string): SkippedHit[] | undefined {
  const value = object[key]
  if (!Array.isArray(value)) return undefined
  const hits = value.map(skippedHit)
  return hits.every((hit): hit is SkippedHit => hit !== null) ? hits : undefined
}

function understanding(value: unknown): NormalizedChangeUnderstanding | null {
  if (!isObject(value)) return null
  return {
    changedPaths: changedPathArrayField(value, 'changedPaths'),
    changeKind: stringField(value, 'changeKind'),
    beforeSummary: nullableStringField(value, 'beforeSummary'),
    afterSummary: nullableStringField(value, 'afterSummary'),
    affectedSymbols: stringArrayField(value, 'affectedSymbols'),
    affectedProjectFacts: stringArrayField(value, 'affectedProjectFacts'),
    affectedMemoryIds: stringArrayField(value, 'affectedMemoryIds'),
    contradictedMemoryIds: stringArrayField(value, 'contradictedMemoryIds'),
    candidateNewKnowledge: stringArrayField(value, 'candidateNewKnowledge'),
    confidence: numberField(value, 'confidence'),
    evidence: stringArrayField(value, 'evidence'),
  }
}

function understandingArrayField(
  object: JsonObject,
  key: string,
): NormalizedChangeUnderstanding[] | undefined {
  const value = object[key]
  if (!Array.isArray(value)) return undefined
  const understandings = value.map(understanding)
  return understandings.every(
    (item): item is NormalizedChangeUnderstanding => item !== null,
  )
    ? understandings
    : undefined
}

export function normalizeAnalyzeImpactPayload(
  value: string | null,
): NormalizedAnalyzeImpactPayload | null {
  const object = parseObject(value)
  if (!object) return null
  return {
    paths: stringArrayField(object, 'paths'),
    changes: changedPathArrayField(object, 'changes'),
    trigger: stringField(object, 'trigger'),
  }
}

export function normalizeImpactOutcome(value: string | null): NormalizedImpactOutcome | null {
  const object = parseObject(value)
  if (!object) return null
  return {
    pathsAnalyzed: numberField(object, 'pathsAnalyzed'),
    understandings: understandingArrayField(object, 'understandings'),
    markedStale: stringArrayField(object, 'markedStale'),
    superseded: stringArrayField(object, 'superseded'),
    learned: stringArrayField(object, 'learned'),
    needsReview: stringArrayField(object, 'needsReview'),
    skipped: skippedArrayField(object, 'skipped'),
  }
}

export function normalizeAnalyzeProjectPayload(value: string | null): { trigger?: string } | null {
  const object = parseObject(value)
  return object ? { trigger: stringField(object, 'trigger') } : null
}

export function normalizeAnalyzeProjectOutcome(
  value: string | null,
): NormalizedAnalyzeProjectOutcome | null {
  const object = parseObject(value)
  if (!object) return null
  return {
    filesScanned: numberField(object, 'filesScanned'),
    factsFound: numberField(object, 'factsFound'),
    factsChanged: numberField(object, 'factsChanged'),
    candidatesQueued: numberField(object, 'candidatesQueued'),
    revision: numberField(object, 'revision'),
  }
}

export function normalizeCandidateOutcome(value: string | null): NormalizedCandidateOutcome | null {
  const object = parseObject(value)
  if (!object) return null
  return {
    processed: numberField(object, 'processed'),
    autoAccepted: numberField(object, 'autoAccepted'),
    queuedForReview: numberField(object, 'queuedForReview'),
    rejected: numberField(object, 'rejected'),
    duplicatesIgnored: numberField(object, 'duplicatesIgnored'),
    conflictsOpened: numberField(object, 'conflictsOpened'),
  }
}

export function normalizeExtractHandoffPayload(value: string | null): { handoffId?: string } | null {
  const object = parseObject(value)
  return object ? { handoffId: stringField(object, 'handoffId') } : null
}

export function hasImpactDetails(outcome: NormalizedImpactOutcome | null): boolean {
  return Boolean(
    outcome &&
      (outcome.pathsAnalyzed !== undefined ||
        outcome.understandings !== undefined ||
        outcome.markedStale !== undefined ||
        outcome.superseded !== undefined ||
        outcome.learned !== undefined ||
        outcome.needsReview !== undefined ||
        outcome.skipped !== undefined),
  )
}

export function hasProjectDetails(outcome: NormalizedAnalyzeProjectOutcome | null): boolean {
  return Boolean(
    outcome &&
      (outcome.filesScanned !== undefined ||
        outcome.factsFound !== undefined ||
        outcome.factsChanged !== undefined ||
        outcome.candidatesQueued !== undefined ||
        outcome.revision !== undefined),
  )
}

export function hasCandidateDetails(outcome: NormalizedCandidateOutcome | null): boolean {
  return Boolean(
    outcome &&
      (outcome.processed !== undefined ||
        outcome.autoAccepted !== undefined ||
        outcome.queuedForReview !== undefined ||
        outcome.rejected !== undefined ||
        outcome.duplicatesIgnored !== undefined ||
        outcome.conflictsOpened !== undefined),
  )
}
