import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryGraph } from './MemoryGraph'
import { layoutGraph } from '../memoryGraphLayout'
import { useMemoryStore } from '../memoryStore'
import type { GraphEdge, GraphNode, KnowledgeGraph } from '../memoryTypes'

const graphApi = vi.fn()
const healthApi = vi.fn()
const getApi = vi.fn()
const connectionsApi = vi.fn()
const historyApi = vi.fn()

vi.mock('../api', () => ({
  memoryApi: {
    graph: (...args: unknown[]) => graphApi(...args),
    health: (...args: unknown[]) => healthApi(...args),
    get: (...args: unknown[]) => getApi(...args),
    connections: (...args: unknown[]) => connectionsApi(...args),
    history: (...args: unknown[]) => historyApi(...args),
  },
}))

function node(patch: Partial<GraphNode> & { id: string }): GraphNode {
  return {
    kind: 'memory',
    label: patch.id,
    sublabel: 'decision',
    itemId: patch.id.replace('memory:', ''),
    memoryType: 'decision',
    quality: 'working',
    importance: 0.5,
    stale: false,
    degree: 0,
    distance: null,
    ...patch,
  }
}

function edge(patch: Partial<GraphEdge> & { id: string; source: string; target: string }): GraphEdge {
  return { kind: 'link', label: '', confidence: 1, directed: true, ...patch }
}

function graph(patch: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return { nodes: [], edges: [], truncated: false, focusId: null, ...patch }
}

beforeEach(() => {
  useMemoryStore.getState().reset()
  graphApi.mockReset()
  healthApi.mockReset()
  getApi.mockReset()
  connectionsApi.mockReset()
  historyApi.mockReset()
})

describe('layoutGraph', () => {
  it('places a focused graph in rings by hop distance', () => {
    const positioned = layoutGraph(
      graph({
        focusId: 'memory:a',
        nodes: [
          node({ id: 'memory:a', distance: 0 }),
          node({ id: 'memory:b', distance: 1 }),
          node({ id: 'memory:c', distance: 2 }),
        ],
      }),
    )
    const centre = positioned.find((item) => item.id === 'memory:a')!
    const radius = (id: string) => {
      const found = positioned.find((item) => item.id === id)!
      return Math.hypot(found.x - centre.x, found.y - centre.y)
    }
    expect(radius('memory:a')).toBe(0)
    // Distance from the focus is the only spatial claim the layout makes, so it must be monotonic.
    expect(radius('memory:c')).toBeGreaterThan(radius('memory:b'))
    expect(radius('memory:b')).toBeGreaterThan(0)
  })

  it('is stable across refetches so an unrelated edit cannot move a node', () => {
    const payload = graph({
      focusId: 'memory:a',
      nodes: [
        node({ id: 'memory:a', distance: 0 }),
        node({ id: 'memory:b', distance: 1 }),
        node({ id: 'memory:c', distance: 1 }),
      ],
    })
    const first = layoutGraph(payload)
    // Same nodes, different order from the backend — positions must not change.
    const second = layoutGraph({ ...payload, nodes: [...payload.nodes].reverse() })
    for (const item of first) {
      const other = second.find((candidate) => candidate.id === item.id)!
      expect(other.x).toBeCloseTo(item.x)
      expect(other.y).toBeCloseTo(item.y)
    }
  })

  it('keeps overlay nodes outside the deepest memory ring', () => {
    const positioned = layoutGraph(
      graph({
        focusId: 'memory:a',
        nodes: [
          node({ id: 'memory:a', distance: 0 }),
          node({ id: 'memory:b', distance: 1 }),
          node({ id: 'file:src/a.rs', kind: 'file', itemId: null, distance: null }),
        ],
      }),
    )
    const centre = positioned.find((item) => item.id === 'memory:a')!
    const distanceOf = (id: string) => {
      const found = positioned.find((item) => item.id === id)!
      return Math.hypot(found.x - centre.x, found.y - centre.y)
    }
    expect(distanceOf('file:src/a.rs')).toBeGreaterThan(distanceOf('memory:b'))
  })

  it('spirals a global graph with the best-connected knowledge nearest the centre', () => {
    const positioned = layoutGraph(
      graph({
        nodes: [
          node({ id: 'memory:low', degree: 1 }),
          node({ id: 'memory:high', degree: 9 }),
          node({ id: 'memory:mid', degree: 4 }),
        ],
      }),
    )
    const radius = (id: string) => {
      const found = positioned.find((item) => item.id === id)!
      return Math.hypot(found.x - 450, found.y - 450)
    }
    expect(radius('memory:high')).toBeLessThan(radius('memory:mid'))
    expect(radius('memory:mid')).toBeLessThan(radius('memory:low'))
  })
})

