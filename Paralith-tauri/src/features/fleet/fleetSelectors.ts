import type { AgentActivityState, AgentStateEvent } from '../../native/types'

/**
 * The fleet model behind the Fleet Bar.
 *
 * Paralith already computed the ordered attention queue and threw away everything except its
 * length: the workspace title bar said "3 agents waiting" and the status bar said "3 agent
 * attention". A count cannot answer the only question the operator actually has — *which* agent,
 * and *how long* has it been sitting there. `attentionSince` was on the wire the whole time.
 *
 * So the fleet is a queue ordered by wait time, never by layout position. Wasted parallelism is a
 * duration, not a threshold, which is why every waiting cell carries a live timer and a pressure
 * step rather than an alarm that trips at some arbitrary minute.
 */
export type FleetCellState = 'waiting' | 'blocked' | 'working' | 'idle' | 'paused'

export interface FleetPaneInput {
  paneId: string
  title: string
  running: boolean
  deferred: boolean
  agentState?: AgentStateEvent
}

export interface FleetCell {
  paneId: string
  title: string
  state: FleetCellState
  /** ISO timestamp this agent started waiting. Present only for `waiting` and `blocked`. */
  waitingSince?: string
  /** Why the runtime believes this, for the tooltip. */
  reason?: string
}

/** Cells the operator has to act on. Everything else is fleet background. */
export const ATTENTION_STATES: FleetCellState[] = ['waiting', 'blocked']

export function isAttention(cell: FleetCell): boolean {
  return ATTENTION_STATES.includes(cell.state)
}

function cellState(input: FleetPaneInput): FleetCellState {
  if (input.deferred) return 'paused'
  const agent = input.agentState
  if (agent?.attentionSince) return agent.state === 'failed' ? 'blocked' : 'waiting'
  if (agent?.state === 'failed') return 'blocked'
  if (agent?.state === 'working') return 'working'
  if (!input.running) return 'paused'
  return 'idle'
}

/**
 * Order: everything waiting on a human first, oldest wait at the head, then working, then quiet
 * panes. Ties break on pane title so the bar never reshuffles between renders that carry the same
 * information.
 */
const STATE_RANK: Record<FleetCellState, number> = {
  blocked: 0,
  waiting: 1,
  working: 2,
  idle: 3,
  paused: 4,
}

export function buildFleet(panes: FleetPaneInput[]): FleetCell[] {
  return panes
    .map((input): FleetCell => {
      const state = cellState(input)
      const attention = state === 'waiting' || state === 'blocked'
      return {
        paneId: input.paneId,
        title: input.title,
        state,
        waitingSince: attention ? input.agentState?.attentionSince : undefined,
        reason: input.agentState?.reason,
      }
    })
    .sort((a, b) => {
      const rank = STATE_RANK[a.state] - STATE_RANK[b.state]
      if (rank !== 0) return rank
      if (a.waitingSince && b.waitingSince && a.waitingSince !== b.waitingSince) {
        return a.waitingSince.localeCompare(b.waitingSince)
      }
      return a.title.localeCompare(b.title)
    })
}

export function attentionCells(cells: FleetCell[]): FleetCell[] {
  return cells.filter(isAttention)
}

/** Milliseconds a cell has been waiting on a human, or 0 when it is not waiting. */
export function waitedMs(cell: FleetCell, now: number): number {
  if (!cell.waitingSince) return 0
  const since = new Date(cell.waitingSince).getTime()
  if (Number.isNaN(since)) return 0
  return Math.max(0, now - since)
}

/**
 * Compact, non-jittering wait duration. Seconds below a minute, whole minutes below an hour, then
 * hours and minutes — always at most four characters so the bar does not reflow as time passes.
 */
export function waitLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h${minutes % 60 > 0 ? `${minutes % 60}m` : ''}`
}

/** Wait pressure as four discrete steps. Discrete so the bar cannot shimmer, and so the height
 * still reads under `prefers-reduced-motion` where a continuous transition is suppressed. */
export const PRESSURE_STEPS = [0, 30_000, 2 * 60_000, 10 * 60_000] as const

export function waitPressure(ms: number): 1 | 2 | 3 | 4 {
  if (ms >= PRESSURE_STEPS[3]) return 4
  if (ms >= PRESSURE_STEPS[2]) return 3
  if (ms >= PRESSURE_STEPS[1]) return 2
  return 1
}

/**
 * The one name for each state, used by the Fleet Bar, the pane header badge, the queue popover and
 * the status bar. Before this there were four vocabularies for one concept — "3 agents waiting",
 * "3 agent attention", "Needs review", `attentionSince` — which taught the user that they were
 * four different things.
 */
export function fleetStateLabel(state: FleetCellState): string {
  if (state === 'waiting') return 'waiting'
  if (state === 'blocked') return 'blocked'
  if (state === 'working') return 'working'
  if (state === 'paused') return 'paused'
  return 'idle'
}

/** The same vocabulary for a raw runtime state, so the pane header cannot drift from the bar. */
export function agentStateLabel(state: AgentActivityState): string {
  if (state === 'needs_input' || state === 'needs_permission') return 'waiting'
  if (state === 'failed') return 'blocked'
  if (state === 'finished') return 'finished'
  return state
}

export interface FleetRollup {
  total: number
  running: number
  waiting: number
  blocked: number
  /** The head of the queue: the ISO timestamp of the longest-running wait, if any. */
  oldestWaitSince?: string
}

/**
 * Roll a set of cells up to the number the launcher shows for a whole project. Same arithmetic as
 * the Fleet Bar, so the front door and the workspace can never disagree about what is waiting.
 */
export function rollupFleet(cells: FleetCell[]): FleetRollup {
  const attention = attentionCells(cells)
  const waits = attention.map((cell) => cell.waitingSince).filter((since): since is string => Boolean(since)).sort()
  return {
    total: cells.length,
    running: cells.filter((cell) => cell.state === 'working' || cell.state === 'idle').length,
    waiting: cells.filter((cell) => cell.state === 'waiting').length,
    blocked: cells.filter((cell) => cell.state === 'blocked').length,
    oldestWaitSince: waits[0],
  }
}

/** "2 waiting · 1 blocked", or undefined when nothing needs a human. */
export function fleetSummary(cells: FleetCell[]): string | undefined {
  const waiting = cells.filter((cell) => cell.state === 'waiting').length
  const blocked = cells.filter((cell) => cell.state === 'blocked').length
  const parts: string[] = []
  if (waiting > 0) parts.push(`${waiting} waiting`)
  if (blocked > 0) parts.push(`${blocked} blocked`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}
