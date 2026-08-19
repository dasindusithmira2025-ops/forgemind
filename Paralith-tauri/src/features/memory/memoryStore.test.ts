import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasUnsavedChanges, useMemoryStore, visibleMemories } from './memoryStore'
import type {
  KnowledgeUpdatedEvent,
  MemoryDetail,
  MemorySearchHit,
  MemorySummary,
} from './memoryTypes'

const list = vi.fn()
const search = vi.fn()
const get = vi.fn()
const connections = vi.fn()
const history = vi.fn()
const save = vi.fn()
const vocabulary = vi.fn()
const jobs = vi.fn()

vi.mock('./api', () => ({
  memoryApi: {
    list: (...args: unknown[]) => list(...args),
    search: (...args: unknown[]) => search(...args),
    get: (...args: unknown[]) => get(...args),
    connections: (...args: unknown[]) => connections(...args),
    history: (...args: unknown[]) => history(...args),
    save: (...args: unknown[]) => save(...args),
    vocabulary: (...args: unknown[]) => vocabulary(...args),
    jobs: (...args: unknown[]) => jobs(...args),
  },
}))

function summary(patch: Partial<MemorySummary> = {}): MemorySummary {
  return {
    id: 'm1',
    projectId: 'p1',
    slug: 'auth-design',
    title: 'Auth Design',
    memoryType: 'decision',
    state: 'active',
    quality: 'working',
    importance: 0.5,
    confidence: 0.5,
    summary: 'Tokens rotate.',
    pinned: false,
    tags: [],
    workspaceId: null,
    branchName: null,
    verifiedAt: null,
    staleReason: null,
    revisionNumber: 1,
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T00:00:00Z',
    ...patch,
  }
}

function detail(patch: Partial<MemoryDetail> = {}): MemoryDetail {
  return {
    ...summary(),
    body: 'Tokens rotate.',
    properties: [],
    outgoingLinks: [],
    claims: [],
    sources: [],
    relations: [],
    revisionId: 'r1',
    filePath: '.paralith/memory/auth-design.md',
    ...patch,
  }
}

const deferred = () => {
  let resolve!: (value: unknown) => void
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  useMemoryStore.setState({ relationTypes: [], sourceTypes: [] })
  useMemoryStore.getState().reset()
  vocabulary.mockResolvedValue([['supersedes'], ['file']])
  list.mockResolvedValue([summary()])
  connections.mockResolvedValue({ backlinks: [], unlinkedMentions: [], orphan: true })
  history.mockResolvedValue([])
  jobs.mockResolvedValue([])
})

describe('applyKnowledgeUpdate', () => {
  const event = (patch: Partial<KnowledgeUpdatedEvent> = {}): KnowledgeUpdatedEvent => ({
    projectId: 'p1',
    jobId: 'j1',
    kind: 'analyze_impact',
    changedItemIds: ['m1'],
    ...patch,
  })

  it('ignores an event for a Project this window is not showing', async () => {
    await useMemoryStore.getState().load('p1')
    list.mockClear()

    useMemoryStore.getState().applyKnowledgeUpdate({ ...event(), projectId: 'p2' })
    await Promise.resolve()
    // Events are broadcast to every window; a detached Workspace must not refresh its knowledge
    // because a different Project's analysis finished.
    expect(list).not.toHaveBeenCalled()
  })

  it('re-reads the list from the backend rather than patching state locally', async () => {
    await useMemoryStore.getState().load('p1')
    list.mockClear()
    list.mockResolvedValue([summary({ staleReason: 'file change: src/auth/token.rs' })])

    useMemoryStore.getState().applyKnowledgeUpdate(event())
    await vi.waitFor(() =>
      expect(useMemoryStore.getState().items[0].staleReason).toBe(
        'file change: src/auth/token.rs',
      ),
    )
    expect(list).toHaveBeenCalledWith('p1')
  })

  it('re-reads the open document only when it is one of the memories that changed', async () => {
    await useMemoryStore.getState().load('p1')
    get.mockResolvedValue(detail())
    await useMemoryStore.getState().open('m1')
    get.mockClear()

    useMemoryStore.getState().applyKnowledgeUpdate({ ...event(), changedItemIds: ['m9'] })
    await vi.waitFor(() => expect(list).toHaveBeenCalled())
    // A staleness sweep elsewhere must not reload a document the user is reading.
    expect(get).not.toHaveBeenCalled()

    useMemoryStore.getState().applyKnowledgeUpdate(event())
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith('p1', 'm1'))
  })

  it('does no work at all when a job changed nothing', async () => {
    await useMemoryStore.getState().load('p1')
    list.mockClear()

    useMemoryStore.getState().applyKnowledgeUpdate({ ...event(), changedItemIds: [] })
    await Promise.resolve()
    expect(list).not.toHaveBeenCalled()
  })
})

