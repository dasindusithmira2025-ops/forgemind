import { describe, expect, it, vi } from 'vitest'
import { TerminalRuntimeStore } from './runtimeStore'
import type { TerminalSession } from '../../native/types'

const session = (id: string, paneId: string): TerminalSession => ({
  id, projectId: 'project', workspaceId: 'workspace', paneId, provider: 'codex',
  executable: 'codex.exe', arguments: [], title: paneId, workingDirectory: 'C:\\project',
  status: 'running', startedAt: '', outputTail: [], nextSequence: 0,
  restorationState: 'not_requested', droppedOutputBytes: 0,
})

describe('terminal runtime external store', () => {
  it('notifies only the Terminal Session receiving output', () => {
    const store = new TerminalRuntimeStore()
    store.hydrate([session('one', 'p1'), session('two', 'p2')])
    const first = vi.fn(); const second = vi.fn(); const workspace = vi.fn()
    store.subscribeSession('one', first); store.subscribeSession('two', second)
    store.subscribeWorkspace('workspace', workspace)
    store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence: 0, timestamp: '', data: [65] })
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    expect(workspace).not.toHaveBeenCalled()
  })

  it('bounds pending renderer payload independently per session', () => {
    const store = new TerminalRuntimeStore()
    store.hydrate([session('one', 'p1'), session('two', 'p2')])
    for (let sequence = 0; sequence < 40; sequence += 1) {
      store.ingestOutput({ sessionId: 'one', paneId: 'p1', sequence, timestamp: '', data: Array(16 * 1024).fill(65) })
    }
    const oneBytes = store.getSessionSnapshot('one').chunks.reduce((sum, chunk) => sum + chunk.data.length, 0)
    expect(oneBytes).toBeLessThanOrEqual(256 * 1024)
    expect(store.getSessionSnapshot('two').chunks).toHaveLength(0)
  })
})
