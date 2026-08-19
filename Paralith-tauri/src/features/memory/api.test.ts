import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}))

import { intelligenceApi, memoryApi } from './api'

describe('Context Fabric IPC boundary', () => {
  beforeEach(() => {
    invokeMock.mockReset()
  })

  it('routes memory operations through the bounded memory command', async () => {
    invokeMock.mockResolvedValueOnce([])

    await memoryApi.list('project-1', 25)

    expect(invokeMock).toHaveBeenCalledWith('fabric_memory', {
      operation: 'memory_list',
      payload: { projectId: 'project-1', limit: 25 },
    })
  })

  it('preserves nested typed requests for intelligence operations', async () => {
    invokeMock.mockResolvedValueOnce({ results: [] })
    const request = { projectId: 'project-1', query: 'owner:platform' }

    await intelligenceApi.search(request)

    expect(invokeMock).toHaveBeenCalledWith('fabric_intelligence', {
      operation: 'knowledge_search',
      payload: { request },
    })
  })

  it('sends an explicit empty payload for parameterless operations', async () => {
    invokeMock.mockResolvedValueOnce({ available: false })

    await intelligenceApi.semanticHealth()

    expect(invokeMock).toHaveBeenCalledWith('fabric_intelligence', {
      operation: 'knowledge_semantic_health',
      payload: {},
    })
  })
})
