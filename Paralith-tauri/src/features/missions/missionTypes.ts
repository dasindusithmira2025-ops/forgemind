// TypeScript mirror of the Mission Control IPC contract. Enum-like unions use the backend's
// snake_case serialization; struct fields are camelCase. Keep in sync with
// `src-tauri/src/models/mission.rs`.

export type MissionStatus =
  | 'draft'
  | 'preflight'
  | 'planning'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'verifying'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type MissionTaskStatus =
  | 'planned'
  | 'waiting'
  | 'ready'
  | 'running'
  | 'blocked'
  | 'implemented'
  | 'failed'
  | 'cancelled'

export type MissionPlanningMode = 'deterministic' | 'agent'
export type MissionExecutionMode = 'auto_ready_tasks' | 'manual'
export type MissionTaskExecutionMode = 'single_agent' | 'swarm' | 'manual'
export type MissionRisk = 'low' | 'medium' | 'high'
export type MissionOrigin = 'manual' | 'issue' | 'automation'
export type MissionPreflightStatus = 'not_started' | 'running' | 'completed' | 'failed'

export type AcceptanceCriterionStatus =
  | 'unverified'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'waived'

export type AcceptanceCriterionKind = 'behavioral' | 'structural' | 'automated' | 'manual'

export type MissionBlockerKind =
  | 'approval'
  | 'provider'
  | 'launch_failed'
  | 'repository'
  | 'dependency'
  | 'user_decision'
  | 'interrupted'

export type MissionTaskOutputKind =
  | 'finding'
  | 'interface_change'
  | 'decision'
  | 'artifact'
  | 'dependency_note'
  | 'risk'
  | 'blocker'

export type MissionEventKind =
  | 'created'
  | 'preflight_started'
  | 'preflight_completed'
  | 'preflight_failed'
  | 'planning_started'
  | 'plan_created'
  | 'plan_revised'
  | 'planning_failed'
  | 'ready'
  | 'started'
  | 'blocked'
  | 'unblocked'
  | 'task_ready'
  | 'task_started'
  | 'task_completed'
  | 'task_failed'
  | 'task_blocked'
  | 'task_cancelled'
  | 'task_output_recorded'
  | 'execution_completed'
  | 'review_ready'
  | 'recovered'
  | 'cancelled'
  | 'completed'
  | 'failed'

export interface Mission {
  id: string
  projectId: string
  workspaceId: string | null
  title: string
  objective: string
  description: string | null
  constraints: string[]
  nonGoals: string[]
  risks: string[]
  verificationPlan: string | null
  status: MissionStatus
  statusReason: string | null
  riskLevel: MissionRisk
  origin: MissionOrigin
  createdBy: string
  planningMode: MissionPlanningMode
  executionMode: MissionExecutionMode
  defaultProviderId: string | null
  defaultModelId: string | null
  defaultAgentProfileId: string | null
  defaultIsolation: string
  preflightStatus: MissionPreflightStatus
  planRevision: number
  planningRunId: string | null
  failureCode: string | null
  failureMessage: string | null
  acceptedBy: string | null
  acceptedAt: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
  cancelledAt: string | null
}

