import { afterEach, describe, expect, it, vi } from 'vitest'
import { TerminalRuntimeStore } from './runtimeStore'
import type { TerminalSession } from '../../native/types'

const eventHarness = vi.hoisted(() => ({ resolvers: [] as Array<(unlisten: () => void) => void> }))

vi.mock('../../native/events', () => {
  const delayedListener = () => new Promise<() => void>((resolve) => eventHarness.resolvers.push(resolve))
  return { onTerminalOutput: delayedListener, onTerminalStatus: delayedListener, onTerminalExit: delayedListener }
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
    expect(staleUnlisten).toHaveBeenCalledTimes(3)
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
