import type { AgentActivityState, AgentStateEvent, TerminalSession } from '../../native/types'

/**
 * How long a `working` agent state stays trustworthy without a fresh event.
 *
 * Only `working` ages out. A Pane that is *waiting* on a human emits its state once and then goes
 * deliberately silent — that is what waiting means — so expiring it would erase exactly the signal
 * the sidebar exists to surface. Orca's smart sort applies one blanket freshness window because
 * its agent hooks re-emit on a heartbeat; ours do not, so the window is scoped to the one state
 * whose silence is ambiguous rather than meaningful.
 */
export const WORKING_STATE_STALE_AFTER_MS = 90_000

/**
 * What a Pane's agent is asking of the person in front of it. Deliberately coarser than
 * `AgentActivityState`: the sidebar ranks by *how much a human is needed*, and the distinction
 * between "needs input" and "needs permission" does not change that ranking.
 */
export type AgentAttention =
  /** A human must act before anything else happens. */
  | 'needs_you'
  /** The agent is making progress on its own. */
  | 'working'
  /** The agent finished cleanly and is holding. */
  | 'settled'
  /** Nothing to assert. */
  | 'none'

/** Map one reported activity state onto what it asks of the user. */
export function agentAttentionFor(state: AgentActivityState): AgentAttention {
  switch (state) {
    case 'needs_input':
    case 'needs_permission':
    // A failed agent is still a live Pane whose process may be sitting at a prompt; the human has
    // to decide what happens next, so it ranks with the other states that block on a person.
    case 'failed':
      return 'needs_you'
    case 'working':
      return 'working'
    case 'finished':
      return 'settled'
    case 'idle':
      return 'none'
  }
}

/**
 * Whether an agent state may still be believed. See `WORKING_STATE_STALE_AFTER_MS` for why only
 * `working` decays: a state that means "I am blocked" is not made false by the passage of time.
 */
export function isAgentStateUsable(event: AgentStateEvent, now: number, ttl = WORKING_STATE_STALE_AFTER_MS): boolean {
  if (event.state !== 'working') return true
  const updatedAt = Date.parse(event.updatedAt)
  // An unparseable timestamp is treated as fresh: dropping a real `working` claim because the
  // backend sent an odd string would make the Workspace look idle while it is mid-task.
  if (!Number.isFinite(updatedAt)) return true
  return now - updatedAt < ttl
}

/** One Pane's agent state as the runtime derivation consumes it. */
export interface PaneAgentState {
  paneId: string
  attention: AgentAttention
  /** When the Pane started asking for a human, if it is asking. Drives the attention ordering. */
  attentionSince?: string
}

/**
 * Resolve the usable agent states of one Workspace, keyed by Pane.
 *
 * Gated on live Sessions: an agent state outlives the Session that reported it (the event index is
 * keyed by Pane, not Session, so a restarted Pane keeps its identity), and a Pane whose terminal
 * has exited is not waiting for anybody. Without the gate a Workspace that was stopped mid-prompt
 * would keep claiming it needs attention forever.
 */
export function resolvePaneAgentStates(
  sessions: TerminalSession[],
  agentStatesByPane: Record<string, AgentStateEvent>,
  workspaceId: string,
  now: number,
): PaneAgentState[] {
  const livePaneIds = new Set(
    sessions
      .filter((session) => session.workspaceId === workspaceId && session.status === 'running')
      .map((session) => session.paneId),
  )
  const resolved: PaneAgentState[] = []
  for (const paneId of livePaneIds) {
    const event = agentStatesByPane[`${workspaceId}:${paneId}`]
    if (!event || !isAgentStateUsable(event, now)) continue
    const attention = agentAttentionFor(event.state)
    if (attention === 'none') continue
    resolved.push({ paneId, attention, attentionSince: event.attentionSince })
  }
  return resolved
}

/** How many of a Workspace's Panes are blocked on a human right now. */
export function countPanesNeedingAttention(states: PaneAgentState[]): number {
  return states.filter((state) => state.attention === 'needs_you').length
}

/**
 * The earliest moment any of this Workspace's Panes started waiting, or undefined when none is.
 * Used to order Workspaces within the same attention class: the one that has been blocked longest
 * is the one a person has been ignoring longest.
 */
export function earliestAttentionSince(states: PaneAgentState[]): string | undefined {
  let earliest: string | undefined
  for (const state of states) {
    if (state.attention !== 'needs_you' || !state.attentionSince) continue
    if (!earliest || state.attentionSince.localeCompare(earliest) < 0) earliest = state.attentionSince
  }
  return earliest
}
