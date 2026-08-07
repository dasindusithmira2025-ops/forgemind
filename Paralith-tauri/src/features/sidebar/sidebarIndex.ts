import type { AgentStateEvent, TerminalSession, Workspace } from '../../native/types'
import { resolvePaneAgentStates, type PaneAgentState } from './sidebarAgentStatus'

/**
 * Identity-keyed projections over the sidebar's inputs.
 *
 * The sidebar re-derives on every runtime event, and a runtime event fires for reasons that have
 * nothing to do with the row being looked at — a Session in another Project, an agent state in a
 * Workspace three groups down. Caching on the *identity* of the input collection rather than on a
 * dependency list means an unrelated change costs one map lookup instead of a full rescan, and a
 * genuinely unchanged input returns the same object so downstream memoisation holds too.
 *
 * `WeakMap` rather than a plain cache: the keys are store snapshots that get replaced constantly,
 * and pinning replaced snapshots in a strong map is a leak that grows for as long as the app runs.
 */

const sessionsByWorkspaceCache = new WeakMap<TerminalSession[], Map<string, TerminalSession[]>>()
const workspaceMapCache = new WeakMap<Workspace[], Map<string, Workspace>>()

type PaneAgentStateCache = {
  sessions: TerminalSession[]
  agentStates: Record<string, AgentStateEvent>
  /** Bucketed to the resolution below so a moving clock alone cannot invalidate the cache. */
  bucket: number
  byWorkspace: Map<string, PaneAgentState[]>
}

/**
 * How coarsely the agent-state resolution rounds `now`. The only time-dependent decision it makes
 * is whether a `working` state has gone stale, which is a 90-second question; re-resolving on
 * every millisecond of a render clock would defeat the cache entirely for no extra truth.
 */
const AGENT_STATE_CLOCK_BUCKET_MS = 5_000

let paneAgentStateCache: PaneAgentStateCache | null = null

/**
 * Group live Sessions by Workspace id, so per-row runtime summaries derive from a single global
 * snapshot instead of one subscription per Workspace.
 */
export function getSessionsByWorkspace(sessions: TerminalSession[]): Map<string, TerminalSession[]> {
  const cached = sessionsByWorkspaceCache.get(sessions)
  if (cached) return cached
  const grouped = new Map<string, TerminalSession[]>()
  for (const session of sessions) {
    const list = grouped.get(session.workspaceId)
    if (list) list.push(session)
    else grouped.set(session.workspaceId, [session])
  }
  sessionsByWorkspaceCache.set(sessions, grouped)
  return grouped
}

/** Index a Workspace list by id for O(1) row lookups during row building. */
export function getWorkspaceMap(workspaces: Workspace[]): Map<string, Workspace> {
  const cached = workspaceMapCache.get(workspaces)
  if (cached) return cached
  const map = new Map(workspaces.map((workspace) => [workspace.id, workspace]))
  workspaceMapCache.set(workspaces, map)
  return map
}

/**
 * Resolve every Workspace's usable per-Pane agent states in one pass.
 *
 * Keyed on both inputs *and* a coarse clock bucket: unlike the other projections this one is not a
 * pure function of its collections, because a `working` state expires with time. Bucketing keeps
 * that honest without making the cache useless.
 */
export function getPaneAgentStatesByWorkspace(
  sessions: TerminalSession[],
  agentStates: Record<string, AgentStateEvent>,
  now: number,
): Map<string, PaneAgentState[]> {
  const bucket = Math.floor(now / AGENT_STATE_CLOCK_BUCKET_MS)
  const cached = paneAgentStateCache
  if (
    cached &&
    cached.sessions === sessions &&
    cached.agentStates === agentStates &&
    cached.bucket === bucket
  ) {
    return cached.byWorkspace
  }

  const byWorkspace = new Map<string, PaneAgentState[]>()
  for (const [workspaceId, workspaceSessions] of getSessionsByWorkspace(sessions)) {
    const resolved = resolvePaneAgentStates(workspaceSessions, agentStates, workspaceId, now)
    if (resolved.length > 0) byWorkspace.set(workspaceId, resolved)
  }
  paneAgentStateCache = { sessions, agentStates, bucket, byWorkspace }
  return byWorkspace
}

/** Drop the module-level clock-bucketed cache. Tests only — the WeakMaps need no reset. */
export function resetSidebarIndexCachesForTest(): void {
  paneAgentStateCache = null
}
