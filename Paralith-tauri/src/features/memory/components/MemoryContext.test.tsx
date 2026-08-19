import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryContext } from './MemoryContext'
import { useMemoryStore } from '../memoryStore'
import type { ContextEntry, ContextPack, ContextSection } from '../memoryTypes'

const compileApi = vi.fn()
const getApi = vi.fn()
const connectionsApi = vi.fn()
const historyApi = vi.fn()

vi.mock('../api', () => ({
  memoryApi: {
    compileContext: (...args: unknown[]) => compileApi(...args),
    get: (...args: unknown[]) => getApi(...args),
    connections: (...args: unknown[]) => connectionsApi(...args),
    history: (...args: unknown[]) => historyApi(...args),
  },
}))

function entry(patch: Partial<ContextEntry> & { itemId: string }): ContextEntry {
  return {
    title: patch.itemId,
    memoryType: 'decision',
    quality: 'working',
    section: 'architecture',
    text: 'Body text.',
    tokens: 40,
    score: 1.2,
    stale: false,
    reasons: [{ source: 'lexical', detail: 'matches the task text (rank 1)', weight: 0.7 }],
    ...patch,
  }
}

function section(kind: ContextSection['kind'], label: string, entries: ContextEntry[]): ContextSection {
  return { kind, label, entries }
}

function pack(patch: Partial<ContextPack> = {}): ContextPack {
  return {
    projectId: 'p1',
    task: 'fix the refresh race',
    budgetTokens: 6000,
    usedTokens: 1200,
    sections: [],
    rejected: [],
    conflicts: [],
    candidatesConsidered: 4,
    elapsedMs: 12,
    compiledAt: '2026-08-14T00:00:00Z',
    handoffs: [],
    cached: false,
    semanticUsed: false,
    ...patch,
  }
}

beforeEach(() => {
  useMemoryStore.getState().reset()
  compileApi.mockReset()
  getApi.mockReset()
  connectionsApi.mockReset()
  historyApi.mockReset()
})

