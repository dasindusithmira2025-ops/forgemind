import type {
  CustomAgentAllocation,
  TerminalLaunchDefinition,
  WorkspaceLaunchPlan,
  WorkspaceSetupDraft,
} from './setupTypes'

// Pure, side-effect-free allocation domain. Everything here is deterministic for identical input
// and independent of any UI, store, or desktop runtime, so it can be unit tested in isolation.

/** Total terminals claimed by agents + custom commands. Negative counts are ignored. */
export function assignedCount(
  allocations: Record<string, number>,
  customCommands: CustomAgentAllocation[] = [],
): number {
  const agents = Object.values(allocations).reduce((sum, value) => sum + Math.max(0, value), 0)
  const custom = customCommands.reduce((sum, entry) => sum + Math.max(0, entry.count), 0)
  return agents + custom
}

/** Terminals that will fall back to the default shell. Never negative. */
export function regularTerminalCount(
  terminalCount: number,
  allocations: Record<string, number>,
  customCommands: CustomAgentAllocation[] = [],
): number {
  return Math.max(0, terminalCount - assignedCount(allocations, customCommands))
}

export function remainingCapacity(
  terminalCount: number,
  allocations: Record<string, number>,
  customCommands: CustomAgentAllocation[] = [],
): number {
  return Math.max(0, terminalCount - assignedCount(allocations, customCommands))
}

export interface CountLimits {
  terminalCount: number
  customCommands?: CustomAgentAllocation[]
  supportsMultipleInstances?: boolean
  maximumInstances?: number
}

/**
 * Apply a +/- delta to one agent's count, clamped by: zero floor, per-agent maximum (single
 * instance if the agent does not support multiples), and the total terminal capacity. Returns a
 * new allocations map; a zeroed agent is removed so serialized drafts stay tidy.
 */
export function changeCount(
  allocations: Record<string, number>,
  agentId: string,
  delta: number,
  limits: CountLimits,
): Record<string, number> {
  const current = allocations[agentId] ?? 0
  const cap = limits.supportsMultipleInstances === false ? 1 : limits.maximumInstances ?? Number.POSITIVE_INFINITY
  const otherTotal = assignedCount(allocations, limits.customCommands) - current
  const ceiling = Math.max(0, Math.min(cap, limits.terminalCount - otherTotal))
  const next = Math.max(0, Math.min(current + delta, ceiling))
  const result = { ...allocations }
  if (next <= 0) delete result[agentId]
  else result[agentId] = next
  return result
}

export interface EligibleAgent {
  id: string
  maximumInstances?: number
  supportsMultipleInstances?: boolean
}

function agentCap(agent: EligibleAgent): number {
  if (agent.supportsMultipleInstances === false) return 1
  return agent.maximumInstances ?? Number.POSITIVE_INFINITY
}

/** One instance of each ready agent, in order, until capacity runs out. Replaces any prior map. */
export function oneOfEach(agents: EligibleAgent[], terminalCount: number): Record<string, number> {
  const result: Record<string, number> = {}
  let used = 0
  for (const agent of agents) {
    if (used >= terminalCount) break
    if (agentCap(agent) < 1) continue
    result[agent.id] = 1
    used += 1
  }
  return result
}

/**
 * Distribute every terminal slot across the given agents. Fills one instance per agent per pass
 * (respecting per-agent caps), so uneven totals favour earlier agents deterministically —
 * e.g. 5 terminals across two agents becomes 3 and 2.
 */
export function splitEvenly(agents: EligibleAgent[], terminalCount: number): Record<string, number> {
  const result: Record<string, number> = {}
  if (agents.length === 0) return result
  let remaining = terminalCount
  let progressed = true
  while (remaining > 0 && progressed) {
    progressed = false
    for (const agent of agents) {
      if (remaining <= 0) break
      if ((result[agent.id] ?? 0) >= agentCap(agent)) continue
      result[agent.id] = (result[agent.id] ?? 0) + 1
      remaining -= 1
      progressed = true
    }
  }
  return result
}

/** Top up one agent until the workspace is full or its per-agent cap is reached. */
export function fillRemaining(
  allocations: Record<string, number>,
  agentId: string,
  terminalCount: number,
  customCommands: CustomAgentAllocation[] = [],
  cap = Number.POSITIVE_INFINITY,
): Record<string, number> {
  const current = allocations[agentId] ?? 0
  const capacityLeft = remainingCapacity(terminalCount, allocations, customCommands)
  const room = Math.min(capacityLeft, Math.max(0, cap - current))
  const next = current + room
  const result = { ...allocations }
  if (next > 0) result[agentId] = next
  return result
}

