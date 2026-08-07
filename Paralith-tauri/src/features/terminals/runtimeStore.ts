import { useSyncExternalStore } from 'react'
import { onAgentState, onTerminalExit, onTerminalOutput, onTerminalStatus } from '../../native/events'
import type { AgentStateEvent, TerminalOutputEvent, TerminalSession } from '../../native/types'

interface SessionSnapshot {
  session?: TerminalSession
  chunks: TerminalOutputEvent[]
  outputVersion: number
  pendingBytes: number
  droppedThroughSequence?: number
  agentState?: AgentStateEvent
}

const EMPTY: SessionSnapshot = { session: undefined, chunks: [], outputVersion: 0, pendingBytes: 0 }
const EMPTY_SESSIONS: TerminalSession[] = []
const MAX_PENDING_BYTES = 256 * 1024

/** Index key for the newest agent state of one Pane, independent of which Session produced it. */
export function agentStateKey(workspaceId: string, paneId: string): string {
  return `${workspaceId}:${paneId}`
}

export class TerminalRuntimeStore {
  private snapshots = new Map<string, SessionSnapshot>()
  private sessionListeners = new Map<string, Set<() => void>>()
  private workspaceListeners = new Map<string, Set<() => void>>()
  private workspaceSnapshots = new Map<string, TerminalSession[]>()
  /**
   * Cross-workspace views, for surfaces that must stay true for Workspaces they are not
   * displaying — chiefly the sidebar, whose rows span every open Project. Both are lazily
   * rebuilt and identity-stable between changes, so `useSyncExternalStore` and the sidebar's
   * identity-keyed caches can treat an unchanged reference as "nothing happened".
   */
  private allSessionsSnapshot: TerminalSession[] | null = null
  private agentStates = new Map<string, AgentStateEvent>()
  private agentStatesSnapshot: Record<string, AgentStateEvent> | null = null
  private globalListeners = new Set<() => void>()
  private unlisten: Array<() => void> = []
  private notificationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private startPromise?: Promise<void>
  private lifecycle = 0
  private started = false

  async start() {
    if (this.started) return this.startPromise
    const lifecycle = ++this.lifecycle
    this.started = true
    let pending: Promise<void>
    pending = Promise.all([
      onTerminalOutput((event) => this.ingestOutput(event)),
      onTerminalStatus((event) => this.upsert(event.session)),
      onAgentState((event) => this.ingestAgentState(event)),
      onTerminalExit((event) => {
        const current = this.snapshots.get(event.sessionId)?.session
        if (current) this.upsert({ ...current, status: 'exited', exitCode: event.exitCode, endedAt: event.timestamp, processId: undefined })
      }),
    ]).then((listeners) => {
      // React Strict Mode can stop and restart the store while Tauri is still resolving
      // listen(). Dispose that stale generation immediately instead of leaking duplicate
      // terminal-output handlers into the renderer.
      if (!this.started || lifecycle !== this.lifecycle) {
        for (const unlisten of listeners) unlisten()
        return
      }
      this.unlisten.push(...listeners)
    }).catch((error) => {
      if (lifecycle === this.lifecycle) this.started = false
      throw error
    }).finally(() => {
      if (this.startPromise === pending) this.startPromise = undefined
    })
    this.startPromise = pending
    return pending
  }

  stop() {
    this.lifecycle += 1
    for (const unlisten of this.unlisten.splice(0)) unlisten()
    for (const timer of this.notificationTimers.values()) clearTimeout(timer)
    this.notificationTimers.clear()
    this.started = false
  }

  hydrate(sessions: TerminalSession[]) {
    for (const session of sessions) this.upsert(session, false)
    for (const workspaceId of new Set(sessions.map((session) => session.workspaceId))) {
      this.publishWorkspace(workspaceId)
    }
  }

  /**
   * Reconcile against an authoritative list of everything the backend considers live.
   *
   * `hydrate` only ever adds, so a Session that died while no listener was attached — during a
   * reload, or before this window existed — stays "running" forever. This corrects in both
   * directions: absent Sessions are marked exited rather than deleted, because a Pane that ended
   * is something the user should see ended, not something that silently vanishes.
   *
   * `observedAt` is the moment the list was taken. Sessions started after it are left alone: a
   * Session created while the query was in flight is legitimately missing from the answer, and
   * demoting it would kill a terminal that is starting up fine.
   */
  reconcileLiveSessions(sessions: TerminalSession[], observedAt: string) {
    const liveIds = new Set(sessions.map((session) => session.id))
    const touched = new Set<string>()
    for (const session of sessions) {
      this.upsert(session, false)
      touched.add(session.workspaceId)
    }
    for (const snapshot of [...this.snapshots.values()]) {
      const known = snapshot.session
      if (!known || known.status !== 'running' || liveIds.has(known.id)) continue
      if (known.startedAt.localeCompare(observedAt) > 0) continue
      this.upsert({ ...known, status: 'exited', endedAt: observedAt, processId: undefined }, false)
      touched.add(known.workspaceId)
    }
    for (const workspaceId of touched) this.publishWorkspace(workspaceId)
  }