export interface MissionTask {
  id: string
  missionId: string
  projectId: string
  key: string
  title: string
  objective: string
  description: string | null
  focusFiles: string[]
  status: MissionTaskStatus
  statusReason: string | null
  sequence: number
  riskLevel: MissionRisk
  executionMode: MissionTaskExecutionMode
  providerId: string | null
  modelId: string | null
  agentProfileId: string | null
  isolation: string | null
  blockerKind: MissionBlockerKind | null
  blockerMessage: string | null
  requiredAction: string | null
  currentRunId: string | null
  attemptCount: number
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface AcceptanceCriterion {
  id: string
  missionId: string
  projectId: string
  key: string
  sequence: number
  title: string
  description: string
  kind: AcceptanceCriterionKind
  required: boolean
  status: AcceptanceCriterionStatus
  verificationHint: string | null
  waivedReason: string | null
  waivedBy: string | null
  retiredAt: string | null
  createdAt: string
  updatedAt: string
}

export interface MissionTaskDependency {
  missionId: string
  taskId: string
  dependsOnTaskId: string
}

export interface MissionTaskCriterionLink {
  taskId: string
  criterionId: string
}

export interface MissionPreflightReference {
  id: string
  title: string
  kind: string
  stale: boolean
}

export interface MissionPreflightProvenance {
  source: string
  detail: string
  available: boolean
}

export interface MissionPreflight {
  missionId: string
  projectId: string
  status: MissionPreflightStatus
  summary: string
  relevantComponents: string[]
  likelyFiles: string[]
  architectureMemories: MissionPreflightReference[]
  relatedChanges: string[]
  testAreas: string[]
  environment: string[]
  riskFindings: string[]
  estimatedImpact: MissionRisk
  planningContextPackId: string | null
  provenance: MissionPreflightProvenance[]
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface MissionProgress {
  total: number
  implemented: number
  running: number
  ready: number
  waiting: number
  blocked: number
  failed: number
  cancelled: number
  criteriaTotal: number
  criteriaVerified: number
  criteriaWaived: number
}

export interface MissionDetail {
  mission: Mission
  criteria: AcceptanceCriterion[]
  tasks: MissionTask[]
  dependencies: MissionTaskDependency[]
  taskCriteria: MissionTaskCriterionLink[]
  preflight: MissionPreflight | null
  progress: MissionProgress
}

export interface MissionSummary {
  mission: Mission
  progress: MissionProgress
  activeRuns: number
}

export interface MissionEventRecord {
  id: string
  missionId: string
  projectId: string
  sequence: number
  kind: MissionEventKind
  status: MissionStatus | null
  taskId: string | null
  runId: string | null
  summary: string
  level: string
  metadata: unknown
  createdAt: string
}

export interface MissionPlanRevision {
  id: string
  missionId: string
  revision: number
  createdBy: string
  reason: string
  snapshot: unknown
  createdAt: string
}

export interface MissionTaskOutput {
  id: string
  missionId: string
  taskId: string
  runId: string | null
  kind: MissionTaskOutputKind
  title: string
  detail: string
  metadata: unknown
  createdAt: string
}

export interface MissionQuery {
  projectId: string
  statuses?: MissionStatus[]
  activeOnly?: boolean
  needsAttentionOnly?: boolean
  limit?: number
}

export interface CreateMissionRequest {
  projectId: string
  workspaceId?: string
  title?: string
  objective: string
  description?: string
  constraints?: string[]
  nonGoals?: string[]
  risks?: string[]
  verificationPlan?: string
  planningMode?: MissionPlanningMode
  executionMode?: MissionExecutionMode
  defaultProviderId?: string
  defaultModelId?: string
  defaultIsolation?: string
  origin?: MissionOrigin
}

export interface MissionPlanCriterionDraft {
  key: string
  title: string
  description?: string
  kind?: AcceptanceCriterionKind
  required?: boolean
  verificationHint?: string
}

export interface MissionPlanTaskDraft {
  key: string
  title: string
  objective?: string
  description?: string
  dependsOn?: string[]
  criteria?: string[]
  focusFiles?: string[]
  executionMode?: MissionTaskExecutionMode
  providerId?: string
  modelId?: string
  isolation?: string
  riskLevel?: MissionRisk
}

export interface MissionPlanDraft {
  summary?: string
  criteria: MissionPlanCriterionDraft[]
  tasks: MissionPlanTaskDraft[]
  riskLevel?: MissionRisk
}

/** Emitted by the backend on every durable Mission change. */
export interface MissionChangedEvent {
  projectId: string
  missionId: string
  taskId: string | null
  runId: string | null
  status: MissionStatus
  kind: MissionEventKind
  sequence: number
  updatedAt: string
}

const TERMINAL_STATUSES: readonly MissionStatus[] = ['completed', 'failed', 'cancelled']

export function isMissionTerminal(status: MissionStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** States that are waiting on a person rather than on the machine. */
export function missionNeedsAttention(status: MissionStatus): boolean {
  return status === 'blocked' || status === 'review_ready'
}

export function missionStatusLabel(status: MissionStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'preflight':
      return 'Analysing'
    case 'planning':
      return 'Planning'
    case 'ready':
      return 'Ready to build'
    case 'running':
      return 'Running'
    case 'blocked':
      return 'Blocked'
    case 'verifying':
      return 'Verifying'
    case 'review_ready':
      return 'Ready for review'
    case 'completed':
      return 'Accepted'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

/**
 * Tone token consumed by the Mission surfaces. Kept separate from the label so styling never has
 * to parse copy, and mapped onto the same five semantic tones the Run surfaces already use.
 */
export function missionStatusTone(
  status: MissionStatus,
): 'neutral' | 'active' | 'attention' | 'success' | 'danger' {
  switch (status) {
    case 'draft':
    case 'ready':
      return 'neutral'
    case 'preflight':
    case 'planning':
    case 'running':
    case 'verifying':
      return 'active'
    case 'blocked':
    case 'review_ready':
      return 'attention'
    case 'completed':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'danger'
  }
}

export function taskStatusLabel(status: MissionTaskStatus): string {
  switch (status) {
    case 'planned':
      return 'Planned'
    case 'waiting':
      return 'Waiting'
    case 'ready':
      return 'Ready'
    case 'running':
      return 'Running'
    case 'blocked':
      return 'Blocked'
    case 'implemented':
      return 'Implemented'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

export function taskStatusTone(
  status: MissionTaskStatus,
): 'neutral' | 'active' | 'attention' | 'success' | 'danger' {
  switch (status) {
    case 'planned':
    case 'waiting':
    case 'ready':
      return 'neutral'
    case 'running':
      return 'active'
    case 'blocked':
      return 'attention'
    case 'implemented':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'danger'
  }
}

/**
 * The glyph the Task list uses. Deliberately three states a person can scan at a distance —
 * done, active, not started — rather than eight shapes nobody can tell apart.
 */
export function taskGlyph(status: MissionTaskStatus): string {
  switch (status) {
    case 'implemented':
      return '✓'
    case 'running':
      return '●'
    case 'failed':
    case 'cancelled':
      return '×'
    case 'blocked':
      return '!'
    default:
      return '○'
  }
}

export function criterionStatusLabel(status: AcceptanceCriterionStatus): string {
  switch (status) {
    case 'unverified':
      return 'Unverified'
    case 'verifying':
      return 'Verifying'
    case 'verified':
      return 'Verified'
    case 'failed':
      return 'Failed'
    case 'waived':
      return 'Waived'
  }
}

export function blockerLabel(kind: MissionBlockerKind): string {
  switch (kind) {
    case 'approval':
      return 'Needs approval'
    case 'provider':
      return 'Agent unavailable'
    case 'launch_failed':
      return 'Could not launch'
    case 'repository':
      return 'Repository conflict'
    case 'dependency':
      return 'Blocked dependency'
    case 'user_decision':
      return 'Needs a decision'
    case 'interrupted':
      return 'Interrupted'
  }
}

export function riskLabel(risk: MissionRisk): string {
  switch (risk) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
  }
}

/**
 * Counts, not a percentage. "3 / 7 implemented, 2 running, 1 blocked" is a fact a person can
 * check against the Task list; a completion percentage is a number nobody can verify.
 */
export function progressSummary(progress: MissionProgress): string {
  if (progress.total === 0) return 'No Tasks planned yet'
  const parts = [`${progress.implemented} / ${progress.total} implemented`]
  if (progress.running > 0) parts.push(`${progress.running} running`)
  if (progress.blocked > 0) parts.push(`${progress.blocked} blocked`)
  if (progress.failed > 0) parts.push(`${progress.failed} failed`)
  if (progress.waiting > 0) parts.push(`${progress.waiting} waiting`)
  if (progress.ready > 0) parts.push(`${progress.ready} ready`)
  return parts.join(' · ')
}

/**
 * How many Acceptance Criteria are still unverified, as a sentence that does not overclaim.
 * Nothing in Paralith verifies a criterion yet, so this exists to keep that visible rather than
 * letting an implemented Mission read as a proven one.
 */
export function criteriaSummary(progress: MissionProgress): string {
  if (progress.criteriaTotal === 0) return 'No Acceptance Criteria defined'
  const outstanding =
    progress.criteriaTotal - progress.criteriaVerified - progress.criteriaWaived
  if (outstanding === 0) return `${progress.criteriaTotal} defined · all accounted for`
  return `${progress.criteriaTotal} defined · ${outstanding} unverified`
}

/** Dependency keys for one Task, resolved against the Task list. */
export function dependencyKeys(
  taskId: string,
  tasks: MissionTask[],
  dependencies: MissionTaskDependency[],
): string[] {
  const keyById = new Map(tasks.map((task) => [task.id, task.key]))
  return dependencies
    .filter((edge) => edge.taskId === taskId)
    .map((edge) => keyById.get(edge.dependsOnTaskId) ?? edge.dependsOnTaskId)
}

/**
 * Layer the Task graph for display: layer 0 has no dependencies, layer *n* depends only on
 * earlier layers. Tasks in the same layer are genuinely independent, which is what makes the
 * graph view worth drawing at all.
 *
 * A graph the backend refuses to persist cannot reach here, but this still terminates on one:
 * anything unresolved after a full pass is appended rather than looped over forever.
 */
export function graphLayers(
  tasks: MissionTask[],
  dependencies: MissionTaskDependency[],
): MissionTask[][] {
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const placed = new Set<string>()
  const layers: MissionTask[][] = []

  while (remaining.size > 0) {
    const layer = [...remaining.values()].filter((task) =>
      dependencies
        .filter((edge) => edge.taskId === task.id)
        .every((edge) => placed.has(edge.dependsOnTaskId) || !remaining.has(edge.dependsOnTaskId)),
    )
    if (layer.length === 0) {
      // Unreachable with a validated DAG; degrade to a flat layer rather than spin.
      layers.push([...remaining.values()])
      break
    }
    layer.sort((a, b) => a.sequence - b.sequence)
    layers.push(layer)
    for (const task of layer) {
      placed.add(task.id)
      remaining.delete(task.id)
    }
  }
  return layers
}

export function formatElapsed(from: string | null, to: string | null, now = Date.now()): string {
  if (!from) return ''
  const started = Date.parse(from)
  if (Number.isNaN(started)) return ''
  const end = to ? Date.parse(to) : now
  if (Number.isNaN(end)) return ''
  const seconds = Math.max(0, Math.floor((end - started) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
