import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrainHome } from './BrainHome'
import { useIntelligenceStore } from '../intelligenceStore'
import type { KnowledgeHealthReport, ProjectUnderstanding } from '../intelligenceTypes'

const understandingApi = vi.fn()
const analyzeApi = vi.fn()
const searchApi = vi.fn()

vi.mock('../api', () => ({
  intelligenceApi: {
    understanding: (...args: unknown[]) => understandingApi(...args),
    analyzeProject: (...args: unknown[]) => analyzeApi(...args),
    search: (...args: unknown[]) => searchApi(...args),
  },
  memoryApi: {},
  brainApi: {},
}))

function understanding(patch: Partial<ProjectUnderstanding> = {}): ProjectUnderstanding {
  return {
    projectId: 'p1',
    revision: 3,
    generatedAt: '2026-08-14T09:00:00Z',
    filesScanned: 1284,
    groups: [
      {
        dimension: 'framework',
        facts: [
          {
            dimension: 'framework',
            value: 'React',
            detail: '19.0.0',
            confidence: 0.95,
            evidence: [
              { path: 'package.json', kind: 'manifest', excerpt: 'react: 19.0.0' },
              { path: 'src/main.tsx', kind: 'file', excerpt: null },
            ],
          },
        ],
      },
      {
        dimension: 'desktop_runtime',
        facts: [
          {
            dimension: 'desktop_runtime',
            value: 'Tauri',
            detail: null,
            confidence: 0.95,
            evidence: [{ path: 'src-tauri/tauri.conf.json', kind: 'config', excerpt: null }],
          },
        ],
      },
    ],
    ...patch,
  }
}

function health(patch: Partial<KnowledgeHealthReport> = {}): KnowledgeHealthReport {
  return {
    total: 12,
    byQuality: [],
    byType: [],
    stale: 1,
    orphans: 0,
    missingEvidence: 2,
    brokenLinks: 0,
    contradictedClaims: 0,
    staleCanonical: 1,
    understandingRevision: 3,
    understandingGeneratedAt: '2026-08-14T09:00:00Z',
    metrics: [
      {
        key: 'stale_canonical',
        label: 'Stale canonical knowledge',
        count: 1,
        query: 'is:memory quality:canonical stale:true',
        severity: 'alert',
      },
      {
        key: 'open_conflicts',
        label: 'Unresolved conflicts',
        count: 0,
        query: 'is:conflict',
        severity: 'alert',
      },
    ],
    ...patch,
  }
}

beforeEach(() => {
  useIntelligenceStore.getState().reset()
  useIntelligenceStore.setState({ projectId: 'p1' })
  understandingApi.mockReset().mockResolvedValue(understanding())
  analyzeApi.mockReset().mockResolvedValue(true)
  searchApi.mockReset().mockResolvedValue({
    results: [],
    parsed: { expression: { node: 'all' }, diagnostics: [] },
    total: 0,
    truncated: false,
    elapsedMs: 1,
    semanticUsed: false,
  })
})

describe('BrainHome', () => {
  it('says the Project has not been read rather than showing an empty list', () => {
    useIntelligenceStore.setState({ understanding: understanding({ revision: 0, groups: [] }) })
    render(<BrainHome />)
    expect(screen.getByText(/has not been read yet/i)).toBeInTheDocument()
  })

  it('groups detected facts by dimension with readable labels', () => {
    useIntelligenceStore.setState({ understanding: understanding() })
    render(<BrainHome />)
    expect(screen.getByRole('region', { name: 'Frameworks' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Desktop runtime' })).toBeInTheDocument()
    expect(screen.getByText('React')).toBeInTheDocument()
    expect(screen.getByText('Tauri')).toBeInTheDocument()
  })

  it('reveals the files behind a fact on demand', async () => {
    useIntelligenceStore.setState({ understanding: understanding() })
    render(<BrainHome />)
    expect(screen.queryByText('package.json')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /React/ }))
    expect(screen.getByText('package.json')).toBeInTheDocument()
    expect(screen.getByText('src/main.tsx')).toBeInTheDocument()
  })

  it('states the revision and how much was scanned', () => {
    useIntelligenceStore.setState({ understanding: understanding() })
    render(<BrainHome />)
    expect(screen.getByText(/revision 3/i)).toBeInTheDocument()
    expect(screen.getByText(/1,284 files scanned/i)).toBeInTheDocument()
  })

  it('renders every health count as a runnable query, not a score', async () => {
    useIntelligenceStore.setState({ understanding: understanding(), health: health() })
    render(<BrainHome />)
    const metrics = screen.getByRole('group', { name: /knowledge health/i })
    const stale = within(metrics).getByRole('button', { name: /stale canonical knowledge/i })
    await userEvent.click(stale)
    expect(searchApi).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'is:memory quality:canonical stale:true' }),
    )
  })

  it('keeps a zero count navigable rather than hiding it', () => {
    useIntelligenceStore.setState({ understanding: understanding(), health: health() })
    render(<BrainHome />)
    const metrics = screen.getByRole('group', { name: /knowledge health/i })
    expect(
      within(metrics).getByRole('button', { name: /unresolved conflicts/i }),
    ).toBeInTheDocument()
  })

  it('queues a re-read without claiming the walk happened here', async () => {
    useIntelligenceStore.setState({ understanding: understanding() })
    render(<BrainHome />)
    await userEvent.click(screen.getByRole('button', { name: /re-read project/i }))
    expect(analyzeApi).toHaveBeenCalledWith('p1')
  })

  it('renders a dimension this build has no label for rather than dropping it', () => {
    useIntelligenceStore.setState({
      understanding: understanding({
        groups: [
          {
            dimension: 'something_new',
            facts: [
              {
                dimension: 'something_new',
                value: 'A future finding',
                detail: null,
                confidence: 0.8,
                evidence: [{ path: 'x.toml', kind: 'config', excerpt: null }],
              },
            ],
          },
        ],
      }),
    })
    render(<BrainHome />)
    expect(screen.getByRole('region', { name: 'something new' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'something new' })).getByText('A future finding'),
    ).toBeInTheDocument()
  })
})
