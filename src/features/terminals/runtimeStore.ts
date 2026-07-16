import { useSyncExternalStore } from 'react'
import { onTerminalExit, onTerminalOutput, onTerminalStatus } from '../../native/events'
import type { TerminalOutputEvent, TerminalSession } from '../../native/types'

interface SessionSnapshot {
  session?: TerminalSession
  chunks: TerminalOutputEvent[]
  outputVersion: number
  pendingBytes: number
  droppedThroughSequence?: number
}

const EMPTY: SessionSnapshot = { session: undefined, chunks: [], outputVersion: 0, pendingBytes: 0 }
const EMPTY_SESSIONS: TerminalSession[] = []
const MAX_PENDING_BYTES = 256 * 1024

export class TerminalRuntimeStore {
  private snapshots = new Map<string, SessionSnapshot>()
  private sessionListeners = new Map<string, Set<() => void>>()
  private workspaceListeners = new Map<string, Set<() => void>>()
  private workspaceSnapshots = new Map<string, TerminalSession[]>()
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

  upsert(session: TerminalSession, notify = true) {
    const current = this.snapshots.get(session.id)
    this.snapshots.set(session.id, {
      session,
      chunks: current?.chunks ?? [],
      outputVersion: current?.outputVersion ?? 0,
      pendingBytes: current?.pendingBytes ?? 0,
      droppedThroughSequence: current?.droppedThroughSequence,
    })
    if (notify) {
      this.sessionListeners.get(session.id)?.forEach((listener) => listener())
      this.publishWorkspace(session.workspaceId)
    }
  }

  remove(sessionId: string) {
    const workspaceId = this.snapshots.get(sessionId)?.session?.workspaceId
    this.cancelNotification(sessionId)
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
    const sessions = [...this.snapshots.values()]
      .flatMap((snapshot) => snapshot.session ? [snapshot.session] : [])
      .filter((session) => session.workspaceId === workspaceId)
      .sort((a, b) => a.paneId.localeCompare(b.paneId))
    this.workspaceSnapshots.set(workspaceId, sessions)
    this.workspaceListeners.get(workspaceId)?.forEach((listener) => listener())
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
