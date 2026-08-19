import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemorySearch } from './MemorySearch'
import { useIntelligenceStore } from '../intelligenceStore'
import type { ParsedQuery, SearchResponse, SearchResult } from '../intelligenceTypes'

const searchApi = vi.fn()

vi.mock('../api', () => ({
  intelligenceApi: {
    search: (...args: unknown[]) => searchApi(...args),
  },
  memoryApi: {},
}))

function result(patch: Partial<SearchResult> & { id: string }): SearchResult {
  return {
    domain: 'memory',
    itemId: patch.id,
    title: patch.id,
    excerpt: '',
    matchReason: 'lexical',
    score: 1,
    memoryType: 'decision',
    quality: 'canonical',
    stale: false,
    confidence: 0.8,
    branchName: null,
    updatedAt: '2026-08-14T09:00:00Z',
    ...patch,
  }
}

function response(patch: Partial<SearchResponse> = {}): SearchResponse {
  const parsed: ParsedQuery = { expression: { node: 'all' }, diagnostics: [] }
  return {
    results: [],
    parsed,
    total: 0,
    truncated: false,
    elapsedMs: 4,
    semanticUsed: false,
    ...patch,
  }
}

beforeEach(() => {
  useIntelligenceStore.getState().reset()
  useIntelligenceStore.setState({ projectId: 'p1' })
  searchApi.mockReset().mockResolvedValue(response())
})

describe('MemorySearch', () => {
  it('offers runnable examples before anything has been searched', async () => {
    render(<MemorySearch />)
    expect(screen.getByText('type:decision quality:canonical')).toBeInTheDocument()
    expect(screen.getByText('is:conflict')).toBeInTheDocument()
  })

  it('runs an example verbatim when it is clicked', async () => {
    render(<MemorySearch />)
    await userEvent.click(screen.getByText('stale:true quality:canonical'))
    expect(searchApi).toHaveBeenCalledWith({
      projectId: 'p1',
      query: 'stale:true quality:canonical',
      limit: 80,
    })
  })

  it('sends the typed query on submit', async () => {
    render(<MemorySearch />)
    await userEvent.type(screen.getByLabelText(/knowledge query/i), 'type:bug severity')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(searchApi).toHaveBeenCalledWith({
      projectId: 'p1',
      query: 'type:bug severity',
      limit: 80,
    })
  })

  it('shows results with the domain, the reason, and the elapsed time', async () => {
    searchApi.mockResolvedValue(
      response({
        results: [result({ id: 'm1', title: 'Token Rotation', excerpt: 'Rotate on use.' })],
        total: 1,
        elapsedMs: 7,
      }),
    )
    render(<MemorySearch />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(await screen.findByText('Token Rotation')).toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
    expect(screen.getByText(/matched by lexical/i)).toBeInTheDocument()
    expect(screen.getByText(/1 result in 7ms/i)).toBeInTheDocument()
  })

  it('distinguishes result domains rather than flattening them', async () => {
    searchApi.mockResolvedValue(
      response({
        results: [
          result({ id: 'm1', title: 'Token Rotation' }),
          result({
            id: 'e1',
            domain: 'entity',
            title: 'AuthService',
            memoryType: null,
            quality: null,
            itemId: null,
          }),
          result({ id: 'k1', domain: 'conflict', title: 'Database — version', itemId: null }),
        ],
        total: 3,
      }),
    )
    render(<MemorySearch />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(await screen.findByText('Memory')).toBeInTheDocument()
    expect(screen.getByText('Entity')).toBeInTheDocument()
    expect(screen.getByText('Conflict')).toBeInTheDocument()
  })

  it('reports what the parser could not read instead of quietly narrowing', async () => {
    searchApi.mockResolvedValue(
      response({
        parsed: {
          expression: { node: 'all' },
          diagnostics: ["Unknown field 'severity'; searched it as text."],
        },
      }),
    )
    render(<MemorySearch />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    const notes = await screen.findByRole('list', { name: /query diagnostics/i })
    expect(notes).toHaveTextContent(/unknown field 'severity'/i)
  })

  it('flags a stale hit in the result list', async () => {
    searchApi.mockResolvedValue(
      response({ results: [result({ id: 'm1', title: 'Rotation', stale: true })], total: 1 }),
    )
    render(<MemorySearch />)
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(await screen.findByText('stale')).toBeInTheDocument()
  })

  it('says nothing matched rather than showing an empty frame', async () => {
    render(<MemorySearch />)
    await userEvent.type(screen.getByLabelText(/knowledge query/i), 'nothing')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(await screen.findByText(/nothing matched/i)).toBeInTheDocument()
  })

  it('says semantic search is off rather than implying it ran', async () => {
    useIntelligenceStore.setState({
      semantic: {
        mode: 'disabled',
        provider: 'disabled',
        model: '',
        dimensions: 0,
        available: false,
        detail: 'Semantic search is off.',
      },
    })
    render(<MemorySearch />)
    expect(screen.getByText(/semantic search is off/i)).toBeInTheDocument()
  })

  it('returns to the examples when the field is cleared', async () => {
    searchApi.mockResolvedValue(
      response({ results: [result({ id: 'm1', title: 'Token Rotation' })], total: 1 }),
    )
    render(<MemorySearch />)
    const field = screen.getByLabelText(/knowledge query/i)
    await userEvent.type(field, 'token')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))
    expect(await screen.findByText('Token Rotation')).toBeInTheDocument()
    await userEvent.clear(field)
    expect(screen.getByText('type:decision quality:canonical')).toBeInTheDocument()
  })

  it('keeps the query field reachable by keyboard alone', async () => {
    render(<MemorySearch />)
    const field = screen.getByLabelText(/knowledge query/i)
    field.focus()
    await userEvent.keyboard('type:note{Enter}')
    expect(searchApi).toHaveBeenCalledWith({
      projectId: 'p1',
      query: 'type:note',
      limit: 80,
    })
  })
})