describe('load', () => {
  it('loads the project list and the closed vocabularies once', async () => {
    await useMemoryStore.getState().load('p1')
    expect(useMemoryStore.getState().items).toHaveLength(1)
    expect(useMemoryStore.getState().relationTypes).toEqual(['supersedes'])

    await useMemoryStore.getState().load('p1')
    // The vocabulary is a compile-time constant on the backend; refetching it per project switch
    // would be a request that can never return anything new.
    expect(vocabulary).toHaveBeenCalledTimes(1)
  })

  it('discards a slow response from a project the user already left', async () => {
    const slow = deferred()
    list.mockReturnValueOnce(slow.promise)
    const first = useMemoryStore.getState().load('p1')

    list.mockResolvedValueOnce([summary({ id: 'm2', title: 'Other Project Memory' })])
    await useMemoryStore.getState().load('p2')

    slow.resolve([summary({ id: 'stale', title: 'Stale Project Memory' })])
    await first

    const titles = useMemoryStore.getState().items.map((item) => item.title)
    expect(titles).toEqual(['Other Project Memory'])
    expect(useMemoryStore.getState().projectId).toBe('p2')
  })

  it('surfaces a load failure instead of showing an empty project', async () => {
    list.mockRejectedValueOnce({ code: 'database_error', message: 'The database is unavailable.' })
    await useMemoryStore.getState().load('p1')
    expect(useMemoryStore.getState().error).toBe('The database is unavailable.')
    expect(useMemoryStore.getState().listLoading).toBe(false)
  })
})

