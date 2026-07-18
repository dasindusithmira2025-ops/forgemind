import type { SwarmLifecycle, SwarmPhase, SwarmRole } from '../../native/types'

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