  upsert(session: TerminalSession, notify = true) {
    const current = this.snapshots.get(session.id)
    this.allSessionsSnapshot = null
    this.snapshots.set(session.id, {
      session,
      chunks: current?.chunks ?? [],
      outputVersion: current?.outputVersion ?? 0,
      pendingBytes: current?.pendingBytes ?? 0,
      droppedThroughSequence: current?.droppedThroughSequence,
      agentState: current?.agentState,
    })
    if (notify) {
      this.sessionListeners.get(session.id)?.forEach((listener) => listener())
      this.publishWorkspace(session.workspaceId)
    }
  }

  remove(sessionId: string) {
    const workspaceId = this.snapshots.get(sessionId)?.session?.workspaceId
    this.cancelNotification(sessionId)
    this.allSessionsSnapshot = null
    this.snapshots.delete(sessionId)
    this.sessionListeners.get(sessionId)?.forEach((listener) => listener())
    if (workspaceId) this.publishWorkspace(workspaceId)
  }

  clearWorkspace(workspaceId: string) {
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.session?.workspaceId === workspaceId) {
        this.cancelNotification(id)
        this.snapshots.delete(id)
      }
    }
    // A Workspace whose Sessions are gone has no agent state either. Leaving the entries would
    // keep a stale "needs input" claim alive on a Workspace that is no longer running anything.
    for (const key of [...this.agentStates.keys()]) {
      if (key.startsWith(`${workspaceId}:`)) this.agentStates.delete(key)
    }
    this.allSessionsSnapshot = null
    this.agentStatesSnapshot = null
    this.publishWorkspace(workspaceId)
  }

  sessionForPane(workspaceId: string, paneId: string) {
    return this.getWorkspaceSnapshot(workspaceId)
      .filter((session) => session.paneId === paneId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  }

  subscribeSession = (sessionId: string, listener: () => void) => {
    const listeners = this.sessionListeners.get(sessionId) ?? new Set()
    listeners.add(listener)
    this.sessionListeners.set(sessionId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.sessionListeners.delete(sessionId)
    }
  }

  getSessionSnapshot = (sessionId: string) => this.snapshots.get(sessionId) ?? EMPTY

  subscribeWorkspace = (workspaceId: string, listener: () => void) => {
    const listeners = this.workspaceListeners.get(workspaceId) ?? new Set()
    listeners.add(listener)
    this.workspaceListeners.set(workspaceId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) this.workspaceListeners.delete(workspaceId)
    }
  }

  getWorkspaceSnapshot = (workspaceId: string) => this.workspaceSnapshots.get(workspaceId) ?? EMPTY_SESSIONS

  /**
   * Subscribe to *any* runtime change, in any Workspace. The sidebar needs this because it shows
   * rows for Workspaces it is not displaying: subscribing per Workspace would mean the sidebar
   * only learns about the one Workspace on screen, which is how a background Project's row comes
   * to claim "3 running" long after its terminals exited.
   */
  subscribeAll = (listener: () => void) => {
    this.globalListeners.add(listener)
    return () => {
      this.globalListeners.delete(listener)
    }
  }

  /** Every live Session across every Workspace, in a stable order. Identity changes only on change. */
  getAllSessionsSnapshot = (): TerminalSession[] => {
    if (!this.allSessionsSnapshot) {
      this.allSessionsSnapshot = [...this.snapshots.values()]
        .flatMap((snapshot) => (snapshot.session ? [snapshot.session] : []))
        .sort(
          (a, b) => a.workspaceId.localeCompare(b.workspaceId) || a.paneId.localeCompare(b.paneId),
        )
    }
    return this.allSessionsSnapshot
  }

  /** The newest agent state per Pane, keyed by `agentStateKey`. Identity changes only on change. */
  getAgentStatesSnapshot = (): Record<string, AgentStateEvent> => {
    if (!this.agentStatesSnapshot) {
      this.agentStatesSnapshot = Object.fromEntries(this.agentStates)
    }
    return this.agentStatesSnapshot
  }

  agentStateForSession(sessionId: string) {
    return this.snapshots.get(sessionId)?.agentState
  }

  ingestAgentState(event: AgentStateEvent) {
    const current = this.snapshots.get(event.terminalSessionId) ?? EMPTY
    this.snapshots.set(event.terminalSessionId, {
      ...current,
      agentState: event,
    })
    // Also index by Pane. A Pane that restarts gets a new Session id, so a Session-keyed lookup
    // would leave the sidebar reading the dead Session's last state for the Pane in front of it.
    const key = agentStateKey(event.workspaceId, event.paneId)
    const known = this.agentStates.get(key)
    if (!known || known.updatedAt.localeCompare(event.updatedAt) <= 0) {
      this.agentStates.set(key, event)
      this.agentStatesSnapshot = null
    }
    this.sessionListeners.get(event.terminalSessionId)?.forEach((listener) => listener())
    this.publishWorkspace(event.workspaceId)
  }

  acknowledge(sessionId: string, throughSequence: number) {
    const current = this.snapshots.get(sessionId)
    if (!current) return
    let removeCount = 0
    let removedBytes = 0
    while (removeCount < current.chunks.length && current.chunks[removeCount].sequence <= throughSequence) {
      removedBytes += current.chunks[removeCount].data.byteLength
      removeCount += 1
    }
    if (removeCount === 0) return
    this.snapshots.set(sessionId, {
      ...current,
      chunks: current.chunks.slice(removeCount),
      pendingBytes: Math.max(0, current.pendingBytes - removedBytes),
      droppedThroughSequence: current.droppedThroughSequence !== undefined && current.droppedThroughSequence <= throughSequence
        ? undefined
        : current.droppedThroughSequence,
    })
  }

  ingestOutput(event: TerminalOutputEvent) {
    const current = this.snapshots.get(event.sessionId) ?? EMPTY
    // Native sequence is authoritative. Find the insertion point without sorting or rescanning
    // the complete pending payload on every high-frequency output event.
    const chunks = [...current.chunks]
    let low = 0
    let high = chunks.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (chunks[middle].sequence < event.sequence) low = middle + 1
      else high = middle
    }
    if (chunks[low]?.sequence === event.sequence) return
    chunks.splice(low, 0, event)

    let pendingBytes = current.pendingBytes + event.data.byteLength
    let removeCount = 0
    let droppedThroughSequence = current.droppedThroughSequence
    while (pendingBytes > MAX_PENDING_BYTES && chunks.length - removeCount > 1) {
      const dropped = chunks[removeCount]
      pendingBytes -= dropped.data.byteLength
      droppedThroughSequence = Math.max(droppedThroughSequence ?? -1, dropped.sequence)
      removeCount += 1
    }
    if (removeCount > 0) chunks.splice(0, removeCount)
    this.snapshots.set(event.sessionId, {
      ...current,
      chunks,
      pendingBytes,
      droppedThroughSequence,
      outputVersion: current.outputVersion + 1,
    })
    this.notifySessionSoon(event.sessionId)
  }

  private notifySessionSoon(sessionId: string) {
    if (!this.sessionListeners.get(sessionId)?.size || this.notificationTimers.has(sessionId)) return
    const timer = setTimeout(() => {
      this.notificationTimers.delete(sessionId)
      this.sessionListeners.get(sessionId)?.forEach((listener) => listener())
    }, 16)
    this.notificationTimers.set(sessionId, timer)
  }

  private cancelNotification(sessionId: string) {
    const timer = this.notificationTimers.get(sessionId)
    if (timer !== undefined) clearTimeout(timer)
    this.notificationTimers.delete(sessionId)
  }

  private publishWorkspace(workspaceId: string) {
    // Derived from the global view, which is already ordered by Workspace then Pane, so the two
    // snapshots can never disagree about a Session's presence or position.
    const sessions = this.getAllSessionsSnapshot().filter((session) => session.workspaceId === workspaceId)
    this.workspaceSnapshots.set(workspaceId, sessions)
    this.workspaceListeners.get(workspaceId)?.forEach((listener) => listener())
    // Every path that changes Session or agent state ends here, so this is the one place the
    // cross-workspace subscribers need to be woken. Output events deliberately never reach it:
    // a Session's byte stream changes nothing the sidebar renders.
    this.globalListeners.forEach((listener) => listener())
  }
}