describe('search', () => {
  beforeEach(async () => {
    await useMemoryStore.getState().load('p1')
  })

  it('clears results when the query is emptied rather than leaving stale hits', async () => {
    search.mockResolvedValueOnce([{ ...summary(), snippet: 'rotate', score: 1, matchReason: 'lexical' }])
    await useMemoryStore.getState().setQuery('rotate')
    expect(useMemoryStore.getState().results).toHaveLength(1)

    await useMemoryStore.getState().setQuery('   ')
    expect(useMemoryStore.getState().results).toHaveLength(0)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('drops a response whose query the user has already typed past', async () => {
    const slow = deferred()
    search.mockReturnValueOnce(slow.promise)
    const first = useMemoryStore.getState().setQuery('rot')

    search.mockResolvedValueOnce([
      { ...summary({ title: 'Newer' }), snippet: 'x', score: 1, matchReason: 'lexical' },
    ])
    await useMemoryStore.getState().setQuery('rotate')

    slow.resolve([{ ...summary({ title: 'Older' }), snippet: 'x', score: 1, matchReason: 'lexical' }])
    await first

    expect(useMemoryStore.getState().results.map((hit) => hit.title)).toEqual(['Newer'])
  })
})

describe('open', () => {
  it('fetches the document, its neighbourhood and its history together', async () => {
    await useMemoryStore.getState().load('p1')
    get.mockResolvedValueOnce(detail())
    connections.mockResolvedValueOnce({ backlinks: [], unlinkedMentions: [], orphan: false })
    history.mockResolvedValueOnce([
      { id: 'r1', revisionNumber: 1, title: 'Auth Design', summary: '', confidence: 0.5, extractionMethod: 'user', modelId: null, contentHash: 'h', createdAt: '2026-08-13T00:00:00Z' },
    ])

    await useMemoryStore.getState().open('m1')
    const state = useMemoryStore.getState()
    expect(state.detail?.id).toBe('m1')
    expect(state.connections?.orphan).toBe(false)
    expect(state.history).toHaveLength(1)
    expect(state.detailLoading).toBe(false)
  })

  it('ignores a response for a memory the user already navigated away from', async () => {
    await useMemoryStore.getState().load('p1')
    const slow = deferred()
    get.mockReturnValueOnce(slow.promise)
    const first = useMemoryStore.getState().open('m1')

    get.mockResolvedValueOnce(detail({ id: 'm2', title: 'Second' }))
    await useMemoryStore.getState().open('m2')

    slow.resolve(detail({ id: 'm1', title: 'First' }))
    await first

    expect(useMemoryStore.getState().detail?.title).toBe('Second')
  })
})

describe('save', () => {
  beforeEach(async () => {
    await useMemoryStore.getState().load('p1')
  })

  it('keeps the draft when the backend rejects the save', async () => {
    useMemoryStore.getState().startNew()
    useMemoryStore.getState().editDraft({ title: 'Deploy Notes', body: 'API_KEY=abc123' })
    save.mockRejectedValueOnce({
      code: 'memory_secret_rejected',
      message: '`API_KEY` looks like a credential.',
    })

    await useMemoryStore.getState().save()

    const state = useMemoryStore.getState()
    // A rejected save must never cost the user their text.
    expect(state.draft?.body).toBe('API_KEY=abc123')
    expect(state.error).toContain('credential')
    expect(state.saving).toBe(false)
  })

  it('clears the draft and adopts the saved revision on success', async () => {
    useMemoryStore.getState().startNew()
    useMemoryStore.getState().editDraft({ title: 'Auth Design', body: 'Tokens rotate.' })
    save.mockResolvedValueOnce(detail({ revisionNumber: 2 }))

    await useMemoryStore.getState().save()

    const state = useMemoryStore.getState()
    expect(state.draft).toBeUndefined()
    expect(state.detail?.revisionNumber).toBe(2)
    expect(state.activeId).toBe('m1')
  })

  it('does nothing without a draft', async () => {
    await useMemoryStore.getState().save()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('hasUnsavedChanges', () => {
  it('is false without a draft and true once the draft diverges', () => {
    const loaded = detail()
    expect(hasUnsavedChanges({ detail: loaded })).toBe(false)
    expect(
      hasUnsavedChanges({
        detail: loaded,
        draft: { title: loaded.title, body: loaded.body, memoryType: loaded.memoryType },
      }),
    ).toBe(false)
    expect(
      hasUnsavedChanges({
        detail: loaded,
        draft: { title: loaded.title, body: 'changed', memoryType: loaded.memoryType },
      }),
    ).toBe(true)
    // A type change alone is still a change.
    expect(
      hasUnsavedChanges({
        detail: loaded,
        draft: { title: loaded.title, body: loaded.body, memoryType: 'note' },
      }),
    ).toBe(true)
  })

  it('treats an empty new memory as clean so Create stays disabled', () => {
    expect(hasUnsavedChanges({ draft: { title: '', body: '', memoryType: 'note' } })).toBe(false)
    expect(hasUnsavedChanges({ draft: { title: 'Draft', body: '', memoryType: 'note' } })).toBe(true)
  })
})

describe('visibleMemories', () => {
  const items = [summary()]
  const results: MemorySearchHit[] = [
    { ...summary({ id: 'hit' }), snippet: 's', score: 1, matchReason: 'lexical' },
  ]

  it('shows results while a query is active and the full list otherwise', () => {
    expect(visibleMemories({ query: '', results, items })).toEqual(items)
    expect(visibleMemories({ query: '   ', results, items })).toEqual(items)
    expect(visibleMemories({ query: 'auth', results, items })).toEqual(results)
  })

  it('shows an empty result set rather than falling back to the full list', () => {
    // Falling back would make a search that genuinely matched nothing look like it matched
    // everything.
    expect(visibleMemories({ query: 'nothing', results: [], items })).toEqual([])
  })
})
