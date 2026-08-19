import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryReview } from './MemoryReview'
import { useIntelligenceStore } from '../intelligenceStore'
import type {
  KnowledgeCandidate,
  KnowledgeConflict,
  ReviewGroup,
  ReviewItem,
  ReviewQueue,
} from '../intelligenceTypes'

const reviewQueueApi = vi.fn()
const decideApi = vi.fn()
const resolveApi = vi.fn()
const healthApi = vi.fn()

vi.mock('../api', () => ({
  intelligenceApi: {
    reviewQueue: (...args: unknown[]) => reviewQueueApi(...args),
    decideCandidates: (...args: unknown[]) => decideApi(...args),
    resolveConflict: (...args: unknown[]) => resolveApi(...args),
    healthReport: (...args: unknown[]) => healthApi(...args),
  },
  memoryApi: {},
}))

function candidate(patch: Partial<KnowledgeCandidate> & { id: string }): KnowledgeCandidate {
  return {
    projectId: 'p1',
    kind: 'project_analyzer.api_surface',
    subject: 'GET /api/sessions',
    predicate: 'exposes',
    object: 'route',
    statement: 'GET /api/sessions is an API surface of fixture',
    suggestedMemoryType: 'api',
    confidence: 0.9,
    origin: 'deterministic',
    riskClass: 'routine',
    status: 'pending',
    entityId: 'e1',
    itemId: null,
    branchName: null,
    createdBy: 'project_analyzer',
    dedupHash: 'hash',
    decisionReason: null,
    evidence: [{ path: 'src/routes.ts', kind: 'content', excerpt: null }],
    createdAt: '2026-08-14T09:00:00Z',
    decidedAt: null,
    ...patch,
  }
}

function conflict(patch: Partial<KnowledgeConflict> = {}): KnowledgeConflict {
  return {
    id: 'k1',
    projectId: 'p1',
    subjectEntityId: 'e1',
    subject: 'Database',
    predicate: 'version',
    leftItemId: 'm1',
    leftClaimId: null,
    leftLabel: 'Production DB is PostgreSQL 16',
    leftValue: 'PostgreSQL 16',
    rightItemId: 'm2',
    rightClaimId: null,
    rightLabel: 'Production DB is PostgreSQL 17',
    rightValue: 'PostgreSQL 17',
    classification: 'direct_contradiction',
    confidence: 0.9,
    status: 'open',
    resolution: null,
    detail: 'analyzer says 16; handoff says 17.',
    createdAt: '2026-08-14T09:00:00Z',
    resolvedAt: null,
    ...patch,
  }
}

function item(patch: Partial<ReviewItem> & { section: ReviewItem['section']; id: string }): ReviewItem {
  return {
    title: patch.id,
    detail: '',
    riskClass: 'routine',
    candidate: null,
    conflict: null,
    itemId: null,
    createdAt: '2026-08-14T09:00:00Z',
    ...patch,
  }
}

function group(patch: Partial<ReviewGroup> & { section: ReviewGroup['section'] }): ReviewGroup {
  return {
    label: patch.section,
    bulkActionable: false,
    items: [],
    ...patch,
  }
}

function queue(sections: ReviewGroup[]): ReviewQueue {
  return {
    sections,
    total: sections.reduce((count, section) => count + section.items.length, 0),
    truncated: false,
  }
}

async function seed(value: ReviewQueue) {
  reviewQueueApi.mockResolvedValue(value)
  useIntelligenceStore.setState({ projectId: 'p1' })
  await useIntelligenceStore.getState().refreshReview()
}

beforeEach(() => {
  useIntelligenceStore.getState().reset()
  reviewQueueApi.mockReset()
  decideApi.mockReset().mockResolvedValue([])
  resolveApi.mockReset().mockResolvedValue([])
  healthApi.mockReset().mockResolvedValue(undefined)
})