describe('MemoryContext', () => {
  it('explains what the surface is for before anything is compiled', () => {
    render(<MemoryContext />)
    expect(screen.getByText(/Describe a task and compile/)).toBeInTheDocument()
  })

  it('compiles the typed task against the open memory and the chosen budget', async () => {
    compileApi.mockResolvedValue(pack())
    useMemoryStore.setState({ projectId: 'p1', activeId: 'm1' })

    render(<MemoryContext />)
    await userEvent.type(screen.getByRole('textbox'), 'fix the refresh race')
    await userEvent.selectOptions(screen.getByRole('combobox'), 'deep')
    await userEvent.click(screen.getByRole('button', { name: /Compile/ }))

    expect(compileApi).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p1',
        task: 'fix the refresh race',
        budget: 'deep',
        focusItemIds: ['m1'],
      }),
    )
  })

  it('renders sections in the order the compiler spends its budget', () => {
    useMemoryStore.setState({
      contextPack: pack({
        sections: [
          section('constraints', 'CONSTRAINTS', [entry({ itemId: 'c1', title: 'Hash tokens' })]),
          section('architecture', 'ARCHITECTURE', [entry({ itemId: 'a1', title: 'Rotation ADR' })]),
        ],
      }),
    })
    render(<MemoryContext />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(headings[0]).toContain('CONSTRAINTS')
    expect(headings[1]).toContain('ARCHITECTURE')
  })

  it('shows the reasons and weights behind an entry on demand', async () => {
    useMemoryStore.setState({
      contextPack: pack({
        sections: [
          section('code', 'CODE', [
            entry({
              itemId: 'm1',
              title: 'Session Design',
              score: 1.87,
              reasons: [
                { source: 'file', detail: 'cites src/auth/token.rs', weight: 0.9 },
                { source: 'lexical', detail: 'matches the task text (rank 2)', weight: 0.56 },
              ],
            }),
          ]),
        ],
      }),
    })
    render(<MemoryContext />)
    expect(screen.queryByText('cites src/auth/token.rs')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Why?' }))
    expect(screen.getByText('cites src/auth/token.rs')).toBeInTheDocument()
    expect(screen.getByText('+0.90')).toBeInTheDocument()
    expect(screen.getByText('1.87')).toBeInTheDocument()
  })

  it('reports token spend against the budget rather than implying it is free', () => {
    useMemoryStore.setState({
      contextPack: pack({ usedTokens: 3000, budgetTokens: 6000, candidatesConsidered: 17 }),
    })
    const { container } = render(<MemoryContext />)
    expect(screen.getByText(/3,000 \/ 6,000 tokens/)).toBeInTheDocument()
    expect(screen.getByText(/17 candidates considered/)).toBeInTheDocument()
    expect(container.querySelector('.memory-context-meter-fill')).toHaveStyle({ width: '50%' })
  })

  it('surfaces a contradiction instead of quietly shipping both sides', () => {
    useMemoryStore.setState({
      contextPack: pack({
        conflicts: [
          { leftItemId: 'a', leftTitle: 'TTL is 15m', rightItemId: 'b', rightTitle: 'TTL is 30m' },
        ],
      }),
    })
    render(<MemoryContext />)
    expect(screen.getByText(/Contradictions in this context/)).toBeInTheDocument()
    expect(screen.getByText('TTL is 15m')).toBeInTheDocument()
    expect(screen.getByText('TTL is 30m')).toBeInTheDocument()
  })

  it('distinguishes a candidate cut for budget from one cut by policy', async () => {
    useMemoryStore.setState({
      contextPack: pack({
        rejected: [
          { itemId: 'r1', title: 'Big Runbook', score: 0.4, reason: 'budget' },
          { itemId: 'r2', title: 'Old Policy', score: 0.9, reason: 'superseded' },
        ],
      }),
    })
    render(<MemoryContext />)
    await userEvent.click(screen.getByRole('button', { name: '2 candidates not included' }))
    expect(screen.getByText('cut for budget')).toBeInTheDocument()
    expect(screen.getByText('superseded')).toBeInTheDocument()
  })

  it('says plainly when the agent would start with nothing', () => {
    useMemoryStore.setState({ contextPack: pack({ sections: [] }) })
    render(<MemoryContext />)
    expect(screen.getByText(/would start with no prior knowledge/)).toBeInTheDocument()
  })

  it('flags a stale entry in the pack', () => {
    useMemoryStore.setState({
      contextPack: pack({
        sections: [section('architecture', 'ARCHITECTURE', [entry({ itemId: 'm1', stale: true })])],
      }),
    })
    render(<MemoryContext />)
    expect(screen.getByText('unverified')).toBeInTheDocument()
  })

  it('opens a memory from the pack and returns to the document view', async () => {
    getApi.mockResolvedValue(null)
    connectionsApi.mockResolvedValue(null)
    historyApi.mockResolvedValue([])
    useMemoryStore.setState({
      projectId: 'p1',
      view: 'context',
      contextPack: pack({
        sections: [
          section('architecture', 'ARCHITECTURE', [entry({ itemId: 'm1', title: 'Rotation ADR' })]),
        ],
      }),
    })

    render(<MemoryContext />)
    await userEvent.click(screen.getByRole('button', { name: 'Rotation ADR' }))

    expect(useMemoryStore.getState().activeId).toBe('m1')
    expect(useMemoryStore.getState().view).toBe('document')
  })

  it('surfaces a compile failure instead of leaving a stale pack on screen', async () => {
    compileApi.mockRejectedValue(new Error('boom'))
    useMemoryStore.setState({ projectId: 'p1' })

    render(<MemoryContext />)
    await userEvent.click(screen.getByRole('button', { name: /Compile/ }))

    expect(useMemoryStore.getState().error).toBeTruthy()
    expect(useMemoryStore.getState().contextLoading).toBe(false)
  })
})