/**
 * Deterministically shrink allocations so they fit within `capacity`. Custom commands are shed
 * first (most-recently added first), then agents from the end of the registry order, so the
 * highest-priority configured coding agents keep their instances. Idempotent within capacity.
 */
export function reduceToCapacity(
  allocations: Record<string, number>,
  customCommands: CustomAgentAllocation[],
  order: string[],
  capacity: number,
): { allocations: Record<string, number>; customCommands: CustomAgentAllocation[] } {
  const alloc: Record<string, number> = { ...allocations }
  const customs = customCommands.map((entry) => ({ ...entry }))
  let total = assignedCount(alloc, customs)
  for (let index = customs.length - 1; index >= 0 && total > capacity; index -= 1) {
    while (customs[index].count > 0 && total > capacity) {
      customs[index].count -= 1
      total -= 1
    }
  }
  const keys = order.filter((key) => (alloc[key] ?? 0) > 0)
  for (let index = keys.length - 1; index >= 0 && total > capacity; index -= 1) {
    const key = keys[index]
    while ((alloc[key] ?? 0) > 0 && total > capacity) {
      alloc[key] -= 1
      total -= 1
      if (alloc[key] <= 0) delete alloc[key]
    }
  }
  return { allocations: alloc, customCommands: customs.filter((entry) => entry.count > 0) }
}

// ---- Launch-plan compilation -------------------------------------------------------------------

interface AllocationSlot {
  key: string
  type: 'agent' | 'shell' | 'custom'
  count: number
  shellId?: string
  command?: string
}

export interface CompileContext {
  /** Canonical ordering of agent ids so distribution never depends on object-key order. */
  order: string[]
  /** Classify an allocation id as a shell (vs a coding agent). */
  isShell: (agentId: string) => boolean
  defaultShellId: string
  workingDirectory: string
}

/** Normalize a draft's allocations into a stable, ordered slot list. */
function toSlots(draft: WorkspaceSetupDraft, context: CompileContext): AllocationSlot[] {
  const agentSlots: AllocationSlot[] = context.order
    .filter((id) => (draft.agentAllocations[id] ?? 0) > 0)
    .map((id) => ({
      key: id,
      type: context.isShell(id) ? 'shell' : 'agent',
      count: draft.agentAllocations[id],
      shellId: context.isShell(id) ? id : undefined,
    }))
  const customSlots: AllocationSlot[] = draft.customCommands
    .filter((entry) => entry.count > 0)
    .map((entry) => ({ key: entry.id, type: 'custom', count: entry.count, command: entry.command }))
  return [...agentSlots, ...customSlots]
}

/**
 * Round-robin expand allocation slots into exactly `terminalCount` ordered sessions. Repeated
 * agents are spread across the layout (one per pass) rather than grouped, and any remaining panes
 * fall back to the default shell.
 */
export function distribute(
  slots: AllocationSlot[],
  terminalCount: number,
  context: CompileContext,
): TerminalLaunchDefinition[] {
  const queue = slots.filter((slot) => slot.count > 0).map((slot) => ({ slot, remaining: slot.count }))
  const sequence: AllocationSlot[] = []
  let hasRemaining = queue.length > 0
  while (hasRemaining && sequence.length < terminalCount) {
    hasRemaining = false
    for (const item of queue) {
      if (item.remaining <= 0) continue
      sequence.push(item.slot)
      item.remaining -= 1
      if (item.remaining > 0) hasRemaining = true
      if (sequence.length >= terminalCount) break
    }
  }
  const sessions: TerminalLaunchDefinition[] = []
  for (let paneIndex = 0; paneIndex < terminalCount; paneIndex += 1) {
    const slot = sequence[paneIndex]
    if (!slot) {
      sessions.push({ paneIndex, type: 'shell', shellId: context.defaultShellId, workingDirectory: context.workingDirectory })
      continue
    }
    sessions.push({
      paneIndex,
      type: slot.type,
      agentId: slot.key,
      shellId: slot.type === 'shell' ? slot.shellId ?? context.defaultShellId : context.defaultShellId,
      command: slot.command,
      workingDirectory: context.workingDirectory,
    })
  }
  return sessions
}

/** Compile a validated draft into a deterministic, runtime-independent launch plan. */
export function compileLaunchPlan(
  draft: WorkspaceSetupDraft,
  workspaceId: string,
  context: CompileContext,
): WorkspaceLaunchPlan {
  const sessions = distribute(toSlots(draft, context), draft.terminalCount, context)
  return {
    workspaceId,
    layoutId: draft.layoutId,
    workingDirectory: context.workingDirectory,
    startupCommand: draft.startupCommand?.trim() ? draft.startupCommand.trim() : undefined,
    sessions,
  }
}