describe('MemoryReview', () => {
  it('says nothing is waiting rather than showing an empty frame', async () => {
    await seed(queue([]))
    render(<MemoryReview />)
    expect(screen.getByText(/nothing is waiting/i)).toBeInTheDocument()
  })

  it('shows a candidate with the evidence it rests on and why it is waiting', async () => {
    await seed(
      queue([
        group({
          section: 'high_risk_candidate',
          label: 'High-risk knowledge',
          items: [
            item({
              section: 'high_risk_candidate',
              id: 'c1',
              riskClass: 'high',
              candidate: candidate({
                id: 'c1',
                riskClass: 'high',
                suggestedMemoryType: 'decision',
                statement: 'Access tokens expire in 15 minutes',
                decisionReason: 'high-risk knowledge is confirmed by a person',
              }),
            }),
          ],
        }),
      ]),
    )
    render(<MemoryReview />)
    expect(screen.getByText('Access tokens expire in 15 minutes')).toBeInTheDocument()
    expect(screen.getByText(/confirmed by a person/i)).toBeInTheDocument()
    expect(screen.getByText('src/routes.ts')).toBeInTheDocument()
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('flags a candidate that has no evidence at all', async () => {
    await seed(
      queue([
        group({
          section: 'candidate',
          label: 'New knowledge',
          bulkActionable: true,
          items: [
            item({
              section: 'candidate',
              id: 'c1',
              candidate: candidate({ id: 'c1', evidence: [] }),
            }),
          ],
        }),
      ]),
    )
    render(<MemoryReview />)
    expect(screen.getByText(/no evidence is attached/i)).toBeInTheDocument()
  })

  it('accepts a single candidate through the backend', async () => {
    await seed(
      queue([
        group({
          section: 'candidate',
          label: 'New knowledge',
          bulkActionable: true,
          items: [item({ section: 'candidate', id: 'c1', candidate: candidate({ id: 'c1' }) })],
        }),
      ]),
    )
    render(<MemoryReview />)
    await userEvent.click(screen.getByRole('button', { name: /^accept$/i }))
    expect(decideApi).toHaveBeenCalledWith({
      projectId: 'p1',
      candidateIds: ['c1'],
      action: 'accept',
    })
  })

  it('offers a bulk accept for routine candidates and applies it to the selection', async () => {
    await seed(
      queue([
        group({
          section: 'candidate',
          label: 'New knowledge',
          bulkActionable: true,
          items: [
            item({ section: 'candidate', id: 'c1', candidate: candidate({ id: 'c1' }) }),
            item({ section: 'candidate', id: 'c2', candidate: candidate({ id: 'c2' }) }),
          ],
        }),
      ]),
    )
    render(<MemoryReview />)
    await userEvent.click(screen.getByRole('button', { name: /select all/i }))
    await userEvent.click(screen.getByRole('button', { name: /accept 2/i }))
    expect(decideApi).toHaveBeenCalledWith({
      projectId: 'p1',
      candidateIds: ['c1', 'c2'],
      action: 'accept',
    })
  })

  it('never offers a bulk action for contradictions', async () => {
    await seed(
      queue([
        group({
          section: 'canonical_conflict',
          label: 'Canonical conflicts',
          bulkActionable: false,
          items: [
            item({ section: 'canonical_conflict', id: 'k1', conflict: conflict() }),
            item({
              section: 'canonical_conflict',
              id: 'k2',
              conflict: conflict({ id: 'k2', subject: 'Cache' }),
            }),
          ],
        }),
      ]),
    )
    render(<MemoryReview />)
    expect(screen.queryByRole('button', { name: /select all/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /accept 2/i })).not.toBeInTheDocument()
  })

  it('shows both sides of a contradiction and picks no winner', async () => {
    await seed(
      queue([
        group({
          section: 'conflict',
          label: 'Conflicts',
          items: [item({ section: 'conflict', id: 'k1', conflict: conflict() })],
        }),
      ]),
    )
    render(<MemoryReview />)
    expect(screen.getByText('PostgreSQL 16')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL 17')).toBeInTheDocument()
    expect(screen.getByText(/nothing here deletes the losing record/i)).toBeInTheDocument()
  })

  it('sends the chosen resolution for a contradiction', async () => {
    await seed(
      queue([
        group({
          section: 'conflict',
          label: 'Conflicts',
          items: [item({ section: 'conflict', id: 'k1', conflict: conflict() })],
        }),
      ]),
    )
    render(<MemoryReview />)
    await userEvent.click(screen.getByRole('button', { name: /right supersedes left/i }))
    expect(resolveApi).toHaveBeenCalledWith({
      projectId: 'p1',
      conflictId: 'k1',
      resolution: 'supersede_left',
    })
  })

  it('renders sections in the order the backend returned them', async () => {
    await seed(
      queue([
        group({
          section: 'canonical_conflict',
          label: 'Canonical conflicts',
          items: [item({ section: 'canonical_conflict', id: 'k1', conflict: conflict() })],
        }),
        group({
          section: 'candidate',
          label: 'New knowledge',
          bulkActionable: true,
          items: [item({ section: 'candidate', id: 'c1', candidate: candidate({ id: 'c1' }) })],
        }),
      ]),
    )
    render(<MemoryReview />)
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent)
    expect(headings).toEqual(['Canonical conflicts', 'New knowledge'])
  })

  it('surfaces stale canonical knowledge with the reason it was flagged', async () => {
    await seed(
      queue([
        group({
          section: 'stale_canonical',
          label: 'Stale canonical knowledge',
          items: [
            item({
              section: 'stale_canonical',
              id: 'm1',
              title: 'Rotation policy',
              detail: 'file change: src/auth/token.rs',
              riskClass: 'high',
              itemId: 'm1',
            }),
          ],
        }),
      ]),
    )
    render(<MemoryReview />)
    const region = screen.getByRole('region', { name: 'Stale canonical knowledge' })
    expect(within(region).getByText('Rotation policy')).toBeInTheDocument()
    expect(within(region).getByText(/src\/auth\/token\.rs/)).toBeInTheDocument()
  })

  it('keeps every candidate checkbox reachable and labelled', async () => {
    await seed(
      queue([
        group({
          section: 'candidate',
          label: 'New knowledge',
          bulkActionable: true,
          items: [item({ section: 'candidate', id: 'c1', candidate: candidate({ id: 'c1' }) })],
        }),
      ]),
    )
    render(<MemoryReview />)
    const box = screen.getByRole('checkbox', {
      name: /GET \/api\/sessions is an API surface/i,
    })
    expect(box).toBeInTheDocument()
    await userEvent.click(box)
    expect(useIntelligenceStore.getState().selected).toEqual(['c1'])
  })
})
