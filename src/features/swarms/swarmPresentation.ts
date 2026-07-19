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
    case 'decision_needed':
      return 'Decision needed'
    case 'ready':
      return 'Ready for review'
    default:
      return state.charAt(0).toUpperCase() + state.slice(1)
  }
}

/** Accent tone for a lifecycle, mapped to the design system's status colors. */
export function lifecycleTone(state: SwarmLifecycle): 'neutral' | 'blue' | 'green' | 'amber' | 'red' {
  switch (state) {
    case 'running':
    case 'understanding':
    case 'planning':
    case 'preparing':
    case 'verifying':
    case 'reviewing':
    case 'recovering':
      return 'blue'
    case 'ready':
    case 'completed':
      return 'green'
    case 'decision_needed':
    case 'paused':
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
    'running',
    'verifying',
    'decision_needed',
    'stopping',
    'reviewing',
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
