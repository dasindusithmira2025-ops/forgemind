import type {
  SwarmLifecycle,
  SwarmPhase,
  SwarmRole,
  SwarmRoleConfig,
  SwarmRuntimeKind,
} from '../../native/types'

/** The five simplified stages shown in the Overview, in order. */
export const SWARM_PHASES: { key: SwarmPhase; label: string }[] = [
  { key: 'understanding', label: 'Understanding' },
  { key: 'planning', label: 'Planning' },
  { key: 'building', label: 'Building' },
  { key: 'verifying', label: 'Verifying' },
  { key: 'ready', label: 'Ready' },
]

const PHASE_ORDER: SwarmPhase[] = SWARM_PHASES.map((phase) => phase.key)

export function phaseIndex(phase: SwarmPhase): number {
  return Math.max(0, PHASE_ORDER.indexOf(phase))
}

/** Short human label for a lifecycle state. */
export function lifecycleLabel(state: SwarmLifecycle): string {
  switch (state) {
    case 'decision_required':
      return 'Decision required'
    case 'ready_for_review':
      return 'Ready for review'
    default:
      return state.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
  }
}

/** Accent tone for a lifecycle, mapped to the design system's status colors. */
export function lifecycleTone(state: SwarmLifecycle): 'neutral' | 'blue' | 'green' | 'amber' | 'red' {
  switch (state) {
    case 'building':
    case 'validating':
    case 'understanding':
    case 'planning':
    case 'preparing':
    case 'verifying':
    case 'reviewing':
    case 'recovering':
      return 'blue'
    case 'ready_for_review':
    case 'completed':
      return 'green'
    case 'decision_required':
    case 'pausing':
    case 'paused':
    case 'resuming':
    case 'stopping':
      return 'amber'
    case 'failed':
    case 'cancelled':
      return 'red'
    default:
      return 'neutral'
  }
}

export function isActiveLifecycle(state: SwarmLifecycle): boolean {
  return [
    'preparing',
    'understanding',
    'planning',
    'building',
    // Compatibility for list projections cached by pre-V2 windows during a rolling restart.
    'running',
    'validating',
    'verifying',
    'decision_required',
    'decision_needed',
    'pausing',
    'resuming',
    'stopping',
    'reviewing',
    'recovering',
  ].includes(state)
}

/** States from which the backend can checkpoint active work into Paused. Transitional stop,
 * resume, and pause states stay visible as active but must not offer a conflicting Pause action. */
export function isPausableLifecycle(state: SwarmLifecycle): boolean {
  return [
    'preparing',
    'understanding',
    'planning',
    'building',
    'running',
    'verifying',
    'reviewing',
    'decision_required',
    'decision_needed',
    'recovering',
  ].includes(state)
}

export function roleLabel(role: SwarmRole): string {
  const plural: Record<SwarmRole, string> = {
    coordinator: 'Coordinator',
    scout: 'Scout',
    builder: 'Builders',
    debugger: 'Debugger',
    reviewer: 'Reviewer',
    integrator: 'Integrator',
  }
  return plural[role]
}

/**
 * The broadcast token the backend addresses a whole role with. Must stay in step with
 * `role_target` in `swarm_service.rs` — it is what `mark_swarm_messages_delivered` matches on and
 * what the command bar's role options send.
 */
export function roleTarget(role: SwarmRole): string {
  const targets: Record<SwarmRole, string> = {
    coordinator: '@coordinator',
    scout: '@scout',
    builder: '@builders',
    debugger: '@debugger',
    reviewer: '@reviewer',
    integrator: '@integrator',
  }
  return targets[role]
}

export function progressPercent(progress: number): number {
  return Math.round(Math.max(0, Math.min(1, progress)) * 100)
}

/** All selectable agent runtimes, in display order. */
export const RUNTIME_OPTIONS: { value: SwarmRuntimeKind; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
]

export function runtimeLabel(runtime: SwarmRuntimeKind): string {
  return RUNTIME_OPTIONS.find((option) => option.value === runtime)?.label ?? runtime
}

/** Total workers a role staffs across all its allocations (zero when the role is disabled). */
export function roleTotal(role: SwarmRoleConfig): number {
  if (!role.enabled) return 0
  return role.allocations.reduce((sum, allocation) => sum + Math.max(0, allocation.count), 0)
}

/** Total staffed agents across every role — the whole team's capacity. */
export function teamCapacity(roles: SwarmRoleConfig[]): number {
  return roles.reduce((sum, role) => sum + roleTotal(role), 0)
}

/** Runtimes still available to add to a role (each runtime may appear at most once). */
export function availableRuntimes(role: SwarmRoleConfig): SwarmRuntimeKind[] {
  const used = new Set(role.allocations.map((allocation) => allocation.runtime))
  return RUNTIME_OPTIONS.map((option) => option.value).filter((runtime) => !used.has(runtime))
}

/** Compact collapsed summary of a role's allocations, e.g. "Claude ×2 + Codex ×1". */
export function describeAllocations(role: SwarmRoleConfig): string {
  const parts = role.allocations
    .filter((allocation) => allocation.count > 0)
    .map((allocation) => `${runtimeLabel(allocation.runtime)} ×${allocation.count}`)
  return parts.length > 0 ? parts.join(' + ') : 'No agents'
}

/** One-line team summary across roles, e.g. "Coordinator ×1 · Builders ×3 · Reviewer ×1". */
export function describeTeam(roles: SwarmRoleConfig[]): string {
  return roles
    .filter((role) => roleTotal(role) > 0)
    .map((role) => `${roleLabel(role.role)} ×${roleTotal(role)}`)
    .join(' · ')
}