export const terminalRuntime = new TerminalRuntimeStore()

export function useTerminalRuntime(sessionId?: string): SessionSnapshot {
  return useSyncExternalStore(
    (listener) => sessionId ? terminalRuntime.subscribeSession(sessionId, listener) : () => undefined,
    () => sessionId ? terminalRuntime.getSessionSnapshot(sessionId) : EMPTY,
    () => EMPTY,
  )
}

export function useWorkspaceSessions(workspaceId: string): TerminalSession[] {
  return useSyncExternalStore(
    (listener) => terminalRuntime.subscribeWorkspace(workspaceId, listener),
    () => terminalRuntime.getWorkspaceSnapshot(workspaceId),
    () => EMPTY_SESSIONS,
  )
}

const EMPTY_AGENT_STATES: Record<string, AgentStateEvent> = {}

/** Every live Session across every Workspace. For surfaces that span Projects — see `subscribeAll`. */
export function useAllTerminalSessions(): TerminalSession[] {
  return useSyncExternalStore(
    terminalRuntime.subscribeAll,
    terminalRuntime.getAllSessionsSnapshot,
    () => EMPTY_SESSIONS,
  )
}

/** The newest agent state per Pane across every Workspace, keyed by `agentStateKey`. */
export function useAllAgentStates(): Record<string, AgentStateEvent> {
  return useSyncExternalStore(
    terminalRuntime.subscribeAll,
    terminalRuntime.getAgentStatesSnapshot,
    () => EMPTY_AGENT_STATES,
  )
}
