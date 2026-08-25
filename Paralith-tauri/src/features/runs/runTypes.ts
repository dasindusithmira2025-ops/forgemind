// TypeScript mirror of the canonical Run Engine IPC contract. Enum-like unions use the backend's
// snake_case serialization; struct fields are camelCase. Keep in sync with
// `src-tauri/src/models/run.rs`.

export type RunStatus =
  | 'queued'
  | 'preparing'
  | 'waiting_environment'
  | 'waiting_approval'
  | 'running'
  | 'verifying'
  | 'review_ready'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type RunType =
  | 'agent_task'
  | 'swarm_coordinator'
  | 'swarm_worker'
  | 'verification'
  | 'qa'
  | 'security_review'
  | 'automation'
  | 'goal_iteration'
  | 'pr_repair'

export type RunExecutionStrategy = 'single_agent' | 'swarm'

export type RunIsolation = 'shared_read_only' | 'current_worktree' | 'isolated_worktree'

export type RunTriggerSource = 'manual' | 'engine' | 'automation' | 'recovery'

export type RunEventKind =
  | 'created'
  | 'queued'
  | 'preparing'
  | 'context_compiled'
  | 'worktree_attached'
  | 'agent_attached'
  | 'started'
  | 'approval_requested'
  | 'approval_resolved'
  | 'blocked'
  | 'verification_started'
  | 'review_ready'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'
  | 'child_run_attached'

export type RunApprovalStatus = 'open' | 'approved' | 'denied' | 'expired'

export interface Run {
  id: string
  projectId: string
  workspaceId: string | null
  parentRunId: string | null
  rootRunId: string
  retryOfRunId: string | null
  swarmId: string | null
  swarmTaskId: string | null
  runType: RunType
  executionStrategy: RunExecutionStrategy
  isolation: RunIsolation
  objective: string
  providerId: string | null
  modelId: string | null
  reasoningEffort: string | null
  terminalSessionId: string | null
  providerSessionId: string | null
  workingDirectory: string | null
  worktreePath: string | null
  branchName: string | null
  contextPackId: string | null
  status: RunStatus
  statusReason: string | null
  triggerSource: RunTriggerSource
  requestedBy: string
  errorCode: string | null
  errorMessage: string | null
  resultSummary: string | null
  createdAt: string
  queuedAt: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  metadata: unknown
}

export interface RunEventRecord {
  id: string
  runId: string
  projectId: string
  sequence: number
  kind: RunEventKind
  status: RunStatus | null
  summary: string
  level: string
  metadata: unknown
  createdAt: string
}

export interface RunApproval {
  id: string
  runId: string
  projectId: string
  kind: string
  summary: string
  payload: unknown
  status: RunApprovalStatus
  decidedBy: string | null
  decisionNote: string | null
  createdAt: string
  decidedAt: string | null
}

export interface RunDetail {
  run: Run
  events: RunEventRecord[]
  approvals: RunApproval[]
  children: Run[]
}

export interface RunInboxSummary {
  running: number
  waitingApproval: number
  reviewReady: number
  failed: number
  interrupted: number
}

export interface RunQuery {
  projectId: string
  workspaceId?: string
  parentRunId?: string
  swarmId?: string
  activeOnly?: boolean
  needsAttentionOnly?: boolean
  statuses?: RunStatus[]
  limit?: number
}

export interface CreateRunRequest {
  projectId: string
  workspaceId?: string
  objective: string
  parentRunId?: string
  retryOfRunId?: string
  swarmId?: string
  swarmTaskId?: string
  runType: RunType
  executionStrategy: RunExecutionStrategy
  isolation: RunIsolation
  providerId?: string
  modelId?: string
  reasoningEffort?: string
  focusFiles?: string[]
  idempotencyKey?: string
  triggerSource?: RunTriggerSource
  metadata?: unknown
}

/** Emitted by the backend on every durable Run change. */
export interface RunChangedEvent {
  projectId: string
  runId: string
  rootRunId: string
  parentRunId: string | null
  swarmId: string | null
  status: RunStatus
  kind: RunEventKind
  sequence: number
  updatedAt: string
}

/** States that hold or may still acquire resources. Mirrors `RunStatus::is_active`. */
const ACTIVE_STATUSES: readonly RunStatus[] = [
  'queued',
  'preparing',
  'waiting_environment',
  'waiting_approval',
  'running',
  'verifying',
  'review_ready',
]

const TERMINAL_STATUSES: readonly RunStatus[] = ['succeeded', 'failed', 'cancelled']

export function isRunActive(status: RunStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

export function isRunTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

/** States that are waiting on a person rather than on the machine. */
export function runNeedsAttention(status: RunStatus): boolean {
  return status === 'waiting_approval' || status === 'review_ready'
}

export function runStatusLabel(status: RunStatus): string {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'preparing':
      return 'Preparing'
    case 'waiting_environment':
      return 'Waiting for environment'
    case 'waiting_approval':
      return 'Needs approval'
    case 'running':
      return 'Running'
    case 'verifying':
      return 'Verifying'
    case 'review_ready':
      return 'Ready for review'
    case 'succeeded':
      return 'Succeeded'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return 'Interrupted'
  }
}

/** Tone token consumed by the Run surfaces. Kept separate from the label so styling never
 * has to parse copy. */
export function runStatusTone(
  status: RunStatus,
): 'neutral' | 'active' | 'attention' | 'success' | 'danger' {
  switch (status) {
    case 'queued':
    case 'preparing':
    case 'waiting_environment':
      return 'neutral'
    case 'running':
    case 'verifying':
      return 'active'
    case 'waiting_approval':
    case 'review_ready':
    case 'interrupted':
      return 'attention'
    case 'succeeded':
      return 'success'
    case 'failed':
    case 'cancelled':
      return 'danger'
  }
}

export function runIsolationLabel(isolation: RunIsolation): string {
  switch (isolation) {
    case 'shared_read_only':
      return 'Read-only'
    case 'current_worktree':
      return 'Current worktree'
    case 'isolated_worktree':
      return 'Isolated worktree'
  }
}

/**
 * Elapsed milliseconds a Run has been executing, or its total duration once finished.
 * Returns `undefined` before execution started so callers render nothing rather than a
 * misleading zero.
 */
export function runElapsedMs(run: Run, now: number = Date.now()): number | undefined {
  if (!run.startedAt) return undefined
  const started = Date.parse(run.startedAt)
  if (Number.isNaN(started)) return undefined
  const end = run.completedAt ? Date.parse(run.completedAt) : now
  if (Number.isNaN(end)) return undefined
  return Math.max(0, end - started)
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
