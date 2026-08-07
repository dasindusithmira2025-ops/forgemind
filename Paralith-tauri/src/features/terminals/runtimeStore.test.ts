import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalRuntimeStore } from './runtimeStore'
import type { TerminalSession } from '../../native/types'

const eventHarness = vi.hoisted(() => ({ resolvers: [] as Array<(unlisten: () => void) => void> }))

vi.mock('../../native/events', () => {
  const delayedListener = () => new Promise<() => void>((resolve) => eventHarness.resolvers.push(resolve))
  return { onTerminalOutput: delayedListener, onTerminalStatus: delayedListener, onTerminalExit: delayedListener, onAgentState: delayedListener }
})

const session = (id: string, paneId: string): TerminalSession => ({
  id, projectId: 'project', workspaceId: 'workspace', paneId, provider: 'codex',
  executable: 'codex.exe', arguments: [], title: paneId, workingDirectory: 'C:\\project',
  status: 'running', startedAt: '', outputTail: [], nextSequence: 0,
  restorationState: 'not_requested', droppedOutputBytes: 0,
})

describe('terminal runtime external store', () => {
  afterEach(() => vi.useRealTimers())

  it('disposes listeners that resolve after the runtime has stopped', async () => {
    eventHarness.resolvers.length = 0
    const store = new TerminalRuntimeStore()
    const pending = store.start()
    store.stop()
    const staleUnlisten = vi.fn()
    for (const resolve of eventHarness.resolvers) resolve(staleUnlisten)
    await pending
    expect(staleUnlisten).toHaveBeenCalledTimes(4)
  })

  it('notifies only the Terminal Session receiving output and coalesces a burst', () => {
    vi.useFakeTimers()
    const store = new TerminalRuntimeStore()
    store.hydrate([session('one', 'p1'), session('two', 'p2')])
    const first = vi.fn(); const second = vi.fn(); const workspace = vi.fn()
    store.subscribeSession('one', first); store.subscribeSession('two', second)
    store.subscribeWorkspace('workspace', workspace)
    store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence: 0, timestamp: '', data: new Uint8Array([65]) })
    store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence: 1, timestamp: '', data: new Uint8Array([66]) })
    expect(first).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(workspace).not.toHaveBeenCalled()
  })

  it('bounds pending renderer payload independently per session', () => {
    const store = new TerminalRuntimeStore()
    store.hydrate([session('one', 'p1'), session('two', 'p2')])
    for (let sequence = 0; sequence < 40; sequence += 1) {
      store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence, timestamp: '', data: new Uint8Array(16 * 1024).fill(65) })
    }
    const oneBytes = store.getSessionSnapshot('one').chunks.reduce((sum, chunk) => sum + chunk.data.byteLength, 0)
    expect(oneBytes).toBeLessThanOrEqual(256 * 1024)
    expect(store.getSessionSnapshot('one').pendingBytes).toBe(oneBytes)
    expect(store.getSessionSnapshot('one').droppedThroughSequence).toBeDefined()
    expect(store.getSessionSnapshot('two').chunks).toHaveLength(0)
  })

  it('deduplicates replay overlap and restores sequence order after reconnect',()=>{
    const store=new TerminalRuntimeStore()
    store.hydrate([{...session('one','p1'),outputTail:[65,66],nextSequence:5}])
    store.ingestOutput({sessionId:'one',paneId:'p1',sequence:7,timestamp:'',data:new Uint8Array([72])})
    store.ingestOutput({sessionId:'one',paneId:'p1',sequence:5,timestamp:'',data:new Uint8Array([70])})
    store.ingestOutput({sessionId:'one',paneId:'p1',sequence:5,timestamp:'',data:new Uint8Array([70])})
    store.ingestOutput({sessionId:'one',paneId:'p1',sequence:6,timestamp:'',data:new Uint8Array([71])})
    expect(store.getSessionSnapshot('one').chunks.map((chunk)=>chunk.sequence)).toEqual([5,6,7])
  })

  it('absorbs a sustained output burst with one renderer notification per frame', () => {
    vi.useFakeTimers()
    const store = new TerminalRuntimeStore()
    store.hydrate([session('one', 'p1')])
    const listener = vi.fn()
    store.subscribeSession('one', listener)
    for (let sequence = 0; sequence < 5_000; sequence += 1) {
      store.ingestOutput({
        sessionId: 'one',
        paneId: 'p1',
        sequence,
        timestamp: '',
        data: new Uint8Array(64),
      })
    }
    const snapshot = store.getSessionSnapshot('one')
    expect(snapshot.pendingBytes).toBeLessThanOrEqual(256 * 1024)
    expect(snapshot.chunks.at(-1)?.sequence).toBe(4_999)
    expect(listener).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('cross-workspace runtime view', () => {
  const other = (id: string, paneId: string, workspaceId: string): TerminalSession => ({
    ...session(id, paneId),
    workspaceId,
  })

  it('spans every Workspace, so a Project that is not on screen is still observed', () => {
    // Subscribing per Workspace is how a background Project's row came to keep claiming "running"
    // long after its terminals exited: nothing was listening on its behalf.
    const store = new TerminalRuntimeStore()
    store.hydrate([other('one', 'p1', 'w1'), other('two', 'p2', 'w2')])
    expect(store.getAllSessionsSnapshot().map((entry) => entry.workspaceId)).toEqual(['w1', 'w2'])
  })

  it('wakes global subscribers on a change in any Workspace', () => {
    const store = new TerminalRuntimeStore()
    const listener = vi.fn()
    store.subscribeAll(listener)
    store.upsert(other('one', 'p1', 'w1'))
    store.upsert(other('two', 'p2', 'w2'))
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('does not wake global subscribers for terminal output', () => {
    // A Session's byte stream changes nothing the sidebar renders, and output is the highest
    // frequency event in the app.
    vi.useFakeTimers()
    const store = new TerminalRuntimeStore()
    store.hydrate([other('one', 'p1', 'w1')])
    const listener = vi.fn()
    store.subscribeAll(listener)
    store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence: 0, timestamp: '', data: new Uint8Array([65]) })
    vi.advanceTimersByTime(100)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps the snapshot identity stable until something actually changes', () => {
    const store = new TerminalRuntimeStore()
    store.hydrate([other('one', 'p1', 'w1')])
    const first = store.getAllSessionsSnapshot()
    expect(store.getAllSessionsSnapshot()).toBe(first)
    store.upsert(other('two', 'p2', 'w2'))
    expect(store.getAllSessionsSnapshot()).not.toBe(first)
  })

  it('indexes agent state by Pane, so a restarted Pane replaces its predecessor', () => {
    const store = new TerminalRuntimeStore()
    store.hydrate([other('one', 'p1', 'w1')])
    store.ingestAgentState({
      terminalSessionId: 'one', projectId: 'project', workspaceId: 'w1', paneId: 'p1',
      provider: 'codex', state: 'needs_input', source: 'provider_hook', reason: '',
      updatedAt: '2026-08-07T10:00:00Z',
    })
    store.ingestAgentState({
      // A new Session id for the same Pane: keying by Session would leave the sidebar reading the
      // dead Session's last state for the Pane in front of it.
      terminalSessionId: 'restarted', projectId: 'project', workspaceId: 'w1', paneId: 'p1',
      provider: 'codex', state: 'working', source: 'provider_hook', reason: '',
      updatedAt: '2026-08-07T11:00:00Z',
    })
    expect(store.getAgentStatesSnapshot()['w1:p1'].state).toBe('working')
  })

  it('ignores an agent state that is older than the one already indexed', () => {
    const store = new TerminalRuntimeStore()
    store.ingestAgentState({
      terminalSessionId: 'one', projectId: 'project', workspaceId: 'w1', paneId: 'p1',
      provider: 'codex', state: 'needs_input', source: 'provider_hook', reason: '',
      updatedAt: '2026-08-07T11:00:00Z',
    })
    store.ingestAgentState({
      terminalSessionId: 'one', projectId: 'project', workspaceId: 'w1', paneId: 'p1',
      provider: 'codex', state: 'idle', source: 'heuristic', reason: '',
      updatedAt: '2026-08-07T10:00:00Z',
    })
    expect(store.getAgentStatesSnapshot()['w1:p1'].state).toBe('needs_input')
  })

  it('clears a Workspace agent state along with its Sessions', () => {
    // Otherwise a Workspace that was stopped mid-prompt keeps claiming it needs attention forever.
    const store = new TerminalRuntimeStore()
    store.hydrate([other('one', 'p1', 'w1')])
    store.ingestAgentState({
      terminalSessionId: 'one', projectId: 'project', workspaceId: 'w1', paneId: 'p1',
      provider: 'codex', state: 'needs_input', source: 'provider_hook', reason: '',
      updatedAt: '2026-08-07T11:00:00Z',
    })
    store.clearWorkspace('w1')
    expect(store.getAgentStatesSnapshot()).toEqual({})
    expect(store.getAllSessionsSnapshot()).toEqual([])
  })
})

describe('reconcileLiveSessions', () => {
  const at = (workspaceId: string, id: string, startedAt: string): TerminalSession => ({
    ...session(id, 'p1'),
    workspaceId,
    startedAt,
  })

  it('marks a Session the backend no longer knows about as exited, rather than deleting it', () => {
    // `hydrate` only ever adds, so a Session that died while nothing was listening stayed
    // "running" forever. A Pane that ended is something the user should see ended.
    const store = new TerminalRuntimeStore()
    store.hydrate([at('w1', 'gone', '2026-08-07T10:00:00Z')])
    store.reconcileLiveSessions([], '2026-08-07T12:00:00Z')
    const [reconciled] = store.getAllSessionsSnapshot()
    expect(reconciled.status).toBe('exited')
    expect(reconciled.endedAt).toBe('2026-08-07T12:00:00Z')
  })

  it('leaves a Session that started after the list was taken alone', () => {
    // It is legitimately missing from an in-flight answer; demoting it would kill a terminal that
    // is starting up fine.
    const store = new TerminalRuntimeStore()
    store.hydrate([at('w1', 'newborn', '2026-08-07T12:00:05Z')])
    store.reconcileLiveSessions([], '2026-08-07T12:00:00Z')
    expect(store.getAllSessionsSnapshot()[0].status).toBe('running')
  })

  it('adopts Sessions the view had never seen', () => {
    const store = new TerminalRuntimeStore()
    store.reconcileLiveSessions([at('w2', 'discovered', '2026-08-07T10:00:00Z')], '2026-08-07T12:00:00Z')
    expect(store.getAllSessionsSnapshot().map((entry) => entry.id)).toEqual(['discovered'])
  })
})
