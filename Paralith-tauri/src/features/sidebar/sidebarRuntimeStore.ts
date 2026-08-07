import { useMemo } from 'react'
import { native } from '../../native/commands'
import { terminalRuntime, useAllAgentStates, useAllTerminalSessions } from '../terminals/runtimeStore'
import { getPaneAgentStatesByWorkspace, getSessionsByWorkspace } from './sidebarIndex'
import type { PaneAgentState } from './sidebarAgentStatus'
import type { TerminalSession } from '../../native/types'

/**
 * The sidebar's runtime view: every Workspace's live Sessions and agent states, in every open
 * Project, kept true by events rather than by asking again.
 *
 * The sidebar used to read a `liveSessionsSnapshot` that only the screen refreshed — on mount, on
 * a Workspace switch, and after explicit mutations. Everything in between was invisible: a
 * background Project's terminal could exit, or an agent could stop and wait for a person, and the
 * row kept reporting whatever was true the last time somebody happened to ask. Rows for Workspaces
 * you are *not* looking at are most of the sidebar, so that made most of it decorative.
 *
 * The fix is not a faster poll. `terminalRuntime` already receives `terminal-status`,
 * `terminal-exit` and `agent-state` for every Workspace; it simply had no cross-workspace view to
 * publish them through. This module seeds that view once from the authoritative list and then
 * lets the events carry it.
 */

let seeded = false
let seedPromise: Promise<void> | undefined

/**
 * Seed the cross-workspace runtime view from the backend's authoritative list.
 *
 * Idempotent, and safe to call from more than one mount: React Strict Mode runs effects twice, and
 * two concurrent seeds would each reconcile against a different snapshot.
 */
export async function startSidebarRuntime(): Promise<void> {
  if (seeded) return seedPromise
  seeded = true
  const pending = resyncSidebarRuntime().catch((error) => {
    // A failed seed must not wedge the sidebar into a permanently unseeded state: events still
    // arrive, and the next explicit refresh gets another attempt.
    seeded = false
    throw error
  })
  seedPromise = pending
  return pending
}

/**
 * Re-read the authoritative live-session list and reconcile the runtime view against it.
 *
 * Called at the points where the set of things worth knowing about changes — startup, and when a
 * Project is opened or closed — not on a timer. Events cover everything in between; this only
 * repairs what happened while nothing was listening.
 */
export async function resyncSidebarRuntime(): Promise<void> {
  const observedAt = new Date().toISOString()
  const sessions = await native.listLiveSessions()
  terminalRuntime.reconcileLiveSessions(sessions, observedAt)
}

/** Reset the seed latch. Tests only. */
export function resetSidebarRuntimeForTest(): void {
  seeded = false
  seedPromise = undefined
}

export interface SidebarRuntimeView {
  /** Every live Session, in every Workspace, in a stable order. */
  sessions: TerminalSession[]
  /** Live Sessions grouped by Workspace id. */
  sessionsByWorkspace: Map<string, TerminalSession[]>
  /** Resolved per-Pane agent states by Workspace id; absent means no Pane is asserting anything. */
  paneAgentStatesByWorkspace: Map<string, PaneAgentState[]>
}

/**
 * Subscribe to the cross-workspace runtime view.
 *
 * Every projection here is identity-cached (see `sidebarIndex`), so a runtime event in one
 * Workspace does not rebuild the derivation for the others.
 */
export function useSidebarRuntime(): SidebarRuntimeView {
  const sessions = useAllTerminalSessions()
  const agentStates = useAllAgentStates()
  return useMemo(() => {
    // One clock read for the whole derivation: sampling per Workspace could put two rows on
    // opposite sides of the same staleness boundary within a single paint.
    const now = Date.now()
    return {
      sessions,
      sessionsByWorkspace: getSessionsByWorkspace(sessions),
      paneAgentStatesByWorkspace: getPaneAgentStatesByWorkspace(sessions, agentStates, now),
    }
  }, [sessions, agentStates])
}
