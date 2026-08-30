// TypeScript mirror of the Paralith Orchestration Kernel's IPC contract. Enum-like unions use the
// backend's snake_case serialization; struct fields are camelCase. Keep in sync with
// `src-tauri/src/orchestration/model.rs` and `registry.rs`.

export type OriginatingSurface =
  | 'invocation_bar'
  | 'compact_card'
  | 'control_center'
  | 'contextual'
  | 'voice'
  | 'system'

export type OperatingMode = 'observe' | 'assist' | 'execute' | 'autopilot'

export type SessionState =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'understanding'
  | 'collecting_context'
  | 'planning'
  | 'awaiting_approval'
  | 'executing'
  | 'waiting_for_agent'
  | 'verifying'
  | 'paused'
  | 'recovering'
  | 'completed'
  | 'partially_completed'
  | 'cancelled'
  | 'failed'

export type TurnActor = 'user' | 'orchestrator' | 'system' | 'capability' | 'agent'
export type InputType = 'text' | 'voice' | 'system' | 'capability' | 'agent'
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'
export type Reversibility = 'not_applicable' | 'paired' | 'via_git' | 'none'
export type ExecutionState =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'approval_required'
  | 'unavailable'
export type CapabilityDomain =
  | 'projects'
  | 'workspaces'
  | 'terminals'
  | 'files'
  | 'browser'
  | 'git'
  | 'agents'
  | 'swarms'
  | 'memory'
  | 'settings'
  | 'app'

export interface OrchestrationSession {
  id: string
  title: string
  originatingSurface: OriginatingSurface
  projectId: string | null
  workspaceId: string | null
  operatingMode: OperatingMode
  state: SessionState
  objective: string
  normalizedObjective: string | null
  failureClassification: string | null
  tokenBudget: number | null
  tokensUsed: number
  provider: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface OrchestrationTurn {
  id: string
  sessionId: string
  actor: TurnActor
  inputType: InputType
  content: string
  transcriptConfidence: number | null
  createdAt: string
}

export interface OrchestrationEvent {
  id: string
  sessionId: string
  sequence: number
  eventType: string
  payloadJson: string
  source: string
  createdAt: string
}

export interface CapabilityExecution {
  id: string
  sessionId: string
  capabilityId: string
  riskLevel: RiskLevel
  validatedInputsJson: string
  sanitizedResultJson: string | null
  state: ExecutionState
  errorClassification: string | null
  durationMs: number | null
  createdAt: string
  completedAt: string | null
}

export interface OrchestrationSessionView {
  session: OrchestrationSession
  turns: OrchestrationTurn[]
  events: OrchestrationEvent[]
  executions: CapabilityExecution[]
}

export interface CapabilityDescriptor {
  id: string
  displayName: string
  domain: CapabilityDomain
  description: string
  argSchema: unknown
  requiresProjectScope: boolean
  risk: RiskLevel
  reversibility: Reversibility
  mutates: boolean
  timeoutMs: number
  audited: boolean
  available: boolean
  unavailableReason: string | null
}

export interface OrchestratorError {
  code: string
  message: string
  recoverable: boolean
  detail?: string | null
  recommendedAction?: string | null
}

export interface CapabilityOutcome {
  execution: CapabilityExecution
  result: unknown | null
  error: OrchestratorError | null
}

export interface CreateSessionRequest {
  objective: string
  originatingSurface: OriginatingSurface
  operatingMode?: OperatingMode
  projectId?: string | null
  workspaceId?: string | null
  transcriptConfidence?: number | null
}

export interface ExecuteCapabilityRequest {
  sessionId: string
  capabilityId: string
  arguments: Record<string, unknown>
  approved: boolean
}