describe('MemoryGraph', () => {
  it('says the graph is empty rather than rendering a blank canvas', () => {
    useMemoryStore.setState({ graph: graph(), graphLoading: false })
    render(<MemoryGraph />)
    expect(screen.getByText(/No knowledge to draw yet/)).toBeInTheDocument()
  })

  it('draws a node per memory and an edge per connection', () => {
    useMemoryStore.setState({
      graph: graph({
        nodes: [node({ id: 'memory:a', label: 'Auth' }), node({ id: 'memory:b', label: 'Tokens' })],
        edges: [edge({ id: 'e1', source: 'memory:a', target: 'memory:b' })],
      }),
    })
    const { container } = render(<MemoryGraph />)
    expect(screen.getByRole('button', { name: 'Auth' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tokens' })).toBeInTheDocument()
    expect(container.querySelectorAll('.memory-graph-edge')).toHaveLength(1)
  })

  it('announces a stale memory in its accessible name', () => {
    useMemoryStore.setState({
      graph: graph({ nodes: [node({ id: 'memory:a', label: 'Auth', stale: true })] }),
    })
    render(<MemoryGraph />)
    expect(screen.getByRole('button', { name: 'Auth, needs verification' })).toBeInTheDocument()
  })

  it('hides an edge kind when its legend chip is switched off', async () => {
    useMemoryStore.setState({
      graph: graph({
        nodes: [node({ id: 'memory:a' }), node({ id: 'memory:b' })],
        edges: [
          edge({ id: 'e1', source: 'memory:a', target: 'memory:b', kind: 'link' }),
          edge({ id: 'e2', source: 'memory:b', target: 'memory:a', kind: 'relation' }),
        ],
      }),
    })
    const { container } = render(<MemoryGraph />)
    expect(container.querySelectorAll('.memory-graph-edge')).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Links' }))
    expect(container.querySelectorAll('.memory-graph-edge')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Links' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('opens the memory behind a node and refocuses the graph on it', async () => {
    graphApi.mockResolvedValue(graph())
    healthApi.mockResolvedValue({
      total: 1,
      byQuality: [],
      byType: [],
      stale: 0,
      orphans: 0,
      missingEvidence: 0,
      brokenLinks: 0,
      contradictedClaims: 0,
      staleCanonical: 0,
    })
    getApi.mockResolvedValue(null)
    connectionsApi.mockResolvedValue(null)
    historyApi.mockResolvedValue([])
    useMemoryStore.setState({
      projectId: 'p1',
      view: 'graph',
      graph: graph({ nodes: [node({ id: 'memory:a', label: 'Auth', itemId: 'a' })] }),
    })

    render(<MemoryGraph />)
    await userEvent.click(screen.getByRole('button', { name: 'Auth' }))

    expect(useMemoryStore.getState().activeId).toBe('a')
    expect(useMemoryStore.getState().graphControls.focusItemId).toBe('a')
  })

  it('activates a node from the keyboard', async () => {
    graphApi.mockResolvedValue(graph())
    healthApi.mockResolvedValue(null)
    getApi.mockResolvedValue(null)
    connectionsApi.mockResolvedValue(null)
    historyApi.mockResolvedValue([])
    useMemoryStore.setState({
      projectId: 'p1',
      view: 'graph',
      graph: graph({ nodes: [node({ id: 'memory:a', label: 'Auth', itemId: 'a' })] }),
    })

    render(<MemoryGraph />)
    const target = screen.getByRole('button', { name: 'Auth' })
    target.focus()
    await userEvent.keyboard('{Enter}')

    expect(useMemoryStore.getState().activeId).toBe('a')
  })

  it('says the view is partial rather than implying the project ends here', () => {
    useMemoryStore.setState({ graph: graph({ nodes: [node({ id: 'memory:a' })], truncated: true }) })
    render(<MemoryGraph />)
    expect(screen.getByText(/Showing part of the graph/)).toBeInTheDocument()
  })

  it('reports knowledge health from real counts', () => {
    useMemoryStore.setState({
      graph: graph({ nodes: [node({ id: 'memory:a' })] }),
      health: {
        total: 12,
        byQuality: [['working', 12]],
        byType: [['decision', 12]],
        stale: 3,
        orphans: 2,
        missingEvidence: 5,
        brokenLinks: 1,
        contradictedClaims: 0,
        staleCanonical: 1,
      },
    })
    render(<MemoryGraph />)
    expect(screen.getByText(/12 memories/)).toBeInTheDocument()
    expect(screen.getByText(/3 need verification/)).toBeInTheDocument()
    expect(screen.getByText(/1 broken links/)).toBeInTheDocument()
  })

  it('disables the depth control until a memory is focused', async () => {
    graphApi.mockResolvedValue(graph())
    healthApi.mockResolvedValue(null)
    useMemoryStore.setState({ projectId: 'p1', view: 'graph', graph: graph() })
    render(<MemoryGraph />)
    expect(screen.getByRole('combobox')).toBeDisabled()

    useMemoryStore.setState({ graphControls: { ...useMemoryStore.getState().graphControls, focusItemId: 'a' } })
    render(<MemoryGraph />)
    expect(screen.getAllByRole('combobox')[1]).not.toBeDisabled()
  })
})
