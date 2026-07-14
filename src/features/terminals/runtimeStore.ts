import { useSyncExternalStore } from 'react'
import { onTerminalExit, onTerminalOutput, onTerminalStatus } from '../../native/events'
import type { TerminalOutputEvent, TerminalSession } from '../../native/types'

interface SessionSnapshot {
  session?: TerminalSession
  chunks: TerminalOutputEvent[]
  outputVersion: number
}

const EMPTY: SessionSnapshot = { session: undefined, chunks: [], outputVersion: 0 }
const EMPTY_SESSIONS: TerminalSession[] = []
const MAX_PENDING_BYTES = 256 * 1024

export class TerminalRuntimeStore {
  private snapshots = new Map<string, SessionSnapshot>()
  private sessionListeners = new Map<string, Set<() => void>>()
  private workspaceListeners = new Map<string, Set<() => void>>()
  private workspaceSnapshots = new Map<string, TerminalSession[]>()
  private unlisten: Array<() => void> = []
  private started = false

  async start() {
    if (this.started) return
    this.started = true
    const listeners = await Promise.all([
      onTerminalOutput((event) => this.ingestOutput(event)),
      onTerminalStatus((event) => this.upsert(event.session)),
      onTerminalExit((event) => {
        const current = this.snapshots.get(event.sessionId)?.session
        if (current) this.upsert({ ...current, status: 'exited', exitCode: event.exitCode, endedAt: event.timestamp, processId: undefined })
      }),
    ]).catch((error) => {
      this.started = false
      throw error
    })
    this.unlisten.push(...listeners)
  }

  stop() {
    for (const unlisten of this.unlisten.splice(0)) unlisten()
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
    this.snapshots.set(session.id, { session, chunks: current?.chunks ?? [], outputVersion: current?.outputVersion ?? 0 })
    if (notify) {
      this.sessionListeners.get(session.id)?.forEach((listener) => listener())
      this.publishWorkspace(session.workspaceId)
    }
  }

  remove(sessionId: string) {
    const workspaceId = this.snapshots.get(sessionId)?.session?.workspaceId
    this.snapshots.delete(sessionId)
    this.sessionListeners.get(sessionId)?.forEach((listener) => listener())
    if (workspaceId) this.publishWorkspace(workspaceId)
  }

  clearWorkspace(workspaceId: string) {
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.session?.workspaceId === workspaceId) this.snapshots.delete(id)
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
    const chunks = current.chunks.filter((chunk) => chunk.sequence > throughSequence)
    if (chunks.length !== current.chunks.length) {
      this.snapshots.set(sessionId, { ...current, chunks })
    }
  }

  ingestOutput(event: TerminalOutputEvent) {
    const current = this.snapshots.get(event.sessionId) ?? EMPTY
    if(current.chunks.some((chunk)=>chunk.sequence===event.sequence))return
    // Native sequence is authoritative. Sorting here makes a renderer reconnect resilient to
    // event-loop reordering while deduplication prevents replay/live overlap from writing twice.
    let chunks = [...current.chunks, event].sort((left,right)=>left.sequence-right.sequence)
    let bytes = chunks.reduce((total, chunk) => total + chunk.data.length, 0)
    while (bytes > MAX_PENDING_BYTES && chunks.length > 1) {
      bytes -= chunks[0].data.length
      chunks = chunks.slice(1)
    }
    this.snapshots.set(event.sessionId, { ...current, chunks, outputVersion: current.outputVersion + 1 })
    this.sessionListeners.get(event.sessionId)?.forEach((listener) => listener())
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
